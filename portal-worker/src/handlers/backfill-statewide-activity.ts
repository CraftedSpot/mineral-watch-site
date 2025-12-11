/**
 * Backfill Statewide Activity Handler
 * 
 * Processes existing Well Locations and Activity records to populate Statewide Activity table
 */

import { BASE_ID, WELL_LOCATIONS_TABLE, ACTIVITY_TABLE } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

const STATEWIDE_ACTIVITY_TABLE = 'tblbM8kwkRyFS9eaj';

/**
 * Backfill statewide activity from existing Well Locations and Activity records
 */
export async function handleBackfillStatewideActivity(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Only allow admins to run backfill
  if (user.email !== 'james@mymineralwatch.com') {
    return jsonResponse({ error: "Admin access required" }, 403);
  }
  
  try {
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    // 1. Process Well Locations table (has coordinates)
    console.log('[Backfill] Processing Well Locations...');
    const wellLocations = await fetchAllRecords(env, WELL_LOCATIONS_TABLE);
    
    for (const record of wellLocations) {
      const fields = record.fields;
      
      // Skip if no coordinates
      if (!fields.Latitude || !fields.Longitude) {
        skipped++;
        continue;
      }
      
      // Skip tracked wells - we only want permits/completions
      if (fields['Well Type'] === 'Tracked Well') {
        skipped++;
        continue;
      }
      
      try {
        // Create statewide activity record
        const activityType = fields['Activity Type'] || 'Permit';
        const activityData = {
          'API Number': fields['API Number'],
          'Activity Type': activityType,
          'Has Permit': activityType === 'Permit' || activityType === 'New Permit',
          'Has Completion': activityType === 'Completion' || activityType === 'Well Completed',
          'Well Name': fields['Well Name'],
          'Operator': fields['Operator'],
          'County': fields['County'],
          'Section': fields['Section'],
          'Township': fields['Township'],
          'Range': fields['Range'],
          'PM': fields['PM'] || 'IM',
          'Latitude': fields['Latitude'],
          'Longitude': fields['Longitude'],
          'OCC Map Link': fields['OCC Map Link'],
          'Created Time': fields['Created At'] || fields['Detected At'] || new Date().toISOString()
        };
        
        await createStatewideActivity(env, activityData);
        created++;
        
        if (created % 10 === 0) {
          console.log(`[Backfill] Progress: ${created} created, ${skipped} skipped`);
        }
      } catch (err) {
        console.error(`[Backfill] Error processing well location ${fields['API Number']}:`, err);
        errors++;
      }
    }
    
    // 2. Process Activity table for any records with coordinates
    console.log('[Backfill] Processing Activity records...');
    const activities = await fetchAllRecords(env, ACTIVITY_TABLE);
    
    for (const record of activities) {
      const fields = record.fields;
      
      // Skip if no coordinates
      if (!fields.Latitude || !fields.Longitude) {
        skipped++;
        continue;
      }
      
      try {
        // Check if already exists (by API number)
        const exists = await checkIfExists(env, fields['API Number']);
        if (exists) {
          skipped++;
          continue;
        }
        
        // Create statewide activity record
        const isPermit = fields['Activity Type'] === 'New Permit';
        const isCompletion = fields['Activity Type'] === 'Well Completed';
        const activityData = {
          'API Number': fields['API Number'],
          'Activity Type': isPermit ? 'Permit' : 'Completion',
          'Has Permit': isPermit,
          'Has Completion': isCompletion,
          'Well Name': fields['Well Name'],
          'Operator': fields['Operator'],
          'County': fields['County'],
          'Section': fields['Section']?.replace('S', ''),
          'Township': fields['Township']?.replace('T', '').replace('N', '').replace('S', ''),
          'Range': fields['Range']?.replace('R', '').replace('E', '').replace('W', ''),
          'PM': 'IM', // Default
          'Latitude': fields['Latitude'],
          'Longitude': fields['Longitude'],
          'OCC Map Link': fields['OCC Map Link'],
          'Created Time': fields['Detected At'] || new Date().toISOString()
        };
        
        await createStatewideActivity(env, activityData);
        created++;
        
        if (created % 10 === 0) {
          console.log(`[Backfill] Progress: ${created} created, ${skipped} skipped`);
        }
      } catch (err) {
        console.error(`[Backfill] Error processing activity ${fields['API Number']}:`, err);
        errors++;
      }
    }
    
    const summary = {
      created,
      skipped,
      errors,
      wellLocationsProcessed: wellLocations.length,
      activitiesProcessed: activities.length
    };
    
    console.log('[Backfill] Complete:', summary);
    return jsonResponse(summary);
    
  } catch (error) {
    console.error('[Backfill] Error:', error);
    return jsonResponse({ error: 'Backfill failed', details: error.message }, 500);
  }
}

async function fetchAllRecords(env: Env, table: string) {
  const records: any[] = [];
  let offset = '';
  
  while (true) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch records: ${response.status}`);
    }
    
    const data = await response.json();
    records.push(...(data.records || []));
    
    if (!data.offset) break;
    offset = data.offset;
  }
  
  return records;
}

async function checkIfExists(env: Env, apiNumber: string) {
  const formula = `{API Number} = "${apiNumber}"`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(STATEWIDE_ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) return false;
  
  const data = await response.json();
  return data.records && data.records.length > 0;
}

async function createStatewideActivity(env: Env, fields: any) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(STATEWIDE_ACTIVITY_TABLE)}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create record: ${error}`);
  }
  
  return response.json();
}