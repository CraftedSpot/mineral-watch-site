#!/usr/bin/env node

const fs = require('fs').promises;

// Simplify coordinates by reducing precision and removing some points
function simplifyCoordinates(coords, tolerance = 0.0001) {
  if (typeof coords[0] === 'number') {
    // Round to 4 decimal places
    return [
      Math.round(coords[0] * 10000) / 10000,
      Math.round(coords[1] * 10000) / 10000
    ];
  }
  
  if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
    // This is a ring of coordinates - apply Douglas-Peucker-like simplification
    const simplified = [];
    let lastPoint = null;
    
    for (let i = 0; i < coords.length; i++) {
      const point = coords[i];
      const roundedPoint = [
        Math.round(point[0] * 10000) / 10000,
        Math.round(point[1] * 10000) / 10000
      ];
      
      // Always keep first and last points
      if (i === 0 || i === coords.length - 1) {
        simplified.push(roundedPoint);
        lastPoint = roundedPoint;
      } else {
        // Keep point if it's far enough from the last kept point
        if (lastPoint) {
          const dx = roundedPoint[0] - lastPoint[0];
          const dy = roundedPoint[1] - lastPoint[1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          // Keep every 3rd point or if distance is significant
          if (i % 3 === 0 || dist > tolerance) {
            simplified.push(roundedPoint);
            lastPoint = roundedPoint;
          }
        }
      }
    }
    
    return simplified;
  }
  
  // Recursively simplify nested arrays
  return coords.map(c => simplifyCoordinates(c, tolerance));
}

async function simplifyAndImport() {
  try {
    // Load the extracted counties
    const bryan = JSON.parse(await fs.readFile('bryan-county.geojson', 'utf8'));
    const atoka = JSON.parse(await fs.readFile('atoka-county.geojson', 'utf8'));
    
    console.log('Original BRYAN geometry size:', JSON.stringify(bryan.features[0].geometry).length);
    console.log('Original ATOKA geometry size:', JSON.stringify(atoka.features[0].geometry).length);
    
    // Simplify BRYAN county geometry
    const bryanFeature = bryan.features[0];
    const simplifiedBryanCoords = simplifyCoordinates(bryanFeature.geometry.coordinates, 0.001);
    bryanFeature.geometry.coordinates = simplifiedBryanCoords;
    
    console.log('Simplified BRYAN geometry size:', JSON.stringify(bryanFeature.geometry).length);
    
    // Generate SQL for both counties
    function generateCountySQL(feature) {
      const props = feature.properties;
      const geometry = feature.geometry;
      
      // Calculate centroid
      let totalLat = 0, totalLng = 0, pointCount = 0;
      const coords = geometry.coordinates[0];
      for (const point of coords) {
        totalLng += point[0];
        totalLat += point[1];
        pointCount++;
      }
      
      const centerLat = totalLat / pointCount;
      const centerLng = totalLng / pointCount;
      
      const name = props.COUNTY_NAME;
      const fipsCode = props.COUNTY_FIPS_NO;
      
      return `INSERT INTO counties (name, fips_code, geometry, center_lat, center_lng) VALUES (
        '${name}',
        '${fipsCode}',
        '${JSON.stringify(geometry).replace(/'/g, "''")}',
        ${centerLat},
        ${centerLng}
      );`;
    }
    
    // Create import SQL files
    const bryanSQL = generateCountySQL(bryanFeature);
    const atokaSQL = generateCountySQL(atoka.features[0]);
    
    await fs.writeFile('import-bryan-county.sql', bryanSQL);
    await fs.writeFile('import-atoka-county.sql', atokaSQL);
    
    console.log('\nGenerated SQL files:');
    console.log('- import-bryan-county.sql (' + bryanSQL.length + ' chars)');
    console.log('- import-atoka-county.sql (' + atokaSQL.length + ' chars)');
    
    // Also create a static fallback file for the map
    const fallback = {
      type: "FeatureCollection",
      features: [bryanFeature, atoka.features[0]]
    };
    
    await fs.writeFile('public/assets/missing-counties-fallback.geojson', JSON.stringify(fallback));
    console.log('\nCreated public/assets/missing-counties-fallback.geojson for map fallback');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

simplifyAndImport();