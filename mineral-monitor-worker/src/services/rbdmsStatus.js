/**
 * RBDMS Bulk Status Monitoring Service
 * Downloads complete RBDMS well dataset and checks for status changes
 * in user-tracked wells only
 */

import { queryAirtable } from './airtable.js';
import { checkWellStatusChange } from './statusChange.js';
import { normalizeAPI } from '../utils/normalize.js';

const RBDMS_CSV_URL = 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/rbdms-wells.csv';
const CACHE_KEY = 'rbdms-last-modified';

/**
 * Download and parse RBDMS CSV file
 * @param {Object} env - Worker environment
 * @returns {Map} - Map of API number to well data
 */
async function downloadRBDMSData(env) {
  console.log('[RBDMS] Downloading complete well dataset...');
  const startTime = Date.now();
  
  try {
    // Check if file was modified since last download
    const lastModified = await env.MINERAL_CACHE.get(CACHE_KEY);
    console.log(`[RBDMS] Last-Modified cache: ${lastModified || 'not set'}`);
    
    const headers = {
      'User-Agent': 'MineralWatch/2.0',
      ...(lastModified && { 'If-Modified-Since': lastModified })
    };
    console.log(`[RBDMS] Fetching from ${RBDMS_CSV_URL}`);
    
    const response = await fetch(RBDMS_CSV_URL, { headers });
    console.log(`[RBDMS] Response status: ${response.status}`);
    
    // If not modified, return null to skip processing
    if (response.status === 304 && lastModified) {
      console.log('[RBDMS] File not modified since last check (304 status)');
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to download RBDMS data: ${response.status}`);
    }
    
    // Store last-modified header
    const newLastModified = response.headers.get('Last-Modified');
    if (newLastModified) {
      await env.MINERAL_CACHE.put(CACHE_KEY, newLastModified, {
        expirationTtl: 7 * 24 * 60 * 60 // 7 days
      });
    }
    
    // Parse CSV
    const text = await response.text();
    const downloadTime = Date.now() - startTime;
    console.log(`[RBDMS] Downloaded ${(text.length / 1024 / 1024).toFixed(1)}MB in ${downloadTime}ms`);
    
    // Parse CSV into Map for fast lookups
    const wellMap = new Map();
    const lines = text.split('\n');
    const csvHeaders = lines[0].split(',').map(h => h.trim());
    
    // Find important column indices
    const apiIndex = csvHeaders.findIndex(h => h.toLowerCase().includes('api'));
    const statusIndex = csvHeaders.findIndex(h => h.toLowerCase().includes('wellstatus') || h.toLowerCase() === 'status');
    const operatorIndex = csvHeaders.findIndex(h => h.toLowerCase().includes('operator'));
    
    console.log(`[RBDMS] Parsing ${lines.length - 1} wells...`);
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = parseCSVLine(lines[i]);
      if (values.length < csvHeaders.length) continue;
      
      const api = normalizeAPI(values[apiIndex]);
      if (!api) continue;
      
      wellMap.set(api, {
        wellstatus: values[statusIndex]?.trim() || '',
        operator: values[operatorIndex]?.trim() || '',
        // Add other fields as needed
      });
    }
    
    console.log(`[RBDMS] Parsed ${wellMap.size} wells in ${Date.now() - startTime}ms total`);
    return wellMap;
    
  } catch (error) {
    console.error('[RBDMS] Download failed:', error);
    throw error;
  }
}

/**
 * Parse CSV line handling quoted values
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Check all user-tracked wells for status changes
 * @param {Object} env - Worker environment
 * @returns {Object} - Results of status check
 */
export async function checkAllWellStatuses(env) {
  const results = {
    wellsChecked: 0,
    statusChanges: 0,
    alertsSent: 0,
    errors: []
  };
  
  try {
    // Download RBDMS data
    console.log('[RBDMS] Starting RBDMS data download...');
    let rbdmsData;
    try {
      rbdmsData = await downloadRBDMSData(env);
    } catch (downloadError) {
      console.error('[RBDMS] Download failed:', downloadError.message);
      results.errors.push(`RBDMS download failed: ${downloadError.message}`);
      return results;
    }
    
    // If no new data, skip processing
    if (!rbdmsData) {
      console.log('[RBDMS] Skipping - no new data (file not modified since last check)');
      results.errors.push('RBDMS file not modified since last download');
      return results;
    }
    
    console.log(`[RBDMS] RBDMS data loaded with ${rbdmsData.size} wells`);
    
    // Get all tracked wells - simplified query
    let allTrackedWells = [];
    
    try {
      const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_WELLS_TABLE}`;
      console.log(`[RBDMS] Querying Airtable: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Airtable query failed: ${response.status} - ${error}`);
      }
      
      const data = await response.json();
      allTrackedWells = data.records || [];
      console.log(`[RBDMS] Found ${allTrackedWells.length} wells (first page only for testing)`);
      
    } catch (error) {
      console.error('[RBDMS] Failed to query tracked wells:', error.message);
      results.errors.push(`Airtable query failed: ${error.message}`);
      return results;
    }
    
    console.log(`[RBDMS] Found ${allTrackedWells.length} total wells in Airtable`);
    
    if (allTrackedWells.length === 0) {
      console.log('[RBDMS] No tracked wells found in Airtable');
      return results;
    }
    
    console.log(`[RBDMS] Checking ${allTrackedWells.length} tracked wells...`);
    
    // Check each tracked well
    for (const well of allTrackedWells) {
      const api = normalizeAPI(well.fields['API Number']);
      if (!api) continue;
      
      results.wellsChecked++;
      
      // Look up current data in RBDMS
      const currentData = rbdmsData.get(api);
      if (!currentData) {
        console.log(`[RBDMS] Well ${api} not found in RBDMS data`);
        continue;
      }
      
      // Check for status change
      const statusResult = await checkWellStatusChange(api, currentData, env);
      if (statusResult.hasChange) {
        results.statusChanges++;
        results.alertsSent += statusResult.alertsSent;
        console.log(`[RBDMS] Status change for ${api}: ${statusResult.previousStatus} → ${statusResult.currentStatus}`);
      }
    }
    
    console.log(`[RBDMS] Complete: ${results.wellsChecked} wells checked, ${results.statusChanges} changes found`);
    
  } catch (error) {
    console.error('[RBDMS] Status check failed:', error);
    results.errors.push(error.message);
  }
  
  return results;
}

/**
 * Optional: Store snapshot in R2 for historical analysis
 */
export async function storeRBDMSSnapshot(env, csvText) {
  if (!env.RBDMS_BUCKET) {
    console.log('[RBDMS] No R2 bucket configured for snapshots');
    return;
  }
  
  const date = new Date().toISOString().split('T')[0];
  const key = `snapshots/rbdms-wells-${date}.csv`;
  
  try {
    await env.RBDMS_BUCKET.put(key, csvText, {
      httpMetadata: {
        contentType: 'text/csv',
        contentEncoding: 'gzip'
      },
      customMetadata: {
        source: 'occ',
        recordCount: csvText.split('\n').length - 1
      }
    });
    console.log(`[RBDMS] Snapshot stored: ${key}`);
  } catch (error) {
    console.error('[RBDMS] Failed to store snapshot:', error);
  }
}