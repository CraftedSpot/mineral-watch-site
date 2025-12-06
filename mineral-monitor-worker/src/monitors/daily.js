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
 * Check if we're in dry-run mode
 */
function isDryRun(env) {
  return env.DRY_RUN === 'true' || env.DRY_RUN === true;
}

/**
 * Batch load all properties for the sections we need to check
 * @param {Array} permits - Array of permit records
 * @param {Array} completions - Array of completion records
 * @param {Object} env - Worker environment
 * @returns {Map} - Map of section keys to property arrays
 */
async function batchLoadProperties(permits, completions, env) {
  const sectionsToLoad = new Set();
  
  // Collect all sections from permits
  for (const permit of permits) {
    addSectionsForRecord(permit, sectionsToLoad, 'permit');
  }
  
  // Collect all sections from completions
  for (const completion of completions) {
    addSectionsForRecord(completion, sectionsToLoad, 'completion');
  }
  
  console.log(`[Daily] Batch loading properties for ${sectionsToLoad.size} unique sections`);
  
  // Build OR query for all sections
  const sectionQueries = Array.from(sectionsToLoad).map(key => {
    const [section, township, range, meridian] = key.split('|');
    return `AND({SEC}="${section}",{TWN}="${township}",{RNG}="${range}",{MERIDIAN}="${meridian}",{Status}="Active")`;
  });
  
  // Chunk if needed (Airtable formula limit)
  const CHUNK_SIZE = 50;
  const propertyMap = new Map();
  
  for (let i = 0; i < sectionQueries.length; i += CHUNK_SIZE) {
    const chunk = sectionQueries.slice(i, i + CHUNK_SIZE);
    const formula = `OR(${chunk.join(',')})`;
    
    const properties = await queryAirtable(env, env.AIRTABLE_PROPERTIES_TABLE, formula);
    
    // Index by section key
    for (const prop of properties) {
      const key = `${prop.fields.SEC}|${prop.fields.TWN}|${prop.fields.RNG}|${prop.fields.MERIDIAN}`;
      if (!propertyMap.has(key)) {
        propertyMap.set(key, []);
      }
      propertyMap.get(key).push(prop);
    }
  }
  
  console.log(`[Daily] Loaded ${propertyMap.size} sections with properties`);
  return propertyMap;
}

/**
 * Add all sections that need to be checked for a record
 * @param {Object} record - Permit or completion record
 * @param {Set} sectionsSet - Set to add sections to
 * @param {string} recordType - 'permit' or 'completion'
 */
function addSectionsForRecord(record, sectionsSet, recordType = 'permit') {
  // Normalize section
  const normalizedSection = normalizeSection(record.Section);
  
  // Surface location
  const surfaceKey = `${normalizedSection}|${record.Township}|${record.Range}|${record.PM || 'IM'}`;
  sectionsSet.add(surfaceKey);
  
  // Add adjacent sections for surface
  const adjacents = getAdjacentSections(parseInt(normalizedSection, 10), record.Township, record.Range);
  for (const adj of adjacents) {
    sectionsSet.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${record.PM || 'IM'}`);
  }
  
  // Bottom hole handling
  if (recordType === 'permit') {
    // Check for horizontal/directional wells in permits
    const isHorizontal = record.Drill_Type === 'HH' || record.Drill_Type === 'DH';
    
    if (isHorizontal && record.PBH_Section && record.PBH_Township && record.PBH_Range) {
      const bhKey = `${normalizeSection(record.PBH_Section)}|${record.PBH_Township}|${record.PBH_Range}|${record.PM || 'IM'}`;
      sectionsSet.add(bhKey);
      
      // Add adjacent sections for BH
      const bhAdjacents = getAdjacentSections(parseInt(normalizeSection(record.PBH_Section), 10), record.PBH_Township, record.PBH_Range);
      for (const adj of bhAdjacents) {
        sectionsSet.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${record.PM || 'IM'}`);
      }
    }
  } else if (recordType === 'completion') {
    // Check for horizontal wells in completions - look for BH fields
    const isHorizontal = record.Drill_Type === 'HORIZONTAL HOLE' || 
                        record.Drill_Type === 'HH' ||
                        record.Location_Type_Sub === 'HH';
    
    if (isHorizontal && record.BH_Section && record.BH_Township && record.BH_Range) {
      const bhKey = `${normalizeSection(record.BH_Section)}|${record.BH_Township}|${record.BH_Range}|${record.BH_PM || record.PM || 'IM'}`;
      sectionsSet.add(bhKey);
      
      // Add adjacent sections for BH
      const bhAdjacents = getAdjacentSections(parseInt(normalizeSection(record.BH_Section), 10), record.BH_Township, record.BH_Range);
      for (const adj of bhAdjacents) {
        sectionsSet.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${record.BH_PM || record.PM || 'IM'}`);
      }
    }
  }
}

/**
 * Find matches in the property map for a given location
 * @param {Object} location - Section, Township, Range, Meridian
 * @param {Map} propertyMap - Pre-loaded property map
 * @param {Object} env - Worker environment
 * @returns {Array} - Matching properties with user info
 */
async function findMatchesInMap(location, propertyMap, env) {
  const { section, township, range, meridian } = location;
  const normalizedSec = normalizeSection(section);
  const effectiveMeridian = meridian || 'IM';
  
  const matches = [];
  const seenUsers = new Set();
  
  // Direct property matches
  const directKey = `${normalizedSec}|${township}|${range}|${effectiveMeridian}`;
  const directProperties = propertyMap.get(directKey) || [];
  
  for (const prop of directProperties) {
    const userIds = prop.fields.User;
    if (!userIds || userIds.length === 0) continue;
    
    const userId = userIds[0];
    if (seenUsers.has(userId)) continue;
    
    const user = await getUserById(userId, env);
    if (!user || user.fields.Status !== 'Active') continue;
    
    seenUsers.add(userId);
    matches.push({
      property: prop,
      user: {
        id: user.id,
        email: user.fields.Email,
        name: user.fields.Name
      },
      alertLevel: 'YOUR PROPERTY',
      matchedSection: `${normalizedSec}-${township}-${range}`
    });
  }
  
  // Adjacent section matches
  const adjacentSections = getAdjacentSections(parseInt(normalizedSec, 10), township, range);
  
  for (const adj of adjacentSections) {
    const adjKey = `${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${effectiveMeridian}`;
    const adjProperties = propertyMap.get(adjKey) || [];
    
    for (const prop of adjProperties) {
      // Only include if Monitor Adjacent is true
      if (!prop.fields['Monitor Adjacent']) continue;
      
      const userIds = prop.fields.User;
      if (!userIds || userIds.length === 0) continue;
      
      const userId = userIds[0];
      if (seenUsers.has(userId)) continue;
      
      const user = await getUserById(userId, env);
      if (!user || user.fields.Status !== 'Active') continue;
      
      seenUsers.add(userId);
      matches.push({
        property: prop,
        user: {
          id: user.id,
          email: user.fields.Email,
          name: user.fields.Name
        },
        alertLevel: 'ADJACENT SECTION',
        matchedSection: `${normalizeSection(prop.fields.SEC)}-${prop.fields.TWN}-${prop.fields.RNG}`,
        permitSection: `${normalizedSec}-${township}-${range}`
      });
    }
  }
  
  return matches;
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
    
    // Fetch and process Completions file
    const completions = await fetchOCCFile('completions', env);
    console.log(`[Daily] Fetched ${completions.length} completions`);
    
    // Batch load all properties we'll need to check
    const propertyMap = await batchLoadProperties(permits, completions, env);
    
    // Process permits with the property map
    for (const permit of permits) {
      try {
        await processPermit(permit, env, results, dryRun, propertyMap);
        results.permitsProcessed++;
      } catch (err) {
        console.error(`[Daily] Error processing permit ${permit.API_Number}:`, err);
        results.errors.push({ api: permit.API_Number, error: err.message });
      }
    }
    
    // Process completions with the property map
    for (const completion of completions) {
      try {
        await processCompletion(completion, env, results, dryRun, propertyMap);
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
async function processPermit(permit, env, results, dryRun = false, propertyMap = null) {
  const api10 = normalizeAPI(permit.API_Number);
  const activityType = mapApplicationType(permit.Application_Type);
  
  
  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // 1. Check property matches (surface location)
  const propertyMatches = propertyMap 
    ? await findMatchesInMap({
        section: permit.Section,
        township: permit.Township,
        range: permit.Range,
        meridian: permit.PM
      }, propertyMap, env)
    : await findMatchingProperties({
        section: permit.Section,
        township: permit.Township,
        range: permit.Range,
        meridian: permit.PM,
        county: permit.County
      }, env);
  
  
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
      const bhMatches = propertyMap
        ? await findMatchesInMap({
            section: permit.PBH_Section,
            township: permit.PBH_Township,
            range: permit.PBH_Range,
            meridian: permit.PM
          }, propertyMap, env)
        : await findMatchingProperties({
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
async function processCompletion(completion, env, results, dryRun = false, propertyMap = null) {
  // Similar logic to processPermit but for completions
  // Activity type will be "Well Completed"
  const api10 = normalizeAPI(completion.API_Number);
  
  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // Check if this is a horizontal well
  const isHorizontal = completion.Drill_Type === 'HORIZONTAL HOLE' || 
                      completion.Drill_Type === 'HH' ||
                      completion.Location_Type_Sub === 'HH';
  
  // 1. Check property matches (surface location)
  const propertyMatches = propertyMap
    ? await findMatchesInMap({
        section: completion.Section,
        township: completion.Township,
        range: completion.Range,
        meridian: completion.PM
      }, propertyMap, env)
    : await findMatchingProperties({
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
  
  // 2. For horizontal wells, also check bottom hole location
  if (isHorizontal && completion.BH_Section && completion.BH_Township && completion.BH_Range) {
    const bhMatches = propertyMap
      ? await findMatchesInMap({
          section: completion.BH_Section,
          township: completion.BH_Township,
          range: completion.BH_Range,
          meridian: completion.BH_PM || completion.PM
        }, propertyMap, env)
      : await findMatchingProperties({
          section: completion.BH_Section,
          township: completion.BH_Township,
          range: completion.BH_Range,
          meridian: completion.BH_PM || completion.PM,
          county: completion.County
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
    
    // Calculate horizontal well details if applicable
    let bhLocationStr = null;
    let isMultiSection = false;
    
    if (isHorizontal && completion.BH_Section && completion.BH_Township && completion.BH_Range) {
      const isDifferentSection = completion.Section !== completion.BH_Section ||
                                completion.Township !== completion.BH_Township ||
                                completion.Range !== completion.BH_Range;
      
      if (isDifferentSection) {
        isMultiSection = true;
        bhLocationStr = `S${normalizeSection(completion.BH_Section)} T${completion.BH_Township} R${completion.BH_Range}`;
      }
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
        // Horizontal well data
        isMultiSection: isMultiSection,
        bhLocation: bhLocationStr,
        lateralLength: completion.Length || completion.Lateral_Length || null,
        // Production data
        formationName: completion.Formation_Name,
        formationDepth: completion.Formation_Depth,
        ipGas: completion.Gas_MCF_Per_Day,
        ipOil: completion.Oil_BBL_Per_Day,
        ipWater: completion.Water_BBL_Per_Day,
        spudDate: completion.Spud,
        completionDate: completion.Well_Completion,
        firstProdDate: completion.First_Prod
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
