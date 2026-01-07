#!/usr/bin/env node

/**
 * Script to import county and township GeoJSON data into D1
 * 
 * Usage:
 * 1. First run the D1 migration to create tables:
 *    npx wrangler d1 execute oklahoma-wells --file=./migrations/003_geographic_data.sql
 * 
 * 2. Then run this script to import data:
 *    node scripts/import-map-data.js
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
      // Nested array
      coords.forEach(processCoordinates);
    } else {
      // Coordinate pair [lng, lat]
      totalLng += coords[0];
      totalLat += coords[1];
      pointCount++;
    }
  }
  
  if (geometry.type === 'Polygon') {
    processCoordinates(geometry.coordinates[0]); // Use outer ring
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => {
      processCoordinates(polygon[0]); // Use outer ring of each polygon
    });
  }
  
  return {
    lat: totalLat / pointCount,
    lng: totalLng / pointCount
  };
}

async function generateCountySQL() {
  console.log('Loading county data...');
  const countyData = await loadGeoJSON('County_Boundaries_2423125635378062927.geojson');
  
  const statements = [];
  
  for (const feature of countyData.features) {
    const props = feature.properties;
    const geometry = feature.geometry;
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
  
  console.log(`Generated ${statements.length} county INSERT statements`);
  return statements;
}

async function generateTownshipSQL() {
  console.log('Loading township data...');
  const townshipData = await loadGeoJSON('PLSS_Township_simplified.geojson');
  
  const statements = [];
  
  for (const feature of townshipData.features) {
    const props = feature.properties;
    const geometry = feature.geometry;
    const centroid = calculateCentroid(geometry);
    
    // Extract township/range from various possible property names
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
  
  console.log(`Generated ${statements.length} township INSERT statements`);
  return statements;
}

function extractTownship(plssId) {
  // Extract township from PLSS ID like "OK110090N0150W0SN"
  const match = plssId.match(/(\d{2}[NS])/);
  return match ? match[1] : 'Unknown';
}

function extractRange(plssId) {
  // Extract range from PLSS ID like "OK110090N0150W0SN"
  const match = plssId.match(/(\d{2}[EW])/);
  return match ? match[1] : 'Unknown';
}

function extractMeridian(plssId) {
  // OK11 = Cimarron Meridian, OK20 = Indian Meridian
  if (plssId.startsWith('OK11')) return 'CM';
  if (plssId.startsWith('OK20')) return 'IM';
  return 'IM'; // Default to Indian Meridian
}

async function main() {
  try {
    console.log('Generating SQL import statements...\n');
    
    // Generate SQL for counties
    const countySQL = await generateCountySQL();
    await fs.writeFile('import-counties.sql', countySQL.join('\n'));
    console.log('✓ Wrote import-counties.sql\n');
    
    // Generate SQL for townships
    const townshipSQL = await generateTownshipSQL();
    await fs.writeFile('import-townships.sql', townshipSQL.join('\n'));
    console.log('✓ Wrote import-townships.sql\n');
    
    console.log('Next steps:');
    console.log('1. Run the migration if not already done:');
    console.log('   npx wrangler d1 execute oklahoma-wells --file=./migrations/003_geographic_data.sql\n');
    console.log('2. Import counties:');
    console.log('   npx wrangler d1 execute oklahoma-wells --file=./import-counties.sql\n');
    console.log('3. Import townships:');
    console.log('   npx wrangler d1 execute oklahoma-wells --file=./import-townships.sql\n');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();