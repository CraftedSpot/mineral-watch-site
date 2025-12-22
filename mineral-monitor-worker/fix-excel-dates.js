// Test script to verify the Excel date issue and solution

import XLSX from 'xlsx';

// Function to convert Excel numeric date to JS Date
function excelDateToJS(excelDate) {
  if (typeof excelDate === 'number') {
    // Excel dates start from 1900-01-01
    // JavaScript dates are milliseconds since 1970-01-01
    return new Date((excelDate - 25569) * 86400 * 1000);
  }
  // If it's already a string, try parsing it normally
  return new Date(excelDate);
}

// Test with actual data
console.log('Testing Excel date conversion:');
console.log('46007 converts to:', excelDateToJS(46007).toISOString());
console.log('46010 converts to:', excelDateToJS(46010).toISOString());

// Check the actual files
console.log('\n=== CHECKING ITD FILE ===');
const itdWB = XLSX.readFile('itd.xlsx');
const itdSheet = itdWB.Sheets[itdWB.SheetNames[0]];
const itdData = XLSX.utils.sheet_to_json(itdSheet);

console.log(`Total ITD records: ${itdData.length}`);

// Check date fields
const tenDaysAgo = new Date();
tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
console.log(`Looking for records after: ${tenDaysAgo.toISOString()}`);

let recentCount = 0;
itdData.forEach((record, i) => {
  const dateField = record.Approval_Date || record.Submit_Date || record.Create_Date;
  if (dateField) {
    const jsDate = excelDateToJS(dateField);
    const isRecent = jsDate >= tenDaysAgo;
    if (isRecent) {
      recentCount++;
      if (recentCount <= 3) {
        console.log(`\nRecent record ${recentCount}:`);
        console.log(`  API: ${record.API_Number}`);
        console.log(`  Well: ${record.Well_Name}`);
        console.log(`  Date value: ${dateField}`);
        console.log(`  Converted date: ${jsDate.toISOString()}`);
        console.log(`  County: ${record.County}`);
      }
    }
  }
});

console.log(`\nTotal recent ITD records (within 10 days): ${recentCount}`);

// Check completions
console.log('\n=== CHECKING COMPLETIONS FILE ===');
const compWB = XLSX.readFile('completions.xlsx');
const compSheet = compWB.Sheets[compWB.SheetNames[0]];
const compData = XLSX.utils.sheet_to_json(compSheet);

console.log(`Total completion records: ${compData.length}`);

recentCount = 0;
compData.forEach((record, i) => {
  const dateField = record.Create_Date || record.Created_Date || record.DATE_CREATED;
  if (dateField) {
    const jsDate = excelDateToJS(dateField);
    const isRecent = jsDate >= tenDaysAgo;
    if (isRecent) {
      recentCount++;
      if (recentCount <= 3) {
        console.log(`\nRecent completion ${recentCount}:`);
        console.log(`  API: ${record.API_Number}`);
        console.log(`  Well: ${record.Well_Name}`);
        console.log(`  Date value: ${dateField}`);
        console.log(`  Converted date: ${jsDate.toISOString()}`);
        console.log(`  County: ${record.County}`);
      }
    }
  }
});

console.log(`\nTotal recent completion records (within 10 days): ${recentCount}`);