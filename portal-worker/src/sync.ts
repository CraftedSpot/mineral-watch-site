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
const TIME_BUDGET_MS = 600_000; // 10 minutes — cron handlers have 15min timeout
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
    return false; // Pause — retry this phase on next tick
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
      const successfulClientWellIds: string[] = [];

      for (let i = 0; i < clientWellStatements.length; i += BATCH_SIZE) {
        const batchSlice = clientWellStatements.slice(i, i + BATCH_SIZE);
        const batchRecords = response.records.slice(i, i + batchSlice.length);
        try {
          await env.WELLS_DB.batch(batchSlice);
          // Entire batch succeeded — all IDs are valid
          successfulClientWellIds.push(...batchRecords.map(r => r.id));
          console.log(`[Sync] client_wells batch ${i}..${i + batchSlice.length} succeeded`);
        } catch (batchErr: any) {
          console.error(`[Sync] client_wells batch ${i}..${i + batchSlice.length} FAILED:`, batchErr?.message || batchErr);
          // Try individual statements — only track IDs that actually succeed
          let batchFailCount = 0;
          for (let j = 0; j < batchSlice.length; j++) {
            try {
              await batchSlice[j].run();
              successfulClientWellIds.push(batchRecords[j].id);
            } catch (singleErr: any) {
              batchFailCount++;
              const rec = batchRecords[j];
              console.error(`[Sync] client_wells INDIVIDUAL FAIL record=${rec?.id} api=${rec?.fields?.['API Number']}: ${singleErr?.message}`);
              cursor.stats.clientWells.errors.push(`Record ${rec?.id}: ${singleErr?.message}`);
            }
          }
          if (batchFailCount > 0) {
            console.warn(`[Sync] client_wells: ${batchFailCount} records failed both batch and individual insert`);
          }
        }
      }
      cursor.collectedIds.client_wells.push(...successfulClientWellIds);
      cursor.stats.clientWells.synced += successfulClientWellIds.length;
      cursor.stats.clientWells.updated += successfulClientWellIds.length;

      // --- Part 2: Batch update wells table (airtable_record_id + status) ---
      // Batched instead of per-record to avoid Worker timeout on 1400+ individual queries
      const wellsUpdateStmts = response.records
        .filter(r => r.fields?.['API Number'])
        .map(record => {
          const status = record.fields['Status']?.name || record.fields['Status'] || null;
          return env.WELLS_DB.prepare(`
            UPDATE wells SET
              airtable_record_id = ?,
              status = ?,
              synced_at = CURRENT_TIMESTAMP
            WHERE api_number = ?
          `).bind(record.id, status, record.fields['API Number']);
        });

      if (wellsUpdateStmts.length > 0) {
        for (let i = 0; i < wellsUpdateStmts.length; i += BATCH_SIZE) {
          await env.WELLS_DB.batch(wellsUpdateStmts.slice(i, i + BATCH_SIZE));
        }
      }
      cursor.stats.wells.synced += wellsUpdateStmts.length;
      cursor.stats.wells.updated += wellsUpdateStmts.length;

      if (!response.offset) {
        // All pages fetched
        console.log(`[Sync] Wells phase complete: ${cursor.stats.wells.synced} wells, ${cursor.stats.clientWells.synced} client wells`);
        // Enrichment temporarily skipped — V2 handler LEFT JOINs wells table directly
        // await enrichClientWells(env);
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
    return false; // Pause — retry this phase on next tick
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
    return false; // Pause — retry this phase on next tick
  }
}

// ============================================================================
// Cleanup & Post-Sync
// ============================================================================

async function runCleanup(env: any, cursor: SyncCursor): Promise<void> {
  console.log('[Sync] Running orphan cleanup with safety guards...');

  const SAFETY_THRESHOLD = 0.9; // Only cleanup if we synced ≥90% of expected records

  // --- Properties ---
  await safeCleanup(env, {
    tableName: 'properties',
    airtableIdColumn: 'airtable_record_id',
    collectedIds: cursor.collectedIds.properties,
    threshold: SAFETY_THRESHOLD,
  });

  // --- Client Wells ---
  await safeCleanup(env, {
    tableName: 'client_wells',
    airtableIdColumn: 'airtable_id',
    collectedIds: cursor.collectedIds.client_wells,
    threshold: SAFETY_THRESHOLD,
  });

  // --- Property-Well Links ---
  await safeCleanup(env, {
    tableName: 'property_well_links',
    airtableIdColumn: 'airtable_record_id',
    collectedIds: cursor.collectedIds.links,
    threshold: SAFETY_THRESHOLD,
  });

  console.log('[Sync] Orphan cleanup complete');
}

/**
 * Safely cleanup orphans for a single table.
 * Compares collected Airtable ID count against D1 row count.
 * Skips cleanup if synced count is below threshold (partial sync protection).
 */
async function safeCleanup(
  env: any,
  opts: {
    tableName: string;
    airtableIdColumn: string;
    collectedIds: string[];
    threshold: number;
  }
): Promise<void> {
  const { tableName, airtableIdColumn, collectedIds, threshold } = opts;

  if (collectedIds.length === 0) {
    console.log(`[Sync] Cleanup ${tableName}: no IDs collected, skipping`);
    return;
  }

  // Count how many D1 rows have an Airtable ID (synced from Airtable, not D1-first bulk uploads)
  const d1Count = await env.WELLS_DB.prepare(
    `SELECT COUNT(*) as count FROM ${tableName} WHERE ${airtableIdColumn} IS NOT NULL`
  ).first();
  const existingCount = (d1Count?.count as number) || 0;

  const ratio = existingCount > 0 ? collectedIds.length / existingCount : 1;

  if (ratio < threshold) {
    console.warn(
      `[Sync] SAFETY GUARD: Skipping ${tableName} cleanup — ` +
      `synced ${collectedIds.length} but D1 has ${existingCount} ` +
      `(ratio ${(ratio * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% threshold). ` +
      `Possible partial sync.`
    );
    return;
  }

  console.log(
    `[Sync] Cleanup ${tableName}: synced ${collectedIds.length} / ${existingCount} D1 rows ` +
    `(${(ratio * 100).toFixed(1)}%) — safe to proceed`
  );

  const validIds = new Set(collectedIds);
  await cleanupOrphans(env, tableName, airtableIdColumn, validIds);
}

// Document types that count for property document_count (matches property-documents-d1.ts)
const PROPERTY_DOC_TYPES = [
  'mineral_deed', 'royalty_deed', 'assignment_of_interest', 'warranty_deed', 'quitclaim_deed',
  'oil_gas_lease', 'extension_agreement', 'amendment', 'ratification', 'release',
  'affidavit', 'probate', 'power_of_attorney', 'judgment',
  'division_order', 'transfer_order', 'revenue_statement', 'check_stub',
  'pooling_order', 'spacing_order', 'occ_order', 'increased_density_order', 'location_exception_order',
  'unitization_order', 'multi_unit_horizontal_order', 'change_of_operator_order', 'well_transfer'
];

/**
 * Reconcile denormalized link counts on the properties table.
 * Runs per-owner to stay within CPU time limits. Logs drift warnings.
 */
async function reconcileLinkCounts(env: any): Promise<void> {
  const start = Date.now();
  const RECONCILE_BUDGET_MS = 120_000; // 2 minutes max for reconciliation

  // Get distinct owners
  const owners = await env.WELLS_DB.prepare(`
    SELECT DISTINCT user_id, organization_id FROM properties
    WHERE user_id IS NOT NULL OR organization_id IS NOT NULL
  `).all();

  if (!owners.results || owners.results.length === 0) {
    console.log('[Reconcile] No properties to reconcile');
    return;
  }

  console.log(`[Reconcile] Reconciling counts for ${owners.results.length} owner(s)`);

  const docTypeList = PROPERTY_DOC_TYPES.map(t => `'${t}'`).join(',');
  let totalUpdated = 0;
  let totalDrift = 0;

  for (const owner of owners.results as any[]) {
    // Time budget check
    if (Date.now() - start > RECONCILE_BUDGET_MS) {
      console.warn(`[Reconcile] Time budget exceeded after ${totalUpdated} properties, will continue next cycle`);
      break;
    }

    const userId = owner.user_id;
    const orgId = owner.organization_id;

    // Build owner WHERE clause
    const ownerWhere = orgId
      ? `(p.organization_id = ? OR p.user_id = ?)`
      : `p.user_id = ?`;
    const ownerParams = orgId ? [orgId, userId] : [userId];

    try {
      // Get current properties with their stored counts
      const props = await env.WELLS_DB.prepare(`
        SELECT id, airtable_record_id, section, township, range,
               well_count, document_count, filing_count
        FROM properties p
        WHERE ${ownerWhere}
      `).bind(...ownerParams).all();

      if (!props.results || props.results.length === 0) continue;

      const propIds = (props.results as any[]).map((p: any) => p.airtable_record_id || p.id);
      const propMap = new Map<string, any>();
      for (const p of props.results as any[]) {
        propMap.set(p.airtable_record_id || p.id, p);
      }

      // 1. Well counts — use owner filter on links table
      const wellMap = new Map<string, number>();
      const ownerLinkWhere = orgId
        ? `(organization_id = ? OR user_id = ?)`
        : `user_id = ?`;
      const wellResult = await env.WELLS_DB.prepare(`
        SELECT property_airtable_id, COUNT(*) as cnt
        FROM property_well_links
        WHERE status IN ('Active', 'Linked') AND ${ownerLinkWhere}
        GROUP BY property_airtable_id
      `).bind(...ownerParams).all();
      for (const r of wellResult.results as any[]) {
        wellMap.set(r.property_airtable_id, r.cnt);
      }

      // 2. Document counts — subquery for owner's property IDs
      const docMap = new Map<string, number>();
      if (propIds.length > 0) {
        // Batch in groups of 30 to stay within param limit
        for (let i = 0; i < propIds.length; i += 30) {
          const batch = propIds.slice(i, i + 30);
          const placeholders = batch.map(() => '?').join(',');
          const docResult = await env.WELLS_DB.prepare(`
            SELECT property_id, COUNT(*) as cnt
            FROM documents
            WHERE property_id IN (${placeholders})
              AND (deleted_at IS NULL OR deleted_at = '')
              AND doc_type IN (${docTypeList})
            GROUP BY property_id
          `).bind(...batch).all();
          for (const r of docResult.results as any[]) {
            docMap.set(r.property_id, r.cnt);
          }
        }
      }

      // 3. Filing counts (direct STR match) — scoped to owner's properties
      const filingMap = new Map<string, number>();
      const filingResult = await env.WELLS_DB.prepare(`
        SELECT p.airtable_record_id as prop_id,
               COUNT(*) as cnt
        FROM properties p
        INNER JOIN occ_docket_entries ode
          ON CAST(ode.section AS INTEGER) = CAST(p.section AS INTEGER)
          AND UPPER(ode.township) = UPPER(p.township)
          AND UPPER(ode.range) = UPPER(p.range)
        WHERE p.section IS NOT NULL AND ${ownerWhere}
        GROUP BY p.airtable_record_id
      `).bind(...ownerParams).all();
      for (const r of filingResult.results as any[]) {
        filingMap.set(r.prop_id, (filingMap.get(r.prop_id) || 0) + r.cnt);
      }

      // 4. Additional sections via junction table
      const addlResult = await env.WELLS_DB.prepare(`
        SELECT p.airtable_record_id as prop_id,
               COUNT(DISTINCT des.case_number) as cnt
        FROM properties p
        INNER JOIN docket_entry_sections des
          ON des.section = CAST(p.section AS TEXT)
          AND des.township = p.township
          AND des.range = p.range
        WHERE p.section IS NOT NULL AND ${ownerWhere}
        GROUP BY p.airtable_record_id
      `).bind(...ownerParams).all();
      for (const r of addlResult.results as any[]) {
        filingMap.set(r.prop_id, (filingMap.get(r.prop_id) || 0) + r.cnt);
      }

      // Build UPDATE statements — only update rows that changed
      const stmts: any[] = [];
      for (const [propId, prop] of propMap) {
        const newWells = wellMap.get(propId) || 0;
        const newDocs = docMap.get(propId) || 0;
        const newFilings = filingMap.get(propId) || 0;

        const currentWells = prop.well_count || 0;
        const currentDocs = prop.document_count || 0;
        const currentFilings = prop.filing_count || 0;

        // Skip if nothing changed
        if (newWells === currentWells && newDocs === currentDocs && newFilings === currentFilings) {
          continue;
        }

        // Drift detection
        if (Math.abs(newWells - currentWells) > 5) {
          console.warn(`[Reconcile] Drift: prop=${propId} well_count was ${currentWells}, now ${newWells}`);
          totalDrift++;
        }

        stmts.push(
          env.WELLS_DB.prepare(
            `UPDATE properties SET well_count = ?, document_count = ?, filing_count = ? WHERE id = ?`
          ).bind(newWells, newDocs, newFilings, prop.id)
        );
      }

      // Execute in D1 batches of 500
      for (let i = 0; i < stmts.length; i += 500) {
        await env.WELLS_DB.batch(stmts.slice(i, i + 500));
      }

      totalUpdated += stmts.length;
    } catch (err) {
      console.error(`[Reconcile] Error for owner user=${userId} org=${orgId}:`, err);
    }
  }

  console.log(`[Reconcile] Done in ${Date.now() - start}ms. Updated ${totalUpdated} properties, ${totalDrift} drift warnings`);
}

async function runPostSync(env: any, cursor: SyncCursor): Promise<void> {
  const totalSynced = cursor.stats.properties.synced + cursor.stats.wells.synced +
    cursor.stats.clientWells.synced + cursor.stats.links.synced;

  // Reconcile denormalized link counts
  try {
    await reconcileLinkCounts(env);
  } catch (error) {
    console.error('[Sync] Link count reconciliation error:', error);
  }

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

  // Auto-match properties to wells (capped to avoid CPU time limit on large sync cycles)
  const MAX_AUTOMATCH_USERS = 5;
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
        ORDER BY unlinked ASC
        LIMIT ?
      `).bind(MAX_AUTOMATCH_USERS).all();

      if (usersWithUnlinked.results.length > 0) {
        console.log(`[Sync] Found ${usersWithUnlinked.results.length} user(s) with unlinked properties (max ${MAX_AUTOMATCH_USERS}), running auto-match`);
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

export async function syncAirtableData(env: any, ctx?: { waitUntil: (p: Promise<any>) => void }): Promise<SyncResult> {
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
      if (ctx) {
        // Fire-and-forget: run post-sync tasks without blocking sync completion
        console.log('[Sync] Launching post-sync tasks (non-blocking via waitUntil)');
        ctx.waitUntil(runPostSync(env, cursor).catch(err =>
          console.error('[Sync] Post-sync task error (non-blocking):', err)
        ));
      } else {
        // No execution context (e.g. manual trigger) — run inline
        console.log('[Sync] Running post-sync tasks (inline, no ctx)');
        await runPostSync(env, cursor);
      }
    }

    // Sync cycle complete
    const result = buildResult(cursor, tickStart);
    console.log(`[Sync] Cycle complete in ${result.duration}ms: ${cursor.stats.properties.synced} props, ${cursor.stats.clientWells.synced} wells, ${cursor.stats.links.synced} links`);

    if (cursor.syncLogId) {
      // Collect any phase errors for the sync log
      const allErrors = [
        ...cursor.stats.properties.errors,
        ...cursor.stats.wells.errors,
        ...cursor.stats.clientWells.errors,
        ...cursor.stats.links.errors,
      ];
      const status = allErrors.length > 0 ? 'completed_with_errors' : 'completed';
      const errorMsg = allErrors.length > 0 ? allErrors.join('; ').slice(0, 500) : null;

      await env.WELLS_DB.prepare(
        `UPDATE sync_log
         SET completed_at = datetime('now'),
             records_synced = ?,
             records_created = ?,
             records_updated = ?,
             error_message = ?,
             status = ?
         WHERE id = ?`
      ).bind(
        cursor.stats.properties.synced + cursor.stats.wells.synced + cursor.stats.clientWells.synced + cursor.stats.links.synced,
        cursor.stats.properties.created + cursor.stats.wells.created + cursor.stats.clientWells.created + cursor.stats.links.created,
        cursor.stats.properties.updated + cursor.stats.wells.updated + cursor.stats.clientWells.updated + cursor.stats.links.updated,
        errorMsg,
        status,
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
