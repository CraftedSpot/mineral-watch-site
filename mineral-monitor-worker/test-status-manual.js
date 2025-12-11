/**
 * Manual test for status change - simplified version
 * Uses wrangler to get secrets
 */

console.log(`
=== MANUAL STATUS CHANGE TEST ===

To test the status change detection:

1. First, check your tracked wells in Airtable:
   - Go to the Client Wells table
   - Find a well with Status = "Active" 
   - Note its API Number and current Well Status

2. Run this command to simulate a status change:
   
   npx wrangler dev --test-scheduled

3. In another terminal, trigger the test with a curl command:

   curl "http://localhost:8787/__scheduled?cron=0+12+*+*+*"

4. Check the console output for status change detection

5. Verify in Airtable:
   - The Well Status field should update
   - The Status Last Changed field should show today's date/time

Alternative: Direct API test
---------------------------
If you have a specific well to test, you can modify the daily.js temporarily:

1. Edit src/monitors/daily.js
2. Find the line with fetchOCCFile('itd', env)
3. After it, add a test well:
   
   // TEST: Force a status change
   itdPermits.push({
     API_Number: 'YOUR_WELL_API_HERE',
     wellstatus: 'SI', // or any different status
     // ... other fields
   });

4. Deploy and run the scheduled task
5. Remember to remove the test code!

Note: The "Status Last Changed" field will show the full timestamp.
You mentioned wanting "the date" - if you want just the date without time,
we can update the code to format it differently.
`);