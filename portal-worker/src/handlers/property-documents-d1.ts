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
  'division_order', 'transfer_order', 'revenue_statement'
];

// Document types that show on well modals (snake_case format)
const WELL_DOC_TYPES = [
  'drilling_permit', 'completion_report', 'well_log', 'plugging_report',
  'division_order', 'transfer_order', 'revenue_statement'
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
      // First, get the property UUID from the Airtable record ID
      const propertyResult = await env.WELLS_DB.prepare(`
        SELECT id FROM properties WHERE airtable_record_id = ?
      `).bind(propertyId).first();
      
      if (!propertyResult) {
        console.log(`[GetPropertyDocuments-D1] Property not found in D1 for Airtable ID: ${propertyId}`);
        return jsonResponse({
          success: true,
          documents: [],
          source: 'D1',
          queryTime: Date.now() - start
        });
      }
      
      const propertyUuid = propertyResult.id;
      console.log(`[GetPropertyDocuments-D1] Found property UUID: ${propertyUuid} for Airtable ID: ${propertyId}`);
      
      // Query linked documents from D1 with security filtering
      const docTypeList = PROPERTY_DOC_TYPES.map(type => `'${type.replace(/'/g, "''")}'`).join(', ');
      
      const d1Results = await env.WELLS_DB.prepare(`
        SELECT 
          id,
          display_name,
          filename,
          doc_type,
          upload_date,
          r2_key
        FROM documents 
        WHERE property_id = ? 
          AND (deleted_at IS NULL OR deleted_at = '')
          AND doc_type IN (${docTypeList})
          AND (user_id = ? OR organization_id = ?)
        ORDER BY upload_date DESC
      `).bind(propertyUuid, authUser.id, userOrgId).all();
      
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
      // Simplified query: Join documents with wells directly by API number
      // Convert documents.well_id (format "12345.0") back to integer for JOIN
      const docTypeList = WELL_DOC_TYPES.map(type => `'${type.replace(/'/g, "''")}'`).join(', ');
      
      const d1Results = await env.WELLS_DB.prepare(`
        SELECT 
          d.id,
          d.display_name,
          d.filename,
          d.doc_type,
          d.upload_date,
          d.r2_key
        FROM documents d
        JOIN wells w ON CAST(REPLACE(d.well_id, '.0', '') AS INTEGER) = w.id
        WHERE w.api_number = ?
          AND (d.deleted_at IS NULL OR d.deleted_at = '')
          AND d.doc_type IN (${docTypeList})
          AND (d.user_id = ? OR d.organization_id = ?)
        ORDER BY d.upload_date DESC
      `).bind(apiNumber, authUser.id, userOrgId).all();
      
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