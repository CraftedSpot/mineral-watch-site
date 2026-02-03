/**
 * OCC File Service - Fetches and parses Oklahoma Corporation Commission Excel files
 */

import * as XLSX from 'xlsx';

// OCC Data URLs - Updated December 2025
const OCC_FILE_URLS = {
  itd: 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/ITD-wells-formations-daily.xlsx',
  completions: 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/completions-wells-formations-daily.xlsx', // Back to daily
  completions_master: 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/completions-wells-formations-base.xlsx', // Master too large
  transfers: 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/well-transfers-daily.xlsx'
};

/**
 * Fetch and parse an OCC Excel file
 * @param {string} fileType - 'itd', 'completions', or 'transfers'
 * @param {Object} env - Worker environment bindings
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipCache - Skip cache and fetch fresh data
 * @returns {Array} - Parsed records from the Excel file
 */
export async function fetchOCCFile(fileType, env, options = {}) {
  const url = OCC_FILE_URLS[fileType];
  if (!url) {
    throw new Error(`Unknown OCC file type: ${fileType}`);
  }
  
  console.log(`[OCC] Fetching ${fileType} file from ${url}`);
  
  // Check cache first (files update daily, cache for 4 hours)
  const cacheKey = `occ-file:${fileType}:${new Date().toISOString().split('T')[0]}`;
  
  if (!options.skipCache) {
    const cached = await env.MINERAL_CACHE.get(cacheKey, { type: 'json' });
    if (cached) {
      console.log(`[OCC] Using cached ${fileType} file (${cached.length} records)`);
      return cached;
    }
  } else {
    console.log(`[OCC] Skipping cache for ${fileType} file (skipCache option enabled)`);
  }
  
  // Fetch fresh file
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MineralWatch/2.0 (mineral rights monitoring service)'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch OCC file: ${response.status} ${response.statusText}`);
  }
  
  const buffer = await response.arrayBuffer();
  console.log(`[OCC] Downloaded ${buffer.byteLength} bytes`);
  
  // Parse Excel file
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Convert to JSON, preserving header names
  const records = XLSX.utils.sheet_to_json(sheet, {
    defval: null, // Use null for empty cells
    raw: false    // Parse dates as strings
  });
  
  console.log(`[OCC] Parsed ${records.length} records from ${fileType} file`);
  
  // Log first record for debugging
  if (records.length > 0) {
    console.log(`[OCC] First raw record fields:`, Object.keys(records[0]).slice(0, 15));
    console.log(`[OCC] First raw record sample:`, {
      API_Number: records[0].API_Number,
      Create_Date: records[0].Create_Date,
      Completion_Date: records[0].Completion_Date,
      Test_Date: records[0].Test_Date,
      Section: records[0].Section,
      Township: records[0].Township,
      Range: records[0].Range,
      Loc_Except_Order: records[0].Loc_Except_Order,
      Increased_Density_Order: records[0].Increased_Density_Order,
      Spacing_Order: records[0].Spacing_Order
    });
    
    // Log a few more records to see date patterns
    console.log(`[OCC] Sample date fields from first 5 records:`);
    for (let i = 0; i < Math.min(5, records.length); i++) {
      console.log(`  Record ${i+1}: Create_Date=${records[i].Create_Date}, Test_Date=${records[i].Test_Date}`);
    }
  }
  
  // No filtering needed - OCC files are already 7-day rolling windows
  // Rely on the "already processed" cache for deduplication
  const filteredRecords = filterRecentRecords(records, fileType);
  
  // Sanity check: warn if zero records (could indicate OCC file format change)
  if (filteredRecords.length === 0) {
    const { sendSanityWarning } = await import('./adminAlerts.js');
    await sendSanityWarning(env, 'Zero permits in OCC file', 
      `File type: ${fileType}\nURL: ${url}\nThis could indicate OCC changed their file format or the file is temporarily unavailable.`
    );
  }
  
  // Cache the parsed results
  await env.MINERAL_CACHE.put(cacheKey, JSON.stringify(filteredRecords), {
    expirationTtl: 4 * 60 * 60 // 4 hours
  });
  
  return filteredRecords;
}

/**
 * Convert Excel numeric date to JavaScript Date
 * @param {number|string} excelDate - Excel date number or string date
 * @returns {Date} - JavaScript Date object
 */
function parseExcelDate(excelDate) {
  if (typeof excelDate === 'number') {
    // Excel dates are days since 1900-01-01 (with leap year bug)
    // JavaScript dates are milliseconds since 1970-01-01
    return new Date((excelDate - 25569) * 86400 * 1000);
  }
  // If it's already a string, parse it normally
  return new Date(excelDate);
}

/**
 * Filter records to ensure we only process recent filings
 * @param {Array} records - Parsed records
 * @param {string} fileType - Type of file
 * @returns {Array} - Filtered records
 */
function filterRecentRecords(records, fileType) {
  // The OCC "Last 7 Days" files are already filtered to a rolling 7-day window
  // We rely on the "already processed" cache for deduplication instead of date filtering
  // This ensures we don't miss valid records that have older filing dates
  
  console.log(`[OCC] No date filtering applied - OCC files are already 7-day rolling windows`);
  console.log(`[OCC] Returning all ${records.length} records from ${fileType} file`);
  
  // Log some sample dates for monitoring
  if (records.length > 0) {
    console.log(`[OCC] Sample dates from first 5 records:`);
    for (let i = 0; i < Math.min(5, records.length); i++) {
      let dateField;
      switch (fileType) {
        case 'itd':
          dateField = records[i].Approval_Date || records[i].Submit_Date || records[i].Create_Date;
          break;
        case 'completions':
          dateField = records[i].Create_Date || records[i].Created_Date || records[i].DATE_CREATED;
          break;
        case 'transfers':
          dateField = records[i].EventDate;
          break;
      }
      console.log(`  Record ${i+1}: ${dateField || 'no date'}`);
    }
  }
  
  return records;
}

/**
 * Validate that a record has the required fields for processing
 * @param {Object} record - A single record from the OCC file
 * @param {string} fileType - Type of file
 * @returns {boolean} - Whether the record is valid
 */
export function validateRecord(record, fileType) {
  const requiredFields = {
    itd: ['API_Number', 'Section', 'Township', 'Range'],
    completions: ['API_Number', 'Section', 'Township', 'Range'],
    transfers: ['API_Number', 'Previous_Operator', 'New_Operator']
  };
  
  const required = requiredFields[fileType] || [];
  return required.every(field => record[field] != null && record[field] !== '');
}

/**
 * Check if OCC data is stale based on whether we're receiving new records
 *
 * The OCC files are 7-day rolling windows. A record's date field (Approval_Date, Create_Date)
 * is when the event happened, NOT when OCC added it to the file. A completion from 30 days ago
 * might be added to the file today.
 *
 * We track "freshness" by checking when we last saw NEW (unprocessed) records.
 * If no new records for staleDays, we alert that something may be wrong.
 *
 * @param {Array} records - Parsed records
 * @param {string} fileType - Type of file
 * @param {Object} env - Worker environment bindings
 * @param {number} staleDays - Days without new records before considered stale (default 7)
 * @returns {Object} - { isStale, totalRecords, daysSinceNewRecords, lastNewRecordDate }
 */
export async function checkDataFreshness(records, fileType, env, staleDays = 7) {
  const cacheKey = `occ-freshness:${fileType}:last-new-record`;
  const now = new Date();

  // If file is completely empty, that's a real problem
  if (!records || records.length === 0) {
    console.log(`[OCC] WARNING: ${fileType} file is empty - possible parsing issue or OCC outage`);
    return {
      isStale: true,
      totalRecords: 0,
      daysSinceNewRecords: null,
      reason: 'File is empty',
      lastNewRecordDate: null
    };
  }

  console.log(`[OCC] ${fileType} file contains ${records.length} records (7-day rolling window)`);

  // Get the last time we saw new records for this file type
  let lastNewRecordDate = null;
  try {
    const cached = await env.MINERAL_CACHE.get(cacheKey);
    if (cached) {
      lastNewRecordDate = new Date(cached);
    }
  } catch (err) {
    console.warn(`[OCC] Failed to get freshness cache for ${fileType}:`, err.message);
  }

  // Calculate days since we last saw new records
  let daysSinceNewRecords = null;
  if (lastNewRecordDate) {
    daysSinceNewRecords = Math.floor((now - lastNewRecordDate) / (1000 * 60 * 60 * 24));
  }

  // Stale = no new records in staleDays AND we have a recorded last-new date
  // If we've never tracked before, we can't determine staleness yet
  const isStale = daysSinceNewRecords !== null && daysSinceNewRecords > staleDays;

  if (isStale) {
    console.log(`[OCC] WARNING: No new ${fileType} records in ${daysSinceNewRecords} days (threshold: ${staleDays})`);
    const { sendSanityWarning } = await import('./adminAlerts.js');
    await sendSanityWarning(env, `No new OCC ${fileType} records in ${daysSinceNewRecords} days`,
      `The OCC ${fileType} file has records, but we haven't seen any NEW (unprocessed) records since ${lastNewRecordDate.toISOString().split('T')[0]}.\n\nThis could indicate:\n- OCC hasn't published new filings (normal lull in activity)\n- The OCC file format changed\n- Our processing cache needs to be cleared\n\nFile currently contains ${records.length} records. Check https://oklahoma.gov/occ/divisions/oil-gas/oil-gas-data.html`
    );
  } else {
    console.log(`[OCC] ${fileType} freshness OK - ${records.length} records in file${daysSinceNewRecords !== null ? `, last new record ${daysSinceNewRecords} days ago` : ''}`);
  }

  return {
    isStale,
    totalRecords: records.length,
    daysSinceNewRecords,
    lastNewRecordDate: lastNewRecordDate ? lastNewRecordDate.toISOString().split('T')[0] : null,
    fileType
  };
}

/**
 * Mark that we received new records for a file type
 * Call this after successfully processing new (not already cached) records
 * @param {string} fileType - Type of file
 * @param {Object} env - Worker environment bindings
 */
export async function markNewRecordsReceived(fileType, env) {
  const cacheKey = `occ-freshness:${fileType}:last-new-record`;
  try {
    await env.MINERAL_CACHE.put(cacheKey, new Date().toISOString(), {
      expirationTtl: 30 * 24 * 60 * 60 // 30 days
    });
    console.log(`[OCC] Marked ${fileType} as having new records`);
  } catch (err) {
    console.warn(`[OCC] Failed to update freshness cache for ${fileType}:`, err.message);
  }
}

/**
 * Clear the OCC file cache for a specific file type
 * @param {string} fileType - 'itd', 'completions', or 'transfers'
 * @param {Object} env - Worker environment bindings
 * @param {string} date - Optional date in YYYY-MM-DD format (defaults to today)
 * @returns {Promise<boolean>} - True if cache was cleared
 */
export async function clearOCCFileCache(fileType, env, date = null) {
  const dateStr = date || new Date().toISOString().split('T')[0];
  const cacheKey = `occ-file:${fileType}:${dateStr}`;
  
  console.log(`[OCC] Clearing cache for key: ${cacheKey}`);
  
  try {
    await env.MINERAL_CACHE.delete(cacheKey);
    console.log(`[OCC] Cache cleared successfully for ${fileType} file (${dateStr})`);
    return true;
  } catch (error) {
    console.error(`[OCC] Failed to clear cache:`, error);
    return false;
  }
}
