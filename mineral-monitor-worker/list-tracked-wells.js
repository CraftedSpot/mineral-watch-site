/**
 * List tracked wells with their current status
 * Helps identify good candidates for testing status changes
 */

import 'dotenv/config';

async function listTrackedWells() {
  console.log('=== TRACKED WELLS WITH STATUS ===\n');

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.MINERAL_AIRTABLE_API_KEY;
  const wellsTable = process.env.AIRTABLE_WELLS_TABLE;

  try {
    // Query active wells
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(wellsTable)}?filterByFormula=${encodeURIComponent('AND({Status}="Active",NOT({API Number}=BLANK()))')}&fields[]=Well Name&fields[]=API Number&fields[]=Well Status&fields[]=Status Last Changed&maxRecords=20`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.records.length === 0) {
      console.log('No active tracked wells found.');
      return;
    }

    console.log(`Found ${data.records.length} active tracked wells (showing first 20):\n`);
    
    data.records.forEach((record, index) => {
      const fields = record.fields;
      const statusLastChanged = fields['Status Last Changed'] 
        ? new Date(fields['Status Last Changed']).toLocaleDateString() 
        : 'Never';
      
      console.log(`${index + 1}. ${fields['Well Name'] || 'Unnamed Well'}`);
      console.log(`   API: ${fields['API Number']}`);
      console.log(`   Current Status: ${fields['Well Status'] || 'Unknown'}`);
      console.log(`   Status Last Changed: ${statusLastChanged}`);
      console.log('');
    });

    console.log('\nStatus Codes:');
    console.log('AC = Active');
    console.log('SI = Shut In'); 
    console.log('PA = Plugged & Abandoned');
    console.log('TA = Temporarily Abandoned');
    console.log('PR = Producing');
    
    console.log('\nTo test a status change:');
    console.log('1. Pick a well from above');
    console.log('2. Edit test-status-change.js');
    console.log('3. Set TEST_API to the well\'s API number');
    console.log('4. Set TEST_NEW_STATUS to a different status code');
    console.log('5. Run: node test-status-change.js');

  } catch (err) {
    console.error('Error listing wells:', err.message);
  }
}

listTrackedWells().catch(console.error);