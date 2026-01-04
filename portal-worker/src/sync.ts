// Airtable configuration
const AIRTABLE_BASE_ID = 'app3j3X29Uvp5stza'; // Mineral Watch Oklahoma base
const PROPERTIES_TABLE_ID = 'tblbexFvBkow2ErYm'; // 📍 Client Properties
const WELLS_TABLE_ID = 'tblqWp3rb7rT3p9SA'; // 🛢️ Client Wells

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

    // Execute all statements in one batch
    console.log(`Executing batch insert/update for ${statements.length} properties...`);
    const batchResults = await env.WELLS_DB.batch(statements);
    
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
  let offset: string | undefined;
  
  try {
    // Paginate through all records
    do {
      const response = await fetchAirtableRecords(
        env.MINERAL_AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        WELLS_TABLE_ID,
        offset
      );

      console.log(`Fetched ${response.records.length} wells${offset ? ' (continued)' : ''}`);

      // Process each well
      for (const record of response.records) {
        try {
          const fields = record.fields || {};
          
          // Check if record exists
          const existing = await env.WELLS_DB.prepare(
            'SELECT id FROM wells WHERE airtable_record_id = ? OR api_number = ?'
          ).bind(record.id, fields['API Number']).first();

          const data = {
            airtable_record_id: record.id,
            api_number: fields['API Number'] || null,
            well_name: fields['Well Name'] || null,
            operator: fields.Operator || null,
            status: fields.Status || null,
            well_status: fields['Well Status'] || null,
            well_type: null, // Not in Client Wells table
            county: fields.County || null,
            section: fields.Section || null,
            township: fields.Township || null,
            range: fields.Range || null,
            formation_name: fields['Formation Name'] || null,
            spud_date: formatDate(fields['Spud Date']),
            completion_date: formatDate(fields['Completion Date']),
            first_production_date: formatDate(fields['First Production Date']),
            data_last_updated: fields['Data Last Updated'] || null,
            last_rbdms_sync: fields['Last RBDMS Sync'] || null,
            synced_at: new Date().toISOString()
          };

          if (existing) {
            // Update existing record
            const updateFields = Object.entries(data)
              .filter(([key]) => key !== 'airtable_record_id')
              .map(([key]) => `${key} = ?`);
            
            const updateValues = Object.entries(data)
              .filter(([key]) => key !== 'airtable_record_id')
              .map(([, value]) => value);
            
            await env.WELLS_DB.prepare(
              `UPDATE wells SET ${updateFields.join(', ')} WHERE airtable_record_id = ? OR api_number = ?`
            ).bind(...updateValues, record.id, fields['API Number']).run();
            
            result.updated++;
          } else {
            // Insert new record
            const id = generateId();
            const columns = ['id', ...Object.keys(data)];
            const placeholders = columns.map(() => '?').join(', ');
            const values = [id, ...Object.values(data)];
            
            await env.WELLS_DB.prepare(
              `INSERT INTO wells (${columns.join(', ')}) VALUES (${placeholders})`
            ).bind(...values).run();
            
            result.created++;
          }
          
          result.synced++;
        } catch (error) {
          result.errors.push(`Well ${record.id}: ${error.message}`);
          console.error(`Error syncing well ${record.id}:`, error);
        }
      }

      // Set offset for next page
      offset = response.offset;
    } while (offset);
    
  } catch (error) {
    result.errors.push(`Wells sync failed: ${error.message}`);
    console.error('Wells sync error:', error);
    // Don't throw - let properties results be returned
  }
  
  return result;
}