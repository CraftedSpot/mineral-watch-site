/**
 * Property-Documents D1 API Handlers
 * 
 * Handles API endpoints for property/well document relationships using D1 database
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Document types that show on property modals
const PROPERTY_DOC_TYPES = [
  'Mineral Deed', 'Royalty Deed', 'Assignment of Interest', 'Warranty Deed', 'Quitclaim Deed',
  'Oil & Gas Lease', 'Extension Agreement', 'Amendment', 'Ratification', 'Release',
  'Affidavit', 'Probate', 'Power of Attorney', 'Judgment',
  'Division Order', 'Transfer Order', 'Revenue Statement'
];

// Document types that show on well modals
const WELL_DOC_TYPES = [
  'Drilling Permit', 'Completion Report', 'Well Log', 'Plugging Report',
  'Division Order', 'Transfer Order', 'Revenue Statement'
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
      `).bind(propertyId, authUser.id, userOrgId).all();
      
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
 * Get linked documents for a well using D1
 */
export async function handleGetWellLinkedDocuments(wellId: string, request: Request, env: Env) {
  const start = Date.now();
  
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record to access organization info
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userOrgId = userRecord.fields.Organization?.[0];
    
    console.log(`[GetWellDocuments-D1] Attempting D1 query for well ${wellId}`);
    
    try {
      // Query linked documents from D1 with security filtering
      const docTypeList = WELL_DOC_TYPES.map(type => `'${type.replace(/'/g, "''")}'`).join(', ');
      
      const d1Results = await env.WELLS_DB.prepare(`
        SELECT 
          id,
          display_name,
          filename,
          doc_type,
          upload_date,
          r2_key
        FROM documents 
        WHERE well_id = ? 
          AND (deleted_at IS NULL OR deleted_at = '')
          AND doc_type IN (${docTypeList})
          AND (user_id = ? OR organization_id = ?)
        ORDER BY upload_date DESC
      `).bind(wellId, authUser.id, userOrgId).all();
      
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