#!/usr/bin/env node

/**
 * Fixed script to import township GeoJSON data into D1 with corrected township/range extraction
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

// Fixed extraction functions for PLSS ID format: OK170260N0200W0
function extractTownship(plssId) {
  // After OK prefix (4 chars), next 3 digits are township number, then N/S
  const match = plssId.match(/^OK\d{2}(\d{3})([NS])/);
  if (match) {
    const num = parseInt(match[1], 10);
    const dir = match[2];
    return `${num}${dir}`;
  }
  return 'Unknown';
}

function extractRange(plssId) {
  // After township (OK##000N), next 3 digits are range number, then E/W
  const match = plssId.match(/^OK\d{2}\d{3}[NS](\d{3})([EW])/);
  if (match) {
    const num = parseInt(match[1], 10);
    const dir = match[2];
    return `${num}${dir}`;
  }
  return 'Unknown';
}

function extractMeridian(plssId) {
  if (plssId.startsWith('OK11')) return 'CM'; // Cimarron Meridian
  if (plssId.startsWith('OK17')) return 'IM'; // Indian Meridian  
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
  let unknownCount = 0;
  
  for (let i = 0; i < townshipData.features.length; i += BATCH_SIZE) {
    const batch = townshipData.features.slice(i, i + BATCH_SIZE);
    const statements = [];
    
    for (const feature of batch) {
      const props = feature.properties;
      const geometry = simplifyGeometry(feature.geometry);
      const centroid = calculateCentroid(geometry);
      
      const plssId = props.PLSSID || props.plss_id || props.ID || 'Unknown';
      
      // Try to get township/range from properties first, then extract from PLSS ID
      let township = props.TWNSHP || props.township || props.TWN;
      let range = props.RANGE || props.range || props.RNG;
      
      if (!township || township === 'Unknown') {
        township = extractTownship(plssId);
      }
      if (!range || range === 'Unknown') {
        range = extractRange(plssId);
      }
      
      const meridian = extractMeridian(plssId);
      const county = props.COUNTY || props.county || null;
      const area = props.area || props.AREA || null;
      
      // Track meridian counts
      if (meridian === 'CM') cmCount++;
      else if (meridian === 'IM') imCount++;
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
  
  console.log(`Split ${townshipData.features.length} townships into ${batches.length} batches`);
  console.log(`Meridian distribution: CM=${cmCount}, IM=${imCount}, Unknown=${unknownCount}`);
  
  return batches;
}

async function checkExistingTownships() {
  console.log('\nChecking what townships are already imported...');
  console.log('Run this command to check:');
  console.log('npx wrangler d1 execute oklahoma-wells --command="SELECT COUNT(*) as count FROM townships;" --remote');
  console.log('\nTo clear existing townships before re-import:');
  console.log('npx wrangler d1 execute oklahoma-wells --command="DELETE FROM townships;" --remote');
}

async function main() {
  try {
    console.log('Generating fixed township SQL import statements...\n');
    
    // Create imports directory
    await fs.mkdir('imports-fixed', { recursive: true });
    
    // Generate SQL for townships in batches
    const townshipBatches = await generateTownshipBatches();
    
    // Show sample of first batch to verify extraction
    console.log('\nSample from first batch:');
    const firstBatch = townshipBatches[0];
    for (let i = 0; i < Math.min(3, firstBatch.length); i++) {
      const match = firstBatch[i].match(/VALUES \(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/);
      if (match) {
        console.log(`  PLSS: ${match[1]}, Township: ${match[2]}, Range: ${match[3]}, Meridian: ${match[4]}`);
      }
    }
    
    // Write batch files
    for (let i = 0; i < townshipBatches.length; i++) {
      const filename = `imports-fixed/townships-batch-${i + 1}.sql`;
      await fs.writeFile(filename, townshipBatches[i].join('\n'));
      console.log(`✓ Wrote ${filename}`);
    }
    
    console.log('\nNext steps:');
    await checkExistingTownships();
    
    console.log('\nThen import townships (starting from batch 6 if 250 already imported):');
    for (let i = 5; i < Math.min(10, townshipBatches.length); i++) {
      console.log(`   npx wrangler d1 execute oklahoma-wells --file=./imports-fixed/townships-batch-${i + 1}.sql --remote`);
    }
    if (townshipBatches.length > 10) {
      console.log(`   ... and ${townshipBatches.length - 10} more batches`);
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();