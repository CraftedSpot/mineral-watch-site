/**
 * Weekly Monitor - Processes operator transfers and status changes
 * OPTIMIZED:
 *   1. Tracks processed transfer APIs to skip re-processing
 *   2. Batch loads properties for all transfers upfront
 *   3. Batch loads users instead of individual lookups
 *   4. Preloads recent alerts for O(1) dedup checking
 */

import { fetchOCCFile } from '../services/occ.js';
import { fetchWellCoordinates } from '../services/occGis.js';
import { findMatchingWells } from '../services/matching.js';
import { 
  preloadRecentAlerts, 
  hasRecentAlertInSet, 
  createActivityLog,
  updateActivityLog,
  queryAirtable,
  batchGetUsers
} from '../services/airtable.js';
import { sendAlertEmail } from '../services/email.js';
import { normalizeAPI, normalizeOperator, normalizeSection } from '../utils/normalize.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';
import { getAdjacentSections } from '../utils/plss.js';

/**
 * OPTIMIZATION: Load set of already-processed transfer API numbers from KV
 * @param {Object} env - Worker environment
 * @returns {Set<string>} - Set of API numbers already processed for transfers
 */
async function loadProcessedTransfers(env) {
  try {
    const cached = await env.COMPLETIONS_CACHE.get('processed-transfers', { type: 'json' });
    if (cached && cached.apis) {
      console.log(`[Weekly] Loaded ${cached.apis.length} previously processed transfer APIs`);
      return new Set(cached.apis);
    }
  } catch (err) {
    console.warn('[Weekly] Failed to load processed transfers cache:', err.message);
  }
  return new Set();
}

/**
 * OPTIMIZATION: Save processed transfer API numbers to KV
 * @param {Object} env - Worker environment
 * @param {Set<string>} processedSet - Set of processed API numbers
 */
async function saveProcessedTransfers(env, processedSet) {
  try {
    const data = {
      apis: Array.from(processedSet),
      updatedAt: new Date().toISOString()
    };
    // 8-day TTL to cover the 7-day OCC window
    await env.COMPLETIONS_CACHE.put('processed-transfers', JSON.stringify(data), {
      expirationTtl: 8 * 24 * 60 * 60
    });
    console.log(`[Weekly] Saved ${processedSet.size} processed transfer APIs to cache`);
  } catch (err) {
    console.warn('[Weekly] Failed to save processed transfers cache:', err.message);
  }
}

/**
 * OPTIMIZATION: Batch load all properties for sections in transfers
 * @param {Array} transfers - Array of transfer records
 * @param {Object} env - Worker environment
 * @returns {Map} - Map of section keys to property arrays
 */
async function batchLoadPropertiesForTransfers(transfers, env) {
  const sectionsToLoad = new Set();
  
  for (const transfer of transfers) {
    if (!transfer.Section || !transfer.Township || !transfer.Range) continue;
    
    const normalizedSection = normalizeSection(transfer.Section);
    const meridian = transfer.PM || 'IM';
    
    // Add the transfer's section
    sectionsToLoad.add(`${normalizedSection}|${transfer.Township}|${transfer.Range}|${meridian}`);
    
    // Add adjacent sections
    const adjacents = getAdjacentSections(parseInt(normalizedSection, 10), transfer.Township, transfer.Range);
    for (const adj of adjacents) {
      sectionsToLoad.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${meridian}`);
    }
  }
  
  console.log(`[Weekly] Batch loading properties for ${sectionsToLoad.size} unique sections`);
  
  if (sectionsToLoad.size === 0) {
    return new Map();
  }
  
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
  
  console.log(`[Weekly] Loaded ${propertyMap.size} sections with properties`);
  return propertyMap;
}

/**
 * Collect all user IDs from properties for batch loading
 * @param {Map} propertyMap - Pre-loaded property map
 * @returns {string[]} - Array of unique user IDs
 */
function collectUserIdsFromProperties(propertyMap) {
  const userIds = new Set();
  for (const properties of propertyMap.values()) {
    for (const prop of properties) {
      const propUserIds = prop.fields.User || [];
      for (const id of propUserIds) {
        userIds.add(id);
      }
    }
  }
  return Array.from(userIds);
}

/**
 * Find property matches using preloaded map and user cache
 * @param {Object} location - Section, Township, Range, Meridian
 * @param {Map} propertyMap - Pre-loaded property map
 * @param {Map} userCache - Pre-loaded user cache
 * @returns {Array} - Matching properties with user info
 */
function findMatchesInMap(location, propertyMap, userCache) {
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
    
    const user = userCache.get(userId);
    if (!user) continue;
    
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
      if (!prop.fields['Monitor Adjacent']) continue;
      
      const userIds = prop.fields.User;
      if (!userIds || userIds.length === 0) continue;
      
      const userId = userIds[0];
      if (seenUsers.has(userId)) continue;
      
      const user = userCache.get(userId);
      if (!user) continue;
      
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
 * Main weekly monitoring function
 * @param {Object} env - Worker environment bindings
 * @returns {Object} - Processing results
 */
export async function runWeeklyMonitor(env) {
  console.log('[Weekly] Starting weekly monitor run');
  
  const results = {
    transfersProcessed: 0,
    transfersSkippedAsProcessed: 0,
    transfersSkippedSameOperator: 0,
    statusChanges: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    errors: []
  };
  
  try {
    // OPTIMIZATION 1: Load already-processed transfer APIs
    const processedTransfers = await loadProcessedTransfers(env);
    console.log(`[Weekly] Starting with ${processedTransfers.size} previously processed transfers`);
    
    // Fetch transfers file
    const transfers = await fetchOCCFile('transfers', env);
    console.log(`[Weekly] Fetched ${transfers.length} transfers from OCC file`);
    
    // Filter to unprocessed transfers and valid operator changes
    // Note: OCC uses 'API Number' (with space), 'FromOperatorName', 'ToOperatorName'
    const newTransfers = transfers.filter(transfer => {
      const api10 = normalizeAPI(transfer['API Number']);
      
      // Skip if no valid API
      if (!api10) {
        console.log(`[Weekly] Skipping transfer with missing API`);
        return false;
      }
      
      // Skip already processed
      if (processedTransfers.has(api10)) {
        results.transfersSkippedAsProcessed++;
        return false;
      }
      
      // Skip if operators are effectively the same
      const prevOp = normalizeOperator(transfer.FromOperatorName);
      const newOp = normalizeOperator(transfer.ToOperatorName);
      if (prevOp === newOp) {
        results.transfersSkippedSameOperator++;
        // Still mark as processed so we don't check again
        processedTransfers.add(api10);
        return false;
      }
      
      return true;
    });
    
    console.log(`[Weekly] After filtering: ${newTransfers.length} new transfers to process`);
    console.log(`[Weekly] Skipped: ${results.transfersSkippedAsProcessed} already processed, ${results.transfersSkippedSameOperator} same operator`);
    
    if (newTransfers.length === 0) {
      console.log('[Weekly] No new transfers to process');
      await saveProcessedTransfers(env, processedTransfers);
      return results;
    }
    
    // OPTIMIZATION 2: Preload recent alerts for dedup
    const recentAlerts = await preloadRecentAlerts(env);
    
    // OPTIMIZATION 3: Batch load properties for all transfers
    const propertyMap = await batchLoadPropertiesForTransfers(newTransfers, env);
    
    // OPTIMIZATION 4: Batch load all users
    const userIds = collectUserIdsFromProperties(propertyMap);
    const userCache = await batchGetUsers(env, userIds);
    console.log(`[Weekly] Batch loaded ${userCache.size} users for property matching`);
    
    // Process each transfer
    for (const transfer of newTransfers) {
      try {
        await processTransfer(transfer, env, results, propertyMap, userCache, recentAlerts);
        results.transfersProcessed++;
        
        // Mark as processed
        const api10 = normalizeAPI(transfer['API Number']);
        processedTransfers.add(api10);
      } catch (err) {
        console.error(`[Weekly] Error processing transfer ${transfer['API Number']}:`, err);
        results.errors.push({ api: transfer['API Number'], error: err.message });
      }
    }
    
    // Save updated processed transfers
    await saveProcessedTransfers(env, processedTransfers);
    
    // TODO: Add RBDMS status change detection if needed
    
  } catch (err) {
    console.error('[Weekly] Fatal error:', err);
    throw err;
  }
  
  console.log(`[Weekly] Completed. Transfers: ${results.transfersProcessed}, Alerts: ${results.alertsSent}, Skipped: ${results.alertsSkipped}`);
  return results;
}

/**
 * Process a single transfer record
 * 
 * OCC Transfer File Column Mapping:
 *   API Number (not API_Number)
 *   FromOperatorName (not Previous_Operator)
 *   ToOperatorName (not New_Operator)
 *   ToOperatorPhone, FromOperatorPhone
 *   WellName, WellNum
 *   EventDate (not Transfer_Date)
 *   Section, Township, Range, PM, County
 */
async function processTransfer(transfer, env, results, propertyMap, userCache, recentAlerts) {
  // Use correct column names from OCC file
  const api10 = normalizeAPI(transfer['API Number']);
  const previousOperator = transfer.FromOperatorName;
  const newOperator = transfer.ToOperatorName;
  const newOperatorPhone = transfer.ToOperatorPhone;
  const wellName = transfer.WellName || '';
  const wellNum = transfer.WellNum || '';
  
  const alertsToSend = [];
  
  // Check property matches using preloaded data
  if (transfer.Section && transfer.Township && transfer.Range) {
    const propertyMatches = findMatchesInMap({
      section: transfer.Section,
      township: transfer.Township,
      range: transfer.Range,
      meridian: transfer.PM
    }, propertyMap, userCache);
    
    for (const match of propertyMatches) {
      alertsToSend.push({
        user: match.user,
        alertLevel: match.alertLevel,
        matchedLocation: match.matchedSection,
        reason: match.alertLevel === 'YOUR PROPERTY' ? 'property_location' : 'adjacent_section'
      });
    }
  }
  
  // Check tracked wells (still individual query - tracked wells are sparse)
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
  
  // Fetch well coordinates for map link only for tracked well alerts
  let wellData = null;
  let mapLink = null;
  const hasTrackedWellAlerts = alertsToSend.some(alert => alert.reason === 'tracked_well');
  
  if (hasTrackedWellAlerts) {
    wellData = await fetchWellCoordinates(api10, env);
    mapLink = getMapLinkFromWellData(wellData);
    if (mapLink) {
      console.log(`[Weekly] Generated map link for tracked well transfer ${api10}`);
    }
  }
  
  // Build display well name
  const displayWellName = wellData?.well_name 
    ? (wellData.well_num && !wellData.well_name.includes(wellData.well_num) 
        ? `${wellData.well_name} ${wellData.well_num}`.trim()
        : wellData.well_name)
    : (wellNum && !wellName.includes(wellNum) ? `${wellName} ${wellNum}`.trim() : wellName);
  
  // Send alerts with dedup check
  for (const alert of alertsToSend) {
    // OPTIMIZATION: Use preloaded alert set
    const alreadyAlerted = hasRecentAlertInSet(recentAlerts, api10, 'Operator Transfer', alert.user.id);
    
    if (alreadyAlerted) {
      console.log(`[Weekly] Skipping duplicate alert for ${alert.user.email} on ${api10}`);
      results.alertsSkipped = (results.alertsSkipped || 0) + 1;
      continue;
    }
    
    // Only include map link for tracked well alerts
    const includeMapLink = alert.reason === 'tracked_well';
    
    // Parse county - OCC format is "015-CADDO", we want just "CADDO"
    const countyDisplay = transfer.County?.includes('-') 
      ? transfer.County.split('-')[1] 
      : transfer.County;
    
    const activityData = {
      wellName: displayWellName,
      apiNumber: api10,
      activityType: 'Operator Transfer',
      operator: newOperator,
      operatorPhone: newOperatorPhone,
      previousOperator: previousOperator,
      alertLevel: alert.alertLevel,
      sectionTownshipRange: `S${normalizeSection(transfer.Section)} T${transfer.Township} R${transfer.Range}`,
      county: countyDisplay,
      previousValue: previousOperator,
      newValue: newOperator,
      mapLink: includeMapLink ? mapLink : null,
      userId: alert.user.id
    };
    
    const activityRecord = await createActivityLog(env, activityData);
    
    try {
      await sendAlertEmail(env, {
        to: alert.user.email,
        userName: alert.user.name,
        alertLevel: alert.alertLevel,
        activityType: 'Operator Transfer',
        wellName: displayWellName,
        operator: newOperator,
        operatorPhone: newOperatorPhone,
        previousOperator: previousOperator,
        location: activityData.sectionTownshipRange,
        county: countyDisplay,
        mapLink: includeMapLink ? mapLink : null,
        apiNumber: api10,
        wellType: wellData?.welltype || null,
        userId: alert.user.id
      });
      
      // Email sent successfully - update activity log
      await updateActivityLog(env, activityRecord.id, { 'Email Sent': true });
      console.log(`[Weekly] Email sent and activity updated for ${alert.user.email} on ${api10}`);
    } catch (emailError) {
      console.error(`[Weekly] Failed to send email to ${alert.user.email}: ${emailError.message}`);
      // Activity log remains with Email Sent = false
    }
    
    results.alertsSent++;
  }
}
