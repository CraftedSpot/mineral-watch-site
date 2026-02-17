import { fetchWellDetailsFromOCC } from './handlers/wells.js';
import { runFullPropertyWellMatching } from './utils/property-well-matching.js';

// Airtable configuration
const AIRTABLE_BASE_ID = 'app3j3X29Uvp5stza'; // Mineral Watch Oklahoma base
const PROPERTIES_TABLE_ID = 'tblbexFvBkow2ErYm'; // Client Properties
const WELLS_TABLE_ID = 'tblqWp3rb7rT3p9SA'; // Client Wells
const LINKS_TABLE_ID = 'tblcLilnMgeXvxXKT'; // Property-Well Links

// D1 batch configuration
const BATCH_SIZE = 500; // Max statements per batch to stay within limits

// Chunked sync configuration
const CURSOR_KEY = 'sync:cursor';
const TIME_BUDGET_MS = 25_000; // Stop fetching after 25s wall clock
const MAX_OCC_LOOKUPS_PER_TICK = 20; // Limit OCC API calls for new wells per tick
const CURSOR_STALE_MS = 2 * 60 * 60 * 1000; // Restart if cursor >2 hours old

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
}

interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
}

interface PhaseStats {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

interface SyncCursor {
  phase: 'properties' | 'wells_combined' | 'links' | 'cleanup' | 'post_sync';
  offset: string | null;
  collectedIds: {
    properties: string[];
    client_wells: string[];
    links: string[];
  };
  syncLogId: number;
  startedAt: number;
  occLookupsThisCycle: number; // Track OCC lookups across ticks within a cycle
  stats: {
    properties: PhaseStats;
    wells: PhaseStats;
    clientWells: PhaseStats;
    links: PhaseStats;
  };
}

interface SyncResult {
  properties: {
    synced: number;
    created: number;
    updated: number;
    errors: string[];
  };
  wells: {
    synced: number;
    created: number;
    updated: number;
    errors: string[];
  };
  clientWells?: {
    synced: number;
    created: number;
    updated: number;
    errors: string[];
  };
  links?: {
    synced: number;
    created: number;
    updated: number;
    errors: string[];
  };
  duration: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(dateString: string | null): string | null {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

function parseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function parseBoolean(value: any): number {
  return value ? 1 : 0;
}

async function fetchAirtableRecords(
  apiKey: string,
  baseId: string,
  tableId: string,
  offset?: string
): Promise<AirtableResponse> {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
  if (offset) url.searchParams.set('offset', offset);

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Airtable API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// ============================================================================
// Cursor Management
// ============================================================================

async function loadCursor(env: any): Promise<SyncCursor | null> {
  try {
    const raw = await env.OCC_CACHE.get(CURSOR_KEY, 'json') as SyncCursor | null;
    if (!raw) return null;
    if (Date.now() - raw.startedAt > CURSOR_STALE_MS) {
      console.log('[Sync] Cursor is stale (>2hr), restarting sync cycle');
      await env.OCC_CACHE.delete(CURSOR_KEY);
      return null;
    }
    return raw;
  } catch (e) {
    console.error('[Sync] Error loading cursor:', e);
    return null;
  }
}

async function saveCursor(env: any, cursor: SyncCursor): Promise<void> {
  await env.OCC_CACHE.put(CURSOR_KEY, JSON.stringify(cursor), { expirationTtl: 7200 });
}

async function clearCursor(env: any): Promise<void> {
  await env.OCC_CACHE.delete(CURSOR_KEY);
}

function isTimeBudgetExceeded(tickStart: number): boolean {
  return Date.now() - tickStart > TIME_BUDGET_MS;
}

function freshStats(): SyncCursor['stats'] {
  return {
    properties: { synced: 0, created: 0, updated: 0, errors: [] },
    wells: { synced: 0, created: 0, updated: 0, errors: [] },
    clientWells: { synced: 0, created: 0, updated: 0, errors: [] },
    links: { synced: 0, created: 0, updated: 0, errors: [] },
  };
}

function buildResult(cursor: SyncCursor, tickStart: number): SyncResult {
  return {
    properties: cursor.stats.properties,
    wells: cursor.stats.wells,
    clientWells: cursor.stats.clientWells,
    links: cursor.stats.links,
    duration: Date.now() - tickStart,
  };
}

// ============================================================================
// Orphan Cleanup
// ============================================================================

async function cleanupOrphans(
  env: any,
  tableName: string,
  airtableIdColumn: string,
  validAirtableIds: Set<string>
): Promise<number> {
  const d1Records = await env.WELLS_DB.prepare(
    `SELECT ${airtableIdColumn} FROM ${tableName} WHERE ${airtableIdColumn} IS NOT NULL`
  ).all();

  const orphanIds: string[] = [];
  for (const row of d1Records.results) {
    const atId = row[airtableIdColumn] as string;
    if (atId && !validAirtableIds.has(atId)) {
      orphanIds.push(atId);
    }
  }

  if (orphanIds.length === 0) return 0;

  for (let i = 0; i < orphanIds.length; i += 100) {
    const chunk = orphanIds.slice(i, i + 100);
    const stmts = chunk.map(id =>
      env.WELLS_DB.prepare(`DELETE FROM ${tableName} WHERE ${airtableIdColumn} = ?`).bind(id)
    );
    await env.WELLS_DB.batch(stmts);
  }

  console.log(`[Sync] Removed ${orphanIds.length} orphaned records from ${tableName}`);
  return orphanIds.length;
}

// ============================================================================
// Statement Builders (extracted from old sync functions)
// ============================================================================

function buildPropertyUpsert(env: any, record: AirtableRecord) {
  const id = `prop_${record.id}`;
  const fields = record.fields || {};
  const userId = fields['User']?.[0] || null;
  const orgId = fields['Organization']?.[0] || null;

  return env.WELLS_DB.prepare(`
    INSERT INTO properties (
      id, airtable_record_id, county, section, township, range, meridian,
      acres, net_acres, ri_acres, wi_acres, notes, owner, group_name,
      user_id, organization_id, monitor_adjacent, status, occ_map_link,
      synced_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(airtable_record_id) DO UPDATE SET
      county = excluded.county,
      section = excluded.section,
      township = excluded.township,
      range = excluded.range,
      meridian = excluded.meridian,
      acres = excluded.acres,
      net_acres = excluded.net_acres,
      ri_acres = excluded.ri_acres,
      wi_acres = excluded.wi_acres,
      notes = excluded.notes,
      owner = excluded.owner,
      group_name = excluded.group_name,
      user_id = excluded.user_id,
      organization_id = excluded.organization_id,
      monitor_adjacent = excluded.monitor_adjacent,
      status = excluded.status,
      occ_map_link = excluded.occ_map_link,
      synced_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id,
    record.id,
    fields.COUNTY || null,
    fields.SEC || null,
    fields.TWN || null,
    fields.RNG || null,
    fields.MERIDIAN || null,
    parseNumber(fields['RI Acres']),
    parseNumber(fields['WI Acres']),
    parseNumber(fields['RI Acres']),
    parseNumber(fields['WI Acres']),
    fields.Notes || null,
    userId,
    fields.Group || null,
    userId,
    orgId,
    fields['Monitor Adjacent'] ? 1 : 0,
    fields.Status || 'Active',
    fields['OCC Map Link'] || null
  );
}

function buildClientWellUpsert(env: any, record: AirtableRecord) {
  const id = `cwell_${record.id}`;
  const fields = record.fields || {};
  const userId = fields['User']?.[0] || null;
  const orgId = fields['Organization']?.[0] || null;

  return env.WELLS_DB.prepare(`
    INSERT INTO client_wells (
      id, airtable_id, user_id, organization_id,
      api_number, well_name, operator, county,
      section, township, range_val, well_type, well_status,
      spud_date, completion_date, first_production_date,
      ip_oil, ip_gas, ip_water,
      formation_name, total_depth, lateral_length, is_horizontal,
      bh_section, bh_township, bh_range,
      occ_map_link, notes, status, synced_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(airtable_id) DO UPDATE SET
      user_id = excluded.user_id,
      organization_id = excluded.organization_id,
      api_number = excluded.api_number,
      well_name = COALESCE(excluded.well_name, client_wells.well_name),
      operator = COALESCE(excluded.operator, client_wells.operator),
      county = COALESCE(excluded.county, client_wells.county),
      section = COALESCE(excluded.section, client_wells.section),
      township = COALESCE(excluded.township, client_wells.township),
      range_val = COALESCE(excluded.range_val, client_wells.range_val),
      well_type = COALESCE(excluded.well_type, client_wells.well_type),
      well_status = COALESCE(excluded.well_status, client_wells.well_status),
      spud_date = COALESCE(excluded.spud_date, client_wells.spud_date),
      completion_date = COALESCE(excluded.completion_date, client_wells.completion_date),
      first_production_date = COALESCE(excluded.first_production_date, client_wells.first_production_date),
      ip_oil = COALESCE(excluded.ip_oil, client_wells.ip_oil),
      ip_gas = COALESCE(excluded.ip_gas, client_wells.ip_gas),
      ip_water = COALESCE(excluded.ip_water, client_wells.ip_water),
      formation_name = COALESCE(excluded.formation_name, client_wells.formation_name),
      total_depth = COALESCE(excluded.total_depth, client_wells.total_depth),
      lateral_length = COALESCE(excluded.lateral_length, client_wells.lateral_length),
      is_horizontal = COALESCE(excluded.is_horizontal, client_wells.is_horizontal),
      bh_section = COALESCE(excluded.bh_section, client_wells.bh_section),
      bh_township = COALESCE(excluded.bh_township, client_wells.bh_township),
      bh_range = COALESCE(excluded.bh_range, client_wells.bh_range),
      occ_map_link = COALESCE(excluded.occ_map_link, client_wells.occ_map_link),
      notes = COALESCE(excluded.notes, client_wells.notes),
      status = excluded.status,
      updated_at = datetime('now'),
      synced_at = CURRENT_TIMESTAMP
  `).bind(
    id,
    record.id,
    userId,
    orgId,
    fields['API Number'] || null,
    fields['Well Name'] || null,
    fields['Operator'] || null,
    fields['County'] || null,
    fields['Section'] || null,
    fields['Township'] || null,
    fields['Range'] || null,
    fields['Well Type'] || null,
    fields['Well Status'] || null,
    formatDate(fields['Spud Date']),
    formatDate(fields['Completion Date']),
    formatDate(fields['First Production Date']),
    parseNumber(fields['IP Oil (BBL/day)']),
    parseNumber(fields['IP Gas (MCF/day)']),
    parseNumber(fields['IP Water (BBL/day)']),
    fields['Formation Name'] || null,
    parseNumber(fields['Total Depth']),
    parseNumber(fields['Lateral Length']),
    parseBoolean(fields['Is Horizontal']),
    fields['BH Section'] || null,
    fields['BH Township'] || null,
    fields['BH Range'] || null,
    fields['OCC Map Link'] || null,
    fields['Notes'] || null,
    fields['Status'] || 'Active'
  );
}

function buildLinkUpsert(env: any, record: AirtableRecord): any | null {
  const id = `link_${record.id}`;
  const fields = record.fields || {};
  const propertyId = fields['Property']?.[0] || null;
  const wellId = fields['Well']?.[0] || null;
  const userId = fields['User']?.[0] || null;
  const orgId = fields['Organization']?.[0] || null;

  if (!propertyId || !wellId) {
    console.warn(`[Sync] Link ${record.id} missing property or well ID`);
    return null;
  }

  return env.WELLS_DB.prepare(`
    INSERT OR REPLACE INTO property_well_links (
      id, airtable_record_id, property_airtable_id, well_airtable_id,
      match_reason, status, confidence_score,
      user_id, organization_id,
      link_name, link_type,
      created_at, rejected_date, synced_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    id,
    record.id,
    propertyId,
    wellId,
    fields['Match Reason'] || 'Manual',
    fields['Status'] || 'Active',
    parseNumber(fields['Confidence Score']),
    userId,
    orgId,
    fields['Link Name'] || null,
    fields['Link Type'] || 'Auto',
    formatDate(record.createdTime),
    fields['Status'] === 'Rejected' ? formatDate(fields['Rejected Date']) : null
  );
}

// ============================================================================
// Chunked Phase Functions
// ============================================================================

/**
 * Sync properties from Airtable, page by page.
 * Returns true if phase complete, false if paused (time budget exceeded).
 */
async function syncPropertiesChunked(env: any, cursor: SyncCursor, tickStart: number): Promise<boolean> {
  try {
    while (true) {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        PROPERTIES_TABLE_ID,
        cursor.offset || undefined
      );

      console.log(`[Sync] Fetched ${response.records.length} properties${cursor.offset ? ' (continued)' : ''}`);

      // Upsert this page immediately
      const statements = response.records.map(record => buildPropertyUpsert(env, record));
      for (let i = 0; i < statements.length; i += BATCH_SIZE) {
        await env.WELLS_DB.batch(statements.slice(i, i + BATCH_SIZE));
      }

      // Collect IDs for orphan cleanup
      cursor.collectedIds.properties.push(...response.records.map(r => r.id));
      cursor.stats.properties.synced += response.records.length;
      cursor.stats.properties.updated += response.records.length;

      if (!response.offset) {
        console.log(`[Sync] Properties phase complete: ${cursor.stats.properties.synced} records`);
        return true;
      }

      cursor.offset = response.offset;
      if (isTimeBudgetExceeded(tickStart)) {
        console.log(`[Sync] Time budget exceeded, pausing properties at offset (${cursor.stats.properties.synced} records so far)`);
        return false;
      }
    }
  } catch (error: any) {
    cursor.stats.properties.errors.push(`Properties sync failed: ${error.message}`);
    console.error('[Sync] Properties sync error:', error);
    return true; // Move to next phase even on error
  }
}

/**
 * Combined wells sync: fetches WELLS_TABLE once, processes into both
 * client_wells (ownership mirror) and wells (OCC enrichment).
 * Returns true if phase complete, false if paused.
 */
async function syncWellsCombinedChunked(env: any, cursor: SyncCursor, tickStart: number): Promise<boolean> {
  let occLookupsThisTick = 0;

  try {
    while (true) {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        WELLS_TABLE_ID,
        cursor.offset || undefined
      );

      console.log(`[Sync] Fetched ${response.records.length} wells${cursor.offset ? ' (continued)' : ''}`);

      // --- Part 1: Upsert to client_wells (batch, always) ---
      const clientWellStatements = response.records.map(record => buildClientWellUpsert(env, record));
      for (let i = 0; i < clientWellStatements.length; i += BATCH_SIZE) {
        await env.WELLS_DB.batch(clientWellStatements.slice(i, i + BATCH_SIZE));
      }
      cursor.collectedIds.client_wells.push(...response.records.map(r => r.id));
      cursor.stats.clientWells.synced += response.records.length;
      cursor.stats.clientWells.updated += response.records.length;

      // --- Part 2: Sync to wells table (per-record, with OCC enrichment) ---
      for (const record of response.records) {
        try {
          const fields = record.fields || {};
          const apiNumber = fields['API Number'];

          if (!apiNumber) {
            cursor.stats.wells.errors.push(`Well ${record.id}: Missing API number`);
            continue;
          }

          const status = fields['Status']?.name || fields['Status'] || null;

          // Try to update existing well in D1
          const updateResult = await env.WELLS_DB.prepare(`
            UPDATE wells SET
              airtable_record_id = ?,
              status = ?,
              synced_at = CURRENT_TIMESTAMP
            WHERE api_number = ?
          `).bind(record.id, status, apiNumber).run();

          if (updateResult.meta.changes > 0) {
            cursor.stats.wells.updated++;
          } else if (occLookupsThisTick < MAX_OCC_LOOKUPS_PER_TICK && cursor.occLookupsThisCycle < MAX_OCC_LOOKUPS_PER_TICK * 10) {
            // Well not in D1 — fetch from OCC API (budgeted)
            console.log(`[Sync] Well ${apiNumber} not in D1, fetching from OCC...`);
            occLookupsThisTick++;
            cursor.occLookupsThisCycle++;

            const occData: any = await fetchWellDetailsFromOCC(apiNumber, env);

            if (occData) {
              console.log(`[Sync] Found well ${apiNumber} in OCC: ${occData.wellName}`);

              const insertValues = {
                api_number: apiNumber,
                airtable_record_id: record.id,
                well_name: occData.wellName || fields['Well Name'] || null,
                well_number: null as string | null,
                operator: occData.operator || fields.Operator || null,
                county: occData.county || fields.County || null,
                section: occData.section ? parseInt(String(occData.section), 10) : null,
                township: occData.township || fields.Township || null,
                range: occData.range || fields.Range || null,
                meridian: occData.meridian || 'IM',
                latitude: occData.lat || null,
                longitude: occData.lon || null,
                status: status,
                well_status: occData.wellStatus || fields['Well Status'] || null,
                well_type: occData.wellType || null,
                spud_date: occData.spudDate || null,
                completion_date: occData.completionDate || null,
                bh_latitude: occData.bhLat || null,
                bh_longitude: occData.bhLon || null,
                lateral_length: occData.lateralLength || null,
                formation_name: occData.formationName || null,
                formation_depth: occData.formationDepth || null,
                true_vertical_depth: occData.tvd || null,
                measured_total_depth: occData.md || null,
                ip_oil_bbl: occData.ipOil || null,
                ip_gas_mcf: occData.ipGas || null,
                ip_water_bbl: occData.ipWater || null
              };

              await env.WELLS_DB.prepare(`
                INSERT INTO wells (
                  api_number, airtable_record_id, well_name, well_number, operator,
                  county, section, township, range, meridian, latitude, longitude,
                  status, well_status, well_type, spud_date, completion_date,
                  bh_latitude, bh_longitude, lateral_length,
                  formation_name, formation_depth, true_vertical_depth, measured_total_depth,
                  ip_oil_bbl, ip_gas_mcf, ip_water_bbl,
                  created_at, synced_at
                )
                VALUES (
                  ?, ?, ?, ?, ?, ?,
                  CAST(? AS INTEGER), ?, ?, ?,
                  CAST(? AS REAL), CAST(? AS REAL),
                  ?, ?, ?, ?, ?,
                  CAST(? AS REAL), CAST(? AS REAL), CAST(? AS INTEGER),
                  ?, CAST(? AS INTEGER), CAST(? AS INTEGER), CAST(? AS INTEGER),
                  CAST(? AS REAL), CAST(? AS REAL), CAST(? AS REAL),
                  datetime('now'), CURRENT_TIMESTAMP
                )
              `).bind(
                insertValues.api_number, insertValues.airtable_record_id,
                insertValues.well_name, insertValues.well_number,
                insertValues.operator, insertValues.county,
                insertValues.section, insertValues.township,
                insertValues.range, insertValues.meridian,
                insertValues.latitude, insertValues.longitude,
                insertValues.status, insertValues.well_status,
                insertValues.well_type, insertValues.spud_date,
                insertValues.completion_date,
                insertValues.bh_latitude, insertValues.bh_longitude,
                insertValues.lateral_length,
                insertValues.formation_name, insertValues.formation_depth,
                insertValues.true_vertical_depth, insertValues.measured_total_depth,
                insertValues.ip_oil_bbl, insertValues.ip_gas_mcf,
                insertValues.ip_water_bbl
              ).run();

              cursor.stats.wells.created++;
            } else {
              // Fall back to minimal insert with Airtable data
              const fullWellName = fields['Well Name'] || '';
              let wellName = fullWellName;
              let wellNumber: string | null = null;

              const wellMatch = fullWellName.match(/^(.+?)\s+(#\d+(?:-?\w+)?)$/);
              if (wellMatch) {
                wellName = wellMatch[1].trim();
                wellNumber = wellMatch[2];
              } else {
                const noHashMatch = fullWellName.match(/^(.+?)\s+(\d+(?:-?\w+)?)$/);
                if (noHashMatch) {
                  wellName = noHashMatch[1].trim();
                  wellNumber = `#${noHashMatch[2]}`;
                }
              }

              await env.WELLS_DB.prepare(`
                INSERT INTO wells (
                  api_number, airtable_record_id, well_name, well_number, operator,
                  county, section, township, range, meridian,
                  status, well_status, created_at, synced_at
                )
                VALUES (?, ?, ?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, 'IM', ?, ?, datetime('now'), CURRENT_TIMESTAMP)
              `).bind(
                apiNumber, record.id, wellName, wellNumber,
                fields.Operator || null, fields.County || null,
                fields.Section ? parseInt(fields.Section, 10) : null,
                fields.Township || null, fields.Range || null,
                status, fields['Well Status'] || null
              ).run();

              cursor.stats.wells.created++;
            }
          } else {
            // OCC budget exceeded — skip new well lookup this tick (will be picked up next time)
            // The client_wells upsert already happened above
          }

          cursor.stats.wells.synced++;
        } catch (error: any) {
          cursor.stats.wells.errors.push(`Well ${record.id}: ${error.message}`);
          console.error(`[Sync] Error syncing well ${record.id}:`, error);
        }
      }

      if (!response.offset) {
        // All pages fetched — run client_wells enrichment UPDATE
        console.log(`[Sync] Wells phase complete: ${cursor.stats.wells.synced} wells, ${cursor.stats.clientWells.synced} client wells`);
        await enrichClientWells(env);
        return true;
      }

      cursor.offset = response.offset;
      if (isTimeBudgetExceeded(tickStart)) {
        console.log(`[Sync] Time budget exceeded, pausing wells at offset (${cursor.stats.wells.synced} wells, ${occLookupsThisTick} OCC lookups this tick)`);
        return false;
      }
    }
  } catch (error: any) {
    cursor.stats.wells.errors.push(`Wells sync failed: ${error.message}`);
    cursor.stats.clientWells.errors.push(`Client wells sync failed: ${error.message}`);
    console.error('[Sync] Wells combined sync error:', error);
    return true; // Move to next phase
  }
}

/**
 * Enrich client_wells with data from OCC wells table.
 * COALESCE keeps existing D1 values, only fills NULLs.
 */
async function enrichClientWells(env: any): Promise<void> {
  console.log('[Sync] Enriching client wells with OCC data from wells table...');
  const enrichResult = await env.WELLS_DB.prepare(`
    UPDATE client_wells
    SET
      well_name = COALESCE(well_name, (SELECT w.well_name || COALESCE(' ' || w.well_number, '') FROM wells w WHERE w.api_number = client_wells.api_number)),
      operator = COALESCE(operator, (SELECT w.operator FROM wells w WHERE w.api_number = client_wells.api_number)),
      county = COALESCE(county, (SELECT w.county FROM wells w WHERE w.api_number = client_wells.api_number)),
      section = COALESCE(section, (SELECT CAST(w.section AS TEXT) FROM wells w WHERE w.api_number = client_wells.api_number)),
      township = COALESCE(township, (SELECT w.township FROM wells w WHERE w.api_number = client_wells.api_number)),
      range_val = COALESCE(range_val, (SELECT w.range FROM wells w WHERE w.api_number = client_wells.api_number)),
      well_type = COALESCE(well_type, (SELECT w.well_type FROM wells w WHERE w.api_number = client_wells.api_number)),
      well_status = COALESCE(well_status, (SELECT w.well_status FROM wells w WHERE w.api_number = client_wells.api_number)),
      formation_name = COALESCE(formation_name, (SELECT w.formation_name FROM wells w WHERE w.api_number = client_wells.api_number)),
      total_depth = COALESCE(total_depth, (SELECT w.measured_total_depth FROM wells w WHERE w.api_number = client_wells.api_number)),
      spud_date = COALESCE(spud_date, (SELECT w.spud_date FROM wells w WHERE w.api_number = client_wells.api_number)),
      completion_date = COALESCE(completion_date, (SELECT w.completion_date FROM wells w WHERE w.api_number = client_wells.api_number)),
      first_production_date = COALESCE(first_production_date, (SELECT w.first_production_date FROM wells w WHERE w.api_number = client_wells.api_number)),
      ip_oil = COALESCE(ip_oil, (SELECT w.ip_oil_bbl FROM wells w WHERE w.api_number = client_wells.api_number)),
      ip_gas = COALESCE(ip_gas, (SELECT w.ip_gas_mcf FROM wells w WHERE w.api_number = client_wells.api_number)),
      ip_water = COALESCE(ip_water, (SELECT w.ip_water_bbl FROM wells w WHERE w.api_number = client_wells.api_number)),
      is_horizontal = (SELECT w.is_horizontal FROM wells w WHERE w.api_number = client_wells.api_number),
      bh_section = (SELECT w.bh_section FROM wells w WHERE w.api_number = client_wells.api_number),
      bh_township = (SELECT w.bh_township FROM wells w WHERE w.api_number = client_wells.api_number),
      bh_range = (SELECT w.bh_range FROM wells w WHERE w.api_number = client_wells.api_number),
      lateral_length = COALESCE(lateral_length, (SELECT w.lateral_length FROM wells w WHERE w.api_number = client_wells.api_number))
    WHERE status = 'Active'
    AND api_number IN (SELECT api_number FROM wells)
  `).run();
  console.log(`[Sync] Enriched ${enrichResult.meta.changes} client wells with OCC data`);
}

/**
 * Sync property-well links from Airtable, page by page.
 * Returns true if phase complete, false if paused.
 */
async function syncLinksChunked(env: any, cursor: SyncCursor, tickStart: number): Promise<boolean> {
  try {
    while (true) {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        LINKS_TABLE_ID,
        cursor.offset || undefined
      );

      console.log(`[Sync] Fetched ${response.records.length} links${cursor.offset ? ' (continued)' : ''}`);

      // Build and filter statements (skip records missing property or well)
      const statements = response.records
        .map(record => buildLinkUpsert(env, record))
        .filter((stmt): stmt is any => stmt !== null);

      for (let i = 0; i < statements.length; i += BATCH_SIZE) {
        await env.WELLS_DB.batch(statements.slice(i, i + BATCH_SIZE));
      }

      cursor.collectedIds.links.push(...response.records.map(r => r.id));
      cursor.stats.links.synced += statements.length;
      cursor.stats.links.updated += statements.length;

      if (!response.offset) {
        console.log(`[Sync] Links phase complete: ${cursor.stats.links.synced} records`);
        return true;
      }

      cursor.offset = response.offset;
      if (isTimeBudgetExceeded(tickStart)) {
        console.log(`[Sync] Time budget exceeded, pausing links at offset (${cursor.stats.links.synced} records so far)`);
        return false;
      }
    }
  } catch (error: any) {
    cursor.stats.links.errors.push(`Links sync failed: ${error.message}`);
    console.error('[Sync] Links sync error:', error);
    return true;
  }
}

// ============================================================================
// Cleanup & Post-Sync
// ============================================================================

async function runCleanup(env: any, cursor: SyncCursor): Promise<void> {
  // DISABLED: Orphan cleanup was deleting valid records because upserts
  // were failing silently. Re-enable once upsert bug is fixed and verified.
  console.log('[Sync] Orphan cleanup DISABLED — skipping');
  return;

  console.log('[Sync] Running orphan cleanup...');

  if (cursor.collectedIds.properties.length > 0) {
    const validPropertyIds = new Set(cursor.collectedIds.properties);
    await cleanupOrphans(env, 'properties', 'airtable_record_id', validPropertyIds);
  }

  if (cursor.collectedIds.client_wells.length > 0) {
    const validWellIds = new Set(cursor.collectedIds.client_wells);
    await cleanupOrphans(env, 'client_wells', 'airtable_id', validWellIds);
  }

  if (cursor.collectedIds.links.length > 0) {
    const validLinkIds = new Set(cursor.collectedIds.links);
    await cleanupOrphans(env, 'property_well_links', 'airtable_record_id', validLinkIds);
  }

  console.log('[Sync] Orphan cleanup complete');
}

async function runPostSync(env: any, cursor: SyncCursor): Promise<void> {
  const totalSynced = cursor.stats.properties.synced + cursor.stats.wells.synced +
    cursor.stats.clientWells.synced + cursor.stats.links.synced;

  // Document re-linking
  if (env.DOCUMENTS_WORKER && totalSynced > 0) {
    console.log('[Sync] Triggering document re-linking after successful sync');
    try {
      const relinkResponse = await env.DOCUMENTS_WORKER.fetch(
        new Request('https://documents-worker/api/processing/relink-all', {
          method: 'POST',
          headers: {
            'X-API-Key': env.PROCESSING_API_KEY || 'mmw-proc-2024-secure-key',
            'Content-Type': 'application/json'
          }
        })
      );

      if (relinkResponse.ok) {
        const relinkResult = await relinkResponse.json() as any;
        console.log(`[Sync] Document re-linking complete: ${relinkResult.linked} documents linked`);
      } else {
        console.error('[Sync] Document re-linking failed:', await relinkResponse.text());
      }
    } catch (error) {
      console.error('[Sync] Error triggering document re-linking:', error);
    }
  }

  // BH geocoding
  try {
    await geocodeBhFromSectionCenters(env);
  } catch (error) {
    console.error('[Sync] BH geocoding error:', error);
  }

  // Auto-match properties to wells
  if (cursor.stats.properties.synced > 0) {
    try {
      const usersWithUnlinked = await env.WELLS_DB.prepare(`
        SELECT p.owner, u.email, u.airtable_record_id, u.organization_id, COUNT(*) as unlinked
        FROM properties p
        LEFT JOIN property_well_links pwl
          ON pwl.property_airtable_id = p.airtable_record_id AND pwl.status IN ('Active', 'Linked')
        JOIN users u ON u.airtable_record_id = p.owner
        WHERE pwl.id IS NULL
        GROUP BY p.owner
      `).all();

      if (usersWithUnlinked.results.length > 0) {
        console.log(`[Sync] Found ${usersWithUnlinked.results.length} user(s) with unlinked properties, running auto-match`);
        for (const row of usersWithUnlinked.results as any[]) {
          try {
            const matchResult = await runFullPropertyWellMatching(
              row.airtable_record_id,
              row.email,
              row.organization_id || undefined,
              env
            );
            console.log(`[Sync] Auto-match for ${row.email}: ${matchResult.linksCreated} links created (${matchResult.propertiesProcessed} props, ${matchResult.wellsProcessed} wells)`);
          } catch (matchError) {
            console.error(`[Sync] Auto-match failed for ${row.email}:`, matchError);
          }
        }
      }
    } catch (error) {
      console.error('[Sync] Auto-matching error:', error);
    }
  }
}

// ============================================================================
// BH Geocoding (unchanged from original)
// ============================================================================

async function geocodeBhFromSectionCenters(env: any): Promise<void> {
  const needGeocode = await env.WELLS_DB.prepare(`
    SELECT COUNT(*) as count FROM wells
    WHERE bh_section IS NOT NULL
      AND bh_township IS NOT NULL
      AND bh_latitude IS NULL
  `).first();

  const count = needGeocode?.count as number || 0;
  if (count === 0) {
    console.log('[Sync] No wells need BH geocoding');
    return;
  }

  console.log(`[Sync] Geocoding BH coordinates for ${count} wells from section centers`);

  const MAX_PER_CYCLE = 500;
  const wells = await env.WELLS_DB.prepare(`
    SELECT id, bh_section, bh_township, bh_range, meridian
    FROM wells
    WHERE bh_section IS NOT NULL
      AND bh_township IS NOT NULL
      AND bh_latitude IS NULL
    LIMIT ?
  `).bind(MAX_PER_CYCLE).all();

  if (wells.results.length === 0) return;

  const statements: any[] = [];
  let updated = 0;

  for (const well of wells.results) {
    const township = well.bh_township as string;
    const range = well.bh_range as string;
    const meridianRaw = (well.meridian as string || '').toUpperCase();

    if (!township || !range) continue;

    const twpDir = township.slice(-1);
    const twpNum = parseInt(township.slice(0, -1), 10);
    const rngDir = range.slice(-1);
    const rngNum = parseInt(range.slice(0, -1), 10);
    const meridian = meridianRaw === 'IM' ? 'indian' : meridianRaw === 'CM' ? 'cimarron' : null;

    if (isNaN(twpNum) || isNaN(rngNum) || !meridian) continue;

    const plssTownship = `${twpNum * 10}${twpDir}`;
    const plssRange = `${rngNum}${rngDir}`;
    const section = String(well.bh_section);

    const sectionRow = await env.WELLS_DB.prepare(`
      SELECT center_lat, center_lng FROM plss_sections
      WHERE (section = ? OR section = ?)
        AND township = ?
        AND range = ?
        AND meridian = ?
        AND center_lat IS NOT NULL
      LIMIT 1
    `).bind(section, section.padStart(2, '0'), plssTownship, plssRange, meridian).first();

    if (sectionRow) {
      statements.push(
        env.WELLS_DB.prepare(`
          UPDATE wells SET bh_latitude = ?, bh_longitude = ?, bh_coordinate_source = 'section_center'
          WHERE id = ?
        `).bind(sectionRow.center_lat, sectionRow.center_lng, well.id)
      );
      updated++;
    }
  }

  const DB_BATCH = 100;
  for (let i = 0; i < statements.length; i += DB_BATCH) {
    const chunk = statements.slice(i, i + DB_BATCH);
    await env.WELLS_DB.batch(chunk);
  }

  console.log(`[Sync] Geocoded ${updated} wells with section center coordinates (${count - updated > MAX_PER_CYCLE ? 'more remaining' : count - updated + ' unmatched'})`);
}

// ============================================================================
// Main Entry Point — Phase Machine
// ============================================================================

export async function syncAirtableData(env: any): Promise<SyncResult> {
  const tickStart = Date.now();

  if (!env.MINERAL_AIRTABLE_API_KEY) {
    throw new Error('MINERAL_AIRTABLE_API_KEY not configured');
  }

  // Load or create cursor
  let cursor = await loadCursor(env);
  const isResume = !!cursor;

  if (!cursor) {
    // Start a fresh sync cycle
    const syncLogResult = await env.WELLS_DB.prepare(
      'INSERT INTO sync_log (sync_type, status) VALUES (?, ?) RETURNING id'
    ).bind('full', 'running').first();

    cursor = {
      phase: 'properties',
      offset: null,
      collectedIds: { properties: [], client_wells: [], links: [] },
      syncLogId: syncLogResult?.id || 0,
      startedAt: Date.now(),
      occLookupsThisCycle: 0,
      stats: freshStats(),
    };
    console.log(`[Sync] Starting fresh sync cycle (log ID: ${cursor.syncLogId})`);
  } else {
    console.log(`[Sync] Resuming sync cycle (phase: ${cursor.phase}, log ID: ${cursor.syncLogId})`);
  }

  try {
    // Phase machine — falls through phases until time budget exceeded or complete
    if (cursor.phase === 'properties') {
      const done = await syncPropertiesChunked(env, cursor, tickStart);
      if (!done) {
        await saveCursor(env, cursor);
        return buildResult(cursor, tickStart);
      }
      cursor.phase = 'wells_combined';
      cursor.offset = null;
    }

    if (cursor.phase === 'wells_combined') {
      const done = await syncWellsCombinedChunked(env, cursor, tickStart);
      if (!done) {
        await saveCursor(env, cursor);
        return buildResult(cursor, tickStart);
      }
      cursor.phase = 'links';
      cursor.offset = null;
    }

    if (cursor.phase === 'links') {
      const done = await syncLinksChunked(env, cursor, tickStart);
      if (!done) {
        await saveCursor(env, cursor);
        return buildResult(cursor, tickStart);
      }
      cursor.phase = 'cleanup';
    }

    if (cursor.phase === 'cleanup') {
      await runCleanup(env, cursor);
      cursor.phase = 'post_sync';
    }

    if (cursor.phase === 'post_sync') {
      await runPostSync(env, cursor);
    }

    // Sync cycle complete
    const result = buildResult(cursor, tickStart);
    console.log(`[Sync] Cycle complete in ${result.duration}ms: ${cursor.stats.properties.synced} props, ${cursor.stats.clientWells.synced} wells, ${cursor.stats.links.synced} links`);

    if (cursor.syncLogId) {
      await env.WELLS_DB.prepare(
        `UPDATE sync_log
         SET completed_at = datetime('now'),
             records_synced = ?,
             records_created = ?,
             records_updated = ?,
             status = 'completed'
         WHERE id = ?`
      ).bind(
        cursor.stats.properties.synced + cursor.stats.wells.synced + cursor.stats.clientWells.synced + cursor.stats.links.synced,
        cursor.stats.properties.created + cursor.stats.wells.created + cursor.stats.clientWells.created + cursor.stats.links.created,
        cursor.stats.properties.updated + cursor.stats.wells.updated + cursor.stats.clientWells.updated + cursor.stats.links.updated,
        cursor.syncLogId
      ).run();
    }

    await clearCursor(env);
    return result;

  } catch (error: any) {
    console.error('[Sync] Fatal sync error:', error);

    if (cursor.syncLogId) {
      await env.WELLS_DB.prepare(
        `UPDATE sync_log
         SET completed_at = datetime('now'),
             error_message = ?,
             status = 'failed'
         WHERE id = ?`
      ).bind(error.message, cursor.syncLogId).run();
    }

    await clearCursor(env);
    throw error;
  }
}
