const XLSX = require('xlsx');
const fs = require('fs');

console.log('Reading full completions XLSX file...');

// Read the workbook with specific options
const workbook = XLSX.readFile('completions-wells-formations-base.xlsx', {
    type: 'file',
    cellDates: true,
    cellNF: false,
    cellText: false,
    cellHTML: false,
    raw: true,
    dense: false
});

console.log('Workbook loaded successfully');
console.log('Available sheets:', workbook.SheetNames);

// Process the first sheet
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

console.log(`\nProcessing sheet: ${sheetName}`);

// Get the range of the sheet
const range = XLSX.utils.decode_range(worksheet['!ref']);
console.log(`Sheet dimensions: ${range.e.r + 1} rows x ${range.e.c + 1} columns`);

// Convert to JSON with headers
const jsonData = XLSX.utils.sheet_to_json(worksheet, {
    raw: true,
    defval: null,
    header: 1 // Get array of arrays
});

console.log(`Total rows (including header): ${jsonData.length}`);

if (jsonData.length > 0) {
    // Get headers from first row
    const headers = jsonData[0];
    console.log('\nFirst 20 column headers:');
    headers.slice(0, 20).forEach((h, i) => {
        console.log(`  ${i}: ${h}`);
    });
    
    // Find important column indices
    const columnMap = {};
    headers.forEach((header, index) => {
        const h = String(header).toLowerCase();
        if (h.includes('api')) columnMap.api = index;
        if (h.includes('formation_name')) columnMap.formation_name = index;
        if (h.includes('formation_depth')) columnMap.formation_depth = index;
        if (h.includes('measured_total_depth')) columnMap.measured_total_depth = index;
        if (h.includes('true_vertical_depth')) columnMap.true_vertical_depth = index;
        if (h.includes('bottom_hole_long')) columnMap.bh_longitude = index;
        if (h.includes('bottom_hole_lat')) columnMap.bh_latitude = index;
        if (h.includes('oil_bbl_per_day')) columnMap.ip_oil_bbl = index;
        if (h.includes('gas_mcf_per_day')) columnMap.ip_gas_mcf = index;
        if (h.includes('water_bbl_per_day')) columnMap.ip_water_bbl = index;
    });
    
    console.log('\nColumn mappings found:');
    Object.entries(columnMap).forEach(([field, index]) => {
        console.log(`  ${field}: column ${index} (${headers[index]})`);
    });
    
    // Create SQL updates
    const updates = [];
    const stats = {
        totalRows: 0,
        validAPIs: 0,
        rowsWithData: 0,
        skipped: 0
    };
    
    // Process data rows (skip header)
    for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        
        stats.totalRows++;
        
        // Get API number
        const api = row[columnMap.api]?.toString().replace(/[-\s]/g, '').trim();
        if (!api) {
            stats.skipped++;
            continue;
        }
        
        stats.validAPIs++;
        
        // Collect update fields
        const updates = [];
        const values = [];
        
        // Formation name
        if (columnMap.formation_name !== undefined && row[columnMap.formation_name]) {
            updates.push('formation_name = ?');
            values.push(String(row[columnMap.formation_name]).trim());
        }
        
        // Formation depth
        if (columnMap.formation_depth !== undefined && row[columnMap.formation_depth]) {
            const val = parseFloat(row[columnMap.formation_depth]);
            if (!isNaN(val)) {
                updates.push('formation_depth = ?');
                values.push(Math.round(val));
            }
        }
        
        // Measured total depth
        if (columnMap.measured_total_depth !== undefined && row[columnMap.measured_total_depth]) {
            const val = parseFloat(row[columnMap.measured_total_depth]);
            if (!isNaN(val)) {
                updates.push('measured_total_depth = ?');
                values.push(Math.round(val));
            }
        }
        
        // True vertical depth
        if (columnMap.true_vertical_depth !== undefined && row[columnMap.true_vertical_depth]) {
            const val = parseFloat(row[columnMap.true_vertical_depth]);
            if (!isNaN(val)) {
                updates.push('true_vertical_depth = ?');
                values.push(Math.round(val));
            }
        }
        
        // Bottom hole coordinates
        if (columnMap.bh_longitude !== undefined && row[columnMap.bh_longitude]) {
            const val = parseFloat(row[columnMap.bh_longitude]);
            if (!isNaN(val) && val !== 0) {
                updates.push('bh_longitude = ?');
                values.push(val);
            }
        }
        
        if (columnMap.bh_latitude !== undefined && row[columnMap.bh_latitude]) {
            const val = parseFloat(row[columnMap.bh_latitude]);
            if (!isNaN(val) && val !== 0) {
                updates.push('bh_latitude = ?');
                values.push(val);
            }
        }
        
        // Initial production
        if (columnMap.ip_oil_bbl !== undefined && row[columnMap.ip_oil_bbl]) {
            const val = parseFloat(row[columnMap.ip_oil_bbl]);
            if (!isNaN(val)) {
                updates.push('ip_oil_bbl = ?');
                values.push(val);
            }
        }
        
        if (columnMap.ip_gas_mcf !== undefined && row[columnMap.ip_gas_mcf]) {
            const val = parseFloat(row[columnMap.ip_gas_mcf]);
            if (!isNaN(val)) {
                updates.push('ip_gas_mcf = ?');
                values.push(val);
            }
        }
        
        if (columnMap.ip_water_bbl !== undefined && row[columnMap.ip_water_bbl]) {
            const val = parseFloat(row[columnMap.ip_water_bbl]);
            if (!isNaN(val)) {
                updates.push('ip_water_bbl = ?');
                values.push(val);
            }
        }
        
        // Only create update if we have data
        if (updates.length > 0) {
            stats.rowsWithData++;
            
            // Build parameterized SQL
            let sql = `UPDATE wells SET ${updates.join(', ')} WHERE api_number = ?;`;
            
            // Replace placeholders with actual values for SQL file
            values.push(api); // Add API at the end for WHERE clause
            values.forEach(val => {
                const replacement = val === null ? 'NULL' : 
                                 typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` :
                                 val;
                sql = sql.replace('?', replacement);
            });
            
            this.updates.push(sql);
        }
        
        // Log progress every 10000 rows
        if (stats.totalRows % 10000 === 0) {
            console.log(`  Processed ${stats.totalRows} rows...`);
        }
    }
    
    console.log('\nProcessing complete:');
    console.log(`- Total data rows: ${stats.totalRows}`);
    console.log(`- Rows with valid API: ${stats.validAPIs}`);
    console.log(`- Rows with completion data: ${stats.rowsWithData}`);
    console.log(`- Rows skipped: ${stats.skipped}`);
    
    // Write SQL file
    if (this.updates.length > 0) {
        const sqlFile = 'completions-full-update.sql';
        fs.writeFileSync(sqlFile, this.updates.join('\n'));
        console.log(`\nWrote ${this.updates.length} UPDATE statements to ${sqlFile}`);
        
        // Create batch files for execution
        const BATCH_SIZE = 500; // D1 can handle larger batches
        let batchNum = 1;
        
        for (let i = 0; i < this.updates.length; i += BATCH_SIZE) {
            const batch = this.updates.slice(i, i + BATCH_SIZE);
            const batchFile = `completions-full-batch-${String(batchNum).padStart(3, '0')}.sql`;
            fs.writeFileSync(batchFile, batch.join('\n'));
            batchNum++;
        }
        
        console.log(`Created ${batchNum - 1} batch files (${BATCH_SIZE} statements each)`);
        
        // Create execution script
        const scriptContent = `#!/bin/bash
# Execute full completions data update
echo "Starting full completions data import..."
echo "Total batches to process: ${batchNum - 1}"

processed=0
for file in completions-full-batch-*.sql; do
    processed=$((processed + 1))
    echo "Processing batch $processed of ${batchNum - 1}: $file"
    wrangler d1 execute oklahoma-wells --remote --file="$file"
    
    # Brief pause between batches
    if [ $processed -lt ${batchNum - 1} ]; then
        sleep 2
    fi
done

echo "Full completions import complete!"
`;
        
        fs.writeFileSync('execute-full-completions.sh', scriptContent);
        fs.chmodSync('execute-full-completions.sh', '755');
        console.log('\nCreated execution script: ./execute-full-completions.sh');
    }
    
}.bind({ updates: [] });

console.log('\nDone! Run ./execute-full-completions.sh to update the D1 database.');