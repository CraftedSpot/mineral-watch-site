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
      const cookies = Object.fromEntries(
        cookieHeader.split('; ').map(c => c.split('='))
      );
      if (cookies.mw_session) {
        // Verify session with auth worker
        try {
          const verifyResponse = await env.AUTH_WORKER.fetch(
            new Request('https://auth-worker/api/auth/verify', {
              method: 'GET',
              headers: {
                'Cookie': `mw_session=${cookies.mw_session}`
              }
            })
          );
          
          if (verifyResponse.ok) {
            const userData = await verifyResponse.json();
            if (userData.user) {
              isAuthenticated = true;
              
              // Optional: Check if user is admin
              // For now, any authenticated user can sync
              // Later you might want to check userData.user.role === 'admin'
            }
          }
        } catch (error) {
          console.error('Auth verification error:', error);
        }
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
          ...(result.links?.errors.slice(0, 5) || []) // First 5 link errors
        ]
      }
    });
  } catch (error) {
    console.error('Sync error:', error);
    return errorResponse(error.message || 'Sync failed', 500);
  }
}