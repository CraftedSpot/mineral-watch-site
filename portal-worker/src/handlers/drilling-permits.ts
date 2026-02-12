/**
 * Drilling Permits Handlers
 *
 * Handles fetching and analyzing Form 1000 drilling permits from OCC
 * - GET /api/wells/{api}/drilling-permits - List available permits
 * - POST /api/wells/{api}/analyze-permit - Triggers document fetch and processing
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

const OCC_FETCHER_URL = 'https://occ-fetcher.photog12.workers.dev';

/**
 * Helper to fetch from occ-fetcher using service binding if available
 */
async function fetchFromOccFetcher(
  path: string,
  env: Env,
  options?: RequestInit
): Promise<Response> {
  if (env.OCC_FETCHER) {
    return env.OCC_FETCHER.fetch(`https://occ-fetcher.photog12.workers.dev${path}`, options);
  }
  return fetch(`${OCC_FETCHER_URL}${path}`, options);
}

/**
 * GET /api/wells/{api}/drilling-permits
 *
 * Returns available Form 1000 drilling permits from OCC,
 * merged with fetch/analysis status from D1 tracking table.
 */
export async function handleGetDrillingPermits(
  apiNumber: string,
  env: Env
): Promise<Response> {
  if (!env.WELLS_DB) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  try {
    // 1. Check OCC for available Form 1000s (with caching)
    let occData: { success: boolean; forms?: any[]; error?: string } = { success: false, forms: [] };
    const cacheKey = `1000-forms:${apiNumber}`;
    const CACHE_TTL = 86400; // 24 hours

    try {
      if (env.COMPLETIONS_CACHE) {
        const cached = await env.COMPLETIONS_CACHE.get(cacheKey);
        if (cached) {
          console.log(`[DrillingPermits] Cache hit for ${apiNumber}`);
          occData = JSON.parse(cached);
        }
      }

      if (!occData.success || !occData.forms) {
        console.log(`[DrillingPermits] Cache miss, fetching from OCC for ${apiNumber}`);
        const occPath = `/get-1000-forms?api=${apiNumber}`;
        const occResponse = await fetchFromOccFetcher(occPath, env);
        occData = await occResponse.json() as typeof occData;

        if (occData.success && env.COMPLETIONS_CACHE) {
          await env.COMPLETIONS_CACHE.put(cacheKey, JSON.stringify(occData), { expirationTtl: CACHE_TTL });
          console.log(`[DrillingPermits] Cached forms for ${apiNumber} (TTL: ${CACHE_TTL}s)`);
        }
      }
    } catch (occError) {
      console.error('Error fetching OCC Form 1000s:', occError);
    }

    // 2. Get fetch status from tracking table
    const statusResults = await env.WELLS_DB.prepare(`
      SELECT entry_id, status, document_id, fetched_at, error_message
      FROM well_1000_status
      WHERE api_number = ?
    `).bind(apiNumber).all();

    const statusMap = new Map(
      statusResults.results.map((r: any) => [r.entry_id, r])
    );

    // 3. Merge OCC forms with tracking status
    const drillingPermits = (occData.forms || []).map((form: any) => {
      const status = statusMap.get(form.entryId);
      return {
        entryId: form.entryId,
        formType: form.formNumber,
        effectiveDate: form.effectiveDate,
        scanDate: form.scanDate,
        location: form.location,
        county: form.county,
        wellName: form.wellName,
        status: status?.status || 'available',
        documentId: status?.document_id || null,
        fetchedAt: status?.fetched_at || null,
        errorMessage: status?.error_message || null,
      };
    });

    return jsonResponse({
      success: true,
      apiNumber,
      drillingPermits,
    });

  } catch (error) {
    console.error('Error in handleGetDrillingPermits:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * POST /api/wells/{api}/analyze-permit
 *
 * Requires authentication. Triggers fetch + processing of a Form 1000 drilling permit.
 * Uses same flow as analyzeCompletion: portal-worker → documents-worker → occ-fetcher.
 */
export async function handleAnalyzePermit(
  apiNumber: string,
  request: Request,
  env: Env
): Promise<Response> {
  const session = await authenticateRequest(request, env);
  if (!session) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  if (!env.WELLS_DB) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  let body: { entryId?: number; force?: boolean };
  try {
    body = await request.json() as { entryId?: number; force?: boolean };
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const userId = session.id;
  const entryId = body.entryId;

  if (!entryId) {
    return jsonResponse({ error: 'entryId is required' }, 400);
  }

  try {
    // 1. Update status to 'fetching' in tracking table
    await env.WELLS_DB.prepare(`
      INSERT INTO well_1000_status (api_number, entry_id, status)
      VALUES (?, ?, 'fetching')
      ON CONFLICT(api_number, entry_id) DO UPDATE SET
        status = 'fetching',
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).bind(apiNumber, entryId).run();

    // 2. Call documents-worker via OCC proxy (portal /api/occ/* → documents-worker)
    // The documents-worker handles credit checks and calls occ-fetcher
    const proxyUrl = new URL(request.url);
    proxyUrl.pathname = '/api/occ/fetch-1000';

    const proxyRequest = new Request(proxyUrl.toString(), {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({
        apiNumber,
        entryId,
        force: body.force || false,
      }),
    });

    // Use the OCC proxy pattern - forward to documents-worker
    if (env.DOCUMENTS_WORKER) {
      const docResponse = await env.DOCUMENTS_WORKER.fetch(
        new Request('https://internal/api/occ/fetch-1000', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('Cookie') || '',
            'Authorization': request.headers.get('Authorization') || '',
          },
          body: JSON.stringify({
            apiNumber,
            entryId,
            force: body.force || false,
          }),
        })
      );

      const result = await docResponse.json() as any;

      // 3. Update tracking table based on result
      if (result.success && result.document?.id) {
        await env.WELLS_DB.prepare(`
          UPDATE well_1000_status
          SET status = 'fetched', document_id = ?, fetched_at = datetime('now'), error_message = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE api_number = ? AND entry_id = ?
        `).bind(result.document.id, apiNumber, entryId).run();
      } else if (result.alreadyProcessed && result.documentId) {
        await env.WELLS_DB.prepare(`
          UPDATE well_1000_status
          SET status = 'fetched', document_id = ?, fetched_at = datetime('now'), error_message = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE api_number = ? AND entry_id = ?
        `).bind(result.documentId, apiNumber, entryId).run();
      } else if (result.error) {
        await env.WELLS_DB.prepare(`
          UPDATE well_1000_status
          SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
          WHERE api_number = ? AND entry_id = ?
        `).bind(result.message || result.error || 'Unknown error', apiNumber, entryId).run();
      }

      return new Response(JSON.stringify(result), {
        status: docResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return jsonResponse({ error: 'Documents worker not available' }, 503);

  } catch (error) {
    console.error('Error in handleAnalyzePermit:', error);

    try {
      await env.WELLS_DB.prepare(`
        UPDATE well_1000_status
        SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE api_number = ? AND entry_id = ?
      `).bind(
        error instanceof Error ? error.message : 'Unknown error',
        apiNumber,
        entryId
      ).run();
    } catch (updateError) {
      console.error('Error updating status:', updateError);
    }

    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// ============================================================================
// Permit → Well Enrichment (COALESCE — only populate NULL fields)
// ============================================================================

interface PermitExtractedData {
  target_formation?: string;
  bottom_hole_location?: {
    section?: number | string;
    township?: string;
    range?: string;
    latitude?: number;
    longitude?: number;
  };
  lateral_length_ft?: number;
  target_depth_bottom?: number;
}

/**
 * Enrich a well record with data extracted from a Form 1000 drilling permit.
 *
 * Critical rule: permit data ONLY populates NULL fields. Every field uses
 * COALESCE(existing_value, new_value) so completion data always takes precedence.
 *
 * Call this after document extraction is complete for a drilling permit.
 */
export async function syncPermitToWell(
  apiNumber: string,
  extractedData: PermitExtractedData,
  env: Env
): Promise<{ updated: boolean; fields?: string[]; error?: string }> {
  if (!env.WELLS_DB) {
    return { updated: false, error: 'Database not available' };
  }

  try {
    const updates: string[] = [];
    const values: any[] = [];
    const fieldsUpdated: string[] = [];

    // Formation (proposed — completion actuals supersede via COALESCE)
    if (extractedData.target_formation) {
      updates.push('formation_name = COALESCE(formation_name, ?)');
      values.push(extractedData.target_formation);
      fieldsUpdated.push('formation_name');
    }

    // Bottom hole location (all three must be present to update)
    const bh = extractedData.bottom_hole_location;
    if (bh?.section && bh?.township && bh?.range) {
      updates.push('bh_section = COALESCE(bh_section, ?)');
      updates.push('bh_township = COALESCE(bh_township, ?)');
      updates.push('bh_range = COALESCE(bh_range, ?)');
      values.push(String(bh.section), bh.township, bh.range);
      fieldsUpdated.push('bh_section', 'bh_township', 'bh_range');
    }

    // Bottom hole coordinates
    if (bh?.latitude && bh?.longitude) {
      updates.push('bh_latitude = COALESCE(bh_latitude, ?)');
      updates.push('bh_longitude = COALESCE(bh_longitude, ?)');
      values.push(bh.latitude, bh.longitude);
      fieldsUpdated.push('bh_latitude', 'bh_longitude');
    }

    // Lateral length
    if (extractedData.lateral_length_ft) {
      updates.push('lateral_length = COALESCE(lateral_length, ?)');
      values.push(extractedData.lateral_length_ft);
      fieldsUpdated.push('lateral_length');
    }

    // Proposed total depth (target_depth_bottom → measured_total_depth)
    if (extractedData.target_depth_bottom) {
      updates.push('measured_total_depth = COALESCE(measured_total_depth, ?)');
      values.push(extractedData.target_depth_bottom);
      fieldsUpdated.push('measured_total_depth');
    }

    if (updates.length === 0) {
      return { updated: false };
    }

    values.push(apiNumber);
    values.push(`${apiNumber}%`);

    const query = `
      UPDATE wells
      SET ${updates.join(', ')}
      WHERE api_number = ? OR api_number LIKE ?
    `;

    const result = await env.WELLS_DB.prepare(query).bind(...values).run();
    const changed = (result.meta?.changes || 0) > 0;

    if (changed) {
      console.log(`[PermitEnrich] Updated well ${apiNumber}: ${fieldsUpdated.join(', ')}`);
    }

    return { updated: changed, fields: fieldsUpdated };

  } catch (error) {
    console.error(`[PermitEnrich] Error syncing permit data for ${apiNumber}:`, error);
    return {
      updated: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * POST /api/admin/sync-permit-to-well/{apiNumber}
 *
 * Admin endpoint to trigger enrichment of a well from its analyzed permit document.
 * Reads extracted data from the document and syncs to wells table.
 */
export async function handleSyncPermitToWell(
  apiNumber: string,
  request: Request,
  env: Env
): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '');

  if (!apiKey || (apiKey !== (env as any).SYNC_API_KEY && apiKey !== (env as any).PROCESSING_API_KEY)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (!env.WELLS_DB) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  try {
    // Find the most recent analyzed permit document for this well
    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.extracted_data
      FROM documents d
      WHERE d.doc_type = 'drilling_permit'
        AND d.status = 'complete'
        AND d.deleted_at IS NULL
        AND (
          json_extract(d.source_metadata, '$.apiNumber') = ?
          OR d.source_api = ?
        )
      ORDER BY d.created_at DESC
      LIMIT 1
    `).bind(apiNumber, apiNumber).first() as { id: string; extracted_data: string } | null;

    if (!doc) {
      return jsonResponse({
        success: false,
        error: 'No analyzed drilling permit found for this well'
      }, 404);
    }

    let extractedData: PermitExtractedData;
    try {
      extractedData = JSON.parse(doc.extracted_data);
    } catch {
      return jsonResponse({
        success: false,
        error: 'Failed to parse extracted data'
      }, 500);
    }

    const result = await syncPermitToWell(apiNumber, extractedData, env);

    return jsonResponse({
      success: result.updated,
      apiNumber,
      documentId: doc.id,
      ...result
    });

  } catch (error) {
    console.error(`Error in handleSyncPermitToWell for ${apiNumber}:`, error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
