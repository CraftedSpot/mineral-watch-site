const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
console.log('Reading Excel file...');
const workbook = XLSX.readFile('completions-wells-formations-base.xlsx');

console.log('\nAvailable sheets:', workbook.SheetNames);

// Try each sheet
for (const sheetName of workbook.SheetNames) {
    console.log(`\n=== Sheet: ${sheetName} ===`);
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet || !worksheet['!ref']) {
        console.log('Sheet appears to be empty or corrupted');
        continue;
    }
    
    // Get range info
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log(`Rows: ${range.e.r + 1}, Columns: ${range.e.c + 1}`);
    
    // Convert to JSON with raw values
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, header: 1 });
    
    if (jsonData.length > 0) {
        console.log(`Found ${jsonData.length} rows`);
        
        // Show first few rows
        console.log('\nFirst 3 rows:');
        for (let i = 0; i < Math.min(3, jsonData.length); i++) {
            console.log(`Row ${i}:`, jsonData[i].slice(0, 10)); // First 10 columns
        }
        
        // If first sheet, convert to CSV
        if (sheetName === workbook.SheetNames[0]) {
            const csv = XLSX.utils.sheet_to_csv(worksheet);
            fs.writeFileSync('completions-data.csv', csv);
            console.log('\nConverted to completions-data.csv');
            
            // Show file size
            const stats = fs.statSync('completions-data.csv');
            console.log(`CSV file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        }
    }
}