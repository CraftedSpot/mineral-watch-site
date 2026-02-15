import { linkDocumentToEntities, ensureLinkColumns } from './link-documents';
import { migrateDocumentIds } from './migrate-document-ids';
import { UsageTrackingService } from './services/usage-tracking';
import { CountyRecordExtractionService } from './services/county-record-extraction';
import { getExtractionPrompt, preparePrompt } from './services/extraction-prompts';
import { PDFDocument } from 'pdf-lib';

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
  OKCR_API_KEY?: string;
  OKCR_API_BASE?: string;
  ANTHROPIC_API_KEY?: string;
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

/**
 * Validate OTC Production Unit Number format.
 * Valid formats:
 *   - XXX-XXXXXX-X-XXXX (full format: county-unit-segment-well, e.g., "043-226597-0-0000")
 *   - XXX-XXXXX-X-XXXX (5-digit unit variant)
 *   - XXX-XXXXXX (short format without segment/well)
 *
 * Invalid (will return false):
 *   - Short numbers without dashes (e.g., "20347") - likely operator numbers
 *   - Numbers without county prefix
 */
function isValidPun(pun: string | null | undefined): boolean {
  if (!pun) return false;
  // Must have at least one dash and start with 3-digit county code
  // 1002A format: XXX-XXXXXX-X-XXXX (3-6-1-4)
  // OTC format:   XXX-XXXXX-X-XXXXX (3-5-1-5)
  // Short format: XXX-XXXXX or XXX-XXXXXX
  return /^\d{3}-\d{5,6}(-\d-\d{4,5})?$/.test(pun);
}

/**
 * Normalize OTC Production Unit Number for database crosswalk joins.
 * Simply removes dashes and spaces - OTC and 1002A use the same format.
 *
 * Format: XXX-XXXXXX-X-XXXX (county-lease-sub-merge)
 *   - 3-digit county code
 *   - 6-digit lease number
 *   - 1-digit sub/segment
 *   - 4-digit merge number
 *
 * Examples:
 *   "017-231497-0-0000" → "01723149700000"
 *   "043-226597-0-0000" → "04322659700000"
 */
function normalizeOtcPun(pun: string | null | undefined): string | null {
  if (!pun) return null;
  // Validate format first - reject invalid PUNs like operator numbers
  if (!isValidPun(pun)) {
    console.log(`[PUN Validation] Rejected invalid PUN: "${pun}" (likely operator number or wrong field)`);
    return null;
  }
  // Just remove dashes and spaces - no digit manipulation needed
  return pun.replace(/[-\s]/g, '');
}

/**
 * Post-process extracted data to add normalized fields for database joins.
 * Called after extraction, before storing to D1.
 */
function postProcessExtractedData(extractedData: any): any {
  if (!extractedData) return extractedData;

  // Validate and normalize OTC PUN if present
  if (extractedData.otc_prod_unit_no) {
    if (!isValidPun(extractedData.otc_prod_unit_no)) {
      // Invalid PUN (e.g., operator number confused as PUN) - clear it
      console.log(`[PUN Validation] Clearing invalid otc_prod_unit_no: "${extractedData.otc_prod_unit_no}"`);
      extractedData.otc_prod_unit_no = null;
      extractedData.otc_prod_unit_no_normalized = null;
    } else {
      extractedData.otc_prod_unit_no_normalized = normalizeOtcPun(extractedData.otc_prod_unit_no);
      console.log(`[Normalize] OTC PUN: "${extractedData.otc_prod_unit_no}" → "${extractedData.otc_prod_unit_no_normalized}"`);
    }
  }

  // Handle allocation_factors array (completion reports may have PUN per section)
  // Note: Extraction may use either 'pun' or 'otc_prod_unit_no' field names
  if (Array.isArray(extractedData.allocation_factors)) {
    for (const factor of extractedData.allocation_factors) {
      // Handle otc_prod_unit_no field
      if (factor.otc_prod_unit_no) {
        if (!isValidPun(factor.otc_prod_unit_no)) {
          factor.otc_prod_unit_no = null;
          factor.otc_prod_unit_no_normalized = null;
        } else {
          factor.otc_prod_unit_no_normalized = normalizeOtcPun(factor.otc_prod_unit_no);
        }
      }
      // Handle pun field (alternative name used in some extractions)
      if (factor.pun) {
        if (!isValidPun(factor.pun)) {
          factor.pun = null;
          factor.pun_normalized = null;
        } else {
          factor.pun_normalized = normalizeOtcPun(factor.pun);
        }
      }
    }
  }

  return extractedData;
}

/**
 * Re-extract a pooling order document using Claude Opus for better accuracy.
 * This is used for documents where initial extraction failed or had missing data.
 */
async function reextractPoolingWithOpus(env: Env, documentId: string): Promise<{
  success: boolean;
  document_id: string;
  election_options_count?: number;
  error?: string;
}> {
  console.log(`[Opus Reextract] Starting for document ${documentId}`);

  if (!env.ANTHROPIC_API_KEY) {
    return { success: false, document_id: documentId, error: 'ANTHROPIC_API_KEY not configured' };
  }

  // 1. Get document and pooling order info
  const docResult = await env.WELLS_DB.prepare(`
    SELECT d.id, d.r2_key, d.filename, d.doc_type, po.id as pooling_order_id
    FROM documents d
    LEFT JOIN pooling_orders po ON po.document_id = d.id
    WHERE d.id = ?
  `).bind(documentId).first() as any;

  if (!docResult) {
    return { success: false, document_id: documentId, error: 'Document not found' };
  }

  if (!docResult.r2_key) {
    return { success: false, document_id: documentId, error: 'No R2 key for document' };
  }

  // 2. Fetch PDF from R2
  console.log(`[Opus Reextract] Fetching PDF from R2: ${docResult.r2_key}`);
  const r2Object = await env.UPLOADS_BUCKET.get(docResult.r2_key);
  if (!r2Object) {
    return { success: false, document_id: documentId, error: 'PDF not found in R2' };
  }

  const pdfBytes = await r2Object.arrayBuffer();
  // Chunked base64 encoding to avoid stack overflow on large PDFs
  const uint8Array = new Uint8Array(pdfBytes);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64Pdf = btoa(binary);
  console.log(`[Opus Reextract] PDF encoded, size: ${pdfBytes.byteLength} bytes`);

  // 3. Get the pooling extraction prompt
  const prompt = preparePrompt(getExtractionPrompt('pooling_order'));

  // 4. Call Claude Opus
  console.log(`[Opus Reextract] Calling Claude Opus API...`);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            }
          },
          {
            type: 'text',
            text: prompt,
          }
        ]
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Opus Reextract] API error: ${response.status}`, errorText.substring(0, 200));
    return { success: false, document_id: documentId, error: `Claude API error ${response.status}` };
  }

  const result: any = await response.json();
  const rawResponse = result.content?.[0]?.text || '';

  // 5. Parse the JSON from the response
  let extractedData: any = null;
  try {
    const firstBrace = rawResponse.indexOf('{');
    if (firstBrace === -1) {
      return { success: false, document_id: documentId, error: 'No JSON found in response' };
    }

    let depth = 0;
    let lastBrace = -1;
    for (let i = firstBrace; i < rawResponse.length; i++) {
      if (rawResponse[i] === '{') depth++;
      if (rawResponse[i] === '}') {
        depth--;
        if (depth === 0) {
          lastBrace = i;
          break;
        }
      }
    }

    if (lastBrace === -1) {
      return { success: false, document_id: documentId, error: 'Malformed JSON in response' };
    }

    extractedData = JSON.parse(rawResponse.substring(firstBrace, lastBrace + 1));
  } catch (parseError) {
    console.error(`[Opus Reextract] JSON parse error:`, parseError);
    return { success: false, document_id: documentId, error: 'Failed to parse extraction JSON' };
  }

  // 6. Update document with new extraction
  const keyTakeawayMatch = rawResponse.match(/KEY TAKEAWAY[:\s]*\n?([\s\S]*?)(?=DETAILED ANALYSIS|$)/i);
  const detailedAnalysisMatch = rawResponse.match(/DETAILED ANALYSIS[:\s]*\n?([\s\S]*?)$/i);

  extractedData.key_takeaway = keyTakeawayMatch ? keyTakeawayMatch[1].trim().substring(0, 1000) : null;
  extractedData.detailed_analysis = detailedAnalysisMatch ? detailedAnalysisMatch[1].trim().substring(0, 4000) : null;

  await env.WELLS_DB.prepare(`
    UPDATE documents
    SET extracted_data = ?,
        confidence = 'high',
        status = 'complete',
        extraction_completed_at = datetime('now'),
        notes = 'Opus v2 re-extraction ' || datetime('now')
    WHERE id = ?
  `).bind(JSON.stringify(extractedData), documentId).run();

  console.log(`[Opus Reextract] Document updated with new extraction`);

  // 7. Update pooling_orders table
  const poolingId = docResult.pooling_order_id || 'po_' + documentId.replace(/^doc_/, '');
  const orderInfo = extractedData.order_info || {};
  const unitInfo = extractedData.unit_info || {};
  const wellInfo = extractedData.well_info || {};
  const deadlines = extractedData.deadlines || {};
  const defaultElection = extractedData.default_election || {};

  await env.WELLS_DB.prepare(`
    INSERT INTO pooling_orders (
      id, document_id, case_number, order_number, order_date, effective_date,
      applicant, operator, proposed_well_name,
      section, township, range, county, meridian,
      unit_description, unit_size_acres,
      well_type, formations,
      response_deadline, response_deadline_days,
      default_election_option, default_election_description,
      confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      case_number = excluded.case_number,
      order_number = excluded.order_number,
      order_date = excluded.order_date,
      effective_date = excluded.effective_date,
      applicant = excluded.applicant,
      operator = excluded.operator,
      proposed_well_name = excluded.proposed_well_name,
      section = excluded.section,
      township = excluded.township,
      range = excluded.range,
      county = excluded.county,
      unit_description = excluded.unit_description,
      unit_size_acres = excluded.unit_size_acres,
      well_type = excluded.well_type,
      formations = excluded.formations,
      response_deadline = excluded.response_deadline,
      response_deadline_days = excluded.response_deadline_days,
      default_election_option = excluded.default_election_option,
      default_election_description = excluded.default_election_description,
      confidence = 'high',
      updated_at = datetime('now')
  `).bind(
    poolingId,
    documentId,
    orderInfo.case_number || null,
    orderInfo.order_number || null,
    orderInfo.order_date || null,
    orderInfo.effective_date || null,
    extractedData.applicant?.name || null,
    extractedData.operator?.name || null,
    wellInfo.proposed_well_name || null,
    extractedData.section ? String(extractedData.section) : null,
    extractedData.township || null,
    extractedData.range || null,
    extractedData.county || null,
    'IM',
    unitInfo.unit_description || null,
    unitInfo.unit_size_acres || null,
    wellInfo.well_type || null,
    extractedData.formations ? JSON.stringify(extractedData.formations) : null,
    deadlines.election_deadline || null,
    deadlines.election_period_days || null,
    defaultElection.option_number != null ? String(defaultElection.option_number) : null,
    defaultElection.description || null,
    'high'
  ).run();

  console.log(`[Opus Reextract] Pooling order updated: ${poolingId}`);

  // 8. Delete existing election options and insert new ones
  await env.WELLS_DB.prepare(`
    DELETE FROM pooling_election_options WHERE pooling_order_id = ?
  `).bind(poolingId).run();

  const options = extractedData.election_options || [];
  let optionsInserted = 0;

  for (const opt of options) {
    try {
      // Use total_royalty (new field) or fall back to royalty_rate (old field) for backwards compatibility
      const royaltyFraction = opt.total_royalty || opt.royalty_rate || null;

      // Calculate royalty decimal from fraction (e.g., "3/16" -> 0.1875)
      let royaltyDecimal = null;
      if (royaltyFraction) {
        const match = royaltyFraction.match(/(\d+)\/(\d+)/);
        if (match) {
          royaltyDecimal = parseFloat(match[1]) / parseFloat(match[2]);
        }
      }
      // Cross-check with NRI if available (NRI = 1 - royalty)
      if (!royaltyDecimal && opt.nri_delivered) {
        const nri = parseFloat(String(opt.nri_delivered).replace('%', '')) / 100;
        if (nri > 0 && nri < 1) {
          royaltyDecimal = 1 - nri;
        }
      }

      await env.WELLS_DB.prepare(`
        INSERT INTO pooling_election_options (
          pooling_order_id, option_number, option_type, description,
          bonus_per_acre, royalty_fraction, royalty_decimal,
          working_interest_retained, cost_per_nma, penalty_percentage, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        poolingId,
        opt.option_number || null,
        opt.option_type || null,
        opt.description || null,
        opt.bonus_per_nma || null,
        royaltyFraction,
        royaltyDecimal,
        opt.option_type === 'participate' ? 1 : 0,
        opt.cost_per_nma || null,
        opt.risk_penalty_percentage || null,
        null
      ).run();
      optionsInserted++;
    } catch (optErr: any) {
      console.error(`[Opus Reextract] Failed to insert option ${opt.option_number}:`, optErr.message);
    }
  }

  console.log(`[Opus Reextract] Inserted ${optionsInserted} election options`);

  return {
    success: true,
    document_id: documentId,
    election_options_count: optionsInserted
  };
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

    const userData = await authResponse.json() as any;
    console.log('Authenticated user:', userData.id);

    // Check for impersonation headers (trusted, set by portal-worker proxy)
    const impersonateUserId = request.headers.get('X-Impersonate-User-Id');
    if (impersonateUserId) {
      const impersonateEmail = request.headers.get('X-Impersonate-User-Email') || '';
      const impersonateOrgId = request.headers.get('X-Impersonate-Org-Id') || '';
      const impersonatePlan = request.headers.get('X-Impersonate-Plan') || '';
      console.log(`[Impersonate] Documents: ${userData.email} acting as ${impersonateEmail} (${impersonateUserId})`);
      return {
        ...userData,
        id: impersonateUserId,
        email: impersonateEmail,
        organizationId: impersonateOrgId || undefined,
        fields: {
          ...userData.fields,
          Email: impersonateEmail,
          Organization: impersonateOrgId ? [impersonateOrgId] : [],
          Plan: impersonatePlan || userData.fields?.Plan
        },
        organization: impersonateOrgId ? [impersonateOrgId] : [],
        Organization: impersonateOrgId ? [impersonateOrgId] : []
      };
    }

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
    { name: 'source_metadata', type: 'TEXT' },  // JSON: { type, api, url, uploadedAt }
    { name: 'user_email', type: 'TEXT' },
    { name: 'user_name', type: 'TEXT' }
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

        // Get user's organization, plan, and contact info
        // Auth-worker returns organizationId directly (not nested in fields)
        const userOrg = user.organizationId || user.fields?.Organization?.[0] || user.organization?.[0] || null;
        const userPlan = user.plan || user.fields?.Plan || user.Plan || 'Free';
        const userEmail = user.email || user.fields?.Email || null;
        const userName = user.name || user.fields?.Name || null;

        // All files (PDF and images) go to pending status for processing
        // The processor handles different file types appropriately
        await env.WELLS_DB.prepare(`
          INSERT INTO documents (
            id, r2_key, filename, original_filename, user_id, organization_id,
            file_size, status, upload_date, queued_at, user_plan, content_type,
            user_email, user_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?, ?, ?)
        `).bind(docId, r2Key, file.name, file.name, user.id, userOrg, file.size, userPlan, file.type, userEmail, userName).run();

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
        // Auth-worker returns organizationId directly (not nested in fields)
        const userOrg = user.organizationId || user.fields?.Organization?.[0] || user.organization?.[0] || null;
        const userPlan = user.plan || user.fields?.Plan || user.Plan || 'Free';
        const userEmail = user.email || user.fields?.Email || null;
        const userName = user.name || user.fields?.Name || null;

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
                file_size, status, upload_date, queued_at, user_plan, content_type,
                user_email, user_name
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?, ?, ?)
            `).bind(docId, r2Key, file.name, file.name, user.id, userOrg, file.size, userPlan, file.type, userEmail, userName).run();

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
        // TRIM/SUBSTR extracts the first well_id from comma-separated list (primary well is always first)
        const query = `
          SELECT
            d.*,
            w.well_name,
            w.api_number as well_api_number
          FROM documents d
          LEFT JOIN wells w ON w.airtable_record_id = (
            CASE WHEN d.well_id LIKE '%,%'
              THEN TRIM(SUBSTR(d.well_id, 1, INSTR(d.well_id, ',') - 1))
              ELSE TRIM(d.well_id)
            END
          )
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

        // Fetch ALL linked wells if well_id is set (same pattern as properties above)
        let linked_wells: any[] = [];
        if (doc.well_id) {
          const wellIds = (doc.well_id as string).split(',').map(id => id.trim()).filter(id => id);
          console.log('Fetching linked wells:', wellIds);

          if (wellIds.length > 0) {
            // Try client_wells first (user's tracked wells), then statewide wells
            for (const wId of wellIds) {
              // Check client_wells
              let wellData = await env.WELLS_DB.prepare(`
                SELECT airtable_id as id, well_name, api_number, operator, county, well_status
                FROM client_wells WHERE airtable_id = ?
              `).bind(wId).first();

              if (!wellData) {
                // Fallback to statewide wells table
                wellData = await env.WELLS_DB.prepare(`
                  SELECT airtable_record_id as id, well_name, api_number, operator, county, well_status
                  FROM wells WHERE airtable_record_id = ?
                `).bind(wId).first();
              }

              if (wellData) {
                linked_wells.push({
                  id: wellData.id,
                  well_name: wellData.well_name,
                  api_number: wellData.api_number,
                  operator: wellData.operator,
                  county: wellData.county,
                  well_status: wellData.well_status
                });
              }
            }
            console.log('Found linked wells:', linked_wells.length);
          }
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
          // Array of all linked wells
          linked_wells,
          // For backwards compatibility - first property name
          property_name: property_name,
          // For backwards compatibility - first well name and API
          well_name: linked_wells.length > 0 ? linked_wells[0].well_name : (doc.well_name || null),
          well_api_number: linked_wells.length > 0 ? linked_wells[0].api_number : (doc.well_api_number || null)
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
          SELECT r2_key, filename, display_name, content_type, page_range_start, page_range_end FROM documents
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

        // Check if this is a child document from a split (has page range)
        const pageStart = doc.page_range_start as number | null;
        const pageEnd = doc.page_range_end as number | null;
        const isPdf = contentType === 'application/pdf';

        // If this is a child document with page ranges and it's a PDF, extract only those pages
        if (isPdf && pageStart !== null && pageEnd !== null && pageStart >= 1) {
          console.log(`Extracting pages ${pageStart}-${pageEnd} for child document ${docId}`);
          try {
            // Load the full PDF
            const pdfBytes = await object.arrayBuffer();
            const fullPdf = await PDFDocument.load(pdfBytes);

            // Create a new PDF with only the specific pages
            const extractedPdf = await PDFDocument.create();

            // Page indices are 0-based in pdf-lib, but our page_range is 1-based
            const pageIndices = [];
            for (let i = pageStart - 1; i <= pageEnd - 1 && i < fullPdf.getPageCount(); i++) {
              pageIndices.push(i);
            }

            const copiedPages = await extractedPdf.copyPages(fullPdf, pageIndices);
            copiedPages.forEach(page => extractedPdf.addPage(page));

            const extractedBytes = await extractedPdf.save();

            return new Response(extractedBytes, {
              headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${downloadName}"`,
                ...corsHeaders(env),
              },
            });
          } catch (extractError) {
            console.error('Error extracting pages:', extractError);
            // Fall back to returning the full PDF if extraction fails
          }
        }

        // Return full file with appropriate headers (for non-child docs or non-PDFs)
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
          SELECT r2_key, filename, display_name, content_type, page_range_start, page_range_end FROM documents
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

        // Check if this is a child document from a split (has page range)
        const pageStart = doc.page_range_start as number | null;
        const pageEnd = doc.page_range_end as number | null;
        const isPdf = contentType === 'application/pdf';

        // If this is a child document with page ranges and it's a PDF, extract only those pages
        if (isPdf && pageStart !== null && pageEnd !== null && pageStart >= 1) {
          console.log(`Extracting pages ${pageStart}-${pageEnd} for viewing child document ${docId}`);
          try {
            const pdfBytes = await object.arrayBuffer();
            const fullPdf = await PDFDocument.load(pdfBytes);

            const extractedPdf = await PDFDocument.create();
            const pageIndices = [];
            for (let i = pageStart - 1; i <= pageEnd - 1 && i < fullPdf.getPageCount(); i++) {
              pageIndices.push(i);
            }

            const copiedPages = await extractedPdf.copyPages(fullPdf, pageIndices);
            copiedPages.forEach(page => extractedPdf.addPage(page));

            const extractedBytes = await extractedPdf.save();

            return new Response(extractedBytes, {
              headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${viewName}"`,
                ...corsHeaders(env),
              },
            });
          } catch (extractError) {
            console.error('Error extracting pages for view:', extractError);
            // Fall back to returning the full PDF if extraction fails
          }
        }

        // Return full file for inline viewing (for non-child docs or non-PDFs)
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
        // Round-robin by user so bulk uploaders (e.g. harvester) don't starve real users
        // Real users are prioritized over system_harvester within each round-robin slot
        const results = await env.WELLS_DB.prepare(`
          SELECT id, r2_key, filename, original_filename, user_id, organization_id,
                 file_size, upload_date, page_count, processing_attempts, user_plan, content_type,
                 source_metadata
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY upload_date ASC) as user_queue_pos
            FROM documents
            WHERE status = 'pending'
              AND processing_attempts < 3
              AND deleted_at IS NULL
          )
          ORDER BY user_queue_pos,
            CASE WHEN user_id = 'system_harvester' THEN 1 ELSE 0 END,
            upload_date ASC
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

          // System-triggered documents (harvester) bypass credit checks
          if (userId === 'system_harvester' || userPlan === 'system') {
            docsToProcess.push(doc);
            if (docsToProcess.length >= 10) break;
            continue;
          }

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
          extracted_data: raw_extracted_data,
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

        // Post-process extracted data (normalize PUNs, etc.)
        const extracted_data = postProcessExtractedData(raw_extracted_data);

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

          // Also update well_1002a_tracking if this was a completion report
          try {
            await env.WELLS_DB.prepare(`
              UPDATE well_1002a_tracking
              SET status = 'error',
                  error_message = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE document_id = ?
            `).bind(
              extraction_error || 'Processing failed',
              docId
            ).run();
            console.log('[Completion Tracking] Updated tracking status to error for document:', docId);
          } catch (trackingError) {
            // Not all documents are completion reports, so this may not match any rows
            console.log('[Completion Tracking] No tracking record to update for document:', docId);
          }
        } else {
          // For successful extraction, update all fields
          console.log('Attempting to update document:', docId);

          // Determine status: if skip_extraction is true (e.g., "other" docs), use "unprocessed"
          // This allows users to decide later whether to process these documents
          const effectiveStatus = status || (extracted_data?.skip_extraction ? 'unprocessed' : 'complete');

          const updateValues = {
            status: effectiveStatus,
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
              effectiveStatus,
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
            console.log('[DEBUG] Checking if should link - extracted_data exists:', !!extracted_data, 'effectiveStatus:', effectiveStatus, 'skip_extraction:', extracted_data?.skip_extraction);
            console.log('[DEBUG] extracted_data type:', typeof extracted_data);

            // Skip linking for failed, unprocessed, or skip_extraction documents
            if (extracted_data && effectiveStatus !== 'failed' && effectiveStatus !== 'unprocessed' && !extracted_data?.skip_extraction) {
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

                // Write-back decimal interest from division orders to client_wells
                // Routes to ri_nri, wi_nri, or orri_nri based on extracted interest_type
                if (doc_type === 'division_order' && extracted_data?.decimal_interest && linkResult.wellId) {
                  try {
                    const rawDecimal = String(extracted_data.decimal_interest).replace(/[^0-9.]/g, '');
                    const decimalInterest = parseFloat(rawDecimal);

                    if (decimalInterest > 0 && decimalInterest < 1) {
                      const primaryWellId = linkResult.wellId.split(',')[0].trim();

                      // Determine which column to write based on interest_type
                      const rawType = String(extracted_data.interest_type || extracted_data.type_of_interest || '').toLowerCase();
                      let targetColumn = 'ri_nri'; // default to royalty interest
                      let interestLabel = 'RI';
                      if (rawType.includes('working')) {
                        targetColumn = 'wi_nri';
                        interestLabel = 'WI';
                      } else if (rawType.includes('overrid') || rawType === 'orri') {
                        targetColumn = 'orri_nri';
                        interestLabel = 'ORRI';
                      }

                      console.log(`[DO Write-Back] Interest type "${rawType}" → column ${targetColumn} (${interestLabel})`);

                      // Ensure interest_source columns exist on client_wells
                      // These track the source per-interest-type: {column}_source, {column}_source_doc_id, {column}_source_date
                      const sourceColumns = [
                        { name: 'interest_source', type: 'TEXT' },
                        { name: 'interest_source_doc_id', type: 'TEXT' },
                        { name: 'interest_source_date', type: 'TEXT' },
                        { name: 'wi_nri_source', type: 'TEXT' },
                        { name: 'wi_nri_source_doc_id', type: 'TEXT' },
                        { name: 'wi_nri_source_date', type: 'TEXT' },
                        { name: 'orri_nri_source', type: 'TEXT' },
                        { name: 'orri_nri_source_doc_id', type: 'TEXT' },
                        { name: 'orri_nri_source_date', type: 'TEXT' },
                      ];
                      for (const col of sourceColumns) {
                        try {
                          await env.WELLS_DB.prepare(`SELECT ${col.name} FROM client_wells LIMIT 1`).first();
                        } catch {
                          try {
                            await env.WELLS_DB.prepare(`ALTER TABLE client_wells ADD COLUMN ${col.name} ${col.type}`).run();
                            console.log(`[DO Write-Back] Added column client_wells.${col.name}`);
                          } catch (addErr) {
                            // Column may already exist from a concurrent request
                          }
                        }
                      }

                      // Try to find the client_well: first by direct airtable_id, then by API number
                      let clientWell = await env.WELLS_DB.prepare(
                        `SELECT id, airtable_id, ri_nri, wi_nri, orri_nri FROM client_wells WHERE airtable_id = ? LIMIT 1`
                      ).bind(primaryWellId).first() as any;

                      if (!clientWell && extracted_data.api_number) {
                        const docOwner = await env.WELLS_DB.prepare(
                          `SELECT user_id, organization_id FROM documents WHERE id = ?`
                        ).bind(docId).first() as any;
                        if (docOwner) {
                          clientWell = await env.WELLS_DB.prepare(
                            `SELECT id, airtable_id, ri_nri, wi_nri, orri_nri FROM client_wells
                             WHERE api_number = ? AND (user_id = ? OR organization_id = ?) LIMIT 1`
                          ).bind(
                            extracted_data.api_number,
                            docOwner.user_id || '',
                            docOwner.organization_id || ''
                          ).first() as any;
                        }
                      }

                      if (clientWell) {
                        const existingValue = clientWell[targetColumn] as number | null;

                        if (existingValue && Math.abs(existingValue - decimalInterest) > 0.000001) {
                          console.log(`[DO Write-Back] VALUE CHANGE: Well ${clientWell.airtable_id} existing ${targetColumn}=${existingValue}, extracted=${decimalInterest} (${interestLabel}) from doc ${docId}`);
                        }

                        // Build source column names based on interest type
                        const srcCol = targetColumn === 'ri_nri' ? 'interest_source' : `${targetColumn}_source`;
                        const srcDocCol = targetColumn === 'ri_nri' ? 'interest_source_doc_id' : `${targetColumn}_source_doc_id`;
                        const srcDateCol = targetColumn === 'ri_nri' ? 'interest_source_date' : `${targetColumn}_source_date`;

                        await env.WELLS_DB.prepare(
                          `UPDATE client_wells
                           SET ${targetColumn} = ?,
                               ${srcCol} = 'extracted_division_order',
                               ${srcDocCol} = ?,
                               ${srcDateCol} = datetime('now', '-6 hours')
                           WHERE id = ?`
                        ).bind(decimalInterest, docId, clientWell.id).run();

                        console.log(`[DO Write-Back] Updated well ${clientWell.airtable_id} ${targetColumn}=${decimalInterest} (${interestLabel}) from document ${docId}`);
                      } else {
                        console.log(`[DO Write-Back] No client_well found for well_id ${primaryWellId} — decimal interest not written back`);
                      }
                    } else {
                      console.log(`[DO Write-Back] Skipping — decimal_interest ${extracted_data.decimal_interest} out of range`);
                    }
                  } catch (writeBackError) {
                    console.error('[DO Write-Back] Error:', writeBackError);
                  }
                }

                // Write-back section allocation percentage from division orders to property_well_links
                // Matches unit_sections[].allocation_factor to the correct property via TRS normalization
                if (doc_type === 'division_order' && linkResult.wellId) {
                  try {
                    const unitSections = extracted_data?.unit_sections;
                    const topLevelAlloc = extracted_data?.section_allocation_percentage ?? extracted_data?.lateral_allocation_percentage;
                    const primaryWellId = linkResult.wellId.split(',')[0].trim();

                    // TRS normalization: strip leading zeros, collapse whitespace, uppercase
                    const normTrs = (sec: any, twn: any, rng: any) => ({
                      sec: sec ? String(parseInt(String(sec), 10)) : null,
                      twn: twn ? String(twn).replace(/^0+/, '').replace(/\s+/g, '').toUpperCase() : null,
                      rng: rng ? String(rng).replace(/^0+/, '').replace(/\s+/g, '').toUpperCase() : null,
                    });

                    // Ensure allocation columns exist (defensive — migration should have run)
                    const allocCols = [
                      { name: 'section_allocation_pct', type: 'REAL' },
                      { name: 'allocation_source', type: 'TEXT' },
                      { name: 'allocation_source_doc_id', type: 'TEXT' },
                    ];
                    for (const col of allocCols) {
                      try {
                        await env.WELLS_DB.prepare(`SELECT ${col.name} FROM property_well_links LIMIT 1`).first();
                      } catch {
                        try {
                          await env.WELLS_DB.prepare(`ALTER TABLE property_well_links ADD COLUMN ${col.name} ${col.type}`).run();
                          console.log(`[Alloc Write-Back] Added column property_well_links.${col.name}`);
                        } catch (addErr) {
                          // Column may already exist
                        }
                      }
                    }

                    if (Array.isArray(unitSections) && unitSections.length > 0) {
                      // Get all property_well_links for this well with property TRS data
                      const links = await env.WELLS_DB.prepare(`
                        SELECT pwl.id, p.section, p.township, p.range
                        FROM property_well_links pwl
                        JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
                        WHERE pwl.well_airtable_id = ? AND pwl.status IN ('Active', 'Linked')
                      `).bind(primaryWellId).all();

                      for (const us of unitSections) {
                        const allocFactor = us.allocation_factor ?? us.allocation_percentage;
                        if (allocFactor == null || allocFactor <= 0) continue;

                        // Normalize the allocation to 0-1 range
                        const allocDecimal = allocFactor > 1 ? allocFactor / 100 : allocFactor;
                        const usNorm = normTrs(us.section, us.township, us.range);

                        // Find matching property_well_links record by TRS
                        for (const link of (links.results || []) as any[]) {
                          const linkNorm = normTrs(link.section, link.township, link.range);
                          if (usNorm.sec === linkNorm.sec && usNorm.twn === linkNorm.twn && usNorm.rng === linkNorm.rng) {
                            await env.WELLS_DB.prepare(`
                              UPDATE property_well_links
                              SET section_allocation_pct = ?,
                                  allocation_source = 'division_order',
                                  allocation_source_doc_id = ?
                              WHERE id = ?
                            `).bind(allocDecimal, docId, link.id).run();
                            console.log(`[Alloc Write-Back] Set ${(allocDecimal * 100).toFixed(2)}% on link ${link.id} (S${usNorm.sec}-T${usNorm.twn}-R${usNorm.rng}) from doc ${docId}`);
                            break;
                          }
                        }
                      }
                    } else if (topLevelAlloc != null && topLevelAlloc > 0 && linkResult.propertyId) {
                      // Single top-level allocation — write to the specific property-well link
                      const allocDecimal = topLevelAlloc > 1 ? topLevelAlloc / 100 : topLevelAlloc;
                      const primaryPropId = linkResult.propertyId.split(',')[0].trim();

                      await env.WELLS_DB.prepare(`
                        UPDATE property_well_links
                        SET section_allocation_pct = ?,
                            allocation_source = 'division_order',
                            allocation_source_doc_id = ?
                        WHERE well_airtable_id = ? AND property_airtable_id = ?
                          AND status IN ('Active', 'Linked')
                      `).bind(allocDecimal, docId, primaryWellId, primaryPropId).run();
                      console.log(`[Alloc Write-Back] Set top-level ${(allocDecimal * 100).toFixed(2)}% for well ${primaryWellId} → property ${primaryPropId} from doc ${docId}`);
                    }
                  } catch (allocError) {
                    console.error('[Alloc Write-Back] Error:', allocError);
                  }
                }
              } catch (linkError) {
                console.error('[Documents] Error during auto-link:', linkError);
                console.error('[Documents] Error stack:', linkError.stack);
              }
            } else {
              console.log('[Documents] Skipping auto-link - effectiveStatus:', effectiveStatus, 'Has extracted data:', !!extracted_data, 'skip_extraction:', extracted_data?.skip_extraction);
              if (extracted_data) {
                console.log('[DEBUG] extracted_data sample:', JSON.stringify(extracted_data).substring(0, 200));
              }
            }

            // Auto-populate pun_api_crosswalk for completion reports
            if (doc_type === 'completion_report' && extracted_data) {
              try {
                // Get API - prefer normalized version
                const apiNumber = extracted_data.api_number_normalized || extracted_data.api_number;

                if (!apiNumber) {
                  console.log('[PUN Crosswalk] Skipping - no API number in extracted data');
                } else {
                  const insertedPuns = new Set<string>(); // Track to avoid duplicates

                  // Helper function to insert a PUN mapping
                  // pun: dashed format (e.g., 017-231497-0-0000) - matches OTC production data
                  const insertCrosswalk = async (pun: string, sectionCounty?: string) => {
                    if (!pun || insertedPuns.has(pun)) return;
                    insertedPuns.add(pun);

                    console.log('[PUN Crosswalk] Inserting PUN mapping:', pun, '->', apiNumber);
                    // pun_api_crosswalk has api_number as PRIMARY KEY
                    await env.WELLS_DB.prepare(`
                      INSERT INTO pun_api_crosswalk (api_number, pun, well_name, county, operator, effective_date, source_document_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(api_number) DO UPDATE SET
                        pun = excluded.pun,
                        updated_at = CURRENT_TIMESTAMP,
                        source_document_id = excluded.source_document_id,
                        well_name = COALESCE(excluded.well_name, well_name),
                        operator = COALESCE(excluded.operator, operator),
                        effective_date = COALESCE(excluded.effective_date, effective_date)
                    `).bind(
                      apiNumber,
                      pun,
                      extracted_data.well_name || null,
                      sectionCounty || extracted_data.county || county || null,
                      extracted_data.operator?.name || null,
                      extracted_data.dates?.completion_date || null,
                      docId
                    ).run();

                    // Also insert into well_pun_links (used for production matching)
                    // base_pun (first 10 chars: XXX-XXXXXX) is critical for horizontal well production matching
                    const basePun = pun.length >= 10 ? pun.substring(0, 10) : pun;
                    await env.WELLS_DB.prepare(`
                      INSERT INTO well_pun_links (api_number, pun, base_pun, match_method, confidence)
                      VALUES (?, ?, ?, '1002a_extraction', 'high')
                      ON CONFLICT(api_number, pun) DO UPDATE SET
                        base_pun = COALESCE(excluded.base_pun, base_pun),
                        updated_at = CURRENT_TIMESTAMP
                    `).bind(apiNumber, pun, basePun).run();
                  };

                  // Single well PUN (vertical wells, or primary PUN for horizontal)
                  if (extracted_data.otc_prod_unit_no) {
                    await insertCrosswalk(extracted_data.otc_prod_unit_no);
                  }

                  // Multi-section horizontal wells (multiple PUNs in allocation_factors)
                  if (extracted_data.allocation_factors?.length) {
                    for (const factor of extracted_data.allocation_factors) {
                      if (factor.pun) {
                        await insertCrosswalk(factor.pun, factor.county);
                      }
                    }
                  }

                  if (insertedPuns.size > 0) {
                    console.log('[PUN Crosswalk] Successfully inserted', insertedPuns.size, 'PUN mapping(s)');

                    // Also update wells.otc_prod_unit_no if not already set
                    // Use the dashed format for consistency with production data
                    const api10 = apiNumber.substring(0, 10);
                    const primaryPun = extracted_data.otc_prod_unit_no || Array.from(insertedPuns)[0];
                    const updateResult = await env.WELLS_DB.prepare(`
                      UPDATE wells
                      SET otc_prod_unit_no = ?
                      WHERE (api_number = ? OR api_number LIKE ? || '%')
                        AND (otc_prod_unit_no IS NULL OR otc_prod_unit_no = '')
                    `).bind(
                      primaryPun,
                      api10,
                      api10
                    ).run();

                    if (updateResult.meta.changes > 0) {
                      console.log('[PUN Crosswalk] Updated wells.otc_prod_unit_no for API:', api10);
                    }
                  } else {
                    console.log('[PUN Crosswalk] No PUNs found in extracted data');
                  }
                }
              } catch (crosswalkError) {
                // Don't fail the request if crosswalk insert fails
                console.error('[PUN Crosswalk] Failed to insert crosswalk:', crosswalkError);
              }

              // Update well_1002a_tracking to mark as processed
              try {
                const extractedPun = extracted_data.otc_prod_unit_no_normalized || extracted_data.otc_prod_unit_no || null;
                await env.WELLS_DB.prepare(`
                  UPDATE well_1002a_tracking
                  SET status = 'processed',
                      extracted_pun = COALESCE(?, extracted_pun),
                      extraction_method = 'claude',
                      confidence = 'high',
                      processed_at = datetime('now'),
                      updated_at = CURRENT_TIMESTAMP
                  WHERE api_number = ? OR api_number = ?
                `).bind(
                  extractedPun,
                  apiNumber,
                  apiNumber.substring(0, 10)
                ).run();
                console.log('[1002A Tracking] Marked as processed:', apiNumber);
              } catch (trackingError) {
                console.error('[1002A Tracking] Failed to update tracking:', trackingError);
              }

              // Update wells table with completion report data (bottom hole, lateral, IP, formation)
              try {
                const apiNumber = extracted_data.api_number_normalized || extracted_data.api_number;
                if (apiNumber) {
                  const api10 = apiNumber.substring(0, 10);

                  // Extract bottom hole location
                  const bhLat = extracted_data.bottom_hole_location?.latitude || null;
                  const bhLon = extracted_data.bottom_hole_location?.longitude || null;

                  // Extract lateral length
                  const lateralLength = extracted_data.lateral_details?.lateral_length_ft || null;

                  // Extract total depth
                  const totalDepth = extracted_data.surface_location?.total_depth_ft || null;

                  // Extract initial production
                  const ipOil = extracted_data.initial_production?.oil_bbl_per_day || null;
                  const ipGas = extracted_data.initial_production?.gas_mcf_per_day || null;
                  const ipWater = extracted_data.initial_production?.water_bbl_per_day || null;

                  // Extract formation info (from formation_zones array or formation_tops)
                  let formationName = null;
                  let formationDepth = null;
                  if (extracted_data.formation_zones?.length > 0) {
                    // Use first/primary formation
                    formationName = extracted_data.formation_zones[0].formation_name || null;
                    // Get depth from perforated intervals if available
                    const perfs = extracted_data.formation_zones[0].perforated_intervals;
                    if (perfs?.length > 0) {
                      formationDepth = perfs[0].from_ft || null;
                    }
                  } else if (extracted_data.formation_tops?.length > 0) {
                    formationName = extracted_data.formation_tops[0].name || null;
                    formationDepth = extracted_data.formation_tops[0].depth_ft || null;
                  }

                  // Extract completion date
                  const completionDate = extracted_data.dates?.completion_date || null;

                  // Build dynamic UPDATE - only set fields that have values
                  const updates: string[] = [];
                  const values: any[] = [];

                  if (bhLat !== null) { updates.push('bh_latitude = ?'); values.push(bhLat); }
                  if (bhLon !== null) { updates.push('bh_longitude = ?'); values.push(bhLon); }
                  if (lateralLength !== null) { updates.push('lateral_length = ?'); values.push(lateralLength); }
                  if (totalDepth !== null) { updates.push('measured_total_depth = ?'); values.push(totalDepth); }
                  if (ipOil !== null) { updates.push('ip_oil_bbl = ?'); values.push(ipOil); }
                  if (ipGas !== null) { updates.push('ip_gas_mcf = ?'); values.push(ipGas); }
                  if (ipWater !== null) { updates.push('ip_water_bbl = ?'); values.push(ipWater); }
                  if (formationName !== null) { updates.push('formation_name = ?'); values.push(formationName); }
                  if (formationDepth !== null) { updates.push('formation_depth = ?'); values.push(formationDepth); }
                  if (completionDate !== null) { updates.push('completion_date = ?'); values.push(completionDate); }

                  if (updates.length > 0) {
                    updates.push('updated_at = CURRENT_TIMESTAMP');
                    const sql = `UPDATE wells SET ${updates.join(', ')} WHERE api_number = ? OR api_number LIKE ? || '%'`;
                    values.push(api10, api10);

                    const updateResult = await env.WELLS_DB.prepare(sql).bind(...values).run();

                    if (updateResult.meta.changes > 0) {
                      console.log('[Completion Data] Updated wells table with:', {
                        api: api10,
                        bh_lat: bhLat,
                        bh_lon: bhLon,
                        lateral_length: lateralLength,
                        ip_oil: ipOil,
                        ip_gas: ipGas,
                        formation: formationName
                      });
                    } else {
                      console.log('[Completion Data] No matching well found for API:', api10);
                    }
                  }
                }
              } catch (wellUpdateError) {
                console.error('[Completion Data] Failed to update wells table:', wellUpdateError);
              }
            }

            // Auto-populate pooling_orders, pooling_election_options, and lease_comps for pooling orders
            if ((doc_type === 'pooling_order' || doc_type === 'force_pooling_order') && extracted_data) {
              try {
                const orderInfo = extracted_data.order_info || {};
                const unitInfo = extracted_data.unit_info || {};
                const wellInfo = extracted_data.well_info || {};
                const deadlines = extracted_data.deadlines || {};
                const defaultElection = extracted_data.default_election || {};

                const poolingId = 'po_' + docId.replace(/^doc_/, '');

                // 1. Insert into pooling_orders
                try {
                  await env.WELLS_DB.prepare(`
                    INSERT OR IGNORE INTO pooling_orders (
                      id, document_id, case_number, order_number, order_date, effective_date,
                      applicant, operator, proposed_well_name,
                      section, township, range, county, meridian,
                      unit_description, unit_size_acres,
                      well_type, formations,
                      response_deadline, response_deadline_days,
                      default_election_option, default_election_description,
                      confidence
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `).bind(
                    poolingId,
                    docId,
                    orderInfo.case_number || null,
                    orderInfo.order_number || null,
                    orderInfo.order_date || null,
                    orderInfo.effective_date || null,
                    extracted_data.applicant?.name || null,
                    extracted_data.operator?.name || null,
                    wellInfo.proposed_well_name || null,
                    extracted_data.section ? String(extracted_data.section) : (section ? String(section) : null),
                    extracted_data.township || township || null,
                    extracted_data.range || range || null,
                    extracted_data.county || county || null,
                    'IM',
                    unitInfo.unit_description || null,
                    unitInfo.unit_size_acres || null,
                    wellInfo.well_type || null,
                    extracted_data.formations ? JSON.stringify(extracted_data.formations) : null,
                    deadlines.election_deadline || null,
                    deadlines.election_period_days || null,
                    defaultElection.option_number != null ? String(defaultElection.option_number) : null,
                    defaultElection.description || null,
                    'high'
                  ).run();
                  console.log('[Pooling] Inserted pooling_orders for:', docId);
                } catch (poErr: any) {
                  console.error('[Pooling] Failed to insert pooling_orders for', docId, ':', poErr);
                }

                // 2. Insert election options
                const options = extracted_data.election_options || [];
                for (const opt of options) {
                  try {
                    await env.WELLS_DB.prepare(`
                      INSERT INTO pooling_election_options (
                        pooling_order_id, option_number, option_type, description,
                        bonus_per_acre, royalty_fraction, royalty_decimal,
                        working_interest_retained, cost_per_nma, penalty_percentage, notes
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).bind(
                      poolingId,
                      opt.option_number || null,
                      opt.option_type || null,
                      opt.description || null,
                      opt.bonus_per_nma || null,
                      opt.royalty_rate || null,
                      opt.nri_delivered ? parseFloat(String(opt.nri_delivered).replace('%', '')) / 100 : null,
                      opt.option_type === 'participate' ? 1 : 0,
                      opt.cost_per_nma || null,
                      opt.risk_penalty_percentage || null,
                      opt.excess_royalty ? `Excess royalty: ${opt.excess_royalty}` : null
                    ).run();
                  } catch (optErr: any) {
                    console.error('[Pooling] Failed to insert election option', opt.option_number, 'for', docId, ':', optErr);
                  }
                }

                // 3. Insert lease comps from exhibits
                const leaseExhibits = extracted_data.lease_exhibits || [];
                for (const comp of leaseExhibits) {
                  try {
                    await env.WELLS_DB.prepare(`
                      INSERT INTO lease_comps (
                        source_document_id, section, township, range, county, state, quarters,
                        lessor, lessee, bonus_per_nma, royalty, royalty_decimal,
                        lease_date, term_years, acres,
                        source_case_number, source_order_number
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).bind(
                      docId,
                      comp.section ? String(comp.section) : null,
                      comp.township || null,
                      comp.range || null,
                      comp.county || extracted_data.county || county || null,
                      'Oklahoma',
                      comp.quarters || null,
                      comp.lessor || null,
                      comp.lessee || null,
                      comp.bonus_per_nma || null,
                      comp.royalty || null,
                      comp.royalty_decimal || null,
                      comp.lease_date || null,
                      comp.term_years || null,
                      comp.acres || null,
                      orderInfo.case_number || null,
                      orderInfo.order_number || null
                    ).run();
                  } catch (compErr: any) {
                    console.error('[Pooling] Failed to insert lease comp for', docId, ':', compErr);
                  }
                }

                console.log(`[Pooling] Post-processing complete for ${docId}: ${options.length} options, ${leaseExhibits.length} lease comps`);
              } catch (poolingError) {
                // Non-fatal — document is already saved with full extracted_data JSON
                console.error('[Pooling] Post-processing failed for', docId, ':', poolingError);
              }
            }

            // Track document usage and deduct credit (only for successful processing)
            if (status !== 'failed') {
              try {
                // Get user info and plan from the document
                // Use organization_id if available (for org-level credit tracking)
                const docInfo = await env.WELLS_DB.prepare(`
                  SELECT user_id, organization_id, user_plan FROM documents WHERE id = ?
                `).bind(docId).first();

                if (docInfo?.user_id) {
                  const userId = docInfo.user_id as string;
                  const userPlan = (docInfo.user_plan as string) || 'Free';

                  // Skip credit tracking for system-triggered documents
                  if (userId === 'system_harvester' || userPlan === 'system') {
                    console.log('[Usage] Skipping credit tracking for system document:', docId);
                  } else {
                    const usageService = new UsageTrackingService(env.WELLS_DB);
                    // Use organization_id for credit tracking if available, otherwise user_id
                    const creditUserId = (docInfo.organization_id as string) || userId;
                    await usageService.trackDocumentProcessed(
                      creditUserId,
                      userPlan,
                      docId,
                      doc_type || 'unknown',
                      page_count || 0,
                      false, // isMultiDoc - handle this in split endpoint
                      0,     // childCount - handle this in split endpoint
                      extracted_data?.skip_extraction || false
                    );
                    console.log('[Usage] Tracked document processing for:', creditUserId, '(org:', docInfo.organization_id, ', user:', userId, ') plan:', userPlan);
                  }
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
          SELECT r2_key, filename, user_id, organization_id, user_plan, user_email, user_name
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

          // Post-process extracted data for child (normalize PUNs, etc.)
          if (child.extracted_data) {
            child.extracted_data = postProcessExtractedData(child.extracted_data);
          }

          await env.WELLS_DB.prepare(`
            INSERT INTO documents (
              id, r2_key, filename, user_id, organization_id, user_plan,
              user_email, user_name,
              parent_document_id, page_range_start, page_range_end,
              status, doc_type, display_name, category, confidence,
              county, section, township, range, extracted_data,
              needs_review, field_scores, fields_needing_review,
              upload_date, extraction_completed_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              datetime('now', '-6 hours'), datetime('now', '-6 hours')
            )
          `).bind(
            childId,
            parentDoc.r2_key, // Same PDF file
            parentDoc.filename,
            parentDoc.user_id,
            parentDoc.organization_id,
            parentDoc.user_plan || 'Free', // Inherit plan from parent
            parentDoc.user_email || null,
            parentDoc.user_name || null,
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

        // Track usage for multi-document processing
        try {
          if (parentDoc?.user_id) {
            const usageService = new UsageTrackingService(env.WELLS_DB);
            const userPlan = (parentDoc.user_plan as string) || 'Free';
            // Use organization_id for credit tracking if available, otherwise user_id
            const creditUserId = (parentDoc.organization_id as string) || (parentDoc.user_id as string);

            // 1. Track parent with skip_extraction=true (0 credits)
            await usageService.trackDocumentProcessed(
              creditUserId,
              userPlan,
              parentDocId,
              'multi_document',
              0, // 0 pages
              true, // isMultiDoc
              children.length, // childCount
              true // skip_extraction = true means no credit deducted for parent
            );
            console.log(`[Usage] Tracked parent multi-document ${parentDocId} for ${creditUserId} (0 credits)`);

            // 2. Track each child document (1 credit each, unless skip_extraction)
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              const childId = childIds[i];
              const pageCount = child.page_range_end - child.page_range_start + 1;

              // Check if this child has skip_extraction (e.g., "other" type documents)
              const childSkipExtraction = child.extracted_data?.skip_extraction || false;

              await usageService.trackDocumentProcessed(
                creditUserId,
                userPlan,
                childId,
                child.doc_type || 'unknown',
                pageCount,
                false, // not a multi-doc parent
                0, // no children
                childSkipExtraction // Only charge if extraction was actually done
              );
              console.log(`[Usage] Tracked child document ${childId} for ${creditUserId} (${child.doc_type}, ${childSkipExtraction ? '0' : '1'} credit)`);
            }

            console.log(`[Usage] Total for multi-document: ${children.length} credits for ${children.length} children (user: ${creditUserId})`);
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
        // Look up user email/name from their most recent document in D1
        const userDoc = await env.WELLS_DB.prepare(`
          SELECT user_email, user_name FROM documents
          WHERE user_id = ? AND user_email IS NOT NULL
          ORDER BY upload_date DESC LIMIT 1
        `).bind(userId).first();

        if (userDoc?.user_email) {
          return jsonResponse({
            id: userId,
            email: userDoc.user_email,
            name: userDoc.user_name || 'User',
            notification_preferences: {
              email_on_complete: true
            }
          }, 200, env);
        }

        // No email found (system_harvester or old docs without email)
        console.log(`No email found for user ${userId}, skipping notification`);
        return jsonResponse({
          id: userId,
          email: null,
          name: 'User',
          notification_preferences: {
            email_on_complete: false
          }
        }, 200, env);
      } catch (error) {
        console.error('Get user error:', error);
        return jsonResponse({
          id: userId,
          email: null,
          name: 'User',
          notification_preferences: {
            email_on_complete: false
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
          force?: boolean;
        };

        const { caseNumber, orderNumber, force } = body;

        if (!caseNumber) {
          return errorResponse('caseNumber is required', 400, env);
        }

        console.log(`[OCC Fetch] User ${user.id} requesting case ${caseNumber}${force ? ' (force re-analyze)' : ''}`);

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

        if (existing && !force) {
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

        // If force re-analyze and document exists, soft-delete the old one
        if (existing && force) {
          console.log(`[OCC Fetch] Force re-analyze: soft-deleting existing document ${existing.id}`);
          await env.WELLS_DB.prepare(`
            UPDATE documents SET deleted_at = datetime('now') WHERE id = ?
          `).bind(existing.id).run();
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

    // Route: POST /api/occ/fetch-1002a - Fetch and process a 1002A completion report
    // Called from portal UI when user clicks "Analyze" on a completion report
    if (path === '/api/occ/fetch-1002a' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      try {
        const body = await request.json() as {
          apiNumber: string;
          entryId: number;
          force?: boolean;  // If true, re-analyze even if already processed
        };

        const { apiNumber, entryId, force } = body;

        if (!apiNumber || !entryId) {
          return errorResponse('apiNumber and entryId are required', 400, env);
        }

        console.log(`[1002A Fetch] User ${user.id} requesting API ${apiNumber} entryId ${entryId}${force ? ' (force re-analyze)' : ''}`);

        // Get user's plan and organization
        const userPlan = user.fields?.Plan || user.plan || user.Plan || 'Free';
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;

        // Check if already processed (by entryId in source_metadata)
        const existingQuery = `
          SELECT id, display_name, status FROM documents
          WHERE user_id = ?
          AND deleted_at IS NULL
          AND json_extract(source_metadata, '$.entryId') = ?
        `;

        const existing = await env.WELLS_DB.prepare(existingQuery).bind(user.id, entryId).first() as { id: string; display_name: string; status: string } | null;

        if (existing && !force) {
          console.log(`[1002A Fetch] Document already exists: ${existing.id}`);

          // Get current credit balance for UI
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

        // If force re-analyze and document exists, soft-delete the old one
        if (existing && force) {
          console.log(`[1002A Fetch] Force re-analyze: soft-deleting existing document ${existing.id}`);
          await env.WELLS_DB.prepare(`
            UPDATE documents SET deleted_at = datetime('now') WHERE id = ?
          `).bind(existing.id).run();
        }

        // Check credits before fetching
        const creditUserId = user.organizationId || user.id;
        const usageService = new UsageTrackingService(env.WELLS_DB);
        const creditCheck = await usageService.checkCreditsAvailable(creditUserId, userPlan);

        if (!creditCheck.hasCredits) {
          console.log(`[1002A Fetch] User ${user.id} has no credits`);
          return jsonResponse({
            error: 'no_credits',
            message: creditCheck.message || 'No credits available. Please purchase a credit pack or upgrade your plan.',
            creditsRemaining: 0
          }, 402, env);
        }

        console.log(`[1002A Fetch] User has ${creditCheck.totalAvailable} credits, calling occ-fetcher`);

        // Call occ-fetcher to download specific 1002A form
        const occResponse = await env.OCC_FETCHER.fetch(
          new Request('https://internal/download-1002a-forms', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.PROCESSING_API_KEY
            },
            body: JSON.stringify({
              apiNumber,
              entryIds: [entryId],
              userId: user.id,
              userPlan,
              organizationId: userOrg
            })
          })
        );

        const occResult = await occResponse.json() as any;

        if (!occResponse.ok || !occResult.success) {
          console.error('[1002A Fetch] occ-fetcher error:', occResult);
          return jsonResponse({
            error: 'fetch_failed',
            message: occResult.error || 'Failed to fetch 1002A from OCC',
            creditsRemaining: creditCheck.totalAvailable
          }, occResponse.status || 500, env);
        }

        // Find the result for our entryId
        const formResult = occResult.results?.find((r: any) => r.form?.entryId === entryId);

        if (!formResult?.success || !formResult?.documentId) {
          console.error('[1002A Fetch] Form not found in results:', occResult.results);
          return jsonResponse({
            error: 'fetch_failed',
            message: formResult?.error || 'Failed to process 1002A form',
            creditsRemaining: creditCheck.totalAvailable
          }, 500, env);
        }

        console.log(`[1002A Fetch] Successfully fetched document ${formResult.documentId}`);

        // Get the document status
        const doc = await env.WELLS_DB.prepare(
          'SELECT id, status, display_name FROM documents WHERE id = ?'
        ).bind(formResult.documentId).first();

        return jsonResponse({
          success: true,
          document: {
            id: formResult.documentId,
            status: doc?.status || 'pending',
            displayName: doc?.display_name
          },
          form: formResult.form,
          creditsRemaining: creditCheck.totalAvailable - 1
        }, 200, env);

      } catch (error) {
        console.error('[1002A Fetch] Error:', error);
        return errorResponse('Failed to fetch 1002A document: ' + (error as Error).message, 500, env);
      }
    }

    // Route: POST /api/occ/fetch-1000 - Fetch and process a Form 1000 drilling permit
    // Called from portal UI when user clicks "Analyze" on a drilling permit
    if (path === '/api/occ/fetch-1000' && request.method === 'POST') {
      const user = await authenticateUser(request, env);
      if (!user) return errorResponse('Unauthorized', 401, env);

      try {
        const body = await request.json() as {
          apiNumber: string;
          entryId: number;
          force?: boolean;
        };

        const { apiNumber, entryId, force } = body;

        if (!apiNumber || !entryId) {
          return errorResponse('apiNumber and entryId are required', 400, env);
        }

        console.log(`[1000 Fetch] User ${user.id} requesting API ${apiNumber} entryId ${entryId}${force ? ' (force re-analyze)' : ''}`);

        const userPlan = user.fields?.Plan || user.plan || user.Plan || 'Free';
        const userOrg = user.fields?.Organization?.[0] || user.organization?.[0] || user.Organization?.[0] || null;

        // Check if already processed (by entryId in source_metadata)
        const existingQuery = `
          SELECT id, display_name, status FROM documents
          WHERE user_id = ?
          AND deleted_at IS NULL
          AND json_extract(source_metadata, '$.entryId') = ?
        `;

        const existing = await env.WELLS_DB.prepare(existingQuery).bind(user.id, entryId).first() as { id: string; display_name: string; status: string } | null;

        if (existing && !force) {
          console.log(`[1000 Fetch] Document already exists: ${existing.id}`);

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

        // If force re-analyze and document exists, soft-delete the old one
        if (existing && force) {
          console.log(`[1000 Fetch] Force re-analyze: soft-deleting existing document ${existing.id}`);
          await env.WELLS_DB.prepare(`
            UPDATE documents SET deleted_at = datetime('now') WHERE id = ?
          `).bind(existing.id).run();
        }

        // Check credits before fetching
        const creditUserId = user.organizationId || user.id;
        const usageService = new UsageTrackingService(env.WELLS_DB);
        const creditCheck = await usageService.checkCreditsAvailable(creditUserId, userPlan);

        if (!creditCheck.hasCredits) {
          console.log(`[1000 Fetch] User ${user.id} has no credits`);
          return jsonResponse({
            error: 'no_credits',
            message: creditCheck.message || 'No credits available. Please purchase a credit pack or upgrade your plan.',
            creditsRemaining: 0
          }, 402, env);
        }

        console.log(`[1000 Fetch] User has ${creditCheck.totalAvailable} credits, calling occ-fetcher`);

        // Call occ-fetcher to download specific Form 1000
        const occResponse = await env.OCC_FETCHER.fetch(
          new Request('https://internal/download-1000-forms', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.PROCESSING_API_KEY
            },
            body: JSON.stringify({
              apiNumber,
              entryIds: [entryId],
              userId: user.id,
              userPlan,
              organizationId: userOrg
            })
          })
        );

        const occResult = await occResponse.json() as any;

        if (!occResponse.ok || !occResult.success) {
          console.error('[1000 Fetch] occ-fetcher error:', occResult);
          return jsonResponse({
            error: 'fetch_failed',
            message: occResult.error || 'Failed to fetch Form 1000 from OCC',
            creditsRemaining: creditCheck.totalAvailable
          }, occResponse.status || 500, env);
        }

        // Find the result for our entryId
        const formResult = occResult.results?.find((r: any) => r.form?.entryId === entryId);

        if (!formResult?.success || !formResult?.documentId) {
          console.error('[1000 Fetch] Form not found in results:', occResult.results);
          return jsonResponse({
            error: 'fetch_failed',
            message: formResult?.error || 'Failed to process Form 1000',
            creditsRemaining: creditCheck.totalAvailable
          }, 500, env);
        }

        console.log(`[1000 Fetch] Successfully fetched document ${formResult.documentId}`);

        const doc = await env.WELLS_DB.prepare(
          'SELECT id, status, display_name FROM documents WHERE id = ?'
        ).bind(formResult.documentId).first();

        return jsonResponse({
          success: true,
          document: {
            id: formResult.documentId,
            status: doc?.status || 'pending',
            displayName: doc?.display_name
          },
          form: formResult.form,
          creditsRemaining: creditCheck.totalAvailable - 1
        }, 200, env);

      } catch (error) {
        console.error('[1000 Fetch] Error:', error);
        return errorResponse('Failed to fetch Form 1000 document: ' + (error as Error).message, 500, env);
      }
    }

    // Route: POST /api/processing/extract-county-record - Extract a county record from OKCR
    if (path === '/api/processing/extract-county-record' && request.method === 'POST') {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Unauthorized', 401, env);
      }

      try {
        const body = await request.json() as any;
        const { action, county, instrument_number, images, format, instrument_type,
                userId, userPlan, organizationId, credits_required, cacheRow } = body;

        if (!userId || !userPlan) {
          return errorResponse('Missing userId or userPlan', 400, env);
        }

        const service = new CountyRecordExtractionService(env);

        if (action === 'create_from_cache') {
          // Cached extraction: copy to new user's document, charge credits
          if (!cacheRow || !cacheRow.document_id) {
            return errorResponse('Missing cacheRow with document_id', 400, env);
          }
          const result = await service.createDocumentFromCache({
            userId,
            userPlan,
            organizationId,
            cacheRow,
            credits_required: credits_required || 5
          });
          return jsonResponse(result, result.success ? 200 : (result.status || 500), env);
        }

        // Full extraction: fetch from OKCR, extract, create document, charge credits
        if (!county || !instrument_number || !images || !Array.isArray(images) || images.length === 0) {
          return errorResponse('Missing county, instrument_number, or images array', 400, env);
        }

        const result = await service.extractCountyRecord({
          county,
          instrument_number,
          images,
          format: format || 'extract',
          instrument_type,
          userId,
          userPlan,
          organizationId,
          credits_required: credits_required || 5
        });

        return jsonResponse(result, result.success ? 200 : (result.status || 500), env);

      } catch (error) {
        console.error('[County Record Extraction] Error:', error);
        return errorResponse('Failed to extract county record: ' + (error as Error).message, 500, env);
      }
    }

    // =====================================================
    // POOLING ORDER RE-EXTRACTION WITH OPUS
    // =====================================================

    // Route: GET /api/processing/pooling-reextract/candidates - List documents needing re-review
    if (path === '/api/processing/pooling-reextract/candidates' && request.method === 'GET') {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Unauthorized', 401, env);
      }

      try {
        // Find pooling orders with no election options OR options missing bonus data
        // Exclude documents already re-extracted with Opus (notes contains "Opus re-extraction")
        const noOptionsResult = await env.WELLS_DB.prepare(`
          SELECT po.id as pooling_order_id, po.document_id, po.case_number, po.order_number,
                 po.county, po.operator, d.filename, d.r2_key, d.page_count,
                 'no_options' as issue_type
          FROM pooling_orders po
          JOIN documents d ON d.id = po.document_id
          WHERE NOT EXISTS (
            SELECT 1 FROM pooling_election_options peo WHERE peo.pooling_order_id = po.id
          )
          AND (d.notes IS NULL OR d.notes NOT LIKE '%Opus re-extraction%')
          ORDER BY po.order_date DESC
        `).all();

        const missingBonusResult = await env.WELLS_DB.prepare(`
          SELECT DISTINCT po.id as pooling_order_id, po.document_id, po.case_number, po.order_number,
                 po.county, po.operator, d.filename, d.r2_key, d.page_count,
                 'missing_bonus' as issue_type
          FROM pooling_orders po
          JOIN documents d ON d.id = po.document_id
          JOIN pooling_election_options peo ON peo.pooling_order_id = po.id
          WHERE peo.bonus_per_acre IS NULL
            AND peo.option_type NOT IN ('participate', 'non_consent')
            AND (d.notes IS NULL OR d.notes NOT LIKE '%Opus re-extraction%')
          ORDER BY po.order_date DESC
        `).all();

        // Combine and dedupe
        const seen = new Set<string>();
        const candidates: any[] = [];
        for (const row of [...noOptionsResult.results, ...missingBonusResult.results]) {
          const r = row as any;
          if (!seen.has(r.document_id)) {
            seen.add(r.document_id);
            candidates.push(r);
          }
        }

        // Estimate cost
        const totalPages = candidates.reduce((sum, c) => sum + (c.page_count || 7), 0);
        const estimatedInputTokens = totalPages * 2000; // ~2K tokens per page
        const estimatedOutputTokens = candidates.length * 3000; // ~3K output per doc
        const estimatedCost = (estimatedInputTokens * 15 + estimatedOutputTokens * 75) / 1_000_000;

        return jsonResponse({
          candidates,
          summary: {
            total: candidates.length,
            no_options: noOptionsResult.results.length,
            missing_bonus: missingBonusResult.results.length,
            total_pages: totalPages,
            estimated_cost_usd: Math.round(estimatedCost * 100) / 100
          }
        }, 200, env);

      } catch (error) {
        console.error('[Pooling Reextract] Candidates error:', error);
        return errorResponse('Failed to list candidates: ' + (error as Error).message, 500, env);
      }
    }

    // Route: POST /api/processing/pooling-reextract/:document_id - Re-extract single document with Opus
    if (path.startsWith('/api/processing/pooling-reextract/') && request.method === 'POST') {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.PROCESSING_API_KEY) {
        return errorResponse('Unauthorized', 401, env);
      }

      const documentId = path.split('/').pop();

      // Handle "all" endpoint
      if (documentId === 'all') {
        try {
          const body = await request.json() as any;
          const limit = body.limit || 10; // Process max 10 at a time by default
          const dryRun = body.dry_run || false;
          const force = body.force || false; // Force re-extract ALL documents

          // Get candidates
          let candidatesResult;
          if (force) {
            // Force mode: re-extract ALL pooling orders that haven't been v2 extracted yet
            candidatesResult = await env.WELLS_DB.prepare(`
              SELECT DISTINCT po.document_id
              FROM pooling_orders po
              JOIN documents d ON d.id = po.document_id
              WHERE d.r2_key IS NOT NULL
                AND (d.notes IS NULL OR d.notes NOT LIKE '%Opus v2%')
              ORDER BY po.order_date DESC
              LIMIT ?
            `).bind(limit).all();
          } else {
            // Normal mode: only candidates with issues, exclude already processed
            candidatesResult = await env.WELLS_DB.prepare(`
              SELECT DISTINCT po.document_id
              FROM pooling_orders po
              JOIN documents d ON d.id = po.document_id
              WHERE (d.notes IS NULL OR d.notes NOT LIKE '%Opus re-extraction%')
              LIMIT ?
            `).bind(limit).all();
          }

          if (dryRun) {
            return jsonResponse({
              dry_run: true,
              would_process: candidatesResult.results.length,
              document_ids: candidatesResult.results.map((r: any) => r.document_id)
            }, 200, env);
          }

          const results: any[] = [];
          for (const row of candidatesResult.results) {
            const docId = (row as any).document_id;
            try {
              const result = await reextractPoolingWithOpus(env, docId);
              results.push({ document_id: docId, ...result });
            } catch (err) {
              results.push({ document_id: docId, success: false, error: (err as Error).message });
            }
          }

          const successful = results.filter(r => r.success).length;
          return jsonResponse({
            processed: results.length,
            successful,
            failed: results.length - successful,
            results
          }, 200, env);

        } catch (error) {
          console.error('[Pooling Reextract All] Error:', error);
          return errorResponse('Failed to reextract all: ' + (error as Error).message, 500, env);
        }
      }

      // Single document re-extraction
      if (!documentId || documentId === 'candidates') {
        return errorResponse('Invalid document ID', 400, env);
      }

      try {
        const result = await reextractPoolingWithOpus(env, documentId);
        return jsonResponse(result, result.success ? 200 : 500, env);
      } catch (error) {
        console.error('[Pooling Reextract] Error:', error);
        return errorResponse('Failed to reextract: ' + (error as Error).message, 500, env);
      }
    }

    return errorResponse('Not found', 404, env);
  },
};