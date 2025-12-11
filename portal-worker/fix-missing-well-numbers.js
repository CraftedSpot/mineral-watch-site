// Script to fix wells missing well numbers by re-fetching from OCC
const AIRTABLE_API_KEY = process.argv[2];
const BASE_ID = 'app3j3X29Uvp5stza';
const WELLS_TABLE = '🛢️ Client Wells';

// OCC API endpoint
const OCC_API_URL = 'https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query';

if (!AIRTABLE_API_KEY) {
  console.log('Usage: node fix-missing-well-numbers.js YOUR_AIRTABLE_API_KEY');
  process.exit(1);
}

async function getAllWells() {
  let allRecords = [];
  let offset = undefined;
  
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${WELLS_TABLE}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch wells: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);
  
  return allRecords;
}

async function fetchWellFromOCC(apiNumber) {
  const params = new URLSearchParams({
    where: `api = '${apiNumber}'`,
    outFields: '*',
    f: 'json',
    resultRecordCount: '1'
  });
  
  const response = await fetch(`${OCC_API_URL}?${params}`);
  const data = await response.json();
  
  if (data.features && data.features.length > 0) {
    const attr = data.features[0].attributes;
    
    // Build well name with number
    const wellName = attr.well_name && attr.well_num && !attr.well_name.includes('#')
      ? `${attr.well_name} ${attr.well_num.startsWith('#') ? attr.well_num : '#' + attr.well_num}`
      : (attr.well_name || '');
    
    return {
      wellName,
      county: attr.county || '',
      operator: attr.operator || '',
      section: attr.section || '',
      township: attr.township || '',
      range: attr.range || '',
      wellType: attr.welltype || '',
      wellStatus: attr.wellstatus || ''
    };
  }
  
  return null;
}

async function updateWell(recordId, fields) {
  const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${WELLS_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update well ${recordId}: ${error}`);
  }
  
  return response.json();
}

async function fixMissingWellNumbers() {
  console.log('Fetching all wells from Airtable...');
  
  let wells;
  try {
    wells = await getAllWells();
  } catch (error) {
    console.error('Error fetching wells:', error.message);
    process.exit(1);
  }
  
  console.log(`Found ${wells.length} total wells`);
  
  // Find wells with county codes and no well numbers
  const toFix = [];
  
  for (const well of wells) {
    const wellName = well.fields['Well Name'] || '';
    const county = well.fields['County'] || '';
    const hasWellNumber = /#/.test(wellName);
    const hasCountyCode = /^\d+-/.test(county);
    
    // Focus on wells with county codes that are missing numbers
    if (hasCountyCode && !hasWellNumber) {
      toFix.push({
        id: well.id,
        api: well.fields['API Number'],
        currentName: wellName,
        county: county
      });
    }
  }
  
  console.log(`\nFound ${toFix.length} wells to fix (have county codes, missing well numbers)`);
  
  if (toFix.length === 0) {
    console.log('No wells need fixing!');
    return;
  }
  
  // Show what will be fixed
  console.log('\nWells to be updated:');
  toFix.forEach(w => {
    console.log(`  API ${w.api}: "${w.currentName}" in ${w.county}`);
  });
  
  // Ask for confirmation
  console.log('\nPress Enter to fetch correct well names from OCC, or Ctrl+C to cancel...');
  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });
  
  // Update wells
  console.log('\nFetching well details from OCC and updating...');
  let success = 0;
  let failed = 0;
  let noChange = 0;
  
  for (const well of toFix) {
    try {
      console.log(`\nProcessing API ${well.api}...`);
      
      // Fetch from OCC
      const occData = await fetchWellFromOCC(well.api);
      
      if (!occData) {
        console.log(`  ⚠️  No data found in OCC`);
        failed++;
        continue;
      }
      
      console.log(`  OCC returned: "${occData.wellName}"`);
      
      // Only update if we got a better name
      if (occData.wellName && occData.wellName !== well.currentName) {
        const updateFields = {
          'Well Name': occData.wellName
        };
        
        // Also update clean county if OCC has it
        if (occData.county && !occData.county.includes('-')) {
          updateFields['County'] = occData.county;
        }
        
        await updateWell(well.id, updateFields);
        console.log(`  ✓ Updated to: "${occData.wellName}"`);
        success++;
      } else {
        console.log(`  — No change needed`);
        noChange++;
      }
      
      // Rate limit: wait 300ms between API calls
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\nDone!`);
  console.log(`  Updated: ${success} wells`);
  console.log(`  No change: ${noChange} wells`);
  console.log(`  Failed: ${failed} wells`);
  
  if (success > 0) {
    console.log('\nWell names have been updated with proper numbers from OCC!');
  }
  
  process.exit(0);
}

// Run the fix
fixMissingWellNumbers().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});