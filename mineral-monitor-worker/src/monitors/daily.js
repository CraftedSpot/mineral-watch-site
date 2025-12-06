/**
 * Daily Monitor - Processes Intent to Drill and Completion files
 */

import { fetchOCCFile } from '../services/occ.js';
import { fetchWellCoordinates } from '../services/occGis.js';
import { findMatchingProperties, findMatchingWells } from '../services/matching.js';
import { hasRecentAlert, createActivityLog, updateActivityLog } from '../services/airtable.js';
import { sendAlertEmail } from '../services/email.js';
import { normalizeSection, normalizeAPI } from '../utils/normalize.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';
import { getOperatorPhone, updateOperatorInfo } from '../services/operators.js';

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
    
    for (const completion of completions) {
      try {
        await processCompletion(completion, env, results, dryRun);
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
  
  return results;
}

/**
 * Process a single permit record
 */
async function processPermit(permit, env, results, dryRun = false) {
  const api10 = normalizeAPI(permit.API_Number);
  const activityType = mapApplicationType(permit.Application_Type);
  
  // Debug: log the permit location data
  console.log(`[Daily] Processing permit: SEC=${permit.Section} TWN=${permit.Township} RNG=${permit.Range} PM=${permit.PM} County=${permit.County}`);
  
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
  
  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // Check property matches
  const propertyMatches = await findMatchingProperties({
    section: completion.Section,
    township: completion.Township,
    range: completion.Range,
    meridian: completion.PM,
    county: completion.County
  }, env);
  
  for (const match of propertyMatches) {
    alertsToSend.push({
      user: match.user,
      alertLevel: match.alertLevel,
      matchedLocation: match.matchedSection,
      reason: match.alertLevel === 'YOUR PROPERTY' ? 'surface_location' : 'adjacent_section'
    });
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
