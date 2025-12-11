// Check what records are in the Well Locations table
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = '📍 Well Locations';

async function checkRecords() {
  console.log('Checking records in Well Locations table...');
  
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?pageSize=10`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`Found ${data.records.length} records:`);
      data.records.forEach((record, i) => {
        console.log(`\nRecord ${i + 1}:`);
        console.log('API Number:', record.fields['API Number']);
        console.log('Well Name:', record.fields['Well Name']);
        console.log('Fields:', Object.keys(record.fields).join(', '));
      });
    } else {
      console.error('Failed:', data);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkRecords();