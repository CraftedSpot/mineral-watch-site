// Script to fix double ## in well names in Airtable

const AIRTABLE_API_KEY = process.argv[2];
const BASE_ID = 'app3j3X29Uvp5stza';
const WELLS_TABLE = '🛢️ Client Wells';

if (!AIRTABLE_API_KEY) {
  console.log('Usage: node fix-well-names.js YOUR_AIRTABLE_API_KEY');
  console.log('\nYou can find your Airtable API key in your Cloudflare dashboard');
  console.log('or by running: wrangler secret list');
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

async function updateWellName(recordId, newName) {
  const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${WELLS_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        'Well Name': newName
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update well ${recordId}: ${error}`);
  }
  
  return response.json();
}

async function fixWellNames() {
  console.log('Fetching all wells from Airtable...');
  
  let wells;
  try {
    wells = await getAllWells();
  } catch (error) {
    console.error('Error fetching wells:', error.message);
    console.log('\nMake sure your Airtable API key is correct.');
    process.exit(1);
  }
  
  console.log(`Found ${wells.length} total wells`);
  
  const toFix = [];
  
  // Check each well
  for (const well of wells) {
    const currentName = well.fields['Well Name'] || '';
    
    // Check for double ##
    if (currentName.includes('##')) {
      const fixedName = currentName.replace(/##/g, '#');
      toFix.push({
        id: well.id,
        api: well.fields['API Number'],
        current: currentName,
        fixed: fixedName
      });
    }
  }
  
  console.log(`\nFound ${toFix.length} wells with double ## to fix:`);
  toFix.forEach(w => {
    console.log(`  API ${w.api}: "${w.current}" → "${w.fixed}"`);
  });
  
  if (toFix.length === 0) {
    console.log('No wells need fixing!');
    return;
  }
  
  // Ask for confirmation
  console.log('\nPress Enter to proceed with updates, or Ctrl+C to cancel...');
  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });
  
  // Update wells
  console.log('\nUpdating wells...');
  let success = 0;
  let failed = 0;
  
  for (const well of toFix) {
    try {
      await updateWellName(well.id, well.fixed);
      console.log(`✓ Updated ${well.api}: ${well.fixed}`);
      success++;
      
      // Rate limit: wait 200ms between updates
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`✗ Failed to update ${well.api}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\nDone! Updated ${success} wells, ${failed} failed.`);
  process.exit(0);
}

// Run the fix
fixWellNames().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});