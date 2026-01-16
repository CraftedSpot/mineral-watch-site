import { fetchWellDetailsFromOCC } from './handlers/wells.js';

// Airtable configuration
const AIRTABLE_BASE_ID = 'app3j3X29Uvp5stza'; // Mineral Watch Oklahoma base
const PROPERTIES_TABLE_ID = 'tblbexFvBkow2ErYm'; // 📍 Client Properties
const WELLS_TABLE_ID = 'tblqWp3rb7rT3p9SA'; // 🛢️ Client Wells
const LINKS_TABLE_ID = 'tblcLilnMgeXvxXKT'; // 🔗 Property-Well Links

// D1 batch configuration
const BATCH_SIZE = 500; // Max statements per batch to stay within limits

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
}

interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
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


// Convert Airtable date to SQL date
function formatDate(dateString: string | null): string | null {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// Convert Airtable number to SQL number
function parseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

// Convert Airtable boolean to SQL boolean
function parseBoolean(value: any): number {
  return value ? 1 : 0;
}

// Fetch records from Airtable API
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

export async function syncAirtableData(env: any): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    properties: { synced: 0, created: 0, updated: 0, errors: [] },
    wells: { synced: 0, created: 0, updated: 0, errors: [] },
    clientWells: { synced: 0, created: 0, updated: 0, errors: [] },
    links: { synced: 0, created: 0, updated: 0, errors: [] },
    duration: 0
  };

  // Log sync start
  const syncLogResult = await env.WELLS_DB.prepare(
    'INSERT INTO sync_log (sync_type, status) VALUES (?, ?) RETURNING id'
  ).bind('full', 'running').first();
  const syncLogId = syncLogResult?.id;

  try {
    // Check if API key is available
    if (!env.MINERAL_AIRTABLE_API_KEY) {
      throw new Error('MINERAL_AIRTABLE_API_KEY not configured');
    }

    // Sync Properties
    console.log('Starting properties sync...');
    const propertiesResult = await syncProperties(env);
    result.properties = propertiesResult;

    // Sync Wells (OCC wells matching by API number)
    console.log('Starting wells sync...');
    const wellsResult = await syncWells(env);
    result.wells = wellsResult;

    // Sync Client Wells (full mirror from Airtable)
    console.log('Starting client wells sync...');
    const clientWellsResult = await syncClientWells(env);
    result.clientWells = clientWellsResult;

    // Sync Property-Well Links
    console.log('Starting property-well links sync...');
    const linksResult = await syncPropertyWellLinks(env);
    result.links = linksResult;

    // Calculate duration
    result.duration = Date.now() - startTime;

    // Update sync log
    if (syncLogId) {
      await env.WELLS_DB.prepare(
        `UPDATE sync_log
         SET completed_at = datetime('now'),
             records_synced = ?,
             records_created = ?,
             records_updated = ?,
             status = 'completed'
         WHERE id = ?`
      ).bind(
        result.properties.synced + result.wells.synced + (result.clientWells?.synced || 0) + (result.links?.synced || 0),
        result.properties.created + result.wells.created + (result.clientWells?.created || 0) + (result.links?.created || 0),
        result.properties.updated + result.wells.updated + (result.clientWells?.updated || 0) + (result.links?.updated || 0),
        syncLogId
      ).run();
    }

    // After sync completes, trigger document re-linking
    if (env.DOCUMENTS_WORKER && (result.properties.synced > 0 || result.wells.synced > 0)) {
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
          const relinkResult = await relinkResponse.json();
          console.log(`[Sync] Document re-linking complete: ${relinkResult.linked} documents linked`);
        } else {
          console.error('[Sync] Document re-linking failed:', await relinkResponse.text());
        }
      } catch (error) {
        console.error('[Sync] Error triggering document re-linking:', error);
        // Don't throw - sync was successful even if re-linking failed
      }
    }

    return result;
  } catch (error) {
    // Update sync log with error
    if (syncLogId) {
      await env.WELLS_DB.prepare(
        `UPDATE sync_log 
         SET completed_at = datetime('now'), 
             error_message = ?,
             status = 'failed'
         WHERE id = ?`
      ).bind(error.message, syncLogId).run();
    }
    throw error;
  }
}

async function syncProperties(env: any): Promise<SyncResult['properties']> {
  const result: SyncResult['properties'] = { synced: 0, created: 0, updated: 0, errors: [] };
  let allRecords: AirtableRecord[] = [];
  let offset: string | undefined;
  
  try {
    // First, fetch ALL records from Airtable (just a few API calls)
    do {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        PROPERTIES_TABLE_ID,
        offset
      );

      console.log(`Fetched ${response.records.length} properties${offset ? ' (continued)' : ''}`);
      allRecords = allRecords.concat(response.records);
      offset = response.offset;
    } while (offset);

    console.log(`Total properties to sync: ${allRecords.length}`);

    if (allRecords.length === 0) {
      return result;
    }

    // Prepare batch statements
    const statements = allRecords.map(record => {
      const id = `prop_${record.id}`;
      const fields = record.fields || {};

      return env.WELLS_DB.prepare(`
        INSERT INTO properties (id, airtable_record_id, county, section, township, range, meridian, acres, net_acres, notes, owner, group_name, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(airtable_record_id) DO UPDATE SET
          county = excluded.county,
          section = excluded.section,
          township = excluded.township,
          range = excluded.range,
          meridian = excluded.meridian,
          acres = excluded.acres,
          net_acres = excluded.net_acres,
          notes = excluded.notes,
          owner = excluded.owner,
          group_name = excluded.group_name,
          synced_at = CURRENT_TIMESTAMP
      `).bind(
        id,
        record.id,
        fields.COUNTY || null,
        fields.SEC || null,
        fields.TWN || null,
        fields.RNG || null,
        fields.MERIDIAN || null,
        parseNumber(fields.ACRES),
        parseNumber(fields['NET ACRES']),
        fields.Notes || null,
        fields['User']?.[0] || null,
        fields.Group || null
      );
    });

    // Execute statements in chunks
    console.log(`Executing batch insert/update for ${statements.length} properties...`);
    
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      const chunkEnd = Math.min(i + BATCH_SIZE, statements.length);
      console.log(`Processing properties ${i + 1}-${chunkEnd} of ${statements.length}`);
      
      await env.WELLS_DB.batch(chunk);
    }
    
    // Count results
    result.synced = allRecords.length;
    // Since we're using UPSERT, we can't easily distinguish creates vs updates
    // Just report total synced
    result.created = 0;
    result.updated = result.synced;
    
  } catch (error) {
    result.errors.push(`Properties sync failed: ${error.message}`);
    console.error('Properties sync error:', error);
    // Don't throw - let wells sync continue
  }
  
  return result;
}

/**
 * Sync Client Wells from Airtable to D1 client_wells table
 * This creates a full mirror of the Airtable Client Wells table
 */
async function syncClientWells(env: any): Promise<SyncResult['clientWells']> {
  const result: SyncResult['clientWells'] = { synced: 0, created: 0, updated: 0, errors: [] };
  let allRecords: AirtableRecord[] = [];
  let offset: string | undefined;

  try {
    // Fetch ALL Client Well records from Airtable
    do {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        WELLS_TABLE_ID,
        offset
      );

      console.log(`Fetched ${response.records.length} client wells${offset ? ' (continued)' : ''}`);
      allRecords = allRecords.concat(response.records);
      offset = response.offset;
    } while (offset);

    console.log(`Total client wells to sync: ${allRecords.length}`);

    if (allRecords.length === 0) {
      return result;
    }

    // Prepare batch statements for UPSERT
    const statements = allRecords.map(record => {
      const id = `cwell_${record.id}`;
      const fields = record.fields || {};

      // Extract linked record IDs
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
          well_name = excluded.well_name,
          operator = excluded.operator,
          county = excluded.county,
          section = excluded.section,
          township = excluded.township,
          range_val = excluded.range_val,
          well_type = excluded.well_type,
          well_status = excluded.well_status,
          spud_date = excluded.spud_date,
          completion_date = excluded.completion_date,
          first_production_date = excluded.first_production_date,
          ip_oil = excluded.ip_oil,
          ip_gas = excluded.ip_gas,
          ip_water = excluded.ip_water,
          formation_name = excluded.formation_name,
          total_depth = excluded.total_depth,
          lateral_length = excluded.lateral_length,
          is_horizontal = excluded.is_horizontal,
          bh_section = excluded.bh_section,
          bh_township = excluded.bh_township,
          bh_range = excluded.bh_range,
          occ_map_link = excluded.occ_map_link,
          notes = excluded.notes,
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
    });

    // Execute statements in chunks
    console.log(`Executing batch insert/update for ${statements.length} client wells...`);

    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      const chunkEnd = Math.min(i + BATCH_SIZE, statements.length);
      console.log(`Processing client wells ${i + 1}-${chunkEnd} of ${statements.length}`);

      await env.WELLS_DB.batch(chunk);
    }

    // Count results
    result.synced = allRecords.length;
    result.created = 0; // Can't distinguish with UPSERT
    result.updated = result.synced;

    console.log(`[Sync] Successfully synced ${result.synced} client wells to D1`);

  } catch (error) {
    result.errors.push(`Client wells sync failed: ${error.message}`);
    console.error('Client wells sync error:', error);
    // Don't throw - let other syncs continue
  }

  return result;
}

async function syncWells(env: any): Promise<SyncResult['wells']> {
  const result: SyncResult['wells'] = { synced: 0, created: 0, updated: 0, errors: [] };
  let allRecords: AirtableRecord[] = [];
  let offset: string | undefined;
  
  try {
    // First, fetch ALL records from Airtable (just a few API calls)
    do {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        WELLS_TABLE_ID,
        offset
      );

      console.log(`Fetched ${response.records.length} wells${offset ? ' (continued)' : ''}`);
      allRecords = allRecords.concat(response.records);
      offset = response.offset;
    } while (offset);

    console.log(`Total wells to sync: ${allRecords.length}`);

    if (allRecords.length === 0) {
      return result;
    }

    // Process each well individually to handle update vs insert logic
    for (const record of allRecords) {
      try {
        const fields = record.fields || {};
        const apiNumber = fields['API Number'];
        
        if (!apiNumber) {
          result.errors.push(`Well ${record.id}: Missing API number`);
          continue;
        }

        // Extract user tracking fields
        const userId = fields['User']?.[0] || null;
        const orgId = fields['Organization']?.[0] || null;
        const status = fields['Status']?.name || fields['Status'] || null;
        
        // Log raw Airtable fields for debugging
        console.log(`[Sync] Raw Airtable fields for ${apiNumber}:`, JSON.stringify(fields, null, 2));

        // First, check if we need to add the missing columns to the wells table
        // Try to update existing well with user tracking info
        const updateResult = await env.WELLS_DB.prepare(`
          UPDATE wells SET
            airtable_record_id = ?,
            status = ?,
            synced_at = CURRENT_TIMESTAMP
          WHERE api_number = ?
        `).bind(
          record.id,
          status,
          apiNumber
        ).run();

        if (updateResult.meta.changes > 0) {
          result.updated++;
        } else {
          // Well not in D1 yet - fetch from OCC API before inserting
          console.log(`[Sync] Well ${apiNumber} not in D1, fetching from OCC...`);
          
          // Try to fetch well details from OCC
          const occData = await fetchWellDetailsFromOCC(apiNumber, env);
          
          if (occData) {
            console.log(`[Sync] Found well ${apiNumber} in OCC: ${occData.wellName}`);
            
            // Log all values before insert
            const insertValues = {
              api_number: apiNumber,
              airtable_record_id: record.id,
              well_name: occData.wellName || fields['Well Name'] || null,
              well_number: null,
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
              // Additional numeric fields
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
            
            console.log(`[Sync] INSERT values for well ${apiNumber}:`, JSON.stringify(insertValues, null, 2));
            console.log(`[Sync] Type check - section: ${typeof insertValues.section}, lat: ${typeof insertValues.latitude}, formation_depth: ${typeof insertValues.formation_depth}`);
            
            // Insert with OCC data
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
              insertValues.api_number,
              insertValues.airtable_record_id,
              insertValues.well_name,
              insertValues.well_number,
              insertValues.operator,
              insertValues.county,
              insertValues.section,
              insertValues.township,
              insertValues.range,
              insertValues.meridian,
              insertValues.latitude,
              insertValues.longitude,
              insertValues.status,
              insertValues.well_status,
              insertValues.well_type,
              insertValues.spud_date,
              insertValues.completion_date,
              insertValues.bh_latitude,
              insertValues.bh_longitude,
              insertValues.lateral_length,
              insertValues.formation_name,
              insertValues.formation_depth,
              insertValues.true_vertical_depth,
              insertValues.measured_total_depth,
              insertValues.ip_oil_bbl,
              insertValues.ip_gas_mcf,
              insertValues.ip_water_bbl
            ).run();
            
            console.log(`[Sync] Inserted well ${apiNumber} with OCC data`);
            result.created++;
          } else {
            console.log(`[Sync] Well ${apiNumber} not found in OCC, inserting with Airtable data only`);
            
            // Extract well name and number from the combined field
            const fullWellName = fields['Well Name'] || '';
            let wellName = fullWellName;
            let wellNumber = null;
            
            // Try to extract well number from patterns like "PENN MUTUAL LIFE #1"
            const wellMatch = fullWellName.match(/^(.+?)\s+(#\d+(?:-?\w+)?)$/);
            if (wellMatch) {
              wellName = wellMatch[1].trim();
              wellNumber = wellMatch[2];
            } else {
              // Try without # prefix: "SMITH 1"
              const noHashMatch = fullWellName.match(/^(.+?)\s+(\d+(?:-?\w+)?)$/);
              if (noHashMatch) {
                wellName = noHashMatch[1].trim();
                wellNumber = `#${noHashMatch[2]}`;
              }
            }
            
            // Log values before fallback insert
            const fallbackInsertValues = {
              api_number: apiNumber,
              airtable_record_id: record.id,
              well_name: wellName,
              well_number: wellNumber,
              operator: fields.Operator || null,
              county: fields.County || null,
              section: fields.Section ? parseInt(fields.Section, 10) : null,
              township: fields.Township || null,
              range: fields.Range || null,
              status: status,
              well_status: fields['Well Status'] || null
            };
            
            console.log(`[Sync] Fallback INSERT values for well ${apiNumber}:`, JSON.stringify(fallbackInsertValues, null, 2));
            
            // Fall back to minimal insert with Airtable data
            await env.WELLS_DB.prepare(`
              INSERT INTO wells (
                api_number, airtable_record_id, well_name, well_number, operator, 
                county, section, township, range, meridian,
                status, well_status, created_at, synced_at
              )
              VALUES (?, ?, ?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, 'IM', ?, ?, datetime('now'), CURRENT_TIMESTAMP)
            `).bind(
              fallbackInsertValues.api_number,
              fallbackInsertValues.airtable_record_id,
              fallbackInsertValues.well_name,
              fallbackInsertValues.well_number,
              fallbackInsertValues.operator,
              fallbackInsertValues.county,
              fallbackInsertValues.section,
              fallbackInsertValues.township,
              fallbackInsertValues.range,
              fallbackInsertValues.status,
              fallbackInsertValues.well_status
            ).run();
            
            console.log(`[Sync] Inserted well ${apiNumber} with Airtable data only`);
            result.created++;
          }
        }
        
        result.synced++;
      } catch (error) {
        result.errors.push(`Well ${record.id}: ${error.message}`);
        console.error(`Error syncing well ${record.id}:`, error);
      }
    }
    
  } catch (error) {
    result.errors.push(`Wells sync failed: ${error.message}`);
    console.error('Wells sync error:', error);
    // Don't throw - let properties results be returned
  }
  
  return result;
}

async function syncPropertyWellLinks(env: any): Promise<SyncResult['links']> {
  const result: SyncResult['links'] = { synced: 0, created: 0, updated: 0, errors: [] };
  let allRecords: AirtableRecord[] = [];
  let offset: string | undefined;
  
  try {
    // Fetch ALL link records from Airtable
    do {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        LINKS_TABLE_ID,
        offset
      );

      console.log(`Fetched ${response.records.length} property-well links${offset ? ' (continued)' : ''}`);
      allRecords = allRecords.concat(response.records);
      offset = response.offset;
    } while (offset);

    console.log(`Total property-well links to sync: ${allRecords.length}`);

    if (allRecords.length === 0) {
      return result;
    }

    // Prepare batch statements
    const statements = allRecords.map(record => {
      const id = `link_${record.id}`;
      const fields = record.fields || {};
      
      // Extract IDs from linked record arrays
      const propertyId = fields['Property']?.[0] || null;
      const wellId = fields['Well']?.[0] || null;
      const userId = fields['User']?.[0] || null;
      const orgId = fields['Organization']?.[0] || null;
      
      if (!propertyId || !wellId) {
        console.warn(`[Sync] Link ${record.id} missing property or well ID`);
        return null;
      }
      
      return env.WELLS_DB.prepare(`
        INSERT INTO property_well_links (
          id, airtable_record_id, property_airtable_id, well_airtable_id,
          match_reason, status, confidence_score,
          user_id, organization_id,
          created_at, rejected_date, synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(airtable_record_id) DO UPDATE SET
          property_airtable_id = excluded.property_airtable_id,
          well_airtable_id = excluded.well_airtable_id,
          match_reason = excluded.match_reason,
          status = excluded.status,
          confidence_score = excluded.confidence_score,
          user_id = excluded.user_id,
          organization_id = excluded.organization_id,
          rejected_date = excluded.rejected_date,
          synced_at = CURRENT_TIMESTAMP
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
        formatDate(record.createdTime),
        fields['Status'] === 'Rejected' ? formatDate(fields['Rejected Date']) : null
      );
    }).filter(stmt => stmt !== null); // Remove any null statements

    // Execute statements in chunks
    console.log(`Executing batch insert/update for ${statements.length} property-well links...`);
    
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      const chunkEnd = Math.min(i + BATCH_SIZE, statements.length);
      console.log(`Processing links ${i + 1}-${chunkEnd} of ${statements.length}`);
      
      await env.WELLS_DB.batch(chunk);
    }
    
    result.synced = statements.length;
    result.created = 0; // We're using UPSERT
    result.updated = result.synced;
    
    console.log(`[Sync] Successfully synced ${result.synced} property-well links`);
    
  } catch (error) {
    result.errors.push(`Links sync failed: ${error.message}`);
    console.error('Property-well links sync error:', error);
    // Don't throw - let other syncs complete
  }
  
  return result;
}