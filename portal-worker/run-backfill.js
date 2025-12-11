// Simple script to run the Well Locations backfill
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';

async function runBackfill() {
  console.log('Starting Well Locations backfill...');
  
  try {
    const response = await fetch('https://portal.mymineralwatch.com/api/backfill-well-locations', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Backfill completed successfully!');
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.error('❌ Backfill failed:', data);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

runBackfill();