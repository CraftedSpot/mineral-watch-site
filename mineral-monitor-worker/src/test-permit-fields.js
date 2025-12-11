/**
 * Test script to inspect Intent to Drill data fields
 * Run with: node test-permit-fields.js
 */

import { fetchOCCFile } from './services/occ.js';

// Fetch a sample Intent to Drill file
async function inspectPermitFields() {
  try {
    // Use yesterday's date as a test
    const date = new Date();
    date.setDate(date.getDate() - 1);
    
    const permits = await fetchOCCFile('Intent to Drill', date, { 
      MINERAL_AIRTABLE_API_KEY: process.env.MINERAL_AIRTABLE_API_KEY 
    });
    
    if (permits && permits.length > 0) {
      console.log('Sample permit record fields:');
      console.log(JSON.stringify(permits[0], null, 2));
      
      // Look for any field containing "zone", "target", or "formation"
      const firstPermit = permits[0];
      console.log('\n\nFields containing Zone/Target/Formation:');
      Object.keys(firstPermit).forEach(key => {
        if (key.toLowerCase().includes('zone') || 
            key.toLowerCase().includes('target') || 
            key.toLowerCase().includes('formation')) {
          console.log(`${key}: ${firstPermit[key]}`);
        }
      });
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

inspectPermitFields();