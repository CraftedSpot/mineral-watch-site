/**
 * Property-Documents D1 API Handlers
 * 
 * Handles API endpoints for property/well document relationships using D1 database
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Document types that show on property modals (snake_case format)
const PROPERTY_DOC_TYPES = [
  'mineral_deed', 'royalty_deed', 'assignment_of_interest', 'warranty_deed', 'quitclaim_deed',
  'oil_gas_lease', 'extension_agreement', 'amendment', 'ratification', 'release',
  'affidavit', 'probate', 'power_of_attorney', 'judgment',
  'division_order', 'transfer_order', 'revenue_statement', 'check_stub',
  // OCC Orders
  'pooling_order', 'spacing_order', 'occ_order', 'increased_density_order', 'location_exception_order',
  'unitization_order', 'multi_unit_horizontal_order', 'change_of_operator_order', 'well_transfer'
];

// Document types that show on well modals (snake_case format)
const WELL_DOC_TYPES = [
  'drilling_permit', 'completion_report', 'well_log', 'plugging_report',
  'division_order', 'transfer_order', 'revenue_statement', 'check_stub'
];

/**
 * Get linked documents for a property using D1
 */
export async function handleGetPropertyLinkedDocuments(propertyId: string, request: Request, env: Env) {
  const start = Date.now();
  
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userOrgId = userRecord.fields.Organization?.[0];
    
    console.log(`[GetPropertyDocuments-D1] Attempting D1 query for property ${propertyId}`);
    
    try {
      // Query linked documents from D1 with security filtering
      // Documents store Airtable record IDs in property_id, so query directly
      const docTypeList = PROPERTY_DOC_TYPES.map(type => `'${type.replace(/'/g, "''")}'`).join(', ');

      console.log(`[GetPropertyDocuments-D1] Querying documents for property ${propertyId}`);

      // Support both single property_id and comma-separated multiple property_ids
      // Build patterns in JS to avoid SQL concatenation issues
      const startsWithPattern = `${propertyId},%`;
      const endsWithPattern = `%,${propertyId}`;
      const containsPattern = `%,${propertyId},%`;

      const d1Results = await env.WELLS_DB.prepare(`
        SELECT
          id,
          display_name,
          filename,
          doc_type,
          upload_date,
          r2_key
        FROM documents
        WHERE (
          property_id = ?
          OR property_id LIKE ?
          OR property_id LIKE ?
          OR property_id LIKE ?
        )
          AND (deleted_at IS NULL OR deleted_at = '')
          AND doc_type IN (${docTypeList})
          AND (organization_id = ? OR user_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))
        ORDER BY upload_date DESC
      `).bind(propertyId, startsWithPattern, endsWithPattern, containsPattern, userOrgId, authUser.id, userOrgId).all();
      
      console.log(`[GetPropertyDocuments-D1] D1 query: ${d1Results.results.length} documents in ${Date.now() - start}ms`);
      
      // Format results to match expected API response
      const documents = d1Results.results.map((row: any) => {
        // Use display_name if populated, fallback to filename
        const displayName = row.display_name || row.filename || 'Untitled Document';
        
        return {
          id: row.id,
          displayName,
          docType: row.doc_type,
          uploadDate: row.upload_date,
          r2Key: row.r2_key
        };
      });
      
      return jsonResponse({
        success: true,
        documents,
        source: 'D1',
        queryTime: Date.now() - start
      });
      
    } catch (d1Error) {
      console.error('[GetPropertyDocuments-D1] D1 query failed:', d1Error);
      
      return jsonResponse({ 
        error: 'Failed to fetch linked documents',
        message: d1Error instanceof Error ? d1Error.message : 'Unknown error'
      }, 500);
    }
    
  } catch (error) {
    console.error('[GetPropertyDocuments-D1] Unexpected error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch linked documents',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Get linked documents for a well using D1 (by API number)
 */
export async function handleGetWellLinkedDocuments(apiNumber: string, request: Request, env: Env) {
  const start = Date.now();
  
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userOrgId = userRecord.fields.Organization?.[0];
    
    console.log(`[GetWellDocuments-D1] Attempting D1 query for API number ${apiNumber}`);
    
    try {
      // Query documents linked to well via Airtable record ID
      // Documents store Airtable record IDs in well_id (may be comma-separated for multi-well links)
      const docTypeList = WELL_DOC_TYPES.map(type => `'${type.replace(/'/g, "''")}'`).join(', ');

      console.log(`[GetWellDocuments-D1] Querying documents for API number ${apiNumber}`);

      // Step 1: Resolve API number to record ID via client_wells or statewide wells
      let wellAirtableId: string | null = null;

      // Try client_wells first (user's tracked wells — airtable_id)
      const clientWell = await env.WELLS_DB.prepare(
        `SELECT airtable_id as record_id FROM client_wells WHERE api_number = ? LIMIT 1`
      ).bind(apiNumber).first();
      if (clientWell?.record_id) {
        wellAirtableId = clientWell.record_id as string;
      }

      // Also try statewide wells (airtable_record_id) — documents may be linked via either
      let statewideId: string | null = null;
      const stateWell = await env.WELLS_DB.prepare(
        `SELECT airtable_record_id as record_id FROM wells WHERE api_number = ? LIMIT 1`
      ).bind(apiNumber).first();
      if (stateWell?.record_id) {
        statewideId = stateWell.record_id as string;
        if (!wellAirtableId) wellAirtableId = statewideId;
      }

      if (!wellAirtableId) {
        console.log(`[GetWellDocuments-D1] No well found for API: ${apiNumber}`);
        return jsonResponse({ success: true, documents: [], source: 'D1', queryTime: Date.now() - start });
      }

      // Step 2: Find documents using LIKE patterns (supports comma-separated well_id)
      // Check both IDs if they differ (client_wells vs statewide wells can have different record IDs)
      const idsToCheck = [wellAirtableId];
      if (statewideId && statewideId !== wellAirtableId) idsToCheck.push(statewideId);

      const wellConditions = idsToCheck.map(() =>
        `(d.well_id = ? OR d.well_id LIKE ? OR d.well_id LIKE ? OR d.well_id LIKE ?)`
      ).join(' OR ');
      const wellBindings = idsToCheck.flatMap(id => [id, `${id},%`, `%,${id}`, `%,${id},%`]);

      const d1Results = await env.WELLS_DB.prepare(`
        SELECT
          d.id,
          d.display_name,
          d.filename,
          d.doc_type,
          d.upload_date,
          d.r2_key
        FROM documents d
        WHERE (${wellConditions})
          AND (d.deleted_at IS NULL OR d.deleted_at = '')
          AND d.doc_type IN (${docTypeList})
          AND (d.user_id = ? OR d.organization_id = ?)
        ORDER BY d.upload_date DESC
      `).bind(...wellBindings, authUser.id, userOrgId).all();
      
      console.log(`[GetWellDocuments-D1] D1 query: ${d1Results.results.length} documents in ${Date.now() - start}ms`);
      
      // Format results to match expected API response
      const documents = d1Results.results.map((row: any) => {
        // Use display_name if populated, fallback to filename
        const displayName = row.display_name || row.filename || 'Untitled Document';
        
        return {
          id: row.id,
          displayName,
          docType: row.doc_type,
          uploadDate: row.upload_date,
          r2Key: row.r2_key
        };
      });
      
      return jsonResponse({
        success: true,
        documents,
        source: 'D1',
        queryTime: Date.now() - start
      });
      
    } catch (d1Error) {
      console.error('[GetWellDocuments-D1] D1 query failed:', d1Error);
      
      return jsonResponse({ 
        error: 'Failed to fetch linked documents',
        message: d1Error instanceof Error ? d1Error.message : 'Unknown error'
      }, 500);
    }
    
  } catch (error) {
    console.error('[GetWellDocuments-D1] Unexpected error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch linked documents',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}