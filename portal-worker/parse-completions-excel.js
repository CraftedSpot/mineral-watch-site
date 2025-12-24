const XLSX = require('xlsx');
const fs = require('fs');

console.log('Reading completions Excel file...');

// Try with different options
const workbook = XLSX.readFile('completions-daily.xlsx', {
    type: 'buffer',
    cellDates: true,
    cellNF: false,
    cellText: false
});

console.log('\nWorkbook info:');
console.log('Sheet names:', workbook.SheetNames);
console.log('Number of sheets:', workbook.SheetNames.length);

// Process each sheet
workbook.SheetNames.forEach((sheetName, index) => {
    console.log(`\n=== Processing Sheet ${index + 1}: ${sheetName} ===`);
    
    const worksheet = workbook.Sheets[sheetName];
    
    // Try different parsing methods
    try {
        // Method 1: Convert to JSON array
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
            raw: false,
            defval: null,
            header: 1 // Return array of arrays
        });
        
        console.log(`Rows found: ${jsonData.length}`);
        
        if (jsonData.length > 0) {
            // Show header row
            if (jsonData[0]) {
                console.log('\nHeader columns (first 15):');
                console.log(jsonData[0].slice(0, 15));
                
                // Show first data row
                if (jsonData[1]) {
                    console.log('\nFirst data row (first 15 columns):');
                    console.log(jsonData[1].slice(0, 15));
                }
            }
            
            // Only convert first sheet to CSV
            if (index === 0) {
                console.log('\nConverting to CSV...');
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                fs.writeFileSync('completions-data.csv', csv);
                
                const stats = fs.statSync('completions-data.csv');
                console.log(`CSV file created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                
                // Count non-empty rows
                const lines = csv.split('\n');
                const nonEmptyLines = lines.filter(line => line.trim().length > 0);
                console.log(`Total lines: ${lines.length}, Non-empty lines: ${nonEmptyLines.length}`);
            }
        }
    } catch (error) {
        console.error(`Error processing sheet ${sheetName}:`, error.message);
    }
});