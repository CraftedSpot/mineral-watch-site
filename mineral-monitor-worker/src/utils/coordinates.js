/**
 * Coordinate Utilities - Fallback system for getting well coordinates
 * 
 * Priority order:
 * 1. OCC GIS API coordinates (most accurate)
 * 2. Calculated from TRS (Township/Range/Section) data
 * 3. County center coordinates
 */

import { fetchWellCoordinates } from '../services/occGis.js';

// Oklahoma county center coordinates (lat, lon)
// Based on geographic centers of each county
const OKLAHOMA_COUNTY_CENTERS = {
  'ADAIR': [35.8865, -94.6583],
  'ALFALFA': [36.7333, -98.3167],
  'ATOKA': [34.3833, -96.1167],
  'BEAVER': [36.8167, -100.5167],
  'BECKHAM': [35.2167, -99.9167],
  'BLAINE': [35.8833, -98.4500],
  'BRYAN': [33.9333, -96.3667],
  'CADDO': [35.1500, -98.3833],
  'CANADIAN': [35.5167, -97.9833],
  'CARTER': [34.2000, -97.4000],
  'CHEROKEE': [35.9000, -95.0333],
  'CHOCTAW': [34.0000, -95.5000],
  'CIMARRON': [36.7500, -102.5167],
  'CLEVELAND': [35.2167, -97.4167],
  'COAL': [34.6333, -96.2000],
  'COMANCHE': [34.7167, -98.4167],
  'COTTON': [34.3167, -98.3000],
  'CRAIG': [36.7833, -95.0167],
  'CREEK': [35.8333, -96.4167],
  'CUSTER': [35.6333, -98.9667],
  'DELAWARE': [36.2833, -94.8833],
  'DEWEY': [36.0000, -99.0333],
  'ELLIS': [36.2000, -99.8667],
  'GARFIELD': [36.4000, -97.7667],
  'GARVIN': [34.8833, -97.2667],
  'GRADY': [35.1000, -97.8500],
  'GRANT': [36.9000, -97.7000],
  'GREER': [34.8833, -99.7167],
  'HARMON': [34.8333, -99.7833],
  'HARPER': [36.6667, -99.6333],
  'HASKELL': [35.1167, -95.3333],
  'HUGHES': [35.0833, -96.1167],
  'JACKSON': [34.8000, -99.2833],
  'JEFFERSON': [34.1167, -97.8000],
  'JOHNSTON': [34.3000, -96.6167],
  'KAY': [36.8167, -97.1167],
  'KINGFISHER': [35.8667, -97.9333],
  'KIOWA': [34.9833, -98.9833],
  'LATIMER': [34.9333, -95.2833],
  'LE FLORE': [34.9833, -94.8167],
  'LINCOLN': [35.5500, -96.9000],
  'LOGAN': [35.8667, -97.2500],
  'LOVE': [33.8333, -97.2333],
  'MCCLAIN': [35.0667, -97.4167],
  'MCCURTAIN': [34.2167, -94.8833],
  'MCINTOSH': [35.2167, -95.5833],
  'MAJOR': [36.2833, -98.3500],
  'MARSHALL': [33.9333, -96.6667],
  'MAYES': [36.3167, -95.2833],
  'MURRAY': [34.5000, -97.1667],
  'MUSKOGEE': [35.6833, -95.3333],
  'NOBLE': [36.4167, -97.2500],
  'NOWATA': [36.7167, -95.6167],
  'OKFUSKEE': [35.3833, -96.2333],
  'OKLAHOMA': [35.4833, -97.5333],
  'OKMULGEE': [35.5500, -96.0833],
  'OSAGE': [36.7000, -96.4167],
  'OTTAWA': [36.8833, -94.8500],
  'PAWNEE': [36.3333, -96.7333],
  'PAYNE': [36.1167, -96.9833],
  'PITTSBURG': [34.9833, -95.8833],
  'PONTOTOC': [34.7000, -96.7000],
  'POTTAWATOMIE': [35.2667, -97.0000],
  'PUSHMATAHA': [34.6833, -95.2167],
  'ROGER MILLS': [35.6000, -99.4667],
  'ROGERS': [36.3833, -95.7500],
  'SEMINOLE': [35.2500, -96.6833],
  'SEQUOYAH': [35.5833, -94.6833],
  'STEPHENS': [34.5000, -97.9333],
  'TEXAS': [36.7667, -101.6333],
  'TILLMAN': [34.4833, -98.9333],
  'TULSA': [36.1500, -95.9167],
  'WAGONER': [35.9667, -95.3667],
  'WASHINGTON': [36.7167, -95.9000],
  'WASHITA': [35.3167, -99.1000],
  'WOODS': [36.7000, -98.8500],
  'WOODWARD': [36.4167, -99.3000]
};

// Oklahoma PLSS Base Point (Indian Meridian)
// Located at the intersection of the Indian Meridian and Indian Base Line
const OKLAHOMA_PLSS_BASE = {
  latitude: 34.9944444, // 34°59'40"N 
  longitude: -97.0611111  // 97°03'40"W
};

// Township = 6 miles square = 6 nautical miles ≈ 6.93 statute miles
// Range = 6 miles square = 6 nautical miles ≈ 6.93 statute miles  
// Section = 1 mile square
// 1 degree latitude ≈ 69 miles
// 1 degree longitude ≈ 54.6 miles at Oklahoma's latitude (35°N)

const MILES_PER_DEGREE_LAT = 69.0;
const MILES_PER_DEGREE_LON = 54.6; // At 35°N latitude
const TOWNSHIP_SIZE_MILES = 6.0;
const SECTION_SIZE_MILES = 1.0;

/**
 * Calculate approximate coordinates from Township, Range, Section data
 * @param {string|number} section - Section number (1-36)
 * @param {string} township - Township (e.g., "28N", "15S")
 * @param {string} range - Range (e.g., "19W", "5E") 
 * @param {string} pm - Principal Meridian (default "IM" for Indian Meridian)
 * @returns {Object|null} - { latitude, longitude } or null if invalid data
 */
export function calculateTRSCoordinates(section, township, range, pm = 'IM') {
  try {
    // Only handle Indian Meridian for now (covers most of Oklahoma)
    if (pm !== 'IM') {
      console.log(`[Coordinates] Unsupported meridian: ${pm}`);
      return null;
    }

    // Parse township
    const townshipMatch = township.match(/^(\d+)([NS])$/);
    if (!townshipMatch) {
      console.log(`[Coordinates] Invalid township format: ${township}`);
      return null;
    }
    const townshipNum = parseInt(townshipMatch[1]);
    const townshipDir = townshipMatch[2];

    // Parse range
    const rangeMatch = range.match(/^(\d+)([EW])$/);
    if (!rangeMatch) {
      console.log(`[Coordinates] Invalid range format: ${range}`);
      return null;
    }
    const rangeNum = parseInt(rangeMatch[1]);
    const rangeDir = rangeMatch[2];

    // Parse section
    const sectionNum = parseInt(section);
    if (isNaN(sectionNum) || sectionNum < 1 || sectionNum > 36) {
      console.log(`[Coordinates] Invalid section number: ${section}`);
      return null;
    }

    // Calculate township offset from base point
    let latOffset = 0;
    if (townshipDir === 'N') {
      latOffset = (townshipNum - 1) * TOWNSHIP_SIZE_MILES;
    } else {
      latOffset = -(townshipNum * TOWNSHIP_SIZE_MILES);
    }

    // Calculate range offset from base point
    let lonOffset = 0;
    if (rangeDir === 'W') {
      lonOffset = -(rangeNum * TOWNSHIP_SIZE_MILES);
    } else {
      lonOffset = (rangeNum - 1) * TOWNSHIP_SIZE_MILES;
    }

    // Convert mile offsets to degree offsets
    const latDegreeOffset = latOffset / MILES_PER_DEGREE_LAT;
    const lonDegreeOffset = lonOffset / MILES_PER_DEGREE_LON;

    // Calculate township center
    const townshipLat = OKLAHOMA_PLSS_BASE.latitude + latDegreeOffset;
    const townshipLon = OKLAHOMA_PLSS_BASE.longitude + lonDegreeOffset;

    // Calculate section offset within township
    const sectionOffsets = getSectionOffsets(sectionNum);
    const sectionLatOffset = sectionOffsets.latMiles / MILES_PER_DEGREE_LAT;
    const sectionLonOffset = sectionOffsets.lonMiles / MILES_PER_DEGREE_LON;

    // Final coordinates (section center)
    const latitude = townshipLat + sectionLatOffset;
    const longitude = townshipLon + sectionLonOffset;

    console.log(`[Coordinates] Calculated TRS coordinates for S${section} T${township} R${range}: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

    return {
      latitude: parseFloat(latitude.toFixed(6)),
      longitude: parseFloat(longitude.toFixed(6))
    };

  } catch (err) {
    console.error(`[Coordinates] Error calculating TRS coordinates:`, err.message);
    return null;
  }
}

/**
 * Get section position offsets within a township
 * Sections are numbered 1-36 in a specific serpentine pattern:
 *  6  5  4  3  2  1
 *  7  8  9 10 11 12
 * 18 17 16 15 14 13
 * 19 20 21 22 23 24
 * 30 29 28 27 26 25
 * 31 32 33 34 35 36
 * 
 * @param {number} section - Section number (1-36)
 * @returns {Object} - { latMiles, lonMiles } offset from township NW corner
 */
function getSectionOffsets(section) {
  // Section grid layout (row, col) where (0,0) is NW corner
  const sectionGrid = [
    [6, 5, 4, 3, 2, 1],      // Row 0 (northernmost)
    [7, 8, 9, 10, 11, 12],   // Row 1
    [18, 17, 16, 15, 14, 13], // Row 2
    [19, 20, 21, 22, 23, 24], // Row 3
    [30, 29, 28, 27, 26, 25], // Row 4
    [31, 32, 33, 34, 35, 36]  // Row 5 (southernmost)
  ];

  // Find section position
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      if (sectionGrid[row][col] === section) {
        // Calculate offset from township NW corner to section center
        // Sections are 1 mile square, so center is 0.5 miles from edges
        const latMiles = -(row * SECTION_SIZE_MILES + 0.5); // Negative because we go south
        const lonMiles = col * SECTION_SIZE_MILES + 0.5;    // Positive because we go east
        return { latMiles, lonMiles };
      }
    }
  }

  // Fallback to section 1 if invalid
  console.warn(`[Coordinates] Invalid section ${section}, using section 1`);
  return { latMiles: -0.5, lonMiles: 5.5 }; // Section 1 position
}

/**
 * Get county center coordinates
 * @param {string} county - County name
 * @returns {Object|null} - { latitude, longitude } or null if county not found
 */
export function getCountyCenter(county) {
  if (!county) return null;
  
  const normalizedCounty = county.toUpperCase().trim();
  const coords = OKLAHOMA_COUNTY_CENTERS[normalizedCounty];
  
  if (coords) {
    console.log(`[Coordinates] Using county center for ${county}: ${coords[0]}, ${coords[1]}`);
    return {
      latitude: coords[0],
      longitude: coords[1]
    };
  }
  
  console.log(`[Coordinates] County not found: ${county}`);
  return null;
}

/**
 * Get coordinates with fallback system
 * 1. Try OCC GIS API first (most accurate)
 * 2. If that fails, calculate from TRS data
 * 3. If no TRS, use county center
 * 4. Return null only if no location data at all
 * 
 * @param {string} api10 - 10-digit API number  
 * @param {Object} record - Permit or completion record with TRS and county data
 * @param {Object} env - Worker environment
 * @returns {Object} - { coordinates: {lat, lon}, source: string, wellData: Object }
 */
export async function getCoordinatesWithFallback(api10, record, env) {
  let result = {
    coordinates: null,
    source: null,
    wellData: null,
    hasCoordinates: false
  };

  // Step 1: Try OCC GIS API (most accurate)
  console.log(`[Coordinates] Trying OCC GIS lookup for ${api10}`);
  const wellData = await fetchWellCoordinates(api10, env);
  
  if (wellData && wellData.sh_lat && wellData.sh_lon && !wellData.missingCoordinates) {
    result.coordinates = {
      latitude: wellData.sh_lat,
      longitude: wellData.sh_lon
    };
    result.source = 'OCC_GIS';
    result.wellData = wellData;
    result.hasCoordinates = true;
    console.log(`[Coordinates] SUCCESS: OCC GIS coordinates for ${api10}: ${wellData.sh_lat}, ${wellData.sh_lon}`);
    return result;
  }

  // Log details about why OCC GIS failed
  if (wellData) {
    console.log(`[Coordinates] OCC GIS response for ${api10}: sh_lat=${wellData.sh_lat}, sh_lon=${wellData.sh_lon}, missingCoordinates=${wellData.missingCoordinates}`);
  } else {
    console.log(`[Coordinates] OCC GIS returned no data for ${api10}`);
  }
  console.log(`[Coordinates] OCC GIS failed for ${api10}, trying TRS calculation`);

  // Step 2: Try TRS calculation
  if (record.Section && record.Township && record.Range) {
    const trsCoords = calculateTRSCoordinates(
      record.Section,
      record.Township,
      record.Range,
      record.PM || 'IM'
    );
    
    if (trsCoords) {
      result.coordinates = trsCoords;
      result.source = 'TRS_CALCULATED';
      result.wellData = wellData; // May still have other useful data even without coords
      result.hasCoordinates = true;
      console.log(`[Coordinates] SUCCESS: TRS coordinates for ${api10}: ${trsCoords.latitude}, ${trsCoords.longitude}`);
      return result;
    }
  }

  console.log(`[Coordinates] TRS calculation failed for ${api10}, trying county center`);

  // Step 3: Try county center
  if (record.County) {
    const countyCoords = getCountyCenter(record.County);
    
    if (countyCoords) {
      result.coordinates = countyCoords;
      result.source = 'COUNTY_CENTER';
      result.wellData = wellData; // May still have other useful data
      result.hasCoordinates = true;
      console.log(`[Coordinates] SUCCESS: County center coordinates for ${api10}: ${countyCoords.latitude}, ${countyCoords.longitude}`);
      return result;
    }
  }

  // Step 4: No coordinates available
  console.log(`[Coordinates] FAILED: No coordinates available for ${api10} from any source`);
  result.wellData = wellData; // May still have other useful data
  return result;
}