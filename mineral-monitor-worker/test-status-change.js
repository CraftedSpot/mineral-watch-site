/**
 * Manual test for status change detection
 * This simulates finding a well with a different status than stored
 */

import 'dotenv/config';
import { checkWellStatusChange } from './src/services/statusChange.js';

// Test configuration
const TEST_API = '3500900001'; // Replace with a real API from your tracked wells
const TEST_NEW_STATUS = 'SI'; // Simulate changing to Shut In
const TEST_YOUR_EMAIL = 'your-email@example.com'; // Add your email for testing

async function testStatusChange() {
  console.log('=== STATUS CHANGE TEST ===\n');
  
  // Mock environment
  const env = {
    AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID,
    MINERAL_AIRTABLE_API_KEY: process.env.MINERAL_AIRTABLE_API_KEY,
    AIRTABLE_WELLS_TABLE: process.env.AIRTABLE_WELLS_TABLE,
    AIRTABLE_USERS_TABLE: process.env.AIRTABLE_USERS_TABLE,
    AIRTABLE_ACTIVITY_TABLE: process.env.AIRTABLE_ACTIVITY_TABLE,
    POSTMARK_API_KEY: process.env.POSTMARK_API_KEY,
    DRY_RUN: 'true' // Set to false to actually send emails
  };

  // Mock OCC data with a status change
  const mockOccData = {
    wellstatus: TEST_NEW_STATUS,
    operator: 'Test Operator',
    county: '011-BLAINE',
    section: '15',
    township: '17N',
    range: '12W'
  };

  console.log(`Testing status change for well ${TEST_API}`);
  console.log(`Simulating new status: ${TEST_NEW_STATUS}\n`);

  try {
    const result = await checkWellStatusChange(TEST_API, mockOccData, env);
    
    console.log('\n=== RESULTS ===');
    console.log(`Status changed: ${result.hasChange}`);
    console.log(`Previous status: ${result.previousStatus}`);
    console.log(`Current status: ${result.currentStatus}`);
    console.log(`Alerts sent: ${result.alertsSent}`);
    
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(err => console.log(`  - ${err}`));
    }
    
    if (result.hasChange) {
      console.log('\n✅ Status change detected and processed!');
      console.log('Check your Airtable to see the updated "Status Last Changed" field.');
    } else {
      console.log('\nNo status change detected. This could mean:');
      console.log('1. The well already has this status');
      console.log('2. The well is not being tracked');
      console.log('3. The well has no previous status to compare');
    }
  } catch (err) {
    console.error('\n❌ Test failed:', err);
  }
}

// Run the test
testStatusChange().catch(console.error);