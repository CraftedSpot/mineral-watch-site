/**
 * Documents Worker
 * Manages document uploads, storage, and retrieval for MyMineralWatch Digital Locker
 */

interface Env {
  // R2 Buckets
  UPLOADS_BUCKET: R2Bucket;
  LOCKER_BUCKET: R2Bucket;
  
  // D1 Database
  WELLS_DB: D1Database;
  
  // Service Bindings
  AUTH_WORKER: Fetcher;
  
  // Environment Variables
  ALLOWED_ORIGIN: string;
}

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  fields: {
    Email: string;
    Name?: string;
    Plan?: string;
    Organization?: string[];
    Role?: string;
  };
}

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Will be set dynamically
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};

// Helper: Get CORS headers for response
function getCorsHeaders(env: Env): HeadersInit {
  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://portal.mymineralwatch.com',
  };
}

// Helper: Authenticate user via AUTH_WORKER
async function authenticateUser(request: Request, env: Env): Promise<AuthUser | null> {
  const sessionCookie = request.headers.get('Cookie')?.match(/mw_session_v2=([^;]+)/)?.[1];
  if (!sessionCookie) return null;

  try {
    // Forward the cookie to auth-worker's /api/auth/me endpoint
    const authRequest = new Request('https://auth-worker/api/auth/me', {
      headers: { 
        'Cookie': `mw_session_v2=${sessionCookie}`
      }
    });
    
    const authResponse = await env.AUTH_WORKER.fetch(authRequest);

    if (!authResponse.ok) return null;
    return await authResponse.json();
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

// Helper: JSON Response with CORS
function jsonResponse(data: any, status = 200, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(env),
    },
  });
}

// Helper: Error Response
function errorResponse(message: string, status = 400, env: Env): Response {
  return jsonResponse({ error: message }, status, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    console.log('[Documents] Incoming request:', request.method, path);
    console.log('[Documents] Headers:', Object.fromEntries(request.headers.entries()));

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(env),
      });
    }

    // Health check
    if (path === '/health') {
      return new Response('OK');
    }

    // Route: GET /api/documents - List user's documents
    if (path === '/api/documents' && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      try {
        console.log('User authenticated:', user.id, user.email);
        console.log('User object:', JSON.stringify(user));
        
        // Build query to get documents for user or their organization
        // Handle both possible user object structures
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0];
        const conditions = [`user_id = ?`];
        const params = [user.id];
        
        if (userOrg) {
          conditions.push('organization_id = ?');
          params.push(userOrg);
        }

        const query = `
          SELECT id, filename, doc_type, county, section, township, range, 
                 confidence, status, upload_date, page_count, file_size
          FROM documents 
          WHERE (${conditions.join(' OR ')})
            AND deleted_at IS NULL
          ORDER BY upload_date DESC
        `;

        console.log('Query:', query);
        console.log('Params:', params);

        const { results } = await env.WELLS_DB.prepare(query)
          .bind(...params)
          .all();

        console.log('Results found:', results?.length || 0);
        return jsonResponse(results || [], 200, env);
      } catch (error) {
        console.error('Error listing documents:', error);
        console.error('Error details:', error.message, error.stack);
        return errorResponse(`Database error: ${error.message}`, 500, env);
      }
    }

    // Route: POST /api/documents/upload - Upload new document
    if (path === '/api/documents/upload' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      // Gate to James/Enterprise 500
      const userPlan = user.fields?.Plan || user.plan || user.Plan;
      if (user.id !== 'recEpgbS88AbuzAH8' && userPlan !== 'Enterprise 500') {
        return errorResponse('Feature not available for your plan', 403, env);
      }

      try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        
        if (!file) return errorResponse('No file provided', 400, env);
        
        // Validate file
        if (file.type !== 'application/pdf') {
          return errorResponse('Only PDF files are allowed', 400, env);
        }
        
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
          return errorResponse('File too large. Maximum size is 50MB', 400, env);
        }

        // Generate unique document ID
        const docId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const r2Key = `${docId}.pdf`;

        // Store in R2
        await env.UPLOADS_BUCKET.put(r2Key, file.stream(), {
          httpMetadata: { 
            contentType: 'application/pdf',
            contentDisposition: `attachment; filename="${file.name}"`
          }
        });

        // Create D1 record
        const userOrg = user.fields.Organization?.[0] || null;
        await env.WELLS_DB.prepare(`
          INSERT INTO documents (
            id, r2_key, filename, user_id, organization_id, 
            file_size, status, upload_date
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
        `).bind(docId, r2Key, file.name, user.id, userOrg, file.size).run();

        return jsonResponse({
          success: true,
          id: docId,
          filename: file.name,
          size: file.size,
        }, 200, env);
      } catch (error) {
        console.error('Upload error:', error);
        return errorResponse('Upload failed', 500, env);
      }
    }

    // Route: GET /api/documents/:id - Get document details
    if (path.match(/^\/api\/documents\/[^\/]+$/) && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      
      try {
        // Check access
        const userOrg = user.fields.Organization?.[0];
        const conditions = [`user_id = ?`];
        const params = [user.id];
        
        if (userOrg) {
          conditions.push('organization_id = ?');
          params.push(userOrg);
        }

        const query = `
          SELECT * FROM documents 
          WHERE id = ? 
            AND (${conditions.join(' OR ')})
            AND deleted_at IS NULL
        `;

        const doc = await env.WELLS_DB.prepare(query)
          .bind(docId, ...params)
          .first();

        if (!doc) return errorResponse('Document not found', 404, env);

        return jsonResponse(doc, 200, env);
      } catch (error) {
        console.error('Error fetching document:', error);
        return errorResponse('Failed to fetch document', 500, env);
      }
    }

    // Route: GET /api/documents/:id/download - Download original PDF
    if (path.match(/^\/api\/documents\/[^\/]+\/download$/) && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      
      try {
        // Check access
        const userOrg = user.fields.Organization?.[0];
        const conditions = [`user_id = ?`];
        const params = [user.id];
        
        if (userOrg) {
          conditions.push('organization_id = ?');
          params.push(userOrg);
        }

        const query = `
          SELECT r2_key, filename FROM documents 
          WHERE id = ? 
            AND (${conditions.join(' OR ')})
            AND deleted_at IS NULL
        `;

        const doc = await env.WELLS_DB.prepare(query)
          .bind(docId, ...params)
          .first<{ r2_key: string; filename: string }>();

        if (!doc) return errorResponse('Document not found', 404, env);

        // Get from R2
        const object = await env.UPLOADS_BUCKET.get(doc.r2_key);
        if (!object) return errorResponse('File not found', 404, env);

        // Stream the file
        return new Response(object.body, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${doc.filename}"`,
            ...getCorsHeaders(env),
          },
        });
      } catch (error) {
        console.error('Download error:', error);
        return errorResponse('Download failed', 500, env);
      }
    }

    return errorResponse('Not found', 404, env);
  },
};