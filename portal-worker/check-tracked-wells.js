// Check what data is in tracked wells
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const WELLS_TABLE = '🛢️ Client Wells';

async function checkTrackedWells() {
  console.log('Checking tracked wells data...');
  
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?maxRecords=3&filterByFormula={Status}="Active"`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`Found ${data.records.length} active wells. First few:`);
      data.records.forEach((record, i) => {
        console.log(`\nWell ${i + 1}:`);
        console.log('Fields available:', Object.keys(record.fields));
        console.log('API Number:', record.fields['API Number']);
        console.log('BH fields:', {
          'BH Section': record.fields['BH Section'],
          'BH Township': record.fields['BH Township'],
          'BH Range': record.fields['BH Range']
        });
      });
    } else {
      console.error('Failed:', data);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkTrackedWells();