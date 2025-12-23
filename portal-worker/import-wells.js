#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Configuration
const CHUNK_SIZE = 1000;
const INPUT_FILE = process.argv[2];
const OUTPUT_DIR = process.argv[3] || './sql-imports';

// Usage check
if (!INPUT_FILE) {
  console.error('Usage: node import-wells.js <input-file> [output-directory]');
  console.error('');
  console.error('Supported formats: CSV, JSON');
  console.error('');
  console.error('Expected CSV columns:');
  console.error('  api_number, well_name, well_number, section, township, range, meridian,');
  console.error('  county, latitude, longitude, operator, well_type, well_status,');
  console.error('  spud_date, completion_date');
  console.error('');
  console.error('Expected JSON structure:');
  console.error('  Array of objects with the same field names as CSV columns');
  process.exit(1);
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

// Helper function to format a well record for SQL
function formatWellForSQL(well) {
  // Ensure required fields are present
  if (!well.api_number) {
    console.warn('Skipping record without api_number:', well);
    return null;
  }
  
  // Validate and format meridian
  const meridian = (well.meridian || '').toUpperCase();
  if (meridian !== 'IM' && meridian !== 'CM') {
    console.warn(`Invalid meridian "${well.meridian}" for API ${well.api_number}, defaulting to IM`);
    well.meridian = 'IM';
  }
  
  // Ensure section is a number
  const section = parseInt(well.section);
  if (isNaN(section) || section < 1 || section > 36) {
    console.warn(`Invalid section "${well.section}" for API ${well.api_number}`);
    return null;
  }
  
  // Format the VALUES clause
  const values = [
    escapeSQLString(well.api_number),
    escapeSQLString(well.well_name),
    escapeSQLString(well.well_number),
    section, // Integer, no quotes
    escapeSQLString(well.township),
    escapeSQLString(well.range),
    escapeSQLString(well.meridian),
    escapeSQLString(well.county),
    well.latitude ? parseFloat(well.latitude) : 'NULL',
    well.longitude ? parseFloat(well.longitude) : 'NULL',
    escapeSQLString(well.operator),
    escapeSQLString(well.well_type),
    escapeSQLString(well.well_status),
    escapeSQLString(well.spud_date),
    escapeSQLString(well.completion_date),
    escapeSQLString(well.source || 'OCC')
  ];
  
  return `(${values.join(', ')})`;
}

// Load data based on file extension
function loadData(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf8');
  
  if (ext === '.json') {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) {
      throw new Error('JSON file must contain an array of well records');
    }
    return data;
  } else if (ext === '.csv') {
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } else {
    throw new Error('Unsupported file format. Use .json or .csv');
  }
}

// Main function
async function main() {
  try {
    console.log(`Reading wells data from: ${INPUT_FILE}`);
    
    // Load the data
    const wells = loadData(INPUT_FILE);
    console.log(`Loaded ${wells.length} well records`);
    
    // Filter out invalid records
    const validWells = [];
    for (const well of wells) {
      const formatted = formatWellForSQL(well);
      if (formatted) {
        validWells.push(formatted);
      }
    }
    
    console.log(`${validWells.length} valid records to import`);
    
    // Split into chunks and write SQL files
    const chunks = [];
    for (let i = 0; i < validWells.length; i += CHUNK_SIZE) {
      chunks.push(validWells.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`Creating ${chunks.length} SQL files...`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const fileNum = String(i + 1).padStart(2, '0');
      const fileName = path.join(OUTPUT_DIR, `wells-import-${fileNum}.sql`);
      
      // Build the SQL file content
      let sql = '-- Oklahoma Wells Import\n';
      sql += `-- File ${i + 1} of ${chunks.length}\n`;
      sql += `-- Records: ${chunk.length}\n\n`;
      
      // Add transaction wrapper for safety
      sql += 'BEGIN TRANSACTION;\n\n';
      
      // Build INSERT statement
      sql += 'INSERT INTO wells (\n';
      sql += '  api_number, well_name, well_number,\n';
      sql += '  section, township, range, meridian,\n';
      sql += '  county, latitude, longitude,\n';
      sql += '  operator, well_type, well_status,\n';
      sql += '  spud_date, completion_date, source\n';
      sql += ') VALUES\n';
      
      // Add all the values
      sql += chunk.join(',\n');
      sql += ';\n\n';
      
      // Close transaction
      sql += 'COMMIT;\n';
      
      // Write the file
      fs.writeFileSync(fileName, sql);
      console.log(`Created ${fileName} (${chunk.length} records)`);
    }
    
    console.log('\nImport complete!');
    console.log('\nTo import into D1 database, run:');
    chunks.forEach((_, i) => {
      const fileNum = String(i + 1).padStart(2, '0');
      console.log(`  wrangler d1 execute oklahoma-wells --file=${OUTPUT_DIR}/wells-import-${fileNum}.sql`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Example data structure for reference
function generateExampleData() {
  const example = {
    csv: `api_number,well_name,well_number,section,township,range,meridian,county,latitude,longitude,operator,well_type,well_status,spud_date,completion_date
3501122334,SMITH 1-15,1-15,15,9N,5W,IM,Cleveland,35.123,-97.456,XTO Energy,Oil,Active,2023-01-15,2023-03-20
3502344556,JONES 2-10,2-10,10,10N,4W,IM,Oklahoma,35.234,-97.567,Continental,Gas,Producing,2023-02-01,2023-04-15`,
    
    json: [
      {
        api_number: "3501122334",
        well_name: "SMITH 1-15",
        well_number: "1-15",
        section: 15,
        township: "9N",
        range: "5W",
        meridian: "IM",
        county: "Cleveland",
        latitude: 35.123,
        longitude: -97.456,
        operator: "XTO Energy",
        well_type: "Oil",
        well_status: "Active",
        spud_date: "2023-01-15",
        completion_date: "2023-03-20"
      }
    ]
  };
  
  // Save example files
  fs.writeFileSync('example-wells.csv', example.csv);
  fs.writeFileSync('example-wells.json', JSON.stringify(example.json, null, 2));
  
  console.log('Created example files: example-wells.csv and example-wells.json');
}

// Add option to generate example data
if (INPUT_FILE === '--example') {
  generateExampleData();
} else {
  main();
}