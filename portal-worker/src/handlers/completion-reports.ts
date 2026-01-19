/**
 * Completion Reports Handlers
 *
 * Handles fetching and analyzing 1002A completion reports from OCC
 * - GET /api/wells/{api}/completion-reports - Public endpoint to list available reports
 * - POST /api/wells/{api}/analyze-completion - Requires auth, triggers document fetch and processing
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

const OCC_FETCHER_URL = 'https://occ-fetcher.photog12.workers.dev';

/**
 * GET /api/wells/{api}/completion-reports
 *
 * Public endpoint that returns:
 * - RBDMS well data from D1
 * - Available 1002A forms from OCC
 * - Fetch status from tracking table
 */
export async function handleGetCompletionReports(
  apiNumber: string,
  env: Env
): Promise<Response> {
  if (!env.WELLS_DB) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  try {
    // 1. Get RBDMS data from D1 wells table
    const wellResult = await env.WELLS_DB.prepare(`
      SELECT well_name, completion_date, first_production_date, formation_name,
             well_status, otc_prod_unit_no, county
      FROM wells
      WHERE api_number = ? OR api_number LIKE ?
    `).bind(apiNumber, `${apiNumber}%`).first();

    // 2. Check OCC for available 1002A forms
    let occData: { success: boolean; forms?: any[]; error?: string } = { success: false, forms: [] };
    try {
      const occResponse = await fetch(
        `${OCC_FETCHER_URL}/get-1002a-forms?api=${apiNumber}`
      );
      occData = await occResponse.json() as typeof occData;
    } catch (occError) {
      console.error('Error fetching OCC forms:', occError);
      // Continue with empty forms - we can still return RBDMS data
    }

    // 3. Get fetch status from tracking table
    const statusResults = await env.WELLS_DB.prepare(`
      SELECT entry_id, status, document_id, fetched_at, error_message
      FROM well_1002a_status
      WHERE api_number = ?
    `).bind(apiNumber).all();

    const statusMap = new Map(
      statusResults.results.map((r: any) => [r.entry_id, r])
    );

    // 4. Merge data - combine OCC forms with fetch status
    const completionReports = (occData.forms || []).map((form: any) => {
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
        pun: (wellResult as any)?.otc_prod_unit_no || null
      };
    });

    return jsonResponse({
      success: true,
      apiNumber,
      wellName: (wellResult as any)?.well_name || occData.forms?.[0]?.wellName,
      completionReports,
      rbdmsData: {
        completionDate: (wellResult as any)?.completion_date,
        firstProductionDate: (wellResult as any)?.first_production_date,
        formation: (wellResult as any)?.formation_name,
        wellStatus: (wellResult as any)?.well_status,
        existingPun: (wellResult as any)?.otc_prod_unit_no
      }
    });

  } catch (error) {
    console.error('Error in handleGetCompletionReports:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * POST /api/wells/{api}/analyze-completion
 *
 * Requires authentication. Triggers:
 * 1. Download of 1002A forms from OCC
 * 2. Upload to R2 for processing
 * 3. Status tracking in D1
 */
export async function handleAnalyzeCompletion(
  apiNumber: string,
  request: Request,
  env: Env
): Promise<Response> {
  // Require authentication
  const session = await authenticateRequest(request, env);
  if (!session) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  if (!env.WELLS_DB) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  let body: { entryId?: number; entryIds?: number[] };
  try {
    body = await request.json() as { entryId?: number; entryIds?: number[] };
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const userId = session.id;
  const userPlan = session.airtableUser?.fields?.Plan || 'free';
  const organizationId = session.airtableUser?.fields?.Organization?.[0] || null;

  // Support both single entryId and array of entryIds
  const entryIds = body.entryIds || (body.entryId ? [body.entryId] : []);

  try {
    // 1. Update status to 'fetching' for each entry
    for (const entryId of entryIds) {
      await env.WELLS_DB.prepare(`
        INSERT INTO well_1002a_status (api_number, entry_id, status)
        VALUES (?, ?, 'fetching')
        ON CONFLICT(api_number, entry_id) DO UPDATE SET
          status = 'fetching',
          error_message = NULL
      `).bind(apiNumber, entryId).run();
    }

    // 2. Call occ-fetcher to download forms
    const fetchResponse = await fetch(
      `${OCC_FETCHER_URL}/download-1002a-forms`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiNumber,
          entryIds: entryIds.length > 0 ? entryIds : undefined,
          userId,
          userPlan,
          organizationId
        })
      }
    );

    const fetchResult = await fetchResponse.json() as {
      success: boolean;
      error?: string;
      results?: Array<{
        success: boolean;
        form: { entryId: number };
        documentId?: string;
        error?: string;
      }>;
    };

    if (!fetchResult.success) {
      // Update status to error for tracked entries
      for (const entryId of entryIds) {
        await env.WELLS_DB.prepare(`
          UPDATE well_1002a_status
          SET status = 'error', error_message = ?
          WHERE api_number = ? AND entry_id = ?
        `).bind(fetchResult.error || 'Unknown error', apiNumber, entryId).run();
      }

      return jsonResponse({
        success: false,
        error: fetchResult.error
      });
    }

    // 3. Update status for each fetched form using real entryIds from response
    for (const result of fetchResult.results || []) {
      if (result.success && result.form?.entryId) {
        await env.WELLS_DB.prepare(`
          INSERT INTO well_1002a_status (api_number, entry_id, status, document_id, fetched_at)
          VALUES (?, ?, 'fetched', ?, datetime('now'))
          ON CONFLICT(api_number, entry_id) DO UPDATE SET
            status = 'fetched',
            document_id = excluded.document_id,
            fetched_at = excluded.fetched_at,
            error_message = NULL
        `).bind(apiNumber, result.form.entryId, result.documentId || null).run();
      } else if (!result.success && result.form?.entryId) {
        // Track individual form errors
        await env.WELLS_DB.prepare(`
          UPDATE well_1002a_status
          SET status = 'error', error_message = ?
          WHERE api_number = ? AND entry_id = ?
        `).bind(result.error || 'Download failed', apiNumber, result.form.entryId).run();
      }
    }

    return jsonResponse({
      success: true,
      message: '1002A forms fetched and queued for processing',
      results: fetchResult.results
    });

  } catch (error) {
    console.error('Error in handleAnalyzeCompletion:', error);

    // Update status to error for all tracked entries
    for (const entryId of entryIds) {
      try {
        await env.WELLS_DB.prepare(`
          UPDATE well_1002a_status
          SET status = 'error', error_message = ?
          WHERE api_number = ? AND entry_id = ?
        `).bind(
          error instanceof Error ? error.message : 'Unknown error',
          apiNumber,
          entryId
        ).run();
      } catch (updateError) {
        console.error('Error updating status:', updateError);
      }
    }

    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
