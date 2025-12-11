// Test creating a single well location from tracked well data
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = '📍 Well Locations';

// Simulate the data structure from backfill
const testData = {
  apiNumber: '3515320015',
  'Has Tracked Well': true,
  'Well Name': 'Test Well',
  'Operator': 'Test Operator',
  'County': 'Oklahoma',
  'Well Status': 'AC',
  'Formation': null,
  'Surface Section': '12',
  'Surface Township': '14N',
  'Surface Range': '12W',
  'Surface PM': 'IM'
};

async function testCreate() {
  console.log('Testing single record creation...');
  
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
    
    // Extract apiNumber and create fields object like the backfill does
    const { apiNumber, ...locationData } = testData;
    
    const requestBody = {
      fields: {
        'API Number': apiNumber,
        ...locationData
      }
    };
    
    console.log('Sending:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    const responseText = await response.text();
    console.log('Response status:', response.status);
    console.log('Response:', responseText);
    
    if (!response.ok) {
      console.error('❌ Failed! This is the error the backfill is hitting.');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCreate();