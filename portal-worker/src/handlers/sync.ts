import { jsonResponse, errorResponse } from '../utils/responses.js';
import { syncAirtableData } from '../sync.js';
import type { Env } from '../types/env.js';

export async function handleAirtableSync(request: Request, env: Env): Promise<Response> {
  try {
    // Check authentication - require auth token in header or cookie
    const authHeader = request.headers.get('Authorization');
    const cookieHeader = request.headers.get('Cookie');
    
    // Extract session from cookie if present
    let isAuthenticated = false;
    if (cookieHeader) {
      // Verify session locally (no auth-worker dependency)
      try {
        const { authenticateRequest } = await import('../utils/auth.js');
        const user = await authenticateRequest(request, env);
        if (user) {
          isAuthenticated = true;
        }
      } catch (error) {
        console.error('Auth verification error:', error);
      }
    }
    
    // Check authorization header as fallback
    if (!isAuthenticated && authHeader) {
      // Simple bearer token check - you might want to make this more secure
      const expectedToken = env.SYNC_API_KEY || 'default-sync-key-2024';
      if (authHeader === `Bearer ${expectedToken}`) {
        isAuthenticated = true;
      }
    }
    
    // Also check X-API-Key header
    if (!isAuthenticated) {
      const apiKey = request.headers.get('X-API-Key');
      const expectedToken = env.SYNC_API_KEY || 'default-sync-key-2024';
      if (apiKey === expectedToken) {
        isAuthenticated = true;
      }
    }
    
    if (!isAuthenticated) {
      return errorResponse('Unauthorized', 401);
    }
    
    console.log('Starting Airtable sync...');
    
    // Run the sync
    const result = await syncAirtableData(env);
    
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