/**
 * Weekly Monitor - Processes operator transfers and status changes
 */

import { fetchOCCFile } from '../services/occ.js';
import { fetchWellCoordinates } from '../services/occGis.js';
import { findMatchingProperties, findMatchingWells } from '../services/matching.js';
import { hasRecentAlert, createActivityLog } from '../services/airtable.js';
import { sendAlertEmail } from '../services/email.js';
import { normalizeAPI, normalizeOperator } from '../utils/normalize.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';

/**
 * Main weekly monitoring function
 * @param {Object} env - Worker environment bindings
 * @returns {Object} - Processing results
 */
export async function runWeeklyMonitor(env) {
  console.log('[Weekly] Starting weekly monitor run');
  
  const results = {
    transfersProcessed: 0,
    statusChanges: 0,
    alertsSent: 0,
    errors: []
  };
  
  try {
    // Fetch and process Well Transfers file
    const transfers = await fetchOCCFile('transfers', env);
    console.log(`[Weekly] Fetched ${transfers.length} transfers`);
    
    for (const transfer of transfers) {
      try {
        await processTransfer(transfer, env, results);
        results.transfersProcessed++;
      } catch (err) {
        console.error(`[Weekly] Error processing transfer ${transfer.API_Number}:`, err);
        results.errors.push({ api: transfer.API_Number, error: err.message });
      }
    }
    
    // TODO: Add RBDMS status change detection if needed
    // This would involve comparing current status against cached previous status
    
  } catch (err) {
    console.error('[Weekly] Fatal error:', err);
    throw err;
  }
  
  console.log(`[Weekly] Completed. Transfers: ${results.transfersProcessed}, Alerts: ${results.alertsSent}`);
  return results;
}

/**
 * Process a single transfer record
 */
async function processTransfer(transfer, env, results) {
  const api10 = normalizeAPI(transfer.API_Number);
  
  // Skip if operators are effectively the same
  const prevOp = normalizeOperator(transfer.Previous_Operator);
  const newOp = normalizeOperator(transfer.New_Operator);
  if (prevOp === newOp) {
    console.log(`[Weekly] Skipping transfer ${api10} - operators match after normalization`);
    return;
  }
  
  const alertsToSend = [];
  
  // Check property matches
  const propertyMatches = await findMatchingProperties({
    section: transfer.Section,
    township: transfer.Township,
    range: transfer.Range,
    meridian: transfer.PM,
    county: transfer.County
  }, env);
  
  for (const match of propertyMatches) {
    alertsToSend.push({
      user: match.user,
      alertLevel: match.alertLevel,
      matchedLocation: match.matchedSection
    });
  }
  
  // Check tracked wells
  const wellMatches = await findMatchingWells(api10, env);
  for (const match of wellMatches) {
    if (!alertsToSend.some(a => a.user.email === match.user.email)) {
      alertsToSend.push({
        user: match.user,
        alertLevel: 'TRACKED WELL',
        matchedLocation: `API: ${api10}`
      });
    }
  }
  
  // Fetch well coordinates for map link if we have alerts
  let wellData = null;
  let mapLink = null;
  if (alertsToSend.length > 0) {
    wellData = await fetchWellCoordinates(api10, env);
    mapLink = getMapLinkFromWellData(wellData);
    if (mapLink) {
      console.log(`[Weekly] Generated map link for transfer ${api10}`);
    }
  }
  
  // Send alerts
  for (const alert of alertsToSend) {
    const alreadyAlerted = await hasRecentAlert(env, alert.user.email, api10, 'Operator Transfer');
    if (alreadyAlerted) continue;
    
    // Use well name from GIS API if available
    const wellName = wellData?.well_name 
      ? (wellData.well_num && !wellData.well_name.includes(wellData.well_num) 
          ? `${wellData.well_name} ${wellData.well_num}`.trim()
          : wellData.well_name)
      : transfer.Well_Name || '';
    
    const activityData = {
      wellName,
      apiNumber: api10,
      activityType: 'Operator Transfer',
      operator: transfer.New_Operator,
      previousOperator: transfer.Previous_Operator,
      alertLevel: alert.alertLevel,
      sectionTownshipRange: `S${transfer.Section} T${transfer.Township} R${transfer.Range}`,
      county: transfer.County,
      previousValue: transfer.Previous_Operator,
      newValue: transfer.New_Operator,
      mapLink: mapLink,
      userId: alert.user.id
    };
    
    await createActivityLog(env, activityData);
    await sendAlertEmail(env, {
      to: alert.user.email,
      userName: alert.user.name,
      alertLevel: alert.alertLevel,
      activityType: 'Operator Transfer',
      wellName: activityData.wellName,
      operator: transfer.New_Operator,
      previousOperator: transfer.Previous_Operator,
      location: activityData.sectionTownshipRange,
      county: transfer.County,
      mapLink: mapLink,
      apiNumber: api10,
      wellType: wellData?.welltype || null,
      userId: alert.user.id
    });
    
    results.alertsSent++;
  }
}
