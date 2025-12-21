// Script to check the exact field names in the OCC completions Excel file
import { fetchOCCFile } from './src/services/occ.js';

// Create minimal env object
const env = {
  MINERAL_CACHE: {
    get: async () => null,
    put: async () => {}
  }
};

async function checkFieldNames() {
  console.log("Fetching completions from OCC to check field names...\n");
  
  try {
    const completions = await fetchOCCFile('completions', env);
    
    if (completions.length > 0) {
      // Show all field names from the first record
      console.log("All field names in the completions Excel file:");
      console.log("=" + "=".repeat(60));
      const fields = Object.keys(completions[0]);
      fields.forEach((field, i) => {
        console.log(`${(i+1).toString().padStart(2)}. "${field}"`);
      });
      
      // Find the Dusty completion to show its values
      const dusty = completions.find(c => 
        c.Well_Name && c.Well_Name.includes('DUSTY')
      );
      
      if (dusty) {
        console.log("\n\nDusty completion data for bottom hole fields:");
        console.log("=" + "=".repeat(60));
        
        // Look for any field containing "BH" or "Bottom" or "PBH"
        fields.forEach(field => {
          if (field.match(/BH|Bottom|PBH|pbh|Projected/i)) {
            console.log(`${field}: ${dusty[field] || 'N/A'}`);
          }
        });
        
        // Also show location-related fields
        console.log("\nAll location-related fields:");
        fields.forEach(field => {
          if (field.match(/Section|Township|Range|Long|Lat|Location|PM/i)) {
            console.log(`${field}: ${dusty[field] || 'N/A'}`);
          }
        });
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

checkFieldNames();