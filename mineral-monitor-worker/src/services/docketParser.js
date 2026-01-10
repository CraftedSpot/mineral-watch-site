/**
 * OCC Docket Parser
 *
 * Parses Oklahoma Corporation Commission court docket PDFs into structured data.
 * These dockets contain legal filings about oil & gas activity that appear
 * 2-4 weeks BEFORE official transfers/permits hit the standard OCC data feeds.
 *
 * Supported docket types:
 * - okc: Oklahoma City Oil & Gas Conservation
 * - tulsa: Tulsa Oil & Gas Conservation
 * - appellate: Appeals
 * - pud: Public Utility Division (less relevant for mineral rights)
 */

import {
  parseLegalDescription,
  categorizeReliefType,
  parseResultStatus,
  extractContinuationDate,
  validateEntry
} from '../utils/docketNormalize.js';

/**
 * Build docket URL for a given date and type
 * URL pattern changed in 2026 - older files have year subdirectory
 *
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {string} type - 'okc', 'tulsa', 'appellate', or 'pud'
 * @returns {string} Full URL to the docket PDF
 */
export function buildDocketUrl(date, type = 'okc') {
  const year = parseInt(date.substring(0, 4), 10);
  const baseUrl = 'https://oklahoma.gov/content/dam/ok/en/occ/documents/ajls/jls-courts/court-clerk/docket-results';

  // 2026+ URLs don't have year subdirectory
  if (year >= 2026) {
    return `${baseUrl}/${date}-${type}.pdf`;
  } else {
    return `${baseUrl}/${year}/${date}-${type}.pdf`;
  }
}

/**
 * Fetch docket PDF and return as ArrayBuffer
 *
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options (for caching, etc.)
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchDocketPdf(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MineralWatch/1.0 (https://mymineralwatch.com)',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Docket not found: ${url}`);
    }
    throw new Error(`Failed to fetch docket: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}

/**
 * Extract text from PDF ArrayBuffer
 *
 * NOTE: This is a placeholder - Cloudflare Workers don't have native PDF support.
 * Options for production:
 * 1. Use pdf.js (pdfjs-dist) - works but heavy (~2MB)
 * 2. Use external service (e.g., document processor on Fly.io)
 * 3. Cache extracted text in KV after first extraction
 *
 * For now, this function expects text to be passed directly for testing.
 *
 * @param {ArrayBuffer} pdfBuffer - PDF file as ArrayBuffer
 * @returns {Promise<string>} Extracted text
 */
export async function extractTextFromPdf(pdfBuffer) {
  // TODO: Implement PDF text extraction
  // For Cloudflare Workers, consider:
  // - Using pdf.js with web worker
  // - Calling external extraction service
  // - Pre-extracting and caching in KV

  throw new Error(
    'PDF text extraction not yet implemented. ' +
    'Use parseFromText() with pre-extracted text, or implement extraction service.'
  );
}

/**
 * Parse docket text into structured entries
 *
 * @param {string} text - Extracted text from docket PDF
 * @param {object} metadata - Optional metadata (date, type, url)
 * @returns {Array<DocketEntry>} Parsed entries
 */
export function parseFromText(text, metadata = {}) {
  const entries = [];

  // Split text into entry blocks by case number pattern
  // Case numbers look like: CD2025-001811
  const casePattern = /\n(CD\d{4}-\d{6})\s*\n/g;

  // Find all case numbers and their positions
  const caseMatches = [];
  let match;
  while ((match = casePattern.exec(text)) !== null) {
    caseMatches.push({
      caseNumber: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  // Parse each case block
  for (let i = 0; i < caseMatches.length; i++) {
    const current = caseMatches[i];
    const nextStart = caseMatches[i + 1]?.startIndex || text.length;
    const blockText = text.substring(current.endIndex, nextStart);

    try {
      const entry = parseEntryBlock(current.caseNumber, blockText, metadata);
      if (entry) {
        entries.push(entry);
      }
    } catch (err) {
      console.error(`Error parsing case ${current.caseNumber}:`, err.message);
      // Continue with other entries
    }
  }

  return entries;
}

/**
 * Parse a single docket entry block
 *
 * @param {string} caseNumber - The case number (e.g., CD2025-001811)
 * @param {string} blockText - The text block for this entry
 * @param {object} metadata - Optional metadata
 * @returns {DocketEntry|null}
 */
function parseEntryBlock(caseNumber, blockText, metadata = {}) {
  // Extract fields using patterns

  // Judge
  const judgeMatch = blockText.match(/Judge:\s*([^\n]+)/i);
  const judge = judgeMatch ? judgeMatch[1].trim() : null;

  // Parties/Applicant
  const partiesMatch = blockText.match(/Parties:\s*([^\n]+(?:\n(?!Legal:|Attorney:|Courtroom:|Text:)[^\n]+)*)/i);
  let applicant = null;
  if (partiesMatch) {
    // Extract applicant (usually first party, marked with "(Applicant)")
    const partiesText = partiesMatch[1].replace(/\n/g, ' ').trim();
    const applicantMatch = partiesText.match(/([^|]+)\s*\(Applicant\)/i);
    applicant = applicantMatch ? applicantMatch[1].trim() : partiesText.split('|')[0].trim();
  }

  // Legal description
  const legalMatch = blockText.match(/Legal:\s*([^\n]+)/i);
  const legalStr = legalMatch ? legalMatch[1].trim() : null;
  const legal = parseLegalDescription(legalStr);

  // Attorney
  const attorneyMatch = blockText.match(/Attorney:\s*([^\n]+)/i);
  const attorney = attorneyMatch ? attorneyMatch[1].trim() : null;

  // Hearing date - try multiple formats
  const dateMatch = blockText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  let hearingDate = null;
  let hearingTime = null;
  if (dateMatch) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthIndex = monthNames.findIndex(m =>
      m.toLowerCase() === dateMatch[2].toLowerCase()
    );
    if (monthIndex >= 0) {
      const month = (monthIndex + 1).toString().padStart(2, '0');
      const day = dateMatch[3].padStart(2, '0');
      hearingDate = `${dateMatch[4]}-${month}-${day}`;
      hearingTime = dateMatch[5];
    }
  }

  // Relief Type and Relief Sought are on same line, followed by Result
  // Format: "Relief Type: [type] Relief Sought: [sought] Result: [result]"
  // Or: "Relief Type: [type] Relief Sought: [sought]\nResult: [result]"
  const reliefMatch = blockText.match(/Relief Type:\s*(.+?)\s+Relief Sought:\s*(.*?)(?:\n|\s+Result:)/i);
  let reliefType = null;
  let reliefSought = null;
  if (reliefMatch) {
    reliefType = reliefMatch[1].trim();
    reliefSought = reliefMatch[2]?.trim() || null;
  }

  // Result
  const resultMatch = blockText.match(/Result:\s*([^\n]+)/i);
  const resultText = resultMatch ? resultMatch[1].trim() : null;
  const status = parseResultStatus(resultText);
  const continuationDate = extractContinuationDate(resultText);

  // Text/Notes field (often contains motion details)
  const textMatch = blockText.match(/Text:\s*([^\n]+(?:\n(?!Court Reporter:|Relief Type:)[^\n]+)*)/i);
  const notes = textMatch ? textMatch[1].replace(/\n/g, ' ').trim() : null;

  // Courtroom
  const courtroomMatch = blockText.match(/Courtroom:\s*([^\n]+)/i);
  const courtroom = courtroomMatch ? courtroomMatch[1].trim() : null;

  // Build entry
  const entry = {
    case_number: caseNumber,
    relief_type: categorizeReliefType(reliefType, reliefSought),
    relief_type_raw: reliefType,
    relief_sought: reliefSought,
    applicant: applicant,
    county: legal?.county || null,
    section: legal?.section || null,
    township: legal?.township || null,
    range: legal?.range || null,
    meridian: legal?.meridian || 'IM',
    hearing_date: hearingDate,
    hearing_time: hearingTime,
    status: status,
    continuation_date: continuationDate,
    judge: judge,
    attorney: attorney,
    courtroom: courtroom,
    notes: notes,
    result_raw: resultText,
    raw_text: blockText.substring(0, 500), // First 500 chars for debugging
    source_date: metadata.date || null,
    source_type: metadata.type || null,
    source_url: metadata.url || null
  };

  // Validate
  const validation = validateEntry(entry);
  entry._valid = validation.valid;
  entry._errors = validation.errors;

  return entry;
}

/**
 * Parse docket from URL (full flow)
 *
 * @param {string} url - URL to docket PDF
 * @param {object} options - Options for fetching and parsing
 * @returns {Promise<{entries: Array, metadata: object}>}
 */
export async function parseDocketFromUrl(url, options = {}) {
  // Extract date and type from URL
  const urlMatch = url.match(/(\d{4}-\d{2}-\d{2})-(\w+)\.pdf$/);
  const metadata = {
    url,
    date: urlMatch ? urlMatch[1] : null,
    type: urlMatch ? urlMatch[2] : null
  };

  // Fetch PDF
  const pdfBuffer = await fetchDocketPdf(url, options);

  // Extract text
  const text = await extractTextFromPdf(pdfBuffer);

  // Parse entries
  const entries = parseFromText(text, metadata);

  return {
    entries,
    metadata: {
      ...metadata,
      totalEntries: entries.length,
      validEntries: entries.filter(e => e._valid).length,
      invalidEntries: entries.filter(e => !e._valid).length
    }
  };
}

/**
 * Filter entries relevant to mineral rights monitoring
 * Excludes enforcement/compliance cases that don't affect mineral owners
 *
 * @param {Array<DocketEntry>} entries
 * @returns {Array<DocketEntry>}
 */
export function filterRelevantEntries(entries) {
  const relevantTypes = [
    'INCREASED_DENSITY',
    'POOLING',
    'SPACING',
    'LOCATION_EXCEPTION',
    'HORIZONTAL_WELL',
    'OPERATOR_CHANGE',
    'WELL_TRANSFER',
    'ORDER_MODIFICATION'
  ];

  return entries.filter(entry => relevantTypes.includes(entry.relief_type));
}

/**
 * Get summary statistics for parsed entries
 *
 * @param {Array<DocketEntry>} entries
 * @returns {object} Summary stats
 */
export function getSummary(entries) {
  const byReliefType = {};
  const byCounty = {};
  const byStatus = {};

  for (const entry of entries) {
    // By relief type
    byReliefType[entry.relief_type] = (byReliefType[entry.relief_type] || 0) + 1;

    // By county
    if (entry.county) {
      byCounty[entry.county] = (byCounty[entry.county] || 0) + 1;
    }

    // By status
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
  }

  return {
    total: entries.length,
    valid: entries.filter(e => e._valid).length,
    byReliefType,
    byCounty,
    byStatus
  };
}

// TypeScript-style type definitions (as JSDoc for documentation)
/**
 * @typedef {Object} DocketEntry
 * @property {string} case_number - e.g., "CD 202500001234"
 * @property {string} relief_type - Categorized type (INCREASED_DENSITY, POOLING, etc.)
 * @property {string} relief_type_raw - Original relief type text
 * @property {string|null} relief_sought - Full description of relief sought
 * @property {string|null} applicant - Company/operator filing
 * @property {string|null} county - Oklahoma county
 * @property {string|null} section - e.g., "14"
 * @property {string|null} township - e.g., "7N"
 * @property {string|null} range - e.g., "4W"
 * @property {string} meridian - Usually "IM" (Indian Meridian)
 * @property {string|null} hearing_date - ISO date format (YYYY-MM-DD)
 * @property {string|null} hearing_time - Time of hearing
 * @property {string} status - SCHEDULED, HEARD, CONTINUED, DISMISSED, etc.
 * @property {string|null} continuation_date - If continued, the new date
 * @property {string|null} judge - Assigned judge
 * @property {string|null} attorney - Attorney for applicant
 * @property {string|null} courtroom - Courtroom assignment
 * @property {string|null} notes - Additional notes/motion text
 * @property {string|null} result_raw - Raw result text
 * @property {string} raw_text - Original text for debugging
 * @property {string|null} source_date - Date of source docket
 * @property {string|null} source_type - Type of source (okc, tulsa, etc.)
 * @property {string|null} source_url - URL of source docket
 * @property {boolean} _valid - Whether entry passed validation
 * @property {Array<string>} _errors - Validation errors if any
 */
