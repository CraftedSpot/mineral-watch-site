// Delete empty records from Well Locations table
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = '📍 Well Locations';

async function deleteEmptyRecords() {
  console.log('Finding empty records...');
  
  try {
    // First, get all records
    const listUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
    
    const listResponse = await fetch(listUrl, {
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await listResponse.json();
    
    // Find records with no API Number
    const emptyRecords = data.records.filter(record => 
      !record.fields['API Number'] || Object.keys(record.fields).length === 0
    );
    
    console.log(`Found ${emptyRecords.length} empty records to delete`);
    
    // Delete each empty record
    for (const record of emptyRecords) {
      console.log(`Deleting record ${record.id}...`);
      
      const deleteUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}/${record.id}`;
      
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + API_KEY
        }
      });
      
      if (deleteResponse.ok) {
        console.log(`✅ Deleted ${record.id}`);
      } else {
        console.error(`❌ Failed to delete ${record.id}`);
      }
    }
    
    console.log('Cleanup complete!');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

deleteEmptyRecords();