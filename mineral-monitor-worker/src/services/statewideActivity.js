/**
 * Statewide Activity Service
 * Manages the Statewide Activity table for heatmap data in D1
 * Auto-deletes records older than 90 days
 */

import { normalizeSection, normalizeAPI } from '../utils/normalize.js';

/**
 * Create a statewide activity record in D1
 * @param {Object} env - Worker environment
 * @param {Object} activityData - Activity data
 * @returns {Object} - Result of the operation
 */
export async function createStatewideActivity(env, activityData) {
  const apiNumber = normalizeAPI(activityData.apiNumber);
  if (!apiNumber) {
    return { success: false, error: 'No API number provided' };
  }
  
  // Check if we have required D1 binding
  if (!env.WELLS_DB) {
    console.error('[Statewide] D1 database binding (WELLS_DB) not found');
    return { success: false, error: 'Database not configured' };
  }
  
  try {
    // Build the INSERT OR REPLACE query
    const stmt = env.WELLS_DB.prepare(`
      INSERT OR REPLACE INTO statewide_activity (
        id, api_number, well_name, operator, county,
        surface_section, surface_township, surface_range, surface_pm,
        bh_section, bh_township, bh_range, bh_pm,
        latitude, longitude, bh_latitude, bh_longitude,
        permit_date, completion_date, expire_date, formation, well_status,
        is_horizontal, is_multi_section, has_permit, has_completion,
        occ_map_link, created_at
      ) VALUES (
        ?1, ?1, ?2, ?3, ?4,
        ?5, ?6, ?7, ?8,
        ?9, ?10, ?11, ?12,
        ?13, ?14, ?15, ?16,
        ?17, ?18, ?19, ?20, ?21,
        ?22, ?23, ?24, ?25,
        ?26, datetime('now')
      )
    `);
    
    // Determine if this is multi-section based on BH location
    const isMultiSection = activityData.bhSection && (
      activityData.bhSection !== activityData.section ||
      activityData.bhTownship !== activityData.township ||
      activityData.bhRange !== activityData.range
    );
    
    // Bind parameters
    const result = await stmt.bind(
      apiNumber,                                        // id and api_number (both use api)
      activityData.wellName || null,                    // well_name
      activityData.operator || null,                    // operator
      activityData.county || null,                      // county
      activityData.section ? normalizeSection(activityData.section) : null,  // surface_section
      activityData.township || null,                    // surface_township
      activityData.range || null,                       // surface_range
      activityData.pm || 'IM',                          // surface_pm
      activityData.bhSection ? normalizeSection(activityData.bhSection) : null,  // bh_section
      activityData.bhTownship || null,                  // bh_township
      activityData.bhRange || null,                     // bh_range
      activityData.bhPM || null,                        // bh_pm
      activityData.latitude || null,                    // latitude
      activityData.longitude || null,                   // longitude
      activityData.bhLatitude || null,                  // bh_latitude
      activityData.bhLongitude || null,                 // bh_longitude
      activityData.permitDate || null,                  // permit_date
      activityData.completionDate || null,              // completion_date
      activityData.expireDate || null,                  // expire_date
      activityData.formation || null,                   // formation
      activityData.wellStatus || null,                  // well_status
      activityData.isHorizontal ? 1 : 0,               // is_horizontal
      isMultiSection ? 1 : 0,                          // is_multi_section
      activityData.activityType === 'Permit' ? 1 : 0,  // has_permit
      activityData.activityType === 'Completion' ? 1 : 0,  // has_completion
      activityData.mapLink || null                     // occ_map_link
    ).run();
    
    console.log(`[Statewide] Successfully inserted/updated D1 record for ${apiNumber}`);
    return { 
      success: true, 
      action: result.meta.changes > 0 ? 'created' : 'updated', 
      apiNumber 
    };
    
  } catch (err) {
    console.error(`[Statewide] D1 insert error for ${apiNumber}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Clean up old statewide activity records from D1
 * @param {Object} env - Worker environment
 * @param {number} daysToKeep - Number of days to keep records (default 90)
 * @returns {Object} - Cleanup results
 */
export async function cleanupOldStatewideRecords(env, daysToKeep = 90) {
  // Check if we have required D1 binding
  if (!env.WELLS_DB) {
    console.error('[Cleanup] D1 database binding (WELLS_DB) not found');
    return { success: false, error: 'Database not configured' };
  }
  
  console.log(`[Cleanup] Deleting statewide activity records older than ${daysToKeep} days`);
  
  try {
    // First, get count of records to delete (for logging)
    const countStmt = env.WELLS_DB.prepare(`
      SELECT COUNT(*) as count 
      FROM statewide_activity 
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `);
    
    const countResult = await countStmt.bind(daysToKeep).first();
    const recordCount = countResult?.count || 0;
    
    if (recordCount === 0) {
      console.log('[Cleanup] No old records to delete');
      return { success: true, deletedCount: 0 };
    }
    
    console.log(`[Cleanup] Found ${recordCount} records to delete`);
    
    // Delete the records
    const deleteStmt = env.WELLS_DB.prepare(`
      DELETE FROM statewide_activity 
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `);
    
    const deleteResult = await deleteStmt.bind(daysToKeep).run();
    
    console.log(`[Cleanup] Deleted ${deleteResult.meta.changes} statewide activity records`);
    
    return { 
      success: true, 
      deletedCount: deleteResult.meta.changes,
      recordsChecked: recordCount
    };
    
  } catch (err) {
    console.error('[Cleanup] Error deleting old records:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Create statewide activity data from a permit
 */
export function createStatewideActivityFromPermit(permit, wellCoords = null, mapLink = null) {
  const activityData = {
    apiNumber: normalizeAPI(permit.API_Number),
    activityType: 'Permit',
    wellName: `${permit.Well_Name || ''} ${permit.Well_Number || ''}`.trim(),
    operator: permit.Entity_Name,
    county: permit.County,
    section: permit.Section,
    township: permit.Township,
    range: permit.Range,
    pm: permit.PM || 'IM',
    permitDate: (() => {
      const rawDate = permit.Approval_Date;
      console.log(`[Debug] Raw permit date for ${permit.API_Number}: "${rawDate}" (type: ${typeof rawDate})`);
      
      if (rawDate && typeof rawDate === 'string' && rawDate.trim()) {
        const trimmed = rawDate.trim();
        // Try to parse and reformat the date
        const parsed = new Date(trimmed);
        if (!isNaN(parsed)) {
          const formatted = parsed.toISOString().split('T')[0];
          console.log(`[Debug] Formatted permit date: "${formatted}"`);
          return formatted;
        }
        console.log(`[Debug] Invalid date string: "${trimmed}"`);
      }
      
      const fallback = new Date().toISOString().split('T')[0];
      console.log(`[Debug] Using fallback permit date: "${fallback}"`);
      return fallback;
    })(),
    isHorizontal: (() => {
      // For permits: assume horizontal unless explicitly marked as SH (Straight Hole)
      const isConfirmedVertical = permit.Drill_Type === 'SH' || permit.Drill_Type === 'STRAIGHT HOLE';
      return !isConfirmedVertical;
    })(),
    expireDate: (() => {
      const rawDate = permit.Expire_Date;
      if (rawDate && typeof rawDate === 'string' && rawDate.trim()) {
        const trimmed = rawDate.trim();
        const parsed = new Date(trimmed);
        if (!isNaN(parsed)) {
          return parsed.toISOString().split('T')[0];
        }
      }
      return null;
    })()
  };
  
  // First priority: Extract coordinates directly from OCC permit data
  if (permit.Surf_Lat_Y && permit.Surf_Long_X) {
    // Parse coordinates from OCC data - they're usually strings
    const latitude = parseFloat(permit.Surf_Lat_Y);
    const longitude = parseFloat(permit.Surf_Long_X);
    
    // Validate the coordinates are reasonable for Oklahoma
    if (!isNaN(latitude) && !isNaN(longitude) && 
        latitude > 33 && latitude < 37 && 
        longitude > -103 && longitude < -94) {
      activityData.latitude = latitude;
      activityData.longitude = longitude;
      console.log(`[Statewide] Using OCC permit coordinates for ${permit.API_Number}: ${latitude}, ${longitude}`);
    } else {
      console.log(`[Statewide] Invalid OCC permit coordinates for ${permit.API_Number}: ${permit.Surf_Lat_Y}, ${permit.Surf_Long_X}`);
    }
  }
  
  // Second priority: Use GIS API or fallback coordinates if no OCC coordinates
  if (!activityData.latitude && !activityData.longitude && wellCoords && wellCoords.sh_lat && wellCoords.sh_lon) {
    activityData.latitude = wellCoords.sh_lat;
    activityData.longitude = wellCoords.sh_lon;
  }
  
  // Extract BH coordinates if available for horizontal wells
  if (activityData.isHorizontal) {
    if (permit.BH_Lat_Y && permit.BH_Long_X) {
      const bhLatitude = parseFloat(permit.BH_Lat_Y);
      const bhLongitude = parseFloat(permit.BH_Long_X);
      
      // Validate BH coordinates are reasonable for Oklahoma
      if (!isNaN(bhLatitude) && !isNaN(bhLongitude) && 
          bhLatitude > 33 && bhLatitude < 37 && 
          bhLongitude > -103 && bhLongitude < -94) {
        activityData.bhLatitude = bhLatitude;
        activityData.bhLongitude = bhLongitude;
        console.log(`[Statewide] Using OCC permit BH coordinates for ${permit.API_Number}: ${bhLatitude}, ${bhLongitude}`);
      }
    }
  }
  
  // Add map link if available
  if (mapLink) {
    activityData.mapLink = mapLink;
  }
  
  return activityData;
}

/**
 * Create statewide activity data from a completion
 */
export function createStatewideActivityFromCompletion(completion, wellCoords = null, mapLink = null) {
  const activityData = {
    apiNumber: normalizeAPI(completion.API_Number),
    activityType: 'Completion',
    wellName: `${completion.Well_Name || ''} ${completion.Well_Number || ''}`.trim(),
    operator: completion.Operator_Name || completion.Operator,
    county: completion.County,
    section: completion.Section,
    township: completion.Township,
    range: completion.Range,
    pm: completion.PM || 'IM',
    formation: completion.Formation_Name,
    completionDate: (completion.Well_Completion && completion.Well_Completion.trim()) || new Date().toISOString(),
    isHorizontal: (() => {
      // Check drill type
      const isHorizontalByType = completion.Drill_Type === 'HORIZONTAL HOLE' || 
                                 completion.Drill_Type === 'HH' ||
                                 completion.Location_Type_Sub === 'HH';
      
      // Check well name patterns (common horizontal well naming conventions)
      const wellName = completion.Well_Name || '';
      const isHorizontalByName = /\d+H$|\d+MH$|\d+HX$|\d+HXX$|\d+HM$|\d+HW$|\d+WH$|\d+XHM$|MXH$|HXH$|BXH$|SXH$|UXH$|LXH$|H\d+$|-H$|_H$/i.test(wellName);
      
      return isHorizontalByType || isHorizontalByName;
    })()
  };
  
  // First priority: Extract coordinates directly from OCC completion data
  if (completion.Surf_Lat_Y && completion.Surf_Long_X) {
    // Parse coordinates from OCC data - they're usually strings
    const latitude = parseFloat(completion.Surf_Lat_Y);
    const longitude = parseFloat(completion.Surf_Long_X);
    
    // Validate the coordinates are reasonable for Oklahoma
    if (!isNaN(latitude) && !isNaN(longitude) && 
        latitude > 33 && latitude < 37 && 
        longitude > -103 && longitude < -94) {
      activityData.latitude = latitude;
      activityData.longitude = longitude;
      console.log(`[Statewide] Using OCC completion coordinates for ${completion.API_Number}: ${latitude}, ${longitude}`);
    } else {
      console.log(`[Statewide] Invalid OCC completion coordinates for ${completion.API_Number}: ${completion.Surf_Lat_Y}, ${completion.Surf_Long_X}`);
    }
  }
  
  // Second priority: Use GIS API or fallback coordinates if no OCC coordinates
  if (!activityData.latitude && !activityData.longitude && wellCoords && wellCoords.sh_lat && wellCoords.sh_lon) {
    activityData.latitude = wellCoords.sh_lat;
    activityData.longitude = wellCoords.sh_lon;
  }
  
  // Extract BH coordinates and location if available for horizontal wells
  if (activityData.isHorizontal) {
    // Add bottom hole section/township/range data
    if (completion.BH_Section) activityData.bhSection = completion.BH_Section;
    if (completion.BH_Township) activityData.bhTownship = completion.BH_Township;
    if (completion.BH_Range) activityData.bhRange = completion.BH_Range;
    if (completion.BH_PM) activityData.bhPM = completion.BH_PM;
    
    // Extract bottom hole coordinates - note the field names are different from permits
    if (completion.Bottom_Hole_Lat_Y && completion.Bottom_Hole_Long_X) {
      const bhLatitude = parseFloat(completion.Bottom_Hole_Lat_Y);
      const bhLongitude = parseFloat(completion.Bottom_Hole_Long_X);
      
      // Validate BH coordinates are reasonable for Oklahoma
      if (!isNaN(bhLatitude) && !isNaN(bhLongitude) && 
          bhLatitude > 33 && bhLatitude < 37 && 
          bhLongitude > -103 && bhLongitude < -94) {
        activityData.bhLatitude = bhLatitude;
        activityData.bhLongitude = bhLongitude;
        console.log(`[Statewide] Using OCC completion BH coordinates for ${completion.API_Number}: ${bhLatitude}, ${bhLongitude}`);
      }
    }
    
    // Add direction and length if available
    if (completion.Direction) activityData.direction = parseFloat(completion.Direction);
    if (completion.Length) activityData.length = parseFloat(completion.Length);
  }
  
  // Add map link if available
  if (mapLink) {
    activityData.mapLink = mapLink;
  }
  
  return activityData;
}

/**
 * Update an existing statewide activity record with new data
 * @param {Object} env - Worker environment
 * @param {string} recordId - Airtable record ID
 * @param {Object} activityData - New activity data
 * @returns {Object} - Result of the update
 */
async function updateStatewideActivity(env, recordId, activityData) {
  // Build update fields - only include non-empty values
  const updateFields = {};
  
  // Update basic fields if provided
  if (activityData.wellName) updateFields["Well Name"] = activityData.wellName;
  if (activityData.operator) updateFields["Operator"] = activityData.operator;
  if (activityData.formation) updateFields["Formation"] = activityData.formation;
  
  // Update coordinates if provided
  if (activityData.latitude !== undefined) updateFields["Latitude"] = activityData.latitude;
  if (activityData.longitude !== undefined) updateFields["Longitude"] = activityData.longitude;
  if (activityData.bhLatitude !== undefined) updateFields["BH Latitude"] = activityData.bhLatitude;
  if (activityData.bhLongitude !== undefined) updateFields["BH Longitude"] = activityData.bhLongitude;
  
  // Update BH location if provided
  if (activityData.bhSection) updateFields["BH Section"] = normalizeSection(activityData.bhSection);
  if (activityData.bhTownship) updateFields["BH Township"] = activityData.bhTownship;
  if (activityData.bhRange) updateFields["BH Range"] = activityData.bhRange;
  if (activityData.bhPM) updateFields["BH PM"] = activityData.bhPM;
  
  // Update activity flags
  if (activityData.activityType === "Completion") {
    updateFields["Has Completion"] = true;
    if (activityData.completionDate) updateFields["Completion Date"] = activityData.completionDate;
  }
  
  // Update other fields
  if (activityData.isHorizontal !== undefined) updateFields["Is Horizontal"] = activityData.isHorizontal;
  if (activityData.mapLink) updateFields["OCC Map Link"] = activityData.mapLink;
  
  try {
    const updateUrl = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_STATEWIDE_ACTIVITY_TABLE}/${recordId}`;
    
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: updateFields })
    });
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`[Statewide] Update failed for ${recordId}:`, errorText);
      return { success: false, error: errorText };
    }
    
    const result = await updateResponse.json();
    return { success: true, action: "updated", id: result.id };
  } catch (err) {
    console.error(`[Statewide] Update error for ${recordId}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Find permits that are expiring soon or have recently expired
 * Oklahoma drilling permits are valid for 1 year from approval date
 * @param {Object} env - Worker environment
 * @param {number} daysWarning - Days before expiration to start warning (default 30)
 * @param {number} daysAfterExpiration - Days after expiration to still alert (default 7)
 * @returns {Array} - List of expiring permits with location data
 */
export async function findExpiringPermits(env, daysWarning = 30, daysAfterExpiration = 7) {
  if (!env.WELLS_DB) {
    console.error('[Expiring] D1 database binding (WELLS_DB) not found');
    return [];
  }

  try {
    // Query for permits that:
    // 1. Have an expire_date set
    // 2. Have NOT been completed (no completion = hasn't been spudded/drilled)
    // 3. Are within the warning window OR recently expired
    const stmt = env.WELLS_DB.prepare(`
      SELECT
        api_number,
        well_name,
        operator,
        county,
        surface_section,
        surface_township,
        surface_range,
        surface_pm,
        permit_date,
        expire_date,
        latitude,
        longitude,
        occ_map_link,
        JULIANDAY(expire_date) - JULIANDAY('now') as days_until_expiration
      FROM statewide_activity
      WHERE
        expire_date IS NOT NULL
        AND has_permit = 1
        AND has_completion = 0
        AND JULIANDAY(expire_date) - JULIANDAY('now') BETWEEN ? AND ?
      ORDER BY days_until_expiration ASC
    `);

    // Range: from N days after expiration (negative) to warning days before (positive)
    const result = await stmt.bind(-daysAfterExpiration, daysWarning).all();

    const permits = result.results || [];
    console.log(`[Expiring] Found ${permits.length} permits expiring within ${daysWarning} days or recently expired`);

    return permits.map(p => ({
      apiNumber: p.api_number,
      wellName: p.well_name,
      operator: p.operator,
      county: p.county,
      section: p.surface_section,
      township: p.surface_township,
      range: p.surface_range,
      meridian: p.surface_pm || 'IM',
      permitDate: p.permit_date,
      expireDate: p.expire_date,
      daysUntilExpiration: Math.round(p.days_until_expiration),
      latitude: p.latitude,
      longitude: p.longitude,
      mapLink: p.occ_map_link,
      // Determine status for user-friendly messaging
      expirationStatus: p.days_until_expiration < 0
        ? 'EXPIRED'
        : p.days_until_expiration <= 7
          ? 'EXPIRING_SOON'
          : 'EXPIRING'
    }));
  } catch (err) {
    console.error('[Expiring] Error querying expiring permits:', err);
    return [];
  }
}

/**
 * Mark a permit as having been alerted for expiration to prevent duplicate alerts
 * Uses KV cache with API number as key
 * @param {Object} env - Worker environment
 * @param {string} apiNumber - 10-digit API number
 * @param {string} expirationStatus - Status at time of alert (EXPIRING, EXPIRING_SOON, EXPIRED)
 */
export async function markPermitExpirationAlerted(env, apiNumber, expirationStatus) {
  try {
    const key = `permit-expiration:${apiNumber}`;
    const data = {
      alertedAt: new Date().toISOString(),
      status: expirationStatus
    };
    // Keep for 45 days (longer than warning + expiration window)
    await env.MINERAL_CACHE.put(key, JSON.stringify(data), {
      expirationTtl: 45 * 24 * 60 * 60
    });
  } catch (err) {
    console.warn(`[Expiring] Failed to mark permit ${apiNumber} as alerted:`, err.message);
  }
}

/**
 * Check if a permit has already been alerted for expiration
 * @param {Object} env - Worker environment
 * @param {string} apiNumber - 10-digit API number
 * @returns {Object|null} - Previous alert data or null
 */
export async function getPermitExpirationAlert(env, apiNumber) {
  try {
    const key = `permit-expiration:${apiNumber}`;
    const data = await env.MINERAL_CACHE.get(key, { type: 'json' });
    return data;
  } catch (err) {
    console.warn(`[Expiring] Failed to check permit ${apiNumber} alert status:`, err.message);
    return null;
  }
}
