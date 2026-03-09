import { jsonResponse, errorResponse } from '../utils/responses.js';
import { syncAirtableData } from '../sync.js';
import { timingSafeKeyCheck } from '../utils/auth.js';
import { isSuperAdmin } from '../utils/auth.js';
import type { Env } from '../types/env.js';

export async function handleAirtableSync(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    let isAuthenticated = false;

    // Session-based auth — require super admin
    try {
      const { authenticateRequest } = await import('../utils/auth.js');
      const user = await authenticateRequest(request, env);
      if (user && isSuperAdmin(user.email)) {
        isAuthenticated = true;
      }
    } catch {
      // Session auth failed, try API key below
    }

    // API key auth via Authorization header
    if (!isAuthenticated && authHeader && env.PROCESSING_API_KEY) {
      if (timingSafeKeyCheck(authHeader, `Bearer ${env.PROCESSING_API_KEY}`)) {
        isAuthenticated = true;
      }
    }

    // API key auth via X-API-Key header
    if (!isAuthenticated) {
      const apiKey = request.headers.get('X-API-Key');
      if (apiKey && env.PROCESSING_API_KEY && timingSafeKeyCheck(apiKey, env.PROCESSING_API_KEY)) {
        isAuthenticated = true;
      }
    }

    if (!isAuthenticated) {
      return errorResponse('Unauthorized', 401);
    }
    
    console.log('Starting Airtable sync...');
    
    // Run the sync (pass ctx so post-sync tasks use waitUntil)
    const result = await syncAirtableData(env, ctx);
    
    console.log('Sync completed:', {
      properties: result.properties.synced,
      wells: result.wells.synced,
      clientWells: result.clientWells?.synced || 0,
      links: result.links?.synced || 0,
      duration: result.duration
    });

    // Return detailed results
    return jsonResponse({
      success: true,
      message: 'Sync completed successfully',
      result: {
        properties: {
          total: result.properties.synced,
          created: result.properties.created,
          updated: result.properties.updated,
          errors: result.properties.errors.length
        },
        wells: {
          total: result.wells.synced,
          created: result.wells.created,
          updated: result.wells.updated,
          errors: result.wells.errors.length
        },
        clientWells: result.clientWells ? {
          total: result.clientWells.synced,
          created: result.clientWells.created,
          updated: result.clientWells.updated,
          errors: result.clientWells.errors.length
        } : undefined,
        links: result.links ? {
          total: result.links.synced,
          created: result.links.created,
          updated: result.links.updated,
          errors: result.links.errors.length
        } : undefined,
        duration_ms: result.duration,
        errors: [
          ...result.properties.errors.slice(0, 5), // First 5 property errors
          ...result.wells.errors.slice(0, 5), // First 5 well errors
          ...(result.clientWells?.errors.slice(0, 5) || []), // First 5 client well errors
          ...(result.links?.errors.slice(0, 5) || []) // First 5 link errors
        ]
      }
    });
  } catch (error) {
    console.error('Sync error:', error);
    return errorResponse((error as any).message || 'Sync failed', 500);
  }
}