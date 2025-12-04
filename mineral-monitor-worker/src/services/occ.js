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
 * @returns {Array} - Parsed records from the Excel file
 */
export async function fetchOCCFile(fileType, env) {
  const url = OCC_FILE_URLS[fileType];
  if (!url) {
    throw new Error(`Unknown OCC file type: ${fileType}`);
  }
  
  console.log(`[OCC] Fetching ${fileType} file from ${url}`);
  
  // Check cache first (files update daily, cache for 4 hours)
  const cacheKey = `occ-file:${fileType}:${new Date().toISOString().split('T')[0]}`;
  const cached = await env.MINERAL_CACHE.get(cacheKey, { type: 'json' });
  if (cached) {
    console.log(`[OCC] Using cached ${fileType} file (${cached.length} records)`);
    return cached;
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
  
  // Filter to only new records (last 7 days for ITD/completions)
  // The file already contains "Last 7 Days" but we can add extra filtering if needed
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
 * Filter records to ensure we only process recent filings
 * @param {Array} records - Parsed records
 * @param {string} fileType - Type of file
 * @returns {Array} - Filtered records
 */
function filterRecentRecords(records, fileType) {
  // The OCC "Last 7 Days" files should already be filtered,
  // but we add a safety check to avoid processing stale data
  
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  
  console.log(`[OCC] Date filtering: Looking for records after ${tenDaysAgo.toISOString()}`);
  
  let filteredCount = 0;
  const filtered = records.filter(record => {
    // Different files have different date fields
    let dateField;
    switch (fileType) {
      case 'itd':
        dateField = record.Approval_Date || record.Submit_Date;
        break;
      case 'completions':
        dateField = record.Create_Date || record.Created_Date || record.DATE_CREATED;
        break;
      case 'transfers':
        dateField = record.Transfer_Date || record.Effective_Date;
        break;
      default:
        return true;
    }
    
    if (!dateField) {
      console.log(`[OCC] Record with no date field - including: API ${record.API_Number || 'unknown'}`);
      return true; // Include if no date to filter on
    }
    
    try {
      const recordDate = new Date(dateField);
      const isRecent = recordDate >= tenDaysAgo;
      if (!isRecent) {
        filteredCount++;
        if (filteredCount <= 3) { // Log first 3 filtered records
          console.log(`[OCC] Filtering out old record: ${dateField} (API ${record.API_Number || 'unknown'})`);
        }
      }
      return isRecent;
    } catch (err) {
      console.log(`[OCC] Date parsing failed for '${dateField}' - including record`);
      return true; // Include if date parsing fails
    }
  });
  
  console.log(`[OCC] Date filter results: ${filtered.length} recent, ${filteredCount} filtered out`);
  return filtered;
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
