/**
 * Handler for matching a single property against all user's wells
 */

import { BASE_ID, ORGANIZATION_TABLE, PROPERTIES_TABLE, WELLS_TABLE } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById, fetchAllAirtableRecords } from '../services/airtable.js';
import { escapeAirtableValue } from '../utils/airtable-escape.js';
import {
  LINK_FIELDS,
  processProperty,
  processWell,
  checkMatch,
  extractFullWellName,
  getLinksForProperty,
  createLinksInBatches
} from '../utils/property-well-matching.js';
import type { Env } from '../types/env.js';

/**
 * Match a single property against all user's wells
 */
export async function handleMatchSingleProperty(propertyId: string, request: Request, env: Env) {
  console.log(`[MatchSingleProperty] Matching property: ${propertyId}`);
  
  const startTime = Date.now();
  
  try {
    // Authenticate user
    const authUser = await authenticateRequest(request, env);
    if (!authUser) {
      console.error('[MatchSingleProperty] Authentication failed');
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    
    // Get full user record
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userId = authUser.id;
    const organizationId = userRecord.fields.Organization?.[0];
    
    // Fetch the property
    const propertyResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}/${propertyId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (!propertyResponse.ok) {
      if (propertyResponse.status === 404) {
        return jsonResponse({ error: "Property not found" }, 404);
      }
      throw new Error(`Failed to fetch property: ${propertyResponse.status}`);
    }
    
    const propertyData = await propertyResponse.json();
    
    // Verify ownership
    const propertyUserId = propertyData.fields.User?.[0];
    const propertyOrgId = propertyData.fields.Organization?.[0];
    
    if (propertyUserId !== userId && (!organizationId || propertyOrgId !== organizationId)) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    
    // Get existing links for this property (active and rejected)
    const { active: linkedWellIds, rejected: rejectedWellIds } = await getLinksForProperty(env, propertyId);
    
    // Build well filter
    let wellsFilter: string;
    
    if (organizationId) {
      // Get org name for filtering
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );

      if (!orgResponse.ok) {
        throw new Error(`Failed to fetch organization: ${orgResponse.status}`);
      }

      const orgData = await orgResponse.json();
      const orgName = orgData.fields?.Name || '';
      wellsFilter = `FIND('${escapeAirtableValue(orgName)}', ARRAYJOIN({Organization})) > 0`;
    } else {
      // Filter by user email
      const userEmail = escapeAirtableValue(authUser.email);
      wellsFilter = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
    }
    
    const wells = await fetchAllAirtableRecords(env, WELLS_TABLE, wellsFilter);
    
    // Process the property
    const processedProperty = processProperty(propertyData);
    
    // Check matches against all wells
    const newLinks = [];
    let skippedExisting = 0;
    let skippedRejected = 0;
    
    for (const wellData of wells) {
      // Skip if already linked or rejected
      if (linkedWellIds.has(wellData.id)) {
        skippedExisting++;
        continue;
      }
      if (rejectedWellIds.has(wellData.id)) {
        skippedRejected++;
        continue;
      }
      
      // Process well and check for match
      const processedWell = processWell(wellData);
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
            [LINK_FIELDS.PROPERTY]: [propertyId],
            [LINK_FIELDS.WELL]: [wellData.id],
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
    
    // Create links in batches
    const { created, failed } = await createLinksInBatches(env, newLinks);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    return jsonResponse({
      success: true,
      stats: {
        wellsChecked: wells.length,
        linksCreated: created,
        linksFailed: failed,
        skippedExisting,
        skippedRejected
      },
      duration: `${duration}s`
    });
    
  } catch (error) {
    console.error('[MatchSingleProperty] Error:', error);
    return jsonResponse({ 
      error: 'Failed to match property',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}