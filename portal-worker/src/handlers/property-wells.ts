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
 * Uses D1 database for fast queries instead of Airtable API
 */
export async function handleGetPropertyLinkedWells(propertyId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);

    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    console.log(`[GetLinkedWells] Fetching linked wells for property ${propertyId} from D1`);

    // Query D1 to verify property ownership and get linked wells in one efficient query
    // First verify the user has access to this property
    const propertyCheck = await env.WELLS_DB.prepare(`
      SELECT id, airtable_record_id FROM properties
      WHERE airtable_record_id = ?
    `).bind(propertyId).first();

    if (!propertyCheck) {
      // Property not in D1 yet - fall back to Airtable check
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
      const propertyUserId = propertyData.fields.User?.[0];
      const propertyOrgId = propertyData.fields.Organization?.[0];

      if (propertyUserId !== authUser.id && (!userOrgId || propertyOrgId !== userOrgId)) {
        return jsonResponse({ error: "Unauthorized" }, 403);
      }
    }

    // Query linked wells from D1 - join property_well_links with client_wells
    // Filter by property and ensure user/org has access
    let query: string;
    let params: any[];

    if (userOrgId) {
      // For org users, filter by organization
      query = `
        SELECT
          pwl.id as link_id,
          pwl.airtable_record_id as link_airtable_id,
          pwl.match_reason,
          cw.airtable_id as well_id,
          cw.well_name,
          cw.operator,
          cw.county,
          cw.well_status,
          cw.api_number,
          cw.occ_map_link
        FROM property_well_links pwl
        JOIN client_wells cw ON cw.airtable_id = pwl.well_airtable_id
        WHERE pwl.property_airtable_id = ?
          AND pwl.status IN ('Active', 'Linked')
          AND pwl.organization_id = ?
      `;
      params = [propertyId, userOrgId];
    } else {
      // For solo users, filter by user
      query = `
        SELECT
          pwl.id as link_id,
          pwl.airtable_record_id as link_airtable_id,
          pwl.match_reason,
          cw.airtable_id as well_id,
          cw.well_name,
          cw.operator,
          cw.county,
          cw.well_status,
          cw.api_number,
          cw.occ_map_link
        FROM property_well_links pwl
        JOIN client_wells cw ON cw.airtable_id = pwl.well_airtable_id
        WHERE pwl.property_airtable_id = ?
          AND pwl.status IN ('Active', 'Linked')
          AND pwl.user_id = ?
      `;
      params = [propertyId, authUser.id];
    }

    const linkedWellsResult = await env.WELLS_DB.prepare(query).bind(...params).all();
    const linkedWells = linkedWellsResult.results || [];

    console.log(`[GetLinkedWells] Found ${linkedWells.length} linked wells in D1 for property ${propertyId}`);

    // Format the response
    const wells = linkedWells.map((row: any) => {
      const wellName = row.well_name || 'Unknown Well';
      const occMapLink = row.occ_map_link || '';

      // Try to extract full well name from OCC Map Link
      let displayName = wellName;
      if (occMapLink) {
        try {
          const decoded = decodeURIComponent(occMapLink);
          const titleMatch = decoded.match(/"title":"([^"]+)"/);
          if (titleMatch && titleMatch[1]) {
            displayName = titleMatch[1];
          }
        } catch (e) {
          // Keep original well name
        }
      }

      // Clean county display - remove numeric prefix like "011-" from "011-BLAINE"
      const county = row.county || 'Unknown County';
      const cleanCounty = county.replace(/^\d+-/, '');

      return {
        linkId: row.link_airtable_id,
        wellId: row.well_id,
        wellName: displayName,
        operator: row.operator || 'Unknown Operator',
        county: cleanCounty,
        wellStatus: row.well_status || 'AC',
        matchReason: row.match_reason || 'Manual',
        apiNumber: row.api_number || ''
      };
    });

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
 * Uses D1 database for fast queries instead of Airtable API
 */
export async function handleGetWellLinkedProperties(wellId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);

    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    console.log(`[GetLinkedProperties] Fetching linked properties for well ${wellId} from D1`);

    // Check if well exists in D1
    const wellCheck = await env.WELLS_DB.prepare(`
      SELECT id, airtable_id FROM client_wells
      WHERE airtable_id = ?
    `).bind(wellId).first();

    if (!wellCheck) {
      // Well not in D1 yet - fall back to Airtable check
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
      const wellUserId = wellData.fields.User?.[0];
      const wellOrgId = wellData.fields.Organization?.[0];

      if (wellUserId !== authUser.id && (!userOrgId || wellOrgId !== userOrgId)) {
        return jsonResponse({ error: "Unauthorized" }, 403);
      }
    }

    // Query linked properties from D1 - join property_well_links with properties
    let query: string;
    let params: any[];

    if (userOrgId) {
      // For org users, filter by organization
      query = `
        SELECT
          pwl.id as link_id,
          pwl.airtable_record_id as link_airtable_id,
          pwl.match_reason,
          p.airtable_record_id as property_id,
          p.section,
          p.township,
          p.range,
          p.county,
          p.acres,
          p.net_acres
        FROM property_well_links pwl
        JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
        WHERE pwl.well_airtable_id = ?
          AND pwl.status IN ('Active', 'Linked')
          AND pwl.organization_id = ?
      `;
      params = [wellId, userOrgId];
    } else {
      // For solo users, filter by user
      query = `
        SELECT
          pwl.id as link_id,
          pwl.airtable_record_id as link_airtable_id,
          pwl.match_reason,
          p.airtable_record_id as property_id,
          p.section,
          p.township,
          p.range,
          p.county,
          p.acres,
          p.net_acres
        FROM property_well_links pwl
        JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
        WHERE pwl.well_airtable_id = ?
          AND pwl.status IN ('Active', 'Linked')
          AND pwl.user_id = ?
      `;
      params = [wellId, authUser.id];
    }

    const linkedPropertiesResult = await env.WELLS_DB.prepare(query).bind(...params).all();
    const linkedProperties = linkedPropertiesResult.results || [];

    console.log(`[GetLinkedProperties] Found ${linkedProperties.length} linked properties in D1 for well ${wellId}`);

    // Format the response
    const properties = linkedProperties.map((row: any) => {
      // Format location
      const location = `S${row.section || '?'}-T${row.township || '?'}-R${row.range || '?'}`;

      // Clean county display - remove numeric prefix
      const county = (row.county || 'Unknown County').replace(/^\d+-/, '');

      // Get acres (prioritize net_acres, fallback to acres)
      const acres = parseFloat(row.net_acres) || parseFloat(row.acres) || null;

      return {
        linkId: row.link_airtable_id,
        propertyId: row.property_id,
        location,
        county,
        acres: acres && acres > 0 ? acres : null,
        group: null, // Group not stored in D1 properties table
        matchReason: row.match_reason || 'Manual'
      };
    });

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
        SET status = 'Unlinked', rejected_date = ?
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
              Status: 'Unlinked',
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

/**
 * Re-link a previously unlinked well-property relationship
 */
export async function handleRelinkPropertyWell(linkId: string, request: Request, env: Env) {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    console.log(`[RelinkWell] Re-linking link ${linkId}`);

    const airtableRecordId = linkId.startsWith('link_') ? linkId.replace('link_', '') : linkId;

    // Update D1 database
    try {
      const d1Result = await env.WELLS_DB.prepare(`
        UPDATE property_well_links
        SET status = 'Linked', rejected_date = NULL
        WHERE id = ? OR airtable_record_id = ?
      `).bind(linkId, airtableRecordId).run();

      console.log(`[RelinkWell] D1 update result: ${d1Result.meta.changes} rows changed`);
    } catch (d1Error) {
      console.error('[RelinkWell] D1 update failed:', d1Error);
    }

    // Update Airtable for consistency
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
              Status: 'Linked',
              'Rejected Date': null
            }
          })
        }
      );

      if (!updateResponse.ok) {
        console.error(`[RelinkWell] Airtable update failed: ${updateResponse.status}`);
      }
    } catch (airtableError) {
      console.error('[RelinkWell] Airtable update error:', airtableError);
    }

    return jsonResponse({
      success: true,
      linkId
    });

  } catch (error) {
    console.error('[RelinkWell] Error:', error);
    return jsonResponse({
      error: 'Failed to re-link well',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}