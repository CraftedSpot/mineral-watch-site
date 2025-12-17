import * as XLSX from 'xlsx';
import fs from 'fs';

// Read the file
const workbook = XLSX.readFile('/tmp/itd-daily.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet);

console.log(`Total records: ${data.length}`);
console.log(`Sheet name: ${sheetName}`);

// Show first 5 records
console.log('\nFirst 5 records:');
data.slice(0, 5).forEach((row, idx) => {
  console.log(`\nRecord ${idx + 1}:`);
  console.log(JSON.stringify(row, null, 2));
});

// Check for dates - look for SPUD DATE or PERMIT DATE fields
const dateFields = Object.keys(data[0] || {}).filter(key => 
  key.toLowerCase().includes('date') || 
  key.toLowerCase().includes('spud') ||
  key.toLowerCase().includes('permit')
);

console.log('\nDate fields found:', dateFields);

// Show latest dates
if (dateFields.length > 0) {
  const dates = data
    .map(row => dateFields.map(field => row[field]).filter(Boolean))
    .flat()
    .filter(Boolean)
    .sort()
    .reverse();
  
  console.log('\nLatest 10 dates found:');
  dates.slice(0, 10).forEach(date => console.log(date));
}