#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

async function extractCounties() {
  console.log('Loading county GeoJSON...');
  const filepath = path.join(__dirname, '..', 'public', 'assets', 'County_Boundaries_2423125635378062927.geojson');
  const content = await fs.readFile(filepath, 'utf8');
  const data = JSON.parse(content);
  
  // Find ATOKA and BRYAN counties
  const missingCounties = data.features.filter(f => 
    f.properties.COUNTY_NAME === 'ATOKA' || 
    f.properties.COUNTY_NAME === 'BRYAN'
  );
  
  console.log(`Found ${missingCounties.length} counties to extract`);
  
  for (const county of missingCounties) {
    const name = county.properties.COUNTY_NAME;
    const coords = JSON.stringify(county.geometry.coordinates);
    const coordCount = coords.split('[').length - 1;
    const charCount = coords.length;
    
    console.log(`\n${name} County:`);
    console.log(`  - Coordinate arrays: ${coordCount}`);
    console.log(`  - Character count: ${charCount.toLocaleString()}`);
    console.log(`  - Geometry type: ${county.geometry.type}`);
    
    if (county.geometry.type === 'MultiPolygon') {
      console.log(`  - Number of polygons: ${county.geometry.coordinates.length}`);
    }
    
    // Save individual county files
    const countyFile = {
      type: "FeatureCollection",
      features: [county]
    };
    
    await fs.writeFile(`${name.toLowerCase()}-county.geojson`, JSON.stringify(countyFile, null, 2));
    console.log(`  - Saved to ${name.toLowerCase()}-county.geojson`);
  }
  
  // Create combined fallback file
  const fallback = {
    type: "FeatureCollection", 
    features: missingCounties
  };
  
  await fs.writeFile('missing-counties-fallback.geojson', JSON.stringify(fallback, null, 2));
  console.log('\nCreated missing-counties-fallback.geojson with both counties');
}

extractCounties().catch(console.error);