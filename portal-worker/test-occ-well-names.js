// Test script to check OCC API responses for well names
const TEST_WELLS = [
  { api: '3515320015', description: 'Double ## case - L O WHEELER UNIT ##1' },
  { api: '3501123699', description: 'Missing number - COMPTON' },
  { api: '3515322352', description: 'Correct example for comparison' }
];

async function checkOCCResponse(apiNumber) {
  const baseUrl = "https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query";
  
  const params = new URLSearchParams({
    where: `api=${apiNumber}`,
    outFields: "*",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "1"
  });

  try {
    console.log(`\n=== Checking API ${apiNumber} ===`);
    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { "User-Agent": "MineralWatch-Portal/1.0" }
    });

    if (!response.ok) {
      console.error(`HTTP error: ${response.status}`);
      return;
    }

    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      const attr = data.features[0].attributes;
      
      console.log('\nKey fields from OCC:');
      console.log(`  well_name: "${attr.well_name || 'NULL'}"`);
      console.log(`  well_num: "${attr.well_num || 'NULL'}"`);
      console.log(`  county: "${attr.county || 'NULL'}"`);
      
      // Check for any other name-related fields
      const nameFields = Object.keys(attr).filter(key => 
        key.toLowerCase().includes('name') || 
        key.toLowerCase().includes('num') ||
        key.toLowerCase().includes('well')
      );
      
      console.log('\nAll name-related fields:');
      nameFields.forEach(field => {
        console.log(`  ${field}: "${attr[field] || 'NULL'}"`);
      });
      
      // Show what our current logic would produce
      const wouldProduce = attr.well_name && attr.well_num && !attr.well_name.includes('#') 
        ? `${attr.well_name} #${attr.well_num}` 
        : (attr.well_name || '');
      
      console.log(`\nOur logic would produce: "${wouldProduce}"`);
      
    } else {
      console.log("No well found");
    }
  } catch (error) {
    console.error("Error fetching from OCC:", error);
  }
}

// Run the tests
async function runTests() {
  console.log("Testing OCC API responses for well name fields...\n");
  
  for (const well of TEST_WELLS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${well.description}`);
    await checkOCCResponse(well.api);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log("\nSummary: Check the patterns above to see if:");
  console.log("1. OCC is already including '#' in well_name");
  console.log("2. well_num field is missing or empty");
  console.log("3. County format includes prefix like '011-BLAINE'");
}

runTests();