// Check patterns in well names and counties
const AIRTABLE_API_KEY = process.argv[2];
const BASE_ID = 'app3j3X29Uvp5stza';
const WELLS_TABLE = '🛢️ Client Wells';

if (!AIRTABLE_API_KEY) {
  console.log('Usage: node check-well-patterns.js YOUR_AIRTABLE_API_KEY');
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
      throw new Error(`Failed to fetch wells: ${response.status}`);
    }
    
    const data = await response.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);
  
  return allRecords;
}

async function analyzePatterns() {
  console.log('Fetching all wells from Airtable...');
  const wells = await getAllWells();
  
  const patterns = {
    withCountyCode: { total: 0, missingNumber: 0, examples: [] },
    withoutCountyCode: { total: 0, missingNumber: 0, examples: [] }
  };
  
  wells.forEach(well => {
    const wellName = well.fields['Well Name'] || '';
    const county = well.fields['County'] || '';
    const api = well.fields['API Number'] || '';
    
    // Check if well name has a number (# followed by anything)
    const hasWellNumber = /#/.test(wellName);
    
    // Check if county has a code prefix (digits followed by hyphen)
    const hasCountyCode = /^\d+-/.test(county);
    
    const category = hasCountyCode ? 'withCountyCode' : 'withoutCountyCode';
    patterns[category].total++;
    
    if (!hasWellNumber) {
      patterns[category].missingNumber++;
      if (patterns[category].examples.length < 5) {
        patterns[category].examples.push({
          api,
          wellName,
          county
        });
      }
    }
  });
  
  console.log('\n=== ANALYSIS RESULTS ===\n');
  
  console.log('Wells WITH county code prefix (like "011-BLAINE"):');
  console.log(`  Total: ${patterns.withCountyCode.total}`);
  console.log(`  Missing well number: ${patterns.withCountyCode.missingNumber} (${(patterns.withCountyCode.missingNumber / patterns.withCountyCode.total * 100).toFixed(1)}%)`);
  console.log('  Examples of missing numbers:');
  patterns.withCountyCode.examples.forEach(ex => {
    console.log(`    API ${ex.api}: "${ex.wellName}" in ${ex.county}`);
  });
  
  console.log('\nWells WITHOUT county code prefix:');
  console.log(`  Total: ${patterns.withoutCountyCode.total}`);
  console.log(`  Missing well number: ${patterns.withoutCountyCode.missingNumber} (${(patterns.withoutCountyCode.missingNumber / patterns.withoutCountyCode.total * 100).toFixed(1)}%)`);
  console.log('  Examples of missing numbers:');
  patterns.withoutCountyCode.examples.forEach(ex => {
    console.log(`    API ${ex.api}: "${ex.wellName}" in ${ex.county}`);
  });
  
  // Check specific wells
  console.log('\n=== CHECKING SPECIFIC WELLS ===\n');
  const checkApis = ['3501123699', '3501123620', '3501123621']; // COMPTON wells
  
  wells.filter(w => checkApis.includes(w.fields['API Number'])).forEach(w => {
    console.log(`API ${w.fields['API Number']}:`);
    console.log(`  Well Name: "${w.fields['Well Name']}"`);
    console.log(`  County: "${w.fields['County']}"`);
    console.log(`  Operator: "${w.fields['Operator'] || 'N/A'}"`);
  });
}

analyzePatterns().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});