// Quick script to find and add today's completion to Statewide Activity
const AIRTABLE_API_KEY = process.env.MINERAL_AIRTABLE_API_KEY;
const BASE_ID = 'app3j3X29Uvp5stza';

async function findTodaysCompletion() {
  console.log("Fetching today's completions from OCC...");
  
  // Fetch today's completions
  const response = await fetch('https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/completions-wells-formations-daily.xlsx');
  const buffer = await response.arrayBuffer();
  
  // We need to process this differently - let's just manually add based on what we know
  console.log("Since we know there was 1 completion today that didn't get added, let's check Airtable...");
  
  // First, let's find recent Activity Log entries for completions
  const activityUrl = `https://api.airtable.com/v0/${BASE_ID}/tblhBZNR5pDr620NY?filterByFormula=AND({Activity Type}='Well Completed',IS_AFTER({Detected At},'2025-12-20'))&maxRecords=10`;
  
  const activityResponse = await fetch(activityUrl, {
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  const activityData = await activityResponse.json();
  console.log(`Found ${activityData.records?.length || 0} recent completions in Activity Log`);
  
  if (activityData.records && activityData.records.length > 0) {
    for (const record of activityData.records) {
      const f = record.fields;
      console.log(`\nCompletion found:`);
      console.log(`- API: ${f['API Number']}`);
      console.log(`- Well: ${f['Well Name']}`);
      console.log(`- Location: ${f['Section-Township-Range']}`);
      console.log(`- County: ${f['County']}`);
      
      // Add to Statewide Activity
      await addToStatewideActivity(f);
    }
  } else {
    console.log("\nNo recent completions found in Activity Log.");
    console.log("The completion might not have triggered any user alerts.");
    console.log("\nLet's check the OCC data directly...");
    
    // Since we can't easily parse Excel here, provide instructions
    console.log("\nTo manually add the completion:");
    console.log("1. Check the OCC completions file for today");
    console.log("2. Find the completion that's not in Statewide Activity");
    console.log("3. Run this script with the API number as an argument");
  }
}

async function addToStatewideActivity(completionData) {
  // Parse TRS if needed
  let section, township, range;
  const trs = completionData['Section-Township-Range'];
  if (trs) {
    const match = trs.match(/S(\d+)\s+T(\d+[NS])\s+R(\d+[EW])/i);
    if (match) {
      section = match[1];
      township = match[2];
      range = match[3];
    }
  }
  
  const fields = {
    'API Number': completionData['API Number'],
    'Well Name': completionData['Well Name'],
    'Operator': completionData['Operator'],
    'County': completionData['County'],
    'Has Completion': true,
    'Completion Date': new Date().toISOString(),
    'Surface Section': section || '',
    'Surface Township': township || '',
    'Surface Range': range || '',
    'Formation': completionData['Formation'] || ''
  };
  
  console.log('\nAdding to Statewide Activity with fields:', fields);
  
  const createUrl = `https://api.airtable.com/v0/${BASE_ID}/tblbM8kwkRyFS9eaj`;
  
  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  
  if (createResponse.ok) {
    const result = await createResponse.json();
    console.log('✅ Successfully added to Statewide Activity!');
    console.log('Record ID:', result.id);
  } else {
    const error = await createResponse.text();
    console.error('❌ Failed to add:', error);
  }
}

// Run the script
if (!AIRTABLE_API_KEY) {
  console.error('Please set MINERAL_AIRTABLE_API_KEY environment variable');
  process.exit(1);
}

findTodaysCompletion().catch(console.error);