// Check field names in drilling permits Excel file
import { fetchOCCFile } from './src/services/occ.js';

const env = {
  MINERAL_CACHE: {
    get: async () => null,
    put: async () => {}
  }
};

async function checkPermitFields() {
  console.log("Fetching drilling permits from OCC...\n");
  
  try {
    const permits = await fetchOCCFile('itd', env);
    
    if (permits.length > 0) {
      // Show all field names
      console.log("All field names in the drilling permits Excel file:");
      console.log("=" + "=".repeat(60));
      const fields = Object.keys(permits[0]);
      fields.forEach((field, i) => {
        console.log(`${(i+1).toString().padStart(2)}. "${field}"`);
      });
      
      // Look for horizontal permits
      const horizontalPermits = permits.filter(p => 
        p.Drill_Type === 'HH' || p.Drill_Type === 'HORIZONTAL HOLE'
      );
      
      console.log(`\n\nFound ${horizontalPermits.length} horizontal drilling permits`);
      
      if (horizontalPermits.length > 0) {
        const sample = horizontalPermits[0];
        console.log("\nSample horizontal permit bottom hole fields:");
        console.log("=" + "=".repeat(60));
        
        // Check for any BH/PBH/Bottom fields
        fields.forEach(field => {
          if (field.match(/BH|Bottom|PBH|pbh|Projected/i)) {
            console.log(`${field}: ${sample[field] || 'N/A'}`);
          }
        });
        
        console.log("\nAll location fields:");
        fields.forEach(field => {
          if (field.match(/Section|Township|Range|Long|Lat|Location/i)) {
            console.log(`${field}: ${sample[field] || 'N/A'}`);
          }
        });
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

checkPermitFields();