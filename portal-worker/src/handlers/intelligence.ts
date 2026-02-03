/**
 * Intelligence API Handlers
 *
 * Endpoints for the Intelligence page summary cards and insights.
 * Queries D1 for the authenticated user's portfolio data.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserFromSession } from '../services/airtable.js';
import type { Env } from '../types/env.js';

/**
 * GET /api/intelligence/summary
 *
 * Returns portfolio summary data for the summary cards:
 * - Active wells count + county count
 * - Estimated monthly revenue (from latest OTC production data)
 * - Deduction flags (wells above 30% gas deductions)
 * - Shut-in wells (no production for 3+ months)
 */
export async function handleGetIntelligenceSummary(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    // Query wells by BOTH user_id and organization_id to capture all assigned wells
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, county, well_status FROM client_wells WHERE user_id = ? OR organization_id = ?`
      : `SELECT api_number, well_name, county, well_status FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id, userOrgId).all()
      : await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id).all();
    const wells = wellsResult.results as Array<{ api_number: string; well_name: string; county: string; well_status: string }>;

    if (!wells || wells.length === 0) {
      return jsonResponse({
        activeWells: 0, countyCount: 0, estimatedRevenue: null,
        revenueChange: null, deductionFlags: null, shutInWells: 0,
        actionItems: 0, nearestDeadline: null
      });
    }

    const activeWells = wells.filter(w => w.well_status === 'AC' || w.well_status === 'Active' || !w.well_status).length;
    const counties = new Set(wells.map(w => w.county).filter(Boolean));

    const api10Set = new Set(
      wells.map(w => w.api_number).filter(Boolean).map(a => a.replace(/-/g, '').substring(0, 10))
    );
    const api10s = Array.from(api10Set);

    // Get base PUNs linked to user's wells
    let basePuns: string[] = [];
    try {
      if (api10s.length > 0) {
        for (let i = 0; i < api10s.length; i += 50) {
          const batch = api10s.slice(i, i + 50);
          const placeholders = batch.map(() => '?').join(',');
          const punsResult = await env.WELLS_DB.prepare(
            `SELECT DISTINCT base_pun FROM well_pun_links WHERE api_number IN (${placeholders}) AND base_pun IS NOT NULL`
          ).bind(...batch).all();
          basePuns.push(...(punsResult.results as Array<{ base_pun: string }>).map(r => r.base_pun));
        }
        basePuns = [...new Set(basePuns)];
      }
    } catch (punError) {
      console.error('[Intelligence Summary] PUN linking error:', punError instanceof Error ? punError.message : punError);
    }

    let estimatedRevenue: number | null = null;
    let revenueChange: number | null = null;
    let deductionFlags: number | null = null;
    let shutInWells = 0;

    if (basePuns.length > 0) {
      // Revenue from otc_production
      try {
        const punBatch = basePuns.slice(0, 50);
        const punPlaceholders = punBatch.map(() => '?').join(',');

        const latestMonthResult = await env.WELLS_DB.prepare(
          `SELECT MAX(year_month) as latest FROM otc_production WHERE base_pun IN (${punPlaceholders}) AND gross_value > 0`
        ).bind(...punBatch).first() as { latest: string } | null;

        const latestMonth = latestMonthResult?.latest;

        if (latestMonth) {
          const revenueResult = await env.WELLS_DB.prepare(
            `SELECT SUM(net_value) as total_net, SUM(gross_value) as total_gross
             FROM otc_production WHERE base_pun IN (${punPlaceholders}) AND year_month = ?`
          ).bind(...punBatch, latestMonth).first() as { total_net: number; total_gross: number } | null;

          if (revenueResult) {
            estimatedRevenue = Math.round(revenueResult.total_net || revenueResult.total_gross || 0);
          }

          const priorMonth = getPriorMonth(latestMonth);
          const priorResult = await env.WELLS_DB.prepare(
            `SELECT SUM(net_value) as total_net, SUM(gross_value) as total_gross
             FROM otc_production WHERE base_pun IN (${punPlaceholders}) AND year_month = ?`
          ).bind(...punBatch, priorMonth).first() as { total_net: number; total_gross: number } | null;

          if (priorResult && estimatedRevenue) {
            const priorRevenue = priorResult.total_net || priorResult.total_gross || 0;
            if (priorRevenue > 0) {
              revenueChange = ((estimatedRevenue - priorRevenue) / priorRevenue) * 100;
            }
          }
        }
      } catch (revError) {
        console.error('[Intelligence Summary] Revenue query error:', revError instanceof Error ? revError.message : revError);
      }

      // Deduction flags — aggregate well-level rate across ALL product codes.
      // Requires 2+ product codes so we have the full financial picture
      // (avoids the "Residue Gas Trap" where gas-only shows 100% deductions
      // but the owner is actually paid via Casinghead Gas / NGL).
      // Process ALL wells in batches of 50.
      try {
        let totalFlagged = 0;
        const sixMonthsAgo = getMonthsAgo(6);

        for (let i = 0; i < api10s.length; i += 50) {
          const apiBatch = api10s.slice(i, i + 50);
          const apiPlaceholders = apiBatch.map(() => '?').join(',');

          const deductionResult = await env.WELLS_DB.prepare(`
            SELECT COUNT(*) as flagged_count FROM (
              SELECT wpl.api_number
              FROM well_pun_links wpl
              JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
              WHERE wpl.api_number IN (${apiPlaceholders})
                AND opf.gross_value > 0
                AND opf.year_month >= ?
              GROUP BY wpl.api_number
              HAVING SUM(opf.gross_value) > 500
                AND COUNT(DISTINCT opf.product_code) > 1
                AND SUM(opf.market_deduction) / SUM(opf.gross_value) > 0.25
                AND SUM(opf.market_deduction) / SUM(opf.gross_value) < 1.0
            )
          `).bind(...apiBatch, sixMonthsAgo).first() as { flagged_count: number } | null;

          totalFlagged += deductionResult?.flagged_count ?? 0;
        }

        deductionFlags = totalFlagged;
      } catch (dedError) {
        console.error('[Intelligence Summary] Deduction query error:', dedError instanceof Error ? dedError.message : dedError);
      }

      // Shut-in detection from otc_production — process ALL basePuns in batches
      try {
        let totalShutIn = 0;
        const threeMonthsAgo = getMonthsAgo(3);

        for (let i = 0; i < basePuns.length; i += 50) {
          const punBatch = basePuns.slice(i, i + 50);
          const punPlaceholders = punBatch.map(() => '?').join(',');

          const shutInResult = await env.WELLS_DB.prepare(`
            SELECT COUNT(*) as shut_in_count FROM (
              SELECT base_pun FROM otc_production
              WHERE base_pun IN (${punPlaceholders}) AND gross_volume > 0
              GROUP BY base_pun
              HAVING MAX(year_month) <= ?
            )
          `).bind(...punBatch, threeMonthsAgo).first() as { shut_in_count: number } | null;

          totalShutIn += shutInResult?.shut_in_count ?? 0;
        }

        shutInWells = totalShutIn;
      } catch (shutInError) {
        console.error('[Intelligence Summary] Shut-in query error:', shutInError instanceof Error ? shutInError.message : shutInError);
      }
    }

    // Count wells with analyzable financial data (multi-product, >$500 gross)
    let wellsAnalyzed = 0;
    try {
      const sixMonthsAgo = getMonthsAgo(6);

      for (let i = 0; i < api10s.length; i += 50) {
        const apiBatch = api10s.slice(i, i + 50);
        const apiPlaceholders = apiBatch.map(() => '?').join(',');

        const analyzedResult = await env.WELLS_DB.prepare(`
          SELECT COUNT(*) as cnt FROM (
            SELECT wpl.api_number
            FROM well_pun_links wpl
            JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
            WHERE wpl.api_number IN (${apiPlaceholders})
              AND opf.gross_value > 0
              AND opf.year_month >= ?
            GROUP BY wpl.api_number
            HAVING SUM(opf.gross_value) > 500
              AND COUNT(DISTINCT opf.product_code) > 1
          )
        `).bind(...apiBatch, sixMonthsAgo).first() as { cnt: number } | null;

        wellsAnalyzed += analyzedResult?.cnt ?? 0;
      }
    } catch (e) {
      console.error('[Intelligence Summary] Wells analyzed count error:', e);
    }

    return jsonResponse({
      activeWells,
      countyCount: counties.size,
      estimatedRevenue,
      revenueChange: revenueChange !== null ? Math.round(revenueChange * 10) / 10 : null,
      deductionFlags,
      shutInWells,
      wellsAnalyzed,
      wellsWithLinks: basePuns.length,
      actionItems: 0,
      nearestDeadline: null
    });

  } catch (error) {
    console.error('[Intelligence Summary] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load intelligence summary',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * GET /api/intelligence/insights
 *
 * Returns personalized insights for the "Suggested for You" section.
 * Rule-based triggers from D1 data, no AI needed.
 */
export async function handleGetIntelligenceInsights(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    // Query wells by BOTH user_id and organization_id to capture all assigned wells
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, county FROM client_wells WHERE user_id = ? OR organization_id = ?`
      : `SELECT api_number, well_name, county FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id, userOrgId).all()
      : await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id).all();
    const wells = wellsResult.results as Array<{ api_number: string; well_name: string; county: string }>;

    const insights: Array<{
      severity: string;
      title: string;
      description: string;
      action?: string;
      actionId?: string;
    }> = [];

    if (!wells || wells.length === 0) {
      insights.push({
        severity: 'info',
        title: 'Add wells to get started',
        description: 'Add wells to your dashboard and we\'ll analyze your production data, deductions, and lease risk automatically.'
      });
      return jsonResponse({ insights });
    }

    const apiNumbers = wells.map(w => w.api_number).filter(Boolean);
    const api10s = [...new Set(apiNumbers.map(a => a.replace(/-/g, '').substring(0, 10)))];

    // Get base PUNs
    let basePuns: string[] = [];
    try {
      if (api10s.length > 0) {
        for (let i = 0; i < api10s.length; i += 50) {
          const batch = api10s.slice(i, i + 50);
          const placeholders = batch.map(() => '?').join(',');
          const punsResult = await env.WELLS_DB.prepare(
            `SELECT DISTINCT base_pun FROM well_pun_links WHERE api_number IN (${placeholders}) AND base_pun IS NOT NULL`
          ).bind(...batch).all();
          basePuns.push(...(punsResult.results as Array<{ base_pun: string }>).map(r => r.base_pun));
        }
        basePuns = [...new Set(basePuns)];
      }
    } catch (punError) {
      console.error('[Insights] PUN linking error:', punError instanceof Error ? punError.message : punError);
    }

    if (basePuns.length === 0) {
      insights.push({
        severity: 'info',
        title: 'Connecting your wells to state data',
        description: `We found ${wells.length} wells in your portfolio but haven't linked them to OTC production data yet. This happens automatically as data syncs.`
      });
      return jsonResponse({ insights });
    }

    // Insight 1: High deduction wells — aggregate rate across all product codes.
    // Requires multi-product data to avoid the "Residue Gas Trap."
    // Process ALL wells in batches of 50.
    let wellsAnalyzedCount = 0;
    try {
      const allFlaggedWells: Array<{ api_number: string; agg_deduction_pct: number; product_count: number }> = [];
      const allAnalyzedWells: Array<{ api_number: string }> = [];
      const sixMonthsAgo = getMonthsAgo(6);

      for (let i = 0; i < api10s.length; i += 50) {
        const apiBatch = api10s.slice(i, i + 50);
        const apiPlaceholders = apiBatch.map(() => '?').join(',');

        // Get all wells with analyzable data (multi-product, >$500)
        const analyzedResult = await env.WELLS_DB.prepare(`
          SELECT wpl.api_number,
            ROUND(SUM(opf.market_deduction) / SUM(opf.gross_value) * 100, 1) as agg_deduction_pct,
            COUNT(DISTINCT opf.product_code) as product_count
          FROM well_pun_links wpl
          JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
          WHERE wpl.api_number IN (${apiPlaceholders})
            AND opf.gross_value > 0
            AND opf.year_month >= ?
          GROUP BY wpl.api_number
          HAVING SUM(opf.gross_value) > 500
            AND COUNT(DISTINCT opf.product_code) > 1
        `).bind(...apiBatch, sixMonthsAgo).all();

        const batchResults = analyzedResult.results as Array<{ api_number: string; agg_deduction_pct: number; product_count: number }>;
        allAnalyzedWells.push(...batchResults);

        // Filter for flagged wells (>25% and <100%)
        const flagged = batchResults.filter(r => r.agg_deduction_pct > 25 && r.agg_deduction_pct < 100);
        allFlaggedWells.push(...flagged);
      }

      wellsAnalyzedCount = allAnalyzedWells.length;

      // Sort by deduction rate and take top 5 for display
      const flaggedWells = allFlaggedWells
        .sort((a, b) => b.agg_deduction_pct - a.agg_deduction_pct)
        .slice(0, 5);

      if (allFlaggedWells.length > 0) {
        const wellNames = flaggedWells.map(fw => {
          const match = wells.find(w => w.api_number.replace(/-/g, '').startsWith(fw.api_number));
          return match?.well_name || fw.api_number;
        });

        const nameList = wellNames.length <= 2
          ? wellNames.join(' and ')
          : `${wellNames[0]} and ${wellNames.length - 1} other${wellNames.length > 2 ? 's' : ''}`;

        insights.push({
          severity: 'critical',
          title: `High deductions on ${allFlaggedWells.length} well${allFlaggedWells.length > 1 ? 's' : ''}`,
          description: `Based on analysis of ${wellsAnalyzedCount} of your actively producing wells with complete OTC financial records, ${nameList} ha${wellNames.length === 1 ? 's' : 've'} aggregate deductions of ${flaggedWells[0].agg_deduction_pct}% across all products.`,
          action: 'View Analysis',
          actionId: 'deduction-audit'
        });
      }
    } catch (e) {
      console.error('[Insights] Deduction check error:', e instanceof Error ? e.message : e);
    }

    // Insight 2: Shut-in wells — process ALL basePuns in batches
    try {
      const allShutInPuns: Array<{ base_pun: string; last_active: string }> = [];
      const threeMonthsAgo = getMonthsAgo(3);

      for (let i = 0; i < basePuns.length; i += 50) {
        const punBatch = basePuns.slice(i, i + 50);
        const punPlaceholders = punBatch.map(() => '?').join(',');

        const shutInResult = await env.WELLS_DB.prepare(`
          SELECT base_pun, MAX(year_month) as last_active
          FROM otc_production
          WHERE base_pun IN (${punPlaceholders})
            AND gross_volume > 0
          GROUP BY base_pun
          HAVING MAX(year_month) <= ?
        `).bind(...punBatch, threeMonthsAgo).all();

        allShutInPuns.push(...(shutInResult.results as Array<{ base_pun: string; last_active: string }>));
      }

      if (allShutInPuns.length > 0) {
        insights.push({
          severity: 'warning',
          title: `${allShutInPuns.length} well${allShutInPuns.length > 1 ? 's' : ''} may be shut-in`,
          description: `Production has been zero for 3+ months. If these wells hold your lease by production, the lease may be at risk.`,
          action: 'Review Wells',
          actionId: 'shut-in-review'
        });
      }
    } catch (e) {
      console.error('[Insights] Shut-in check error:', e instanceof Error ? e.message : e);
    }

    // Insight 3: Wells without PUN links (data gap)
    if (basePuns.length < api10s.length) {
      const unlinkedWellCount = api10s.length - basePuns.length;
      insights.push({
        severity: 'info',
        title: `${unlinkedWellCount} well${unlinkedWellCount > 1 ? 's' : ''} not yet linked to OTC data`,
        description: 'Some of your wells don\'t have PUN matches yet. This can happen with new wells or wells with non-standard API numbers. Links are updated as OTC data syncs.'
      });
    }

    // If no issues found, show a positive message
    if (insights.length === 0) {
      insights.push({
        severity: 'success',
        title: 'Portfolio looks healthy',
        description: `All ${wells.length} wells are linked to OTC data with no deduction flags or shut-in alerts. Use the questions below to explore deeper.`
      });
    }

    return jsonResponse({ insights });

  } catch (error) {
    console.error('[Intelligence Insights] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load insights',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * GET /api/intelligence/deduction-report
 *
 * Returns detailed deduction audit data for the report viewer:
 * - Per-well product-level deduction breakdowns
 * - Monthly trends for flagged wells
 * - Portfolio average for comparison
 * - Residue Gas context notes
 */
export async function handleGetDeductionReport(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const cacheId = userOrgId || authUser.id;

    // Check KV cache
    if (env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get(`deduction-report:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Deduction Report] Cache read error:', e);
      }
    }

    // Get user's wells - query by BOTH user_id and organization_id to capture all assigned wells
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, county, operator FROM client_wells WHERE user_id = ? OR organization_id = ?`
      : `SELECT api_number, well_name, county, operator FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id, userOrgId).all()
      : await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id).all();
    const wells = wellsResult.results as Array<{ api_number: string; well_name: string; county: string; operator: string | null }>;
    if (!wells || wells.length === 0) {
      const empty = { flaggedWells: [], portfolio: { avg_deduction_pct: 0, total_wells_analyzed: 0 }, summary: { flagged_count: 0, worst_deduction_pct: 0, total_excess_deductions: 0, analysis_period: '6 months', latest_month: null } };
      return jsonResponse(empty);
    }

    const api10s = [...new Set(wells.map(w => w.api_number).filter(Boolean).map(a => a.replace(/-/g, '').substring(0, 10)))];
    const sixMonthsAgo = getMonthsAgo(6);

    // Query 1: Product-level breakdown for ALL wells with financial data
    type ProductRow = { api_number: string; product_code: string; gross_value: number; market_deduction: number; net_value: number };
    const allProductRows: ProductRow[] = [];

    for (let i = 0; i < api10s.length; i += 50) {
      const batch = api10s.slice(i, i + 50);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(`
        SELECT wpl.api_number, opf.product_code,
          SUM(opf.gross_value) as gross_value,
          SUM(opf.market_deduction) as market_deduction,
          SUM(opf.net_value) as net_value
        FROM well_pun_links wpl
        JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
        WHERE wpl.api_number IN (${placeholders})
          AND opf.gross_value > 0
          AND opf.year_month >= ?
        GROUP BY wpl.api_number, opf.product_code
      `).bind(...batch, sixMonthsAgo).all();
      allProductRows.push(...(result.results as ProductRow[]));
    }

    // Group by api_number and compute per-well aggregates
    const wellMap = new Map<string, { products: ProductRow[]; totalGross: number; totalDeductions: number; totalNet: number; productCount: number }>();

    for (const row of allProductRows) {
      if (!wellMap.has(row.api_number)) {
        wellMap.set(row.api_number, { products: [], totalGross: 0, totalDeductions: 0, totalNet: 0, productCount: 0 });
      }
      const entry = wellMap.get(row.api_number)!;
      entry.products.push(row);
      entry.totalGross += row.gross_value;
      entry.totalDeductions += row.market_deduction;
      entry.totalNet += row.net_value;
      entry.productCount = entry.products.length;
    }

    // Portfolio average (all wells with multi-product data and > $500 gross)
    let portfolioTotalGross = 0;
    let portfolioTotalDeductions = 0;
    let portfolioWellCount = 0;

    for (const [, entry] of wellMap) {
      if (entry.productCount > 1 && entry.totalGross > 500) {
        portfolioTotalGross += entry.totalGross;
        portfolioTotalDeductions += entry.totalDeductions;
        portfolioWellCount++;
      }
    }

    const portfolioAvgPct = portfolioTotalGross > 0
      ? Math.round((portfolioTotalDeductions / portfolioTotalGross) * 1000) / 10
      : 0;

    // Identify flagged wells (>25% aggregate, 2+ products, <100%, >$500 gross)
    const flaggedApiNumbers: string[] = [];
    const flaggedWellsData: Array<{
      api_number: string;
      well_name: string;
      county: string;
      agg_deduction_pct: number;
      total_gross: number;
      total_deductions: number;
      total_net: number;
      products: Array<{ product_code: string; product_name: string; gross_value: number; market_deduction: number; deduction_pct: number }>;
      monthly: Array<{ year_month: string; gross_value: number; market_deduction: number; deduction_pct: number; net_value: number }>;
      residueGasNote: boolean;
      county_avg_pct: number | null;
      variance_points: number | null;
      operator: string;
    }> = [];

    for (const [apiNum, entry] of wellMap) {
      if (entry.productCount <= 1 || entry.totalGross <= 500) continue;
      const aggRate = entry.totalDeductions / entry.totalGross;
      if (aggRate <= 0.25 || aggRate >= 1.0) continue;

      flaggedApiNumbers.push(apiNum);
      const well = wells.find(w => w.api_number.replace(/-/g, '').startsWith(apiNum));

      // Check for residue gas note: product code 5 with >80% deductions
      const gasProduct = entry.products.find(p => p.product_code === '5');
      const residueGasNote = gasProduct
        ? (gasProduct.market_deduction / gasProduct.gross_value) > 0.80
        : false;

      flaggedWellsData.push({
        api_number: apiNum,
        well_name: well?.well_name || apiNum,
        county: well?.county || '',
        agg_deduction_pct: Math.round(aggRate * 1000) / 10,
        total_gross: Math.round(entry.totalGross),
        total_deductions: Math.round(entry.totalDeductions),
        total_net: Math.round(entry.totalNet),
        products: entry.products.map(p => ({
          product_code: p.product_code,
          product_name: PRODUCT_NAMES[p.product_code] || `Product ${p.product_code}`,
          gross_value: Math.round(p.gross_value),
          market_deduction: Math.round(p.market_deduction),
          deduction_pct: p.gross_value > 0 ? Math.round((p.market_deduction / p.gross_value) * 1000) / 10 : 0
        })),
        monthly: [], // filled below
        residueGasNote,
        county_avg_pct: null, // filled by county benchmark query
        variance_points: null,
        operator: well?.operator || ''
      });
    }

    // Sort flagged wells by deduction rate descending
    flaggedWellsData.sort((a, b) => b.agg_deduction_pct - a.agg_deduction_pct);

    // Query 2: Monthly trends for flagged wells
    if (flaggedApiNumbers.length > 0) {
      type MonthlyRow = { api_number: string; year_month: string; gross_value: number; market_deduction: number; net_value: number };
      const monthlyRows: MonthlyRow[] = [];

      for (let i = 0; i < flaggedApiNumbers.length; i += 50) {
        const batch = flaggedApiNumbers.slice(i, i + 50);
        const placeholders = batch.map(() => '?').join(',');
        const result = await env.WELLS_DB.prepare(`
          SELECT wpl.api_number, opf.year_month,
            SUM(opf.gross_value) as gross_value,
            SUM(opf.market_deduction) as market_deduction,
            SUM(opf.net_value) as net_value
          FROM well_pun_links wpl
          JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
          WHERE wpl.api_number IN (${placeholders})
            AND opf.gross_value > 0
            AND opf.year_month >= ?
          GROUP BY wpl.api_number, opf.year_month
          ORDER BY wpl.api_number, opf.year_month DESC
        `).bind(...batch, sixMonthsAgo).all();
        monthlyRows.push(...(result.results as MonthlyRow[]));
      }

      // Attach monthly data to each flagged well
      for (const row of monthlyRows) {
        const well = flaggedWellsData.find(w => w.api_number === row.api_number);
        if (well) {
          well.monthly.push({
            year_month: row.year_month,
            gross_value: Math.round(row.gross_value),
            market_deduction: Math.round(row.market_deduction),
            deduction_pct: row.gross_value > 0 ? Math.round((row.market_deduction / row.gross_value) * 1000) / 10 : 0,
            net_value: Math.round(row.net_value)
          });
        }
      }
    }

    // Query 3: County benchmarks
    // Get county codes from PUN prefixes, then compute county-wide average deduction rates
    if (flaggedApiNumbers.length > 0) {
      try {
        // Map flagged wells to county codes via their base_pun prefix
        const wellCountyCodes = new Map<string, string>(); // api_number -> county_code (3-digit)
        for (let i = 0; i < flaggedApiNumbers.length; i += 50) {
          const batch = flaggedApiNumbers.slice(i, i + 50);
          const placeholders = batch.map(() => '?').join(',');
          const punResult = await env.WELLS_DB.prepare(
            `SELECT api_number, base_pun FROM well_pun_links WHERE api_number IN (${placeholders}) AND base_pun IS NOT NULL`
          ).bind(...batch).all();
          for (const row of punResult.results as Array<{ api_number: string; base_pun: string }>) {
            const countyCode = row.base_pun.replace(/-/g, '').substring(0, 3);
            wellCountyCodes.set(row.api_number, countyCode);
          }
        }

        const uniqueCountyCodes = [...new Set(wellCountyCodes.values())];

        if (uniqueCountyCodes.length > 0) {
          const ccPlaceholders = uniqueCountyCodes.map(() => '?').join(',');
          // County average: mean of per-PUN aggregate rates, same multi-product sanity filters
          const countyResult = await env.WELLS_DB.prepare(`
            SELECT county_code, ROUND(AVG(pun_rate), 1) as avg_pct, COUNT(*) as pun_count FROM (
              SELECT substr(pun, 1, 3) as county_code,
                SUM(market_deduction) / SUM(gross_value) * 100 as pun_rate
              FROM otc_production_financial
              WHERE substr(pun, 1, 3) IN (${ccPlaceholders})
                AND year_month >= ?
                AND gross_value > 0
              GROUP BY county_code, substr(pun, 1, 10)
              HAVING SUM(gross_value) > 500
                AND COUNT(DISTINCT product_code) > 1
                AND SUM(market_deduction) / SUM(gross_value) BETWEEN 0 AND 1
            ) GROUP BY county_code
          `).bind(...uniqueCountyCodes, sixMonthsAgo).all();

          const countyAvgs = new Map<string, number>();
          for (const row of countyResult.results as Array<{ county_code: string; avg_pct: number }>) {
            countyAvgs.set(row.county_code, row.avg_pct);
          }

          // Attach to flagged wells
          for (const well of flaggedWellsData) {
            const cc = wellCountyCodes.get(well.api_number);
            if (cc && countyAvgs.has(cc)) {
              well.county_avg_pct = countyAvgs.get(cc)!;
              well.variance_points = Math.round((well.agg_deduction_pct - well.county_avg_pct) * 10) / 10;
            }
          }
        }
      } catch (countyError) {
        console.error('[Deduction Report] County benchmark error:', countyError instanceof Error ? countyError.message : countyError);
        // Non-fatal — report still works without county benchmarks
      }
    }

    // Compute excess deductions (amount above portfolio average)
    const totalExcess = flaggedWellsData.reduce((sum, w) => {
      const expectedDeductions = w.total_gross * (portfolioAvgPct / 100);
      return sum + Math.max(0, w.total_deductions - expectedDeductions);
    }, 0);

    // Find latest month across all data
    let latestMonth: string | null = null;
    for (const w of flaggedWellsData) {
      for (const m of w.monthly) {
        if (!latestMonth || m.year_month > latestMonth) {
          latestMonth = m.year_month;
        }
      }
    }

    const response = {
      flaggedWells: flaggedWellsData,
      portfolio: {
        avg_deduction_pct: portfolioAvgPct,
        total_wells_analyzed: portfolioWellCount
      },
      summary: {
        flagged_count: flaggedWellsData.length,
        worst_deduction_pct: flaggedWellsData.length > 0 ? flaggedWellsData[0].agg_deduction_pct : 0,
        total_excess_deductions: Math.round(totalExcess),
        analysis_period: '6 months',
        latest_month: latestMonth
      }
    };

    // Cache result
    if (env.OCC_CACHE) {
      try {
        const ttl = flaggedWellsData.length > 0 ? 3600 : 21600; // 1h if data, 6h if empty
        await env.OCC_CACHE.put(`deduction-report:${cacheId}`, JSON.stringify(response), { expirationTtl: ttl });
      } catch (e) {
        console.error('[Deduction Report] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Deduction Report] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load deduction report',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

const PRODUCT_NAMES: Record<string, string> = {
  '1': 'Oil',
  '3': 'NGL / Condensate',
  '5': 'Residue Gas',
  '6': 'Casinghead Gas'
};

// =============================================
// UTILITY FUNCTIONS
// =============================================

function getPriorMonth(yyyymm: string): string {
  const year = parseInt(yyyymm.substring(0, 4));
  const month = parseInt(yyyymm.substring(4, 6));
  if (month === 1) {
    return `${year - 1}12`;
  }
  return `${year}${String(month - 1).padStart(2, '0')}`;
}

function getMonthsAgo(n: number): string {
  const now = new Date();
  now.setMonth(now.getMonth() - n);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}
