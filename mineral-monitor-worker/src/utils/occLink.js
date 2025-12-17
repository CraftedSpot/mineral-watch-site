/**
 * OCC Link Utilities - Generate correct OCC website links
 * 
 * The new OCC website uses a specific URL format for well searches.
 * The old imaging.occ.ok.gov links are deprecated.
 */

/**
 * Generate OCC Well Records search link
 * @param {string} apiNumber - 10-digit API number
 * @returns {string} - URL to OCC well records search
 */
export function getOCCWellRecordsLink(apiNumber) {
  if (!apiNumber) return '';
  
  // The OCC search expects the API with asterisk for wildcard
  // URL pattern: https://public.occ.ok.gov/OGCDWellRecords/Search.aspx?searchcommand={[OG Well Records]:[API Number]="3508700028*"}
  const searchCommand = `{[OG Well Records]:[API Number]="${apiNumber}*"}`;
  
  // URL encode the search command
  const encodedCommand = encodeURIComponent(searchCommand);
  
  return `https://public.occ.ok.gov/OGCDWellRecords/Search.aspx?searchcommand=${encodedCommand}`;
}

/**
 * Get OCC cookie error message for tooltips/notices
 * @param {boolean} truncated - Return shortened version for space-limited contexts
 * @returns {string} - Cookie error notice text
 */
export function getOCCCookieNotice(truncated = false) {
  if (truncated) {
    return 'If you see an error regarding cookies, either press the sign out link or try opening in incognito/private window.';
  }
  
  return 'If you see a cookie error on OCC\'s site, try signing out of OCC first or open this link in an incognito/private window.';
}