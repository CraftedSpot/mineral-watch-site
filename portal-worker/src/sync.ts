interface AirtableConfig {
  baseId: string;
  apiKey?: string;
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
    // Fetch properties from Airtable
    const response = await env.AIRTABLE.list_records({
      baseId: baseId,
      tableId: 'tblKKJes2zDIqcGrO', // Properties table ID
      maxRecords: 1000 // Adjust as needed
    });

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
          file_number: fields.FILE || null,
          group_name: fields.GROUP || null,
          legal_description: fields.LEGAL || null,
          section: fields.SEC || null,
          township: fields.TWN || null,
          range: fields.RNG || null,
          county: fields.COUNTY || null,
          meridian: fields.MERIDIAN || null,
          quarter: fields.QUARTER || null,
          acres: parseNumber(fields.ACRES),
          acres_open: parseNumber(fields['ACRES OPEN']),
          leased: parseNumber(fields.LEASED),
          lease_expiration: formatDate(fields['L-EXP']),
          production_ri: parseNumber(fields['Prod RI']),
          production_wi: parseNumber(fields['Prod WI']),
          net_mineral_acres: null, // Calculate if needed
          owner: fields['User (Owner)'] ? fields['User (Owner)'][0] : null, // Linked field
          operator: fields.Operator || null,
          notes: fields.Notes || null,
          fraction: fields.FRACTION || null,
          depth_clause: parseBoolean(fields['DEPTH CLAUSE']),
          decimal_interest: fields['Decimal Interest'] || null,
          geometry_data: fields.Geometry_Data || null,
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
    // Fetch wells from Airtable (Client Wells table)
    const response = await env.AIRTABLE.list_records({
      baseId: baseId,
      tableId: 'tblqWp3rb7rT3p9SA', // Client Wells table ID
      maxRecords: 1000 // Adjust as needed
    });

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