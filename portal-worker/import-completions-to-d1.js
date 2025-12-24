const fs = require('fs');
const csv = require('csv-parser');
const readline = require('readline');

// Read CSV and create SQL update statements
async function createCompletionsUpdateSQL() {
    console.log('Reading completions CSV file...');
    
    const updates = [];
    const stats = {
        totalRows: 0,
        matchingAPIs: new Set(),
        skipped: 0
    };
    
    return new Promise((resolve, reject) => {
        fs.createReadStream('completions-data.csv')
            .pipe(csv())
            .on('data', (row) => {
                stats.totalRows++;
                
                // Get API number (remove any dashes or spaces)
                const api = row.API_Number?.replace(/[-\s]/g, '').trim();
                if (!api) {
                    stats.skipped++;
                    return;
                }
                
                stats.matchingAPIs.add(api);
                
                // Extract completion data fields
                const completionData = {
                    api_number: api,
                    bh_longitude: parseFloat(row.BH_Long_X) || null,
                    bh_latitude: parseFloat(row.BH_Lat_Y) || null,
                    formation_name: row.Producing_Formation || row.Formation || null,
                    formation_depth: parseInt(row.Formation_Depth) || null,
                    true_vertical_depth: parseInt(row.True_Vertical_Depth) || parseInt(row.TVD) || null,
                    measured_total_depth: parseInt(row.Total_Depth) || parseInt(row.TD) || null,
                    lateral_length: parseInt(row.Lateral_Length) || null,
                    ip_oil_bbl: parseFloat(row.IP_Oil_Bbls) || parseFloat(row.IP_Oil) || null,
                    ip_gas_mcf: parseFloat(row.IP_Gas_MCF) || parseFloat(row.IP_Gas) || null,
                    ip_water_bbl: parseFloat(row.IP_Water_Bbls) || parseFloat(row.IP_Water) || null
                };
                
                // Build UPDATE statement
                const updates = [];
                const params = [];
                let paramIndex = 2; // Starting at ?2 since ?1 is for api_number in WHERE clause
                
                if (completionData.bh_longitude !== null) {
                    updates.push(`bh_longitude = ?${paramIndex++}`);
                    params.push(completionData.bh_longitude);
                }
                if (completionData.bh_latitude !== null) {
                    updates.push(`bh_latitude = ?${paramIndex++}`);
                    params.push(completionData.bh_latitude);
                }
                if (completionData.formation_name) {
                    updates.push(`formation_name = ?${paramIndex++}`);
                    params.push(completionData.formation_name);
                }
                if (completionData.formation_depth !== null) {
                    updates.push(`formation_depth = ?${paramIndex++}`);
                    params.push(completionData.formation_depth);
                }
                if (completionData.true_vertical_depth !== null) {
                    updates.push(`true_vertical_depth = ?${paramIndex++}`);
                    params.push(completionData.true_vertical_depth);
                }
                if (completionData.measured_total_depth !== null) {
                    updates.push(`measured_total_depth = ?${paramIndex++}`);
                    params.push(completionData.measured_total_depth);
                }
                if (completionData.lateral_length !== null) {
                    updates.push(`lateral_length = ?${paramIndex++}`);
                    params.push(completionData.lateral_length);
                }
                if (completionData.ip_oil_bbl !== null) {
                    updates.push(`ip_oil_bbl = ?${paramIndex++}`);
                    params.push(completionData.ip_oil_bbl);
                }
                if (completionData.ip_gas_mcf !== null) {
                    updates.push(`ip_gas_mcf = ?${paramIndex++}`);
                    params.push(completionData.ip_gas_mcf);
                }
                if (completionData.ip_water_bbl !== null) {
                    updates.push(`ip_water_bbl = ?${paramIndex++}`);
                    params.push(completionData.ip_water_bbl);
                }
                
                if (updateList.length > 0) {
                    const sql = `UPDATE wells SET ${updateList.join(', ')} WHERE api_number = ?1;`;
                    // Store with parameters for batch execution
                    updates.push({
                        sql,
                        params: [api, ...params]
                    });
                }
            })
            .on('end', () => {
                console.log('\nProcessing complete:');
                console.log(`- Total rows processed: ${stats.totalRows}`);
                console.log(`- Unique API numbers: ${stats.matchingAPIs.size}`);
                console.log(`- Rows skipped (no API): ${stats.skipped}`);
                
                // Write update statements to file
                const outputFile = 'completions-update.sql';
                const sqlContent = this.updates.map(u => {
                    // Format SQL with actual values for manual execution
                    let sql = u.sql;
                    u.params.forEach((param, idx) => {
                        const placeholder = `?${idx + 1}`;
                        const value = param === null ? 'NULL' : 
                                    typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : 
                                    param;
                        sql = sql.replace(placeholder, value);
                    });
                    return sql;
                }).join('\n');
                
                fs.writeFileSync(outputFile, sqlContent);
                console.log(`\nSQL update statements written to: ${outputFile}`);
                console.log(`Total update statements: ${this.updates.length}`);
                
                resolve(stats);
            })
            .on('error', reject);
    }.bind({ updates }));
}

// Create smaller batch files for D1 execution
async function createBatchFiles() {
    const BATCH_SIZE = 100; // Process 100 updates at a time
    const sqlContent = fs.readFileSync('completions-update.sql', 'utf8');
    const statements = sqlContent.split('\n').filter(s => s.trim());
    
    console.log(`\nCreating batch files (${BATCH_SIZE} statements per file)...`);
    
    let batchNum = 1;
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
        const batch = statements.slice(i, i + BATCH_SIZE);
        const batchFile = `completions-batch-${String(batchNum).padStart(3, '0')}.sql`;
        fs.writeFileSync(batchFile, batch.join('\n'));
        batchNum++;
    }
    
    console.log(`Created ${batchNum - 1} batch files`);
    
    // Create execution script
    const scriptContent = `#!/bin/bash
# Execute completion data updates
echo "Updating wells with completion data..."

for file in completions-batch-*.sql; do
    echo "Processing $file..."
    wrangler d1 execute oklahoma-wells --remote --file="$file"
    sleep 1 # Brief pause between batches
done

echo "Completion data update finished!"
`;
    
    fs.writeFileSync('execute-completions-update.sh', scriptContent);
    fs.chmodSync('execute-completions-update.sh', '755');
    console.log('\nCreated execution script: execute-completions-update.sh');
}

// Main execution
async function main() {
    try {
        await createCompletionsUpdateSQL();
        await createBatchFiles();
        
        console.log('\nNext steps:');
        console.log('1. Review the generated SQL files');
        console.log('2. Run: ./execute-completions-update.sh');
        console.log('3. This will update the wells table with completion data');
        
    } catch (error) {
        console.error('Error:', error);
    }
}

main();