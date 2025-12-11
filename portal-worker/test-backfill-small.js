// Test the backfill with a small dataset
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';

async function testBackfill() {
  console.log('Running small backfill test...');
  
  try {
    const response = await fetch('https://portal.mymineralwatch.com/api/backfill-well-locations', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    // Get the response text to see any errors
    const text = await response.text();
    console.log('Response status:', response.status);
    console.log('Response:', text);
    
    try {
      const data = JSON.parse(text);
      console.log('Parsed data:', JSON.stringify(data, null, 2));
    } catch (e) {
      console.log('Could not parse as JSON');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testBackfill();