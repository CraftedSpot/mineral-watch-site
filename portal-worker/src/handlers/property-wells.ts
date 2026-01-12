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
    
    // Fetch all links with pagination support
    const allRecords: any[] = [];
    let offset: string | undefined;
    
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}?filterByFormula=${encodeURIComponent(linksFilter)}&pageSize=100${offset ? `&offset=${offset}` : ''}`;
      
      const linksResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      });
      
      if (!linksResponse.ok) {
        const errorText = await linksResponse.text();
        console.error(`[GetLinkedWells] Failed to fetch links: ${linksResponse.status} - ${errorText}`);
        throw new Error(`Failed to fetch links: ${linksResponse.status}`);
      }
      
      const pageData = await linksResponse.json();
      allRecords.push(...pageData.records);
      offset = pageData.offset;
      
    } while (offset);
    
    console.log(`[GetLinkedWells] Found ${allRecords.length} total active links for user`);
    
    // Filter for this specific property in JavaScript
    const propertyLinks = allRecords.filter((link: any) => {
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
        const occMapLink = wellData.fields['OCC Map Link'] || '';
        
        // Try to extract full well name from OCC Map Link
        let displayName = wellName;
        if (occMapLink) {
          try {
            // First decode the URL to handle encoded characters
            const decoded = decodeURIComponent(occMapLink);
            // Look for the title in the JSON structure
            const titleMatch = decoded.match(/"title":"([^"]+)"/);
            if (titleMatch && titleMatch[1]) {
              displayName = titleMatch[1];
            } else if (wellNumber && !wellName.includes(wellNumber)) {
              displayName += ` ${wellNumber}`;
            }
          } catch (e) {
            // If decoding fails, try the old method
            const titleMatch = occMapLink.match(/title%22%3A%22([^%]+)/);
            if (titleMatch) {
              displayName = decodeURIComponent(titleMatch[1].replace(/%20/g, ' '));
            } else if (wellNumber && !wellName.includes(wellNumber)) {
              displayName += ` ${wellNumber}`;
            }
          }
        } else if (wellNumber && !wellName.includes(wellNumber)) {
          displayName += ` ${wellNumber}`;
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
 * Get linked properties for a well
 */
export async function handleGetWellLinkedProperties(wellId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userOrgId = userRecord.fields.Organization?.[0];
    
    console.log(`[GetLinkedProperties] Fetching linked properties for well ${wellId}`);
    
    // First verify the user owns this well
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
    
    if (wellUserId !== authUser.id && (!userOrgId || wellOrgId !== userOrgId)) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    
    // Fetch ALL active links for this user/org, then filter in JS
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
    
    console.log(`[GetLinkedProperties] Fetching all user links with filter: ${linksFilter}`);
    
    // Fetch all links with pagination support
    const allRecords: any[] = [];
    let offset: string | undefined;
    
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}?filterByFormula=${encodeURIComponent(linksFilter)}&pageSize=100${offset ? `&offset=${offset}` : ''}`;
      
      const linksResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      });
      
      if (!linksResponse.ok) {
        const errorText = await linksResponse.text();
        console.error(`[GetLinkedProperties] Failed to fetch links: ${linksResponse.status} - ${errorText}`);
        throw new Error(`Failed to fetch links: ${linksResponse.status}`);
      }
      
      const pageData = await linksResponse.json();
      allRecords.push(...pageData.records);
      offset = pageData.offset;
      
    } while (offset);
    
    console.log(`[GetLinkedProperties] Found ${allRecords.length} total active links for user`);
    
    // Filter for this specific well in JavaScript
    const wellLinks = allRecords.filter((link: any) => {
      const linkedWells = link.fields.Well || [];
      return linkedWells.includes(wellId);
    });
    
    console.log(`[GetLinkedProperties] Found ${wellLinks.length} links for well ${wellId}`);
    const properties = [];
    
    // Fetch property details for each link
    for (const link of wellLinks) {
      const propertyId = link.fields.Property?.[0];
      if (!propertyId) continue;
      
      const propertyResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}/${propertyId}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );
      
      if (propertyResponse.ok) {
        const propertyData = await propertyResponse.json();
        const f = propertyData.fields;
        
        // Format location
        const location = `S${f.SEC}-T${f.TWN}-R${f.RNG}`;
        
        // Clean county display
        const county = (f.COUNTY || 'Unknown County').replace(/^\d+-/, '');
        
        // Get acres (prioritize RI Acres, fallback to WI Acres)
        const riAcres = parseFloat(f['RI Acres'] || 0);
        const wiAcres = parseFloat(f['WI Acres'] || 0);
        const acres = riAcres || wiAcres;
        
        properties.push({
          linkId: link.id,
          propertyId: propertyData.id,
          location,
          county,
          acres: acres > 0 ? acres : null,
          group: f.Group || null,
          matchReason: link.fields['Match Reason'] || 'Manual'
        });
      }
    }
    
    return jsonResponse({
      success: true,
      properties
    });
    
  } catch (error) {
    console.error('[GetLinkedProperties] Error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch linked properties',
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

    // D1 id format is "link_recXXX", Airtable id is "recXXX"
    // Extract Airtable ID from D1 id format
    const airtableRecordId = linkId.startsWith('link_') ? linkId.replace('link_', '') : linkId;

    // First, update D1 database (primary source of truth for reads)
    try {
      const d1Result = await env.WELLS_DB.prepare(`
        UPDATE property_well_links
        SET status = 'Rejected', rejected_date = ?
        WHERE id = ? OR airtable_record_id = ?
      `).bind(new Date().toISOString(), linkId, airtableRecordId).run();

      console.log(`[UnlinkWell] D1 update result: ${d1Result.meta.changes} rows changed`);
    } catch (d1Error) {
      console.error('[UnlinkWell] D1 update failed:', d1Error);
      // Continue to try Airtable even if D1 fails
    }

    // Also update Airtable for consistency (using extracted Airtable ID)
    try {
      const updateResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}/${airtableRecordId}`,
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
        console.error(`[UnlinkWell] Airtable update failed: ${updateResponse.status}`);
        // Don't fail if Airtable update fails - D1 is primary
      }
    } catch (airtableError) {
      console.error('[UnlinkWell] Airtable update error:', airtableError);
      // Don't fail if Airtable update fails - D1 is primary
    }

    return jsonResponse({
      success: true,
      linkId
    });

  } catch (error) {
    console.error('[UnlinkWell] Error:', error);
    return jsonResponse({
      error: 'Failed to unlink well',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}