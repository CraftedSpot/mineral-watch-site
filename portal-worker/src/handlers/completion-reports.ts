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

    // 3. Get fetch status from unified tracking table
    const statusResults = await env.WELLS_DB.prepare(`
      SELECT entry_id, status, document_id, fetched_at, processed_at, extracted_pun, error_message, source
      FROM well_1002a_tracking
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
        processedAt: status?.processed_at || null,
        extractedPun: status?.extracted_pun || null,
        errorMessage: status?.error_message || null,
        source: status?.source || null,
        pun: status?.extracted_pun || (wellResult as any)?.otc_prod_unit_no || null
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
 * Returns aggregated production data for a well using well_pun_links.
 * Handles three scenarios:
 * - single: Simple 1:1 well-to-PUN mapping
 * - multi_pun: Well has multiple PUNs (multi-formation)
 * - multi_well_pun: PUN shared by multiple wells (lease-level)
 */
export async function handleGetProductionSummary(
  apiNumber: string,
  env: Env
): Promise<Response> {
  if (!env.WELLS_DB) {
    return jsonResponse({ error: 'Database not available' }, 500);
  }

  try {
    // Normalize API number
    const apiNormalized = apiNumber.replace(/-/g, '');
    const api10 = apiNormalized.substring(0, 10);

    // 1. Get all PUN links for this well from well_pun_links
    const linksResult = await env.WELLS_DB.prepare(`
      SELECT l.pun, l.confidence, l.match_method, l.formation,
             m.lease_name, m.is_multi_well, m.well_count, m.county
      FROM well_pun_links l
      LEFT JOIN pun_metadata m ON l.pun = m.pun
      WHERE l.api_number = ? OR l.api_number = ?
    `).bind(apiNumber, api10).all();

    const links = linksResult.results as Array<{
      pun: string;
      confidence: string;
      match_method: string;
      formation: string | null;
      lease_name: string | null;
      is_multi_well: number;
      well_count: number;
      county: string | null;
    }>;

    // If no links found, return hasPun: false
    if (!links?.length) {
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

    // 2. Determine link type/scenario
    const punCount = links.length;
    const hasMultiWellPun = links.some(l => l.is_multi_well === 1);

    let linkType: 'single' | 'multi_pun' | 'multi_well_pun';
    if (punCount === 1 && !hasMultiWellPun) {
      linkType = 'single';
    } else if (punCount > 1) {
      linkType = 'multi_pun';
    } else {
      linkType = 'multi_well_pun';
    }

    // 3. Get all PUNs for production query
    const puns = links.map(l => l.pun);

    // Calculate date ranges - DB stores year_month as YYYYMM (no hyphen)
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoYM = `${threeMonthsAgo.getFullYear()}${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const twelveMonthsAgoYM = `${twelveMonthsAgo.getFullYear()}${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    const lastYearSameMonth = new Date(now);
    lastYearSameMonth.setFullYear(lastYearSameMonth.getFullYear() - 1);
    const lastYearYM = `${lastYearSameMonth.getFullYear()}${String(lastYearSameMonth.getMonth() + 1).padStart(2, '0')}`;

    // 4. Query production data for all linked PUNs
    const placeholders = puns.map(() => '?').join(',');

    // Get recent production (for last month and status)
    const recentResult = await env.WELLS_DB.prepare(`
      SELECT pun, year_month, product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE pun IN (${placeholders})
      GROUP BY pun, year_month, product_code
      ORDER BY year_month DESC
      LIMIT 50
    `).bind(...puns).all();

    // Get last 12 months totals
    const last12MoResult = await env.WELLS_DB.prepare(`
      SELECT pun, product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE pun IN (${placeholders}) AND year_month >= ?
      GROUP BY pun, product_code
    `).bind(...puns, twelveMonthsAgoYM).all();

    // Get lifetime totals
    const lifetimeResult = await env.WELLS_DB.prepare(`
      SELECT pun, product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE pun IN (${placeholders})
      GROUP BY pun, product_code
    `).bind(...puns).all();

    // Get sparkline data (oil + condensate only, last 6 months)
    // OTC product codes: 1=Oil, 3=Condensate, 5=Gas(casinghead), 6=Gas(natural)
    const sparklineResult = await env.WELLS_DB.prepare(`
      SELECT year_month, SUM(gross_volume) as volume
      FROM otc_production
      WHERE pun IN (${placeholders}) AND product_code IN ('1', '3')
      GROUP BY year_month
      ORDER BY year_month DESC
      LIMIT 6
    `).bind(...puns).all();

    // Get YoY comparison data
    const lastYearResult = await env.WELLS_DB.prepare(`
      SELECT product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE pun IN (${placeholders}) AND year_month = ?
      GROUP BY product_code
    `).bind(...puns, lastYearYM).all();

    // 5. Process results - aggregate across all PUNs
    const lastMonthData: { [key: string]: { yearMonth: string; volume: number } } = {};
    const last12MoData: { [key: string]: number } = { oil: 0, gas: 0 };
    const lifetimeData: { [key: string]: number } = { oil: 0, gas: 0 };
    const lastYearData: { [key: string]: number } = { oil: 0, gas: 0 };

    // Helper to determine if product code is oil/condensate
    // OTC codes: 1=Oil, 3=Condensate, 5=Casinghead Gas, 6=Natural Gas
    const isOilProduct = (code: string) => ['1', '3'].includes(code);

    // Process recent production for last month
    // Find the single most recent month across all products first
    let mostRecentYM = '';
    for (const row of recentResult.results as any[]) {
      if (row.year_month > mostRecentYM) {
        mostRecentYM = row.year_month;
      }
    }

    // Now aggregate production for that most recent month
    for (const row of recentResult.results as any[]) {
      if (row.year_month === mostRecentYM) {
        const type = isOilProduct(row.product_code) ? 'oil' : 'gas';
        if (!lastMonthData[type]) {
          lastMonthData[type] = { yearMonth: row.year_month, volume: 0 };
        }
        lastMonthData[type].volume += Math.round(row.volume || 0);
      }
    }

    // Process last 12 months
    for (const row of last12MoResult.results as any[]) {
      if (isOilProduct(row.product_code)) {
        last12MoData.oil += Math.round(row.volume || 0);
      } else {
        last12MoData.gas += Math.round(row.volume || 0);
      }
    }

    // Process lifetime
    for (const row of lifetimeResult.results as any[]) {
      if (isOilProduct(row.product_code)) {
        lifetimeData.oil += Math.round(row.volume || 0);
      } else {
        lifetimeData.gas += Math.round(row.volume || 0);
      }
    }

    // Process last year data
    for (const row of lastYearResult.results as any[]) {
      if (isOilProduct(row.product_code)) {
        lastYearData.oil += Math.round(row.volume || 0);
      } else {
        lastYearData.gas += Math.round(row.volume || 0);
      }
    }

    // Process sparkline
    const sparkline = (sparklineResult.results as any[])
      .map(r => Math.round(r.volume || 0))
      .reverse();

    // Determine status based on most recent production vs TODAY
    // mostRecentYM is already calculated above in YYYYMM format
    let status: 'active' | 'stale' | 'inactive' = 'inactive';

    if (mostRecentYM >= threeMonthsAgoYM) {
      status = 'active';
    } else if (mostRecentYM >= twelveMonthsAgoYM) {
      status = 'stale';
    }

    // Calculate YoY change
    let yoyChange: number | null = null;
    let direction: 'up' | 'down' | 'flat' = 'flat';
    const currentOil = lastMonthData.oil?.volume || 0;
    const lastYearOil = lastYearData.oil || 0;
    if (lastYearOil > 0 && currentOil > 0) {
      yoyChange = Math.round(((currentOil - lastYearOil) / lastYearOil) * 100);
      direction = yoyChange > 5 ? 'up' : yoyChange < -5 ? 'down' : 'flat';
    }

    // Format primary PUN for display (use first link's PUN)
    const primaryPun = links[0].pun;

    // Format last production date for display
    let lastProductionFormatted: string | null = null;
    if (mostRecentYM) {
      const year = mostRecentYM.substring(0, 4);
      const month = parseInt(mostRecentYM.substring(4, 6), 10);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      lastProductionFormatted = `${monthNames[month - 1]} ${year}`;
    }

    // Generate disclaimer based on link type
    let disclaimer: string | null = null;
    if (linkType === 'multi_pun') {
      disclaimer = `This well reports to ${punCount} production units (PUNs). Production shown is aggregated.`;
    } else if (linkType === 'multi_well_pun') {
      const wellCount = links[0].well_count;
      disclaimer = `Production reported at lease level (PUN includes ${wellCount} wells).`;
    }

    return jsonResponse({
      success: true,
      hasPun: true,
      pun: primaryPun,
      linkType,
      links: links.map(l => ({
        pun: l.pun,
        leaseName: l.lease_name,
        confidence: l.confidence,
        matchMethod: l.match_method,
        formation: l.formation,
        isMultiWell: l.is_multi_well === 1,
        wellCount: l.well_count
      })),
      production: {
        lastMonth: {
          oil: lastMonthData.oil?.volume || 0,
          gas: lastMonthData.gas?.volume || 0,
          yearMonth: lastMonthData.oil?.yearMonth || lastMonthData.gas?.yearMonth || null,
          formatted: lastProductionFormatted
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
      sparkline,
      disclaimer
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
    // 1. Update status to 'fetching' for each entry in unified tracking table
    for (const entryId of entryIds) {
      await env.WELLS_DB.prepare(`
        INSERT INTO well_1002a_tracking (api_number, entry_id, status, has_1002a, source, triggered_by, checked_at)
        VALUES (?, ?, 'fetching', 1, 'user', ?, datetime('now'))
        ON CONFLICT(api_number, entry_id) DO UPDATE SET
          status = 'fetching',
          source = 'user',
          triggered_by = excluded.triggered_by,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      `).bind(apiNumber, entryId, userId).run();
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
          UPDATE well_1002a_tracking
          SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
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
          INSERT INTO well_1002a_tracking (api_number, entry_id, status, has_1002a, document_id, fetched_at, source, triggered_by)
          VALUES (?, ?, 'fetched', 1, ?, datetime('now'), 'user', ?)
          ON CONFLICT(api_number, entry_id) DO UPDATE SET
            status = 'fetched',
            document_id = excluded.document_id,
            fetched_at = excluded.fetched_at,
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        `).bind(apiNumber, result.form.entryId, result.documentId || null, userId).run();
      } else if (!result.success && result.form?.entryId) {
        // Track individual form errors
        await env.WELLS_DB.prepare(`
          UPDATE well_1002a_tracking
          SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
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
          UPDATE well_1002a_tracking
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
    }

    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
