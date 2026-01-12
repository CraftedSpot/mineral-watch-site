/**
 * Property-Wells D1 API Handlers
 * 
 * Handles API endpoints for property-well relationships using D1 database
 * with fallback to Airtable for transition period
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Import the original Airtable handlers as fallback
import { 
  handleGetPropertyLinkedWells as getLinkedWellsFromAirtable,
  handleGetWellLinkedProperties as getLinkedPropertiesFromAirtable 
} from './property-wells.js';

/**
 * Get linked wells for a property using D1 with Airtable fallback
 */
export async function handleGetPropertyLinkedWells(propertyId: string, request: Request, env: Env) {
  const start = Date.now();
  
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userOrgId = userRecord.fields.Organization?.[0];
    
    console.log(`[GetLinkedWells-D1] Attempting D1 query for property ${propertyId}`);
    
    try {
      // First verify the property exists in D1
      const propertyResult = await env.WELLS_DB.prepare(`
        SELECT airtable_record_id
        FROM properties 
        WHERE airtable_record_id = ?
      `).bind(propertyId).first();
      
      if (!propertyResult) {
        console.log(`[GetLinkedWells-D1] Property not found in D1, falling back to Airtable`);
        return getLinkedWellsFromAirtable(propertyId, request, env);
      }
      
      // Ownership will be verified by filtering links by user/org in the main query below
      
      // Query linked wells from D1 using client_wells table
      const d1Results = await env.WELLS_DB.prepare(`
        SELECT
          pwl.id as link_id,
          pwl.match_reason,
          pwl.confidence_score,
          cw.airtable_id as well_id,
          cw.well_name,
          cw.api_number,
          cw.operator,
          cw.county,
          cw.well_status,
          cw.occ_map_link
        FROM property_well_links pwl
        JOIN client_wells cw ON cw.airtable_id = pwl.well_airtable_id
        WHERE pwl.property_airtable_id = ?
          AND pwl.status = 'Active'
        ORDER BY cw.well_name
      `).bind(propertyId).all();
      
      console.log(`[GetLinkedWells-D1] D1 query: ${d1Results.results.length} wells in ${Date.now() - start}ms`);
      
      // Format results to match the expected API response
      const wells = d1Results.results.map((row: any) => {
        // Clean county display - remove numeric prefix
        const cleanCounty = row.county ? row.county.replace(/^\d+-/, '') : 'Unknown County';

        // Try to extract full well name from OCC Map Link
        let displayName = row.well_name || 'Unknown Well';
        if (row.occ_map_link) {
          try {
            const decoded = decodeURIComponent(row.occ_map_link);
            const titleMatch = decoded.match(/"title":"([^"]+)"/);
            if (titleMatch && titleMatch[1]) {
              displayName = titleMatch[1];
            }
          } catch (e) {
            // Keep original well name
          }
        }

        return {
          linkId: row.link_id,
          wellId: row.well_id,
          wellName: displayName,
          operator: row.operator || 'Unknown Operator',
          county: cleanCounty,
          wellStatus: row.well_status || 'AC',
          matchReason: row.match_reason || 'Manual',
          apiNumber: row.api_number,
          confidenceScore: row.confidence_score
        };
      });
      
      return jsonResponse({
        success: true,
        wells,
        source: 'D1',
        queryTime: Date.now() - start
      });
      
    } catch (d1Error) {
      console.error('[GetLinkedWells-D1] D1 query failed, falling back to Airtable:', d1Error);
      
      // Fallback to Airtable
      const airtableStart = Date.now();
      const airtableResponse = await getLinkedWellsFromAirtable(propertyId, request, env);
      
      // Add metadata to indicate fallback was used
      if (airtableResponse.status === 200) {
        const body = await airtableResponse.json();
        return jsonResponse({
          ...body,
          source: 'Airtable-Fallback',
          d1Error: d1Error.message,
          queryTime: Date.now() - airtableStart
        });
      }
      
      return airtableResponse;
    }
    
  } catch (error) {
    console.error('[GetLinkedWells-D1] Unexpected error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch linked wells',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Get linked properties for a well using D1 with Airtable fallback
 */
export async function handleGetWellLinkedProperties(wellId: string, request: Request, env: Env) {
  const start = Date.now();
  
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userOrgId = userRecord.fields.Organization?.[0];
    
    console.log(`[GetLinkedProperties-D1] Attempting D1 query for well ${wellId}`);
    
    try {
      // First verify the well exists in D1 client_wells table
      const wellResult = await env.WELLS_DB.prepare(`
        SELECT airtable_id
        FROM client_wells
        WHERE airtable_id = ?
      `).bind(wellId).first();

      if (!wellResult) {
        console.log(`[GetLinkedProperties-D1] Well not found in D1 client_wells, falling back to Airtable`);
        return getLinkedPropertiesFromAirtable(wellId, request, env);
      }
      
      // Query linked properties from D1 - ownership already verified at well list level
      const d1Results = await env.WELLS_DB.prepare(`
        SELECT 
          pwl.id as link_id,
          pwl.match_reason,
          pwl.confidence_score,
          p.airtable_record_id as property_id,
          p.section,
          p.township,
          p.range,
          p.county,
          p.acres,
          p.net_acres,
          p.meridian
        FROM property_well_links pwl
        JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
        WHERE pwl.well_airtable_id = ?
          AND pwl.status = 'Active'
        ORDER BY p.section, p.township, p.range
      `).bind(wellId).all();
      
      console.log(`[GetLinkedProperties-D1] D1 query: ${d1Results.results.length} properties in ${Date.now() - start}ms`);
      
      // Format results to match the expected API response
      const properties = d1Results.results.map((row: any) => {
        // Format location
        const location = `S${row.section}-T${row.township}-R${row.range}`;
        
        // Clean county display
        const cleanCounty = row.county ? row.county.replace(/^\d+-/, '') : 'Unknown County';
        
        // Get acres (prioritize net acres over gross acres)
        const acres = row.net_acres || row.acres || 0;
        
        return {
          linkId: row.link_id,
          propertyId: row.property_id,
          location,
          county: cleanCounty,
          acres: acres > 0 ? acres : null,
          group: null, // Group field not in D1 yet
          matchReason: row.match_reason || 'Manual',
          meridian: row.meridian || 'IM',
          confidenceScore: row.confidence_score
        };
      });
      
      return jsonResponse({
        success: true,
        properties,
        source: 'D1',
        queryTime: Date.now() - start
      });
      
    } catch (d1Error) {
      console.error('[GetLinkedProperties-D1] D1 query failed, falling back to Airtable:', d1Error);
      
      // Fallback to Airtable
      const airtableStart = Date.now();
      const airtableResponse = await getLinkedPropertiesFromAirtable(wellId, request, env);
      
      // Add metadata to indicate fallback was used
      if (airtableResponse.status === 200) {
        const body = await airtableResponse.json();
        return jsonResponse({
          ...body,
          source: 'Airtable-Fallback',
          d1Error: d1Error.message,
          queryTime: Date.now() - airtableStart
        });
      }
      
      return airtableResponse;
    }
    
  } catch (error) {
    console.error('[GetLinkedProperties-D1] Unexpected error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch linked properties',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Unlink a well from a property (soft delete)
 * This still updates Airtable as the source of truth
 */
export async function handleUnlinkPropertyWell(linkId: string, request: Request, env: Env) {
  // For unlinking, we still use Airtable as the source of truth
  // The sync process will update D1
  const { handleUnlinkPropertyWell: unlinkFromAirtable } = await import('./property-wells.js');
  return unlinkFromAirtable(linkId, request, env);
}