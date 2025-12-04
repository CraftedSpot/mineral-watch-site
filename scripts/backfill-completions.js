/**
 * Historical Completions Backfill Script
 * 
 * Downloads the OCC historical completions CSV file, parses each record,
 * and uploads to Cloudflare KV for instant lookup during well creation.
 * 
 * Usage: node scripts/backfill-completions.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// Configuration
const LOCAL_COMPLETIONS_FILE = '/Volumes/Media Drives/Downloads 2026/completions-wells-formations-base (1).csv';
const BATCH_SIZE = 100; // KV writes per batch
const BATCH_DELAY = 100; // ms delay between batches
const KV_NAMESPACE_ID = 'd39109ffa98d4f4d999ee37098d0c13e'; // COMPLETIONS_CACHE namespace
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN; // Set in environment
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID; // Set in environment

// Download function removed - now reading from local file

/**
 * Parse CSV file with streaming to handle large files
 */
async function parseCompletionsFile(filepath) {
  console.log('📊 Parsing CSV file with streaming...');
  
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filepath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity // Handle Windows line endings
    });
    
    const records = [];
    let headerRow = null;
    let rowCount = 0;
    
    rl.on('line', (line) => {
      try {
        // Skip the "Table 1" header line
        if (line.trim() === 'Table 1') {
          return;
        }
        
        // Parse CSV line (simple comma splitting - may need enhancement for quoted fields)
        const values = line.split(',').map(value => value.trim().replace(/^"|"$/g, ''));
        
        if (rowCount === 0) {
          // Extract headers
          headerRow = values;
          console.log('📋 Headers found:', headerRow.slice(0, 10).join(', '), '...');
          rowCount++;
          return;
        }
        
        if (!headerRow) return;
        
        // Parse data row
        const record = {};
        values.forEach((value, index) => {
          const header = headerRow[index];
          if (header && value !== null && value !== undefined && value !== '') {
            record[header] = value;
          }
        });
        
        // Only include records with valid API numbers (10 digits)
        const apiNumber = record.API_Number ? record.API_Number.toString().trim() : '';
        if (apiNumber && apiNumber.length === 10 && /^\d{10}$/.test(apiNumber)) {
          records.push(record);
        }
        
        rowCount++;
        
        // Progress logging
        if (rowCount % 10000 === 0) {
          console.log(`📊 Processed ${rowCount.toLocaleString()} rows, found ${records.length.toLocaleString()} valid records...`);
          
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
        }
        
      } catch (error) {
        console.warn(`⚠️ Error parsing row ${rowCount}:`, error.message);
      }
    });
    
    rl.on('close', () => {
      console.log(`✅ CSV parsing complete: ${records.length.toLocaleString()} valid completion records found`);
      resolve(records);
    });
    
    rl.on('error', (error) => {
      console.error('❌ CSV reading error:', error);
      reject(error);
    });
  });
}

/**
 * Format completion record for KV storage
 */
function formatCompletionRecord(record) {
  // Helper to safely parse numbers
  const parseNumber = (value) => {
    if (!value) return null;
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  };
  
  // Helper to format dates
  const formatDate = (value) => {
    if (!value) return null;
    try {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  };
  
  // Clean API number
  const api = record.API_Number ? record.API_Number.toString().padStart(10, '0') : null;
  if (!api || api.length !== 10) return null;
  
  return {
    api: api,
    wellName: record.Well_Name || null,
    operator: record.Operator || null,
    county: record.County || null,
    
    // Location data
    surfaceSection: record.Section ? record.Section.toString() : null,
    surfaceTownship: record.Township || null,
    surfaceRange: record.Range || null,
    bhSection: record.BH_Section ? record.BH_Section.toString() : null,
    bhTownship: record.BH_Township || null,
    bhRange: record.BH_Range || null,
    
    // Production data
    formationName: record.Formation_Name || null,
    formationDepth: parseNumber(record.Formation_Depth),
    ipGas: parseNumber(record.Gas_MCF_Per_Day),
    ipOil: parseNumber(record.Oil_BBL_Per_Day),
    ipWater: parseNumber(record.Water_BBL_Per_Day),
    pumpingFlowing: record.Pumping_Flowing || null,
    
    // Timeline data
    spudDate: formatDate(record.Spud),
    completionDate: formatDate(record.Well_Completion),
    firstProdDate: formatDate(record.First_Prod),
    
    // Well details
    drillType: record.Drill_Type || null,
    lateralLength: parseNumber(record.Lateral_Length),
    totalDepth: parseNumber(record.Total_Depth),
    wellNumber: record.Well_Number || null,
    leaseName: record.BHL_From_Lease || null,
    
    // Metadata
    cachedAt: Date.now(),
    source: 'historical_backfill'
  };
}

/**
 * Upload batch of records to Cloudflare KV
 */
async function uploadBatchToKV(records) {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID environment variables');
  }
  
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/bulk`;
  
  const kvRecords = records.map(record => ({
    key: `well:${record.api}`,
    value: JSON.stringify(record),
    expiration_ttl: 365 * 24 * 60 * 60 // 1 year TTL
  }));
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(kvRecords)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`KV upload failed: ${response.status} - ${error}`);
  }
  
  return records.length;
}

/**
 * Main backfill process
 */
async function main() {
  console.log('🚀 Starting historical completions backfill...');
  console.log(`📊 Source: ${LOCAL_COMPLETIONS_FILE}`);
  console.log(`🔑 KV Namespace: ${KV_NAMESPACE_ID}`);
  
  try {
    // Check prerequisites
    if (KV_NAMESPACE_ID === 'YOUR_COMPLETIONS_CACHE_NAMESPACE_ID') {
      throw new Error('❌ Please update KV_NAMESPACE_ID in the script with your actual namespace ID');
    }
    
    // Check if local file exists
    if (!fs.existsSync(LOCAL_COMPLETIONS_FILE)) {
      throw new Error(`❌ Local completions file not found: ${LOCAL_COMPLETIONS_FILE}`);
    }
    
    console.log('✅ Local completions file found');
    
    // Step 1: Parse the CSV file
    const rawRecords = await parseCompletionsFile(LOCAL_COMPLETIONS_FILE);
    
    // Step 3: Format records and deduplicate by API number
    console.log('🔄 Processing and deduplicating records...');
    
    let validCount = 0;
    let invalidCount = 0;
    let uploadedCount = 0;
    const wellsMap = new Map(); // Deduplicate by API number
    
    // Process records one by one and deduplicate
    for (let i = 0; i < rawRecords.length; i++) {
      const record = rawRecords[i];
      const formatted = formatCompletionRecord(record);
      
      if (formatted) {
        const apiKey = formatted.api;
        
        // Keep the record with the most recent completion date, or first if no dates
        const existing = wellsMap.get(apiKey);
        if (!existing || 
            (formatted.completionDate && (!existing.completionDate || formatted.completionDate > existing.completionDate))) {
          wellsMap.set(apiKey, formatted);
        }
        
        validCount++;
      } else {
        invalidCount++;
      }
      
      // Progress logging
      if ((i + 1) % 10000 === 0) {
        console.log(`🔄 Processed ${(i + 1).toLocaleString()}/${rawRecords.length.toLocaleString()} records. Valid: ${validCount.toLocaleString()}, Unique wells: ${wellsMap.size.toLocaleString()}`);
      }
    }
    
    const uniqueRecords = Array.from(wellsMap.values());
    console.log(`✅ Deduplication complete: ${validCount.toLocaleString()} total records → ${uniqueRecords.length.toLocaleString()} unique wells`);
    
    // Step 4: Upload unique records in batches
    console.log(`📤 Uploading ${uniqueRecords.length.toLocaleString()} unique records to KV...`);
    
    let batchNumber = 0;
    const totalBatches = Math.ceil(uniqueRecords.length / BATCH_SIZE);
    
    for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
      const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
      batchNumber++;
      
      try {
        await uploadBatchToKV(batch);
        uploadedCount += batch.length;
        
        console.log(`📤 Batch ${batchNumber}/${totalBatches}: Uploaded ${batch.length} records. Total: ${uploadedCount.toLocaleString()}/${uniqueRecords.length.toLocaleString()} (${((uploadedCount / uniqueRecords.length) * 100).toFixed(1)}%)`);
        
        // Rate limiting delay
        if (i + BATCH_SIZE < uniqueRecords.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
        
      } catch (error) {
        console.error(`❌ Batch ${batchNumber} failed:`, error.message);
        console.log('🔄 Continuing with next batch...');
      }
    }
    
    console.log(`✅ Processing complete:`);
    console.log(`   📈 Total valid records: ${validCount.toLocaleString()}`);
    console.log(`   🔄 Unique wells: ${uniqueRecords.length.toLocaleString()}`);
    console.log(`   ❌ Invalid records: ${invalidCount.toLocaleString()}`);
    
    console.log('\n🎉 Backfill complete!');
    console.log(`📊 Final stats:`);
    console.log(`   📥 Processed: ${rawRecords.length.toLocaleString()} raw records`);
    console.log(`   ✅ Valid: ${validCount.toLocaleString()} valid records`);
    console.log(`   📤 Uploaded: ${uploadedCount.toLocaleString()} to KV cache`);
    console.log(`   🎯 Success rate: ${validCount > 0 ? ((uploadedCount / validCount) * 100).toFixed(1) : '0'}%`);
    
  } catch (error) {
    console.error('❌ Backfill failed:', error.message);
    
    // No cleanup needed for local file
    
    process.exit(1);
  }
}

// No external dependencies required for CSV parsing

// Run the backfill
if (require.main === module) {
  main();
}

module.exports = { main, formatCompletionRecord, parseCompletionsFile };