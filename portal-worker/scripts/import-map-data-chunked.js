#!/usr/bin/env node

/**
 * Script to import county and township GeoJSON data into D1 in chunks
 * 
 * This version splits the data into smaller files to avoid D1 statement size limits
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
  // For now, just round coordinates to 5 decimal places
  function roundCoords(coords) {
    if (typeof coords[0] === 'number') {
      return [
        Math.round(coords[0] * 100000) / 100000,
        Math.round(coords[1] * 100000) / 100000
      ];
    }
    return coords.map(roundCoords);
  }
  
  const simplified = {
    type: geometry.type,
    coordinates: roundCoords(geometry.coordinates)
  };
  
  return simplified;
}

async function generateCountyBatches() {
  console.log('Loading county data...');
  const countyData = await loadGeoJSON('County_Boundaries_2423125635378062927.geojson');
  
  const BATCH_SIZE = 10; // Counties per file
  const batches = [];
  
  for (let i = 0; i < countyData.features.length; i += BATCH_SIZE) {
    const batch = countyData.features.slice(i, i + BATCH_SIZE);
    const statements = [];
    
    for (const feature of batch) {
      const props = feature.properties;
      const geometry = simplifyGeometry(feature.geometry);
      const centroid = calculateCentroid(geometry);
      
      const name = props.name || props.NAME || props.County || 'Unknown';
      const fipsCode = props.fips_code || props.FIPS || props.GEOID || null;
      const area = props.area || props.AREA || null;
      
      const sql = `INSERT INTO counties (name, fips_code, geometry, center_lat, center_lng, area_sq_miles) VALUES (
        '${name.replace(/'/g, "''")}',
        ${fipsCode ? `'${fipsCode}'` : 'NULL'},
        '${JSON.stringify(geometry).replace(/'/g, "''")}',
        ${centroid.lat},
        ${centroid.lng},
        ${area || 'NULL'}
      );`;
      
      statements.push(sql);
    }
    
    batches.push(statements);
  }
  
  console.log(`Split ${countyData.features.length} counties into ${batches.length} batches`);
  return batches;
}

async function generateTownshipBatches() {
  console.log('Loading township data...');
  const townshipData = await loadGeoJSON('PLSS_Township_simplified.geojson');
  
  const BATCH_SIZE = 50; // Townships per file
  const batches = [];
  
  for (let i = 0; i < townshipData.features.length; i += BATCH_SIZE) {
    const batch = townshipData.features.slice(i, i + BATCH_SIZE);
    const statements = [];
    
    for (const feature of batch) {
      const props = feature.properties;
      const geometry = simplifyGeometry(feature.geometry);
      const centroid = calculateCentroid(geometry);
      
      const plssId = props.PLSSID || props.plss_id || props.ID || 'Unknown';
      const township = props.TWNSHP || props.township || props.TWN || extractTownship(plssId);
      const range = props.RANGE || props.range || props.RNG || extractRange(plssId);
      const meridian = extractMeridian(plssId);
      const county = props.COUNTY || props.county || null;
      const area = props.area || props.AREA || null;
      
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
  
  console.log(`Split ${townshipData.features.length} townships into ${batches.length} batches`);
  return batches;
}

function extractTownship(plssId) {
  const match = plssId.match(/(\d{2}[NS])/);
  return match ? match[1] : 'Unknown';
}

function extractRange(plssId) {
  const match = plssId.match(/(\d{2}[EW])/);
  return match ? match[1] : 'Unknown';
}

function extractMeridian(plssId) {
  if (plssId.startsWith('OK11')) return 'CM';
  if (plssId.startsWith('OK20')) return 'IM';
  return 'IM';
}

async function main() {
  try {
    console.log('Generating chunked SQL import statements...\n');
    
    // Create imports directory
    await fs.mkdir('imports', { recursive: true });
    
    // Generate SQL for counties in batches
    const countyBatches = await generateCountyBatches();
    for (let i = 0; i < countyBatches.length; i++) {
      const filename = `imports/counties-batch-${i + 1}.sql`;
      await fs.writeFile(filename, countyBatches[i].join('\n'));
      console.log(`✓ Wrote ${filename}`);
    }
    console.log();
    
    // Generate SQL for townships in batches
    const townshipBatches = await generateTownshipBatches();
    for (let i = 0; i < townshipBatches.length; i++) {
      const filename = `imports/townships-batch-${i + 1}.sql`;
      await fs.writeFile(filename, townshipBatches[i].join('\n'));
      console.log(`✓ Wrote ${filename}`);
    }
    console.log();
    
    console.log('Next steps:');
    console.log('1. Import counties (run each batch):');
    for (let i = 0; i < countyBatches.length; i++) {
      console.log(`   npx wrangler d1 execute oklahoma-wells --file=./imports/counties-batch-${i + 1}.sql --remote`);
    }
    console.log();
    console.log('2. Import townships (run each batch):');
    for (let i = 0; i < Math.min(5, townshipBatches.length); i++) {
      console.log(`   npx wrangler d1 execute oklahoma-wells --file=./imports/townships-batch-${i + 1}.sql --remote`);
    }
    if (townshipBatches.length > 5) {
      console.log(`   ... and ${townshipBatches.length - 5} more batches`);
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();