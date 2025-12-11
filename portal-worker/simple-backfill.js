// Simple backfill script to copy tracked wells to Well Locations table
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const WELLS_TABLE = '🛢️ Client Wells';
const WELL_LOCATIONS_TABLE = '📍 Well Locations';

async function getAllTrackedWells() {
  console.log('Fetching all tracked wells...');
  const wells = [];
  let offset = null;
  
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}`);
    url.searchParams.set('filterByFormula', '{Status} = "Active"');
    if (offset) url.searchParams.set('offset', offset);
    
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    wells.push(...data.records);
    offset = data.offset;
  } while (offset);
  
  return wells;
}

async function createWellLocation(well) {
  const fields = well.fields;
  
  // Only include non-null fields
  const locationData = {};
  
  // Required field
  if (fields['API Number']) {
    locationData['API Number'] = fields['API Number'].substring(0, 10); // Normalize to 10 digits
  } else {
    return { success: false, error: 'No API number' };
  }
  
  // Basic info
  if (fields['Well Name']) locationData['Well Name'] = fields['Well Name'];
  if (fields['Operator']) locationData['Operator'] = fields['Operator'];
  if (fields['County']) locationData['County'] = fields['County'];
  if (fields['Well Status']) locationData['Well Status'] = fields['Well Status'];
  if (fields['Formation Name']) locationData['Formation'] = fields['Formation Name'];
  
  // Surface location (most wells have this)
  if (fields['Section']) locationData['Surface Section'] = fields['Section'];
  if (fields['Township']) locationData['Surface Township'] = fields['Township'];
  if (fields['Range']) locationData['Surface Range'] = fields['Range'];
  locationData['Surface PM'] = 'IM'; // Default for Oklahoma
  
  // Flags
  locationData['Has Tracked Well'] = true;
  
  // Check if horizontal
  if (fields['Drill Type'] === 'HORIZONTAL HOLE' || fields['Drill Type'] === 'HH') {
    locationData['Is Horizontal'] = true;
  }
  
  // Dates
  if (fields['Completion Date']) locationData['Completion Date'] = fields['Completion Date'];
  
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELL_LOCATIONS_TABLE)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: locationData })
      }
    );
    
    if (response.ok) {
      return { success: true, apiNumber: locationData['API Number'] };
    } else {
      const error = await response.text();
      return { success: false, error, apiNumber: locationData['API Number'] };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function runBackfill() {
  console.log('Starting simple backfill...');
  
  const wells = await getAllTrackedWells();
  console.log(`Found ${wells.length} tracked wells`);
  
  let created = 0;
  let errors = 0;
  
  // Process in batches of 10
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < wells.length; i += BATCH_SIZE) {
    const batch = wells.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(wells.length/BATCH_SIZE)}`);
    
    const promises = batch.map(well => createWellLocation(well));
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.success) {
        created++;
        console.log(`✅ Created: ${result.apiNumber}`);
      } else {
        errors++;
        console.log(`❌ Failed: ${result.apiNumber} - ${result.error}`);
      }
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\nBackfill complete!`);
  console.log(`Created: ${created}`);
  console.log(`Errors: ${errors}`);
}

runBackfill();