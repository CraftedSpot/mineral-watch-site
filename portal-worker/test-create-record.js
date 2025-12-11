// Test creating a single record with known data
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = '📍 Well Locations';

async function testCreateRecord() {
  console.log('Testing record creation...');
  
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
    
    const recordData = {
      fields: {
        'API Number': '3512345678',
        'Well Name': 'Test Well #1',
        'Operator': 'Test Operator',
        'County': 'Oklahoma',
        'Surface Section': '12',
        'Surface Township': '14N',
        'Surface Range': '12W',
        'Surface PM': 'IM',
        'Is Horizontal': true,
        'Has Tracked Well': true
      }
    };
    
    console.log('Creating record:', JSON.stringify(recordData, null, 2));
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(recordData)
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Record created successfully!');
      console.log('Record ID:', data.id);
      console.log('Fields saved:', data.fields);
    } else {
      console.error('❌ Failed to create record:');
      console.error('Status:', response.status);
      console.error('Error:', data);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testCreateRecord();