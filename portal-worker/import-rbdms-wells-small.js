#!/usr/bin/env node

/**
 * Import RBDMS wells data from OCC CSV file
 * This version creates smaller batch sizes for D1 compatibility
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Reduce batch size to 100 for D1 compatibility
const RECORDS_PER_BATCH = 100;

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: node import-rbdms-wells-small.js <rbdms-csv-file>');
  console.error('Example: node import-rbdms-wells-small.js /tmp/rbdms-wells.csv');
  process.exit(1);
}

const csvFile = args[0];
if (!fs.existsSync(csvFile)) {
  console.error(`Error: File not found: ${csvFile}`);
  process.exit(1);
}

// Create sql-imports directory if it doesn't exist
const sqlDir = './sql-imports-small';
if (!fs.existsSync(sqlDir)) {
  fs.mkdirSync(sqlDir, { recursive: true });
}

// Read and parse CSV
console.log(`Reading wells data from: ${csvFile}`);
const csvContent = fs.readFileSync(csvFile, 'utf-8');

console.log('Parsing CSV data...');
const records = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  trim: true
});

console.log(`Loaded ${records.length} well records`);

// Process records
const wells = [];
let skipped = 0;

for (let i = 0; i < records.length; i++) {
  const record = records[i];
  
  // Log progress
  if ((i + 1) % 10000 === 0) {
    console.log(`Processed ${i + 1} records...`);
  }
  
  // Extract fields
  const api = record.API ? record.API.trim() : '';
  const wellName = record.WELL_NAME ? record.WELL_NAME.trim() : '';
  const wellNumber = record.WELL_NUM ? record.WELL_NUM.trim() : '';
  const section = record.SECTION ? parseInt(record.SECTION) : null;
  const township = record.TOWNSHIP ? record.TOWNSHIP.trim() : '';
  const range = record.RANGE ? record.RANGE.trim() : '';
  const pm = record.PM ? record.PM.trim().toUpperCase() : '';
  const county = record.COUNTY ? record.COUNTY.trim() : '';
  const lat = record.SH_LAT ? parseFloat(record.SH_LAT) : null;
  const lon = record.SH_LON ? parseFloat(record.SH_LON) : null;
  const operator = record.OPERATOR ? record.OPERATOR.trim() : '';
  const wellType = record.WELLTYPE ? record.WELLTYPE.trim() : '';
  const wellStatus = record.WELLSTATUS ? record.WELLSTATUS.trim() : '';
  
  // Skip if missing required fields
  if (!api || !section || section < 1 || section > 36 || !township || !range || !pm) {
    if (!api) {
      console.log(`Skipping record ${i + 1}: Missing API number`);
    } else if (!section || section < 1 || section > 36) {
      console.log(`Invalid section "${record.SECTION}" for API ${api}`);
    } else {
      console.log(`Missing TRSM data for API ${api}`);
    }
    skipped++;
    continue;
  }
  
  // Validate meridian
  if (pm !== 'IM' && pm !== 'CM') {
    console.log(`Invalid meridian "${pm}" for API ${api}, skipping`);
    skipped++;
    continue;
  }
  
  wells.push({
    api,
    wellName: wellName.replace(/'/g, "''"), // Escape single quotes for SQL
    wellNumber: wellNumber.replace(/'/g, "''"),
    section,
    township,
    range,
    meridian: pm,
    county: county.replace(/'/g, "''"),
    latitude: lat,
    longitude: lon,
    operator: operator.replace(/'/g, "''"),
    wellType,
    wellStatus,
    spudDate: null, // Not in RBDMS export
    completionDate: null, // Not in RBDMS export
    source: 'RBDMS'
  });
}

console.log(`\n${wells.length} valid records to import (${skipped} skipped)`);

// Create SQL files with smaller batches
const totalFiles = Math.ceil(wells.length / RECORDS_PER_BATCH);
console.log(`Creating ${totalFiles} SQL files...`);

for (let fileNum = 0; fileNum < totalFiles; fileNum++) {
  const start = fileNum * RECORDS_PER_BATCH;
  const end = Math.min(start + RECORDS_PER_BATCH, wells.length);
  const batch = wells.slice(start, end);
  
  // Create SQL content
  const values = batch.map(well => {
    const lat = well.latitude !== null ? well.latitude : 'NULL';
    const lon = well.longitude !== null ? well.longitude : 'NULL';
    const spud = well.spudDate ? `'${well.spudDate}'` : 'NULL';
    const comp = well.completionDate ? `'${well.completionDate}'` : 'NULL';
    
    return `('${well.api}', '${well.wellName}', '${well.wellNumber}', ${well.section}, '${well.township}', '${well.range}', '${well.meridian}', '${well.county}', ${lat}, ${lon}, '${well.operator}', '${well.wellType}', '${well.wellStatus}', ${spud}, ${comp}, '${well.source}')`;
  });
  
  const sql = `-- RBDMS Wells Import from OCC (Small Batches)
-- File ${fileNum + 1} of ${totalFiles}
-- Records: ${batch.length}
-- Generated: ${new Date().toISOString()}

-- Use INSERT OR REPLACE to handle duplicates
INSERT OR REPLACE INTO wells (
  api_number, well_name, well_number,
  section, township, range, meridian,
  county, latitude, longitude,
  operator, well_type, well_status,
  spud_date, completion_date, source
) VALUES
${values.join(',\n')};`;
  
  // Write to file
  const fileName = `${sqlDir}/rbdms-small-${String(fileNum + 1).padStart(4, '0')}.sql`;
  fs.writeFileSync(fileName, sql, 'utf-8');
  console.log(`Created ${fileName} (${batch.length} records)`);
}

console.log('\nImport complete!');
console.log(`\nTotal wells: ${wells.length}`);
console.log(`Files created: ${totalFiles}`);
console.log(`Records per file: ${RECORDS_PER_BATCH}`);

console.log('\nTo import into D1 database, run:');
console.log(`  # Import all files (${totalFiles} total):`);
console.log('  for i in ./sql-imports-small/rbdms-small-*.sql; do');
console.log('    echo "Importing $i..."');
console.log('    wrangler d1 execute oklahoma-wells --file="$i" --remote');
console.log('  done');

// Show county distribution
const countyCount = {};
wells.forEach(well => {
  countyCount[well.county] = (countyCount[well.county] || 0) + 1;
});

const topCounties = Object.entries(countyCount)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);

console.log('\nTop counties by well count:');
topCounties.forEach(([county, count]) => {
  console.log(`  ${county}: ${count.toLocaleString()}`);
});

// Show well status distribution
const statusCount = {};
wells.forEach(well => {
  statusCount[well.wellStatus] = (statusCount[well.wellStatus] || 0) + 1;
});

const topStatuses = Object.entries(statusCount)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log('\nWell status distribution:');
topStatuses.forEach(([status, count]) => {
  console.log(`  ${status}: ${count.toLocaleString()}`);
});