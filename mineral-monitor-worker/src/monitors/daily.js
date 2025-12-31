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
import { sendBatchedEmails } from '../services/emailBatch.js';
import { normalizeSection, normalizeAPI } from '../utils/normalize.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';
import { getCoordinatesWithFallback } from '../utils/coordinates.js';
import { getAdjacentSections, getExtendedAdjacentSections } from '../utils/plss.js';
// Operator lookups handled by contact-handler and weekly worker

/**
 * Simple delay function for rate limiting Airtable operations
 * @param {number} ms - Milliseconds to delay
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
import { 
  upsertWellLocation, 
  createWellLocationFromPermit, 
  createWellLocationFromCompletion 
} from '../services/wellLocations.js';
import { calculateHorizontalPath } from '../utils/horizontalPath.js';
import {
  createStatewideActivity,
  createStatewideActivityFromPermit,
  createStatewideActivityFromCompletion,
  cleanupOldStatewideRecords
} from '../services/statewideActivity.js';
import { checkWellStatusChange } from '../services/statusChange.js';

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
  
  // Determine if this is a horizontal well
  let isHorizontal = false;
  let isConfirmedVertical = false;
  
  if (recordType === 'permit') {
    // Check if explicitly marked as straight hole (vertical)
    isConfirmedVertical = record.Drill_Type === 'SH' || record.Drill_Type === 'STRAIGHT HOLE';
    
    // If not confirmed vertical, assume it could be horizontal
    isHorizontal = !isConfirmedVertical;
    
    if (isConfirmedVertical) {
      console.log(`[Permit] ${record.API_Number} confirmed vertical (Drill_Type: ${record.Drill_Type})`);
    } else {
      console.log(`[Permit] ${record.API_Number} assumed horizontal (Drill_Type: ${record.Drill_Type || 'NULL'})`);
    }
  }
  
  // Add adjacent sections for surface
  // For permits: SH = 3x3, everything else = 5x5 (unless they have BH data)
  // For completions: use standard 3x3 grid
  if (recordType === 'permit' && !isConfirmedVertical && (!record.PBH_Section || !record.PBH_Township || !record.PBH_Range)) {
    // Horizontal permit without BH data - use extended radius
    const extendedAdjacents = getExtendedAdjacentSections(parseInt(normalizedSection, 10), record.Township, record.Range);
    for (const adj of extendedAdjacents) {
      sectionsSet.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${record.PM || 'IM'}`);
    }
  } else {
    // Standard 3x3 adjacents for vertical wells and completions with precise data
    const adjacents = getAdjacentSections(parseInt(normalizedSection, 10), record.Township, record.Range);
    for (const adj of adjacents) {
      sectionsSet.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${record.PM || 'IM'}`);
    }
  }
  
  // Bottom hole handling
  if (recordType === 'permit') {
    // For any permit with BH data (regardless of drill type), calculate the path
    if (record.PBH_Section && record.PBH_Township && record.PBH_Range) {
      // Horizontal permit WITH proposed BH data - calculate the actual path
      const surfaceLocation = {
        section: normalizedSection,
        township: record.Township,
        range: record.Range
      };
      
      const proposedBHLocation = {
        section: normalizeSection(record.PBH_Section),
        township: record.PBH_Township,
        range: record.PBH_Range
      };
      
      // Calculate all sections along the proposed horizontal path
      const horizontalPath = calculateHorizontalPath(surfaceLocation, proposedBHLocation);
      
      // Add all sections in the path
      for (const pathSection of horizontalPath) {
        const pathKey = `${normalizeSection(pathSection.section)}|${pathSection.township}|${pathSection.range}|${record.PM || 'IM'}`;
        sectionsSet.add(pathKey);
        
        // Also add adjacent sections for each section in the path
        const pathAdjacents = getAdjacentSections(parseInt(pathSection.section, 10), pathSection.township, pathSection.range);
        for (const adj of pathAdjacents) {
          sectionsSet.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${record.PM || 'IM'}`);
        }
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
 * @param {Object} options - Options for test mode
 * @returns {Object} - Processing results
 */
export async function runDailyMonitor(env, options = {}) {
  const dryRun = isDryRun(env);
  const isTestMode = !!(options.testPermitApi || options.testCompletionApi);
  console.log(`[Daily] Starting daily monitor run ${dryRun ? '(DRY RUN)' : '(LIVE)'}${isTestMode ? ' - TEST MODE' : ''}`);
  
  const results = {
    permitsProcessed: 0,
    completionsProcessed: 0,
    permitsSkippedAsProcessed: 0,
    completionsSkippedAsProcessed: 0,
    statusChanges: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    matchesFound: [],
    errors: [],
    testMode: isTestMode,
    testDetails: isTestMode ? { permits: [], completions: [] } : null
  };
  
  // Map to collect alerts by user for batching
  const userAlertMap = new Map();
  
  try {
    // OPTIMIZATION 1: Load already-processed APIs
    const processedAPIs = await loadProcessedAPIs(env);
    console.log(`[Daily] Starting with ${processedAPIs.size} previously processed API keys`);
    
    let permits, completions;
    
    // Test mode: create test permits/completions
    if (isTestMode) {
      permits = [];
      completions = [];
      
      if (options.testPermitApi) {
        console.log(`[Daily] TEST MODE: Creating test permit for API ${options.testPermitApi}`);
        permits.push({
          API_Number: options.testPermitApi,
          Well_Name: `TEST WELL ${options.testPermitApi}`,
          Well_Number: '1H',
          Entity_Name: 'TEST OPERATOR LLC',
          Application_Type: 'DR',
          Drill_Type: options.drillType || 'HH',
          Section: '1',
          Township: '1N',
          Range: '1W',
          PM: 'IM',
          County: 'TEST',
          Approval_Date: new Date().toISOString(),
          Expire_Date: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
          PBH_Section: options.pbhSection || '2',
          PBH_Township: options.pbhTownship || '1N',
          PBH_Range: options.pbhRange || '1W',
          IMAGE_URL: 'https://test.example.com/permit.pdf'
        });
      }
      
      if (options.testCompletionApi) {
        console.log(`[Daily] TEST MODE: Creating test completion for API ${options.testCompletionApi}`);
        completions.push({
          API_Number: options.testCompletionApi,
          Well_Name: `TEST WELL ${options.testCompletionApi}`,
          Well_Number: '1H',
          Operator_Name: 'TEST OPERATOR LLC',
          Drill_Type: 'HORIZONTAL HOLE',
          Section: '1',
          Township: '1N',
          Range: '1W',
          PM: 'IM',
          County: 'TEST',
          BH_Section: options.bhSection || '2',
          BH_Township: options.bhTownship || '1N',
          BH_Range: options.bhRange || '1W',
          Well_Completion: new Date().toISOString(),
          Formation_Name: 'TEST FORMATION',
          Gas_MCF_Per_Day: '1000',
          Oil_BBL_Per_Day: '500',
          Water_BBL_Per_Day: '100'
        });
      }
    } else {
      // Normal operation: fetch from OCC
      permits = await fetchOCCFile('itd', env);
      console.log(`[Daily] Fetched ${permits.length} permits from ITD file`);
      
      completions = await fetchOCCFile('completions', env);
      console.log(`[Daily] Fetched ${completions.length} completions`);
    }
    
    // Filter to only unprocessed records (skip cache check in test mode)
    const newPermits = permits.filter(p => {
      const api = normalizeAPI(p.API_Number);
      const key = `${api}|permit`;
      if (!isTestMode && processedAPIs.has(key)) {
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
      if (!isTestMode && processedAPIs.has(key)) {
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
    for (let i = 0; i < newPermits.length; i++) {
      const permit = newPermits[i];
      try {
        await processPermit(permit, env, results, dryRun, propertyMap, userCache, recentAlerts, userAlertMap, isTestMode);
        results.permitsProcessed++;
        
        // Mark as processed
        const api = normalizeAPI(permit.API_Number);
        processedAPIs.add(`${api}|permit`);
        
        // Add 200ms delay between processing permits to avoid Airtable rate limits
        // (statewide activity and well location creates)
        if (i < newPermits.length - 1) {
          await delay(200);
        }
      } catch (err) {
        console.error(`[Daily] Error processing permit ${permit.API_Number}:`, err);
        results.errors.push({ api: permit.API_Number, error: err.message });
      }
    }
    
    // Process completions with the optimizations
    for (let i = 0; i < newCompletions.length; i++) {
      const completion = newCompletions[i];
      try {
        await processCompletion(completion, env, results, dryRun, propertyMap, userCache, recentAlerts, userAlertMap, isTestMode);
        results.completionsProcessed++;
        
        // Mark as processed with date to allow multiple zone completions
        const api = normalizeAPI(completion.API_Number);
        const completionDate = completion.Well_Completion || 'unknown';
        processedAPIs.add(`${api}|completion|${completionDate}`);
        
        // Add 200ms delay between processing completions to avoid Airtable rate limits
        // (statewide activity and well location creates)
        if (i < newCompletions.length - 1) {
          await delay(200);
        }
      } catch (err) {
        console.error(`[Daily] Error processing completion ${completion.API_Number}:`, err);
        results.errors.push({ api: completion.API_Number, error: err.message });
      }
    }
    
    // Save updated processed APIs (skip in test mode to allow re-testing)
    if (!isTestMode) {
      await saveProcessedAPIs(env, processedAPIs);
    }
    
    // Send batched emails
    if (userAlertMap.size > 0) {
      console.log(`[Daily] Sending batched emails to ${userAlertMap.size} users`);
      const emailResults = await sendBatchedEmails(env, userAlertMap, dryRun, { 
        testMode: isTestMode 
      });
      results.alertsSent = emailResults.alertsSent;
      console.log(`[Daily] Sent ${emailResults.emailsSent} emails containing ${emailResults.alertsSent} alerts`);
      
      if (isTestMode && emailResults.skippedUsers.length > 0) {
        console.log(`[Daily] Test mode - skipped ${emailResults.skippedUsers.length} non-test users`);
        if (results.testDetails) {
          results.testDetails.skippedUsers = emailResults.skippedUsers;
        }
      }
      
      if (emailResults.errors.length > 0) {
        console.error('[Daily] Email errors:', emailResults.errors);
        results.errors.push(...emailResults.errors);
      }
    }
    
  } catch (err) {
    console.error('[Daily] Fatal error:', err);
    throw err;
  }
  
  console.log(`[Daily] Completed. Permits: ${results.permitsProcessed}, Completions: ${results.completionsProcessed}, Status Changes: ${results.statusChanges}, Alerts: ${results.alertsSent}, Skipped: ${results.alertsSkipped}`);
  
  if (dryRun && results.matchesFound.length > 0) {
    console.log(`[Daily] DRY RUN - Matches found:`);
    results.matchesFound.forEach(m => {
      console.log(`  - ${m.activityType}: ${m.wellName} (${m.api}) → ${m.userEmail} [${m.alertLevel}]`);
    });
  }
  
  // Run cleanup for old statewide activity records (90 days)
  if (!dryRun) {
    try {
      const cleanupResult = await cleanupOldStatewideRecords(env, 90);
      if (cleanupResult.success) {
        console.log(`[Daily] Cleaned up ${cleanupResult.deletedCount} old statewide activity records`);
        results.statewideCleanup = cleanupResult.deletedCount;
      } else {
        console.error(`[Daily] Failed to cleanup old records: ${cleanupResult.error}`);
      }
    } catch (err) {
      console.error(`[Daily] Error during statewide cleanup:`, err.message);
    }
  }
  
  return results;
}

/**
 * Process a single permit record
 */
async function processPermit(permit, env, results, dryRun = false, propertyMap = null, userCache = null, recentAlerts = null, userAlertMap = null, isTestMode = false) {
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
  
  // 2. For permits with BH data, check the entire path
  // For permits: assume horizontal unless explicitly marked as SH (Straight Hole)
  const isConfirmedVertical = permit.Drill_Type === 'SH' || permit.Drill_Type === 'STRAIGHT HOLE';
  
  // If permit has BH data, calculate the path regardless of drill type
  if (permit.PBH_Section && permit.PBH_Township && permit.PBH_Range) {
      // Horizontal permit WITH proposed BH data - check the entire path
      const surfaceLocation = {
        section: permit.Section,
        township: permit.Township,
        range: permit.Range
      };
      
      const proposedBHLocation = {
        section: permit.PBH_Section,
        township: permit.PBH_Township,
        range: permit.PBH_Range
      };
      
      // Calculate all sections along the proposed horizontal path
      const horizontalPath = calculateHorizontalPath(surfaceLocation, proposedBHLocation);
      
      // Check for property matches along the entire path
      for (const pathSection of horizontalPath) {
        const pathMatches = propertyMap && userCache
          ? await findMatchesInMap({
              section: pathSection.section,
              township: pathSection.township,
              range: pathSection.range,
              meridian: permit.PM
            }, propertyMap, userCache, env)
          : await findMatchingProperties({
              section: pathSection.section,
              township: pathSection.township,
              range: pathSection.range,
              meridian: permit.PM,
              county: permit.County
            }, env);
        
        for (const match of pathMatches) {
          // Avoid duplicate alerts to same user
          if (!alertsToSend.some(a => a.user.email === match.user.email)) {
            const isInPath = pathSection.section === permit.Section && 
                           pathSection.township === permit.Township && 
                           pathSection.range === permit.Range;
            const isBH = pathSection.section === permit.PBH_Section && 
                        pathSection.township === permit.PBH_Township && 
                        pathSection.range === permit.PBH_Range;
            
            let reason = 'horizontal_path';
            if (isInPath) reason = 'surface_location';
            else if (isBH) reason = 'bottom_hole_location';
            
            alertsToSend.push({
              user: match.user,
              alertLevel: match.alertLevel,
              matchedLocation: match.matchedSection,
              reason: reason
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
  
  // 4. Fetch well coordinates with fallback system
  let wellData = null;
  let mapLink = null;
  let coordinates = null;
  let coordinateSource = null;
  
  // Use fallback coordinate system: OCC GIS -> TRS calculation -> County center
  const coordResult = await getCoordinatesWithFallback(api10, permit, env);
  wellData = coordResult.wellData;
  coordinates = coordResult.coordinates;
  coordinateSource = coordResult.source;
  
  if (coordinates) {
    // Create a wellData-like object for map link generation if we only have calculated coords
    const mapWellData = wellData || {
      sh_lat: coordinates.latitude,
      sh_lon: coordinates.longitude,
      well_name: `${permit.Well_Name || ''} ${permit.Well_Number || ''}`.trim(),
      api: api10
    };
    
    // Ensure the wellData has coordinates for map link
    if (!mapWellData.sh_lat || !mapWellData.sh_lon) {
      mapWellData.sh_lat = coordinates.latitude;
      mapWellData.sh_lon = coordinates.longitude;
    }
    
    mapLink = getMapLinkFromWellData(mapWellData);
    console.log(`[Daily] Generated map link for permit ${api10} using ${coordinateSource} coordinates`);
  } else {
    console.log(`[Daily] No coordinates available for permit ${api10} from any source`);
  }
  
  // Check for well status changes
  if (wellData && wellData.wellstatus) {
    const statusResult = await checkWellStatusChange(api10, wellData, env);
    if (statusResult.hasChange) {
      console.log(`[Daily] Status change detected for ${api10}: ${statusResult.previousStatus} → ${statusResult.currentStatus}`);
      results.statusChanges = (results.statusChanges || 0) + 1;
      results.alertsSent += statusResult.alertsSent;
    }
  }
  
  // Step 1: ALWAYS write to Statewide Activity, even without coordinates
  try {
    // Create wellData-like object with coordinates if available
    const activityWellData = wellData || {};
    if (coordinates) {
      activityWellData.sh_lat = coordinates.latitude;
      activityWellData.sh_lon = coordinates.longitude;
      console.log(`[Daily] Creating statewide activity for permit ${api10} with ${coordinateSource} coordinates`);
    } else {
      console.log(`[Daily] Creating statewide activity for permit ${api10} WITHOUT coordinates - will use Section-Township-Range location`);
      results.coordinateFailures = (results.coordinateFailures || 0) + 1;
    }
    
    const activityData = createStatewideActivityFromPermit(permit, activityWellData, mapLink);
    const activityResult = await createStatewideActivity(env, activityData);
    if (activityResult.success) {
      console.log(`[Daily] Statewide activity created for permit ${api10}${coordinates ? ` with ${coordinateSource} coordinates` : ' using TRS location only'}`);
    } else {
      console.error(`[Daily] Failed to store statewide activity for permit ${api10}: ${activityResult.error}`);
    }
  } catch (err) {
    console.error(`[Daily] Error storing statewide activity for permit ${api10}:`, err.message);
  }
  
  // Step 2: If user matches exist, ALSO write to Well Locations
  try {
    if (alertsToSend.length > 0) {
      // Use wellData with fallback coordinates if available
      const locationWellData = coordinates ? {
        ...(wellData || {}),
        sh_lat: coordinates.latitude,
        sh_lon: coordinates.longitude
      } : wellData;
      
      const locationData = await createWellLocationFromPermit(permit, locationWellData, mapLink, env);
      const locationResult = await upsertWellLocation(env, locationData);
      if (locationResult.success) {
        console.log(`[Daily] Well location ${locationResult.action} for permit ${api10} (user-related)`);
      } else {
        console.error(`[Daily] Failed to store well location for permit ${api10}: ${locationResult.error}`);
      }
    }
  } catch (err) {
    console.error(`[Daily] Error storing well location for permit ${api10}:`, err.message);
  }
  
  // 5. Send alerts (with deduplication check using preloaded set)
  for (const alert of alertsToSend) {
    // OPTIMIZATION: Use preloaded alert set instead of individual queries (skip in test mode)
    const alreadyAlerted = !isTestMode && recentAlerts 
      ? hasRecentAlertInSet(recentAlerts, api10, activityType, alert.user.id)
      : false; // Fallback: don't skip if no preloaded data or test mode
    
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
      userId: alert.user.id,
      // Check various possible formation fields in permit data
      formation: permit.Target_Zone || permit.Target_Formation || 
                 permit.Zone_Of_Significance || permit.Formation ||
                 permit.Target || null,
      // Track coordinate source for user awareness
      coordinateSource: coordinateSource
    };
    
    // Don't create activity log here - it will be created during batch email sending
    
    // Collect alert for batch sending
    if (userAlertMap) {
      const alertData = {
        user: alert.user,
        alertLevel: alert.alertLevel,
        activityType: activityType,
        wellName: activityData.wellName,
        operator: permit.Entity_Name,
        operatorPhone: operatorPhone,
        location: activityData.sectionTownshipRange,
        county: permit.County,
        occLink: permit.IMAGE_URL || null,
        mapLink: mapLink || null,
        drillType: permit.Drill_Type,
        apiNumber: api10,
        wellType: wellData?.welltype || null,
        formation: activityData.formation,
        coordinateSource: coordinateSource,
        // Additional permit data
        approvalDate: permit.Approval_Date,
        expireDate: permit.Expire_Date,
        // Bottom hole location for directional wells
        bhSection: permit.PBH_Section,
        bhTownship: permit.PBH_Township,
        bhRange: permit.PBH_Range,
        // Horizontal well data
        isMultiSection: false
      };
      
      // Add alert to user's alert list
      const userId = alert.user.id;
      if (!userAlertMap.has(userId)) {
        userAlertMap.set(userId, []);
      }
      userAlertMap.get(userId).push(alertData);
      
      console.log(`[Permit] Queued alert for ${alert.user.email} for ${wellName}`);
    } else {
      // Fallback to immediate sending (for other monitors)
      const activityRecord = await createActivityLog(env, activityData);
      
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
        
        await updateActivityLog(env, activityRecord.id, { 'Email Sent': true });
        console.log(`[Daily] Email sent and activity updated for ${alert.user.email} on ${api10}`);
      } catch (emailError) {
        console.error(`[Daily] Failed to send email to ${alert.user.email}: ${emailError.message}`);
        // Activity log remains with Email Sent = false
      }
    }
    
    results.alertsSent++;
  }
}

/**
 * Process a single completion record
 */
async function processCompletion(completion, env, results, dryRun = false, propertyMap = null, userCache = null, recentAlerts = null, userAlertMap = null, isTestMode = false) {
  const api10 = normalizeAPI(completion.API_Number);
  
  // Try to get enhanced completion data from cache (if available)
  let enhancedFormation = null;
  try {
    const cached = await env.COMPLETIONS_CACHE.get(`well:${api10}`, { type: 'json' });
    if (cached && cached.formationName) {
      enhancedFormation = cached.formationName;
      console.log(`[Daily] Found enhanced formation data for ${api10}: ${enhancedFormation}`);
    }
  } catch (err) {
    console.log(`[Daily] No enhanced completion data found for ${api10}`);
  }
  
  // Collect all users who should be alerted
  const alertsToSend = [];
  
  // Check if this is a horizontal well
  // Check drill type fields
  const isHorizontalByType = completion.Drill_Type === 'HORIZONTAL HOLE' || 
                            completion.Drill_Type === 'HH' ||
                            completion.Location_Type_Sub === 'HH';
  
  // Check well name patterns (common horizontal well naming conventions)
  const wellName = completion.Well_Name || '';
  const isHorizontalByName = /\d+H$|\d+MH$|\d+HX$|\d+HXX$|\d+HM$|\d+HW$|\d+WH$|\d+XHM$|MXH$|HXH$|BXH$|SXH$|UXH$|LXH$|H\d+$|-H$|_H$/i.test(wellName);
  
  const isHorizontal = isHorizontalByType || isHorizontalByName;
  
  if (isHorizontalByName && !isHorizontalByType) {
    console.log(`[Daily] Detected horizontal well by name pattern: ${wellName} (${api10})`);
  }
  
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
  
  // 2. For horizontal wells, also check bottom hole location AND the path between
  if (isHorizontal && completion.BH_Section && completion.BH_Township && completion.BH_Range) {
    // First check bottom hole location
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
    
    // NEW: Check all sections along the horizontal path
    try {
      const surfaceLocation = {
        section: completion.Section,
        township: completion.Township,
        range: completion.Range
      };
      const bottomHoleLocation = {
        section: completion.BH_Section,
        township: completion.BH_Township,
        range: completion.BH_Range
      };
      
      const pathSections = calculateHorizontalPath(surfaceLocation, bottomHoleLocation);
      console.log(`[Daily] Horizontal well ${api10} passes through ${pathSections.length} sections`);
      
      // Check each section along the path for property matches
      for (const pathSection of pathSections) {
        // Skip if we already checked this section (surface or BH)
        if ((pathSection.section === completion.Section && 
             pathSection.township === completion.Township && 
             pathSection.range === completion.Range) ||
            (pathSection.section === completion.BH_Section && 
             pathSection.township === completion.BH_Township && 
             pathSection.range === completion.BH_Range)) {
          continue;
        }
        
        const pathMatches = propertyMap && userCache
          ? await findMatchesInMap({
              section: pathSection.section,
              township: pathSection.township,
              range: pathSection.range,
              meridian: completion.PM
            }, propertyMap, userCache, env)
          : await findMatchingProperties({
              section: pathSection.section,
              township: pathSection.township,
              range: pathSection.range,
              meridian: completion.PM,
              county: completion.County
            }, env);
        
        for (const match of pathMatches) {
          // Special alert level for horizontal path
          const pathAlertLevel = match.alertLevel === 'YOUR PROPERTY' 
            ? 'HORIZONTAL PATH THROUGH PROPERTY' 
            : 'HORIZONTAL PATH ADJACENT';
          
          if (!alertsToSend.some(a => 
            a.user.email === match.user.email && 
            a.matchedLocation === match.matchedSection
          )) {
            alertsToSend.push({
              user: match.user,
              alertLevel: pathAlertLevel,
              matchedLocation: match.matchedSection,
              reason: 'horizontal_path'
            });
          }
        }
      }
    } catch (err) {
      console.error(`[Daily] Error calculating horizontal path for ${api10}:`, err.message);
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
  
  // 4. Fetch well coordinates with fallback system
  let wellData = null;
  let mapLink = null;
  let coordinates = null;
  let coordinateSource = null;
  
  // Use fallback coordinate system: OCC GIS -> TRS calculation -> County center
  const coordResult = await getCoordinatesWithFallback(api10, completion, env);
  wellData = coordResult.wellData;
  coordinates = coordResult.coordinates;
  coordinateSource = coordResult.source;
  
  if (coordinates) {
    // Create a wellData-like object for map link generation if we only have calculated coords
    const mapWellData = wellData || {
      sh_lat: coordinates.latitude,
      sh_lon: coordinates.longitude,
      well_name: `${completion.Well_Name || ''} ${completion.Well_Number || ''}`.trim(),
      api: api10
    };
    
    // Ensure the wellData has coordinates for map link
    if (!mapWellData.sh_lat || !mapWellData.sh_lon) {
      mapWellData.sh_lat = coordinates.latitude;
      mapWellData.sh_lon = coordinates.longitude;
    }
    
    mapLink = getMapLinkFromWellData(mapWellData);
    console.log(`[Daily] Generated map link for completion ${api10} using ${coordinateSource} coordinates`);
  } else {
    console.log(`[Daily] No coordinates available for completion ${api10} from any source`);
  }
  
  // Check for well status changes
  if (wellData && wellData.wellstatus) {
    const statusResult = await checkWellStatusChange(api10, wellData, env);
    if (statusResult.hasChange) {
      console.log(`[Daily] Status change detected for ${api10}: ${statusResult.previousStatus} → ${statusResult.currentStatus}`);
      results.statusChanges = (results.statusChanges || 0) + 1;
      results.alertsSent += statusResult.alertsSent;
    }
  }
  
  // Step 1: ALWAYS write to Statewide Activity, even without coordinates
  try {
    // Create wellData-like object with coordinates if available
    const activityWellData = wellData || {};
    if (coordinates) {
      activityWellData.sh_lat = coordinates.latitude;
      activityWellData.sh_lon = coordinates.longitude;
      console.log(`[Daily] Creating statewide activity for completion ${api10} with ${coordinateSource} coordinates`);
    } else {
      console.log(`[Daily] Creating statewide activity for completion ${api10} WITHOUT coordinates - will use Section-Township-Range location`);
      results.coordinateFailures = (results.coordinateFailures || 0) + 1;
    }
    
    const activityData = createStatewideActivityFromCompletion(completion, activityWellData, mapLink);
    const activityResult = await createStatewideActivity(env, activityData);
    if (activityResult.success) {
      console.log(`[Daily] Statewide activity created for completion ${api10}${coordinates ? ` with ${coordinateSource} coordinates` : ' using TRS location only'}`);
    } else {
      console.error(`[Daily] Failed to store statewide activity for completion ${api10}: ${activityResult.error}`);
    }
  } catch (err) {
    console.error(`[Daily] Error storing statewide activity for completion ${api10}:`, err.message);
  }
  
  // Step 2: If user matches exist, ALSO write to Well Locations
  try {
    if (alertsToSend.length > 0) {
      // Use wellData with fallback coordinates if available
      const locationWellData = coordinates ? {
        ...(wellData || {}),
        sh_lat: coordinates.latitude,
        sh_lon: coordinates.longitude
      } : wellData;
      
      const locationData = await createWellLocationFromCompletion(completion, locationWellData, mapLink, env);
      const locationResult = await upsertWellLocation(env, locationData);
      if (locationResult.success) {
        console.log(`[Daily] Well location ${locationResult.action} for completion ${api10} (user-related)`);
      } else {
        console.error(`[Daily] Failed to store well location for completion ${api10}: ${locationResult.error}`);
      }
    }
  } catch (err) {
    console.error(`[Daily] Error storing well location for completion ${api10}:`, err.message);
  }
  
  // 5. Send alerts
  if (alertsToSend.length > 1) {
    console.log(`[Daily] Completion ${api10} has ${alertsToSend.length} alerts for user ${alertsToSend[0].user.email}:`);
    alertsToSend.forEach((a, i) => {
      console.log(`  ${i+1}. Alert Level: ${a.alertLevel}, Reason: ${a.reason}, Location: ${a.matchedLocation}`);
    });
  }
  for (const alert of alertsToSend) {
    // OPTIMIZATION: Use preloaded alert set (skip in test mode)
    const alreadyAlerted = !isTestMode && recentAlerts 
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
      notes: completion.Well_Completion ? `Completion Date: ${completion.Well_Completion}` : null,
      // Add formation data if available (prefer enhanced data from cache)
      formation: enhancedFormation || completion.Formation_Name || null,
      // Track coordinate source for user awareness
      coordinateSource: coordinateSource
    };
    
    // Don't create activity log here - it will be created during batch email sending
    
    // Collect alert for batch sending
    if (userAlertMap) {
      const alertData = {
        user: alert.user,
        alertLevel: alert.alertLevel,
        activityType: 'Well Completed',
        wellName: activityData.wellName,
        operator: activityData.operator,
        operatorPhone: operatorPhone,
        location: activityData.sectionTownshipRange,
        county: completion.County,
        occLink: null, // Completions don't have IMAGE_URL field
        mapLink: mapLink || null,
        apiNumber: api10,
        wellType: wellData?.welltype || null,
        formation: activityData.formation,
        coordinateSource: coordinateSource,
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
      };
      
      // Add alert to user's alert list
      const userId = alert.user.id;
      if (!userAlertMap.has(userId)) {
        userAlertMap.set(userId, []);
      }
      userAlertMap.get(userId).push(alertData);
      
      console.log(`[Completion] Queued alert for ${alert.user.email} for ${wellName}`);
    } else {
      // Fallback to immediate sending (for other monitors)
      const activityRecord = await createActivityLog(env, activityData);
      
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
        
        await updateActivityLog(env, activityRecord.id, { 'Email Sent': true });
        console.log(`[Daily] Email sent and activity updated for ${alert.user.email} on ${api10}`);
      } catch (emailError) {
        console.error(`[Daily] Failed to send email to ${alert.user.email}: ${emailError.message}`);
        // Activity log remains with Email Sent = false
      }
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
