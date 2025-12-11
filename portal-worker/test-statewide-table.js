// Test script to verify Statewide Activity table access
const AIRTABLE_API_KEY = process.argv[2];
const BASE_ID = 'app3j3X29Uvp5stza';
const STATEWIDE_TABLE = 'Statewide Activity';

if (!AIRTABLE_API_KEY) {
  console.log('Usage: node test-statewide-table.js YOUR_AIRTABLE_API_KEY');
  process.exit(1);
}

async function testStatewideTable() {
  console.log('Testing Statewide Activity table access...\n');
  
  // 1. Try to list records
  console.log('1. Testing READ access...');
  const listUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(STATEWIDE_TABLE)}?maxRecords=3`;
  
  try {
    const response = await fetch(listUrl, {
      headers: { 
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`
      }
    });
    
    console.log(`   Status: ${response.status}`);
    
    if (!response.ok) {
      const error = await response.text();
      console.log(`   Error: ${error}`);
      return;
    }
    
    const data = await response.json();
    console.log(`   ✓ Found ${data.records.length} records`);
    
    if (data.records.length > 0) {
      const sample = data.records[0].fields;
      console.log(`   Sample record fields: ${Object.keys(sample).join(', ')}`);
    }
  } catch (error) {
    console.error(`   Network error: ${error.message}`);
    return;
  }
  
  // 2. Try to create a test record
  console.log('\n2. Testing WRITE access...');
  const testRecord = {
    fields: {
      'API Number': '3500000001',
      'Activity Type': 'Permit',
      'Activity Date': new Date().toISOString().split('T')[0],
      'Latitude': 35.5,
      'Longitude': -97.5,
      'County': 'TEST',
      'Operator': 'TEST OPERATOR',
      'Well Name': 'TEST WELL #1'
    }
  };
  
  console.log('   Creating test record...');
  
  try {
    const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(STATEWIDE_TABLE)}`;
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testRecord)
    });
    
    console.log(`   Status: ${createResponse.status}`);
    
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log(`   Error: ${error}`);
      console.log('\n⚠️  The API key may not have write permissions to Statewide Activity table');
      return;
    }
    
    const created = await createResponse.json();
    console.log(`   ✓ Created test record: ${created.id}`);
    
    // 3. Clean up - delete the test record
    console.log('\n3. Cleaning up test record...');
    const deleteUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(STATEWIDE_TABLE)}/${created.id}`;
    
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`
      }
    });
    
    if (deleteResponse.ok) {
      console.log('   ✓ Test record deleted');
    } else {
      console.log('   ⚠️  Failed to delete test record');
    }
    
  } catch (error) {
    console.error(`   Network error: ${error.message}`);
    return;
  }
  
  console.log('\n✅ All tests passed! The Statewide Activity table is accessible.');
}

testStatewideTable();