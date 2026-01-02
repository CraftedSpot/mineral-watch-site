interface Env {
  WELLS_DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  LOCKER_BUCKET: R2Bucket;
  AUTH_WORKER: { fetch: (request: Request) => Promise<Response> };
  ALLOWED_ORIGIN: string;
  PROCESSING_API_KEY: string;
}

// Helper to ensure CORS headers
function corsHeaders(env: Env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function jsonResponse(data: any, status: number, env: Env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}

function errorResponse(message: string, status: number, env: Env) {
  return jsonResponse({ error: message }, status, env);
}

// Authenticate user via auth-worker
async function authenticateUser(request: Request, env: Env) {
  try {
    // Forward the request to auth-worker
    const authRequest = new Request('https://auth-worker.photog12.workers.dev/api/auth/me', {
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Cookie': request.headers.get('Cookie') || '',
      },
    });

    const authResponse = await env.AUTH_WORKER.fetch(authRequest);
    
    if (!authResponse.ok) {
      console.log('Auth failed:', authResponse.status);
      return null;
    }

    const userData = await authResponse.json();
    console.log('Authenticated user:', userData.id);
    return userData;
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

// Check if user_notes column exists and add it if not
async function ensureUserNotesColumn(env: Env) {
  try {
    // Check if column exists by trying to query it
    const testQuery = await env.WELLS_DB.prepare(
      "SELECT user_notes FROM documents LIMIT 1"
    ).first().catch(() => null);
    
    // If the query failed, add the column
    if (testQuery === null) {
      console.log('Adding user_notes column to documents table');
      await env.WELLS_DB.prepare(
        "ALTER TABLE documents ADD COLUMN user_notes TEXT"
      ).run();
      console.log('user_notes column added successfully');
    }
  } catch (error) {
    console.error('Error ensuring user_notes column:', error);
    // Continue anyway - the column might already exist
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    console.log(`${request.method} ${path}`);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(env),
      });
    }

    // Ensure user_notes column exists on first request
    if (path.includes('/documents')) {
      await ensureUserNotesColumn(env);
    }

    // Route: GET /api/documents - List documents
    if (path === '/api/documents' && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      try {
        // Build query to show user's docs OR organization's docs
        const conditions = ['user_id = ?'];
        const params = [user.id];
        
        // Handle different ways org might be stored
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;
        
        if (userOrg) {
          conditions.push('organization_id = ?');
          params.push(userOrg);
        }

        const query = `
          SELECT id, filename, doc_type, county, section, township, range, 
                 confidence, status, upload_date, page_count, file_size, extracted_data, user_notes
          FROM documents 
          WHERE (${conditions.join(' OR ')})
            AND deleted_at IS NULL
          ORDER BY upload_date DESC
        `;

        console.log('Query:', query);
        console.log('Params:', params);

        const results = await env.WELLS_DB.prepare(query).bind(...params).all();
        
        console.log(`Found ${results.results.length} documents`);
        
        return jsonResponse({ documents: results.results }, 200, env);
      } catch (error) {
        console.error('List documents error:', error);
        return errorResponse('Failed to fetch documents', 500, env);
      }
    }

    // Route: POST /api/documents/upload - Upload single document
    if (path === '/api/documents/upload' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        
        if (!file) {
          return errorResponse('No file provided', 400, env);
        }

        // Validate file type
        if (file.type !== 'application/pdf') {
          return errorResponse('Only PDF files are allowed', 400, env);
        }
        
        if (file.size > 100 * 1024 * 1024) { // 100MB limit
          return errorResponse('File too large. Maximum size is 100MB', 400, env);
        }

        // Generate unique document ID
        const docId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const r2Key = `${docId}.pdf`;

        console.log('Uploading to R2:', r2Key);

        // Store in R2
        await env.UPLOADS_BUCKET.put(r2Key, file.stream(), {
          httpMetadata: { 
            contentType: 'application/pdf',
            contentDisposition: `attachment; filename="${file.name}"`
          }
        });

        console.log('Stored in R2, creating DB record');

        // Get user's organization
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;

        // Create record in D1
        await env.WELLS_DB.prepare(`
          INSERT INTO documents (
            id, r2_key, filename, user_id, organization_id, 
            file_size, status, upload_date
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
        `).bind(docId, r2Key, file.name, user.id, userOrg, file.size).run();

        console.log('Document uploaded successfully:', docId);

        return jsonResponse({
          success: true,
          document: {
            id: docId,
            filename: file.name,
            size: file.size,
            status: 'pending'
          }
        }, 200, env);
      } catch (error) {
        console.error('Upload error:', error);
        return errorResponse('Upload failed', 500, env);
      }
    }

    // Route: POST /api/documents/upload-multiple - Upload multiple documents
    if (path === '/api/documents/upload-multiple' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      // Gate to James/Enterprise 500
      const userPlan = user.fields?.Plan || user.plan || user.Plan;
      if (user.id !== 'recEpgbS88AbuzAH8' && userPlan !== 'Enterprise 500') {
        return errorResponse('Feature not available for your plan', 403, env);
      }

      try {
        const formData = await request.formData();
        const files = formData.getAll('files') as File[];
        
        if (!files || files.length === 0) {
          return errorResponse('No files provided', 400, env);
        }

        // Limit number of files
        if (files.length > 10) {
          return errorResponse('Maximum 10 files can be uploaded at once', 400, env);
        }

        const results = [];
        const errors = [];
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;

        // Process each file
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          try {
            // Validate file
            if (file.type !== 'application/pdf') {
              errors.push({
                filename: file.name,
                error: 'Only PDF files are allowed'
              });
              continue;
            }
            
            if (file.size > 100 * 1024 * 1024) { // 100MB limit
              errors.push({
                filename: file.name,
                error: 'File too large. Maximum size is 100MB'
              });
              continue;
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
            await env.WELLS_DB.prepare(`
              INSERT INTO documents (
                id, r2_key, filename, user_id, organization_id, 
                file_size, status, upload_date
              ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
            `).bind(docId, r2Key, file.name, user.id, userOrg, file.size).run();

            results.push({
              success: true,
              id: docId,
              filename: file.name,
              size: file.size,
            });
          } catch (fileError) {
            console.error(`Error uploading file ${file.name}:`, fileError);
            errors.push({
              filename: file.name,
              error: 'Upload failed'
            });
          }
        }

        return jsonResponse({
          uploaded: results.length,
          failed: errors.length,
          results,
          errors,
        }, 200, env);
      } catch (error) {
        console.error('Multi-upload error:', error);
        return errorResponse('Multi-upload failed', 500, env);
      }
    }

    // Route: GET /api/documents/:id - Get document details
    if (path.match(/^\/api\/documents\/[^\/]+$/) && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      console.log('Get document:', docId);

      try {
        // Build query to check user's docs OR organization's docs
        const conditions = ['user_id = ?'];
        const params = [user.id];
        
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;
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

        const doc = await env.WELLS_DB.prepare(query).bind(docId, ...params).first();

        if (!doc) {
          return errorResponse('Document not found', 404, env);
        }

        return jsonResponse({ document: doc }, 200, env);
      } catch (error) {
        console.error('Get document error:', error);
        return errorResponse('Failed to get document', 500, env);
      }
    }

    // Route: GET /api/documents/:id/download - Download document
    if (path.match(/^\/api\/documents\/[^\/]+\/download$/) && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      console.log('Download document:', docId);

      try {
        // Check access
        const conditions = ['user_id = ?'];
        const params = [user.id];
        
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;
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

        const doc = await env.WELLS_DB.prepare(query).bind(docId, ...params).first();

        if (!doc) {
          return errorResponse('Document not found', 404, env);
        }

        // Get from R2
        const object = await env.UPLOADS_BUCKET.get(doc.r2_key);
        
        if (!object) {
          return errorResponse('File not found in storage', 404, env);
        }

        // Return the PDF with appropriate headers
        return new Response(object.body, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${doc.filename}"`,
            ...corsHeaders(env),
          },
        });
      } catch (error) {
        console.error('Download error:', error);
        return errorResponse('Download failed', 500, env);
      }
    }

    // Route: GET /api/documents/:id/view - View document (inline)
    if (path.match(/^\/api\/documents\/[^\/]+\/view$/) && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      console.log('View document:', docId);

      try {
        // Same access check as download
        const conditions = ['user_id = ?'];
        const params = [user.id];
        
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;
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

        const doc = await env.WELLS_DB.prepare(query).bind(docId, ...params).first();

        if (!doc) {
          return errorResponse('Document not found', 404, env);
        }

        // Get from R2
        const object = await env.UPLOADS_BUCKET.get(doc.r2_key);
        
        if (!object) {
          return errorResponse('File not found in storage', 404, env);
        }

        // Return the PDF for inline viewing
        return new Response(object.body, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${doc.filename}"`,
            ...corsHeaders(env),
          },
        });
      } catch (error) {
        console.error('View error:', error);
        return errorResponse('View failed', 500, env);
      }
    }

    // Route: DELETE /api/documents/:id - Delete document
    if (path.match(/^\/api\/documents\/[^\/]+$/) && request.method === 'DELETE') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      console.log('Delete document:', docId);

      try {
        // Check ownership
        const conditions = ['user_id = ?'];
        const params = [user.id];
        
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;
        if (userOrg) {
          conditions.push('organization_id = ?');
          params.push(userOrg);
        }

        const query = `
          SELECT id, r2_key FROM documents 
          WHERE id = ? 
            AND (${conditions.join(' OR ')})
            AND deleted_at IS NULL
        `;

        const doc = await env.WELLS_DB.prepare(query).bind(docId, ...params).first();

        if (!doc) {
          return errorResponse('Document not found', 404, env);
        }

        // Soft delete in database
        await env.WELLS_DB.prepare(`
          UPDATE documents 
          SET deleted_at = datetime('now') 
          WHERE id = ?
        `).bind(docId).run();

        // Delete from R2
        try {
          await env.UPLOADS_BUCKET.delete(doc.r2_key);
          console.log('Deleted from R2:', doc.r2_key);
        } catch (r2Error) {
          console.error('Failed to delete from R2:', r2Error);
          // Continue anyway - the DB record is already soft deleted
        }

        return jsonResponse({ success: true }, 200, env);
      } catch (error) {
        console.error('Delete document error:', error);
        return errorResponse('Failed to delete document', 500, env);
      }
    }

    // Route: PUT /api/documents/:id/notes - Update document notes
    if (path.match(/^\/api\/documents\/[^\/]+\/notes$/) && request.method === 'PUT') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      console.log('Updating notes for document:', docId);

      try {
        // Check if document exists and user has access
        const conditions = ['user_id = ?'];
        const params = [user.id];
        
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;
        if (userOrg) {
          conditions.push('organization_id = ?');
          params.push(userOrg);
        }

        const query = `
          SELECT id FROM documents 
          WHERE id = ? 
            AND (${conditions.join(' OR ')})
            AND deleted_at IS NULL
        `;
        
        const doc = await env.WELLS_DB.prepare(query).bind(docId, ...params).first();
        if (!doc) {
          return errorResponse('Document not found or access denied', 404, env);
        }

        // Get the notes from request body
        const { notes } = await request.json();
        
        // Update the notes
        await env.WELLS_DB.prepare(`
          UPDATE documents 
          SET user_notes = ?
          WHERE id = ?
        `).bind(notes, docId).run();

        return jsonResponse({ success: true, notes }, 200, env);
      } catch (error) {
        console.error('Update notes error:', error);
        return errorResponse('Failed to update notes', 500, env);
      }
    }

    return errorResponse('Not found', 404, env);
  },
};