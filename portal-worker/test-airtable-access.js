// Test Airtable access
const AIRTABLE_API_KEY = process.argv[2];

if (!AIRTABLE_API_KEY) {
  console.log('Usage: node test-airtable-access.js YOUR_AIRTABLE_API_KEY');
  process.exit(1);
}

// Test with the actual base ID from constants
const BASE_ID = 'app3j3X29Uvp5stza';

async function testAccess() {
  console.log('Testing Airtable access...');
  console.log('Base ID:', BASE_ID);
  console.log('API Key format:', AIRTABLE_API_KEY.substring(0, 10) + '...');
  
  // Try to list tables
  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
  
  try {
    const response = await fetch(url, {
      headers: { 
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`
      }
    });
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const error = await response.text();
      console.log('Error response:', error);
    } else {
      const data = await response.json();
      console.log('\nTables found:');
      data.tables.forEach(table => {
        console.log(`- ${table.name} (${table.id})`);
      });
    }
  } catch (error) {
    console.error('Network error:', error.message);
  }
}

testAccess();