/**
 * Daily Monitor - Processes Intent to Drill and Completion files
 * OPTIMIZED: 
 *   1. Tracks processed APIs to skip re-processing 7-day window overlap
 *   2. Batch loads users instead of individual lookups
 *   3. Preloads recent alerts for O(1) dedup checking
 */

import { fetchOCCFile } from '../services/occ.js';
import { fetchWellCoordinates } from '../services/occGis.js';
import { findMatchingProperties, findMatchingWells } from '../services/matching.js';
import { 
  preloadRecentAlerts, 
  hasRecentAlertInSet, 
  createActivityLog, 
  updateActivityLog, 
  queryAirtable, 
  batchGetUsers 
} from '../services/airtable.js';
import { sendAlertEmail } from '../services/email.js';
import { normalizeSection, normalizeAPI } from '../utils/normalize.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';
// Operator lookups handled by contact-handler and weekly worker
import { getAdjacentSections } from '../utils/plss.js';

/**
 * Check if we're in dry-run mode
 */
function isDryRun(env) {
  return env.DRY_RUN === 'true' || env.DRY_RUN === true;
}

/**
 * OPTIMIZATION: Load set of already-processed API numbers from KV
 * Uses COMPLETIONS_CACHE with 8-day TTL to avoid reprocessing 7-day window overlap
 * @param {Object} env - Worker environment
 * @returns {Set<string>} - Set of "apiNumber|activityType" keys already processed
 */
async function loadProcessedAPIs(env) {
  try {
    const cached = await env.COMPLETIONS_CACHE.get('processed-apis', { type: 'json' });
    if (cached && cached.apis) {
      console.log(`[Daily] Loaded ${cached.apis.length} previously processed API keys`);
      return new Set(cached.apis);
    }
  } catch (err) {
    console.warn('[Daily] Failed to load processed APIs cache:', err.message);
  }
  return new Set();
}

/**
 * OPTIMIZATION: Save processed API numbers to KV
 * @param {Object} env - Worker environment
 * @param {Set<string>} processedSet - Set of processed "apiNumber|activityType" keys
 */
async function saveProcessedAPIs(env, processedSet) {
  try {
    const data = {
      apis: Array.from(processedSet),
      updatedAt: new Date().toISOString()
    };
    // 8-day TTL ensures we don't reprocess within the 7-day OCC window
    await env.COMPLETIONS_CACHE.put('processed-apis', JSON.stringify(data), {
      expirationTtl: 8 * 24 * 60 * 60 // 8 days in seconds
    });
    console.log(`[Daily] Saved ${processedSet.size} processed API keys to cache`);
  } catch (err) {
    console.warn('[Daily] Failed to save processed APIs cache:', err.message);
  }
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
 * OPTIMIZATION: Find matches using preloaded property map and batch-loaded users
 * @param {Object} location - Section, Township, Range, Meridian
 * @param {Map} propertyMap - Pre-loaded property map
 * @param {Map} userCache - Pre-loaded user cache
 * @param {Object} env - Worker environment (fallback only)
 * @returns {Array} - Matching properties with user info
 */
async function findMatchesInMap(location, propertyMap, userCache, env) {
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
    
    // Use cached user or skip if not in cache (user not active)
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
      // Only include if Monitor Adjacent is true
      if (!prop.fields['Monitor Adjacent']) continue;
      
      const userIds = prop.fields.User;
      if (!userIds || userIds.length === 0) continue;
      
      const userId = userIds[0];
      if (seenUsers.has(userId)) continue;
      
      // Use cached user or skip if not in cache
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
 * OPTIMIZATION: Collect all user IDs from properties for batch loading
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
    permitsSkippedAsProcessed: 0,
    completionsSkippedAsProcessed: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    matchesFound: [],
    errors: []
  };
  
  try {
    // OPTIMIZATION 1: Load already-processed APIs
    const processedAPIs = await loadProcessedAPIs(env);
    console.log(`[Daily] Starting with ${processedAPIs.size} previously processed API keys`);
    
    // Fetch OCC files
    const permits = await fetchOCCFile('itd', env);
    console.log(`[Daily] Fetched ${permits.length} permits from ITD file`);
    
    const completions = await fetchOCCFile('completions', env);
    console.log(`[Daily] Fetched ${completions.length} completions`);
    
    // Filter to only unprocessed records
    const newPermits = permits.filter(p => {
      const api = normalizeAPI(p.API_Number);
      const key = `${api}|permit`;
      if (processedAPIs.has(key)) {
        results.permitsSkippedAsProcessed++;
        return false;
      }
      return true;
    });
    
    let newCompletions = completions.filter(c => {
      const api = normalizeAPI(c.API_Number);
      // Include completion date in key to allow multiple zone completions
      const completionDate = c.Well_Completion || 'unknown';
      const key = `${api}|completion|${completionDate}`;
      if (processedAPIs.has(key)) {
        results.completionsSkippedAsProcessed++;
        return false;
      }
      return true;
    });
    
    console.log(`[Daily] After filtering: ${newPermits.length} new permits, ${newCompletions.length} new completions`);
    console.log(`[Daily] Skipped: ${results.permitsSkippedAsProcessed} permits, ${results.completionsSkippedAsProcessed} completions (already processed)`);
    
    // Check for and remove duplicate completions
    const completionAPIs = newCompletions.map(c => normalizeAPI(c.API_Number));
    const duplicateAPIs = completionAPIs.filter((api, index) => completionAPIs.indexOf(api) !== index);
    if (duplicateAPIs.length > 0) {
      console.log(`[Daily] WARNING: Duplicate completion APIs found:`, [...new Set(duplicateAPIs)]);
      
      // Deduplicate completions - keep only the first occurrence of each API
      const seenAPIs = new Set();
      const dedupedCompletions = newCompletions.filter(c => {
        const api = normalizeAPI(c.API_Number);
        if (seenAPIs.has(api)) {
          console.log(`[Daily] Removing duplicate completion for API ${api}`);
          return false;
        }
        seenAPIs.add(api);
        return true;
      });
      
      // Replace newCompletions with deduplicated array
      newCompletions = dedupedCompletions;
      console.log(`[Daily] After deduplication: ${newCompletions.length} unique completions`);
    }
    
    // If nothing new to process, we're done
    if (newPermits.length === 0 && newCompletions.length === 0) {
      console.log('[Daily] No new records to process');
      return results;
    }
    
    // OPTIMIZATION 2: Preload recent alerts for dedup checking
    const recentAlerts = await preloadRecentAlerts(env);
    
    // Batch load all properties we'll need to check (only for new records)
    const propertyMap = await batchLoadProperties(newPermits, newCompletions, env);
    
    // OPTIMIZATION 3: Batch load all users referenced in properties
    const userIds = collectUserIdsFromProperties(propertyMap);
    const userCache = await batchGetUsers(env, userIds);
    console.log(`[Daily] Batch loaded ${userCache.size} users for property matching`);
    
    // Process permits with the optimizations
    for (const permit of newPermits) {
      try {
        await processPermit(permit, env, results, dryRun, propertyMap, userCache, recentAlerts);
        results.permitsProcessed++;
        
        // Mark as processed
        const api = normalizeAPI(permit.API_Number);
        processedAPIs.add(`${api}|permit`);
      } catch (err) {
        console.error(`[Daily] Error processing permit ${permit.API_Number}:`, err);
        results.errors.push({ api: permit.API_Number, error: err.message });
      }
    }
    
    // Process completions with the optimizations
    for (const completion of newCompletions) {
      try {
        await processCompletion(completion, env, results, dryRun, propertyMap, userCache, recentAlerts);
        results.completionsProcessed++;
        
        // Mark as processed with date to allow multiple zone completions
        const api = normalizeAPI(completion.API_Number);
        const completionDate = completion.Well_Completion || 'unknown';
        processedAPIs.add(`${api}|completion|${completionDate}`);
      } catch (err) {
        console.error(`[Daily] Error processing completion ${completion.API_Number}:`, err);
        results.errors.push({ api: completion.API_Number, error: err.message });
      }
    }
    
    // Save updated processed APIs
    await saveProcessedAPIs(env, processedAPIs);
    
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
async function processPermit(permit, env, results, dryRun = false, propertyMap = null, userCache = null, recentAlerts = null) {
  const api10 = normalizeAPI(permit.API_Number);
  const activityType = mapApplicationType(permit.Application_Type);
  
  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // 1. Check property matches (surface location)
  const propertyMatches = propertyMap && userCache
    ? await findMatchesInMap({
        section: permit.Section,
        township: permit.Township,
        range: permit.Range,
        meridian: permit.PM
      }, propertyMap, userCache, env)
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
      const bhMatches = propertyMap && userCache
        ? await findMatchesInMap({
            section: permit.PBH_Section,
            township: permit.PBH_Township,
            range: permit.PBH_Range,
            meridian: permit.PM
          }, propertyMap, userCache, env)
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
  
  // 4. Fetch well coordinates for map link generation
  let wellData = null;
  let mapLink = null;
  
  // Always try to fetch coordinates for map link
  wellData = await fetchWellCoordinates(api10, env);
  mapLink = getMapLinkFromWellData(wellData);
  if (mapLink) {
    console.log(`[Daily] Generated map link for permit ${api10}`);
  } else {
    console.log(`[Daily] No coordinates found for permit ${api10}`);
  }
  
  // 5. Send alerts (with deduplication check using preloaded set)
  for (const alert of alertsToSend) {
    // OPTIMIZATION: Use preloaded alert set instead of individual queries
    const alreadyAlerted = recentAlerts 
      ? hasRecentAlertInSet(recentAlerts, api10, activityType, alert.user.id)
      : false; // Fallback: don't skip if no preloaded data
    
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
    
    // Skip operator phone lookup - handled by contact-handler and weekly worker
    let operatorPhone = null;
    
    // Record match for dry-run logging
    results.matchesFound.push({
      activityType,
      wellName,
      api: api10,
      userEmail: alert.user.email,
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
    
    // Create activity log entry
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
      mapLink: mapLink || "", // Always include map link
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
        mapLink: mapLink || null,
        drillType: permit.Drill_Type,
        apiNumber: api10,
        wellType: wellData?.welltype || null,
        userId: alert.user.id,
        // Additional permit data
        approvalDate: permit.Approval_Date,
        expireDate: permit.Expire_Date,
        // Bottom hole location for directional wells
        bhSection: permit.PBH_Section,
        bhTownship: permit.PBH_Township,
        bhRange: permit.PBH_Range,
        // Horizontal well data
        isMultiSection: false
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
async function processCompletion(completion, env, results, dryRun = false, propertyMap = null, userCache = null, recentAlerts = null) {
  const api10 = normalizeAPI(completion.API_Number);
  
  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // Check if this is a horizontal well
  const isHorizontal = completion.Drill_Type === 'HORIZONTAL HOLE' || 
                      completion.Drill_Type === 'HH' ||
                      completion.Location_Type_Sub === 'HH';
  
  // 1. Check property matches (surface location)
  const propertyMatches = propertyMap && userCache
    ? await findMatchesInMap({
        section: completion.Section,
        township: completion.Township,
        range: completion.Range,
        meridian: completion.PM
      }, propertyMap, userCache, env)
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
    const bhMatches = propertyMap && userCache
      ? await findMatchesInMap({
          section: completion.BH_Section,
          township: completion.BH_Township,
          range: completion.BH_Range,
          meridian: completion.BH_PM || completion.PM
        }, propertyMap, userCache, env)
      : await findMatchingProperties({
          section: completion.BH_Section,
          township: completion.BH_Township,
          range: completion.BH_Range,
          meridian: completion.BH_PM || completion.PM,
          county: completion.County
        }, env);
    
    for (const match of bhMatches) {
      // Avoid duplicate alerts to same user with same alert level
      if (!alertsToSend.some(a => 
        a.user.email === match.user.email && 
        a.alertLevel === match.alertLevel
      )) {
        alertsToSend.push({
          user: match.user,
          alertLevel: match.alertLevel,
          matchedLocation: match.matchedSection,
          reason: 'bottom_hole_location'
        });
      }
    }
  }
  
  // 3. Check tracked wells
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
  
  // 4. Fetch well coordinates for map link generation
  let wellData = null;
  let mapLink = null;
  
  // Always try to fetch coordinates for map link
  wellData = await fetchWellCoordinates(api10, env);
  mapLink = getMapLinkFromWellData(wellData);
  if (mapLink) {
    console.log(`[Daily] Generated map link for completion ${api10}`);
  } else {
    console.log(`[Daily] No coordinates found for completion ${api10}`);
  }
  
  // 5. Send alerts
  if (alertsToSend.length > 1) {
    console.log(`[Daily] Completion ${api10} has ${alertsToSend.length} alerts for user ${alertsToSend[0].user.email}:`);
    alertsToSend.forEach((a, i) => {
      console.log(`  ${i+1}. Alert Level: ${a.alertLevel}, Reason: ${a.reason}, Location: ${a.matchedLocation}`);
    });
  }
  for (const alert of alertsToSend) {
    // OPTIMIZATION: Use preloaded alert set
    const alreadyAlerted = recentAlerts 
      ? hasRecentAlertInSet(recentAlerts, api10, 'Well Completed', alert.user.id)
      : false;
    
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
    const operator = completion.Operator_Name || completion.Operator;
    
    // Skip operator phone lookup - handled by contact-handler and weekly worker
    let operatorPhone = null;
    
    // Record match for dry-run logging
    results.matchesFound.push({
      activityType: 'Well Completed',
      wellName,
      api: api10,
      userEmail: alert.user.email,
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
    
    // Include map link for all completions
    const activityData = {
      wellName,
      apiNumber: api10,
      activityType: 'Well Completed',
      operator,
      operatorPhone,
      alertLevel: alert.alertLevel,
      sectionTownshipRange: location,
      county: completion.County,
      occLink: null, // Completions don't have IMAGE_URL field
      mapLink: mapLink || "", // Always include map link
      userId: alert.user.id,
      // Include completion date to differentiate multiple zone completions
      notes: completion.Well_Completion ? `Completion Date: ${completion.Well_Completion}` : null
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
        occLink: null, // Completions don't have IMAGE_URL field
        mapLink: mapLink || null,
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
        pumpingFlowing: completion.Pumping_Flowing || null,
        spudDate: completion.Spud,
        completionDate: completion.Well_Completion,
        firstProdDate: completion.First_Prod
      });
      
      // Email sent successfully - update activity log
      await updateActivityLog(env, activityRecord.id, { 'Email Sent': true });
      console.log(`[Daily] Email sent and activity updated for ${alert.user.email} on ${api10}`);
    } catch (emailError) {
      console.error(`[Daily] Failed to send email to ${alert.user.email}: ${emailError.message}`);
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
