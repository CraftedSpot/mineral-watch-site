// Script to find the Dusty completion and check why it's not in Statewide Activity
import dotenv from 'dotenv';
import { fetchOCCFile } from './src/services/occ.js';

dotenv.config();

const AIRTABLE_API_KEY = process.env.MINERAL_AIRTABLE_API_KEY;
const BASE_ID = 'app3j3X29Uvp5stza';

// Create minimal env object for fetchOCCFile
const env = {
  MINERAL_CACHE: {
    get: async () => null, // No cache for this test
    put: async () => {} // No-op
  }
};

async function checkDustyCompletion() {
  console.log("Fetching completions from OCC...");
  
  try {
    const completions = await fetchOCCFile('completions', env);
    console.log(`\nTotal completions in file: ${completions.length}`);
    
    // Find Dusty completion
    const dustyCompletions = completions.filter(c => 
      c.Well_Name && c.Well_Name.toLowerCase().includes('dusty')
    );
    
    if (dustyCompletions.length > 0) {
      console.log(`\nFound ${dustyCompletions.length} Dusty completion(s):`);
      dustyCompletions.forEach((comp, i) => {
        console.log(`\n--- Dusty Completion ${i + 1} ---`);
        console.log(`API Number: ${comp.API_Number}`);
        console.log(`Well Name: ${comp.Well_Name}`);
        console.log(`Well Number: ${comp.Well_Number || 'N/A'}`);
        console.log(`Operator: ${comp.Operator_Name}`);
        console.log(`County: ${comp.County}`);
        console.log(`Formation: ${comp.Producing_Formation_Name || comp.Formation || 'N/A'}`);
        console.log(`Drill Type: ${comp.Drill_Type || 'N/A'}`);
        console.log(`Location Type Sub: ${comp.Location_Type_Sub || 'N/A'}`);
        console.log(`Create Date: ${comp.Create_Date || comp.Created_Date || 'N/A'}`);
        console.log(`Completion Date: ${comp.Well_Completion || comp.Completion_Date || 'N/A'}`);
        console.log(`\nSurface Location:`);
        console.log(`  Section: ${comp.Section}`);
        console.log(`  Township: ${comp.Township}`);
        console.log(`  Range: ${comp.Range}`);
        console.log(`  PM: ${comp.PM || 'N/A'}`);
        console.log(`\nBottom Hole Location:`);
        console.log(`  PBH Section: ${comp.PBH_Section || 'N/A'}`);
        console.log(`  PBH Township: ${comp.PBH_Township || 'N/A'}`);
        console.log(`  PBH Range: ${comp.PBH_Range || 'N/A'}`);
        console.log(`  PBH PM: ${comp.PBH_PM || 'N/A'}`);
      });
      
      // Check if it's in processed APIs cache
      if (dustyCompletions.length > 0) {
        const api10 = dustyCompletions[0].API_Number?.replace(/-/g, '').substring(0, 10);
        console.log(`\n\nNormalized API for cache check: ${api10}`);
        
        // Check Statewide Activity
        console.log("\nChecking if this API is in Statewide Activity...");
        const url = `https://api.airtable.com/v0/${BASE_ID}/tblbM8kwkRyFS9eaj?filterByFormula={API Number}='${api10}'`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        if (data.records && data.records.length > 0) {
          console.log(`Found ${data.records.length} record(s) in Statewide Activity for this API`);
        } else {
          console.log("NOT found in Statewide Activity!");
          console.log("\nPossible reasons:");
          console.log("1. Daily monitor hasn't processed it yet");
          console.log("2. It was filtered out by date (>10 days old)");
          console.log("3. An error occurred during processing");
          console.log("4. It's still in the processed APIs cache from a previous run");
        }
      }
    } else {
      console.log("\nNo Dusty completions found in the OCC file");
      
      // Show a sample of what's in the file
      console.log("\nFirst 5 completions in the file:");
      completions.slice(0, 5).forEach((comp, i) => {
        console.log(`${i + 1}. ${comp.Well_Name} - ${comp.API_Number} (${comp.County} County)`);
      });
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

checkDustyCompletion();