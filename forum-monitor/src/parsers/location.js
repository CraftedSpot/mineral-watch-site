/**
 * Location Parser
 * Extracts STR (Section-Township-Range), county names, and operator names from forum post text
 */

// All 77 Oklahoma counties
const OKLAHOMA_COUNTIES = [
  'Adair', 'Alfalfa', 'Atoka', 'Beaver', 'Beckham', 'Blaine', 'Bryan',
  'Caddo', 'Canadian', 'Carter', 'Cherokee', 'Choctaw', 'Cimarron',
  'Cleveland', 'Coal', 'Comanche', 'Cotton', 'Craig', 'Creek', 'Custer',
  'Delaware', 'Dewey', 'Ellis', 'Garfield', 'Garvin', 'Grady', 'Grant',
  'Greer', 'Harmon', 'Harper', 'Haskell', 'Hughes', 'Jackson', 'Jefferson',
  'Johnston', 'Kay', 'Kingfisher', 'Kiowa', 'Latimer', 'LeFlore', 'Lincoln',
  'Logan', 'Love', 'Major', 'Marshall', 'Mayes', 'McClain', 'McCurtain',
  'McIntosh', 'Murray', 'Muskogee', 'Noble', 'Nowata', 'Okfuskee',
  'Oklahoma', 'Okmulgee', 'Osage', 'Ottawa', 'Pawnee', 'Payne', 'Pittsburg',
  'Pontotoc', 'Pottawatomie', 'Pushmataha', 'Roger Mills', 'Rogers',
  'Seminole', 'Sequoyah', 'Stephens', 'Texas', 'Tillman', 'Tulsa',
  'Wagoner', 'Washington', 'Washita', 'Woods', 'Woodward',
];

// Common Oklahoma operators (static list for Phase 1)
const KNOWN_OPERATORS = [
  'Continental Resources', 'Devon Energy', 'Ovintiv', 'Marathon Oil',
  'Citizen Energy', 'Mewbourne Oil', 'Camino Natural Resources',
  'Chaparral Energy', 'Unit Corporation', 'Chesapeake Energy',
  'Sandridge Energy', 'Newpark Resources', 'Gulfport Energy',
  'Encana', 'Cimarex Energy', 'Laredo Petroleum', 'Roan Resources',
  'Alta Mesa', 'Casillas Petroleum', 'BCE-Mach', 'Mach Natural Resources',
  'Vital Energy', 'Paladin Energy', 'Tap Rock Resources',
];

/**
 * STR regex patterns for forum text
 * Oklahoma bounds: sections 1-36, townships 1-29, ranges 1-28
 */
const STR_PATTERNS = [
  // Full format: Section X, Township YN, Range ZW (or Sec. 22, T14N, R11W)
  {
    regex: /Sec(?:tion)?\.?\s*(\d{1,2})\s*[-,\s]+T(?:ownship)?\.?\s*(\d{1,2})\s*([NS])\s*[-,\s]+R(?:ange)?\.?\s*(\d{1,2})\s*([EW])/gi,
    extract: (m) => ({ section: m[1], township: m[2], direction: m[3], range: m[4], ew: m[5] }),
  },
  // Compact with required hyphen separators: 22-14N-11W
  {
    regex: /\b(\d{1,2})\s*-\s*(\d{1,2})([NS])\s*-\s*(\d{1,2})([EW])\b/gi,
    extract: (m) => ({ section: m[1], township: m[2], direction: m[3], range: m[4], ew: m[5] }),
  },
  // Reversed: T14N R11W Sec 22 (or T14N-R11W-S22)
  {
    regex: /T(?:ownship)?\.?\s*(\d{1,2})\s*([NS])\s*[-,\s]+R(?:ange)?\.?\s*(\d{1,2})\s*([EW])\s*[-,\s]+Sec(?:tion)?\.?\s*(\d{1,2})/gi,
    extract: (m) => ({ section: m[5], township: m[1], direction: m[2], range: m[3], ew: m[4] }),
  },
];

/**
 * Validate STR values against Oklahoma bounds
 */
function isValidOklahomaSTR(section, township, range) {
  const sec = parseInt(section);
  const twp = parseInt(township);
  const rng = parseInt(range);
  return sec >= 1 && sec <= 36 && twp >= 1 && twp <= 29 && rng >= 1 && rng <= 28;
}

/**
 * Extract STR locations from text
 * @param {string} text - Post text (raw markdown or plain text)
 * @returns {Array<{section: string, township: string, direction: string, range: string, ew: string, normalized: string}>}
 */
export function extractSTR(text) {
  if (!text) return [];

  const results = [];
  const seen = new Set();

  for (const pattern of STR_PATTERNS) {
    // Reset regex lastIndex for each call
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const extracted = pattern.extract(match);
      const { section, township, direction, range, ew } = extracted;

      if (!isValidOklahomaSTR(section, township, range)) continue;

      const normalized = `${parseInt(section)}-${parseInt(township)}${direction.toUpperCase()}-${parseInt(range)}${ew.toUpperCase()}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      results.push({
        section: String(parseInt(section)),
        township: String(parseInt(township)),
        direction: direction.toUpperCase(),
        range: String(parseInt(range)),
        ew: ew.toUpperCase(),
        normalized,
      });
    }
  }

  return results;
}

/**
 * Detect Oklahoma county names in text
 * Matches patterns like "Grady County", "in Grady", county name standalone
 * @param {string} text - Post text
 * @returns {Array<string>} - Detected county names (deduplicated)
 */
export function detectCounties(text) {
  if (!text) return [];

  const found = new Set();
  const textLower = text.toLowerCase();

  for (const county of OKLAHOMA_COUNTIES) {
    const countyLower = county.toLowerCase();
    // Match "Grady County" or "Grady county" or standalone county name
    // Use word boundary to avoid partial matches (e.g., "Carter" in "Cartersville")
    const patterns = [
      new RegExp(`\\b${escapeRegex(countyLower)}\\s+county\\b`, 'i'),
      new RegExp(`\\bin\\s+${escapeRegex(countyLower)}\\b`, 'i'),
      new RegExp(`\\bnear\\s+${escapeRegex(countyLower)}\\b`, 'i'),
    ];

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        found.add(county);
        break;
      }
    }
  }

  // Also check for standalone county names (longer names to avoid false positives)
  // Only match counties with 5+ chars standalone to reduce false positives
  for (const county of OKLAHOMA_COUNTIES) {
    if (county.length >= 5 && !found.has(county)) {
      const regex = new RegExp(`\\b${escapeRegex(county)}\\b`, 'i');
      if (regex.test(text)) {
        found.add(county);
      }
    }
  }

  return Array.from(found);
}

/**
 * Detect operator names in text
 * @param {string} text - Post text
 * @returns {Array<string>} - Detected operator names
 */
export function detectOperators(text) {
  if (!text) return [];

  const found = [];

  for (const operator of KNOWN_OPERATORS) {
    const regex = new RegExp(`\\b${escapeRegex(operator)}\\b`, 'i');
    if (regex.test(text)) {
      found.push(operator);
    }
  }

  return found;
}

/**
 * Parse all location data from post text
 * @param {string} text - Post text (raw or cooked)
 * @returns {{str: Array, counties: Array, operators: Array, detectedLocation: string, detectedSTR: string, detectedCounty: string}}
 */
export function parseLocations(text) {
  // Strip HTML tags if cooked HTML was passed
  const cleanText = text.replace(/<[^>]+>/g, ' ');

  const str = extractSTR(cleanText);
  const counties = detectCounties(cleanText);
  const operators = detectOperators(cleanText);

  // Build human-readable detected location string
  const locationParts = [];
  if (str.length > 0) {
    const first = str[0];
    locationParts.push(`Section ${first.section}, T${first.township}${first.direction}, R${first.range}${first.ew}`);
  }
  if (counties.length > 0) {
    locationParts.push(`${counties[0]} County`);
  }
  const detectedLocation = locationParts.join(' — ') || '';

  return {
    str,
    counties,
    operators,
    detectedLocation,
    detectedSTR: str.length > 0 ? str[0].normalized : '',
    detectedCounty: counties.length > 0 ? counties[0] : '',
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
