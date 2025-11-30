/**
 * Map Link Utilities - Generate OCC GIS Map links with pin markers
 * 
 * Uses the "marker/markertemplate" URL pattern which:
 * 1. Never fails regardless of layer configuration
 * 2. Drops a pin at exact GPS coordinates
 * 3. Shows a custom popup with well name
 * 4. Zooms to level 19 for close-up view
 */

// Base URL for OCC Web App Viewer
const OCC_MAP_BASE_URL = 'https://gis.occ.ok.gov/portal/apps/webappviewer/index.html?id=ba9b8612132f4106be6e3553dc0b827b';

/**
 * Generate a "Pin Drop" link for the OCC Map
 * 
 * @param {Object} well - Well data with coordinates
 * @param {number} well.sh_lat - Surface hole latitude
 * @param {number} well.sh_lon - Surface hole longitude
 * @param {string} [well.well_name] - Well name for popup title
 * @param {string} [well.api] - API number (fallback for title)
 * @returns {string} - Full URL with marker parameters, or base URL if no coordinates
 */
export function getMapLink(well) {
  // Safety: If no coords, return the generic map so the link isn't broken
  if (!well || !well.sh_lat || !well.sh_lon || well.sh_lat === 0 || well.sh_lon === 0) {
    return null; // Return null instead of generic URL - let caller decide
  }

  // 1. The Marker Position
  // Format: longitude,latitude,,,, (extra commas are part of the format)
  const markerParam = `${well.sh_lon},${well.sh_lat},,,,`;

  // 2. The Pop-up Data
  const templateData = {
    title: well.well_name || `Well ${well.api}`,
    longitude: well.sh_lon,
    latitude: well.sh_lat,
    isIncludeShareUrl: true
  };

  // 3. Assemble
  // encodeURIComponent handles spaces, '&', and other risky chars in well names
  const encodedTemplate = encodeURIComponent(JSON.stringify(templateData));

  // level=19 is very close zoom. Use 17 for slightly wider view.
  return `${OCC_MAP_BASE_URL}&marker=${markerParam}&markertemplate=${encodedTemplate}&level=19`;
}

/**
 * Get the base OCC map URL without any markers
 * Useful as a fallback when coordinates aren't available
 * @returns {string} - Base map URL
 */
export function getBaseMapUrl() {
  return OCC_MAP_BASE_URL;
}

/**
 * Generate map link from API number by looking up coordinates
 * This is a convenience wrapper that combines OCC GIS lookup with link generation
 * 
 * @param {string} api10 - 10-digit API number
 * @param {Object} wellData - Pre-fetched well data (optional, to avoid duplicate lookups)
 * @returns {string|null} - Map link URL or null if coordinates unavailable
 */
export function getMapLinkFromWellData(wellData) {
  if (!wellData || wellData.notFound || wellData.missingCoordinates) {
    return null;
  }
  return getMapLink(wellData);
}
