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

// All 77 Oklahoma counties, longest first for greedy matching
const OK_COUNTIES = [
  'Roger Mills', 'Le Flore', 'Pottawatomie', 'Pushmataha',
  'Washington', 'Kingfisher', 'McCurtain', 'Cleveland', 'Comanche',
  'Cimarron', 'Muskogee', 'Pittsburg', 'Pottawatomie', 'Sequoyah',
  'Woodward', 'McIntosh', 'Okfuskee', 'Oklahoma', 'Okmulgee',
  'Pontotoc', 'Seminole', 'Stephens', 'Tillman', 'Wagoner',
  'McClain', 'Marshall', 'Haskell', 'Johnston', 'Cherokee',
  'Choctaw', 'Delaware', 'Garfield', 'Latimer', 'Lincoln',
  'Alfalfa', 'Beckham', 'Caddo', 'Canadian', 'Carter', 'Cotton',
  'Craig', 'Creek', 'Custer', 'Dewey', 'Ellis', 'Garvin',
  'Grady', 'Grant', 'Greer', 'Harmon', 'Harper', 'Hughes',
  'Jackson', 'Jefferson', 'Kay', 'Kiowa', 'Logan', 'Love',
  'Major', 'Mayes', 'Murray', 'Noble', 'Nowata', 'Osage',
  'Ottawa', 'Pawnee', 'Payne', 'Rogers', 'Texas', 'Tulsa',
  'Washita', 'Woods', 'Adair', 'Atoka', 'Beaver', 'Blaine',
  'Bryan', 'Coal',
].sort((a, b) => b.length - a.length);

// Map for case-insensitive lookup
const COUNTY_LOOKUP = new Map(OK_COUNTIES.map(c => [c.toUpperCase(), c]));

/**
 * Normalize county name: match against known OK counties, then title-case
 */
export function normalizeCounty(raw) {
  if (!raw) return null;

  const str = raw.toString().trim();
  const clean = str.replace(/\s*\(\*\).*$/, '').replace(/\*$/, '').trim();

  // Try exact match against known counties (case-insensitive)
  const found = COUNTY_LOOKUP.get(clean.toUpperCase());
  if (found) return found;

  // Title case fallback for unknown inputs
  return clean.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Extract county name from a legal description string by matching against known OK counties.
 * Handles multi-word counties like "Roger Mills" and "Le Flore".
 */
export function extractCountyFromLegal(legalStr) {
  if (!legalStr) return null;
  const upper = legalStr.toUpperCase();
  for (const county of OK_COUNTIES) {
    if (upper.includes(county.toUpperCase())) {
      return county;
    }
  }
  return null;
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
export function extractContinuationDate(resultText) {
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
 * Parse ALL legal descriptions from a string (supports multi-section orders)
 * Handles patterns like:
 * - "S35 T13N R12E AND S2 T12N R12E McClain"
 * - "S14 T5N R4W McClain (*)"
 * - "N/2 of Section 35, T13N R12E and NW/4 of Section 2, T12N R12E, McClain"
 *
 * Returns: { primary: {...}, additional: [...], county: string, meridian: string }
 */
export function parseAllLegalDescriptions(legalStr) {
  if (!legalStr) return null;

  const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
  const allLocations = [];
  let county = null;

  // Strategy 1: Find all "S## T##N/S R##E/W" patterns (docket format)
  // Pattern matches: S14 T5N R4W, S2 T12N R12E, etc.
  const docketPattern = /S(\d{1,2})\s+T(\d{1,2}[NS])\s+R(\d{1,2}[EW])/gi;
  let match;

  while ((match = docketPattern.exec(legalStr)) !== null) {
    const section = normalizeDocketSection(match[1]);
    const township = normalizeTownship(match[2]);
    const range = normalizeRange(match[3]);

    if (section && township && range) {
      // Check if this STR is already in our list (avoid duplicates)
      const exists = allLocations.some(
        loc => loc.section === section && loc.township === township && loc.range === range
      );
      if (!exists) {
        allLocations.push({ section, township, range });
      }
    }
  }

  // Strategy 2: Handle verbose format "Section ##, Township ## North, Range ## West"
  const verbosePattern = /Section\s+(\d{1,2})[\s,]+(?:Township\s+)?(\d{1,2})\s*(North|South|N|S)[\s,]+(?:Range\s+)?(\d{1,2})\s*(East|West|E|W)/gi;

  while ((match = verbosePattern.exec(legalStr)) !== null) {
    const section = normalizeDocketSection(match[1]);
    const township = normalizeTownship(`${match[2]}${match[3].charAt(0)}`);
    const range = normalizeRange(`${match[4]}${match[5].charAt(0)}`);

    if (section && township && range) {
      const exists = allLocations.some(
        loc => loc.section === section && loc.township === township && loc.range === range
      );
      if (!exists) {
        allLocations.push({ section, township, range });
      }
    }
  }

  // Strategy 3: Handle partial STR with shared township/range
  // e.g., "Sections 35 and 2, T13N R12E" or "S35, S2, T13N R12E"
  const sharedTRPattern = /(?:Sections?\s+)?(\d{1,2})(?:\s*(?:,|and|&)\s*(\d{1,2}))+[\s,]+T(\d{1,2}[NS])\s+R(\d{1,2}[EW])/gi;

  while ((match = sharedTRPattern.exec(legalStr)) !== null) {
    const township = normalizeTownship(match[3]);
    const range = normalizeRange(match[4]);

    if (township && range) {
      // Extract all section numbers from the match
      const sectionPart = match[0].split(/T\d{1,2}[NS]/i)[0];
      const sectionMatches = sectionPart.match(/\d{1,2}/g);

      if (sectionMatches) {
        for (const secNum of sectionMatches) {
          const section = normalizeDocketSection(secNum);
          if (section) {
            const exists = allLocations.some(
              loc => loc.section === section && loc.township === township && loc.range === range
            );
            if (!exists) {
              allLocations.push({ section, township, range });
            }
          }
        }
      }
    }
  }

  // Extract county by matching against known Oklahoma counties
  // (handles multi-word names like "Roger Mills" and "Le Flore")
  county = extractCountyFromLegal(legalStr);

  if (allLocations.length === 0) {
    return null;
  }

  // Determine meridian based on county
  const meridian = panhandleCounties.includes(county?.toUpperCase()) ? 'CM' : 'IM';

  // Add county and meridian to all locations
  for (const loc of allLocations) {
    loc.county = county;
    loc.meridian = meridian;
  }

  // Return primary (first) and additional (rest)
  const [primary, ...additional] = allLocations;

  return {
    primary,
    additional: additional.length > 0 ? additional : null,
    county,
    meridian
  };
}

/**
 * Parse legal description string into components (backward compatible)
 * e.g., "S14 T5N R4W McClain (*)" → { section: "14", township: "5N", range: "4W", county: "McClain" }
 *
 * NOTE: For multi-section support, use parseAllLegalDescriptions() instead
 */
export function parseLegalDescription(legalStr) {
  const result = parseAllLegalDescriptions(legalStr);
  if (!result) return null;

  // Return the primary location for backward compatibility
  return result.primary;
}

/**
 * Extract API numbers from text (docket entry, legal description, notes, etc.)
 *
 * Oklahoma API formats:
 * - 5-digit: 049-24518 (county code + sequence)
 * - With suffix: 049-24518A, 049-24518-1
 * - Full 10-digit: 35-049-24518 (state-county-sequence)
 * - Without dashes: 04924518
 *
 * Returns array of normalized API numbers (always 5-digit county-sequence format)
 */
export function parseAPINumbers(text) {
  if (!text) return [];

  const apiNumbers = new Set();

  // Pattern 1: Full 10-digit format (35-049-24518 or 35049-24518)
  // Oklahoma state code is 35
  const fullPattern = /\b35[-\s]?(\d{3})[-\s]?(\d{5})[A-Z]?(?:-\d+)?\b/gi;
  let match;

  while ((match = fullPattern.exec(text)) !== null) {
    const county = match[1];
    const sequence = match[2];
    apiNumbers.add(`${county}-${sequence}`);
  }

  // Pattern 2: 5-digit format with dash (049-24518, 049-24518A)
  // County codes are 001-077 for Oklahoma
  const shortPattern = /\b(0[0-7]\d)[-\s]?(\d{5})[A-Z]?(?:-\d+)?\b/gi;

  while ((match = shortPattern.exec(text)) !== null) {
    const county = match[1];
    const sequence = match[2];
    // Avoid matching dates or other numbers
    if (parseInt(county, 10) >= 1 && parseInt(county, 10) <= 77) {
      apiNumbers.add(`${county}-${sequence}`);
    }
  }

  // Pattern 3: Without dashes (04924518) - 8 digits
  // More strict - must have valid county code prefix
  const noDashPattern = /\b(0[0-7]\d)(\d{5})\b/g;

  while ((match = noDashPattern.exec(text)) !== null) {
    const county = match[1];
    const sequence = match[2];
    // Only include if county code is valid (001-077)
    if (parseInt(county, 10) >= 1 && parseInt(county, 10) <= 77) {
      apiNumbers.add(`${county}-${sequence}`);
    }
  }

  // Pattern 4: Explicit "API" label nearby (API: 049-24518 or API #049-24518)
  const labeledPattern = /API[\s:#]*(\d{3})[-\s]?(\d{5})[A-Z]?/gi;

  while ((match = labeledPattern.exec(text)) !== null) {
    const county = match[1];
    const sequence = match[2];
    apiNumbers.add(`${county}-${sequence}`);
  }

  return Array.from(apiNumbers);
}

/**
 * Normalize an API number to standard format
 * Input: "35-049-24518", "04924518", "049-24518A"
 * Output: "049-24518" (county-sequence only)
 */
export function normalizeAPINumber(api) {
  if (!api) return null;

  const str = api.toString().trim().replace(/[^0-9]/g, '');

  // 10-digit (state-county-sequence): 3504924518
  if (str.length === 10 && str.startsWith('35')) {
    return `${str.substring(2, 5)}-${str.substring(5, 10)}`;
  }

  // 8-digit (county-sequence): 04924518
  if (str.length === 8) {
    return `${str.substring(0, 3)}-${str.substring(3, 8)}`;
  }

  // Already normalized or close
  const match = api.match(/(\d{3})[-\s]?(\d{5})/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  return null;
}

/**
 * Validate a parsed docket entry
 */
export function validateEntry(entry) {
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

// ES module exports are inline above
