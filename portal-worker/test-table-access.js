// Test script to check if we can access the Well Locations table
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = '📍 Well Locations';

async function testTableAccess() {
  console.log('Testing access to Well Locations table...');
  console.log(`Base ID: ${BASE_ID}`);
  console.log(`Table Name: "${TABLE_NAME}"`);
  
  try {
    // Try to list records from the table
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?maxRecords=1`;
    console.log(`URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Successfully accessed table!');
      console.log(`Records in table: ${data.records ? data.records.length : 0}`);
    } else {
      console.error('❌ Failed to access table:', data);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testTableAccess();