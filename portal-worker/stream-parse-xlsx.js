const XLSX = require('xlsx');
const fs = require('fs');

console.log('Attempting to parse large XLSX file...\n');

// Since the full file is too large, let's try the daily file again to get the column mappings
// Then we'll create a manual update script
console.log('First, analyzing daily file for column structure...');

const dailyWorkbook = XLSX.readFile('completions-daily.xlsx');
const dailySheet = dailyWorkbook.Sheets[dailyWorkbook.SheetNames[0]];
const dailyData = XLSX.utils.sheet_to_json(dailySheet, { header: 1 });

if (dailyData.length > 0) {
    const headers = dailyData[0];
    console.log('\nColumn mappings from daily file:');
    headers.forEach((h, i) => {
        if (h && (
            h.toString().includes('Formation') ||
            h.toString().includes('Depth') ||
            h.toString().includes('API') ||
            h.toString().includes('Bottom_Hole') ||
            h.toString().includes('Oil_BBL') ||
            h.toString().includes('Gas_MCF') ||
            h.toString().includes('Water_BBL')
        )) {
            console.log(`  Column ${i}: ${h}`);
        }
    });
    
    // Create a sample update script based on the daily data
    console.log('\nCreating sample updates from daily data...');
    
    const updates = [];
    let validRows = 0;
    
    for (let i = 1; i < Math.min(dailyData.length, 100); i++) {
        const row = dailyData[i];
        if (!row || row.length === 0) continue;
        
        const api = row[0]?.toString().replace(/[-\s]/g, '').trim();
        if (!api) continue;
        
        // Column indices based on daily file
        const formationName = row[89]; // Formation_Name
        const formationDepth = row[90]; // Formation_Depth  
        const totalDepth = row[43]; // Measured_Total_Depth
        const tvd = row[44]; // True_Vertical_Depth
        const bhLong = row[24]; // Bottom_Hole_Long_X
        const bhLat = row[25]; // Bottom_Hole_Lat_Y
        const ipOil = row[102]; // Oil_BBL_Per_Day
        const ipGas = row[104]; // Gas_MCF_Per_Day
        const ipWater = row[106]; // Water_BBL_Per_Day
        
        const updateFields = [];
        const values = [];
        
        if (formationName) {
            updateFields.push('formation_name = ?');
            values.push(formationName);
        }
        if (formationDepth && !isNaN(formationDepth)) {
            updateFields.push('formation_depth = ?');
            values.push(parseInt(formationDepth));
        }
        if (totalDepth && !isNaN(totalDepth)) {
            updateFields.push('measured_total_depth = ?');
            values.push(parseInt(totalDepth));
        }
        if (tvd && !isNaN(tvd)) {
            updateFields.push('true_vertical_depth = ?');
            values.push(parseInt(tvd));
        }
        if (bhLong && !isNaN(bhLong) && parseFloat(bhLong) !== 0) {
            updateFields.push('bh_longitude = ?');
            values.push(parseFloat(bhLong));
        }
        if (bhLat && !isNaN(bhLat) && parseFloat(bhLat) !== 0) {
            updateFields.push('bh_latitude = ?');
            values.push(parseFloat(bhLat));
        }
        if (ipOil && !isNaN(ipOil)) {
            updateFields.push('ip_oil_bbl = ?');
            values.push(parseFloat(ipOil));
        }
        if (ipGas && !isNaN(ipGas)) {
            updateFields.push('ip_gas_mcf = ?');
            values.push(parseFloat(ipGas));
        }
        if (ipWater && !isNaN(ipWater)) {
            updateFields.push('ip_water_bbl = ?');
            values.push(parseFloat(ipWater));
        }
        
        if (updateFields.length > 0) {
            let sql = `UPDATE wells SET ${updateFields.join(', ')} WHERE api_number = ?;`;
            values.push(api);
            
            // Replace placeholders
            values.forEach(val => {
                const replacement = val === null ? 'NULL' : 
                                 typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` :
                                 val;
                sql = sql.replace('?', replacement);
            });
            
            updates.push(sql);
            validRows++;
        }
    }
    
    console.log(`\nGenerated ${validRows} update statements from daily data`);
    
    if (updates.length > 0) {
        fs.writeFileSync('completions-sample-updates.sql', updates.join('\n'));
        console.log('Wrote sample updates to completions-sample-updates.sql');
        
        // Show first few updates
        console.log('\nFirst 3 update statements:');
        updates.slice(0, 3).forEach(sql => {
            console.log(sql);
        });
    }
}

console.log('\n\nSince the full completions file is too large (72MB) to process with the XLSX library,');
console.log('you may need to:');
console.log('1. Use a different tool to convert it to CSV first');
console.log('2. Process it in smaller chunks');
console.log('3. Use the daily updates file for recent completions');
console.log('\nThe daily file contains the same column structure and can be used to update recent wells.');