/**
 * Handler to backfill Well Locations table from Activity Log and tracked wells
 * This creates a single record per well with location data we can extract
 */

import { WELL_LOCATIONS_TABLE, BASE_ID, ACTIVITY_TABLE, WELLS_TABLE } from '../constants.js';
import { fetchAllAirtableRecords } from '../services/airtable.js';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Simple normalization functions
function normalizeAPI(apiNumber) {
  if (!apiNumber) return null;
  // Remove any non-digit characters
  const cleaned = apiNumber.toString().replace(/\D/g, '');
  // Take first 10 digits
  return cleaned.substring(0, 10);
}

function normalizeSection(section) {
  if (!section) return null;
  // Remove leading zeros
  return parseInt(section, 10).toString();
}

// Parse TRS from "S1 T14N R12W" format
function parseTRS(trsString) {
  if (!trsString) return null;
  
  const match = trsString.match(/S(\d+)\s+T(\d+[NS])\s+R(\d+[EW])/i);
  if (!match) return null;
  
  return {
    section: normalizeSection(match[1]),
    township: match[2].toUpperCase(),
    range: match[3].toUpperCase()
  };
}

/**
 * Create or update a well location record
 */
async function upsertWellLocation(env, wellData) {
  const { apiNumber, ...locationData } = wellData;
  
  // First check if record exists
  const existingUrl = new URL(`${AIRTABLE_API_BASE}/${BASE_ID}/${WELL_LOCATIONS_TABLE}`);
  existingUrl.searchParams.set('filterByFormula', `{API Number} = "${apiNumber}"`);
  existingUrl.searchParams.set('maxRecords', '1');
  
  console.log(`[Backfill] Checking for existing record: ${apiNumber}`);
  
  const existingResponse = await fetch(existingUrl.toString(), {
    headers: {
      'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  const existingData = await existingResponse.json();
  
  if (existingData.records && existingData.records.length > 0) {
    // Update existing record - only update fields that have values
    const recordId = existingData.records[0].id;
    const updateUrl = `${AIRTABLE_API_BASE}/${BASE_ID}/${WELL_LOCATIONS_TABLE}/${recordId}`;
    
    // Filter out null/undefined values
    const updateFields = {};
    for (const [key, value] of Object.entries(locationData)) {
      if (value !== null && value !== undefined && value !== '') {
        updateFields[key] = value;
      }
    }
    
    await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: updateFields })
    });
    
    return { action: 'updated', apiNumber };
  } else {
    // Create new record
    const createUrl = `${AIRTABLE_API_BASE}/${BASE_ID}/${WELL_LOCATIONS_TABLE}`;
    
    // Filter out null/undefined values for create as well
    const createFields = { 'API Number': apiNumber };
    for (const [key, value] of Object.entries(locationData)) {
      if (value !== null && value !== undefined && value !== '') {
        createFields[key] = value;
      }
    }
    
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: createFields })
    });
    
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.error(`[Backfill] Failed to create record for ${apiNumber}:`, error);
      console.error(`[Backfill] Request body was:`, JSON.stringify({ 
        fields: { 
          'API Number': apiNumber,
          ...locationData 
        } 
      }));
      throw new Error(`Airtable error: ${error}`);
    }
    
    console.log(`[Backfill] Created record for ${apiNumber}`);
    return { action: 'created', apiNumber };
  }
}

/**
 * Process tracked wells to get their locations
 */
async function processTrackedWells(env, results) {
  console.log('[Backfill] Processing tracked wells...');
  
  // Fetch all tracked wells
  const wells = await fetchAllAirtableRecords(
    env,
    WELLS_TABLE,
    '{Status} = "Active"'
  );
  
  console.log(`[Backfill] Found ${wells.length} active tracked wells`);
  
  for (const well of wells) {
    const api10 = normalizeAPI(well.fields['API Number']);
    if (!api10) {
      console.log('[Backfill] Skipping well with no API number');
      continue;
    }
    
    // Skip if no location data available
    if (!well.fields['Section'] || !well.fields['Township'] || !well.fields['Range']) {
      console.log(`[Backfill] Skipping well ${api10} - missing location data`);
      continue;
    }
    
    const locationData = {
      apiNumber: api10,
      'Has Tracked Well': true,
      'Well Name': well.fields['Well Name'] || null,
      'Operator': well.fields['Operator'] || null,
      'County': well.fields['County'] || null,
      'Well Status': well.fields['Well Status'] || null,
      'Formation': well.fields['Formation Name'] || null
    };
    
    // Add surface location from tracked wells (they always have surface location)
    if (well.fields['Section'] && well.fields['Township'] && well.fields['Range']) {
      locationData['Surface Section'] = normalizeSection(well.fields['Section']);
      locationData['Surface Township'] = well.fields['Township'];
      locationData['Surface Range'] = well.fields['Range'];
      locationData['Surface PM'] = 'IM'; // Default to Indian Meridian
    }
    
    // Check if it's a horizontal well based on Drill Type
    if (well.fields['Drill Type'] === 'HH' || well.fields['Drill Type'] === 'Horizontal') {
      locationData['Is Horizontal'] = true;
    }
    
    try {
      const result = await upsertWellLocation(env, locationData);
      results[result.action]++;
    } catch (err) {
      console.error(`[Backfill] Error processing well ${api10}:`, err.message);
      results.errors++;
    }
  }
}

/**
 * Process activity log entries to extract location data
 */
async function processActivityLog(env, results) {
  console.log('[Backfill] Processing activity log...');
  
  // Get recent activities (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const isoDate = ninetyDaysAgo.toISOString().split('T')[0];
  
  const activities = await fetchAllAirtableRecords(
    env,
    ACTIVITY_TABLE,
    `IS_AFTER({Detected At}, "${isoDate}")`
  );
  
  console.log(`[Backfill] Found ${activities.length} recent activities`);
  
  // Group by API number to avoid duplicate processing
  const wellsMap = new Map();
  
  for (const activity of activities) {
    const api10 = normalizeAPI(activity.fields['API Number']);
    if (!api10) {
      console.log('[Backfill] Skipping activity with no API number');
      continue;
    }
    
    // Parse TRS from Section-Township-Range field
    const trs = parseTRS(activity.fields['Section-Township-Range']);
    if (!trs) {
      console.log(`[Backfill] Skipping activity ${api10} - cannot parse TRS from "${activity.fields['Section-Township-Range']}"`);
      continue;
    }
    
    // Build location data
    const locationData = {
      apiNumber: api10,
      'Well Name': activity.fields['Well Name'] || null,
      'Operator': activity.fields['Operator'] || null,
      'County': activity.fields['County'] || null,
      'Surface Section': trs.section,
      'Surface Township': trs.township,
      'Surface Range': trs.range,
      'Surface PM': 'IM', // Default to Indian Meridian for Oklahoma
      'Formation': activity.fields['Formation'] || null
    };
    
    // Track activity types
    if (activity.fields['Activity Type'] === 'New Permit') {
      locationData['Has Permit'] = true;
      if (!locationData['Permit Date']) {
        locationData['Permit Date'] = activity.fields['Detected At'];
      }
    } else if (activity.fields['Activity Type'] === 'Well Completed') {
      locationData['Has Completion'] = true;
      if (!locationData['Completion Date']) {
        locationData['Completion Date'] = activity.fields['Detected At'];
      }
    }
    
    // Store or merge with existing data for this well
    const existing = wellsMap.get(api10) || {};
    wellsMap.set(api10, { ...existing, ...locationData });
  }
  
  // Process unique wells
  console.log(`[Backfill] Processing ${wellsMap.size} unique wells from activities`);
  
  for (const [api10, locationData] of wellsMap) {
    try {
      const result = await upsertWellLocation(env, locationData);
      results[result.action]++;
    } catch (err) {
      console.error(`[Backfill] Error processing activity well ${api10}:`, err.message);
      results.errors++;
    }
  }
}

/**
 * Main handler function
 */
export default async function handleBackfillWellLocations(request, env) {
  try {
    // Check for API key
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    const results = {
      created: 0,
      updated: 0,
      errors: 0,
      startedAt: new Date().toISOString()
    };
    
    console.log('[Backfill] Starting well locations backfill from existing data');
    
    // Process tracked wells first (they have the most complete data)
    await processTrackedWells(env, results);
    
    // Then process activity log to fill in gaps
    await processActivityLog(env, results);
    
    results.completedAt = new Date().toISOString();
    console.log('[Backfill] Completed:', results);
    
    return new Response(JSON.stringify(results, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('[Backfill] Fatal error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}