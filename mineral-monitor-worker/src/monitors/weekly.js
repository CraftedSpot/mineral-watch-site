/**
 * Weekly Monitor - Processes operator transfers and status changes
 * OPTIMIZED:
 *   1. Tracks processed transfer APIs to skip re-processing
 *   2. Batch loads properties for all transfers upfront
 *   3. Batch loads users instead of individual lookups
 *   4. Preloads recent alerts for O(1) dedup checking
 */

import { fetchOCCFile } from '../services/occ.js';
import { getCoordinatesWithFallback } from '../utils/coordinates.js';
import { findMatchingWells } from '../services/matching.js';
import {
  preloadRecentAlerts,
  hasRecentAlertInSet,
  userWantsAlert,
  getUserById
} from '../services/airtable.js';
import { isUserOverPlanLimit } from '../services/d1.js';
import { getAdjacentSections } from '../utils/plss.js';
import { sendBatchedEmails } from '../services/emailBatch.js';
import { normalizeAPI, normalizeOperator, normalizeSection } from '../utils/normalize.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';
import { checkAllWellStatuses } from '../services/rbdmsStatus.js';

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
 * Find property matches using preloaded map and user cache
 * @param {Object} location - Section, Township, Range, Meridian
 * @param {Map} propertyMap - Pre-loaded property map
 * @param {Map} userCache - Pre-loaded user cache
 * @returns {Array} - Matching properties with user info
 */
function findMatchesInMap(location, propertyMap, userCache) {
  const { section, township, range, meridian, county } = location;
  const normalizedSec = normalizeSection(section);
  // Default meridian to IM, but use CM for panhandle counties (Cimarron, Texas, Beaver)
  const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
  const effectiveMeridian = meridian ||
    (county && panhandleCounties.includes(county.toUpperCase()) ? 'CM' : 'IM');
  
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
export async function runWeeklyMonitor(env, options = {}) {
  console.log('[Weekly] Starting weekly monitor run');

  const isTestMode = !!options.testApi;

  // KV-based mutex: prevent concurrent cron runs from duplicating alerts
  const LOCK_KEY = 'cron:weekly-monitor:lock';
  const LOCK_TTL_SECONDS = 720;
  if (!isTestMode) {
    try {
      const existing = await env.MINERAL_CACHE.get(LOCK_KEY);
      if (existing) {
        console.log('[Weekly] Another instance already running, skipping');
        return { skipped: true, reason: 'concurrent_lock' };
      }
      await env.MINERAL_CACHE.put(LOCK_KEY, JSON.stringify({ startedAt: Date.now() }), {
        expirationTtl: LOCK_TTL_SECONDS
      });
    } catch (lockErr) {
      console.warn('[Weekly] Lock check failed, proceeding anyway:', lockErr.message);
    }
  }

  const results = {
    transfersProcessed: 0,
    transfersSkippedAsProcessed: 0,
    transfersSkippedSameOperator: 0,
    statusChanges: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    errors: [],
    testMode: false,
    testResults: null
  };
  // Cache plan limit checks per run to avoid repeated D1 queries
  const planLimitCache = new Map();

  try {
    // Test mode: simulate a transfer for a specific API
    if (options.testApi) {
      console.log(`[Weekly] TEST MODE: Simulating transfer for API ${options.testApi}`);
      results.testMode = true;
      
      // Create a fake transfer record
      const testTransfer = {
        'API Number': options.testApi,
        'EventDate': new Date().toISOString(),
        'FromOperatorName': 'TEST PREVIOUS OPERATOR LLC',
        'ToOperatorName': 'TEST NEW OPERATOR INC',
        'ToOperatorPhone': '(555) 123-4567',
        'WellName': `Test Well for ${options.testApi}`,
        'WellNum': '#1H',
        'Section': '1',
        'Township': '1N',
        'Range': '1W',
        'PM': 'IM',
        'County': 'TEST'
      };
      
      // Process just this test transfer
      const recentAlerts = await preloadRecentAlerts(env);
      results.testResults = await processTransfer(testTransfer, env, results, recentAlerts, planLimitCache);
      results.transfersProcessed = 1;
      
      console.log(`[Weekly] TEST MODE complete. Alerts sent: ${results.alertsSent}`);
      return results;
    }
    
    // Test mode: simulate a status change for a specific API
    if (options.testStatusChangeApi) {
      console.log(`[Weekly] TEST MODE: Simulating status change for API ${options.testStatusChangeApi}`);
      results.testMode = true;
      
      // Run status check with test options
      const statusResults = await checkAllWellStatuses(env, options);
      
      // Merge results
      results.wellsChecked = statusResults.wellsChecked;
      results.statusChanges = statusResults.statusChanges;
      results.alertsSent = statusResults.alertsSent;
      results.errors = statusResults.errors;
      results.testDetails = statusResults.testDetails;
      
      console.log(`[Weekly] STATUS TEST MODE complete. Alerts sent: ${results.alertsSent}`);
      return results;
    }
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
    
    // OPTIMIZATION: Preload recent alerts for dedup
    let recentAlerts;
    try {
      recentAlerts = await preloadRecentAlerts(env);
    } catch (err) {
      console.warn('[Weekly] Failed to preload recent alerts, continuing without dedup:', err.message);
      recentAlerts = null;
    }
    
    // Process each transfer - match by API Number against Client Wells
    for (const transfer of newTransfers) {
      try {
        await processTransfer(transfer, env, results, recentAlerts, planLimitCache);
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
    
    // Check all tracked wells for status changes
    console.log('[Weekly] Starting RBDMS status check...');
    const statusResults = await checkAllWellStatuses(env, {
      testStatusChangeApi: options.testStatusChangeApi,
      testNewStatus: options.testNewStatus
    });
    
    // Merge status check results
    results.wellsChecked = statusResults.wellsChecked;
    results.statusChanges = statusResults.statusChanges;
    results.alertsSent += statusResults.alertsSent;
    results.errors.push(...statusResults.errors);
    
  } catch (err) {
    console.error('[Weekly] Fatal error:', err);
    if (!isTestMode) {
      try { await env.MINERAL_CACHE.delete(LOCK_KEY); } catch (_) {}
    }
    throw err;
  }

  console.log(`[Weekly] Completed. Transfers: ${results.transfersProcessed}, Status Changes: ${results.statusChanges || 0}, Total Alerts: ${results.alertsSent}, Skipped: ${results.alertsSkipped}`);

  // Release lock
  if (!isTestMode) {
    try { await env.MINERAL_CACHE.delete(LOCK_KEY); } catch (_) {}
  }

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
async function processTransfer(transfer, env, results, recentAlerts, planLimitCache = new Map()) {
  // Use correct column names from OCC file
  const api10 = normalizeAPI(transfer['API Number']);
  const previousOperator = transfer.FromOperatorName;
  const newOperator = transfer.ToOperatorName;
  const newOperatorPhone = transfer.ToOperatorPhone;
  const wellName = transfer.WellName || '';
  const wellNum = transfer.WellNum || '';
  
  let alertsToSend = [];
  const testDetails = results.testMode ? {
    api: api10,
    wellMatches: [],
    alertsSent: [],
    errors: []
  } : null;
  
  // Check if any users are tracking this well by API Number
  // Transfers are well-level events - we match by API Number against Client Wells table
  const wellMatches = await findMatchingWells(api10, env);
  
  if (testDetails) {
    testDetails.wellMatches = wellMatches.map(m => ({
      wellName: m.well.fields['Well Name'],
      wellStatus: m.well.fields['Status'],
      userEmail: m.user.email,
      userName: m.user.name,
      viaOrganization: m.viaOrganization || null
    }));
  }
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
    // Build a minimal record for coordinate fallback
    const transferRecord = {
      API_Number: api10,
      Section: transfer.SECTION || transfer.Section,
      Township: transfer.TOWNSHIP || transfer.Township, 
      Range: transfer.RANGE || transfer.Range,
      PM: transfer.PM || 'IM',
      County: transfer.COUNTY || transfer.County
    };
    
    // Use coordinate fallback system to ensure map links for tracked well transfers
    const coordResult = await getCoordinatesWithFallback(api10, transferRecord, env);
    wellData = coordResult.wellData;
    
    if (coordResult.coordinates) {
      // Ensure wellData has coordinates for map link generation
      if (!wellData) {
        wellData = {};
      }
      if (!wellData.sh_lat || !wellData.sh_lon) {
        wellData.sh_lat = coordResult.coordinates.latitude;
        wellData.sh_lon = coordResult.coordinates.longitude;
        wellData.well_name = wellData.well_name || `API ${api10}`;
        wellData.api = api10;
      }
      
      mapLink = getMapLinkFromWellData(wellData);
      console.log(`[Weekly] Generated map link for tracked well transfer ${api10} using ${coordResult.source} coordinates`);
    } else {
      console.log(`[Weekly] WARNING: No coordinates available for tracked well transfer ${api10} - no map link generated`);
    }
  }
  
  // Build display well name
  const displayWellName = wellData?.well_name 
    ? (wellData.well_num && !wellData.well_name.includes(wellData.well_num) 
        ? `${wellData.well_name} ${wellData.well_num}`.trim()
        : wellData.well_name)
    : (wellNum && !wellName.includes(wellNum) ? `${wellName} ${wellNum}`.trim() : wellName);
  
  // Test mode email filtering
  const approvedTestEmails = ['photog12@gmail.com', 'mrsprice518@gmail.com'];
  
  if (results.testMode) {
    console.log(`[Test Mode] Would notify ${alertsToSend.length} users, filtering to test emails only`);
    
    // Log all users who would be notified
    for (const alert of alertsToSend) {
      if (!approvedTestEmails.includes(alert.user.email)) {
        console.log(`[Test Mode] Skipping: ${alert.user.email}`);
      } else {
        console.log(`[Test Mode] Sending to: ${alert.user.email}`);
      }
    }
    
    // Filter to only approved test emails
    alertsToSend = alertsToSend.filter(alert => approvedTestEmails.includes(alert.user.email));
    
    if (alertsToSend.length === 0) {
      console.log('[Test Mode] No approved test emails found in notification list');
      if (testDetails) {
        testDetails.skippedUsers = testDetails.alertsSent;
        testDetails.alertsSent = [];
      }
      return testDetails;
    }
  }
  
  // Parse county - OCC format is "015-CADDO", we want just "CADDO"
  const countyDisplay = transfer.County?.includes('-')
    ? transfer.County.split('-')[1]
    : transfer.County;

  // Build userAlertMap for digest queue (same format as daily/docket)
  const userAlertMap = new Map();

  for (const alert of alertsToSend) {
    // Dedup: skip if already alerted recently
    const alreadyAlerted = hasRecentAlertInSet(recentAlerts, api10, 'Operator Transfer', alert.user.id);
    if (alreadyAlerted) {
      console.log(`[Weekly] Skipping duplicate alert for ${alert.user.email} on ${api10}`);
      results.alertsSkipped = (results.alertsSkipped || 0) + 1;
      continue;
    }

    // Check user preferences
    const fullUser = await getUserById(env, alert.user.id);
    if (fullUser && !userWantsAlert(fullUser, 'Operator Transfer')) {
      console.log(`[Weekly] Skipped alert for ${alert.user.email} - user disabled operator transfer alerts`);
      results.alertsSkipped++;
      continue;
    }

    // Check plan limits
    const wkPlan = fullUser?.fields?.Plan || 'Free';
    if (!planLimitCache.has(alert.user.id)) {
      planLimitCache.set(alert.user.id, await isUserOverPlanLimit(env, alert.user.id, wkPlan));
    }
    if (planLimitCache.get(alert.user.id)) {
      console.log(`[Weekly] Skipped alert for ${alert.user.email} - over ${wkPlan} plan limit`);
      results.alertsSkipped++;
      continue;
    }

    const includeMapLink = alert.reason === 'tracked_well';

    const alertData = {
      user: { id: alert.user.id, email: alert.user.email, name: alert.user.name },
      wellName: displayWellName,
      apiNumber: api10,
      activityType: 'Operator Transfer',
      operator: newOperator,
      previousOperator: previousOperator,
      alertLevel: alert.alertLevel,
      location: `S${normalizeSection(transfer.Section)} T${transfer.Township} R${transfer.Range}`,
      county: countyDisplay,
      mapLink: includeMapLink ? mapLink : null,
      organizationId: alert.organizationId || null
    };

    if (!userAlertMap.has(alert.user.id)) {
      userAlertMap.set(alert.user.id, []);
    }
    userAlertMap.get(alert.user.id).push(alertData);

    if (testDetails) {
      testDetails.alertsSent.push({
        email: alert.user.email,
        userName: alert.user.name,
        alertLevel: alert.alertLevel,
        viaOrganization: alert.viaOrganization || null
      });
    }
  }

  // Queue all transfer alerts for digest delivery
  if (userAlertMap.size > 0) {
    const dryRun = results.testMode;
    const batchResults = await sendBatchedEmails(env, userAlertMap, dryRun, { testMode: results.testMode });
    results.alertsSent += batchResults.alertsQueued;
    console.log(`[Weekly] Queued ${batchResults.alertsQueued} transfer alerts for digest delivery`);
  }

  return testDetails;
}
