/**
 * Daily Monitor - Processes Intent to Drill and Completion files
 */

import { fetchOCCFile } from '../services/occ.js';
import { fetchWellCoordinates } from '../services/occGis.js';
import { findMatchingProperties, findMatchingWells } from '../services/matching.js';
import { hasRecentAlert, createActivityLog, updateActivityLog, queryAirtable, getUserById } from '../services/airtable.js';
import { sendAlertEmail } from '../services/email.js';
import { normalizeSection, normalizeAPI } from '../utils/normalize.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';
import { getOperatorPhone, updateOperatorInfo } from '../services/operators.js';
import { getAdjacentSections } from '../utils/plss.js';

/**
 * Format date for email display
 * @param {string|null} dateString - Date string from OCC data
 * @returns {string|null} - Formatted date (MMM DD, YYYY) or null
 */
function formatDate(dateString) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch {
    return null;
  }
}

/**
 * Determine if a well spans multiple sections
 */
function isMultiSection(completion) {
  const isHorizontal = completion.Drill_Type === 'HORIZONTAL HOLE' || 
                       completion.Location_Type_Sub === 'HH';
  
  if (!isHorizontal) return false;
  
  // Different sections (with null checks)
  if (completion.BH_Section && completion.Section && completion.Section !== completion.BH_Section) {
    return true;
  }
  
  // Different township or range (with null checks)
  if (completion.BH_Township && completion.Township && completion.Township !== completion.BH_Township) {
    return true;
  }
  if (completion.BH_Range && completion.Range && completion.Range !== completion.BH_Range) {
    return true;
  }
  
  // Long lateral (>1 mile)
  if (completion.Length && parseFloat(completion.Length) > 5280) {
    return true;
  }
  
  return false;
}

/**
 * Calculate cardinal direction from surface to bottom hole
 * Returns: 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'
 */
function calculateBearing(surfaceLat, surfaceLon, bhLat, bhLon) {
  const deltaLat = bhLat - surfaceLat;
  const deltaLon = bhLon - surfaceLon;
  
  // Calculate bearing in degrees (0 = North, 90 = East, etc.)
  let bearing = Math.atan2(deltaLon, deltaLat) * (180 / Math.PI);
  if (bearing < 0) bearing += 360;
  
  // Convert to cardinal direction
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

/**
 * Calculate approximate distance in feet between two coordinates
 */
function calculateDistanceFeet(lat1, lon1, lat2, lon2) {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Get all sections directly affected by this well's lateral path
 * These are YOUR PROPERTY matches, not adjacent
 */
function getDirectlyAffectedSections(completion) {
  const sections = [];
  
  // Always include surface location
  sections.push({
    section: completion.Section,
    township: completion.Township,
    range: completion.Range,
    meridian: completion.PM,
    type: 'surface'
  });
  
  // Check if this is horizontal with BH data
  const isHorizontal = completion.Drill_Type === 'HORIZONTAL HOLE' || 
                       completion.Location_Type_Sub === 'HH';
  
  if (!isHorizontal) return sections;
  
  const hasBHSection = completion.BH_Section && completion.BH_Township && completion.BH_Range;
  
  if (hasBHSection) {
    // Check if BH is different from surface
    const isSameSection = completion.Section === completion.BH_Section &&
                         completion.Township === completion.BH_Township &&
                         completion.Range === completion.BH_Range;
    
    if (!isSameSection) {
      sections.push({
        section: completion.BH_Section,
        township: completion.BH_Township,
        range: completion.BH_Range,
        meridian: completion.BH_PM || completion.PM,
        type: 'bottom_hole'
      });
    }
  }
  
  // Calculate lateral info for email display with null checks
  const hasCoords = completion.Surf_Lat_Y && completion.Surf_Long_X && 
                    completion.Bottom_Hole_Lat_Y && completion.Bottom_Hole_Long_X;
  
  if (hasCoords) {
    const surfaceLat = parseFloat(completion.Surf_Lat_Y);
    const surfaceLon = parseFloat(completion.Surf_Long_X);
    const bhLat = parseFloat(completion.Bottom_Hole_Lat_Y);
    const bhLon = parseFloat(completion.Bottom_Hole_Long_X);
    
    // Add coordinate validation from your feedback
    if (!isNaN(surfaceLat) && !isNaN(surfaceLon) && !isNaN(bhLat) && !isNaN(bhLon)) {
      completion._lateralDirection = calculateBearing(surfaceLat, surfaceLon, bhLat, bhLon);
      completion._lateralLength = completion.Length || Math.round(calculateDistanceFeet(surfaceLat, surfaceLon, bhLat, bhLon));
    }
  } else if (completion.Length) {
    completion._lateralLength = completion.Length;
  }
  
  // Store multi-section flag
  completion._isMultiSection = sections.length > 1 || (completion.Length && parseFloat(completion.Length) > 5280);
  
  return sections;
}

/**
 * For multi-section wells, get adjacent sections that border the unit
 * but EXCLUDE sections that are in the lateral path (those are direct matches)
 */
function getAdjacentSectionsForUnit(directlyAffectedSections) {
  const adjacentSet = new Set();
  const directSet = new Set(
    directlyAffectedSections.map(s => `${s.section}-${s.township}-${s.range}`)
  );
  
  for (const section of directlyAffectedSections) {
    // Get adjacent sections for this part of the unit
    const adjacent = getAdjacentSections(section.section, section.township, section.range);
    
    for (const adj of adjacent) {
      const key = `${adj.section}-${adj.township}-${adj.range}`;
      // Only add if not already a direct match
      if (!directSet.has(key)) {
        adjacentSet.add(JSON.stringify({
          section: adj.section,
          township: adj.township,
          range: adj.range,
          meridian: section.meridian // Inherit meridian from parent
        }));
      }
    }
  }
  
  return Array.from(adjacentSet).map(s => JSON.parse(s));
}

/**
 * Check if we're in dry-run mode
 */
function isDryRun(env) {
  return env.DRY_RUN === 'true' || env.DRY_RUN === true;
}

/**
 * Main daily monitoring function
 * @param {Object} env - Worker environment bindings
 * @returns {Object} - Processing results
 */
export async function runDailyMonitor(env) {
  const dryRun = isDryRun(env);
  console.log(`[Daily] Starting daily monitor run ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  
  const results = {
    permitsProcessed: 0,
    completionsProcessed: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    matchesFound: [],
    errors: []
  };
  
  try {
    // Fetch and process Intent to Drill file
    const permits = await fetchOCCFile('itd', env);
    console.log(`[Daily] Fetched ${permits.length} permits from ITD file`);
    
    for (const permit of permits) {
      try {
        await processPermit(permit, env, results, dryRun);
        results.permitsProcessed++;
      } catch (err) {
        console.error(`[Daily] Error processing permit ${permit.API_Number}:`, err);
        results.errors.push({ api: permit.API_Number, error: err.message });
      }
    }
    
    // Fetch and process Completions file
    const completions = await fetchOCCFile('completions', env);
    console.log(`[Daily] Fetched ${completions.length} completions`);
    
    // Batch processing optimization: Pre-load all property data
    let allProperties = [];
    if (completions.length > 0) {
      console.log(`[Daily] Pre-loading property data for batched processing...`);
      allProperties = await batchLoadProperties(completions, env);
      console.log(`[Daily] Loaded ${allProperties.length} total properties for matching`);
    }
    
    for (const completion of completions) {
      try {
        await processCompletionBatched(completion, env, results, dryRun, allProperties);
        results.completionsProcessed++;
      } catch (err) {
        console.error(`[Daily] Error processing completion ${completion.API_Number}:`, err);
        results.errors.push({ api: completion.API_Number, error: err.message });
      }
    }
    
  } catch (err) {
    console.error('[Daily] Fatal error:', err);
    throw err;
  }
  
  console.log(`[Daily] Completed. Permits: ${results.permitsProcessed}, Completions: ${results.completionsProcessed}, Alerts: ${results.alertsSent}, Skipped: ${results.alertsSkipped}`);
  
  if (dryRun && results.matchesFound.length > 0) {
    console.log(`[Daily] DRY RUN - Matches found:`);
    results.matchesFound.forEach(m => {
      console.log(`  - ${m.activityType}: ${m.wellName} (${m.api}) → ${m.userEmail} [${m.alertLevel}]`);
    });
  }

  // Print completion analysis summary if we processed any completions
  if (results.runStats && results.runStats.totalCompletions > 0) {
    const stats = results.runStats;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Daily] 📊 COMPLETION ANALYSIS SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`[Daily] Completions processed: ${stats.totalCompletions}`);
    console.log(`[Daily] ├─ Horizontal: ${stats.horizontalCount} (${((stats.horizontalCount / stats.totalCompletions) * 100).toFixed(1)}%)`);
    console.log(`[Daily] └─ Vertical: ${stats.verticalCount}`);
    console.log(`[Daily]`);
    console.log(`[Daily] Horizontal breakdown:`);
    console.log(`[Daily] ├─ Multi-section: ${stats.multiSectionCount}`);
    console.log(`[Daily] └─ Single-section: ${stats.singleSectionCount}`);
    console.log(`[Daily]`);
    console.log(`[Daily] Data quality (horizontal wells):`);
    console.log(`[Daily] ├─ BH PLSS data: ${stats.bhDataPresent} present, ${stats.bhDataMissing} missing`);
    console.log(`[Daily] └─ Coordinates: ${stats.coordsPresent} present, ${stats.coordsMissing} missing`);
    console.log(`[Daily]`);
    console.log(`[Daily] Matches found:`);
    console.log(`[Daily] ├─ Direct (YOUR PROPERTY): ${stats.directMatches}`);
    console.log(`[Daily] └─ Adjacent: ${stats.adjacentMatches}`);
    console.log(`[Daily]`);
    console.log(`[Daily] Alerts:`);
    console.log(`[Daily] ├─ Sent: ${stats.alertsSent}`);
    console.log(`[Daily] └─ Skipped: ${stats.alertsSkipped}`);
    if (stats.errors.length > 0) {
      console.log(`[Daily]`);
      console.log(`[Daily] ⚠️ Errors: ${stats.errors.length}`);
      stats.errors.forEach(e => console.log(`[Daily]    - ${e}`));
    }
    console.log(`${'='.repeat(60)}\n`);
  }
  
  return results;
}

/**
 * Batch load all properties that might match any completion
 * This replaces dozens of individual queries with 1-2 batch queries
 */
async function batchLoadProperties(completions, env) {
  const allSections = new Set();
  
  // Collect all sections from all completions (direct + adjacent)
  for (const completion of completions) {
    const directSections = getDirectlyAffectedSections(completion);
    
    // Add all direct sections
    for (const section of directSections) {
      allSections.add(`${section.section}-${section.township}-${section.range}-${section.meridian}`);
    }
    
    // Add all adjacent sections
    const adjacentSections = getAdjacentSectionsForUnit(directSections);
    for (const adjSection of adjacentSections) {
      allSections.add(`${adjSection.section}-${adjSection.township}-${adjSection.range}-${adjSection.meridian}`);
    }
  }
  
  console.log(`[Daily] Batch loading properties for ${allSections.size} unique sections`);
  
  // Build one large OR query for all sections
  const sectionQueries = Array.from(allSections).map(sectionKey => {
    const [section, township, range, meridian] = sectionKey.split('-');
    return `AND({SEC} = "${section}", {TWN} = "${township}", {RNG} = "${range}", {MERIDIAN} = "${meridian}", {Status} = "Active")`;
  });
  
  // Split into chunks if too large for single query
  const chunks = [];
  const chunkSize = 100; // Airtable formula limit
  
  for (let i = 0; i < sectionQueries.length; i += chunkSize) {
    const chunk = sectionQueries.slice(i, i + chunkSize);
    const formula = `OR(${chunk.join(', ')})`;
    chunks.push(formula);
  }
  
  // Execute batch queries
  let allProperties = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[Daily] Executing batch query ${i + 1}/${chunks.length}`);
    const properties = await queryAirtable(env, env.AIRTABLE_PROPERTIES_TABLE, chunks[i]);
    allProperties = allProperties.concat(properties);
  }
  
  // Index properties by location key for fast lookup
  const propertyMap = new Map();
  for (const prop of allProperties) {
    const key = `${prop.fields.SEC}-${prop.fields.TWN}-${prop.fields.RNG}-${prop.fields.MERIDIAN}`;
    if (!propertyMap.has(key)) {
      propertyMap.set(key, []);
    }
    propertyMap.get(key).push(prop);
  }
  
  return propertyMap;
}

/**
 * Process a single permit record
 */
async function processPermit(permit, env, results, dryRun = false) {
  const api10 = normalizeAPI(permit.API_Number);
  const activityType = mapApplicationType(permit.Application_Type);
  
  // Debug: log the permit location data
  console.log(`[Daily] Processing permit: SEC=${permit.Section} TWN=${permit.Township} RNG=${permit.Range} PM=${permit.PM} County=${permit.County}`);
  console.log(`[Daily] Searching for property match: S${permit.Section} T${permit.Township} R${permit.Range} M${permit.PM} (${permit.County})`);
  
  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // 1. Check property matches (surface location)
  const propertyMatches = await findMatchingProperties({
    section: permit.Section,
    township: permit.Township,
    range: permit.Range,
    meridian: permit.PM,
    county: permit.County
  }, env);
  
  console.log(`[Daily] Found ${propertyMatches.length} property matches for permit at ${permit.Section}-${permit.Township}-${permit.Range}`);
  
  for (const match of propertyMatches) {
    alertsToSend.push({
      user: match.user,
      alertLevel: match.alertLevel,
      matchedLocation: match.matchedSection,
      reason: match.alertLevel === 'YOUR PROPERTY' ? 'surface_location' : 'adjacent_section'
    });
  }
  
  // 2. For horizontal wells, also check bottom hole location
  if (permit.Drill_Type === 'HH' || permit.Drill_Type === 'DH') {
    if (permit.PBH_Section && permit.PBH_Township && permit.PBH_Range) {
      const bhMatches = await findMatchingProperties({
        section: permit.PBH_Section,
        township: permit.PBH_Township,
        range: permit.PBH_Range,
        meridian: permit.PM,
        county: permit.County
      }, env);
      
      for (const match of bhMatches) {
        // Avoid duplicate alerts to same user
        if (!alertsToSend.some(a => a.user.email === match.user.email)) {
          alertsToSend.push({
            user: match.user,
            alertLevel: match.alertLevel,
            matchedLocation: match.matchedSection,
            reason: 'bottom_hole_location'
          });
        }
      }
    }
  }
  
  // 3. Check tracked well matches
  const wellMatches = await findMatchingWells(api10, env);
  for (const match of wellMatches) {
    // Avoid duplicate alerts to same user
    if (!alertsToSend.some(a => a.user.email === match.user.email)) {
      alertsToSend.push({
        user: match.user,
        alertLevel: 'TRACKED WELL',
        matchedLocation: `API: ${api10}`,
        reason: 'tracked_well'
      });
    }
  }
  
  // 4. If we have alerts to send, fetch well coordinates for map link
  let wellData = null;
  let mapLink = null;
  if (alertsToSend.length > 0) {
    wellData = await fetchWellCoordinates(api10, env);
    mapLink = getMapLinkFromWellData(wellData);
    if (mapLink) {
      console.log(`[Daily] Generated map link for ${api10}: ${mapLink}`);
    } else {
      console.log(`[Daily] No map link generated for ${api10} - wellData:`, wellData ? 'present but missing coords' : 'not found');
    }
  }
  
  // 5. Send alerts (with deduplication check)
  for (const alert of alertsToSend) {
    // Check if we've already alerted this user about this API + activity type
    const alreadyAlerted = await hasRecentAlert(
      env,
      alert.user.email,
      api10,
      activityType
    );
    
    if (alreadyAlerted) {
      console.log(`[Daily] Skipping duplicate alert for ${alert.user.email} on ${api10}`);
      results.alertsSkipped = (results.alertsSkipped || 0) + 1;
      continue;
    }
    
    // Use well name from GIS API if available (often more complete), fallback to permit data
    const wellName = wellData?.well_name 
      ? (wellData.well_num && !wellData.well_name.includes(wellData.well_num) 
          ? `${wellData.well_name} ${wellData.well_num}`.trim()
          : wellData.well_name)
      : `${permit.Well_Name || ''} ${permit.Well_Number || ''}`.trim();
    const location = `S${normalizeSection(permit.Section)} T${permit.Township} R${permit.Range}`;
    
    // Extract operator phone number from permit data
    const permitOperatorPhone = permit.Phone || permit.Phone_Number || permit.Entity_Phone || 
                               permit.Operator_Phone || permit.Contact_Phone || permit.Contact_Number ||
                               permit.Phone_Num || permit.PHONE || null;

    // Get operator phone from comprehensive database, update if permit has newer data
    let operatorPhone = null;
    if (permit.Entity_Name) {
      try {
        operatorPhone = await getOperatorPhone(permit.Entity_Name, env);
        
        // If permit has phone data and it's different from our database, update our database
        if (permitOperatorPhone && permitOperatorPhone !== operatorPhone) {
          console.log(`[Daily] Updating operator phone: ${permit.Entity_Name} from ${operatorPhone} to ${permitOperatorPhone}`);
          await updateOperatorInfo(permit.Entity_Name, { phone: permitOperatorPhone }, env);
          operatorPhone = permitOperatorPhone;
        }
        
        // If we don't have phone in database but permit does, use permit data
        if (!operatorPhone && permitOperatorPhone) {
          operatorPhone = permitOperatorPhone;
        }
      } catch (error) {
        console.warn(`[Daily] Failed to lookup/update operator phone for ${permit.Entity_Name}:`, error);
        operatorPhone = permitOperatorPhone; // Fallback to permit data
      }
    }
    
    // Record match for dry-run logging
    results.matchesFound.push({
      activityType,
      wellName,
      api: api10,
      userId: alert.user.id,
      alertLevel: alert.alertLevel,
      location,
      county: permit.County,
      operator: permit.Entity_Name,
      operatorPhone,
      hasMapLink: !!mapLink
    });
    
    // In dry-run mode, skip actual writes
    if (dryRun) {
      console.log(`[Daily] DRY RUN: Would alert ${alert.user.email} about ${activityType} on ${api10}${mapLink ? ' (with map link)' : ''}`);
      results.alertsSent++;
      continue;
    }
    
    // Create activity log entry (with Email Sent = false initially)
    // Only include map link for tracked well alerts
    const includeMapLink = alert.reason === 'tracked_well';
    const activityData = {
      wellName,
      apiNumber: api10,
      activityType: activityType,
      operator: permit.Entity_Name,
      operatorPhone,
      alertLevel: alert.alertLevel,
      sectionTownshipRange: location,
      county: permit.County,
      occLink: permit.IMAGE_URL || null,
      mapLink: includeMapLink ? mapLink : null,
      userId: alert.user.id
    };
    
    const activityRecord = await createActivityLog(env, activityData);
    
    // Send email and update Email Sent status
    try {
      await sendAlertEmail(env, {
        to: alert.user.email,
        userName: alert.user.name,
        alertLevel: alert.alertLevel,
        activityType: activityType,
        wellName: activityData.wellName,
        operator: permit.Entity_Name,
        location: activityData.sectionTownshipRange,
        county: permit.County,
        occLink: permit.IMAGE_URL,
        mapLink: includeMapLink ? mapLink : null,
        drillType: permit.Drill_Type,
        apiNumber: api10,
        wellType: wellData?.welltype || null,
        userId: alert.user.id
      });
      
      // Email sent successfully - update activity log
      await updateActivityLog(env, activityRecord.id, { 'Email Sent': true });
      console.log(`[Daily] Email sent and activity updated for ${alert.user.email} on ${api10}`);
    } catch (emailError) {
      console.error(`[Daily] Failed to send email to ${alert.user.email}: ${emailError.message}`);
      // Activity log remains with Email Sent = false
    }
    
    results.alertsSent++;
  }
}

/**
 * Process a single completion record
 */
async function processCompletion(completion, env, results, dryRun = false) {
  // Similar logic to processPermit but for completions
  // Activity type will be "Well Completed"
  const api10 = normalizeAPI(completion.API_Number);

  // Initialize run stats if not exists
  if (!results.runStats) {
    results.runStats = {
      totalCompletions: 0,
      horizontalCount: 0,
      verticalCount: 0,
      multiSectionCount: 0,
      singleSectionCount: 0,
      bhDataPresent: 0,
      bhDataMissing: 0,
      coordsPresent: 0,
      coordsMissing: 0,
      directMatches: 0,
      adjacentMatches: 0,
      alertsSent: 0,
      alertsSkipped: 0,
      errors: []
    };
  }
  
  // Get all sections directly affected by this well's lateral path
  const directlyAffectedSections = getDirectlyAffectedSections(completion);
  const multiSection = completion._isMultiSection;
  const isHorizontal = completion.Drill_Type === 'HORIZONTAL HOLE' || completion.Location_Type_Sub === 'HH';

  console.log(`[Daily] Completion ${api10} is ${multiSection ? 'MULTI-SECTION' : 'single-section'}, affects: ${
    directlyAffectedSections.map(s => `S${s.section} T${s.township} R${s.range} (${s.type})`).join(', ')
  }`);

  // Track completion metrics
  results.runStats.totalCompletions++;
  if (isHorizontal) {
    results.runStats.horizontalCount++;
  } else {
    results.runStats.verticalCount++;
  }

  // Track multi-section breakdown
  if (completion._isMultiSection) {
    results.runStats.multiSectionCount++;
  } else if (isHorizontal) {
    results.runStats.singleSectionCount++;
  }

  // Track BH data quality
  if (completion.BH_Section && completion.BH_Township && completion.BH_Range) {
    results.runStats.bhDataPresent++;
  } else if (isHorizontal) {
    results.runStats.bhDataMissing++;
    console.log(`[Daily] ⚠️ ${api10}: Horizontal well missing BH data`);
  }

  // Track coordinate data quality
  if (completion.Surf_Lat_Y && completion.Bottom_Hole_Lat_Y) {
    results.runStats.coordsPresent++;
  } else if (isHorizontal) {
    results.runStats.coordsMissing++;
  }

  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // Check each directly affected section for property matches (YOUR PROPERTY level)
  for (const section of directlyAffectedSections) {
    const sectionMatches = await findMatchingProperties({
      section: section.section,
      township: section.township,
      range: section.range,
      meridian: section.meridian,
      county: completion.County
    }, env);
    
    for (const match of sectionMatches) {
      // Avoid duplicate alerts to same user
      if (!alertsToSend.some(a => a.user.email === match.user.email)) {
        alertsToSend.push({
          user: match.user,
          alertLevel: 'YOUR PROPERTY', // Direct match - lateral is IN their section
          matchedLocation: `S${section.section} T${section.township} R${section.range}`,
          reason: section.type // 'surface', 'bottom_hole', or 'lateral_path'
        });
        results.runStats.directMatches++;
        console.log(`[Daily] Direct match (${section.type}) for user ${match.user.email} at S${section.section}`);
      }
    }
  }

  // For adjacent section matching, exclude sections already in the lateral path
  const adjacentSections = getAdjacentSectionsForUnit(directlyAffectedSections);

  for (const adjSection of adjacentSections) {
    const adjMatches = await findMatchingProperties({
      section: adjSection.section,
      township: adjSection.township,
      range: adjSection.range,
      meridian: adjSection.meridian,
      county: completion.County
    }, env);
    
    for (const match of adjMatches) {
      // Only add if user hasn't already been alerted (direct match takes precedence)
      if (!alertsToSend.some(a => a.user.email === match.user.email)) {
        alertsToSend.push({
          user: match.user,
          alertLevel: 'ADJACENT SECTION',
          matchedLocation: `S${adjSection.section} T${adjSection.township} R${adjSection.range}`,
          reason: 'adjacent_to_unit'
        });
        results.runStats.adjacentMatches++;
      }
    }
  }
  
  // Check tracked wells
  const wellMatches = await findMatchingWells(api10, env);
  for (const match of wellMatches) {
    if (!alertsToSend.some(a => a.user.email === match.user.email)) {
      alertsToSend.push({
        user: match.user,
        alertLevel: 'TRACKED WELL',
        matchedLocation: `API: ${api10}`,
        reason: 'tracked_well'
      });
    }
  }
  
  // Check if we need map links (only for tracked well alerts)
  let wellData = null;
  let mapLink = null;
  const hasTrackedWellAlerts = alertsToSend.some(alert => alert.reason === 'tracked_well');
  
  if (hasTrackedWellAlerts) {
    wellData = await fetchWellCoordinates(api10, env);
    mapLink = getMapLinkFromWellData(wellData);
    if (mapLink) {
      console.log(`[Daily] Generated map link for tracked well completion ${api10}: ${mapLink}`);
    } else {
      console.log(`[Daily] No map link generated for tracked well completion ${api10} - wellData:`, wellData ? 'present but missing coords' : 'not found');
    }
  } else {
    console.log(`[Daily] No tracked well alerts for completion ${api10} - skipping map link generation`);
  }
  
  // Send alerts
  for (const alert of alertsToSend) {
    const alreadyAlerted = await hasRecentAlert(env, alert.user.email, api10, 'Well Completed');
    if (alreadyAlerted) {
      results.alertsSkipped = (results.alertsSkipped || 0) + 1;
      results.runStats.alertsSkipped++;
      continue;
    }
    
    // Use well name from GIS API if available
    const wellName = wellData?.well_name 
      ? (wellData.well_num && !wellData.well_name.includes(wellData.well_num) 
          ? `${wellData.well_name} ${wellData.well_num}`.trim()
          : wellData.well_name)
      : `${completion.Well_Name || ''} ${completion.Well_Number || ''}`.trim();
    const location = `S${normalizeSection(completion.Section)} T${completion.Township} R${completion.Range}`;
    const operator = completion.Entity_Name || completion.Operator;
    
    // Extract operator phone number from completion data
    const completionOperatorPhone = completion.Phone || completion.Phone_Number || completion.Entity_Phone || 
                                   completion.Operator_Phone || completion.Contact_Phone || completion.Contact_Number ||
                                   completion.Phone_Num || completion.PHONE || null;

    // Get operator phone from comprehensive database, update if completion has newer data  
    let operatorPhone = null;
    if (operator) {
      try {
        operatorPhone = await getOperatorPhone(operator, env);
        
        // If completion has phone data and it's different from our database, update our database
        if (completionOperatorPhone && completionOperatorPhone !== operatorPhone) {
          console.log(`[Daily] Updating operator phone from completion: ${operator} from ${operatorPhone} to ${completionOperatorPhone}`);
          await updateOperatorInfo(operator, { phone: completionOperatorPhone }, env);
          operatorPhone = completionOperatorPhone;
        }
        
        // If we don't have phone in database but completion does, use completion data
        if (!operatorPhone && completionOperatorPhone) {
          operatorPhone = completionOperatorPhone;
        }
      } catch (error) {
        console.warn(`[Daily] Failed to lookup/update operator phone for ${operator}:`, error);
        operatorPhone = completionOperatorPhone; // Fallback to completion data
      }
    }
    
    // Record match for dry-run logging
    results.matchesFound.push({
      activityType: 'Well Completed',
      wellName,
      api: api10,
      userId: alert.user.id,
      alertLevel: alert.alertLevel,
      location,
      county: completion.County,
      operator,
      operatorPhone,
      hasMapLink: !!mapLink
    });
    
    // In dry-run mode, skip actual writes
    if (dryRun) {
      console.log(`[Daily] DRY RUN: Would alert ${alert.user.email} about Well Completed on ${api10}${mapLink ? ' (with map link)' : ''}`);
      results.alertsSent++;
      results.runStats.alertsSent++;
      continue;
    }
    
    // Only include map link for tracked well alerts
    const includeMapLink = alert.reason === 'tracked_well';
    const activityData = {
      wellName,
      apiNumber: api10,
      activityType: 'Well Completed',
      operator,
      operatorPhone,
      alertLevel: alert.alertLevel,
      sectionTownshipRange: location,
      county: completion.County,
      mapLink: includeMapLink ? mapLink : null,
      userId: alert.user.id
    };
    
    const activityRecord = await createActivityLog(env, activityData);
    
    // Send email and update Email Sent status
    try {
      await sendAlertEmail(env, {
        to: alert.user.email,
        userName: alert.user.name,
        alertLevel: alert.alertLevel,
        activityType: 'Well Completed',
        wellName: activityData.wellName,
        operator: activityData.operator,
        location: activityData.sectionTownshipRange,
        county: completion.County,
        mapLink: includeMapLink ? mapLink : null,
        apiNumber: api10,
        wellType: wellData?.welltype || null,
        userId: alert.user.id,
        
        // Multi-section flag and lateral path info
        isMultiSection: completion._isMultiSection || false,
        isHorizontal: completion.Drill_Type === 'HORIZONTAL HOLE' || completion.Location_Type_Sub === 'HH',
        lateralDirection: completion._lateralDirection || null,
        lateralLength: completion._lateralLength || completion.Length || null,
        bhLocation: completion.BH_Section 
          ? `S${completion.BH_Section} T${completion.BH_Township} R${completion.BH_Range}` 
          : null,
        sectionsAffected: directlyAffectedSections.length > 1 
          ? directlyAffectedSections.map(s => `S${s.section}`).join(', ')
          : null,
          
        // Production data
        formationName: completion.Formation_Name,
        formationDepth: completion.Formation_Depth,
        ipGas: completion.Gas_MCF_Per_Day,
        ipOil: completion.Oil_BBL_Per_Day,
        ipWater: completion.Water_BBL_Per_Day,
        pumpingFlowing: completion.Pumping_Flowing,
        
        // Timeline
        spudDate: formatDate(completion.Spud),
        completionDate: formatDate(completion.Well_Completion),
        firstProdDate: formatDate(completion.First_Prod)
      });
      
      // Email sent successfully - update activity log
      await updateActivityLog(env, activityRecord.id, { 'Email Sent': true });
      console.log(`[Daily] Email sent and activity updated for ${alert.user.email} on ${api10}`);
    } catch (emailError) {
      console.error(`[Daily] Failed to send email to ${alert.user.email}: ${emailError.message}`);
      // Activity log remains with Email Sent = false
    }
    
    results.alertsSent++;
    results.runStats.alertsSent++;
  }
}

/**
 * Process a single completion record using pre-loaded property data (batched optimization)
 */
async function processCompletionBatched(completion, env, results, dryRun = false, allProperties) {
  const api10 = normalizeAPI(completion.API_Number);

  // Initialize run stats if not exists
  if (!results.runStats) {
    results.runStats = {
      totalCompletions: 0,
      horizontalCount: 0,
      verticalCount: 0,
      multiSectionCount: 0,
      singleSectionCount: 0,
      bhDataPresent: 0,
      bhDataMissing: 0,
      coordsPresent: 0,
      coordsMissing: 0,
      directMatches: 0,
      adjacentMatches: 0,
      alertsSent: 0,
      alertsSkipped: 0,
      errors: []
    };
  }
  
  // Get all sections directly affected by this well's lateral path
  const directlyAffectedSections = getDirectlyAffectedSections(completion);
  const multiSection = completion._isMultiSection;
  const isHorizontal = completion.Drill_Type === 'HORIZONTAL HOLE' || completion.Location_Type_Sub === 'HH';

  console.log(`[Daily] Completion ${api10} is ${multiSection ? 'MULTI-SECTION' : 'single-section'}, affects: ${
    directlyAffectedSections.map(s => `S${s.section} T${s.township} R${s.range} (${s.type})`).join(', ')
  }`);

  // Track completion metrics
  results.runStats.totalCompletions++;
  if (isHorizontal) {
    results.runStats.horizontalCount++;
  } else {
    results.runStats.verticalCount++;
  }

  // Track multi-section breakdown
  if (completion._isMultiSection) {
    results.runStats.multiSectionCount++;
  } else if (isHorizontal) {
    results.runStats.singleSectionCount++;
  }

  // Track BH data quality
  if (completion.BH_Section && completion.BH_Township && completion.BH_Range) {
    results.runStats.bhDataPresent++;
  } else if (isHorizontal) {
    results.runStats.bhDataMissing++;
    console.log(`[Daily] ⚠️ ${api10}: Horizontal well missing BH data`);
  }

  // Track coordinate data quality
  if (completion.Surf_Lat_Y && completion.Bottom_Hole_Lat_Y) {
    results.runStats.coordsPresent++;
  } else if (isHorizontal) {
    results.runStats.coordsMissing++;
  }

  // Collect all users who should be alerted using batched data
  const alertsToSend = [];
  
  // Check each directly affected section for property matches (YOUR PROPERTY level)
  for (const section of directlyAffectedSections) {
    const key = `${section.section}-${section.township}-${section.range}-${section.meridian}`;
    const properties = allProperties.get(key) || [];
    
    for (const prop of properties) {
      // Get the linked user
      const userIds = prop.fields.User;
      if (!userIds || userIds.length === 0) continue;
      
      const user = await getUserById(env, userIds[0]);
      if (!user || user.fields.Status !== 'Active') continue;
      
      // Avoid duplicate alerts to same user
      if (!alertsToSend.some(a => a.user.email === user.fields.Email)) {
        alertsToSend.push({
          user: {
            id: user.id,
            email: user.fields.Email,
            name: user.fields.Name || user.fields.Email
          },
          alertLevel: 'YOUR PROPERTY', // Direct match - lateral is IN their section
          matchedLocation: `S${section.section} T${section.township} R${section.range}`,
          reason: section.type // 'surface', 'bottom_hole', or 'lateral_path'
        });
        results.runStats.directMatches++;
        console.log(`[Daily] Direct match (${section.type}) for user ${user.fields.Email} at S${section.section}`);
      }
    }
  }

  // For adjacent section matching, exclude sections already in the lateral path
  const adjacentSections = getAdjacentSectionsForUnit(directlyAffectedSections);

  for (const adjSection of adjacentSections) {
    const key = `${adjSection.section}-${adjSection.township}-${adjSection.range}-${adjSection.meridian}`;
    const properties = allProperties.get(key) || [];
    
    for (const prop of properties) {
      const userIds = prop.fields.User;
      if (!userIds || userIds.length === 0) continue;
      
      const user = await getUserById(env, userIds[0]);
      if (!user || user.fields.Status !== 'Active') continue;
      
      // Only add if user hasn't already been alerted (direct match takes precedence)
      if (!alertsToSend.some(a => a.user.email === user.fields.Email)) {
        alertsToSend.push({
          user: {
            id: user.id,
            email: user.fields.Email,
            name: user.fields.Name || user.fields.Email
          },
          alertLevel: 'ADJACENT SECTION',
          matchedLocation: `S${adjSection.section} T${adjSection.township} R${adjSection.range}`,
          reason: 'adjacent_to_unit'
        });
        results.runStats.adjacentMatches++;
      }
    }
  }
  
  // Check tracked wells
  const wellMatches = await findMatchingWells(api10, env);
  for (const match of wellMatches) {
    if (!alertsToSend.some(a => a.user.email === match.user.email)) {
      alertsToSend.push({
        user: match.user,
        alertLevel: 'TRACKED WELL',
        matchedLocation: `API: ${api10}`,
        reason: 'tracked_well'
      });
    }
  }
  
  // Rest of processing logic (map links, emails, etc.) stays the same...
  // Check if we need map links (only for tracked well alerts)
  let wellData = null;
  let mapLink = null;
  const hasTrackedWellAlerts = alertsToSend.some(alert => alert.reason === 'tracked_well');
  
  if (hasTrackedWellAlerts) {
    wellData = await fetchWellCoordinates(api10, env);
    mapLink = getMapLinkFromWellData(wellData);
    if (mapLink) {
      console.log(`[Daily] Generated map link for tracked well completion ${api10}: ${mapLink}`);
    } else {
      console.log(`[Daily] No map link generated for tracked well completion ${api10} - wellData:`, wellData ? 'present but missing coords' : 'not found');
    }
  } else {
    console.log(`[Daily] No tracked well alerts for completion ${api10} - skipping map link generation`);
  }
  
  // Send alerts
  for (const alert of alertsToSend) {
    const alreadyAlerted = await hasRecentAlert(env, alert.user.email, api10, 'Well Completed');
    if (alreadyAlerted) {
      results.alertsSkipped = (results.alertsSkipped || 0) + 1;
      results.runStats.alertsSkipped++;
      continue;
    }
    
    // Use well name from GIS API if available
    const wellName = wellData?.well_name 
      ? (wellData.well_num && !wellData.well_name.includes(wellData.well_num) 
          ? `${wellData.well_name} ${wellData.well_num}`.trim()
          : wellData.well_name)
      : `${completion.Well_Name || ''} ${completion.Well_Number || ''}`.trim();
    const location = `S${normalizeSection(completion.Section)} T${completion.Township} R${completion.Range}`;
    const operator = completion.Entity_Name || completion.Operator;
    
    // Extract operator phone number from completion data
    const completionOperatorPhone = completion.Phone || completion.Phone_Number || completion.Entity_Phone || 
                                   completion.Operator_Phone || completion.Contact_Phone || completion.Contact_Number ||
                                   completion.Phone_Num || completion.PHONE || null;

    // Get operator phone from comprehensive database, update if completion has newer data  
    let operatorPhone = null;
    if (operator) {
      try {
        operatorPhone = await getOperatorPhone(operator, env);
        
        // If completion has phone data and it's different from our database, update our database
        if (completionOperatorPhone && completionOperatorPhone !== operatorPhone) {
          console.log(`[Daily] Updating operator phone from completion: ${operator} from ${operatorPhone} to ${completionOperatorPhone}`);
          await updateOperatorInfo(operator, { phone: completionOperatorPhone }, env);
          operatorPhone = completionOperatorPhone;
        }
        
        // If we don't have phone in database but completion does, use completion data
        if (!operatorPhone && completionOperatorPhone) {
          operatorPhone = completionOperatorPhone;
        }
      } catch (error) {
        console.warn(`[Daily] Failed to lookup/update operator phone for ${operator}:`, error);
        operatorPhone = completionOperatorPhone; // Fallback to completion data
      }
    }
    
    // Record match for dry-run logging
    results.matchesFound.push({
      activityType: 'Well Completed',
      wellName,
      api: api10,
      userId: alert.user.id,
      alertLevel: alert.alertLevel,
      location,
      county: completion.County,
      operator,
      operatorPhone,
      hasMapLink: !!mapLink
    });
    
    // In dry-run mode, skip actual writes
    if (dryRun) {
      console.log(`[Daily] DRY RUN: Would alert ${alert.user.email} about Well Completed on ${api10}${mapLink ? ' (with map link)' : ''}`);
      results.alertsSent++;
      results.runStats.alertsSent++;
      continue;
    }
    
    // Only include map link for tracked well alerts
    const includeMapLink = alert.reason === 'tracked_well';
    const activityData = {
      wellName,
      apiNumber: api10,
      activityType: 'Well Completed',
      operator,
      operatorPhone,
      alertLevel: alert.alertLevel,
      sectionTownshipRange: location,
      county: completion.County,
      mapLink: includeMapLink ? mapLink : null,
      userId: alert.user.id
    };
    
    const activityRecord = await createActivityLog(env, activityData);
    
    // Send email and update Email Sent status
    try {
      await sendAlertEmail(env, {
        to: alert.user.email,
        userName: alert.user.name,
        alertLevel: alert.alertLevel,
        activityType: 'Well Completed',
        wellName: activityData.wellName,
        operator: activityData.operator,
        location: activityData.sectionTownshipRange,
        county: completion.County,
        mapLink: includeMapLink ? mapLink : null,
        apiNumber: api10,
        wellType: wellData?.welltype || null,
        userId: alert.user.id,
        
        // Multi-section flag and lateral path info
        isMultiSection: completion._isMultiSection || false,
        isHorizontal: completion.Drill_Type === 'HORIZONTAL HOLE' || completion.Location_Type_Sub === 'HH',
        lateralDirection: completion._lateralDirection || null,
        lateralLength: completion._lateralLength || completion.Length || null,
        bhLocation: completion.BH_Section 
          ? `S${completion.BH_Section} T${completion.BH_Township} R${completion.BH_Range}` 
          : null,
        sectionsAffected: directlyAffectedSections.length > 1 
          ? directlyAffectedSections.map(s => `S${s.section}`).join(', ')
          : null,
          
        // Production data
        formationName: completion.Formation_Name,
        formationDepth: completion.Formation_Depth,
        ipGas: completion.Gas_MCF_Per_Day,
        ipOil: completion.Oil_BBL_Per_Day,
        ipWater: completion.Water_BBL_Per_Day,
        pumpingFlowing: completion.Pumping_Flowing,
        
        // Timeline
        spudDate: formatDate(completion.Spud),
        completionDate: formatDate(completion.Well_Completion),
        firstProdDate: formatDate(completion.First_Prod)
      });
      
      // Email sent successfully - update activity log
      await updateActivityLog(env, activityRecord.id, { 'Email Sent': true });
      console.log(`[Daily] Email sent and activity updated for ${alert.user.email} on ${api10}`);
    } catch (emailError) {
      console.error(`[Daily] Failed to send email to ${alert.user.email}: ${emailError.message}`);
      // Activity log remains with Email Sent = false
    }
    
    results.alertsSent++;
    results.runStats.alertsSent++;
  }
  
  // Update KV cache with fresh completion data (Phase 3: Keep cache fresh)
  try {
    await updateCompletionCache(completion, env);
  } catch (error) {
    console.error(`[Daily] Failed to update completion cache for API ${api10}:`, error.message);
    // Don't let cache update failures break the monitoring flow
  }
}

/**
 * Map OCC Application_Type to Activity Log type
 */
function mapApplicationType(appType) {
  const mapping = {
    'DR': 'New Permit',      // Drill
    'RC': 'Status Change',   // Recomplete
    'RE': 'Status Change',   // Re-enter
    'DW': 'New Permit',      // Deepening
    'SH': 'New Permit'       // Shallow
  };
  return mapping[appType] || 'New Permit';
}

/**
 * Update completion data in KV cache (Phase 3: Keep cache fresh with daily data)
 * @param {Object} completion - Completion record from OCC
 * @param {Object} env - Worker environment
 */
async function updateCompletionCache(completion, env) {
  const api10 = normalizeAPI(completion.API_Number);
  
  // Helper to safely parse numbers
  const parseNumber = (value) => {
    if (!value || value === 0) return null;
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  };
  
  // Helper to format dates
  const formatDate = (value) => {
    if (!value) return null;
    try {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  };
  
  // Format completion data for KV storage (same structure as backfill)
  const completionData = {
    api: api10,
    wellName: completion.Well_Name || null,
    operator: completion.Entity_Name || completion.Operator || null,
    county: completion.County || null,
    
    // Location data
    surfaceSection: completion.Section ? completion.Section.toString() : null,
    surfaceTownship: completion.Township || null,
    surfaceRange: completion.Range || null,
    bhSection: completion.BH_Section ? completion.BH_Section.toString() : null,
    bhTownship: completion.BH_Township || null,
    bhRange: completion.BH_Range || null,
    
    // Production data
    formationName: completion.Formation_Name || null,
    formationDepth: parseNumber(completion.Formation_Depth),
    ipGas: parseNumber(completion.Gas_MCF_Per_Day),
    ipOil: parseNumber(completion.Oil_BBL_Per_Day),
    ipWater: parseNumber(completion.Water_BBL_Per_Day),
    pumpingFlowing: completion.Pumping_Flowing || null,
    
    // Timeline data
    spudDate: formatDate(completion.Spud),
    completionDate: formatDate(completion.Well_Completion),
    firstProdDate: formatDate(completion.First_Prod),
    
    // Well details
    drillType: completion.Drill_Type || null,
    lateralLength: parseNumber(completion.Lateral_Length),
    totalDepth: parseNumber(completion.Total_Depth),
    wellNumber: completion.Well_Number || null,
    leaseName: completion.BHL_From_Lease || null,
    
    // Metadata
    cachedAt: Date.now(),
    source: 'daily_monitor'
  };
  
  // Store in KV cache with 1 year expiration
  const cacheKey = `well:${api10}`;
  await env.COMPLETIONS_CACHE.put(
    cacheKey, 
    JSON.stringify(completionData),
    { expirationTtl: 365 * 24 * 60 * 60 } // 1 year
  );
  
  console.log(`[Daily] Updated completion cache for API ${api10}: ${completionData.wellName || 'Unknown'} (${completionData.formationName || 'No formation'})`);
}
