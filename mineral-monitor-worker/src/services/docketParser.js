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
 * Extract text from PDF ArrayBuffer using unpdf
 *
 * @param {ArrayBuffer} pdfBuffer - PDF file as ArrayBuffer
 * @returns {Promise<string>} Extracted text
 */
export async function extractTextFromPdf(pdfBuffer) {
  const { extractText } = await import('unpdf');
  const result = await extractText(pdfBuffer);

  // unpdf returns { text: string[], totalPages: number }
  // text is an array of strings (one per page)
  const textArray = result.text || [];
  return Array.isArray(textArray) ? textArray.join('\n') : String(textArray);
}

/**
 * Parse docket text into structured entries
 * Handles both pdftotext (newline-separated) and unpdf (compact) formats
 *
 * @param {string} text - Extracted text from docket PDF
 * @param {object} metadata - Optional metadata (date, type, url)
 * @returns {Array<DocketEntry>} Parsed entries
 */
export function parseFromText(text, metadata = {}) {
  const entries = [];

  // Case numbers look like: CD2025-001811
  // In unpdf format, they may be followed by content on same line
  // Pattern captures case number with word boundary (not requiring newlines)
  const casePattern = /(CD\d{4}-\d{6})/g;

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

  // Deduplicate case numbers (same case may appear multiple times in header/footer)
  const seenCases = new Set();
  const uniqueCaseMatches = caseMatches.filter(m => {
    if (seenCases.has(m.caseNumber)) return false;
    seenCases.add(m.caseNumber);
    return true;
  });

  // Parse each case block
  for (let i = 0; i < uniqueCaseMatches.length; i++) {
    const current = uniqueCaseMatches[i];
    const nextStart = uniqueCaseMatches[i + 1]?.startIndex || text.length;
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
 * Handles compact unpdf format where fields can be on same line
 *
 * @param {string} caseNumber - The case number (e.g., CD2025-001811)
 * @param {string} blockText - The text block for this entry
 * @param {object} metadata - Optional metadata
 * @returns {DocketEntry|null}
 */
function parseEntryBlock(caseNumber, blockText, metadata = {}) {
  // Field markers used to delimit values (fields can be on same line in unpdf format)
  const fieldMarkers = /(?:Judge:|Parties:|Legal:|Attorney:|Courtroom:|Text:|Court Reporter:|Relief Type:|Relief Sought:|Result:)/i;

  // Helper to extract field value up to next field marker or newline
  const extractField = (pattern) => {
    const match = blockText.match(pattern);
    if (!match) return null;
    let value = match[1];
    // Trim at next field marker if present
    const nextMarker = value.search(fieldMarkers);
    if (nextMarker > 0) {
      value = value.substring(0, nextMarker);
    }
    return value.trim() || null;
  };

  // Judge - value ends at next field marker
  const judge = extractField(/Judge:\s*(.+?)(?=\s*(?:Parties:|Courtroom:|Legal:|$))/i);

  // Courtroom - often right after Judge
  const courtroom = extractField(/Courtroom:\s*(\S+)/i);

  // Parties/Applicant
  const partiesMatch = blockText.match(/Parties:\s*(.+?)(?=\s*Legal:)/is);
  let applicant = null;
  if (partiesMatch) {
    const partiesText = partiesMatch[1].replace(/\n/g, ' ').trim();
    const applicantMatch = partiesText.match(/([^|]+)\s*\(Applicant\)/i);
    applicant = applicantMatch ? applicantMatch[1].trim() : partiesText.split('|')[0].trim();
  }

  // Legal description - S## T##N R##E/W County
  const legalMatch = blockText.match(/Legal:\s*(S\d{1,2}\s+T\d{1,2}[NS]\s+R\d{1,2}[EW]\s+[A-Za-z]+(?:\s*\(\*\))?)/i);
  const legalStr = legalMatch ? legalMatch[1].trim() : null;
  const legal = parseLegalDescription(legalStr);

  // Attorney
  const attorney = extractField(/Attorney:\s*([^,\n]+(?:,\s*[^,\n]+)?)/i);

  // Hearing date - "Friday, January 9, 2026 8:30 AM"
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

  // Relief Type and Relief Sought
  // Format: "Relief Type: [type] Relief Sought: [sought]" (possibly followed by newline or Result:)
  const reliefMatch = blockText.match(/Relief Type:\s*(.+?)\s+Relief Sought:\s*(.*?)(?=\s*(?:\n|Result:))/i);
  let reliefType = null;
  let reliefSought = null;
  if (reliefMatch) {
    reliefType = reliefMatch[1].trim();
    reliefSought = reliefMatch[2]?.trim();
    // Clean up dash-only values
    if (reliefSought === '-' || reliefSought === '') reliefSought = null;
  }

  // Result - everything after "Result:" until newline or end
  const resultMatch = blockText.match(/Result:\s*([^\n]+)/i);
  const resultText = resultMatch ? resultMatch[1].trim() : null;
  const status = parseResultStatus(resultText);
  const continuationDate = extractContinuationDate(resultText);

  // Text/Notes field (motion details) - between "Text:" and "Court Reporter:" or "Relief Type:"
  const textMatch = blockText.match(/Text:\s*(.+?)(?=\s*(?:Court Reporter:|Relief Type:))/is);
  const notes = textMatch ? textMatch[1].replace(/\n/g, ' ').trim() : null;

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
