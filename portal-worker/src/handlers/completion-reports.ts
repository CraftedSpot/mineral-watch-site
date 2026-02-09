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

    // 2. Check OCC for available 1002A forms (with caching)
    let occData: { success: boolean; forms?: any[]; error?: string } = { success: false, forms: [] };
    const cacheKey = `1002a-forms:${apiNumber}`;
    const CACHE_TTL = 86400; // 24 hours - completion reports rarely change, status is tracked separately in D1

    try {
      // Check cache first
      if (env.COMPLETIONS_CACHE) {
        const cached = await env.COMPLETIONS_CACHE.get(cacheKey);
        if (cached) {
          console.log(`[CompletionReports] Cache hit for ${apiNumber}`);
          occData = JSON.parse(cached);
        }
      }

      // If not cached, fetch from OCC
      if (!occData.success || !occData.forms) {
        console.log(`[CompletionReports] Cache miss, fetching from OCC for ${apiNumber}`);
        const occPath = `/get-1002a-forms?api=${apiNumber}`;
        const occResponse = await fetchFromOccFetcher(occPath, env);
        occData = await occResponse.json() as typeof occData;

        // Cache the result if successful
        if (occData.success && env.COMPLETIONS_CACHE) {
          await env.COMPLETIONS_CACHE.put(cacheKey, JSON.stringify(occData), { expirationTtl: CACHE_TTL });
          console.log(`[CompletionReports] Cached forms for ${apiNumber} (TTL: ${CACHE_TTL}s)`);
        }
      }
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

    // Check KV cache first (24h TTL to reduce D1 load)
    const cacheKey = `prod:${api10}`;
    if (env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get(cacheKey, 'json');
        if (cached) {
          return jsonResponse(cached);
        }
      } catch (cacheError) {
        console.error('Cache read error:', cacheError);
        // Continue to D1 on cache error
      }
    }

    // 1. Get all PUN links for this well from well_pun_links
    const linksResult = await env.WELLS_DB.prepare(`
      SELECT l.pun, l.base_pun, l.confidence, l.match_method, l.formation,
             m.lease_name, m.is_multi_well, m.well_count, m.county
      FROM well_pun_links l
      LEFT JOIN pun_metadata m ON l.pun = m.pun
      WHERE l.api_number = ? OR l.api_number = ?
    `).bind(apiNumber, api10).all();

    const links = linksResult.results as Array<{
      pun: string;
      base_pun: string | null;
      confidence: string;
      match_method: string;
      formation: string | null;
      lease_name: string | null;
      is_multi_well: number;
      well_count: number;
      county: string | null;
    }>;

    // If no links found, cache and return hasPun: false immediately (skip slow OCC check)
    if (!links?.length) {
      const noPunResponse = {
        success: true,
        hasPun: false,
        pun: null,
        production: null,
        has1002aAvailable: null, // Skip OCC check for speed - completion reports shown separately
        message: 'No PUN linked to this well',
        cachedAt: Date.now()
      };
      // Cache "no PUN" response too (shorter TTL: 6 hours)
      if (env.OCC_CACHE) {
        try {
          await env.OCC_CACHE.put(cacheKey, JSON.stringify(noPunResponse), {
            expirationTtl: 21600 // 6 hours
          });
        } catch (cacheError) {
          console.error('Cache write error:', cacheError);
        }
      }
      return jsonResponse(noPunResponse);
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

    // 3. Get all base_puns for production query
    // Use base_pun (10-char: XXX-XXXXXX county-lease) for matching
    const basePunBindValues: string[] = [];
    for (const link of links) {
      if (link.base_pun) {
        basePunBindValues.push(link.base_pun);
      }
    }
    // Deduplicate base_puns (multiple full PUNs may have same base)
    const uniqueBasePuns = [...new Set(basePunBindValues)];
    const placeholders = uniqueBasePuns.map(() => '?').join(',');
    const punWhereClause = `base_pun IN (${placeholders})`;

    // Calculate date ranges - DB stores year_month as YYYYMM (no hyphen)
    // Use data horizon (latest month in OTC data) instead of today for status thresholds
    // This avoids false-idle caused by OTC's 2-3 month reporting lag
    const now = new Date();
    const horizonResult = await env.WELLS_DB.prepare(
      `SELECT MAX(year_month) as horizon FROM otc_production`
    ).first() as { horizon: string } | null;

    let horizonDate: Date;
    if (horizonResult?.horizon) {
      const hYear = parseInt(horizonResult.horizon.substring(0, 4));
      const hMonth = parseInt(horizonResult.horizon.substring(4, 6));
      horizonDate = new Date(hYear, hMonth - 1, 1);
    } else {
      horizonDate = new Date(now);
    }

    const threeMonthsAgo = new Date(horizonDate);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoYM = `${threeMonthsAgo.getFullYear()}${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    const twelveMonthsAgo = new Date(horizonDate);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const twelveMonthsAgoYM = `${twelveMonthsAgo.getFullYear()}${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    const lastYearSameMonth = new Date(now);
    lastYearSameMonth.setFullYear(lastYearSameMonth.getFullYear() - 1);
    const lastYearYM = `${lastYearSameMonth.getFullYear()}${String(lastYearSameMonth.getMonth() + 1).padStart(2, '0')}`;

    // 4. Query production data for all linked PUNs
    // Get recent production (for last month and status)
    const recentResult = await env.WELLS_DB.prepare(`
      SELECT pun, year_month, product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE ${punWhereClause}
      GROUP BY pun, year_month, product_code
      ORDER BY year_month DESC
      LIMIT 50
    `).bind(...uniqueBasePuns).all();

    // Get last 12 months totals
    const last12MoResult = await env.WELLS_DB.prepare(`
      SELECT pun, product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE ${punWhereClause} AND year_month >= ?
      GROUP BY pun, product_code
    `).bind(...uniqueBasePuns, twelveMonthsAgoYM).all();

    // Get lifetime totals
    const lifetimeResult = await env.WELLS_DB.prepare(`
      SELECT pun, product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE ${punWhereClause}
      GROUP BY pun, product_code
    `).bind(...uniqueBasePuns).all();

    // Get sparkline data in BOE (Barrels of Oil Equivalent), last 6 calendar months
    // BOE = Oil + (Gas / 6) - standard industry conversion
    // OTC product codes: 1=Oil, 3=Condensate, 5=Gas(casinghead), 6=Gas(natural)
    const sixMonthsAgo = new Date(horizonDate);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoYM = `${sixMonthsAgo.getFullYear()}${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    const sparklineResult = await env.WELLS_DB.prepare(`
      SELECT year_month,
             SUM(CASE WHEN product_code IN ('1', '3') THEN gross_volume ELSE 0 END) as oil_volume,
             SUM(CASE WHEN product_code IN ('5', '6') THEN gross_volume ELSE 0 END) as gas_volume
      FROM otc_production
      WHERE ${punWhereClause} AND year_month >= ?
      GROUP BY year_month
      ORDER BY year_month ASC
    `).bind(...uniqueBasePuns, sixMonthsAgoYM).all();

    // Get YoY comparison data
    const lastYearResult = await env.WELLS_DB.prepare(`
      SELECT product_code, SUM(gross_volume) as volume
      FROM otc_production
      WHERE ${punWhereClause} AND year_month = ?
      GROUP BY product_code
    `).bind(...uniqueBasePuns, lastYearYM).all();

    // Get months produced count and first production month
    const monthsProducedResult = await env.WELLS_DB.prepare(`
      SELECT COUNT(DISTINCT year_month) as months_count, MIN(year_month) as first_month
      FROM otc_production
      WHERE ${punWhereClause}
    `).bind(...uniqueBasePuns).first() as { months_count: number; first_month: string } | null;

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

    // "Last Reported" shows actual last production regardless of age
    // The status indicator already shows if the well is idle/stale
    // Now aggregate production for the most recent month with data
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

    // Process sparkline - generate last 6 calendar months with BOE values
    // BOE = Oil + (Gas / 6)
    const sparklineMap = new Map<string, number>();
    for (const row of sparklineResult.results as any[]) {
      const oil = row.oil_volume || 0;
      const gas = row.gas_volume || 0;
      const boe = Math.round(oil + (gas / 6));
      sparklineMap.set(row.year_month, boe);
    }

    // Determine status based on most recent production vs TODAY
    // mostRecentYM is already calculated above in YYYYMM format
    // Status categories account for OTC's typical 2-3 month reporting lag:
    // - active: reported in last 3 months (current)
    // - recently_idle: no reports 3-6 months (may be normal lag or short shutdown)
    // - extended_idle: no reports 6-12 months (concerning, may need verification)
    // - no_recent_production: 12+ months (likely shut-in or data issue, verify with operator)
    let status: 'active' | 'recently_idle' | 'extended_idle' | 'no_recent_production' = 'no_recent_production';

    if (mostRecentYM >= threeMonthsAgoYM) {
      status = 'active';
    } else if (mostRecentYM >= sixMonthsAgoYM) {
      status = 'recently_idle';
    } else if (mostRecentYM >= twelveMonthsAgoYM) {
      status = 'extended_idle';
    }

    // Generate sparkline data for last 6 months
    // For ACTIVE wells: use sparse data (only reported months) to avoid misleading flatline from OTC lag
    // For IDLE/NO_RECENT wells: show all months including zeros to show production trend/stoppage
    const sparkline: number[] = [];
    const sparklineMonths: string[] = [];
    let sparklineTotal = 0;
    const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const useSparseData = status === 'active';

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      const boe = sparklineMap.get(ym) || 0;

      if (useSparseData) {
        // Active wells: only include months with actual reported production
        if (boe > 0) {
          sparkline.push(boe);
          sparklineMonths.push(`${shortMonths[d.getMonth()]} ${d.getFullYear()}`);
          sparklineTotal += boe;
        }
      } else {
        // Inactive/stale wells: show all months including zeros
        sparkline.push(boe);
        sparklineMonths.push(`${shortMonths[d.getMonth()]} ${d.getFullYear()}`);
        sparklineTotal += boe;
      }
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

    // Format dates for display
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const formatYearMonth = (ym: string | null): string | null => {
      if (!ym) return null;
      const year = ym.substring(0, 4);
      const month = parseInt(ym.substring(4, 6), 10);
      return `${monthNames[month - 1]} ${year}`;
    };

    let lastProductionFormatted: string | null = null;
    let lastMonthFormatted: string | null = null;
    let firstProductionFormatted: string | null = null;

    if (mostRecentYM) {
      lastProductionFormatted = formatYearMonth(mostRecentYM);
      // Always show actual last reported month
      lastMonthFormatted = lastProductionFormatted;
    }

    if (monthsProducedResult?.first_month) {
      firstProductionFormatted = formatYearMonth(monthsProducedResult.first_month);
    }

    // Generate disclaimer based on link type
    let disclaimer: string | null = null;
    if (linkType === 'multi_pun') {
      disclaimer = `This well reports to ${punCount} production units (PUNs). Production shown is aggregated.`;
    } else if (linkType === 'multi_well_pun') {
      const wellCount = links[0].well_count;
      disclaimer = `Production reported at lease level (PUN includes ${wellCount} wells).`;
    }

    // Build response data
    const responseData = {
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
          formatted: lastMonthFormatted
        },
        last12Mo: {
          oil: last12MoData.oil,
          gas: last12MoData.gas
        },
        lifetime: {
          oil: lifetimeData.oil,
          gas: lifetimeData.gas
        },
        lastProduction: mostRecentYM ? {
          yearMonth: mostRecentYM,
          formatted: lastProductionFormatted
        } : null,
        firstProduction: monthsProducedResult?.first_month ? {
          yearMonth: monthsProducedResult.first_month,
          formatted: firstProductionFormatted
        } : null,
        monthsProduced: monthsProducedResult?.months_count || 0
      },
      status,
      trend: {
        yoyChange,
        direction
      },
      sparkline,
      sparklineMonths,
      sparklineBOE: sparklineTotal,
      disclaimer,
      cachedAt: Date.now()
    };

    // Cache the response (24h TTL = 86400 seconds)
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(cacheKey, JSON.stringify(responseData), {
          expirationTtl: 86400 // 24 hours
        });
      } catch (cacheError) {
        console.error('Cache write error:', cacheError);
        // Don't fail the request on cache write errors
      }
    }

    return jsonResponse(responseData);

  } catch (error) {
    console.error('Error in handleGetProductionSummary:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * GET /api/wells/{api}/decimal-interest
 *
 * Returns OTC-reported decimal interest data for a well.
 * Uses well_pun_links to find PUNs, then queries otc_production_financial
 * for decimal_equivalent values. Deduplicates to most recent month per PUN.
 */
export async function handleGetDecimalInterest(
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

    // Check KV cache first
    const cacheKey = `decimal:${api10}`;
    if (env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get(cacheKey, 'json');
        if (cached) {
          return jsonResponse(cached);
        }
      } catch (cacheError) {
        console.error('Cache read error:', cacheError);
      }
    }

    // Get PUN links for this well
    const linksResult = await env.WELLS_DB.prepare(`
      SELECT pun, base_pun
      FROM well_pun_links
      WHERE api_number = ? OR api_number = ?
    `).bind(apiNumber, api10).all();

    const links = linksResult.results as Array<{ pun: string; base_pun: string | null }>;

    if (!links?.length) {
      const noDataResponse = {
        success: true,
        hasData: false,
        decimals: [],
        summary: { pun_count: 0, latest_month: null, has_data: false },
        cachedAt: Date.now()
      };
      if (env.OCC_CACHE) {
        try {
          await env.OCC_CACHE.put(cacheKey, JSON.stringify(noDataResponse), {
            expirationTtl: 21600 // 6 hours for "no data"
          });
        } catch (cacheError) {
          console.error('Cache write error:', cacheError);
        }
      }
      return jsonResponse(noDataResponse);
    }

    // Get unique base_puns for the query
    const basePuns = [...new Set(links.map(l => l.base_pun).filter(Boolean))] as string[];
    if (!basePuns.length) {
      const noDataResponse = {
        success: true,
        hasData: false,
        decimals: [],
        summary: { pun_count: 0, latest_month: null, has_data: false },
        cachedAt: Date.now()
      };
      return jsonResponse(noDataResponse);
    }

    const placeholders = basePuns.map(() => '?').join(',');

    // Query OTC financial data for decimal_equivalent
    const result = await env.WELLS_DB.prepare(`
      SELECT DISTINCT
          wpl.pun,
          opf.decimal_equivalent,
          opf.year_month,
          opf.product_code,
          opf.reporting_company_id,
          opf.gross_value
      FROM well_pun_links wpl
      JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
      WHERE wpl.base_pun IN (${placeholders})
        AND opf.decimal_equivalent > 0
      ORDER BY opf.year_month DESC
    `).bind(...basePuns).all();

    const rows = result.results as Array<{
      pun: string;
      decimal_equivalent: number;
      year_month: string;
      product_code: string | null;
      reporting_company_id: string | null;
      gross_value: number | null;
    }>;

    // Dedupe: keep only most recent year_month per PUN
    const seen = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      if (!seen.has(row.pun) || row.year_month > (seen.get(row.pun)!.year_month)) {
        seen.set(row.pun, row);
      }
    }
    const decimals = Array.from(seen.values());

    // Format latest month for display
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let latestMonthFormatted: string | null = null;
    if (decimals.length > 0) {
      const ym = decimals[0].year_month;
      const year = ym.substring(0, 4);
      const month = parseInt(ym.substring(4, 6), 10);
      latestMonthFormatted = `${monthNames[month - 1]} ${year}`;
    }

    const responseData = {
      success: true,
      hasData: decimals.length > 0,
      decimals: decimals.map(d => ({
        pun: d.pun,
        decimal_equivalent: d.decimal_equivalent,
        year_month: d.year_month,
        product_code: d.product_code,
        reporting_company_id: d.reporting_company_id,
        gross_value: d.gross_value
      })),
      summary: {
        pun_count: decimals.length,
        latest_month: latestMonthFormatted,
        has_data: decimals.length > 0
      },
      cachedAt: Date.now()
    };

    // Cache response (24h for data, 6h for no-data)
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(cacheKey, JSON.stringify(responseData), {
          expirationTtl: decimals.length > 0 ? 86400 : 21600
        });
      } catch (cacheError) {
        console.error('Cache write error:', cacheError);
      }
    }

    return jsonResponse(responseData);

  } catch (error) {
    console.error('Error in handleGetDecimalInterest:', error);
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
