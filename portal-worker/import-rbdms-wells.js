#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Configuration
const CHUNK_SIZE = 1000;
const INPUT_FILE = process.argv[2] || 'rbdms-wells.csv';
const OUTPUT_DIR = process.argv[3] || './sql-imports';

// Usage check
if (process.argv[2] === '--help') {
  console.log('Usage: node import-rbdms-wells.js [input-file] [output-directory]');
  console.log('');
  console.log('Downloads and imports RBDMS wells data from OCC');
  console.log('Default input: rbdms-wells.csv');
  console.log('Default output: ./sql-imports');
  console.log('');
  console.log('To download fresh data:');
  console.log('  node import-rbdms-wells.js --download');
  process.exit(0);
}

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Helper function to escape SQL strings
function escapeSQLString(value) {
  if (value === null || value === undefined || value === '') {
    return 'NULL';
  }
  // Convert to string and escape single quotes
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

// Helper function to normalize API number (remove dashes/spaces)
function normalizeAPI(api) {
  if (!api) return null;
  return String(api).replace(/[\s-]/g, '');
}

// Helper function to format a well record for SQL
function formatWellForSQL(well) {
  // Normalize and validate API number
  const apiNumber = normalizeAPI(well.API);
  if (!apiNumber) {
    return null;
  }
  
  // Parse section as integer
  const section = parseInt(well.SECTION);
  if (isNaN(section) || section < 1 || section > 36) {
    console.warn(`Invalid section "${well.SECTION}" for API ${apiNumber}`);
    return null;
  }
  
  // Ensure we have required location data
  if (!well.TOWNSHIP || !well.RANGE) {
    console.warn(`Missing township/range for API ${apiNumber}`);
    return null;
  }
  
  // Get meridian (PM field in RBDMS)
  const meridian = (well.PM || 'IM').toUpperCase();
  if (meridian !== 'IM' && meridian !== 'CM') {
    console.warn(`Invalid meridian "${well.PM}" for API ${apiNumber}, defaulting to IM`);
  }
  
  // Parse coordinates
  const latitude = well.SH_LAT ? parseFloat(well.SH_LAT) : 'NULL';
  const longitude = well.SH_LON ? parseFloat(well.SH_LON) : 'NULL';
  
  // Format the VALUES clause
  const values = [
    escapeSQLString(apiNumber),
    escapeSQLString(well.WELL_NAME),
    escapeSQLString(well.WELL_NUM),
    section,
    escapeSQLString(well.TOWNSHIP),
    escapeSQLString(well.RANGE),
    escapeSQLString(meridian),
    escapeSQLString(well.COUNTY),
    latitude,
    longitude,
    escapeSQLString(well.OPERATOR),
    escapeSQLString(well.WELLTYPE),
    escapeSQLString(well.WELLSTATUS),
    'NULL', // spud_date - not in RBDMS data
    'NULL', // completion_date - not in RBDMS data
    escapeSQLString('RBDMS')
  ];
  
  return `(${values.join(', ')})`;
}

// Download RBDMS data from OCC
async function downloadRBDMSData() {
  const url = 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/rbdms-wells.csv';
  console.log('Downloading RBDMS wells data from OCC...');
  
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.text();
    const filename = 'rbdms-wells.csv';
    fs.writeFileSync(filename, data);
    
    const size = (data.length / 1024 / 1024).toFixed(1);
    console.log(`Downloaded ${size}MB to ${filename}`);
    
    return filename;
  } catch (error) {
    console.error('Download failed:', error.message);
    console.log('');
    console.log('You can manually download from:');
    console.log('https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/rbdms-wells.csv');
    process.exit(1);
  }
}

// Main function
async function main() {
  try {
    let inputFile = INPUT_FILE;
    
    // Handle download option
    if (process.argv[2] === '--download') {
      inputFile = await downloadRBDMSData();
    } else if (!fs.existsSync(inputFile)) {
      console.error(`File not found: ${inputFile}`);
      console.log('Use --download flag to fetch latest data from OCC');
      process.exit(1);
    }
    
    console.log(`Reading wells data from: ${inputFile}`);
    const content = fs.readFileSync(inputFile, 'utf8');
    
    // Parse CSV
    console.log('Parsing CSV data...');
    const wells = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true, // Handle inconsistent quoting
      relax_column_count: true // Handle rows with extra/missing columns
    });
    
    console.log(`Loaded ${wells.length} well records`);
    
    // Filter out invalid records and format for SQL
    const validWells = [];
    let skipped = 0;
    
    for (const well of wells) {
      const formatted = formatWellForSQL(well);
      if (formatted) {
        validWells.push(formatted);
      } else {
        skipped++;
      }
      
      // Progress indicator every 10000 records
      if ((validWells.length + skipped) % 10000 === 0) {
        process.stdout.write(`\rProcessed ${validWells.length + skipped} records...`);
      }
    }
    
    console.log(`\n${validWells.length} valid records to import (${skipped} skipped)`);
    
    // Split into chunks and write SQL files
    const chunks = [];
    for (let i = 0; i < validWells.length; i += CHUNK_SIZE) {
      chunks.push(validWells.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`Creating ${chunks.length} SQL files...`);
    
    // Clear old import files
    const existingFiles = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.startsWith('rbdms-import-') && f.endsWith('.sql'));
    existingFiles.forEach(f => fs.unlinkSync(path.join(OUTPUT_DIR, f)));
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const fileNum = String(i + 1).padStart(3, '0');
      const fileName = path.join(OUTPUT_DIR, `rbdms-import-${fileNum}.sql`);
      
      // Build the SQL file content
      let sql = `-- RBDMS Wells Import from OCC
-- File ${i + 1} of ${chunks.length}
-- Records: ${chunk.length}
-- Generated: ${new Date().toISOString()}

BEGIN TRANSACTION;

-- Use INSERT OR REPLACE to handle duplicates
INSERT OR REPLACE INTO wells (
  api_number, well_name, well_number,
  section, township, range, meridian,
  county, latitude, longitude,
  operator, well_type, well_status,
  spud_date, completion_date, source
) VALUES
`;
      
      // Add all the values
      sql += chunk.join(',\n');
      sql += ';\n\nCOMMIT;\n';
      
      // Write the file
      fs.writeFileSync(fileName, sql);
      console.log(`Created ${fileName} (${chunk.length} records)`);
    }
    
    console.log('\nImport complete!');
    console.log(`\nTotal wells: ${validWells.length}`);
    console.log(`Files created: ${chunks.length}`);
    console.log(`Records per file: ${CHUNK_SIZE} (last file: ${validWells.length % CHUNK_SIZE || CHUNK_SIZE})`);
    
    console.log('\nTo import into D1 database, run:');
    if (chunks.length <= 5) {
      // Show all commands if just a few files
      chunks.forEach((_, i) => {
        const fileNum = String(i + 1).padStart(3, '0');
        console.log(`  wrangler d1 execute oklahoma-wells --file=${OUTPUT_DIR}/rbdms-import-${fileNum}.sql`);
      });
    } else {
      // Show pattern for many files
      console.log(`  # Import all files (${chunks.length} total):`);
      console.log(`  for i in ${OUTPUT_DIR}/rbdms-import-*.sql; do`);
      console.log(`    echo "Importing $i..."`);
      console.log(`    wrangler d1 execute oklahoma-wells --file="$i"`);
      console.log(`  done`);
    }
    
    // Summary statistics
    const counties = {};
    const statuses = {};
    wells.forEach(w => {
      if (w.COUNTY) counties[w.COUNTY] = (counties[w.COUNTY] || 0) + 1;
      if (w.WELLSTATUS) statuses[w.WELLSTATUS] = (statuses[w.WELLSTATUS] || 0) + 1;
    });
    
    console.log('\nTop counties by well count:');
    Object.entries(counties)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([county, count]) => {
        console.log(`  ${county}: ${count.toLocaleString()}`);
      });
      
    console.log('\nWell status distribution:');
    Object.entries(statuses)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([status, count]) => {
        console.log(`  ${status}: ${count.toLocaleString()}`);
      });
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run main function
main();