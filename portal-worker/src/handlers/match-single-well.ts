/**
 * Handler for matching a single well against all user's properties
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById, fetchAllAirtableRecords } from '../services/airtable.js';
import {
  PROPERTIES_TABLE,
  WELLS_TABLE,
  LINK_FIELDS,
  processProperty,
  processWell,
  checkMatch,
  extractFullWellName,
  getLinksForWell,
  createLinksInBatches
} from '../utils/property-well-matching.js';
import type { Env } from '../types/env.js';

/**
 * Match a single well against all user's properties
 */
export async function handleMatchSingleWell(wellId: string, request: Request, env: Env) {
  const startTime = Date.now();
  
  try {
    // Authenticate user
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userId = authUser.id;
    const organizationId = userRecord.fields.Organization?.[0];
    
    console.log(`[MatchSingleWell] Starting for well ${wellId}`);
    
    // Fetch the well
    const wellResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}/${wellId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (!wellResponse.ok) {
      if (wellResponse.status === 404) {
        return jsonResponse({ error: "Well not found" }, 404);
      }
      throw new Error(`Failed to fetch well: ${wellResponse.status}`);
    }
    
    const wellData = await wellResponse.json();
    
    // Verify ownership
    const wellUserId = wellData.fields.User?.[0];
    const wellOrgId = wellData.fields.Organization?.[0];
    
    if (wellUserId !== userId && (!organizationId || wellOrgId !== organizationId)) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    
    // Get existing links for this well (active and rejected)
    console.log(`[MatchSingleWell] Getting existing links for well`);
    const { active: linkedPropertyIds, rejected: rejectedPropertyIds } = await getLinksForWell(env, wellId);
    console.log(`[MatchSingleWell] Found ${linkedPropertyIds.size} active links, ${rejectedPropertyIds.size} rejected`);
    
    // Build property filter
    let propertiesFilter: string;
    
    if (organizationId) {
      // Get org name for filtering
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );
      
      const orgData = await orgResponse.json();
      const orgName = orgData.fields?.Name || '';
      propertiesFilter = `FIND('${orgName.replace(/'/g, "\\\'")}', ARRAYJOIN({Organization})) > 0`;
    } else {
      // Filter by user email
      const userEmail = authUser.email.replace(/'/g, "\\'");
      propertiesFilter = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
    }
    
    // Fetch all user's properties
    console.log(`[MatchSingleWell] Fetching user's properties`);
    const properties = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter);
    console.log(`[MatchSingleWell] Found ${properties.length} properties`);
    
    // Process the well
    const processedWell = processWell(wellData);
    
    // Check matches against all properties
    const newLinks = [];
    let skippedExisting = 0;
    let skippedRejected = 0;
    
    for (const propertyData of properties) {
      // Skip if already linked or rejected
      if (linkedPropertyIds.has(propertyData.id)) {
        skippedExisting++;
        continue;
      }
      if (rejectedPropertyIds.has(propertyData.id)) {
        skippedRejected++;
        continue;
      }
      
      // Process property and check for match
      const processedProperty = processProperty(propertyData);
      const matchReason = checkMatch(processedProperty, processedWell);
      
      if (matchReason) {
        // Create link name
        const wellName = extractFullWellName(wellData);
        const propLocation = processedProperty.location 
          ? `S${processedProperty.location.section}-T${processedProperty.location.township}-R${processedProperty.location.range}`
          : 'Unknown Location';
        const linkName = `${wellName} → ${propLocation}`;
        
        const linkRecord = {
          fields: {
            [LINK_FIELDS.LINK_NAME]: linkName,
            [LINK_FIELDS.PROPERTY]: [propertyData.id],
            [LINK_FIELDS.WELL]: [wellId],
            [LINK_FIELDS.LINK_TYPE]: 'Auto',
            [LINK_FIELDS.MATCH_REASON]: matchReason,
            [LINK_FIELDS.STATUS]: 'Active',
            [LINK_FIELDS.USER]: [userId]
          }
        };
        
        // Add organization if exists
        if (organizationId) {
          linkRecord.fields[LINK_FIELDS.ORGANIZATION] = [organizationId];
        }
        
        newLinks.push(linkRecord);
      }
    }
    
    console.log(`[MatchSingleWell] Found ${newLinks.length} new matches`);
    
    // Create links in batches
    const { created, failed } = await createLinksInBatches(env, newLinks);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    return jsonResponse({
      success: true,
      stats: {
        propertiesChecked: properties.length,
        linksCreated: created,
        linksFailed: failed,
        skippedExisting,
        skippedRejected
      },
      duration: `${duration}s`
    });
    
  } catch (error) {
    console.error('[MatchSingleWell] Error:', error);
    return jsonResponse({ 
      error: 'Failed to match well',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}