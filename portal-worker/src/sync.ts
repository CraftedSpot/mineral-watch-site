// Airtable configuration
const AIRTABLE_BASE_ID = 'app3j3X29Uvp5stza'; // Mineral Watch Oklahoma base
const PROPERTIES_TABLE_ID = 'tblbexFvBkow2ErYm'; // 📍 Client Properties
const WELLS_TABLE_ID = 'tblqWp3rb7rT3p9SA'; // 🛢️ Client Wells

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
  duration: number;
}

// Generate a UUID for new records
function generateId(): string {
  return crypto.randomUUID();
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

    // Sync Wells
    console.log('Starting wells sync...');
    const wellsResult = await syncWells(env);
    result.wells = wellsResult;

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
        result.properties.synced + result.wells.synced,
        result.properties.created + result.wells.created,
        result.properties.updated + result.wells.updated,
        syncLogId
      ).run();
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
        INSERT INTO properties (id, airtable_record_id, county, section, township, range, acres, net_acres, notes, owner, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(airtable_record_id) DO UPDATE SET
          county = excluded.county,
          section = excluded.section,
          township = excluded.township,
          range = excluded.range,
          acres = excluded.acres,
          net_acres = excluded.net_acres,
          notes = excluded.notes,
          owner = excluded.owner,
          synced_at = CURRENT_TIMESTAMP
      `).bind(
        id,
        record.id,
        fields.COUNTY || null,
        fields.SEC || null,
        fields.TWN || null,
        fields.RNG || null,
        parseNumber(fields.ACRES),
        parseNumber(fields['NET ACRES']),
        fields.Notes || null,
        fields['User']?.[0] || null
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

    // Prepare batch statements
    const statements = allRecords.map(record => {
      const id = `well_${record.id}`;
      const fields = record.fields || {};
      
      return env.WELLS_DB.prepare(`
        INSERT INTO wells (
          id, airtable_record_id, api_number, well_name, operator, status, 
          well_status, well_type, county, section, township, range, 
          formation_name, spud_date, completion_date, first_production_date,
          data_last_updated, last_rbdms_sync, synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(airtable_record_id) DO UPDATE SET
          api_number = excluded.api_number,
          well_name = excluded.well_name,
          operator = excluded.operator,
          status = excluded.status,
          well_status = excluded.well_status,
          well_type = excluded.well_type,
          county = excluded.county,
          section = excluded.section,
          township = excluded.township,
          range = excluded.range,
          formation_name = excluded.formation_name,
          spud_date = excluded.spud_date,
          completion_date = excluded.completion_date,
          first_production_date = excluded.first_production_date,
          data_last_updated = excluded.data_last_updated,
          last_rbdms_sync = excluded.last_rbdms_sync,
          synced_at = CURRENT_TIMESTAMP
      `).bind(
        id,
        record.id,
        fields['API Number'] || null,
        fields['Well Name'] || null,
        fields.Operator || null,
        fields.Status || null,
        fields['Well Status'] || null,
        null, // well_type - Not in Client Wells table
        fields.County || null,
        fields.Section || null,
        fields.Township || null,
        fields.Range || null,
        fields['Formation Name'] || null,
        formatDate(fields['Spud Date']),
        formatDate(fields['Completion Date']),
        formatDate(fields['First Production Date']),
        fields['Data Last Updated'] || null,
        fields['Last RBDMS Sync'] || null
      );
    });

    // Execute statements in chunks
    console.log(`Executing batch insert/update for ${statements.length} wells...`);
    
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      const chunkEnd = Math.min(i + BATCH_SIZE, statements.length);
      console.log(`Processing wells ${i + 1}-${chunkEnd} of ${statements.length}`);
      
      await env.WELLS_DB.batch(chunk);
    }
    
    // Count results
    result.synced = allRecords.length;
    // Since we're using UPSERT, we can't easily distinguish creates vs updates
    // Just report total synced
    result.created = 0;
    result.updated = result.synced;
    
  } catch (error) {
    result.errors.push(`Wells sync failed: ${error.message}`);
    console.error('Wells sync error:', error);
    // Don't throw - let properties results be returned
  }
  
  return result;
}