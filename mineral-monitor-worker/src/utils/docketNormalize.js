/**
 * Docket Normalization Utilities
 *
 * Helpers to normalize and validate parsed docket data.
 */

/**
 * Normalize township format: "7 North" → "7N", "7N" → "7N", "07N" → "7N"
 */
export function normalizeTownship(raw) {
  if (!raw) return null;

  const str = raw.toString().trim().toUpperCase();

  // Match patterns like "7N", "7 N", "7 NORTH", "07N"
  const match = str.match(/^0*(\d{1,2})\s*(N|S|NORTH|SOUTH)$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    const dir = match[2].charAt(0).toUpperCase(); // N or S
    return `${num}${dir}`;
  }

  return null;
}

/**
 * Normalize range format: "4 West" → "4W", "4W" → "4W", "04W" → "4W"
 */
export function normalizeRange(raw) {
  if (!raw) return null;

  const str = raw.toString().trim().toUpperCase();

  // Match patterns like "4W", "4 W", "4 WEST", "04W"
  const match = str.match(/^0*(\d{1,2})\s*(E|W|EAST|WEST)$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    const dir = match[2].charAt(0).toUpperCase(); // E or W
    return `${num}${dir}`;
  }

  return null;
}

/**
 * Normalize section: "Section 14" → "14", "Sec. 14" → "14", "S14" → "14"
 */
export function normalizeDocketSection(raw) {
  if (!raw) return null;

  const str = raw.toString().trim();

  // Match patterns like "14", "S14", "Sec 14", "Section 14"
  const match = str.match(/^(?:S(?:EC(?:TION)?)?\.?\s*)?0*(\d{1,2})$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 36) {
      return num.toString();
    }
  }

  return null;
}

/**
 * Normalize county name: trim, title case
 */
export function normalizeCounty(raw) {
  if (!raw) return null;

  const str = raw.toString().trim();
  // Remove any trailing asterisks or parenthetical notes
  const clean = str.replace(/\s*\(\*\).*$/, '').replace(/\*$/, '').trim();

  // Title case
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/**
 * Categorize relief type from description text
 */
export function categorizeReliefType(reliefType, reliefSought) {
  if (!reliefType) return 'OTHER';

  const text = `${reliefType} ${reliefSought || ''}`.toUpperCase();

  // Check for specific patterns
  if (text.includes('INCREASED') && text.includes('DENSITY')) {
    return 'INCREASED_DENSITY';
  }

  if (text.includes('POOLING')) {
    return 'POOLING';
  }

  if (text.includes('SPACING') || text.includes('DRILLING AND SPACING UNIT')) {
    return 'SPACING';
  }

  if (text.includes('LOCATION EXCEPTION')) {
    return 'LOCATION_EXCEPTION';
  }

  if (text.includes('MULTI-UNIT') || text.includes('MULTIUNIT') || text.includes('HORIZONTAL')) {
    return 'HORIZONTAL_WELL';
  }

  if (text.includes('OPERATOR') && (text.includes('CHANGE') || text.includes('TRANSFER'))) {
    return 'OPERATOR_CHANGE';
  }

  if (text.includes('TRANSFER')) {
    return 'WELL_TRANSFER';
  }

  if (text.includes('PRIOR ORDER') || text.includes('CLARIFY') || text.includes('MODIFY')) {
    return 'ORDER_MODIFICATION';
  }

  // Enforcement/Compliance - less relevant for mineral owners
  if (text.includes('FINE') || text.includes('PLUG') || text.includes('CONTEMPT') ||
      text.includes('POLLUTION') || text.includes('UIC') || text.includes('DISPOSAL')) {
    return 'ENFORCEMENT';
  }

  return 'OTHER';
}

/**
 * Parse result code into status
 * Common codes: C (Continued), RO (Record Opened), MOR (Motion Recommended),
 * DIS (Dismissed), DMOA (Dismissed on Motion), MOW (Motion Withdrawn)
 */
export function parseResultStatus(resultText) {
  if (!resultText) return 'UNKNOWN';

  const text = resultText.toUpperCase();

  // Check for continuation with date
  if (text.startsWith('C -') || text.startsWith('C-')) {
    return 'CONTINUED';
  }

  if (text.includes('DIS') || text.includes('DISMISSED')) {
    return 'DISMISSED';
  }

  if (text.includes('DMOA')) {
    return 'DISMISSED';
  }

  if (text.includes('MOR') || text.includes('MOTION RECOMMENDED')) {
    return 'RECOMMENDED';
  }

  if (text.includes('RO') || text.includes('RECORD OPENED')) {
    return 'HEARD';
  }

  if (text.includes('MOW') || text.includes('MOTION WITHDRAWN')) {
    return 'WITHDRAWN';
  }

  if (text.includes('TUA') || text.includes('TAKEN UNDER ADVISEMENT')) {
    return 'UNDER_ADVISEMENT';
  }

  if (text.includes('APPROVED') || text.includes('GRANTED')) {
    return 'APPROVED';
  }

  if (text.includes('DENIED')) {
    return 'DENIED';
  }

  return 'SCHEDULED';
}

/**
 * Extract continuation date from result text
 * e.g., "C - 01/16/2026 08:30 AM" → "2026-01-16"
 */
function extractContinuationDate(resultText) {
  if (!resultText) return null;

  // Match MM/DD/YYYY format
  const match = resultText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const month = match[1].padStart(2, '0');
    const day = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Parse legal description string into components
 * e.g., "S14 T5N R4W McClain (*)" → { section: "14", township: "5N", range: "4W", county: "McClain" }
 */
function parseLegalDescription(legalStr) {
  if (!legalStr) return null;

  // Pattern: S## T##N/S R##E/W County
  const match = legalStr.match(/S(\d{1,2})\s+T(\d{1,2}[NS])\s+R(\d{1,2}[EW])\s+([A-Za-z]+)/i);

  if (match) {
    return {
      section: normalizeSection(match[1]),
      township: normalizeTownship(match[2]),
      range: normalizeRange(match[3]),
      county: normalizeCounty(match[4]),
      meridian: 'IM' // Oklahoma uses Indian Meridian
    };
  }

  return null;
}

/**
 * Validate a parsed docket entry
 */
function validateEntry(entry) {
  const errors = [];

  if (!entry.case_number?.match(/^CD\d{4}-\d{6}$/)) {
    errors.push(`Invalid case number format: ${entry.case_number}`);
  }

  if (entry.section && !entry.section.match(/^\d{1,2}$/)) {
    errors.push(`Invalid section: ${entry.section}`);
  }

  if (entry.township && !entry.township.match(/^\d{1,2}[NS]$/)) {
    errors.push(`Invalid township: ${entry.township}`);
  }

  if (entry.range && !entry.range.match(/^\d{1,2}[EW]$/)) {
    errors.push(`Invalid range: ${entry.range}`);
  }

  // Section must be 1-36
  if (entry.section) {
    const secNum = parseInt(entry.section, 10);
    if (secNum < 1 || secNum > 36) {
      errors.push(`Section out of range (1-36): ${entry.section}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  normalizeTownship,
  normalizeRange,
  normalizeSection,
  normalizeCounty,
  categorizeReliefType,
  parseResultStatus,
  extractContinuationDate,
  parseLegalDescription,
  validateEntry
};
