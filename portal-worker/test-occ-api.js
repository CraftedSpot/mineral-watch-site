// Test OCC API directly
const apiNumber = '3504523883';

async function testOCCAPIs() {
  console.log(`Testing OCC APIs for well ${apiNumber}...\n`);
  
  // Test 1: Completion API
  console.log('1. Testing Completion API...');
  const completionUrl = `https://gis.occ.ok.gov/server/rest/services/Hosted/Completions/FeatureServer/0/query?where=API_NUMBER='${apiNumber}'&outFields=*&f=json`;
  
  try {
    const response = await fetch(completionUrl);
    const data = await response.json();
    
    console.log(`Response:`, JSON.stringify(data, null, 2));
    
    if (data.features && data.features.length > 0) {
      console.log('\nFound completion! Fields:');
      console.log(Object.keys(data.features[0].attributes));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  // Test 2: RBDMS Well API
  console.log('\n\n2. Testing RBDMS Well API...');
  const wellUrl = `https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query?where=api='${apiNumber}'&outFields=*&f=json`;
  
  try {
    const response = await fetch(wellUrl);
    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      console.log('\nFound well! Attributes:');
      const attrs = data.features[0].attributes;
      console.log('API:', attrs.api_number);
      console.log('Well name:', attrs.well_name);
      console.log('Drill type:', attrs.drill_type, attrs.welltype);
      console.log('\nLooking for BH fields...');
      
      for (const [key, value] of Object.entries(attrs)) {
        if (key.toLowerCase().includes('bh') || key.toLowerCase().includes('bottom')) {
          console.log(`${key}: ${value}`);
        }
      }
      
      console.log('\nLooking for PBH (projected BH) fields...');
      for (const [key, value] of Object.entries(attrs)) {
        if (key.toLowerCase().includes('pbh')) {
          console.log(`${key}: ${value}`);
        }
      }
    } else {
      console.log('No well found');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testOCCAPIs();