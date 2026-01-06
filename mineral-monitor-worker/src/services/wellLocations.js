/**
 * Well Locations Service
 * Manages the Well Locations table with surface and bottom hole data
 */

import { normalizeSection, normalizeAPI } from '../utils/normalize.js';
import { getCoordinatesWithFallback } from '../utils/coordinates.js';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

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
 * Create or update a well location record
 * @param {Object} env - Worker environment
 * @param {Object} wellData - Well location data
 * @returns {Object} - Result of the operation
 */
export async function upsertWellLocation(env, wellData) {
  const apiNumber = normalizeAPI(wellData.apiNumber);
  if (!apiNumber) {
    return { success: false, error: 'No API number provided' };
  }
  
  // Check if record exists
  const existingUrl = new URL(`${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_WELL_LOCATIONS_TABLE}`);
  existingUrl.searchParams.set('filterByFormula', `{API Number} = "${apiNumber}"`);
  existingUrl.searchParams.set('maxRecords', '1');
  
  const existingResponse = await fetch(existingUrl.toString(), {
    headers: {
      'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!existingResponse.ok) {
    return { success: false, error: 'Failed to check existing records' };
  }
  
  const existingData = await existingResponse.json();
  
  // Build fields object, excluding null/undefined values
  const fields = { 'API Number': apiNumber };
  
  // Basic well information
  if (wellData.wellName) fields['Well Name'] = wellData.wellName;
  if (wellData.operator) fields['Operator'] = wellData.operator;
  if (wellData.county) fields['County'] = wellData.county;
  if (wellData.wellStatus) fields['Well Status'] = wellData.wellStatus;
  if (wellData.formation) fields['Formation'] = wellData.formation;
  
  // Surface location
  if (wellData.surfaceSection) fields['Surface Section'] = normalizeSection(wellData.surfaceSection);
  if (wellData.surfaceTownship) fields['Surface Township'] = wellData.surfaceTownship;
  if (wellData.surfaceRange) fields['Surface Range'] = wellData.surfaceRange;
  if (wellData.surfacePM) fields['Surface PM'] = wellData.surfacePM;
  
  // Bottom hole location
  if (wellData.bhSection) fields['BH Section'] = normalizeSection(wellData.bhSection);
  if (wellData.bhTownship) fields['BH Township'] = wellData.bhTownship;
  if (wellData.bhRange) fields['BH Range'] = wellData.bhRange;
  if (wellData.bhPM) fields['BH PM'] = wellData.bhPM;
  
  // Horizontal well indicators
  if (wellData.isHorizontal !== undefined) fields['Is Horizontal'] = wellData.isHorizontal;
  if (wellData.isMultiSection !== undefined) fields['Is Multi-Section'] = wellData.isMultiSection;
  if (wellData.lateralLength) fields['Lateral Length'] = wellData.lateralLength;
  
  // Activity flags
  if (wellData.hasTrackedWell !== undefined) fields['Has Tracked Well'] = wellData.hasTrackedWell;
  if (wellData.hasPermit !== undefined) fields['Has Permit'] = wellData.hasPermit;
  if (wellData.hasCompletion !== undefined) fields['Has Completion'] = wellData.hasCompletion;
  
  // Dates
  if (wellData.permitDate) fields['Permit Date'] = wellData.permitDate;
  if (wellData.completionDate) fields['Completion Date'] = wellData.completionDate;
  
  // Coordinates
  if (wellData.latitude !== undefined && wellData.latitude !== null) fields['Latitude'] = wellData.latitude;
  if (wellData.longitude !== undefined && wellData.longitude !== null) fields['Longitude'] = wellData.longitude;
  if (wellData.bhLatitude !== undefined && wellData.bhLatitude !== null) fields['BH Latitude'] = wellData.bhLatitude;
  if (wellData.bhLongitude !== undefined && wellData.bhLongitude !== null) fields['BH Longitude'] = wellData.bhLongitude;
  if (wellData.mapLink) fields['OCC Map Link'] = wellData.mapLink;
  // Note: Coordinate Source field removed - not needed in Well Locations table
  
  try {
    if (existingData.records && existingData.records.length > 0) {
      // Update existing record
      const recordId = existingData.records[0].id;
      const updateUrl = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_WELL_LOCATIONS_TABLE}/${recordId}`;
      
      const updateResponse = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      });
      
      if (!updateResponse.ok) {
        const error = await updateResponse.text();
        return { success: false, error: `Update failed: ${error}` };
      }
      
      return { success: true, action: 'updated', apiNumber };
      
    } else {
      // Create new record
      const createUrl = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_WELL_LOCATIONS_TABLE}`;
      
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      });
      
      if (!createResponse.ok) {
        const error = await createResponse.text();
        return { success: false, error: `Create failed: ${error}` };
      }
      
      return { success: true, action: 'created', apiNumber };
    }
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