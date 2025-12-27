/**
 * Property-Wells API Handlers
 * 
 * Handles API endpoints for managing property-well relationships
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Table names
const PROPERTIES_TABLE = '📍 Client Properties';
const WELLS_TABLE = '🛢️ Client Wells';
const LINKS_TABLE = '🔗 Property-Well Links';

/**
 * Get linked wells for a property
 */
export async function handleGetPropertyLinkedWells(propertyId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userOrgId = userRecord.fields.Organization?.[0];
    
    console.log(`[GetLinkedWells] Fetching linked wells for property ${propertyId}`);
    
    // First verify the user owns this property
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
    
    if (propertyUserId !== authUser.id && (!userOrgId || propertyOrgId !== userOrgId)) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    
    // Fetch ALL active links for this user/org, then filter in JS
    // Airtable's linked record filtering is unreliable, so we fetch all and filter locally
    let linksFilter: string;
    
    if (userOrgId) {
      // For org users, get the organization name first
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${userOrgId}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );
      
      const orgData = await orgResponse.json();
      const orgName = orgData.fields?.Name || '';
      
      linksFilter = `AND({Status} = 'Active', FIND('${orgName.replace(/'/g, "\\'")}', ARRAYJOIN({Organization})) > 0)`;
    } else {
      // For solo users, filter by user email
      linksFilter = `AND({Status} = 'Active', FIND('${authUser.email}', ARRAYJOIN({User})) > 0)`;
    }
    
    console.log(`[GetLinkedWells] Fetching all user links with filter: ${linksFilter}`);
    
    const linksResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}?filterByFormula=${encodeURIComponent(linksFilter)}&maxRecords=1000`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (!linksResponse.ok) {
      const errorText = await linksResponse.text();
      console.error(`[GetLinkedWells] Failed to fetch links: ${linksResponse.status} - ${errorText}`);
      throw new Error(`Failed to fetch links: ${linksResponse.status}`);
    }
    
    const allLinksData = await linksResponse.json();
    console.log(`[GetLinkedWells] Found ${allLinksData.records.length} total active links for user`);
    
    // Filter for this specific property in JavaScript
    const propertyLinks = allLinksData.records.filter((link: any) => {
      const linkedProperties = link.fields.Property || [];
      return linkedProperties.includes(propertyId);
    });
    
    console.log(`[GetLinkedWells] Found ${propertyLinks.length} links for property ${propertyId}`);
    const wells = [];
    
    // Fetch well details for each link
    for (const link of propertyLinks) {
      const wellId = link.fields.Well?.[0];
      if (!wellId) continue;
      
      const wellResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}/${wellId}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );
      
      if (wellResponse.ok) {
        const wellData = await wellResponse.json();
        const wellName = wellData.fields['Well Name'] || 'Unknown Well';
        const apiNumber = wellData.fields['API Number'] || '';
        const wellNumber = wellData.fields['Well Number'] || '';
        
        // Construct display name with API or well number for differentiation
        let displayName = wellName;
        if (wellNumber && !wellName.includes(wellNumber)) {
          displayName += ` ${wellNumber}`;
        }
        if (apiNumber) {
          displayName += ` (${apiNumber})`;
        }
        
        // Clean county display - remove numeric prefix like "011-" from "011-BLAINE"
        const county = wellData.fields.County || 'Unknown County';
        const cleanCounty = county.replace(/^\d+-/, '');
        
        wells.push({
          linkId: link.id,
          wellId: wellData.id,
          wellName: displayName,
          operator: wellData.fields.Operator || 'Unknown Operator',
          county: cleanCounty,
          wellStatus: wellData.fields['Well Status'] || 'AC',
          matchReason: link.fields['Match Reason'] || 'Manual',
          apiNumber: apiNumber
        });
      }
    }
    
    return jsonResponse({
      success: true,
      wells
    });
    
  } catch (error) {
    console.error('[GetLinkedWells] Error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch linked wells',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Unlink a well from a property (soft delete)
 */
export async function handleUnlinkPropertyWell(linkId: string, request: Request, env: Env) {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
    
    console.log(`[UnlinkWell] Unlinking link ${linkId}`);
    
    // First fetch the link to verify ownership
    const linkResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}/${linkId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (!linkResponse.ok) {
      if (linkResponse.status === 404) {
        return jsonResponse({ error: "Link not found" }, 404);
      }
      throw new Error(`Failed to fetch link: ${linkResponse.status}`);
    }
    
    const linkData = await linkResponse.json();
    
    // Verify ownership via user or organization
    const linkUserId = linkData.fields.User?.[0];
    const linkOrgId = linkData.fields.Organization?.[0];
    const userOrgId = user.organizationId;
    
    if (linkUserId !== user.id && (!userOrgId || linkOrgId !== userOrgId)) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    
    // Update link status to "Rejected" (soft delete)
    const updateResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}/${linkId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            Status: 'Rejected',
            'Rejected Date': new Date().toISOString()
          }
        })
      }
    );
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update link: ${updateResponse.status} - ${errorText}`);
    }
    
    const updatedLink = await updateResponse.json();
    
    return jsonResponse({
      success: true,
      linkId: updatedLink.id
    });
    
  } catch (error) {
    console.error('[UnlinkWell] Error:', error);
    return jsonResponse({ 
      error: 'Failed to unlink well',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}