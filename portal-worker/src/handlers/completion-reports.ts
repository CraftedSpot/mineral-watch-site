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
 * Helper to fetch from occ-fetcher using service binding if available
 */
async function fetchFromOccFetcher(
  path: string,
  env: Env,
  options?: RequestInit
): Promise<Response> {
  // Use service binding if available, otherwise fall back to public URL
  if (env.OCC_FETCHER) {
    return env.OCC_FETCHER.fetch(`https://occ-fetcher.photog12.workers.dev${path}`, options);
  }
  return fetch(`${OCC_FETCHER_URL}${path}`, options);
}

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
      const occPath = `/get-1002a-forms?api=${apiNumber}`;
      const occResponse = await fetchFromOccFetcher(occPath, env);
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
 * GET /api/wells/{api}/production-summary
 *
 * Returns aggregated production data for a well:
 * - Last month production (oil/gas)
 * - Last 12 months totals
 * - Lifetime totals
 * - Status (active/stale/inactive)
 * - YoY trend
 * - Sparkline data (last 6 months)
 */
export async function handleGetProductionSummary(
  apiNumber: string,
  env: Env
): Promise<Response> {
  if (!env.WELLS_DB) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  try {
    // Normalize API number (remove dashes, get 10-digit version)
    const apiNormalized = apiNumber.replace(/-/g, '');
    const api10 = apiNormalized.substring(0, 10);

    // Try to find PUN via multiple paths
    let pun: string | null = null;

    // Path A: Direct from wells table
    const wellResult = await env.WELLS_DB.prepare(`
      SELECT otc_prod_unit_no, well_name, formation_name
      FROM wells
      WHERE api_number = ? OR api_number = ? OR api_number LIKE ?
      LIMIT 1
    `).bind(apiNumber, api10, `${api10}%`).first() as { otc_prod_unit_no: string | null; well_name: string | null; formation_name: string | null } | null;

    if (wellResult?.otc_prod_unit_no) {
      const rawPun = wellResult.otc_prod_unit_no.replace(/-/g, '');
      // Only use if it's a complete 14-digit PUN
      if (rawPun.length >= 14) {
        pun = rawPun;
      }
    }

    // Path B: Via pun_api_crosswalk (document-sourced)
    if (!pun) {
      const crosswalkResult = await env.WELLS_DB.prepare(`
        SELECT pun FROM pun_api_crosswalk
        WHERE api_number = ? OR api_number = ? OR api_number LIKE ?
        LIMIT 1
      `).bind(apiNumber, apiNormalized, `${api10}%`).first() as { pun: string } | null;

      if (crosswalkResult?.pun) {
        pun = crosswalkResult.pun.replace(/-/g, '');
      }
    }

    // Path C: Via otc_leases
    if (!pun) {
      const leaseResult = await env.WELLS_DB.prepare(`
        SELECT pun FROM otc_leases
        WHERE api_number = ? OR api_number = ? OR api_number LIKE ?
        LIMIT 1
      `).bind(apiNumber, api10, `${api10}%`).first() as { pun: string } | null;

      if (leaseResult?.pun) {
        pun = leaseResult.pun.replace(/-/g, '');
      }
    }

    // Path D: Try to find PUN from production data using partial match
    // This helps when wells table has incomplete PUN (e.g., 8 digits instead of 14)
    if (!pun && wellResult?.otc_prod_unit_no) {
      const partialPun = wellResult.otc_prod_unit_no.replace(/-/g, '');
      // Pad with leading zero if needed (county codes are 3 digits)
      const searchPun = partialPun.length === 8 ? `0${partialPun.substring(0, 2)}-${partialPun.substring(2, 7)}%` :
                        partialPun.length < 14 ? `%${partialPun}%` : null;

      if (searchPun) {
        const prodResult = await env.WELLS_DB.prepare(`
          SELECT DISTINCT pun FROM otc_production
          WHERE pun LIKE ?
          LIMIT 1
        `).bind(searchPun).first() as { pun: string } | null;

        if (prodResult?.pun) {
          pun = prodResult.pun.replace(/-/g, '');
        }
      }
    }

    // If no PUN found, return empty response with hasPun: false
    if (!pun) {
      // Check if 1002A is available for this well (CTA opportunity)
      let has1002aAvailable = false;
      try {
        const occPath = `/get-1002a-forms?api=${apiNumber}`;
        const occResponse = await fetchFromOccFetcher(occPath, env);
        const occData = await occResponse.json() as { success: boolean; forms?: any[] };
        has1002aAvailable = (occData.forms?.length || 0) > 0;
      } catch {
        // Ignore OCC errors
      }

      return jsonResponse({
        success: true,
        hasPun: false,
        pun: null,
        production: null,
        has1002aAvailable,
        message: 'No PUN linked to this well'
      });
    }

    // Calculate date ranges
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 3 months ago for "active" status
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoYM = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    // 12 months ago for "stale" vs "inactive"
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const twelveMonthsAgoYM = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    // Same month last year for YoY comparison
    const lastYearSameMonth = new Date(now);
    lastYearSameMonth.setFullYear(lastYearSameMonth.getFullYear() - 1);
    const lastYearYM = `${lastYearSameMonth.getFullYear()}-${String(lastYearSameMonth.getMonth() + 1).padStart(2, '0')}`;

    // Query production data - normalize PUN for matching
    const punNormalized = pun.replace(/-/g, '');

    // Get last month's production (most recent month with data)
    const lastMonthResult = await env.WELLS_DB.prepare(`
      SELECT year_month, product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE REPLACE(pun, '-', '') = ?
      GROUP BY year_month, product_code
      ORDER BY year_month DESC
      LIMIT 10
    `).bind(punNormalized).all();

    // Find the most recent data month for this well to calculate relative ranges
    const maxMonthResult = await env.WELLS_DB.prepare(`
      SELECT MAX(year_month) as max_month
      FROM otc_production
      WHERE REPLACE(pun, '-', '') = ?
    `).bind(punNormalized).first() as { max_month: string | null } | null;

    const wellMaxMonth = maxMonthResult?.max_month || currentYearMonth;

    // Calculate 12 months before the well's most recent data
    const [maxYear, maxMonth] = wellMaxMonth.split('-').map(Number);
    const wellTwelveMonthsAgo = new Date(maxYear, maxMonth - 1);
    wellTwelveMonthsAgo.setMonth(wellTwelveMonthsAgo.getMonth() - 11); // -11 to include the max month
    const wellTwelveMonthsAgoYM = `${wellTwelveMonthsAgo.getFullYear()}-${String(wellTwelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    // Get last 12 months totals (relative to well's most recent data)
    const last12MoResult = await env.WELLS_DB.prepare(`
      SELECT product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE REPLACE(pun, '-', '') = ? AND year_month >= ?
      GROUP BY product_code
    `).bind(punNormalized, wellTwelveMonthsAgoYM).all();

    // Get lifetime totals
    const lifetimeResult = await env.WELLS_DB.prepare(`
      SELECT product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE REPLACE(pun, '-', '') = ?
      GROUP BY product_code
    `).bind(punNormalized).all();

    // Get last 6 months for sparkline (oil only)
    const sparklineResult = await env.WELLS_DB.prepare(`
      SELECT year_month, SUM(gross_volume) as volume
      FROM otc_production
      WHERE REPLACE(pun, '-', '') = ? AND product_code IN ('OIL', 'COND', '01', '02')
      GROUP BY year_month
      ORDER BY year_month DESC
      LIMIT 6
    `).bind(punNormalized).all();

    // Get same month last year for YoY comparison
    const lastYearResult = await env.WELLS_DB.prepare(`
      SELECT product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE REPLACE(pun, '-', '') = ? AND year_month = ?
      GROUP BY product_code
    `).bind(punNormalized, lastYearYM).all();

    // Process results
    const lastMonthData: { [key: string]: { yearMonth: string; volume: number } } = {};
    const last12MoData: { [key: string]: number } = { oil: 0, gas: 0 };
    const lifetimeData: { [key: string]: number } = { oil: 0, gas: 0 };
    const lastYearData: { [key: string]: number } = { oil: 0, gas: 0 };

    // Process last month (get most recent month per product type)
    for (const row of lastMonthResult.results as any[]) {
      const isOil = ['OIL', 'COND', '01', '02'].includes(row.product_code?.toUpperCase());
      const type = isOil ? 'oil' : 'gas';
      if (!lastMonthData[type] || row.year_month > lastMonthData[type].yearMonth) {
        lastMonthData[type] = { yearMonth: row.year_month, volume: Math.round(row.volume || 0) };
      }
    }

    // Process last 12 months
    for (const row of last12MoResult.results as any[]) {
      const isOil = ['OIL', 'COND', '01', '02'].includes(row.product_code?.toUpperCase());
      if (isOil) {
        last12MoData.oil += Math.round(row.volume || 0);
      } else {
        last12MoData.gas += Math.round(row.volume || 0);
      }
    }

    // Process lifetime
    for (const row of lifetimeResult.results as any[]) {
      const isOil = ['OIL', 'COND', '01', '02'].includes(row.product_code?.toUpperCase());
      if (isOil) {
        lifetimeData.oil += Math.round(row.volume || 0);
      } else {
        lifetimeData.gas += Math.round(row.volume || 0);
      }
    }

    // Process last year same month
    for (const row of lastYearResult.results as any[]) {
      const isOil = ['OIL', 'COND', '01', '02'].includes(row.product_code?.toUpperCase());
      if (isOil) {
        lastYearData.oil += Math.round(row.volume || 0);
      } else {
        lastYearData.gas += Math.round(row.volume || 0);
      }
    }

    // Process sparkline (reverse to get chronological order)
    const sparkline = (sparklineResult.results as any[])
      .map(r => Math.round(r.volume || 0))
      .reverse();

    // Determine status based on most recent production vs TODAY's date
    // Active = produced in last 3 months (from today)
    // Stale = produced in last 12 months but not last 3
    // Inactive = no production in last 12 months (or no data)
    const mostRecentMonth = lastMonthData.oil?.yearMonth || lastMonthData.gas?.yearMonth || '';
    let status: 'active' | 'stale' | 'inactive' = 'inactive';

    if (mostRecentMonth >= threeMonthsAgoYM) {
      status = 'active';
    } else if (mostRecentMonth >= twelveMonthsAgoYM) {
      status = 'stale';
    }

    // Calculate YoY change (based on oil production)
    let yoyChange: number | null = null;
    let direction: 'up' | 'down' | 'flat' = 'flat';
    const currentOil = lastMonthData.oil?.volume || 0;
    const lastYearOil = lastYearData.oil || 0;
    if (lastYearOil > 0 && currentOil > 0) {
      yoyChange = Math.round(((currentOil - lastYearOil) / lastYearOil) * 100);
      direction = yoyChange > 5 ? 'up' : yoyChange < -5 ? 'down' : 'flat';
    }

    // Format PUN for display in 3-5-1-5 format (XXX-XXXXX-X-XXXXX)
    // Only format if we have a complete 14-digit PUN, otherwise show as-is
    let punDisplay: string;
    if (pun.includes('-')) {
      punDisplay = pun;
    } else if (pun.length >= 14) {
      punDisplay = `${pun.substring(0, 3)}-${pun.substring(3, 8)}-${pun.substring(8, 9)}-${pun.substring(9, 14)}`;
    } else {
      // Incomplete PUN - show as-is rather than malforming it
      punDisplay = pun;
    }

    return jsonResponse({
      success: true,
      hasPun: true,
      pun: punDisplay,
      formation: wellResult?.formation_name || null,
      production: {
        lastMonth: {
          oil: lastMonthData.oil?.volume || 0,
          gas: lastMonthData.gas?.volume || 0,
          yearMonth: lastMonthData.oil?.yearMonth || lastMonthData.gas?.yearMonth || null
        },
        last12Mo: {
          oil: last12MoData.oil,
          gas: last12MoData.gas
        },
        lifetime: {
          oil: lifetimeData.oil,
          gas: lifetimeData.gas
        }
      },
      status,
      trend: {
        yoyChange,
        direction
      },
      sparkline
    });

  } catch (error) {
    console.error('Error in handleGetProductionSummary:', error);
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
    const fetchResponse = await fetchFromOccFetcher(
      '/download-1002a-forms',
      env,
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
