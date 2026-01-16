import { linkDocumentToEntities, ensureLinkColumns } from './link-documents';
import { migrateDocumentIds } from './migrate-document-ids';
import { UsageTrackingService } from './services/usage-tracking';

interface Env {
  WELLS_DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  LOCKER_BUCKET: R2Bucket;
  AUTH_WORKER: { fetch: (request: Request) => Promise<Response> };
  OCC_FETCHER: { fetch: (request: Request) => Promise<Response> };
  ALLOWED_ORIGIN: string;
  PROCESSING_API_KEY: string;
  SYNC_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
}

// Credit pack pricing - must match Stripe product prices (LIVE MODE)
const CREDIT_PACK_PRICES: Record<string, { credits: number; name: string; price: number }> = {
  'price_1SpV6u9OfJmRCDOqmiQGFg2V': { credits: 100, name: 'Starter Pack', price: 4900 },
  'price_1SpVCK9OfJmRCDOq8r8NrrqJ': { credits: 500, name: 'Working Pack', price: 19900 },
  'price_1SpVCK9OfJmRCDOqhjfa5Na1': { credits: 2000, name: 'Team Pack', price: 69900 },
  'price_1SpVCK9OfJmRCDOqNVkGVLVQ': { credits: 10000, name: 'Operations Pack', price: 249900 },
};

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

// Allowed file types for document uploads
const ALLOWED_FILE_TYPES: Record<string, { extension: string; canViewInline: boolean }> = {
  'application/pdf': { extension: 'pdf', canViewInline: true },
  'image/jpeg': { extension: 'jpg', canViewInline: true },
  'image/png': { extension: 'png', canViewInline: true },
  'image/tiff': { extension: 'tiff', canViewInline: false }, // Download only
};

function isAllowedFileType(mimeType: string): boolean {
  return mimeType in ALLOWED_FILE_TYPES;
}

function getFileExtension(mimeType: string): string {
  return ALLOWED_FILE_TYPES[mimeType]?.extension || 'bin';
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

// Ensure all processing columns exist
async function ensureProcessingColumns(env: Env) {
  const columnsToAdd = [
    { name: 'display_name', type: 'TEXT' },
    { name: 'original_filename', type: 'TEXT' },
    { name: 'category', type: 'TEXT DEFAULT "pending"' },
    { name: 'needs_review', type: 'INTEGER DEFAULT 0' },
    { name: 'field_scores', type: 'TEXT' },
    { name: 'fields_needing_review', type: 'TEXT' },
    { name: 'queued_at', type: 'TEXT' },
    { name: 'processing_attempts', type: 'INTEGER DEFAULT 0' },
    { name: 'parent_document_id', type: 'TEXT' },
    { name: 'page_range_start', type: 'INTEGER' },
    { name: 'page_range_end', type: 'INTEGER' },
    { name: 'extraction_started_at', type: 'TEXT' },
    { name: 'extraction_completed_at', type: 'TEXT' },
    { name: 'extraction_error', type: 'TEXT' },
    { name: 'source_metadata', type: 'TEXT' }  // JSON: { type, api, url, uploadedAt }
  ];

  for (const column of columnsToAdd) {
    try {
      // Try to query the column
      await env.WELLS_DB.prepare(
        `SELECT ${column.name} FROM documents LIMIT 1`
      ).first().catch(async () => {
        // Column doesn't exist, add it
        console.log(`Adding ${column.name} column to documents table`);
        await env.WELLS_DB.prepare(
          `ALTER TABLE documents ADD COLUMN ${column.name} ${column.type}`
        ).run();
        console.log(`${column.name} column added successfully`);
      });
    } catch (error) {
      console.error(`Error checking/adding column ${column.name}:`, error);
    }
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
    
    // Route: POST /api/documents/migrate-ids - One-time migration of document IDs
    if (path === '/api/documents/migrate-ids' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);
      
      // Only allow James to run migration
      if (user.fields?.Email !== 'james@jfp.one') {
        return errorResponse('Forbidden', 403, env);
      }
      
      try {
        await migrateDocumentIds(env.WELLS_DB);
        return new Response(JSON.stringify({ success: true, message: 'Migration completed' }), {
          status: 200,
          headers: corsHeaders(env, 'application/json')
        });
      } catch (error) {
        console.error('Migration error:', error);
        return errorResponse('Migration failed', 500, env);
      }
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
                 confidence, status, upload_date, page_count, file_size, extracted_data, user_notes,
                 display_name, category, needs_review, field_scores, fields_needing_review, content_type,
                 rotation_applied
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

    // Route: GET /api/documents/usage - Get current usage stats
    if (path === '/api/documents/usage' && request.method === 'GET') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      try {
        const usageService = new UsageTrackingService(env.WELLS_DB);
        const userPlan = user.fields?.Plan || user.plan || user.Plan || 'Free';
        // Use organization ID if user is part of an org, otherwise use user ID
        const creditUserId = user.organizationId || user.id;
        const usage = await usageService.getUsageStats(creditUserId, userPlan);
        const creditCheck = await usageService.checkCreditsAvailable(creditUserId, userPlan);

        return jsonResponse({
          usage: usage,
          plan: userPlan,
          credits: {
            hasCredits: creditCheck.hasCredits,
            monthlyRemaining: creditCheck.monthlyRemaining,
            permanentRemaining: creditCheck.permanentRemaining,
            totalAvailable: creditCheck.totalAvailable
          }
        }, 200, env);
      } catch (error) {
        console.error('Usage stats error:', error);
        return errorResponse('Failed to get usage stats', 500, env);
      }
    }

    // Route: GET /api/documents/by-occ-cases - Check which OCC cases have been analyzed
    if (path === '/api/documents/by-occ-cases' && request.method === 'GET') {
      console.log(`[by-occ-cases] Route matched! Full URL: ${request.url}`);
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const casesParam = url.searchParams.get('cases');
      console.log(`[by-occ-cases] casesParam: ${casesParam}`);
      if (!casesParam) {
        console.log(`[by-occ-cases] No cases param, returning empty`);
        return jsonResponse({}, 200, env);
      }

      // Parse comma-separated case numbers
      const caseNumbers = casesParam.split(',').map(c => c.trim()).filter(Boolean);
      if (caseNumbers.length === 0) {
        return jsonResponse({}, 200, env);
      }

      try {
        // Query documents with these case numbers in source_metadata
        const placeholders = caseNumbers.map(() => '?').join(',');
        const cleanCaseNumbers = caseNumbers.map(c => c.replace(/^CD\s*/i, ''));

        console.log(`[by-occ-cases] User object:`, JSON.stringify(user));
        console.log(`[by-occ-cases] User ID: ${user.id}, searching for: ${cleanCaseNumbers.join(', ')}`);

        const results = await env.WELLS_DB.prepare(`
          SELECT
            id,
            display_name,
            status,
            source_metadata
          FROM documents
          WHERE user_id = ?
          AND deleted_at IS NULL
          AND json_extract(source_metadata, '$.caseNumber') IN (${placeholders})
        `).bind(user.id, ...cleanCaseNumbers).all();

        console.log(`[by-occ-cases] Found ${results.results?.length || 0} documents with json_extract`);

        // If no results with json_extract, try LIKE fallback
        let finalResults = results.results || [];
        if (finalResults.length === 0 && cleanCaseNumbers.length > 0) {
          console.log(`[by-occ-cases] Trying LIKE fallback...`);
          // Build LIKE conditions for each case number
          const likeConditions = cleanCaseNumbers.map(() => `source_metadata LIKE ?`).join(' OR ');
          const likeParams = cleanCaseNumbers.map(cn => `%"caseNumber":"${cn}"%`);

          const fallbackResults = await env.WELLS_DB.prepare(`
            SELECT id, display_name, status, source_metadata
            FROM documents
            WHERE user_id = ?
            AND deleted_at IS NULL
            AND (${likeConditions})
          `).bind(user.id, ...likeParams).all();

          console.log(`[by-occ-cases] LIKE fallback found ${fallbackResults.results?.length || 0} documents`);
          finalResults = fallbackResults.results || [];
        }

        // Build response map: { caseNumber: { documentId, displayName, status } }
        const analyzed: Record<string, { documentId: string; displayName: string; status: string }> = {};

        for (const doc of finalResults) {
          try {
            const metadata = JSON.parse(doc.source_metadata as string || '{}');
            console.log(`[by-occ-cases] Doc ${doc.id}: caseNumber=${metadata.caseNumber}, status=${doc.status}`);
            const caseNum = metadata.caseNumber;
            if (caseNum) {
              // Store with both CD prefix and without for easy lookup
              analyzed[caseNum] = {
                documentId: doc.id as string,
                displayName: doc.display_name as string || '',
                status: doc.status as string
              };
              analyzed[`CD${caseNum}`] = analyzed[caseNum];
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }

        return jsonResponse(analyzed, 200, env);
      } catch (error) {
        console.error('By OCC cases error:', error);
        return errorResponse('Failed to check analyzed cases', 500, env);
      }
    }

    // Route: POST /api/documents/relink - Re-link user's unlinked documents to properties/wells
    if (path === '/api/documents/relink' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      console.log(`[Documents] Starting re-link for user ${user.id}`);

      try {
        // Get user's documents that have extracted data but no property/well link
        const documents = await env.WELLS_DB.prepare(`
          SELECT id, extracted_data, filename
          FROM documents
          WHERE user_id = ?
          AND deleted_at IS NULL
          AND extracted_data IS NOT NULL
          AND status = 'completed'
          AND (property_id IS NULL AND well_id IS NULL)
        `).bind(user.id).all();

        console.log(`[Documents] Found ${documents.results.length} unlinked documents for user ${user.id}`);

        let linked = 0;
        let propertyLinks = 0;
        let wellLinks = 0;
        const linkedDocs: string[] = [];

        // Process each unlinked document
        for (const doc of documents.results) {
          try {
            if (!doc.extracted_data) continue;

            // Parse extracted data if it's a string
            const extractedData = typeof doc.extracted_data === 'string'
              ? JSON.parse(doc.extracted_data as string)
              : doc.extracted_data;

            console.log(`[Documents] Re-linking document ${doc.id} (${doc.filename})`);
            const linkResult = await linkDocumentToEntities(
              env.WELLS_DB,
              doc.id as string,
              extractedData
            );

            if (linkResult.propertyId || linkResult.wellId) {
              linked++;
              if (linkResult.propertyId) propertyLinks++;
              if (linkResult.wellId) wellLinks++;
              linkedDocs.push(doc.filename as string);
              console.log(`[Documents] Successfully linked ${doc.id} - Property: ${linkResult.propertyId}, Well: ${linkResult.wellId}`);
            }
          } catch (error) {
            console.error(`[Documents] Failed to re-link document ${doc.id}:`, error);
          }
        }

        console.log(`[Documents] Re-link complete for user ${user.id} - Linked: ${linked}/${documents.results.length}`);

        return jsonResponse({
          success: true,
          total: documents.results.length,
          linked,
          propertyLinks,
          wellLinks,
          linkedDocuments: linkedDocs
        }, 200, env);
      } catch (error) {
        console.error('[Documents] Re-link error:', error);
        return errorResponse('Failed to re-link documents', 500, env);
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
        if (!isAllowedFileType(file.type)) {
          return errorResponse('Only PDF, JPEG, PNG, and TIFF files are allowed', 400, env);
        }

        if (file.size > 50 * 1024 * 1024) { // 50MB limit
          return errorResponse('File too large. Maximum size is 50MB', 400, env);
        }

        // Generate unique document ID with correct extension
        const docId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const fileExtension = getFileExtension(file.type);
        const r2Key = `${docId}.${fileExtension}`;

        console.log('Uploading to R2:', r2Key, 'type:', file.type);

        // Store in R2 with correct content type
        await env.UPLOADS_BUCKET.put(r2Key, file.stream(), {
          httpMetadata: {
            contentType: file.type,
            contentDisposition: `attachment; filename="${file.name}"`
          }
        });

        console.log('Stored in R2, creating DB record');

        // Get user's organization and plan
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;
        const userPlan = user.fields?.Plan || user.plan || user.Plan || 'Free';

        // All files (PDF and images) go to pending status for processing
        // The processor handles different file types appropriately
        await env.WELLS_DB.prepare(`
          INSERT INTO documents (
            id, r2_key, filename, original_filename, user_id, organization_id,
            file_size, status, upload_date, queued_at, user_plan, content_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?)
        `).bind(docId, r2Key, file.name, file.name, user.id, userOrg, file.size, userPlan, file.type).run();

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

      // Gate to James/Business+
      const userPlan = user.fields?.Plan || user.plan || user.Plan;
      if (user.id !== 'recEpgbS88AbuzAH8' && userPlan !== 'Business' && userPlan !== 'Enterprise') {
        return errorResponse('Feature not available for your plan', 403, env);
      }

      try {
        const formData = await request.formData();
        const files = formData.getAll('files') as File[];
        
        if (!files || files.length === 0) {
          return errorResponse('No files provided', 400, env);
        }

        // Limit number of files
        if (files.length > 500) {
          return errorResponse('Maximum 500 files can be uploaded at once', 400, env);
        }
        
        // Check total size limit (500MB)
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        const maxTotalSize = 500 * 1024 * 1024; // 500MB
        
        if (totalSize > maxTotalSize) {
          return errorResponse(`Total file size exceeds 500MB limit. Current total: ${(totalSize / 1024 / 1024).toFixed(1)}MB`, 400, env);
        }

        const results = [];
        const errors = [];
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;

        // Process each file
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          try {
            // Validate file
            if (!isAllowedFileType(file.type)) {
              errors.push({
                filename: file.name,
                error: 'Only PDF, JPEG, PNG, and TIFF files are allowed'
              });
              continue;
            }

            if (file.size > 50 * 1024 * 1024) { // 50MB limit
              errors.push({
                filename: file.name,
                error: 'File too large. Maximum size is 50MB'
              });
              continue;
            }

            // Generate unique document ID with correct extension
            const docId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            const fileExtension = getFileExtension(file.type);
            const r2Key = `${docId}.${fileExtension}`;

            // Store in R2 with correct content type
            await env.UPLOADS_BUCKET.put(r2Key, file.stream(), {
              httpMetadata: {
                contentType: file.type,
                contentDisposition: `attachment; filename="${file.name}"`
              }
            });

            // All files (PDF and images) go to pending status for processing
            await env.WELLS_DB.prepare(`
              INSERT INTO documents (
                id, r2_key, filename, original_filename, user_id, organization_id,
                file_size, status, upload_date, queued_at, user_plan, content_type
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?)
            `).bind(docId, r2Key, file.name, file.name, user.id, userOrg, file.size, userPlan || 'Free', file.type).run();

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

        // Query document without property JOIN - we'll fetch properties separately
        const query = `
          SELECT
            d.*,
            w.well_name,
            w.api_number as well_api_number
          FROM documents d
          LEFT JOIN wells w ON d.well_id = w.airtable_record_id
          WHERE d.id = ?
            AND (d.${conditions.join(' OR d.')})
            AND d.deleted_at IS NULL
        `;

        console.log('Fetching document with query:', query);
        console.log('Query params:', [docId, ...params]);

        const doc = await env.WELLS_DB.prepare(query).bind(docId, ...params).first();

        if (!doc) {
          console.log('Document not found for ID:', docId);
          return errorResponse('Document not found', 404, env);
        }

        console.log('Document found:', doc.id, doc.filename);

        // Fetch ALL linked properties if property_id is set
        let linked_properties: any[] = [];
        if (doc.property_id) {
          const propertyIds = (doc.property_id as string).split(',').map(id => id.trim()).filter(id => id);
          console.log('Fetching linked properties:', propertyIds);

          if (propertyIds.length > 0) {
            // Build query with placeholders for each property ID
            const placeholders = propertyIds.map(() => '?').join(', ');
            const propsResult = await env.WELLS_DB.prepare(`
              SELECT airtable_record_id, county, section, township, range, meridian, group_name
              FROM properties
              WHERE airtable_record_id IN (${placeholders})
            `).bind(...propertyIds).all();

            linked_properties = (propsResult.results || []).map((p: any) => {
              const meridianSuffix = p.meridian ? `-${p.meridian}` : '';
              const locationName = `S${p.section}-T${p.township}-R${p.range}${meridianSuffix} (${p.county})`;
              return {
                id: p.airtable_record_id,
                section: p.section,
                township: p.township,
                range: p.range,
                county: p.county,
                meridian: p.meridian,
                group_name: p.group_name || null,
                name: p.group_name ? `${locationName} - ${p.group_name}` : locationName
              };
            });
            console.log('Found linked properties:', linked_properties.length);
          }
        }

        // Check for child documents - wrap in try/catch for safety
        let children = [];
        let child_count = 0;

        console.log('Checking for children of document:', docId);
        try {
          const childrenResult = await env.WELLS_DB.prepare(`
            SELECT id, display_name, filename, status, doc_type, county, confidence,
                   page_range_start, page_range_end
            FROM documents
            WHERE parent_document_id = ?
              AND deleted_at IS NULL
            ORDER BY page_range_start ASC
          `).bind(docId).all();

          children = childrenResult.results || [];
          child_count = children.length;
          console.log('Found', child_count, 'children for document', docId);
        } catch (childError) {
          console.error('Error fetching child documents:', childError);
          // Continue without children data if query fails
        }

        // For backwards compatibility, also set property_name from first linked property
        const property_name = linked_properties.length > 0 ? linked_properties[0].name : null;

        // Add children and linked data to response
        const documentWithChildren = {
          ...doc,
          children,
          child_count,
          // Array of all linked properties
          linked_properties,
          // For backwards compatibility - first property name
          property_name: property_name,
          // Add well name and API number if we have well data
          well_name: doc.well_name || null,
          well_api_number: doc.well_api_number || null
        };

        console.log('Returning document with children and linked data:', {
          doc_id: documentWithChildren.id,
          children_count: documentWithChildren.child_count,
          has_children: documentWithChildren.children.length > 0,
          property_id: documentWithChildren.property_id,
          linked_properties_count: documentWithChildren.linked_properties.length,
          well_id: documentWithChildren.well_id,
          well_name: documentWithChildren.well_name,
          well_api_number: documentWithChildren.well_api_number
        });

        return jsonResponse({ document: documentWithChildren }, 200, env);
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
          SELECT r2_key, filename, display_name, content_type FROM documents
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

        // Use display_name if available, otherwise fallback to filename
        let downloadName = doc.display_name || doc.filename;
        // Get the correct content type (default to pdf for legacy docs)
        const contentType = doc.content_type || 'application/pdf';

        // Ensure filename has the correct extension based on content type
        const extensionMap: Record<string, string> = {
          'application/pdf': '.pdf',
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/tiff': '.tiff',
        };
        const expectedExt = extensionMap[contentType];
        if (expectedExt && !downloadName.toLowerCase().endsWith(expectedExt)) {
          downloadName = downloadName + expectedExt;
        }

        // Return file with appropriate headers
        return new Response(object.body, {
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${downloadName}"`,
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
          SELECT r2_key, filename, display_name, content_type FROM documents
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

        // Use display_name if available, otherwise fallback to filename
        const viewName = doc.display_name || doc.filename;
        // Get the correct content type (default to pdf for legacy docs)
        const contentType = doc.content_type || 'application/pdf';

        // Return file for inline viewing
        return new Response(object.body, {
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `inline; filename="${viewName}"`,
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
          SET deleted_at = datetime('now', '-6 hours') 
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

    // Route: PUT /api/documents/:id/link - Manually link document to property/well
    if (path.match(/^\/api\/documents\/[^\/]+\/link$/) && request.method === 'PUT') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      const docId = path.split('/')[3];
      console.log('Manually linking document:', docId);

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

        // Get the link data from request body
        const { property_id, well_id } = await request.json() as { property_id?: string; well_id?: string };

        // Update the links (can set one or both, or clear by passing null)
        const updates: string[] = [];
        const updateParams: (string | null)[] = [];

        if (property_id !== undefined) {
          updates.push('property_id = ?');
          updateParams.push(property_id);

          // Also fetch and set property_name
          if (property_id) {
            const prop = await env.WELLS_DB.prepare(`
              SELECT county, section, township, range FROM properties WHERE airtable_record_id = ?
            `).bind(property_id).first();
            if (prop) {
              updates.push('property_name = ?');
              updateParams.push(`${prop.county} ${prop.section}-${prop.township}-${prop.range}`);
            }
          } else {
            updates.push('property_name = NULL');
          }
        }

        if (well_id !== undefined) {
          updates.push('well_id = ?');
          updateParams.push(well_id);

          // Also fetch and set well_name
          if (well_id) {
            const well = await env.WELLS_DB.prepare(`
              SELECT well_name FROM wells WHERE api_number = ?
            `).bind(well_id).first();
            if (well) {
              updates.push('well_name = ?');
              updateParams.push(well.well_name as string);
            }
          } else {
            updates.push('well_name = NULL');
          }
        }

        if (updates.length === 0) {
          return errorResponse('No link data provided', 400, env);
        }

        await env.WELLS_DB.prepare(`
          UPDATE documents
          SET ${updates.join(', ')}
          WHERE id = ?
        `).bind(...updateParams, docId).run();

        console.log(`[Documents] Manually linked document ${docId} - Property: ${property_id}, Well: ${well_id}`);

        return jsonResponse({ success: true, property_id, well_id }, 200, env);
      } catch (error) {
        console.error('Manual link error:', error);
        return errorResponse('Failed to link document', 500, env);
      }
    }

    // ===== PROCESSING API ENDPOINTS =====
    // These endpoints are for the external processor service

    // Route: GET /api/processing/queue - Get queued documents for processing
    if (path === '/api/processing/queue' && request.method === 'GET') {
      // Verify processing API key
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      // Ensure processing columns exist
      await ensureProcessingColumns(env);
      await ensureLinkColumns(env.WELLS_DB);
      
      // Run migration on first processing call
      try {
        await migrateDocumentIds(env.WELLS_DB);
      } catch (migrationError) {
        console.error('Migration error (non-fatal):', migrationError);
      }

      try {
        // Reset documents stuck in 'processing' for more than 10 minutes
        // This handles cases where the processor crashes mid-processing
        await env.WELLS_DB.prepare(`
          UPDATE documents
          SET status = 'pending'
          WHERE status = 'processing'
            AND processing_attempts < 3
            AND deleted_at IS NULL
            AND extraction_started_at < datetime('now', '-6 hours', '-10 minutes')
        `).run();

        // Get documents with status='pending' that haven't exceeded retry limit
        // Include user_plan for credit checks and content_type for file type detection
        const results = await env.WELLS_DB.prepare(`
          SELECT id, r2_key, filename, original_filename, user_id, organization_id,
                 file_size, upload_date, page_count, processing_attempts, user_plan, content_type
          FROM documents
          WHERE status = 'pending'
            AND processing_attempts < 3
            AND deleted_at IS NULL
          ORDER BY upload_date ASC
          LIMIT 20
        `).all();

        if (results.results.length === 0) {
          return jsonResponse({ documents: [], count: 0 }, 200, env);
        }

        // Check credits for each user and separate documents
        const usageService = new UsageTrackingService(env.WELLS_DB);
        const userCreditCache: Record<string, { hasCredits: boolean; creditsRemaining: number }> = {};
        const docsToProcess: any[] = [];
        const docsNoCredits: string[] = [];

        for (const doc of results.results) {
          const userId = doc.user_id as string;
          const userPlan = (doc.user_plan as string) || 'Free';

          // Check credit cache or fetch
          if (!(userId in userCreditCache)) {
            const creditCheck = await usageService.checkCreditsAvailable(userId, userPlan);
            userCreditCache[userId] = {
              hasCredits: creditCheck.hasCredits,
              creditsRemaining: creditCheck.totalAvailable
            };
          }

          const userCredits = userCreditCache[userId];

          if (userCredits.hasCredits && userCredits.creditsRemaining > 0) {
            docsToProcess.push(doc);
            // Decrement the cached count for subsequent docs from same user
            userCreditCache[userId].creditsRemaining--;
            if (userCreditCache[userId].creditsRemaining <= 0) {
              userCreditCache[userId].hasCredits = false;
            }
          } else {
            docsNoCredits.push(doc.id as string);
          }

          // Limit to 10 docs that can actually be processed
          if (docsToProcess.length >= 10) break;
        }

        // Mark documents without credits as 'unprocessed'
        if (docsNoCredits.length > 0) {
          const placeholders = docsNoCredits.map(() => '?').join(',');
          await env.WELLS_DB.prepare(`
            UPDATE documents
            SET status = 'unprocessed',
                updated_at = datetime('now', '-6 hours')
            WHERE id IN (${placeholders})
          `).bind(...docsNoCredits).run();
          console.log(`[Queue] Marked ${docsNoCredits.length} documents as 'unprocessed' (no credits)`);
        }

        // Mark documents with credits as 'processing'
        if (docsToProcess.length > 0) {
          const docIds = docsToProcess.map(doc => doc.id);
          const placeholders = docIds.map(() => '?').join(',');
          await env.WELLS_DB.prepare(`
            UPDATE documents
            SET status = 'processing',
                extraction_started_at = datetime('now', '-6 hours'),
                processing_attempts = processing_attempts + 1
            WHERE id IN (${placeholders})
          `).bind(...docIds).run();
        }

        return jsonResponse({
          documents: docsToProcess,
          count: docsToProcess.length,
          unprocessed_count: docsNoCredits.length
        }, 200, env);
      } catch (error) {
        console.error('Queue error:', error);
        return errorResponse('Failed to get queue', 500, env);
      }
    }

    // Route: GET /api/processing/download/:id - Get signed URL for document download
    if (path.match(/^\/api\/processing\/download\/[^\/]+$/) && request.method === 'GET') {
      // Verify processing API key
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      const docId = path.split('/')[4];

      try {
        // Mark as extraction started
        await env.WELLS_DB.prepare(`
          UPDATE documents 
          SET extraction_started_at = datetime('now', '-6 hours')
          WHERE id = ? AND extraction_started_at IS NULL
        `).bind(docId).run();

        // Get document info including content_type
        const doc = await env.WELLS_DB.prepare(`
          SELECT r2_key, filename, display_name, content_type
          FROM documents
          WHERE id = ? AND deleted_at IS NULL
        `).bind(docId).first();

        if (!doc) {
          return errorResponse('Document not found', 404, env);
        }

        // Generate a temporary signed URL for R2 (valid for 1 hour)
        // For now, we'll return the direct download endpoint
        // In production, you might want to use R2's presigned URLs
        const downloadUrl = `https://${new URL(request.url).hostname}/api/processing/direct-download/${docId}`;

        // Use display_name if available, keep original filename/extension
        const downloadName = doc.display_name || doc.filename;

        return jsonResponse({
          url: downloadUrl,
          filename: downloadName,
          r2_key: doc.r2_key,
          content_type: doc.content_type || 'application/pdf'
        }, 200, env);
      } catch (error) {
        console.error('Download URL error:', error);
        return errorResponse('Failed to generate download URL', 500, env);
      }
    }

    // Route: GET /api/processing/direct-download/:id - Direct download for processor
    if (path.match(/^\/api\/processing\/direct-download\/[^\/]+$/) && request.method === 'GET') {
      // Verify processing API key
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      const docId = path.split('/')[4];

      try {
        const doc = await env.WELLS_DB.prepare(`
          SELECT r2_key, filename, display_name, content_type
          FROM documents
          WHERE id = ? AND deleted_at IS NULL
        `).bind(docId).first();

        if (!doc) {
          return errorResponse('Document not found', 404, env);
        }

        const object = await env.UPLOADS_BUCKET.get(doc.r2_key);
        if (!object) {
          return errorResponse('File not found in storage', 404, env);
        }

        // Use display_name if available, keep original filename
        const downloadName = doc.display_name || doc.filename;
        // Use stored content_type or default to PDF for legacy documents
        const contentType = doc.content_type || 'application/pdf';

        return new Response(object.body, {
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${downloadName}"`,
            ...corsHeaders(env),
          },
        });
      } catch (error) {
        console.error('Direct download error:', error);
        return errorResponse('Download failed', 500, env);
      }
    }

    // Route: POST /api/processing/complete/:id - Update document with extraction results
    if (path.match(/^\/api\/processing\/complete\/[^\/]+$/) && request.method === 'POST') {
      // Verify processing API key
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      const docId = path.split('/')[4];

      // Ensure all processing columns exist
      try {
        await ensureProcessingColumns(env);
        await ensureLinkColumns(env.WELLS_DB);
      } catch (columnError) {
        console.error('Failed to ensure processing columns:', columnError);
        return errorResponse('Database column check failed: ' + (columnError instanceof Error ? columnError.message : String(columnError)), 500, env);
      }

      let data: any;
      try {
        try {
          data = await request.json();
        } catch (jsonError) {
          console.error('Failed to parse request JSON:', jsonError);
          return errorResponse('Invalid JSON in request body', 400, env);
        }
        
        const {
          status,
          extracted_data,
          doc_type,
          county,
          section,
          township,
          range,
          confidence,
          page_count,
          extraction_error,
          display_name,
          category,
          needs_review,
          field_scores,
          fields_needing_review,
          rotation_applied
        } = data;

        // Update the document with extraction results
        // Handle both success and failure cases
        if (status === 'failed') {
          // For failed documents, only update status and error
          await env.WELLS_DB.prepare(`
            UPDATE documents 
            SET status = 'failed',
                extraction_completed_at = datetime('now', '-6 hours'),
                extraction_error = ?
            WHERE id = ?
          `).bind(
            extraction_error || 'Unknown error',
            docId
          ).run();
        } else {
          // For successful extraction, update all fields
          console.log('Attempting to update document:', docId);
          const updateValues = {
            status: status || 'complete',
            extracted_data: extracted_data ? JSON.stringify(extracted_data) : null,
            doc_type,
            county,
            section,
            township,
            range,
            confidence,
            page_count,
            extraction_error,
            display_name,
            category,
            needs_review: needs_review ? 1 : 0,
            field_scores: field_scores ? JSON.stringify(field_scores) : null,
            fields_needing_review: fields_needing_review ? JSON.stringify(fields_needing_review) : null,
            docId
          };
          
          console.log('Update values:', JSON.stringify(updateValues, null, 2));
          
          try {
            await env.WELLS_DB.prepare(`
              UPDATE documents
              SET status = ?,
                  extracted_data = ?,
                  doc_type = ?,
                  county = ?,
                  section = ?,
                  township = ?,
                  range = ?,
                  confidence = ?,
                  page_count = ?,
                  extraction_error = ?,
                  display_name = ?,
                  category = ?,
                  needs_review = ?,
                  field_scores = ?,
                  fields_needing_review = ?,
                  rotation_applied = ?,
                  extraction_completed_at = datetime('now', '-6 hours')
              WHERE id = ?
            `).bind(
              status || 'complete',
              extracted_data ? JSON.stringify(extracted_data) : null,
              doc_type ?? null,
              county ?? null,
              section ?? null,
              township ?? null,
              range ?? null,
              confidence ?? null,
              page_count ?? null,
              extraction_error ?? null,
              display_name ?? null,
              category ?? null,
              needs_review !== undefined ? (needs_review ? 1 : 0) : 0,
              field_scores !== undefined ? JSON.stringify(field_scores) : null,
              fields_needing_review !== undefined ? JSON.stringify(fields_needing_review) : null,
              rotation_applied ?? 0,
              docId
            ).run();
            
            // After successful update, attempt to link document to properties/wells
            console.log('[DEBUG] Checking if should link - extracted_data exists:', !!extracted_data, 'status:', status);
            console.log('[DEBUG] extracted_data type:', typeof extracted_data);
            
            if (extracted_data && status !== 'failed') {
              console.log('[DEBUG] About to call linkDocumentToEntities for:', docId);
              console.log('[Documents] Starting auto-link for document:', docId);
              console.log('[Documents] Extracted data keys:', Object.keys(extracted_data));
              console.log('[Documents] DB binding available:', !!env.WELLS_DB);
              
              try {
                console.log('[DEBUG] Calling linkDocumentToEntities now...');
                const linkResult = await linkDocumentToEntities(
                  env.WELLS_DB,
                  docId,
                  extracted_data
                );
                console.log('[Documents] Link result:', linkResult);
                console.log('[Documents] Successfully linked - Property:', linkResult.propertyId, 'Well:', linkResult.wellId);
              } catch (linkError) {
                console.error('[Documents] Error during auto-link:', linkError);
                console.error('[Documents] Error stack:', linkError.stack);
              }
            } else {
              console.log('[Documents] Skipping auto-link - Status:', status, 'Has extracted data:', !!extracted_data);
              if (extracted_data) {
                console.log('[DEBUG] extracted_data sample:', JSON.stringify(extracted_data).substring(0, 200));
              }
            }
            
            // Track document usage and deduct credit (only for successful processing)
            if (status !== 'failed') {
              try {
                // Get user info and plan from the document
                const docInfo = await env.WELLS_DB.prepare(`
                  SELECT user_id, user_plan FROM documents WHERE id = ?
                `).bind(docId).first();

                if (docInfo?.user_id) {
                  const usageService = new UsageTrackingService(env.WELLS_DB);
                  const userPlan = (docInfo.user_plan as string) || 'Free';
                  await usageService.trackDocumentProcessed(
                    docInfo.user_id as string,
                    userPlan,
                    docId,
                    doc_type || 'unknown',
                    page_count || 0,
                    false, // isMultiDoc - handle this in split endpoint
                    0,     // childCount - handle this in split endpoint
                    extracted_data?.skip_extraction || false
                  );
                  console.log('[Usage] Tracked document processing for user:', docInfo.user_id, 'plan:', userPlan);
                }
              } catch (usageError) {
                // Don't fail the request if usage tracking fails
                console.error('[Usage] Failed to track usage:', usageError);
              }
            }
          } catch (dbError) {
            console.error('Database update failed:', dbError);
            console.error('Failed update for document:', docId);
            console.error('Attempted values:', JSON.stringify(updateValues, null, 2));
            throw dbError;
          }
        }

        return jsonResponse({ success: true }, 200, env);
      } catch (error) {
        console.error('Complete processing error:', error);
        console.error('Error details:', error instanceof Error ? error.message : String(error));
        console.error('Document ID:', docId);
        console.error('Data received:', JSON.stringify(data).slice(0, 500));
        return errorResponse('Failed to update document: ' + (error instanceof Error ? error.message : String(error)), 500, env);
      }
    }

    // Route: POST /api/processing/split/:id - Create child documents for multi-document PDF
    if (path.match(/^\/api\/processing\/split\/[^\/]+$/) && request.method === 'POST') {
      // Verify processing API key
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      const parentDocId = path.split('/')[4];

      // Ensure all processing columns exist
      await ensureProcessingColumns(env);

      try {
        const data = await request.json();
        const { children } = data;

        if (!children || !Array.isArray(children)) {
          return errorResponse('Invalid request: children array required', 400, env);
        }

        // Get parent document info
        const parentDoc = await env.WELLS_DB.prepare(`
          SELECT r2_key, filename, user_id, organization_id, user_plan
          FROM documents
          WHERE id = ? AND deleted_at IS NULL
        `).bind(parentDocId).first();

        if (!parentDoc) {
          return errorResponse('Parent document not found', 404, env);
        }

        // Create child documents
        const childIds = [];
        for (const child of children) {
          const childId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
          childIds.push(childId);

          await env.WELLS_DB.prepare(`
            INSERT INTO documents (
              id, r2_key, filename, user_id, organization_id, user_plan,
              parent_document_id, page_range_start, page_range_end,
              status, doc_type, display_name, category, confidence,
              county, section, township, range, extracted_data,
              needs_review, field_scores, fields_needing_review,
              upload_date, extraction_completed_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              datetime('now', '-6 hours'), datetime('now', '-6 hours')
            )
          `).bind(
            childId,
            parentDoc.r2_key, // Same PDF file
            parentDoc.filename,
            parentDoc.user_id,
            parentDoc.organization_id,
            parentDoc.user_plan || 'Free', // Inherit plan from parent
            parentDocId,
            child.page_range_start,
            child.page_range_end,
            child.status || 'complete',
            child.doc_type,
            child.display_name,
            child.category,
            child.confidence,
            child.county,
            child.section,
            child.township,
            child.range,
            child.extracted_data ? JSON.stringify(child.extracted_data) : null,
            child.needs_review ? 1 : 0,
            child.field_scores ? JSON.stringify(child.field_scores) : null,
            child.fields_needing_review ? JSON.stringify(child.fields_needing_review) : null
          ).run();
          
          // Attempt to link child document to properties/wells
          if (child.extracted_data && child.status !== 'failed') {
            console.log('[Documents] Starting auto-link for child document:', childId);
            try {
              const linkResult = await linkDocumentToEntities(
                env.WELLS_DB,
                childId,
                child.extracted_data
              );
              console.log('[Documents] Child link result:', linkResult);
            } catch (linkError) {
              console.error('[Documents] Error linking child document:', linkError);
            }
          }
        }

        // Mark parent as processed and set doc_type to 'multi_document'
        await env.WELLS_DB.prepare(`
          UPDATE documents 
          SET status = 'complete',
              extraction_completed_at = datetime('now', '-6 hours'),
              doc_type = 'multi_document',
              category = 'multi_document'
          WHERE id = ?
        `).bind(parentDocId).run();

        // Track usage for multi-document processing (parent gets 0 credits, children get actual credits)
        try {
          if (parentDoc?.user_id) {
            const usageService = new UsageTrackingService(env.WELLS_DB);
            const userPlan = (parentDoc.user_plan as string) || 'Free';
            // Parent is tracked with skip_extraction=true so no credits deducted
            await usageService.trackDocumentProcessed(
              parentDoc.user_id as string,
              userPlan,
              parentDocId,
              'multi_document',
              0, // 0 pages
              true, // isMultiDoc
              children.length, // childCount
              true // skip_extraction = true means no credit deducted for parent
            );
            console.log(`[Usage] Tracked multi-document processing for user ${parentDoc.user_id}: ${children.length} child documents`);
          }
        } catch (usageError) {
          console.error('[Usage] Failed to track multi-doc usage:', usageError);
        }

        return jsonResponse({ 
          success: true, 
          parent_id: parentDocId,
          child_ids: childIds,
          child_count: children.length
        }, 200, env);
      } catch (error) {
        console.error('Split document error:', error);
        return errorResponse('Failed to split document', 500, env);
      }
    }

    // Route: GET /api/processing/user/:id/queue-status - Get user's queue status
    if (path.match(/^\/api\/processing\/user\/[^\/]+\/queue-status$/) && request.method === 'GET') {
      // Verify processing API key
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      const userId = path.split('/')[4];

      try {
        // Count documents in different states for this user
        const queued = await env.WELLS_DB.prepare(`
          SELECT COUNT(*) as count 
          FROM documents 
          WHERE user_id = ? 
            AND status = 'pending' 
            AND deleted_at IS NULL
        `).bind(userId).first();

        const processing = await env.WELLS_DB.prepare(`
          SELECT COUNT(*) as count 
          FROM documents 
          WHERE user_id = ? 
            AND status = 'processing' 
            AND deleted_at IS NULL
        `).bind(userId).first();

        return jsonResponse({
          queued: queued?.count || 0,
          processing: processing?.count || 0
        }, 200, env);
      } catch (error) {
        console.error('Queue status error:', error);
        return errorResponse('Failed to get queue status', 500, env);
      }
    }

    // Route: GET /api/processing/user/:id - Get user info for notifications
    if (path.match(/^\/api\/processing\/user\/[^\/]+$/) && request.method === 'GET') {
      // Verify processing API key
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      const userId = path.split('/')[4];

      try {
        // Get user info from auth-worker
        const authRequest = new Request(`https://auth-worker.photog12.workers.dev/api/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${env.PROCESSING_API_KEY}` // Internal service auth
          },
        });

        const authResponse = await env.AUTH_WORKER.fetch(authRequest);
        
        if (!authResponse.ok) {
          // For now, return a default response since we don't have user lookup
          // In production, this would fetch from Airtable or user service
          console.log('Could not fetch user from auth-worker, using defaults');
          return jsonResponse({
            id: userId,
            email: 'james@mymineralwatch.com', // Default for testing
            name: 'User',
            notification_preferences: {
              email_on_complete: true
            }
          }, 200, env);
        }

        const userData = await authResponse.json();
        return jsonResponse({
          id: userData.id,
          email: userData.email || userData.fields?.Email,
          name: userData.name || userData.fields?.Name,
          notification_preferences: {
            email_on_complete: true
          }
        }, 200, env);
      } catch (error) {
        console.error('Get user error:', error);
        // Return default for now
        return jsonResponse({
          id: userId,
          email: 'james@mymineralwatch.com',
          name: 'User',
          notification_preferences: {
            email_on_complete: true
          }
        }, 200, env);
      }
    }

    // Route: POST /api/processing/relink-all - Re-link all documents to properties/wells
    if (path === '/api/processing/relink-all' && request.method === 'POST') {
      // Verify API key - accept either PROCESSING_API_KEY or SYNC_API_KEY
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || (apiKey !== env.PROCESSING_API_KEY && apiKey !== env.SYNC_API_KEY)) {
        return errorResponse('Invalid API key', 401, env);
      }

      console.log('[Documents] Starting re-linking of all documents');

      try {
        // Get all documents that have extracted data
        const documents = await env.WELLS_DB.prepare(`
          SELECT id, extracted_data 
          FROM documents 
          WHERE deleted_at IS NULL 
          AND extracted_data IS NOT NULL
          AND status != 'failed'
        `).all();

        let linked = 0;
        let failed = 0;

        // Process each document
        for (const doc of documents.results) {
          try {
            if (!doc.extracted_data) continue;

            // Parse extracted data if it's a string
            const extractedData = typeof doc.extracted_data === 'string' 
              ? JSON.parse(doc.extracted_data) 
              : doc.extracted_data;

            console.log(`[Documents] Re-linking document ${doc.id}`);
            const linkResult = await linkDocumentToEntities(
              env.WELLS_DB,
              doc.id,
              extractedData
            );
            
            if (linkResult.propertyId || linkResult.wellId) {
              linked++;
              console.log(`[Documents] Successfully linked ${doc.id} - Property: ${linkResult.propertyId}, Well: ${linkResult.wellId}`);
            }
          } catch (error) {
            console.error(`[Documents] Failed to re-link document ${doc.id}:`, error);
            failed++;
          }
        }

        console.log(`[Documents] Re-linking complete - Linked: ${linked}, Failed: ${failed}, Total: ${documents.results.length}`);

        return jsonResponse({
          success: true,
          total: documents.results.length,
          linked,
          failed
        }, 200, env);
      } catch (error) {
        console.error('[Documents] Re-linking error:', error);
        return errorResponse('Failed to re-link documents', 500, env);
      }
    }

    // Route: POST /api/credits/grant-annual-bonus - Grant annual bonus credits (called by stripe-webhook)
    if (path === '/api/credits/grant-annual-bonus' && request.method === 'POST') {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      try {
        const body = await request.json() as { userId: string; plan: string; email?: string };
        const { userId, plan, email } = body;

        if (!userId || !plan) {
          return errorResponse('userId and plan are required', 400, env);
        }

        const usageService = new UsageTrackingService(env.WELLS_DB);
        await usageService.grantAnnualBonus(userId, plan);

        console.log(`[Credits] Granted annual bonus for user ${userId} (${email || 'no email'}) on ${plan} plan`);

        return jsonResponse({
          success: true,
          message: `Annual bonus credits granted for ${plan} plan`
        }, 200, env);
      } catch (error) {
        console.error('[Credits] Error granting annual bonus:', error);
        return errorResponse('Failed to grant annual bonus', 500, env);
      }
    }

    // Route: POST /api/credits/add-purchased - Add purchased credits (called by stripe-webhook)
    if (path === '/api/credits/add-purchased' && request.method === 'POST') {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      try {
        const body = await request.json() as {
          userId: string;
          priceId: string;
          stripeSessionId?: string;
          stripePaymentIntent?: string;
        };
        const { userId, priceId, stripeSessionId, stripePaymentIntent } = body;

        if (!userId || !priceId) {
          return errorResponse('userId and priceId are required', 400, env);
        }

        // Validate price ID
        const packInfo = CREDIT_PACK_PRICES[priceId];
        if (!packInfo) {
          return errorResponse('Invalid price ID', 400, env);
        }

        const usageService = new UsageTrackingService(env.WELLS_DB);
        await usageService.addPurchasedCredits(
          userId,
          packInfo.credits,
          packInfo.name,
          priceId,
          packInfo.price,
          stripeSessionId,
          stripePaymentIntent
        );

        console.log(`[Credits] Added ${packInfo.credits} purchased credits for user ${userId} (${packInfo.name})`);

        return jsonResponse({
          success: true,
          credits: packInfo.credits,
          packName: packInfo.name,
          message: `${packInfo.credits} credits added to your account`
        }, 200, env);
      } catch (error) {
        console.error('[Credits] Error adding purchased credits:', error);
        return errorResponse('Failed to add purchased credits', 500, env);
      }
    }

    // Route: POST /api/documents/checkout/credit-pack - Create Stripe checkout session for credit pack purchase
    // Requires authentication - user must be logged in
    if (path === '/api/documents/checkout/credit-pack' && request.method === 'POST') {
      // Verify authentication - call /api/auth/me endpoint
      const authResponse = await env.AUTH_WORKER.fetch(
        new Request('https://auth-worker/api/auth/me', {
          method: 'GET',
          headers: request.headers,
        })
      );

      if (!authResponse.ok) {
        return errorResponse('Authentication required', 401, env);
      }

      const authData = await authResponse.json() as { id?: string; email?: string; organizationId?: string };
      if (!authData.id || !authData.email) {
        return errorResponse('User not found', 401, env);
      }

      const userId = authData.organizationId || authData.id;
      const userEmail = authData.email;

      // Check for Stripe secret key
      if (!env.STRIPE_SECRET_KEY) {
        console.error('[Checkout] STRIPE_SECRET_KEY not configured');
        return errorResponse('Payment processing not configured', 500, env);
      }

      try {
        const body = await request.json() as { priceId: string };
        const { priceId } = body;

        if (!priceId) {
          return errorResponse('priceId is required', 400, env);
        }

        // Validate price ID
        const packInfo = CREDIT_PACK_PRICES[priceId];
        if (!packInfo) {
          return errorResponse('Invalid price ID', 400, env);
        }

        console.log(`[Checkout] Creating checkout session for ${userEmail}, pack: ${packInfo.name}`);

        // Create Stripe Checkout session
        const checkoutResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'mode': 'payment',
            'customer_email': userEmail,
            'line_items[0][price]': priceId,
            'line_items[0][quantity]': '1',
            'success_url': `https://portal.mymineralwatch.com/portal?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
            'cancel_url': `https://portal.mymineralwatch.com/portal?purchase=cancelled`,
            'metadata[user_id]': userId,
            'metadata[pack_name]': packInfo.name,
            'metadata[credits]': packInfo.credits.toString(),
          }).toString(),
        });

        if (!checkoutResponse.ok) {
          const errorText = await checkoutResponse.text();
          console.error('[Checkout] Stripe error:', errorText);
          return errorResponse('Failed to create checkout session', 500, env);
        }

        const session = await checkoutResponse.json() as { id: string; url: string };

        console.log(`[Checkout] Created session ${session.id} for ${userEmail}`);

        return jsonResponse({
          success: true,
          url: session.url,
          sessionId: session.id,
        }, 200, env);
      } catch (error) {
        console.error('[Checkout] Error creating checkout session:', error);
        return errorResponse('Failed to create checkout session', 500, env);
      }
    }

    // Route: POST /api/documents/upload-external - Upload document from external service (OCC fetcher, etc.)
    // Used by other workers to add documents on behalf of a user
    if (path === '/api/documents/upload-external' && request.method === 'POST') {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      // Ensure all columns exist (including source_metadata)
      await ensureProcessingColumns(env);

      try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const userId = formData.get('userId') as string;
        const organizationId = formData.get('organizationId') as string | null;
        const userPlan = (formData.get('userPlan') as string) || 'Free';
        const sourceType = formData.get('sourceType') as string | null;
        const sourceApi = formData.get('sourceApi') as string | null;
        const originalUrl = formData.get('originalUrl') as string | null;
        const customFilename = formData.get('filename') as string | null;

        // Validate required fields
        if (!file) {
          return errorResponse('No file provided', 400, env);
        }
        if (!userId) {
          return errorResponse('userId is required', 400, env);
        }

        // Validate file type
        const contentType = file.type || 'application/pdf';
        if (!isAllowedFileType(contentType)) {
          return errorResponse('Only PDF, JPEG, PNG, and TIFF files are allowed', 400, env);
        }

        if (file.size > 50 * 1024 * 1024) {
          return errorResponse('File too large. Maximum size is 50MB', 400, env);
        }

        // Generate unique document ID
        const docId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const fileExtension = getFileExtension(contentType);
        const r2Key = `${docId}.${fileExtension}`;

        // Determine filename
        const filename = customFilename || file.name || `occ-document-${Date.now()}.${fileExtension}`;

        console.log(`[External Upload] Uploading ${filename} for user ${userId}, source: ${sourceType || 'unknown'}`);

        // Store in R2
        await env.UPLOADS_BUCKET.put(r2Key, file.stream(), {
          httpMetadata: {
            contentType: contentType,
            contentDisposition: `attachment; filename="${filename}"`
          },
          customMetadata: {
            sourceType: sourceType || '',
            sourceApi: sourceApi || '',
            originalUrl: originalUrl || ''
          }
        });

        // Build source metadata JSON
        const sourceMetadata = JSON.stringify({
          type: sourceType || 'external',
          api: sourceApi || null,
          url: originalUrl || null,
          uploadedAt: new Date().toISOString()
        });

        // Insert into database with pending status
        await env.WELLS_DB.prepare(`
          INSERT INTO documents (
            id, r2_key, filename, original_filename, user_id, organization_id,
            file_size, status, upload_date, queued_at, user_plan, content_type, source_metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?, ?)
        `).bind(
          docId,
          r2Key,
          filename,
          filename,
          userId,
          organizationId || null,
          file.size,
          userPlan,
          contentType,
          sourceMetadata
        ).run();

        console.log(`[External Upload] Document ${docId} uploaded successfully. Will be processed by queue.`);

        return jsonResponse({
          success: true,
          document: {
            id: docId,
            filename: filename,
            size: file.size,
            status: 'pending',
            sourceType: sourceType
          }
        }, 200, env);

      } catch (error) {
        console.error('[External Upload] Error:', error);
        return errorResponse('Upload failed: ' + (error as Error).message, 500, env);
      }
    }

    // Route: POST /api/documents/register-external - Register a document already uploaded to R2
    // Used by occ-fetcher which uploads directly to R2 to avoid large file transfers between workers
    if (path === '/api/documents/register-external' && request.method === 'POST') {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Invalid API key', 401, env);
      }

      // Ensure all columns exist
      await ensureProcessingColumns(env);

      try {
        const body = await request.json() as {
          r2Key: string;
          userId: string;
          organizationId?: string;
          filename: string;
          fileSize: number;
          contentType: string;
          sourceType?: string;
          sourceApi?: string;
          originalUrl?: string;
          metadata?: Record<string, any>;
        };

        const { r2Key, userId, organizationId, filename, fileSize, contentType, sourceType, sourceApi, originalUrl, metadata } = body;

        // Validate required fields
        if (!r2Key) {
          return errorResponse('r2Key is required', 400, env);
        }
        if (!userId) {
          return errorResponse('userId is required', 400, env);
        }
        if (!filename) {
          return errorResponse('filename is required', 400, env);
        }

        // Verify the file exists in R2
        const r2Object = await env.UPLOADS_BUCKET.head(r2Key);
        if (!r2Object) {
          return errorResponse('File not found in R2 storage', 404, env);
        }

        // Look up user's actual plan from credit balance table
        let userPlan = 'Free';
        const creditBalance = await env.WELLS_DB.prepare(`
          SELECT current_plan FROM user_credit_balance WHERE user_id = ?
        `).bind(userId).first();
        if (creditBalance && creditBalance.current_plan) {
          userPlan = creditBalance.current_plan as string;
        }
        console.log(`[External Register] User ${userId} plan: ${userPlan}`);

        // Generate unique document ID
        const docId = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

        // Build source metadata JSON
        const sourceMetadata = JSON.stringify({
          type: sourceType || 'external',
          api: sourceApi || null,
          url: originalUrl || null,
          uploadedAt: new Date().toISOString(),
          ...metadata
        });

        console.log(`[External Register] Registering ${filename} for user ${userId}, r2Key: ${r2Key}, source: ${sourceType || 'unknown'}`);

        // Insert into database with pending status
        await env.WELLS_DB.prepare(`
          INSERT INTO documents (
            id, r2_key, filename, original_filename, user_id, organization_id,
            file_size, status, upload_date, queued_at, user_plan, content_type, source_metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?, ?)
        `).bind(
          docId,
          r2Key,
          filename,
          filename,
          userId,
          organizationId || null,
          fileSize || r2Object.size,
          userPlan,
          contentType || 'application/pdf',
          sourceMetadata
        ).run();

        console.log(`[External Register] Document ${docId} registered successfully. Will be processed by queue.`);

        return jsonResponse({
          success: true,
          document: {
            id: docId,
            r2Key: r2Key,
            filename: filename,
            size: fileSize || r2Object.size,
            status: 'pending',
            sourceType: sourceType
          }
        }, 200, env);

      } catch (error) {
        console.error('[External Register] Error:', error);
        return errorResponse('Registration failed: ' + (error as Error).message, 500, env);
      }
    }

    // Route: POST /api/occ/fetch - Fetch and process an OCC filing
    // Called from portal UI when user clicks "Process & Extract" on an OCC filing
    if (path === '/api/occ/fetch' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      try {
        const body = await request.json() as {
          caseNumber: string;
          orderNumber?: string;
        };

        const { caseNumber, orderNumber } = body;

        if (!caseNumber) {
          return errorResponse('caseNumber is required', 400, env);
        }

        console.log(`[OCC Fetch] User ${user.id} requesting case ${caseNumber}`);

        // Get user's plan and organization
        const userPlan = user.fields?.Plan || user.plan || user.Plan || 'Free';
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;

        // Check if already processed (by case number or order number in source_metadata)
        let existingQuery = `
          SELECT id, display_name, status FROM documents
          WHERE user_id = ?
          AND deleted_at IS NULL
          AND (
            json_extract(source_metadata, '$.caseNumber') = ?
        `;
        const queryParams: any[] = [user.id, caseNumber.replace(/^CD\s*/i, '')];

        if (orderNumber) {
          existingQuery += ` OR json_extract(source_metadata, '$.orderNumber') = ?`;
          queryParams.push(orderNumber);
        }
        existingQuery += `)`;

        const existing = await env.WELLS_DB.prepare(existingQuery).bind(...queryParams).first();

        if (existing) {
          console.log(`[OCC Fetch] Document already exists: ${existing.id}`);

          // Get current credit balance for UI (use org ID if available)
          const creditUserId = user.organizationId || user.id;
          const usageService = new UsageTrackingService(env.WELLS_DB);
          const creditCheck = await usageService.checkCreditsAvailable(creditUserId, userPlan);

          return jsonResponse({
            alreadyProcessed: true,
            documentId: existing.id,
            displayName: existing.display_name,
            status: existing.status,
            creditsRemaining: creditCheck.totalAvailable
          }, 200, env);
        }

        // Check credits before fetching (use org ID if available)
        const creditUserId = user.organizationId || user.id;
        const usageService = new UsageTrackingService(env.WELLS_DB);
        const creditCheck = await usageService.checkCreditsAvailable(creditUserId, userPlan);

        if (!creditCheck.hasCredits) {
          console.log(`[OCC Fetch] User ${user.id} has no credits`);
          return jsonResponse({
            error: 'no_credits',
            message: creditCheck.message || 'No credits available. Please purchase a credit pack or upgrade your plan.',
            creditsRemaining: 0
          }, 402, env);
        }

        console.log(`[OCC Fetch] User has ${creditCheck.totalAvailable} credits, calling occ-fetcher`);

        // Call occ-fetcher via service binding
        const occResponse = await env.OCC_FETCHER.fetch(
          new Request('https://internal/fetch-order', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.PROCESSING_API_KEY
            },
            body: JSON.stringify({
              caseNumber,
              userId: user.id,
              organizationId: userOrg
            })
          })
        );

        const occResult = await occResponse.json() as any;

        if (!occResponse.ok || !occResult.success) {
          console.error('[OCC Fetch] occ-fetcher error:', occResult);
          return jsonResponse({
            error: 'fetch_failed',
            message: occResult.error || 'Failed to fetch document from OCC',
            creditsRemaining: creditCheck.totalAvailable
          }, occResponse.status || 500, env);
        }

        console.log(`[OCC Fetch] Successfully fetched document ${occResult.document?.id}`);

        // Return success with updated credit balance (subtract 1 for the document that will be processed)
        return jsonResponse({
          success: true,
          document: occResult.document,
          order: occResult.order,
          creditsRemaining: creditCheck.totalAvailable - 1
        }, 200, env);

      } catch (error) {
        console.error('[OCC Fetch] Error:', error);
        return errorResponse('Failed to fetch OCC document: ' + (error as Error).message, 500, env);
      }
    }

    return errorResponse('Not found', 404, env);
  },
};