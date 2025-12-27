/**
 * Property-Wells API Handlers
 * 
 * Handles API endpoints for managing property-well relationships
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
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
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
    
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
    const userOrgId = user.organizationId;
    
    if (propertyUserId !== user.id && (!userOrgId || propertyOrgId !== userOrgId)) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    
    // Fetch active links for this property
    // Using SEARCH() for linked record fields - more reliable than FIND()
    const linksFilter = `AND(SEARCH("${propertyId}", ARRAYJOIN({Property})), {Status} = 'Active')`;
    console.log(`[GetLinkedWells] Filter formula: ${linksFilter}`);
    
    const linksResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}?filterByFormula=${encodeURIComponent(linksFilter)}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (!linksResponse.ok) {
      const errorText = await linksResponse.text();
      console.error(`[GetLinkedWells] Failed to fetch links: ${linksResponse.status} - ${errorText}`);
      throw new Error(`Failed to fetch links: ${linksResponse.status}`);
    }
    
    const linksData = await linksResponse.json();
    console.log(`[GetLinkedWells] Found ${linksData.records.length} links for property ${propertyId}`);
    const wells = [];
    
    // Fetch well details for each link
    for (const link of linksData.records) {
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
        wells.push({
          linkId: link.id,
          wellId: wellData.id,
          wellName: wellData.fields['Well Name'] || 'Unknown Well',
          operator: wellData.fields.Operator || 'Unknown Operator',
          county: wellData.fields.County || 'Unknown County',
          wellStatus: wellData.fields['Well Status'] || 'AC',
          matchReason: link.fields['Match Reason'] || 'Manual'
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