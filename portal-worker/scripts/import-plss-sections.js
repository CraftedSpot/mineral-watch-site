#!/usr/bin/env node
/**
 * Import Oklahoma PLSS Sections from OCC GIS into D1
 *
 * Usage: node scripts/import-plss-sections.js
 */

const BASE_URL = 'https://gis.occ.ok.gov/server/rest/services/Hosted/STR/FeatureServer/226/query';
const PAGE_SIZE = 2000;
const OUTPUT_FILE = '/tmp/oklahoma-plss-sections.json';

async function fetchAllSections() {
  const allFeatures = [];
  let offset = 0;
  let batch = 1;

  console.log('Fetching Oklahoma PLSS sections from OCC GIS...\n');

  while (true) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: 'frstdivid,plssid,frstdivno,gisacre',
      returnGeometry: 'true',
      resultOffset: offset.toString(),
      resultRecordCount: PAGE_SIZE.toString()
    });

    const url = `${BASE_URL}?${params.toString()}`;
    console.log(`Batch ${batch}: Fetching offset ${offset}...`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const features = data.features || [];

    if (features.length === 0) {
      console.log('No more features, done fetching.');
      break;
    }

    allFeatures.push(...features);
    console.log(`  Got ${features.length} features (total: ${allFeatures.length})`);

    offset += PAGE_SIZE;
    batch++;

    // Small delay to be nice to the server
    await new Promise(r => setTimeout(r, 200));

    if (features.length < PAGE_SIZE) {
      console.log('Last page received, done fetching.');
      break;
    }
  }

  return allFeatures;
}

function parseFeature(feature) {
  const props = feature.properties;
  const frstdivid = props.frstdivid || '';

  // Parse the PLSS ID: OK170010N0240W0SN310
  // Format: OK{meridian}{township}N{range}W0SN{section}
  // Meridian: 17 = Indian, 11 = Cimarron
  const meridianCode = frstdivid.substring(2, 4);
  const meridian = meridianCode === '11' ? 'cimarron' : 'indian';

  // Extract township (e.g., "0010N" -> "10N" or "0010S" -> "10S")
  const townshipMatch = frstdivid.match(/(\d{4})([NS])/);
  const township = townshipMatch ? townshipMatch[1].replace(/^0+/, '') + townshipMatch[2] : '';

  // Extract range: format is 0{RR}0{E/W} where RR is 2-digit range
  // e.g., "0240W" -> skip 0, take "24", skip 0, take "W" -> "24W"
  // Pattern: after township direction (N/S), there's 0 + 2 digits + 0 + E/W
  const rangeMatch = frstdivid.match(/[NS]0(\d{2})0([EW])/);
  const range = rangeMatch ? rangeMatch[1].replace(/^0+/, '') + rangeMatch[2] : '';

  // Section number
  const section = props.frstdivno || '';

  return {
    id: frstdivid,
    section,
    township,
    range,
    meridian,
    acres: props.gisacre || 0,
    geometry: JSON.stringify(feature.geometry)
  };
}

async function main() {
  try {
    // Fetch all sections
    const features = await fetchAllSections();
    console.log(`\nTotal sections fetched: ${features.length}`);

    // Parse features
    console.log('\nParsing features...');
    const sections = features.map(parseFeature);

    // Write to file for wrangler d1 import
    console.log(`\nWriting to ${OUTPUT_FILE}...`);
    const fs = await import('fs');
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sections, null, 2));
    console.log('Done!');

    // Show sample
    console.log('\nSample parsed section:');
    console.log(JSON.stringify(sections[0], null, 2));

    // Generate SQL insert statements in batches
    console.log('\nGenerating SQL insert file...');
    const sqlFile = '/tmp/plss-inserts.sql';
    let sql = '';

    // Use individual inserts to avoid statement size limits
    const BATCH_SIZE = 10;  // Small batches due to large geometry strings
    for (let i = 0; i < sections.length; i += BATCH_SIZE) {
      const batch = sections.slice(i, i + BATCH_SIZE);
      const values = batch.map(s =>
        `('${s.id}', '${s.section}', '${s.township}', '${s.range}', '${s.meridian}', ${s.acres}, '${s.geometry.replace(/'/g, "''")}')`
      ).join(',\n');

      sql += `INSERT OR REPLACE INTO plss_sections (id, section, township, range, meridian, acres, geometry) VALUES\n${values};\n\n`;
    }

    fs.writeFileSync(sqlFile, sql);
    console.log(`SQL file written to ${sqlFile}`);
    console.log(`Total size: ${(sql.length / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
