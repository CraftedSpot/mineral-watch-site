/**
 * Well Locations Service
 * Manages the Well Locations table with surface and bottom hole data
 */

import { normalizeSection, normalizeAPI } from '../utils/normalize.js';
import { getCoordinatesWithFallback } from '../utils/coordinates.js';


/**
 * Check if a well is horizontal based on multiple criteria
 * @param {Object} wellData - Well data from permit or completion
 * @returns {boolean} - Whether the well is horizontal
 */
export function isHorizontalWell(wellData) {
  // 1. Check drill type
  const drillType = wellData.Drill_Type || wellData.drill_type || '';
  if (drillType === 'HH' || drillType === 'DH' || drillType === 'HORIZONTAL HOLE') {
    return true;
  }
  
  // 2. Check if BH location differs from surface location (indicates lateral)
  if (wellData.BH_Section && wellData.Section && 
      (wellData.BH_Section !== wellData.Section ||
       wellData.BH_Township !== wellData.Township ||
       wellData.BH_Range !== wellData.Range)) {
    return true;
  }
  
  // 3. Check well name patterns for horizontal indicators
  const wellName = wellData.Well_Name || wellData.well_name || '';
  // Common horizontal well suffixes: H, XH, MXH, HZ, Hz
  const horizontalPatterns = /\s+(H|XH|MXH|HZ)(\s+|$)/i;
  if (horizontalPatterns.test(wellName)) {
    return true;
  }
  
  return false;
}

/**
 * Check if a well is multi-section (surface and BH in different sections)
 */
export function isMultiSectionWell(surfaceLocation, bhLocation) {
  if (!surfaceLocation || !bhLocation) return false;
  
  return surfaceLocation.section !== bhLocation.section ||
         surfaceLocation.township !== bhLocation.township ||
         surfaceLocation.range !== bhLocation.range;
}

/**
 * Create or update a well location record in D1 wells table
 * @param {Object} env - Worker environment
 * @param {Object} wellData - Well location data
 * @returns {Object} - Result of the operation
 */
export async function upsertWellLocation(env, wellData) {
  const apiNumber = normalizeAPI(wellData.apiNumber);
  if (!apiNumber) {
    return { success: false, error: 'No API number provided' };
  }

  if (!env.WELLS_DB) {
    return { success: false, error: 'D1 not available' };
  }

  // Build dynamic UPDATE columns
  const updates = [];
  const binds = [];

  if (wellData.wellName) { updates.push('well_name = ?'); binds.push(wellData.wellName); }
  if (wellData.operator) { updates.push('operator = ?'); binds.push(wellData.operator); }
  if (wellData.county) { updates.push('county = ?'); binds.push(wellData.county); }
  if (wellData.wellStatus) { updates.push('well_status = ?'); binds.push(wellData.wellStatus); }
  if (wellData.formation) { updates.push('formation_name = ?'); binds.push(wellData.formation); }

  // Surface location
  if (wellData.surfaceSection) { updates.push('section = ?'); binds.push(normalizeSection(wellData.surfaceSection)); }
  if (wellData.surfaceTownship) { updates.push('township = ?'); binds.push(wellData.surfaceTownship); }
  if (wellData.surfaceRange) { updates.push('range = ?'); binds.push(wellData.surfaceRange); }
  if (wellData.surfacePM) { updates.push('meridian = ?'); binds.push(wellData.surfacePM); }

  // Coordinates
  if (wellData.latitude != null) { updates.push('latitude = ?'); binds.push(wellData.latitude); }
  if (wellData.longitude != null) { updates.push('longitude = ?'); binds.push(wellData.longitude); }
  if (wellData.bhLatitude != null) { updates.push('bh_latitude = ?'); binds.push(wellData.bhLatitude); }
  if (wellData.bhLongitude != null) { updates.push('bh_longitude = ?'); binds.push(wellData.bhLongitude); }

  // Bottom hole location
  if (wellData.bhSection) { updates.push('bh_section = ?'); binds.push(normalizeSection(wellData.bhSection)); }
  if (wellData.bhTownship) { updates.push('bh_township = ?'); binds.push(wellData.bhTownship); }
  if (wellData.bhRange) { updates.push('bh_range = ?'); binds.push(wellData.bhRange); }

  // Horizontal well indicators
  if (wellData.isHorizontal !== undefined) { updates.push('is_horizontal = ?'); binds.push(wellData.isHorizontal ? 1 : 0); }
  if (wellData.lateralLength) { updates.push('lateral_length = ?'); binds.push(wellData.lateralLength); }

  // Dates
  if (wellData.permitDate) { updates.push('permit_date = ?'); binds.push(wellData.permitDate); }
  if (wellData.completionDate) { updates.push('completion_date = ?'); binds.push(wellData.completionDate); }

  // Map link
  if (wellData.mapLink) { updates.push('occ_map_link = ?'); binds.push(wellData.mapLink); }

  if (updates.length === 0) {
    return { success: true, action: 'no-op', apiNumber };
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  binds.push(apiNumber);

  try {
    const result = await env.WELLS_DB.prepare(
      `UPDATE wells SET ${updates.join(', ')} WHERE api_number = ?`
    ).bind(...binds).run();

    if (result.meta.changes === 0) {
      console.warn(`[WellLocation D1-MISS] Well ${apiNumber} not in D1 wells table — location data not saved`);
      return { success: true, action: 'not-found', apiNumber };
    }

    return { success: true, action: 'updated', apiNumber };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Create well location data from a permit with coordinate fallback
 * @param {Object} permit - Permit data
 * @param {Object} wellCoords - Optional well coordinates from OCC GIS
 * @param {string} mapLink - Optional OCC map link
 * @param {Object} env - Worker environment (for coordinate fallback)
 */
export async function createWellLocationFromPermit(permit, wellCoords = null, mapLink = null, env = null) {
  const isHorizontal = isHorizontalWell(permit);
  
  const locationData = {
    apiNumber: normalizeAPI(permit.API_Number),
    wellName: `${permit.Well_Name || ''} ${permit.Well_Number || ''}`.trim(),
    operator: permit.Entity_Name,
    county: permit.County,
    
    // Surface location
    surfaceSection: permit.Section,
    surfaceTownship: permit.Township,
    surfaceRange: permit.Range,
    surfacePM: permit.PM || 'IM',
    
    // Flags
    hasPermit: true,
    permitDate: (permit.Approval_Date && permit.Approval_Date.trim()) || new Date().toISOString().split('T')[0],
    isHorizontal
  };
  
  // Use coordinate fallback system with OCC data priority
  let coordinateSource = null;
  
  // First priority: Extract coordinates directly from OCC permit data
  if (permit.Surf_Lat_Y && permit.Surf_Long_X) {
    const latitude = parseFloat(permit.Surf_Lat_Y);
    const longitude = parseFloat(permit.Surf_Long_X);
    
    // Validate the coordinates are reasonable for Oklahoma
    if (!isNaN(latitude) && !isNaN(longitude) && 
        latitude > 33 && latitude < 37 && 
        longitude > -103 && longitude < -94) {
      locationData.latitude = latitude;
      locationData.longitude = longitude;
      coordinateSource = 'OCC_PERMIT_DATA';
      console.log(`[WellLocations] Using OCC permit coordinates for ${permit.API_Number}: ${latitude}, ${longitude}`);
    } else {
      console.log(`[WellLocations] Invalid OCC permit coordinates for ${permit.API_Number}: ${permit.Surf_Lat_Y}, ${permit.Surf_Long_X}`);
    }
  }
  
  // Second priority: Use GIS API coordinates if no valid OCC coordinates
  if (!locationData.latitude && !locationData.longitude && wellCoords && wellCoords.sh_lat && wellCoords.sh_lon) {
    locationData.latitude = wellCoords.sh_lat;
    locationData.longitude = wellCoords.sh_lon;
    coordinateSource = 'OCC_GIS';
  } 
  
  // Third priority: Use fallback calculation system
  if (!locationData.latitude && !locationData.longitude && env) {
    console.log(`[WellLocations] No direct coordinates for permit ${permit.API_Number}, using fallback system`);
    const coordResult = await getCoordinatesWithFallback(normalizeAPI(permit.API_Number), permit, env);
    if (coordResult.coordinates) {
      locationData.latitude = coordResult.coordinates.latitude;
      locationData.longitude = coordResult.coordinates.longitude;
      coordinateSource = coordResult.source;
      console.log(`[WellLocations] Using ${coordinateSource} coordinates for permit ${permit.API_Number} - ensures user alerts are sent`);
    } else {
      console.log(`[WellLocations] WARNING: No coordinates available for permit ${permit.API_Number} from any source - user may miss alerts`);
    }
  }
  
  // Track coordinate source for data quality
  if (coordinateSource) {
    locationData.coordinateSource = coordinateSource;
  }
  
  // Add map link if available
  if (mapLink) {
    locationData.mapLink = mapLink;
  }
  
  // Add BH location for horizontal/directional wells
  if (isHorizontal && permit.PBH_Section) {
    locationData.bhSection = permit.PBH_Section;
    locationData.bhTownship = permit.PBH_Township;
    locationData.bhRange = permit.PBH_Range;
    locationData.bhPM = permit.PBH_PM || permit.PM || 'IM';
    
    // Extract BH coordinates if available
    if (permit.BH_Lat_Y && permit.BH_Long_X) {
      const bhLatitude = parseFloat(permit.BH_Lat_Y);
      const bhLongitude = parseFloat(permit.BH_Long_X);
      
      // Validate BH coordinates are reasonable for Oklahoma
      if (!isNaN(bhLatitude) && !isNaN(bhLongitude) && 
          bhLatitude > 33 && bhLatitude < 37 && 
          bhLongitude > -103 && bhLongitude < -94) {
        locationData.bhLatitude = bhLatitude;
        locationData.bhLongitude = bhLongitude;
        console.log(`[WellLocations] Using OCC permit BH coordinates for ${permit.API_Number}: ${bhLatitude}, ${bhLongitude}`);
      }
    }
    
    // Check if multi-section
    locationData.isMultiSection = isMultiSectionWell(
      { section: permit.Section, township: permit.Township, range: permit.Range },
      { section: permit.PBH_Section, township: permit.PBH_Township, range: permit.PBH_Range }
    );
  }
  
  return locationData;
}

/**
 * Create well location data from a completion with coordinate fallback
 * @param {Object} completion - Completion data
 * @param {Object} wellCoords - Optional well coordinates from OCC GIS
 * @param {string} mapLink - Optional OCC map link
 * @param {Object} env - Worker environment (for coordinate fallback)
 */
export async function createWellLocationFromCompletion(completion, wellCoords = null, mapLink = null, env = null) {
  const isHorizontal = isHorizontalWell(completion);
  
  const locationData = {
    apiNumber: normalizeAPI(completion.API_Number),
    wellName: `${completion.Well_Name || ''} ${completion.Well_Number || ''}`.trim(),
    operator: completion.Operator_Name || completion.Operator,
    county: completion.County,
    wellStatus: 'AC', // Completed wells are active
    formation: completion.Formation_Name,
    
    // Surface location
    surfaceSection: completion.Section,
    surfaceTownship: completion.Township,
    surfaceRange: completion.Range,
    surfacePM: completion.PM || 'IM',
    
    // Flags
    hasCompletion: true,
    completionDate: (completion.Well_Completion && completion.Well_Completion.trim()) || new Date().toISOString().split('T')[0],
    isHorizontal
  };
  
  // Use coordinate fallback system with OCC data priority
  let coordinateSource = null;
  
  // First priority: Extract coordinates directly from OCC completion data
  if (completion.Surf_Lat_Y && completion.Surf_Long_X) {
    const latitude = parseFloat(completion.Surf_Lat_Y);
    const longitude = parseFloat(completion.Surf_Long_X);
    
    // Validate the coordinates are reasonable for Oklahoma
    if (!isNaN(latitude) && !isNaN(longitude) && 
        latitude > 33 && latitude < 37 && 
        longitude > -103 && longitude < -94) {
      locationData.latitude = latitude;
      locationData.longitude = longitude;
      coordinateSource = 'OCC_COMPLETION_DATA';
      console.log(`[WellLocations] Using OCC completion coordinates for ${completion.API_Number}: ${latitude}, ${longitude}`);
    } else {
      console.log(`[WellLocations] Invalid OCC completion coordinates for ${completion.API_Number}: ${completion.Surf_Lat_Y}, ${completion.Surf_Long_X}`);
    }
  }
  
  // Second priority: Use GIS API coordinates if no valid OCC coordinates
  if (!locationData.latitude && !locationData.longitude && wellCoords && wellCoords.sh_lat && wellCoords.sh_lon) {
    locationData.latitude = wellCoords.sh_lat;
    locationData.longitude = wellCoords.sh_lon;
    coordinateSource = 'OCC_GIS';
  } 
  
  // Third priority: Use fallback calculation system
  if (!locationData.latitude && !locationData.longitude && env) {
    console.log(`[WellLocations] No direct coordinates for completion ${completion.API_Number}, using fallback system`);
    const coordResult = await getCoordinatesWithFallback(normalizeAPI(completion.API_Number), completion, env);
    if (coordResult.coordinates) {
      locationData.latitude = coordResult.coordinates.latitude;
      locationData.longitude = coordResult.coordinates.longitude;
      coordinateSource = coordResult.source;
      console.log(`[WellLocations] Using ${coordinateSource} coordinates for completion ${completion.API_Number} - ensures user alerts are sent`);
    } else {
      console.log(`[WellLocations] WARNING: No coordinates available for completion ${completion.API_Number} from any source - user may miss alerts`);
    }
  }
  
  // Track coordinate source for data quality
  if (coordinateSource) {
    locationData.coordinateSource = coordinateSource;
  }
  
  // Add map link if available
  if (mapLink) {
    locationData.mapLink = mapLink;
  }
  
  // Add BH location for horizontal wells
  if (isHorizontal && completion.BH_Section) {
    locationData.bhSection = completion.BH_Section;
    locationData.bhTownship = completion.BH_Township;
    locationData.bhRange = completion.BH_Range;
    locationData.bhPM = completion.BH_PM || completion.PM || 'IM';
    locationData.lateralLength = completion.Length || completion.Lateral_Length;
    
    // Extract BH coordinates if available
    if (completion.BH_Lat_Y && completion.BH_Long_X) {
      const bhLatitude = parseFloat(completion.BH_Lat_Y);
      const bhLongitude = parseFloat(completion.BH_Long_X);
      
      // Validate BH coordinates are reasonable for Oklahoma
      if (!isNaN(bhLatitude) && !isNaN(bhLongitude) && 
          bhLatitude > 33 && bhLatitude < 37 && 
          bhLongitude > -103 && bhLongitude < -94) {
        locationData.bhLatitude = bhLatitude;
        locationData.bhLongitude = bhLongitude;
        console.log(`[WellLocations] Using OCC completion BH coordinates for ${completion.API_Number}: ${bhLatitude}, ${bhLongitude}`);
      }
    }
    
    // Check if multi-section
    locationData.isMultiSection = isMultiSectionWell(
      { section: completion.Section, township: completion.Township, range: completion.Range },
      { section: completion.BH_Section, township: completion.BH_Township, range: completion.BH_Range }
    );
  }
  
  return locationData;
}