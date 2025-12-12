/**
 * Normalization Utilities - Format conversions between OCC and Airtable
 */

/**
 * Normalize section number to 2-digit string
 * OCC uses integers (1, 14, 36), Airtable may use strings ("01", "14", "36")
 * @param {number|string} section - Section number
 * @returns {string} - Zero-padded 2-digit section
 */
export function normalizeSection(section) {
  if (section == null) return '';
  return String(section).padStart(2, '0');
}

/**
 * Format API number to Oklahoma standard
 * 
 * OCC ITD file formats:
 * - 14-digit format: 35125002050000 (state + county + well + 4 trailing zeros)
 * - 10-digit format: 1290005600 (well number + 2 trailing zeros)
 * Standard OK format: 10 digits with state code 35 prefix (e.g., 3512500205)
 * 
 * @param {string|number} occAPI - API number from OCC file
 * @returns {string} - 10-digit API number with state code
 */
export function normalizeAPI(occAPI) {
  if (!occAPI) return '';
  const str = String(occAPI).replace(/[^0-9]/g, ''); // Remove any non-digits
  
  // Handle 14-digit format: 35125002050000 -> 3512500205
  if (str.length === 14 && str.startsWith('35') && str.endsWith('0000')) {
    return str.slice(0, 10); // Remove trailing 4 zeros
  }
  
  // Handle other 14+ digit formats
  if (str.length >= 14) {
    return str.slice(0, 10); // Take first 10 digits
  }
  
  // If OCC format with trailing 00 (10 digits ending in 00)
  if (str.length === 10 && str.endsWith('00')) {
    // Remove trailing 00 and add state code 35
    return '35' + str.slice(0, -2);
  }
  
  // If already has state code (starts with 35)
  if (str.startsWith('35') && str.length === 10) {
    return str;
  }
  
  // If 8 digits (missing state code), add it
  if (str.length === 8) {
    return '35' + str;
  }
  
  // Handle other formats
  console.warn(`[Normalize] Unexpected API format: ${occAPI} (${str.length} digits)`);
  
  // Default: ensure 10 digits with state code
  if (str.length < 10) {
    return '35' + str.padStart(8, '0');
  }
  
  return str.slice(0, 10);
}

/**
 * Normalize county name for comparison
 * OCC uses uppercase ("CADDO"), Airtable may use title case ("Caddo")
 * @param {string} county - County name
 * @returns {string} - Uppercase county name for comparison
 */
export function normalizeCounty(county) {
  if (!county) return '';
  return county.toUpperCase().trim();
}

/**
 * Format county for display (title case)
 * @param {string} county - County name
 * @returns {string} - Title-cased county name
 */
export function formatCountyDisplay(county) {
  if (!county) return '';
  return county.charAt(0).toUpperCase() + county.slice(1).toLowerCase();
}

/**
 * Normalize operator name for comparison
 * Removes common suffixes and standardizes formatting
 * @param {string} name - Operator name
 * @returns {string} - Normalized operator name
 */
export function normalizeOperator(name) {
  if (!name) return '';
  
  return name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\s+(INC|LLC|LP|LLP|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|OPERATING|PRODUCTION|ENERGY|RESOURCES|PETROLEUM|OIL|GAS|EXPLORATION|DEVELOPMENT|PARTNERS|PARTNERSHIP)$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse township string into components
 * @param {string} township - e.g., "28N", "10S"
 * @returns {Object} - { number: 28, direction: 'N' }
 */
export function parseTownship(township) {
  if (!township) return { number: 0, direction: 'N' };
  
  const match = township.match(/^(\d+)([NS])$/i);
  if (!match) {
    console.warn(`[Normalize] Invalid township format: ${township}`);
    return { number: 0, direction: 'N' };
  }
  
  return {
    number: parseInt(match[1], 10),
    direction: match[2].toUpperCase()
  };
}

/**
 * Parse range string into components
 * @param {string} range - e.g., "19W", "5E"
 * @returns {Object} - { number: 19, direction: 'W' }
 */
export function parseRange(range) {
  if (!range) return { number: 0, direction: 'W' };
  
  const match = range.match(/^(\d+)([EW])$/i);
  if (!match) {
    console.warn(`[Normalize] Invalid range format: ${range}`);
    return { number: 0, direction: 'W' };
  }
  
  return {
    number: parseInt(match[1], 10),
    direction: match[2].toUpperCase()
  };
}

/**
 * Format S-T-R for display
 * @param {string|number} section 
 * @param {string} township 
 * @param {string} range 
 * @returns {string} - e.g., "S14 T28N R19W"
 */
export function formatSTR(section, township, range) {
  return `S${normalizeSection(section)} T${township} R${range}`;
}
