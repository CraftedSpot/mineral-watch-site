/**
 * OCC File Service - Fetches and parses Oklahoma Corporation Commission Excel files
 */

import * as XLSX from 'xlsx';

// OCC Data URLs - Updated November 2025
const OCC_FILE_URLS = {
  itd: 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/ITD-wells-formations-daily.xlsx',
  completions: 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/completions-wells-formations-daily.xlsx',
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
  
  // Filter to only new records (last 7 days for ITD/completions)
  // The file already contains "Last 7 Days" but we can add extra filtering if needed
  const filteredRecords = filterRecentRecords(records, fileType);
  
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
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  return records.filter(record => {
    // Different files have different date fields
    let dateField;
    switch (fileType) {
      case 'itd':
        dateField = record.Approval_Date || record.Submit_Date;
        break;
      case 'completions':
        dateField = record.Completion_Date || record.Test_Date;
        break;
      case 'transfers':
        dateField = record.Transfer_Date || record.Effective_Date;
        break;
      default:
        return true;
    }
    
    if (!dateField) return true; // Include if no date to filter on
    
    try {
      const recordDate = new Date(dateField);
      return recordDate >= sevenDaysAgo;
    } catch {
      return true; // Include if date parsing fails
    }
  });
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
