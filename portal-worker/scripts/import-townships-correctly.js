#!/usr/bin/env node

/**
 * Correct script to import township GeoJSON data using the actual property names
 */

const fs = require('fs').promises;
const path = require('path');

async function loadGeoJSON(filename) {
  const filepath = path.join(__dirname, '..', 'public', 'assets', filename);
  const content = await fs.readFile(filepath, 'utf8');
  return JSON.parse(content);
}

function calculateCentroid(geometry) {
  let totalLat = 0;
  let totalLng = 0;
  let pointCount = 0;
  
  function processCoordinates(coords) {
    if (Array.isArray(coords[0])) {
      coords.forEach(processCoordinates);
    } else {
      totalLng += coords[0];
      totalLat += coords[1];
      pointCount++;
    }
  }
  
  if (geometry.type === 'Polygon') {
    processCoordinates(geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => {
      processCoordinates(polygon[0]);
    });
  }
  
  return {
    lat: totalLat / pointCount,
    lng: totalLng / pointCount
  };
}

// Simplify geometry to reduce size
function simplifyGeometry(geometry) {
  function roundCoords(coords) {
    if (typeof coords[0] === 'number') {
      return [
        Math.round(coords[0] * 100000) / 100000,
        Math.round(coords[1] * 100000) / 100000
      ];
    }
    return coords.map(roundCoords);
  }
  
  return {
    type: geometry.type,
    coordinates: roundCoords(geometry.coordinates)
  };
}

// Build township string from components (e.g., "026" + "N" = "26N")
function formatTownship(townshipNo, townshipDir) {
  if (!townshipNo || !townshipDir) return 'Unknown';
  const num = parseInt(townshipNo, 10);
  return `${num}${townshipDir}`;
}

// Build range string from components (e.g., "020" + "W" = "20W")
function formatRange(rangeNo, rangeDir) {
  if (!rangeNo || !rangeDir) return 'Unknown';
  const num = parseInt(rangeNo, 10);
  return `${num}${rangeDir}`;
}

// Extract meridian from PLSS ID or use property
function getMeridian(props, plssId) {
  // Check property first
  if (props.PRINMERCD === '11' || props.PRINMER === 'Cimarron Meridian') return 'CM';
  if (props.PRINMERCD === '17' || props.PRINMER === 'Indian Meridian') return 'IM';
  
  // Fall back to PLSS ID prefix
  if (plssId.startsWith('OK11')) return 'CM';
  if (plssId.startsWith('OK17')) return 'IM';
  
  return 'IM'; // Default to Indian Meridian
}

async function generateTownshipBatches() {
  console.log('Loading township data...');
  const townshipData = await loadGeoJSON('PLSS_Township_simplified.geojson');
  
  const BATCH_SIZE = 50; // Townships per file
  const batches = [];
  
  // Track stats
  let cmCount = 0;
  let imCount = 0;
  let validCount = 0;
  let unknownCount = 0;
  
  // Map to track panhandle counties
  const panhandleCounties = new Set(['BEAVER', 'CIMARRON', 'TEXAS']);
  
  for (let i = 0; i < townshipData.features.length; i += BATCH_SIZE) {
    const batch = townshipData.features.slice(i, i + BATCH_SIZE);
    const statements = [];
    
    for (const feature of batch) {
      const props = feature.properties;
      const geometry = simplifyGeometry(feature.geometry);
      const centroid = calculateCentroid(geometry);
      
      const plssId = props.PLSSID || 'Unknown';
      
      // Use the actual property names from the GeoJSON
      const township = formatTownship(props.TWNSHPNO, props.TWNSHPDIR);
      const range = formatRange(props.RANGENO, props.RANGEDIR);
      const meridian = getMeridian(props, plssId);
      
      // Try to extract county from various possible fields
      let county = props.COUNTY || props.county || props.COUNTY_NAME || null;
      
      // Verify meridian based on county if available
      if (county && panhandleCounties.has(county.toUpperCase())) {
        if (meridian !== 'CM') {
          console.warn(`Warning: ${county} county township has ${meridian} meridian, should be CM`);
        }
      }
      
      const area = props.ShapeSTArea ? (props.ShapeSTArea / 27878400).toFixed(2) : null; // Convert sq feet to sq miles
      
      // Track stats
      if (meridian === 'CM') cmCount++;
      else if (meridian === 'IM') imCount++;
      
      if (township !== 'Unknown' && range !== 'Unknown') validCount++;
      else unknownCount++;
      
      const sql = `INSERT INTO townships (plss_id, township, range, meridian, county_name, geometry, center_lat, center_lng, area_sq_miles) VALUES (
        '${plssId.replace(/'/g, "''")}',
        '${township.replace(/'/g, "''")}',
        '${range.replace(/'/g, "''")}',
        '${meridian}',
        ${county ? `'${county.replace(/'/g, "''")}'` : 'NULL'},
        '${JSON.stringify(geometry).replace(/'/g, "''")}',
        ${centroid.lat},
        ${centroid.lng},
        ${area || 'NULL'}
      );`;
      
      statements.push(sql);
    }
    
    batches.push(statements);
  }
  
  console.log(`\nProcessed ${townshipData.features.length} townships:`);
  console.log(`  - Valid township/range: ${validCount}`);
  console.log(`  - Unknown values: ${unknownCount}`);
  console.log(`  - Cimarron Meridian (CM): ${cmCount}`);
  console.log(`  - Indian Meridian (IM): ${imCount}`);
  console.log(`  - Batches created: ${batches.length}`);
  
  return batches;
}

async function main() {
  try {
    console.log('Generating corrected township SQL import statements...\n');
    
    // Create imports directory
    await fs.mkdir('imports-correct', { recursive: true });
    
    // Generate SQL for townships in batches
    const townshipBatches = await generateTownshipBatches();
    
    // Show sample from first few batches
    console.log('\nSample townships:');
    for (let b = 0; b < Math.min(3, townshipBatches.length); b++) {
      const batch = townshipBatches[b];
      console.log(`\nBatch ${b + 1}:`);
      for (let i = 0; i < Math.min(2, batch.length); i++) {
        const match = batch[i].match(/VALUES \(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/);
        if (match) {
          console.log(`  PLSS: ${match[1]}, T${match[2]} R${match[3]} ${match[4]}`);
        }
      }
    }
    
    // Write batch files
    for (let i = 0; i < townshipBatches.length; i++) {
      const filename = `imports-correct/townships-batch-${i + 1}.sql`;
      await fs.writeFile(filename, townshipBatches[i].join('\n'));
    }
    console.log(`\n✓ Created ${townshipBatches.length} batch files in imports-correct/`);
    
    console.log('\nNext steps:');
    console.log('1. Clear existing townships with bad data:');
    console.log('   npx wrangler d1 execute oklahoma-wells --command="DELETE FROM townships;" --remote');
    
    console.log('\n2. Import corrected townships:');
    for (let i = 0; i < Math.min(5, townshipBatches.length); i++) {
      console.log(`   npx wrangler d1 execute oklahoma-wells --file=./imports-correct/townships-batch-${i + 1}.sql --remote`);
    }
    console.log('   ... continue with remaining batches');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();