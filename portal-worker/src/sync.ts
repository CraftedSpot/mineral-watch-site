// Airtable configuration
const AIRTABLE_BASE_ID = 'appRBoI9wCy4eOhzd'; // Mineral Watch base
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
    // Get Airtable base ID - hardcoded for now, could be moved to env vars
    const baseId = 'appRBoI9wCy4eOhzd'; // From the Airtable analysis

    // Sync Properties
    console.log('Starting properties sync...');
    const propertiesResult = await syncProperties(env, baseId);
    result.properties = propertiesResult;

    // Sync Wells
    console.log('Starting wells sync...');
    const wellsResult = await syncWells(env, baseId);
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

async function syncProperties(env: any, baseId: string): Promise<SyncResult['properties']> {
  const result: SyncResult['properties'] = { synced: 0, created: 0, updated: 0, errors: [] };
  
  try {
    // Sync from Client Properties table (simpler structure)
    // Fields: COUNTY, SEC, TWN, RNG, ACRES, NET ACRES, Notes, User
    const response = { records: [] };
    console.log('Note: Airtable MCP integration needs to be configured');
    
    // TODO: Replace with actual MCP Airtable call
    // Example: const response = await mcp__airtable__list_records({
    //   baseId: baseId,
    //   tableId: 'tblbexFvBkow2ErYm', // Client Properties table
    //   maxRecords: 1000
    // });

    if (!response.records) {
      throw new Error('No records returned from Airtable');
    }

    // Process each property
    for (const record of response.records) {
      try {
        const fields = record.fields || {};
        
        // Check if record exists
        const existing = await env.WELLS_DB.prepare(
          'SELECT id FROM properties WHERE airtable_record_id = ?'
        ).bind(record.id).first();

        const data = {
          airtable_record_id: record.id,
          county: fields.COUNTY || null,
          section: fields.SEC || null,
          township: fields.TWN || null,
          range: fields.RNG || null,
          acres: parseNumber(fields.ACRES),
          net_acres: parseNumber(fields['NET ACRES']),
          notes: fields.Notes || null,
          owner: fields['User']?.[0] || null, // Linked field with null check
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
            `UPDATE properties SET ${updateFields.join(', ')} WHERE airtable_record_id = ?`
          ).bind(...updateValues, record.id).run();
          
          result.updated++;
        } else {
          // Insert new record
          const id = generateId();
          const columns = ['id', ...Object.keys(data)];
          const placeholders = columns.map(() => '?').join(', ');
          const values = [id, ...Object.values(data)];
          
          await env.WELLS_DB.prepare(
            `INSERT INTO properties (${columns.join(', ')}) VALUES (${placeholders})`
          ).bind(...values).run();
          
          result.created++;
        }
        
        result.synced++;
      } catch (error) {
        result.errors.push(`Property ${record.id}: ${error.message}`);
        console.error(`Error syncing property ${record.id}:`, error);
      }
    }
  } catch (error) {
    result.errors.push(`Properties sync failed: ${error.message}`);
    throw error;
  }
  
  return result;
}

async function syncWells(env: any, baseId: string): Promise<SyncResult['wells']> {
  const result: SyncResult['wells'] = { synced: 0, created: 0, updated: 0, errors: [] };
  
  try {
    // Since we're using MCP, we need to call the Airtable tools differently
    // For now, we'll return a placeholder response
    // In production, you would use the MCP Airtable integration
    const response = { records: [] };
    console.log('Note: Airtable MCP integration needs to be configured');
    
    // TODO: Replace with actual MCP Airtable call
    // Example: const response = await mcp__airtable__list_records({
    //   baseId: baseId,
    //   tableId: 'tblqWp3rb7rT3p9SA',
    //   maxRecords: 1000
    // });

    if (!response.records) {
      throw new Error('No records returned from Airtable');
    }

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
  } catch (error) {
    result.errors.push(`Wells sync failed: ${error.message}`);
    throw error;
  }
  
  return result;
}