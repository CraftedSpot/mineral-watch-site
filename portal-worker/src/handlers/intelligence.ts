/**
 * Intelligence API Handlers
 *
 * Endpoints for the Intelligence page summary cards and insights.
 * Queries D1 for the authenticated user's portfolio data.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserFromSession } from '../services/airtable.js';
import { parseTownship, parseRange, getAdjacentLocations } from '../utils/property-well-matching.js';
import { classifyWellGor, classifyOperatorGor } from '../utils/gor-classification.js';
import type { Env } from '../types/env.js';

// Minimum annual BOE threshold for including a well in county YoY calculations.
// Wells below this are intermittent/marginal and create extreme % swings (e.g. 1→10 BOE = +900%).
const MIN_BOE_THRESHOLD = 50;

// Intelligence features are currently limited to specific organizations during beta
const INTELLIGENCE_ALLOWED_ORGS = [
  'rec9fYy8Xwl3jNAbf', // Price Minerals
];

function isIntelligenceAllowed(orgId: string | undefined): boolean {
  return orgId ? INTELLIGENCE_ALLOWED_ORGS.includes(orgId) : false;
}

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

    // Beta: Intelligence features limited to allowed organizations
    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({
        activeWells: 0, countyCount: 0, estimatedRevenue: null,
        revenueChange: null, deductionFlags: null, shutInWells: 0,
        actionItems: 0, nearestDeadline: null,
        _beta_restricted: true
      });
    }

    // Query wells — org members see all wells belonging to any user in the org
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, county, well_status FROM client_wells WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `SELECT api_number, well_name, county, well_status FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(userOrgId, userOrgId).all()
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
      // GOR-aware: includes single-product wells (full report provides context).
      // The < 1.0 filter still avoids pure gas-trap false positives.
      // Summary card uses 50% threshold for "high" wells (notable outliers).
      // Full report uses 25% threshold for complete picture.
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
                AND SUM(opf.market_deduction) / SUM(opf.gross_value) > 0.50
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

    // Beta: Intelligence features limited to allowed organizations
    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({
        insights: [{
          severity: 'info',
          title: 'Intelligence features coming soon',
          description: 'Advanced deduction analysis and operator comparisons will be available in an upcoming release.'
        }]
      });
    }

    // Query wells — org members see all wells belonging to any user in the org
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, county FROM client_wells WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `SELECT api_number, well_name, county FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(userOrgId, userOrgId).all()
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

    // Deductions are covered by the summary card — insights focus on "new" changes only.

    // Insight: Recently idle wells (3-5 months = just went idle)
    try {
      let totalIdle = 0;
      let recentlyIdle = 0;

      for (let i = 0; i < api10s.length; i += 50) {
        const apiBatch = api10s.slice(i, i + 50);
        const apiPlaceholders = apiBatch.map(() => '?').join(',');

        const shutInResult = await env.WELLS_DB.prepare(`
          SELECT
            COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN wpl.api_number END) as idle_count,
            COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 AND p.months_since_production <= 5 THEN wpl.api_number END) as recently_idle
          FROM well_pun_links wpl
          JOIN puns p ON p.pun = wpl.pun
          WHERE wpl.api_number IN (${apiPlaceholders})
        `).bind(...apiBatch).all();

        const row = shutInResult.results[0] as { idle_count: number; recently_idle: number } | undefined;
        if (row) {
          totalIdle += row.idle_count;
          recentlyIdle += row.recently_idle;
        }
      }

      if (recentlyIdle > 0) {
        const longTermIdle = totalIdle - recentlyIdle;
        const contextPart = longTermIdle > 0
          ? ` ${longTermIdle} other well${longTermIdle > 1 ? 's' : ''} remain${longTermIdle === 1 ? 's' : ''} idle long-term.`
          : '';
        insights.push({
          severity: 'warning',
          title: `${recentlyIdle} well${recentlyIdle > 1 ? 's' : ''} recently went idle`,
          description: `Production dropped to zero in the last few months.${contextPart}`,
          action: 'Review Wells',
          actionId: 'shut-in-review'
        });
      }
    } catch (e) {
      console.error('[Insights] Shut-in check error:', e instanceof Error ? e.message : e);
    }

    // Insight 3: New pooling orders (filed in last 30 days) near user's properties
    try {
      const propsQuery = userOrgId
        ? `SELECT section, township, range FROM properties WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?)) AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`
        : `SELECT section, township, range FROM properties WHERE user_id = ? AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`;

      const propsResult = userOrgId
        ? await env.WELLS_DB.prepare(propsQuery).bind(userOrgId, userOrgId).all()
        : await env.WELLS_DB.prepare(propsQuery).bind(authUser.id).all();

      const props = propsResult.results as Array<{ section: string; township: string; range: string }>;

      if (props.length > 0) {
        const trsSet = new Set<string>();
        for (const p of props) {
          trsSet.add(`${p.section}|${p.township}|${p.range}`);
        }

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().substring(0, 10);

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().substring(0, 10);

        const trsConditions: string[] = [];
        const trsBindings: string[] = [];
        for (const trs of trsSet) {
          const [sec, twp, rng] = trs.split('|');
          trsConditions.push('(section = ? AND township = ? AND range = ?)');
          trsBindings.push(sec, twp, rng);
        }

        if (trsConditions.length > 0 && trsConditions.length <= 100) {
          const poolingResult = await env.WELLS_DB.prepare(`
            SELECT
              COUNT(*) as count,
              COUNT(CASE WHEN order_date >= ? THEN 1 END) as new_count,
              MIN(response_deadline) as nearest_deadline
            FROM pooling_orders
            WHERE order_date >= ?
              AND (${trsConditions.join(' OR ')})
          `).bind(thirtyDaysAgoStr, ninetyDaysAgoStr, ...trsBindings).all();

          const poolingData = poolingResult.results[0] as { count: number; new_count: number; nearest_deadline: string | null } | undefined;

          if (poolingData && poolingData.new_count > 0) {
            let isUrgent = false;
            if (poolingData.nearest_deadline) {
              const deadlineDate = new Date(poolingData.nearest_deadline);
              const thirtyDaysFromNow = new Date();
              thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
              isUrgent = deadlineDate < thirtyDaysFromNow;
            }
            const olderCount = poolingData.count - poolingData.new_count;
            const contextPart = olderCount > 0 ? ` ${olderCount} other${olderCount > 1 ? 's' : ''} filed in the last 90 days.` : '';

            insights.push({
              severity: isUrgent ? 'warning' : 'info',
              title: `${poolingData.new_count} new pooling order${poolingData.new_count > 1 ? 's' : ''} near your properties`,
              description: isUrgent
                ? `Filed in the last 30 days. A response deadline is approaching.${contextPart}`
                : `Filed in the last 30 days.${contextPart}`,
              action: 'View Rates',
              actionId: 'pooling-report'
            });
          } else if (poolingData && poolingData.count > 0 && poolingData.nearest_deadline) {
            const deadlineDate = new Date(poolingData.nearest_deadline);
            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            if (deadlineDate < thirtyDaysFromNow) {
              insights.push({
                severity: 'warning',
                title: 'Pooling response deadline approaching',
                description: `${poolingData.count} pooling order${poolingData.count > 1 ? 's' : ''} near your properties. A response deadline is coming up.`,
                action: 'View Rates',
                actionId: 'pooling-report'
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('[Insights] Pooling check error:', e instanceof Error ? e.message : e);
    }

    // No new findings
    if (insights.length === 0) {
      insights.push({
        severity: 'success',
        title: 'No new findings',
        description: `Your ${wells.length} wells are being monitored. Nothing has changed recently. Use the reports below to explore deeper.`
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
 * GET /api/intelligence/data
 *
 * Combined endpoint that returns both summary cards and insights in one request.
 * Eliminates duplicate auth/wells/PUN queries and parallelizes independent D1 queries.
 */
export async function handleGetIntelligenceData(request: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    // Beta: Intelligence features limited to allowed organizations
    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({
        summary: {
          activeWells: 0, countyCount: 0, estimatedRevenue: null,
          revenueChange: null, deductionFlags: null, shutInWells: 0,
          actionItems: 0, nearestDeadline: null, wellsAnalyzed: 0,
          _beta_restricted: true
        },
        insights: [{
          severity: 'info',
          title: 'Intelligence features coming soon',
          description: 'Advanced deduction analysis and operator comparisons will be available in an upcoming release.'
        }]
      });
    }

    // ---- Shared setup: wells query (once) — org members see all org wells ----
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, county, well_status, airtable_id, ri_nri, wi_nri, orri_nri FROM client_wells WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `SELECT api_number, well_name, county, well_status, airtable_id, ri_nri, wi_nri, orri_nri FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(userOrgId, userOrgId).all()
      : await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id).all();
    const wells = wellsResult.results as Array<{ api_number: string; well_name: string; county: string; well_status: string; airtable_id: string; ri_nri: number | null; wi_nri: number | null; orri_nri: number | null }>;

    if (!wells || wells.length === 0) {
      return jsonResponse({
        summary: {
          activeWells: 0, countyCount: 0, estimatedRevenue: null,
          revenueChange: null, deductionFlags: null, shutInWells: 0,
          actionItems: 0, nearestDeadline: null, wellsAnalyzed: 0
        },
        insights: [{
          severity: 'info',
          title: 'Add wells to get started',
          description: 'Add wells to your dashboard and we\'ll analyze your production data, deductions, and lease risk automatically.'
        }]
      });
    }

    const activeWells = wells.filter(w => w.well_status === 'AC' || w.well_status === 'Active' || !w.well_status).length;
    const counties = new Set(wells.map(w => w.county).filter(Boolean));

    const api10Set = new Set(
      wells.map(w => w.api_number).filter(Boolean).map(a => a.replace(/-/g, '').substring(0, 10))
    );
    const api10s = Array.from(api10Set);

    // ---- Shared setup: PUN linking (once) ----
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
      console.error('[Intelligence Data] PUN linking error:', punError instanceof Error ? punError.message : punError);
    }

    if (basePuns.length === 0) {
      return jsonResponse({
        summary: {
          activeWells, countyCount: counties.size, estimatedRevenue: null,
          revenueChange: null, deductionFlags: null, shutInWells: 0,
          actionItems: 0, nearestDeadline: null, wellsAnalyzed: 0, wellsWithLinks: 0
        },
        insights: [{
          severity: 'info',
          title: 'Connecting your wells to state data',
          description: `We found ${wells.length} wells in your portfolio but haven't linked them to OTC production data yet. This happens automatically as data syncs.`
        }]
      });
    }

    const tSetup = Date.now();

    // ---- Parallel query groups ----
    // Group A: Revenue — combines check stub actuals + OTC×decimal
    // Priority: check stub owner amounts (most accurate) > OTC gross × user's NRI
    async function queryRevenue(): Promise<{ estimatedRevenue: number | null; revenueChange: number | null; revenueWellCount: number }> {
      let estimatedRevenue: number | null = null;
      let revenueChange: number | null = null;
      let revenueWellCount = 0;

      try {
        // Build per-well map: api10 → { airtableId, decimal }
        const wellMap = new Map<string, { airtableId: string; decimal: number }>();
        for (const w of wells) {
          if (!w.api_number) continue;
          const api10 = w.api_number.replace(/-/g, '').substring(0, 10);
          const decimal = w.ri_nri || w.wi_nri || w.orri_nri || 0;
          wellMap.set(api10, { airtableId: w.airtable_id || '', decimal });
        }

        // --- Source 1: Check stub actuals (most accurate — already post-decimal, post-deductions) ---
        const checkStubRevenue = new Map<string, number>(); // api10 → owner revenue
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const sixMonthsCutoff = sixMonthsAgo.toISOString().substring(0, 10);

        try {
          const docs = await env.WELLS_DB.prepare(`
            SELECT well_id, extracted_data FROM documents
            WHERE user_id = ?
              AND doc_type IN ('check_stub', 'royalty_statement', 'revenue_statement')
              AND status = 'complete'
              AND (deleted_at IS NULL OR deleted_at = '')
            ORDER BY upload_date DESC
            LIMIT 100
          `).bind(authUser.id).all();

          for (const doc of docs.results) {
            try {
              const data = typeof doc.extracted_data === 'string'
                ? JSON.parse(doc.extracted_data as string) : doc.extracted_data;
              if (!data) continue;

              // Filter by check_date recency (skip stubs older than 6 months)
              const checkDate = data.check_date;
              if (checkDate && checkDate < sixMonthsCutoff) continue;

              // Extract per-well owner amounts
              const docWells = data.wells || [];
              for (const dw of docWells) {
                const dwApi = (dw.api_number || '').replace(/-/g, '').substring(0, 10);
                if (!dwApi || !wellMap.has(dwApi)) continue;
                if (checkStubRevenue.has(dwApi)) continue; // keep most recent (ordered DESC)
                const wellTotal = dw.well_owner_total;
                if (wellTotal != null && wellTotal > 0) {
                  checkStubRevenue.set(dwApi, wellTotal);
                }
              }

              // Fallback: single-well doc with summary total but no wells[] array
              if (docWells.length === 0 && data.summary?.total_net_revenue > 0) {
                const wellIds = (doc.well_id as string || '').split(',').filter(Boolean);
                if (wellIds.length === 1) {
                  for (const [api10, info] of wellMap) {
                    if (info.airtableId === wellIds[0] && !checkStubRevenue.has(api10)) {
                      checkStubRevenue.set(api10, data.summary.total_net_revenue);
                    }
                  }
                }
              }
            } catch { /* skip unparseable docs */ }
          }
        } catch (e) {
          console.error('[Intelligence Data] Check stub revenue error:', e instanceof Error ? e.message : e);
        }

        // --- Source 2: OTC financial × decimal for wells without check stub data ---
        // Dollar values are in otc_production_financial (not otc_production which only has volumes)
        const otcRevenue = new Map<string, number>(); // api10 → estimated revenue
        const wellsNeedingOtc = [...wellMap.entries()]
          .filter(([api10, info]) => !checkStubRevenue.has(api10) && info.decimal > 0);

        let latestFinMonth: string | null = null;

        if (wellsNeedingOtc.length > 0) {
          try {
            // Get latest month with financial data for user's wells
            const otcApis = wellsNeedingOtc.map(([api10]) => api10);
            const sampleBatch = otcApis.slice(0, 25);
            const samplePlaceholders = sampleBatch.map(() => '?').join(',');

            const latestMonthResult = await env.WELLS_DB.prepare(
              `SELECT MAX(opf.year_month) as latest
               FROM well_pun_links wpl
               JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
               WHERE wpl.api_number IN (${samplePlaceholders}) AND opf.gross_value > 0`
            ).bind(...sampleBatch).first() as { latest: string } | null;

            latestFinMonth = latestMonthResult?.latest || null;

            if (latestFinMonth) {
              // Per-well financial net for latest month (batch by 20 — join uses more params)
              for (let i = 0; i < otcApis.length; i += 20) {
                const apiBatch = otcApis.slice(i, i + 20);
                const apiPlaceholders = apiBatch.map(() => '?').join(',');

                const perWellResult = await env.WELLS_DB.prepare(`
                  SELECT wpl.api_number, SUM(opf.net_value) as well_net, SUM(opf.gross_value) as well_gross
                  FROM well_pun_links wpl
                  JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10) AND opf.year_month = ?
                  WHERE wpl.api_number IN (${apiPlaceholders})
                  GROUP BY wpl.api_number
                `).bind(latestFinMonth, ...apiBatch).all();

                for (const row of perWellResult.results) {
                  const api = row.api_number as string;
                  const wellValue = (row.well_net as number) || (row.well_gross as number) || 0;
                  const decimal = wellMap.get(api)?.decimal || 0;
                  if (wellValue > 0 && decimal > 0) {
                    otcRevenue.set(api, wellValue * decimal);
                  }
                }
              }
            }
          } catch (e) {
            console.error('[Intelligence Data] OTC revenue error:', e instanceof Error ? e.message : e);
          }
        }

        // --- Combine both sources ---
        let totalRevenue = 0;
        for (const [, amt] of checkStubRevenue) totalRevenue += amt;
        for (const [, amt] of otcRevenue) totalRevenue += amt;
        revenueWellCount = checkStubRevenue.size + otcRevenue.size;

        if (totalRevenue > 0) {
          estimatedRevenue = Math.round(totalRevenue * 100) / 100;
        }

        // Revenue change: compare to prior month using OTC financial aggregate
        if (estimatedRevenue && latestFinMonth) {
          try {
            const otcApis = [...otcRevenue.keys()];
            if (otcApis.length > 0) {
              const apiBatch = otcApis.slice(0, 25);
              const apiPlaceholders = apiBatch.map(() => '?').join(',');
              const [curResult, priorResult] = await Promise.all([
                env.WELLS_DB.prepare(
                  `SELECT SUM(opf.gross_value) as total FROM well_pun_links wpl
                   JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10) AND opf.year_month = ?
                   WHERE wpl.api_number IN (${apiPlaceholders})`
                ).bind(latestFinMonth, ...apiBatch).first() as Promise<{ total: number } | null>,
                env.WELLS_DB.prepare(
                  `SELECT SUM(opf.gross_value) as total FROM well_pun_links wpl
                   JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10) AND opf.year_month = ?
                   WHERE wpl.api_number IN (${apiPlaceholders})`
                ).bind(getPriorMonth(latestFinMonth), ...apiBatch).first() as Promise<{ total: number } | null>
              ]);
              if (curResult?.total && priorResult?.total && priorResult.total > 0) {
                revenueChange = ((curResult.total - priorResult.total) / priorResult.total) * 100;
              }
            }
          } catch { /* non-critical */ }
        }
      } catch (e) {
        console.error('[Intelligence Data] Revenue error:', e instanceof Error ? e.message : e);
      }

      return { estimatedRevenue, revenueChange, revenueWellCount };
    }

    // Group B: Deductions (full detail — superset of summary count + insights)
    // GOR-aware: includes single-product wells. The < 100% filter avoids pure gas-trap false positives.
    async function queryDeductions(): Promise<{
      deductionFlags: number;
      wellsAnalyzed: number;
      flaggedWells: Array<{ api_number: string; agg_deduction_pct: number; product_count: number }>;
    }> {
      const allFlaggedWells: Array<{ api_number: string; agg_deduction_pct: number; product_count: number }> = [];
      let wellsAnalyzed = 0;

      try {
        const sixMonthsAgo = getMonthsAgo(6);

        for (let i = 0; i < api10s.length; i += 50) {
          const apiBatch = api10s.slice(i, i + 50);
          const apiPlaceholders = apiBatch.map(() => '?').join(',');

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
          `).bind(...apiBatch, sixMonthsAgo).all();

          const batchResults = analyzedResult.results as Array<{ api_number: string; agg_deduction_pct: number; product_count: number }>;
          wellsAnalyzed += batchResults.length;

          const flagged = batchResults.filter(r => r.agg_deduction_pct > 50 && r.agg_deduction_pct < 100);
          allFlaggedWells.push(...flagged);
        }
      } catch (e) {
        console.error('[Intelligence Data] Deduction error:', e instanceof Error ? e.message : e);
      }

      return { deductionFlags: allFlaggedWells.length, wellsAnalyzed, flaggedWells: allFlaggedWells };
    }

    // Group C: Shut-in (puns table approach — uses data horizon)
    // Returns total idle (3+ months) and recently idle (3-5 months = just went idle)
    async function queryShutIn(): Promise<{ total: number; recentlyIdle: number }> {
      let totalIdle = 0;
      let recentlyIdle = 0;

      try {
        for (let i = 0; i < api10s.length; i += 50) {
          const apiBatch = api10s.slice(i, i + 50);
          const apiPlaceholders = apiBatch.map(() => '?').join(',');

          const shutInResult = await env.WELLS_DB.prepare(`
            SELECT
              COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN wpl.api_number END) as idle_count,
              COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 AND p.months_since_production <= 5 THEN wpl.api_number END) as recently_idle
            FROM well_pun_links wpl
            JOIN puns p ON p.pun = wpl.pun
            WHERE wpl.api_number IN (${apiPlaceholders})
          `).bind(...apiBatch).all();

          const row = shutInResult.results[0] as { idle_count: number; recently_idle: number } | undefined;
          if (row) {
            totalIdle += row.idle_count;
            recentlyIdle += row.recently_idle;
          }
        }
      } catch (e) {
        console.error('[Intelligence Data] Shut-in error:', e instanceof Error ? e.message : e);
      }

      return { total: totalIdle, recentlyIdle };
    }

    // Group D: Pooling orders (properties → pooling)
    // Returns total (90 days), new (30 days), and deadline info
    async function queryPooling(): Promise<{ count: number; newCount: number; nearestDeadline: string | null; isUrgent: boolean }> {
      try {
        const propsQuery = userOrgId
          ? `SELECT section, township, range FROM properties WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?)) AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`
          : `SELECT section, township, range FROM properties WHERE user_id = ? AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`;

        const propsResult = userOrgId
          ? await env.WELLS_DB.prepare(propsQuery).bind(userOrgId, userOrgId).all()
          : await env.WELLS_DB.prepare(propsQuery).bind(authUser.id).all();

        const props = propsResult.results as Array<{ section: string; township: string; range: string }>;

        if (props.length === 0) return { count: 0, newCount: 0, nearestDeadline: null, isUrgent: false };

        const trsSet = new Set<string>();
        for (const p of props) {
          trsSet.add(`${p.section}|${p.township}|${p.range}`);
        }

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().substring(0, 10);

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().substring(0, 10);

        const trsConditions: string[] = [];
        const trsBindings: string[] = [];
        for (const trs of trsSet) {
          const [sec, twp, rng] = trs.split('|');
          trsConditions.push('(section = ? AND township = ? AND range = ?)');
          trsBindings.push(sec, twp, rng);
        }

        if (trsConditions.length === 0 || trsConditions.length > 100) return { count: 0, newCount: 0, nearestDeadline: null, isUrgent: false };

        const poolingResult = await env.WELLS_DB.prepare(`
          SELECT
            COUNT(*) as count,
            COUNT(CASE WHEN order_date >= ? THEN 1 END) as new_count,
            MIN(response_deadline) as nearest_deadline
          FROM pooling_orders
          WHERE order_date >= ?
            AND (${trsConditions.join(' OR ')})
        `).bind(thirtyDaysAgoStr, ninetyDaysAgoStr, ...trsBindings).all();

        const poolingData = poolingResult.results[0] as { count: number; new_count: number; nearest_deadline: string | null } | undefined;

        if (poolingData && poolingData.count > 0) {
          let isUrgent = false;
          if (poolingData.nearest_deadline) {
            const deadlineDate = new Date(poolingData.nearest_deadline);
            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            isUrgent = deadlineDate < thirtyDaysFromNow;
          }
          return { count: poolingData.count, newCount: poolingData.new_count, nearestDeadline: poolingData.nearest_deadline, isUrgent };
        }
      } catch (e) {
        console.error('[Intelligence Data] Pooling error:', e instanceof Error ? e.message : e);
      }

      return { count: 0, newCount: 0, nearestDeadline: null, isUrgent: false };
    }

    // Run all groups in parallel
    const [revenueData, deductionData, shutInData, poolingData] = await Promise.all([
      queryRevenue(),
      queryDeductions(),
      queryShutIn(),
      queryPooling()
    ]);

    const tQueries = Date.now();
    console.log(`[Intelligence Data] Setup: ${tSetup - t0}ms, Queries (parallel): ${tQueries - tSetup}ms, Total: ${tQueries - t0}ms`);

    // ---- Build insights array (focus on NEW/recent changes) ----
    const insights: Array<{ severity: string; title: string; description: string; action?: string; actionId?: string }> = [];

    // Insight: Recently idle wells (went idle in last ~2 months = 3-5 months since production)
    if (shutInData.recentlyIdle > 0) {
      const longTermIdle = shutInData.total - shutInData.recentlyIdle;
      const contextPart = longTermIdle > 0
        ? ` ${longTermIdle} other well${longTermIdle > 1 ? 's' : ''} remain${longTermIdle === 1 ? 's' : ''} idle long-term.`
        : '';
      insights.push({
        severity: 'warning',
        title: `${shutInData.recentlyIdle} well${shutInData.recentlyIdle > 1 ? 's' : ''} recently went idle`,
        description: `Production dropped to zero in the last few months.${contextPart}`,
        action: 'Review Wells',
        actionId: 'shut-in-review'
      });
    }

    // Insight: New pooling orders (filed in last 30 days)
    if (poolingData.newCount > 0) {
      const olderCount = poolingData.count - poolingData.newCount;
      const contextPart = olderCount > 0 ? ` ${olderCount} other${olderCount > 1 ? 's' : ''} filed in the last 90 days.` : '';
      insights.push({
        severity: poolingData.isUrgent ? 'warning' : 'info',
        title: `${poolingData.newCount} new pooling order${poolingData.newCount > 1 ? 's' : ''} near your properties`,
        description: poolingData.isUrgent
          ? `Filed in the last 30 days. A response deadline is approaching.${contextPart}`
          : `Filed in the last 30 days.${contextPart}`,
        action: 'View Rates',
        actionId: 'pooling-report'
      });
    } else if (poolingData.count > 0 && poolingData.isUrgent) {
      // No new orders, but an upcoming deadline on existing ones
      insights.push({
        severity: 'warning',
        title: `Pooling response deadline approaching`,
        description: `${poolingData.count} pooling order${poolingData.count > 1 ? 's' : ''} near your properties. A response deadline is coming up.`,
        action: 'View Rates',
        actionId: 'pooling-report'
      });
    }

    // No new findings
    if (insights.length === 0) {
      insights.push({
        severity: 'success',
        title: 'No new findings',
        description: shutInData.total > 0
          ? `${shutInData.total} well${shutInData.total > 1 ? 's' : ''} remain idle and ${deductionData.flaggedWells.length} have high deductions, but nothing has changed recently. Use the reports below to explore.`
          : `All ${wells.length} wells are producing with no new alerts. Use the reports below to explore deeper.`
      });
    }

    // ---- Build summary object ----
    const summary = {
      activeWells,
      countyCount: counties.size,
      estimatedRevenue: revenueData.estimatedRevenue,
      revenueChange: revenueData.revenueChange !== null ? Math.round(revenueData.revenueChange * 10) / 10 : null,
      revenueWellCount: revenueData.revenueWellCount,
      totalWells: wells.length,
      deductionFlags: deductionData.deductionFlags,
      shutInWells: shutInData.total,
      wellsAnalyzed: deductionData.wellsAnalyzed,
      wellsWithLinks: basePuns.length,
      actionItems: insights.length,
      nearestDeadline: poolingData.nearestDeadline
    };

    return jsonResponse({ summary, insights });

  } catch (error) {
    console.error('[Intelligence Data] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load intelligence data',
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

    // Beta: Intelligence features limited to allowed organizations
    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    // Check KV cache
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`deduction-report:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Deduction Report] Cache read error:', e);
      }
    }

    // Get user's wells — org members see all wells belonging to any user in the org
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, county, operator FROM client_wells WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `SELECT api_number, well_name, county, operator FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(userOrgId, userOrgId).all()
      : await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id).all();
    const wells = wellsResult.results as Array<{ api_number: string; well_name: string; county: string; operator: string | null }>;
    if (!wells || wells.length === 0) {
      const empty = { flaggedWells: [], portfolio: { avg_deduction_pct: 0, total_wells_analyzed: 0 }, summary: { flagged_count: 0, worst_deduction_pct: 0, total_excess_deductions: 0, analysis_period: '6 months', latest_month: null } };
      return jsonResponse(empty);
    }

    const api10s = [...new Set(wells.map(w => w.api_number).filter(Boolean).map(a => a.replace(/-/g, '').substring(0, 10)))];
    const sixMonthsAgo = getMonthsAgo(6);

    // GOR classification — must complete BEFORE flagging so we can use it for inclusion decisions
    const gorMap = await classifyWellGor(env.WELLS_DB!, api10s);

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

    // Portfolio average and well inclusion — GOR-aware expansion
    // Multi-product wells: always include (existing behavior)
    // Single-product wells WITH GOR: include with context flags
    // Single-product wells WITHOUT GOR: exclude (insufficient context)
    let portfolioTotalGross = 0;
    let portfolioTotalDeductions = 0;
    let portfolioWellCount = 0;
    let singleProductAdded = 0;
    let singleProductExcluded = 0;

    for (const [apiNum, entry] of wellMap) {
      if (entry.totalGross <= 500) continue;

      if (entry.productCount > 1) {
        // Multi-product: always include in portfolio avg
        portfolioTotalGross += entry.totalGross;
        portfolioTotalDeductions += entry.totalDeductions;
        portfolioWellCount++;
      } else {
        // Single-product: only include if GOR-classified
        const gorInfo = gorMap.get(apiNum);
        if (gorInfo) {
          portfolioTotalGross += entry.totalGross;
          portfolioTotalDeductions += entry.totalDeductions;
          portfolioWellCount++;
          singleProductAdded++;
        } else {
          singleProductExcluded++;
        }
      }
    }

    console.log(`[Deduction Report] Wells analyzed: ${portfolioWellCount} (${portfolioWellCount - singleProductAdded} multi-product, ${singleProductAdded} single-product w/ GOR, ${singleProductExcluded} excluded — no GOR)`);

    const portfolioAvgPct = portfolioTotalGross > 0
      ? Math.round((portfolioTotalDeductions / portfolioTotalGross) * 1000) / 10
      : 0;

    // Identify flagged wells — GOR-aware inclusion
    // Multi-product: >25% aggregate, <100%, >$500 gross (existing)
    // Single-product gas + lean GOR: include but mark lean_gas_expected (suppress warnings)
    // Single-product gas + rich/mixed GOR: flag normally (high deductions = suspicious)
    // Single-product oil-only: include but mark oil_only_verify (anomaly, not accusation)
    // Single-product no GOR: skip
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
      purchaser_id: string | null;
      purchaser_name: string | null;
      is_affiliated: boolean;
      gas_profile: string | null;
      gor: number | null;
      lean_gas_expected: boolean;
      oil_only_verify: boolean;
    }> = [];

    for (const [apiNum, entry] of wellMap) {
      if (entry.totalGross <= 500) continue;
      const aggRate = entry.totalDeductions / entry.totalGross;
      if (aggRate <= 0.25 || aggRate >= 1.0) continue;

      const gorInfo = gorMap.get(apiNum);
      const isMultiProduct = entry.productCount > 1;
      let leanGasExpected = false;
      let oilOnlyVerify = false;

      if (!isMultiProduct) {
        // Single-product well — needs GOR to be included
        if (!gorInfo) continue; // No GOR classification → skip

        const productCode = entry.products[0]?.product_code;
        const isGasOnly = productCode === '5' || productCode === '6';
        const isOilOnly = productCode === '1';

        if (isGasOnly && gorInfo.gas_profile === 'lean') {
          // Lean gas with high deductions = expected behavior
          leanGasExpected = true;
        } else if (isGasOnly && (gorInfo.gas_profile === 'rich' || gorInfo.gas_profile === 'mixed')) {
          // Rich/mixed gas with high deductions = suspicious, flag normally
        } else if (isOilOnly) {
          // Oil-only with >25% deductions = data anomaly, verify
          oilOnlyVerify = true;
        } else {
          // NGL-only (product 3) or other — include normally
        }
      }

      flaggedApiNumbers.push(apiNum);
      const well = wells.find(w => w.api_number.replace(/-/g, '').startsWith(apiNum));

      // Check for residue gas note: product code 5 with >80% deductions
      const gasProduct = entry.products.find(p => p.product_code === '5');
      let residueGasNote = gasProduct
        ? (gasProduct.market_deduction / gasProduct.gross_value) > 0.80
        : false;
      // Lean gas wells inherently have high residue deductions
      if (gorInfo?.gas_profile === 'lean') residueGasNote = true;

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
        operator: well?.operator || '',
        purchaser_id: null, // filled by purchaser query
        purchaser_name: null,
        is_affiliated: false,
        gas_profile: gorInfo?.gas_profile || null,
        gor: gorInfo?.gor || null,
        lean_gas_expected: leanGasExpected,
        oil_only_verify: oilOnlyVerify
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

    // Query 4: Purchaser info for flagged wells (vertical integration detection)
    if (flaggedApiNumbers.length > 0) {
      try {
        type PurchaserRow = {
          api_number: string;
          purchaser_id: string | null;
          purchaser_name: string | null;
          operator_number: string | null;
        };
        const purchaserRows: PurchaserRow[] = [];

        for (let i = 0; i < flaggedApiNumbers.length; i += 50) {
          const batch = flaggedApiNumbers.slice(i, i + 50);
          const placeholders = batch.map(() => '?').join(',');
          // Get purchaser_id for Product 5 (residue gas) for each well
          // Use MAX to get a consistent purchaser when there are multiple
          const result = await env.WELLS_DB.prepare(`
            SELECT
              wpl.api_number,
              MAX(opf.purchaser_id) as purchaser_id,
              MAX(ol.operator_number) as operator_number
            FROM well_pun_links wpl
            JOIN otc_production_financial opf ON wpl.base_pun = substr(opf.pun, 1, 10)
            LEFT JOIN otc_leases ol ON wpl.base_pun = ol.base_pun
            WHERE wpl.api_number IN (${placeholders})
              AND opf.product_code = '5'
              AND opf.purchaser_id IS NOT NULL
              AND opf.purchaser_id != ''
              AND opf.year_month >= ?
            GROUP BY wpl.api_number
          `).bind(...batch, sixMonthsAgo).all();
          purchaserRows.push(...(result.results as PurchaserRow[]));
        }

        // Look up purchaser names
        const purchaserIds = [...new Set(purchaserRows.map(r => r.purchaser_id).filter(Boolean))];
        const purchaserNames = new Map<string, string>();
        if (purchaserIds.length > 0) {
          const nameResult = await env.WELLS_DB.prepare(`
            SELECT company_id, company_name FROM otc_companies WHERE company_id IN (${purchaserIds.map(() => '?').join(',')})
          `).bind(...purchaserIds).all();
          for (const row of nameResult.results as Array<{ company_id: string; company_name: string }>) {
            purchaserNames.set(row.company_id, row.company_name);
          }
        }

        // Attach purchaser info to flagged wells
        for (const row of purchaserRows) {
          const well = flaggedWellsData.find(w => w.api_number === row.api_number);
          if (well && row.purchaser_id) {
            well.purchaser_id = row.purchaser_id;
            well.operator_number = row.operator_number;
            const purchaserName = purchaserNames.get(row.purchaser_id) || `Purchaser ${row.purchaser_id}`;
            well.purchaser_name = purchaserName;
            // Check if operator = purchaser (vertical integration)
            // Compare by ID first, then by normalized name (handles transfers/outdated OTC data)
            const operatorNameNorm = (well.operator || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const purchaserNameNorm = purchaserName.toUpperCase().replace(/[^A-Z0-9]/g, '');
            well.is_affiliated = row.operator_number === row.purchaser_id ||
              (operatorNameNorm.length > 5 && purchaserNameNorm.includes(operatorNameNorm.substring(0, 10)));
          }
        }
      } catch (purchaserError) {
        console.error('[Deduction Report] Purchaser info error:', purchaserError instanceof Error ? purchaserError.message : purchaserError);
        // Non-fatal — report still works without purchaser info
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

    // Get statewide average for context
    let statewideAvgPct: number | null = null;
    try {
      const statewideResult = await env.WELLS_DB.prepare(`
        SELECT
          SUM(market_deduction) as total_deductions,
          SUM(gross_value) as total_gross
        FROM otc_production_financial
        WHERE gross_value > 0
          AND year_month >= ?
      `).bind(sixMonthsAgo).first() as { total_deductions: number; total_gross: number } | null;

      if (statewideResult && statewideResult.total_gross > 0) {
        statewideAvgPct = Math.round((statewideResult.total_deductions / statewideResult.total_gross) * 1000) / 10;
      }
    } catch (e) {
      console.error('[Deduction Report] Statewide avg error:', e);
    }

    const response = {
      flaggedWells: flaggedWellsData,
      portfolio: {
        avg_deduction_pct: portfolioAvgPct,
        total_wells_analyzed: portfolioWellCount
      },
      statewide: {
        avg_deduction_pct: statewideAvgPct
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

/**
 * GET /api/intelligence/operator-comparison
 *
 * Returns operator deduction and NGL recovery data for the user's wells.
 * Neutral presentation - just data, no grades or judgments.
 * Includes statewide median for context.
 */
export async function handleGetOperatorComparison(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    // Beta: Intelligence features limited to allowed organizations
    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    // Check KV cache
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`operator-comparison:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Operator Comparison] Cache read error:', e);
      }
    }

    // Get user's wells — org members see all wells belonging to any user in the org
    const wellsQuery = userOrgId
      ? `SELECT api_number, well_name, operator FROM client_wells WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `SELECT api_number, well_name, operator FROM client_wells WHERE user_id = ?`;

    const wellsResult = userOrgId
      ? await env.WELLS_DB.prepare(wellsQuery).bind(userOrgId, userOrgId).all()
      : await env.WELLS_DB.prepare(wellsQuery).bind(authUser.id).all();
    const wells = wellsResult.results as Array<{ api_number: string; well_name: string; operator: string | null }>;

    if (!wells || wells.length === 0) {
      return jsonResponse({ operators: [], statewide: null });
    }

    const api10s = [...new Set(wells.map(w => w.api_number).filter(Boolean).map(a => a.replace(/-/g, '').substring(0, 10)))];
    const sixMonthsAgo = getMonthsAgo(6);

    // Get operator numbers for user's wells via well_pun_links -> otc_leases
    type OperatorWell = { api_number: string; operator_number: string };
    const operatorWells: OperatorWell[] = [];

    for (let i = 0; i < api10s.length; i += 50) {
      const batch = api10s.slice(i, i + 50);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(`
        SELECT DISTINCT wpl.api_number, ol.operator_number
        FROM well_pun_links wpl
        JOIN otc_leases ol ON wpl.base_pun = ol.base_pun
        WHERE wpl.api_number IN (${placeholders})
          AND ol.operator_number IS NOT NULL
      `).bind(...batch).all();
      operatorWells.push(...(result.results as OperatorWell[]));
    }

    const uniqueOperators = [...new Set(operatorWells.map(ow => ow.operator_number))];

    if (uniqueOperators.length === 0) {
      return jsonResponse({ operators: [], statewide: null });
    }

    // GOR classification — runs in parallel with financial queries
    const gorOpPromise = classifyOperatorGor(env.WELLS_DB!, uniqueOperators);

    // Query operator-level metrics: deduction ratio, NGL recovery ratio
    const opPlaceholders = uniqueOperators.map(() => '?').join(',');

    type OperatorMetrics = {
      operator_number: string;
      company_name: string;
      well_count: number;
      total_gross: number;
      residue_deductions: number;
      liquids_returned: number;
      deduction_ratio: number;
      ngl_recovery_ratio: number;
    };

    const metricsResult = await env.WELLS_DB.prepare(`
      SELECT
        ol.operator_number,
        oc.company_name,
        COUNT(DISTINCT ol.base_pun) as well_count,
        ROUND(SUM(opf.gross_value), 0) as total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) as residue_deductions,
        ROUND(SUM(CASE WHEN opf.product_code IN ('3', '6') THEN opf.gross_value ELSE 0 END), 0) as liquids_returned
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      LEFT JOIN otc_companies oc ON ol.operator_number = oc.company_id
      WHERE ol.operator_number IN (${opPlaceholders})
        AND opf.gross_value > 0
        AND opf.year_month >= ?
      GROUP BY ol.operator_number
      HAVING well_count >= 1
    `).bind(...uniqueOperators, sixMonthsAgo).all();

    // Look up primary gas purchaser per operator for affiliated detection
    const purchaserResult = await env.WELLS_DB.prepare(`
      SELECT operator_number, purchaser_id FROM (
        SELECT l.operator_number, opf.purchaser_id, COUNT(*) as cnt,
          ROW_NUMBER() OVER (PARTITION BY l.operator_number ORDER BY COUNT(*) DESC) as rn
        FROM otc_production_financial opf
        JOIN otc_leases l ON SUBSTR(opf.pun, 1, 10) = l.base_pun
        WHERE opf.product_code = '5' AND opf.purchaser_id IS NOT NULL AND opf.purchaser_id != ''
          AND l.operator_number IN (${opPlaceholders})
          AND opf.year_month >= ?
        GROUP BY l.operator_number, opf.purchaser_id
      ) WHERE rn = 1
    `).bind(...uniqueOperators, sixMonthsAgo).all();

    // Look up purchaser company names
    const purchaserIds = [...new Set((purchaserResult.results as Array<{ purchaser_id: string }>).map(r => r.purchaser_id))];
    const purchaserNameMap = new Map<string, string>();
    if (purchaserIds.length > 0) {
      const pPlaceholders = purchaserIds.map(() => '?').join(',');
      const nameResult = await env.WELLS_DB.prepare(
        `SELECT company_id, company_name FROM otc_companies WHERE company_id IN (${pPlaceholders})`
      ).bind(...purchaserIds).all();
      for (const r of nameResult.results as Array<{ company_id: string; company_name: string }>) {
        purchaserNameMap.set(r.company_id, r.company_name || '');
      }
    }

    const purchaserMap = new Map<string, { purchaser_id: string; purchaser_name: string }>();
    for (const row of purchaserResult.results as Array<{ operator_number: string; purchaser_id: string }>) {
      purchaserMap.set(row.operator_number, { purchaser_id: row.purchaser_id, purchaser_name: purchaserNameMap.get(row.purchaser_id) || '' });
    }

    // Await GOR classifications
    let gorOpMap = new Map<string, any>();
    try {
      gorOpMap = await gorOpPromise;
    } catch (e) {
      console.error('[Operator Comparison] GOR classification error:', e);
    }

    const operatorData = (metricsResult.results as Array<{
      operator_number: string;
      company_name: string;
      well_count: number;
      total_gross: number;
      residue_deductions: number;
      liquids_returned: number;
    }>).map(row => {
      const deductionRatio = row.total_gross > 0
        ? Math.round((row.residue_deductions / row.total_gross) * 1000) / 10
        : 0;
      const nglRecoveryRatio = row.residue_deductions > 0
        ? Math.round((row.liquids_returned / row.residue_deductions) * 1000) / 10
        : null; // null if no deductions to compare against

      // Count user's wells with this operator
      const userWellCount = operatorWells.filter(ow => ow.operator_number === row.operator_number).length;

      // Affiliated detection: operator number matches purchaser ID, or normalized name match
      const purchaserInfo = purchaserMap.get(row.operator_number);
      let isAffiliated = false;
      if (purchaserInfo) {
        if (row.operator_number === purchaserInfo.purchaser_id) {
          isAffiliated = true;
        } else {
          const opNorm = (row.company_name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const pNorm = purchaserInfo.purchaser_name.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (opNorm.length > 5 && pNorm.includes(opNorm.substring(0, 10))) {
            isAffiliated = true;
          }
        }
      }

      return {
        operator_number: row.operator_number,
        operator_name: row.company_name || `Operator ${row.operator_number}`,
        your_wells: userWellCount,
        total_wells: row.well_count,
        total_gross: row.total_gross,
        residue_deductions: row.residue_deductions,
        liquids_returned: row.liquids_returned,
        deduction_ratio: deductionRatio,
        ngl_recovery_ratio: nglRecoveryRatio,
        is_affiliated: isAffiliated,
        gas_profile: gorOpMap.get(row.operator_number)?.label || null
      };
    });

    // Sort by deduction ratio descending (highest first)
    operatorData.sort((a, b) => b.deduction_ratio - a.deduction_ratio);

    // Get statewide median/average for context (operators with 20+ wells, $100k+ deductions)
    const statewideResult = await env.WELLS_DB.prepare(`
      SELECT
        COUNT(DISTINCT ol.operator_number) as operator_count,
        ROUND(SUM(opf.gross_value), 0) as total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) as residue_deductions,
        ROUND(SUM(CASE WHEN opf.product_code IN ('3', '6') THEN opf.gross_value ELSE 0 END), 0) as liquids_returned
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE opf.gross_value > 0
        AND opf.year_month >= ?
    `).bind(sixMonthsAgo).first() as {
      operator_count: number;
      total_gross: number;
      residue_deductions: number;
      liquids_returned: number;
    } | null;

    let statewide = null;
    if (statewideResult && statewideResult.total_gross > 0) {
      statewide = {
        operator_count: statewideResult.operator_count,
        deduction_ratio: Math.round((statewideResult.residue_deductions / statewideResult.total_gross) * 1000) / 10,
        ngl_recovery_ratio: statewideResult.residue_deductions > 0
          ? Math.round((statewideResult.liquids_returned / statewideResult.residue_deductions) * 1000) / 10
          : null
      };
    }

    const response = {
      operators: operatorData,
      statewide,
      analysis_period: '6 months'
    };

    // Cache for 2 hours
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(`operator-comparison:${cacheId}`, JSON.stringify(response), { expirationTtl: 7200 });
      } catch (e) {
        console.error('[Operator Comparison] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Operator Comparison] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load operator comparison',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// =============================================
// DEDUCTION RESEARCH (Market Research tab breakdown cards)
// =============================================

/**
 * GET /api/intelligence/deduction-research
 *
 * Returns statewide breakdown stats for the Deduction Audit Market Research tab:
 * - Top counties by deduction %
 * - Top operators by PCRR (most efficient)
 * - Top operators by net value return
 *
 * No auth required beyond login — this is statewide data, not portfolio-specific.
 */
export async function handleGetDeductionResearch(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    // Check KV cache (15 min, shared across all users since it's statewide)
    if (env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get('deduction-research', 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Deduction Research] Cache read error:', e);
      }
    }

    const sixMonthsAgo = getMonthsAgo(6);

    // Query 1: Top counties by avg deduction %
    const countiesResult = await env.WELLS_DB.prepare(`
      SELECT
        ol.county,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) * 100.0
              / NULLIF(SUM(opf.gross_value), 0), 1) AS avg_deduction_pct,
        COUNT(DISTINCT ol.base_pun) AS well_count
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE opf.gross_value > 0
        AND opf.year_month >= ?
        AND ol.county IS NOT NULL
      GROUP BY ol.county
      HAVING well_count >= 20
        AND avg_deduction_pct > 0
      ORDER BY avg_deduction_pct DESC
      LIMIT 5
    `).bind(sixMonthsAgo).all();

    // Query 2: Top operators by PCRR (most efficient — highest PCRR with 20+ wells)
    const pcrrResult = await env.WELLS_DB.prepare(`
      SELECT
        oc.company_name AS operator_name,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END) * 100.0
              / NULLIF(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0), 1) AS pcrr,
        COUNT(DISTINCT ol.base_pun) AS well_count
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      LEFT JOIN otc_companies oc ON ol.operator_number = oc.company_id
      WHERE opf.gross_value > 0
        AND opf.year_month >= ?
        AND ol.operator_number IS NOT NULL
      GROUP BY ol.operator_number
      HAVING well_count >= 20
        AND SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) > 0
      ORDER BY pcrr DESC
      LIMIT 5
    `).bind(sixMonthsAgo).all();

    // Query 3: Top operators by net value return (NGL returned - deductions)
    const netReturnResult = await env.WELLS_DB.prepare(`
      SELECT
        oc.company_name AS operator_name,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END)
              - SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS net_value_return,
        COUNT(DISTINCT ol.base_pun) AS well_count
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      LEFT JOIN otc_companies oc ON ol.operator_number = oc.company_id
      WHERE opf.gross_value > 0
        AND opf.year_month >= ?
        AND ol.operator_number IS NOT NULL
      GROUP BY ol.operator_number
      HAVING well_count >= 20
        AND SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) > 0
      ORDER BY net_value_return DESC
      LIMIT 5
    `).bind(sixMonthsAgo).all();

    const response = {
      topDeductionCounties: (countiesResult.results as any[]).map(r => ({
        county: r.county,
        avg_deduction_pct: r.avg_deduction_pct,
        well_count: r.well_count
      })),
      topPcrrOperators: (pcrrResult.results as any[]).map(r => ({
        operator_name: r.operator_name || 'Unknown',
        pcrr: r.pcrr,
        well_count: r.well_count
      })),
      topNetReturnOperators: (netReturnResult.results as any[]).map(r => ({
        operator_name: r.operator_name || 'Unknown',
        net_value_return: r.net_value_return,
        well_count: r.well_count
      }))
    };

    // Cache for 15 minutes
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put('deduction-research', JSON.stringify(response), { expirationTtl: 900 });
      } catch (e) {
        console.error('[Deduction Research] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Deduction Research] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({ error: 'Failed to load deduction research data' }, 500);
  }
}

// =============================================
// POOLING REPORT
// =============================================

/**
 * GET /api/intelligence/pooling-report
 *
 * Returns pooling orders near the user's properties with bonus rates,
 * royalty options, operator activity, and county averages.
 *
 * Uses two-phase query optimization:
 * 1. Get user's unique townships (±1) to filter pooling orders
 * 2. Compute exact distance tiers in JavaScript
 */
export async function handleGetPoolingReport(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    // Beta: Intelligence features limited to allowed organizations
    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('refresh') === '1';

    // Check KV cache
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`pooling-report:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Pooling Report] Cache read error:', e);
      }
    }

    // Step 1: Get user's properties with TRS data — org members see all org properties
    const propsQuery = userOrgId
      ? `SELECT id, section, township, range, county, airtable_record_id
         FROM properties
         WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))
           AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`
      : `SELECT id, section, township, range, county, airtable_record_id
         FROM properties
         WHERE user_id = ?
           AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`;

    const propsResult = userOrgId
      ? await env.WELLS_DB.prepare(propsQuery).bind(userOrgId, userOrgId).all()
      : await env.WELLS_DB.prepare(propsQuery).bind(authUser.id).all();

    const properties = propsResult.results as Array<{
      id: string;
      section: string;
      township: string;
      range: string;
      county: string;
      airtable_record_id: string;
    }>;

    if (!properties || properties.length === 0) {
      const emptyResponse = {
        summary: {
          totalNearbyOrders: 0,
          avgBonusPerAcre: null,
          bonusRange: { min: null, max: null },
          royaltyOptions: {},
          topOperators: [],
          dateRange: { earliest: null, latest: null }
        },
        byProperty: [],
        countyAverages: [],
        _message: 'No properties with location data found'
      };
      return jsonResponse(emptyResponse);
    }

    // Step 2: Build set of townships (±1) and ranges (±1) for broad filter
    const townships = new Set<string>();
    const ranges = new Set<string>();

    for (const p of properties) {
      const twp = parseTownship(p.township);
      const rng = parseRange(p.range);
      if (twp && rng) {
        // Same township
        townships.add(`${twp.num}${twp.dir}`);
        // ±1 township (same direction)
        townships.add(`${twp.num + 1}${twp.dir}`);
        if (twp.num > 1) townships.add(`${twp.num - 1}${twp.dir}`);

        // Same range
        ranges.add(`${rng.num}${rng.dir}`);
        // ±1 range (same direction)
        ranges.add(`${rng.num + 1}${rng.dir}`);
        if (rng.num > 1) ranges.add(`${rng.num - 1}${rng.dir}`);
      }
    }

    if (townships.size === 0) {
      const emptyResponse = {
        summary: {
          totalNearbyOrders: 0,
          avgBonusPerAcre: null,
          bonusRange: { min: null, max: null },
          royaltyOptions: {},
          topOperators: [],
          dateRange: { earliest: null, latest: null }
        },
        byProperty: [],
        countyAverages: [],
        _message: 'Could not parse property locations'
      };
      return jsonResponse(emptyResponse);
    }

    // Step 3: Query pooling orders in those townships with election options
    const twpArray = [...townships];
    const rngArray = [...ranges];
    const twpPlaceholders = twpArray.map(() => '?').join(',');
    const rngPlaceholders = rngArray.map(() => '?').join(',');

    const ordersResult = await env.WELLS_DB.prepare(`
      SELECT
        po.id, po.order_date, po.operator, po.formations, po.county,
        po.section, po.township, po.range, po.unit_size_acres, po.well_type,
        po.response_deadline, po.case_number, po.order_number, po.applicant,
        peo.option_number, peo.option_type, peo.bonus_per_acre, peo.royalty_fraction
      FROM pooling_orders po
      LEFT JOIN pooling_election_options peo ON peo.pooling_order_id = po.id
      WHERE po.township IN (${twpPlaceholders})
        AND po.range IN (${rngPlaceholders})
      ORDER BY po.order_date DESC, po.id, peo.option_number
    `).bind(...twpArray, ...rngArray).all();

    const orderRows = ordersResult.results as Array<{
      id: string;
      order_date: string;
      operator: string;
      formations: string;
      county: string;
      section: string;
      township: string;
      range: string;
      unit_size_acres: number;
      well_type: string;
      response_deadline: string;
      case_number: string;
      order_number: string;
      applicant: string;
      option_number: number;
      option_type: string;
      bonus_per_acre: number;
      royalty_fraction: string;
    }>;

    // Step 4: Group rows by order ID (since JOIN duplicates order data per option)
    const orderMap = new Map<string, {
      id: string;
      orderDate: string;
      operator: string;
      formations: any[];
      county: string;
      section: string;
      township: string;
      range: string;
      unitSizeAcres: number;
      wellType: string;
      responseDeadline: string;
      caseNumber: string;
      orderNumber: string;
      applicant: string;
      electionOptions: Array<{
        optionNumber: number;
        optionType: string;
        bonusPerAcre: number | null;
        royaltyFraction: string | null;
      }>;
    }>();

    for (const row of orderRows) {
      if (!orderMap.has(row.id)) {
        let formations: any[] = [];
        try {
          formations = row.formations ? JSON.parse(row.formations) : [];
        } catch (e) {
          formations = [];
        }

        orderMap.set(row.id, {
          id: row.id,
          orderDate: row.order_date,
          operator: row.operator || row.applicant || 'Unknown',
          formations,
          county: row.county,
          section: row.section,
          township: row.township,
          range: row.range,
          unitSizeAcres: row.unit_size_acres,
          wellType: row.well_type,
          responseDeadline: row.response_deadline,
          caseNumber: row.case_number,
          orderNumber: row.order_number,
          applicant: row.applicant,
          electionOptions: []
        });
      }

      // Add election option if present
      if (row.option_number !== null) {
        const order = orderMap.get(row.id)!;
        // Avoid duplicates
        if (!order.electionOptions.some(o => o.optionNumber === row.option_number)) {
          order.electionOptions.push({
            optionNumber: row.option_number,
            optionType: row.option_type,
            bonusPerAcre: row.bonus_per_acre,
            royaltyFraction: row.royalty_fraction
          });
        }
      }
    }

    const orders = [...orderMap.values()];

    // Step 5: For each order, find closest property and compute distance tier
    type OrderWithDistance = typeof orders[0] & {
      distanceTier: number;
      distanceDescription: string;
      nearestPropertyId: string | null;
    };

    const ordersWithDistance: OrderWithDistance[] = [];

    for (const order of orders) {
      let bestTier = { tier: 99, description: 'Distant', propertyId: null as string | null };

      for (const prop of properties) {
        const tier = getDistanceTier(
          parseInt(prop.section), prop.township, prop.range,
          order.section, order.township, order.range
        );
        if (tier.tier < bestTier.tier) {
          bestTier = { tier: tier.tier, description: tier.description, propertyId: prop.id };
        }
      }

      // Only include orders within distance tier 2 (same section, adjacent, or within 2 twp)
      if (bestTier.tier <= 2) {
        ordersWithDistance.push({
          ...order,
          distanceTier: bestTier.tier,
          distanceDescription: bestTier.description,
          nearestPropertyId: bestTier.propertyId
        });
      }
    }

    // Step 6: Group by property for byProperty response
    const propertyOrdersMap = new Map<string, typeof ordersWithDistance>();
    for (const order of ordersWithDistance) {
      if (order.nearestPropertyId) {
        if (!propertyOrdersMap.has(order.nearestPropertyId)) {
          propertyOrdersMap.set(order.nearestPropertyId, []);
        }
        propertyOrdersMap.get(order.nearestPropertyId)!.push(order);
      }
    }

    // Build byProperty response with enhanced stats
    const byProperty: Array<{
      propertyId: string;
      propertyName: string;
      section: string;
      township: string;
      range: string;
      county: string;
      orderCount: number;
      avgBonus: number | null;
      sameSectionCount: number;
      adjacentCount: number;
      nearbyOrders: typeof ordersWithDistance;
    }> = [];

    for (const prop of properties) {
      const propOrders = propertyOrdersMap.get(prop.id);
      if (propOrders && propOrders.length > 0) {
        // Sort by distance tier, then by date descending
        propOrders.sort((a, b) => {
          if (a.distanceTier !== b.distanceTier) return a.distanceTier - b.distanceTier;
          return b.orderDate.localeCompare(a.orderDate);
        });

        // Compute per-property stats
        const propBonuses: number[] = [];
        let sameSectionCount = 0;
        let adjacentCount = 0;
        for (const order of propOrders) {
          if (order.distanceTier === 0) sameSectionCount++;
          if (order.distanceTier === 1) adjacentCount++;
          for (const opt of order.electionOptions) {
            if (opt.bonusPerAcre !== null && opt.bonusPerAcre > 0) {
              propBonuses.push(opt.bonusPerAcre);
            }
          }
        }

        byProperty.push({
          propertyId: prop.id,
          propertyName: `${prop.township}-${prop.range}-${prop.section}`,
          section: prop.section,
          township: prop.township,
          range: prop.range,
          county: prop.county,
          orderCount: propOrders.length,
          avgBonus: propBonuses.length > 0
            ? Math.round(propBonuses.reduce((a, b) => a + b, 0) / propBonuses.length)
            : null,
          sameSectionCount,
          adjacentCount,
          nearbyOrders: propOrders
        });
      }
    }

    // Sort byProperty by number of nearby orders descending
    byProperty.sort((a, b) => b.nearbyOrders.length - a.nearbyOrders.length);

    // Step 7: Compute summary stats
    const allBonuses: number[] = [];
    const royaltyCountMap: Record<string, number> = {};
    const operatorCountMap: Record<string, number> = {};
    const orderDates: string[] = [];
    const uniqueOrderIds = new Set<string>();

    for (const order of ordersWithDistance) {
      uniqueOrderIds.add(order.id);
      if (order.orderDate) orderDates.push(order.orderDate);

      if (order.operator) {
        operatorCountMap[order.operator] = (operatorCountMap[order.operator] || 0) + 1;
      }

      for (const opt of order.electionOptions) {
        if (opt.bonusPerAcre !== null && opt.bonusPerAcre > 0) {
          allBonuses.push(opt.bonusPerAcre);
        }
        if (opt.royaltyFraction) {
          royaltyCountMap[opt.royaltyFraction] = (royaltyCountMap[opt.royaltyFraction] || 0) + 1;
        }
      }
    }

    const topOperators = Object.entries(operatorCountMap)
      .map(([name, orderCount]) => ({ name, orderCount }))
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 5);

    orderDates.sort();
    const avgBonus = allBonuses.length > 0
      ? Math.round(allBonuses.reduce((a, b) => a + b, 0) / allBonuses.length)
      : null;

    // Step 8: Compute enhanced county data (for My Markets tab)
    const countyStatsMap = new Map<string, {
      bonuses: number[];
      count: number;
      formations: Set<string>;
      operators: Map<string, number>;
      royalties: Map<string, number>;
    }>();
    for (const order of ordersWithDistance) {
      if (!order.county) continue;
      if (!countyStatsMap.has(order.county)) {
        countyStatsMap.set(order.county, {
          bonuses: [],
          count: 0,
          formations: new Set(),
          operators: new Map(),
          royalties: new Map()
        });
      }
      const stats = countyStatsMap.get(order.county)!;
      stats.count++;

      // Track operator counts
      if (order.operator) {
        stats.operators.set(order.operator, (stats.operators.get(order.operator) || 0) + 1);
      }

      for (const opt of order.electionOptions) {
        if (opt.bonusPerAcre !== null && opt.bonusPerAcre > 0) {
          stats.bonuses.push(opt.bonusPerAcre);
        }
        if (opt.royaltyFraction) {
          stats.royalties.set(opt.royaltyFraction, (stats.royalties.get(opt.royaltyFraction) || 0) + 1);
        }
      }
      for (const f of order.formations) {
        if (f && typeof f === 'object' && f.name) {
          stats.formations.add(f.name);
        } else if (typeof f === 'string') {
          stats.formations.add(f);
        }
      }
    }

    const countyAverages = [...countyStatsMap.entries()].map(([county, stats]) => {
      // Find most active operator (mode)
      let mostActiveOperator = '';
      let maxOpCount = 0;
      for (const [op, count] of stats.operators) {
        if (count > maxOpCount) {
          maxOpCount = count;
          mostActiveOperator = op;
        }
      }

      // Find dominant royalty (mode)
      let dominantRoyalty = '';
      let maxRoyaltyCount = 0;
      for (const [royalty, count] of stats.royalties) {
        if (count > maxRoyaltyCount) {
          maxRoyaltyCount = count;
          dominantRoyalty = royalty;
        }
      }

      return {
        county,
        avgBonus: stats.bonuses.length > 0
          ? Math.round(stats.bonuses.reduce((a, b) => a + b, 0) / stats.bonuses.length)
          : null,
        minBonus: stats.bonuses.length > 0 ? Math.min(...stats.bonuses) : null,
        maxBonus: stats.bonuses.length > 0 ? Math.max(...stats.bonuses) : null,
        orderCount: stats.count,
        formations: [...stats.formations],
        mostActiveOperator,
        dominantRoyalty
      };
    }).sort((a, b) => b.orderCount - a.orderCount);

    // Step 9: Compute STATEWIDE stats for Market Research tab (NOT scoped to user townships)
    // Query all pooling orders with election options for statewide analysis
    const statewideResult = await env.WELLS_DB.prepare(`
      SELECT
        po.id, po.order_date, po.operator, po.formations, po.county,
        peo.bonus_per_acre, peo.royalty_fraction
      FROM pooling_orders po
      LEFT JOIN pooling_election_options peo ON peo.pooling_order_id = po.id
      WHERE po.order_date >= date('now', '-12 months')
      ORDER BY po.order_date DESC
    `).all();

    const statewideRows = statewideResult.results as Array<{
      id: string;
      order_date: string;
      operator: string;
      formations: string;
      county: string;
      bonus_per_acre: number;
      royalty_fraction: string;
    }>;

    // Group by order ID and aggregate
    const statewideOrderMap = new Map<string, {
      id: string;
      orderDate: string;
      operator: string;
      formations: any[];
      county: string;
      bonuses: number[];
    }>();

    for (const row of statewideRows) {
      if (!statewideOrderMap.has(row.id)) {
        let formations: any[] = [];
        try {
          formations = row.formations ? JSON.parse(row.formations) : [];
        } catch (e) {
          formations = [];
        }
        statewideOrderMap.set(row.id, {
          id: row.id,
          orderDate: row.order_date,
          operator: row.operator,
          formations,
          county: row.county,
          bonuses: []
        });
      }
      if (row.bonus_per_acre !== null && row.bonus_per_acre > 0) {
        statewideOrderMap.get(row.id)!.bonuses.push(row.bonus_per_acre);
      }
    }

    const statewideOrders = [...statewideOrderMap.values()];

    // Top formations by avg bonus (statewide)
    const formationBonusMap = new Map<string, number[]>();
    for (const order of statewideOrders) {
      for (const f of order.formations) {
        const fName = (f && typeof f === 'object' && f.name) ? f.name : (typeof f === 'string' ? f : null);
        if (!fName) continue;
        if (!formationBonusMap.has(fName)) {
          formationBonusMap.set(fName, []);
        }
        formationBonusMap.get(fName)!.push(...order.bonuses);
      }
    }
    const topFormations = [...formationBonusMap.entries()]
      .filter(([_, bonuses]) => bonuses.length >= 3) // At least 3 data points
      .map(([name, bonuses]) => ({
        name,
        avgBonus: Math.round(bonuses.reduce((a, b) => a + b, 0) / bonuses.length),
        orderCount: bonuses.length
      }))
      .sort((a, b) => b.avgBonus - a.avgBonus)
      .slice(0, 5);

    // Top paying operators (statewide)
    const operatorBonusMap = new Map<string, number[]>();
    for (const order of statewideOrders) {
      if (!order.operator) continue;
      if (!operatorBonusMap.has(order.operator)) {
        operatorBonusMap.set(order.operator, []);
      }
      operatorBonusMap.get(order.operator)!.push(...order.bonuses);
    }
    const topPayingOperators = [...operatorBonusMap.entries()]
      .filter(([_, bonuses]) => bonuses.length >= 3)
      .map(([name, bonuses]) => ({
        name,
        avgBonus: Math.round(bonuses.reduce((a, b) => a + b, 0) / bonuses.length),
        orderCount: bonuses.length
      }))
      .sort((a, b) => b.avgBonus - a.avgBonus)
      .slice(0, 5);

    // Hottest counties (orders in last 90 days, statewide)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().substring(0, 10);
    const recentCountyMap = new Map<string, number>();
    for (const order of statewideOrders) {
      if (order.orderDate && order.orderDate >= ninetyDaysAgoStr && order.county) {
        recentCountyMap.set(order.county, (recentCountyMap.get(order.county) || 0) + 1);
      }
    }
    const hottestCounties = [...recentCountyMap.entries()]
      .map(([county, orderCount]) => ({ county, orderCount }))
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 5);

    const response = {
      summary: {
        totalNearbyOrders: uniqueOrderIds.size,
        avgBonusPerAcre: avgBonus,
        bonusRange: {
          min: allBonuses.length > 0 ? Math.min(...allBonuses) : null,
          max: allBonuses.length > 0 ? Math.max(...allBonuses) : null
        },
        royaltyOptions: royaltyCountMap,
        topOperators,
        dateRange: {
          earliest: orderDates.length > 0 ? orderDates[0] : null,
          latest: orderDates.length > 0 ? orderDates[orderDates.length - 1] : null
        },
        countyCount: countyAverages.length
      },
      byProperty,
      countyAverages,
      // Market Research data (statewide insights)
      marketResearch: {
        topFormations,
        topPayingOperators,
        hottestCounties
      }
    };

    // Cache for 1 hour
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(`pooling-report:${cacheId}`, JSON.stringify(response), { expirationTtl: 3600 });
      } catch (e) {
        console.error('[Pooling Report] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Pooling Report] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load pooling report',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * GET /print/intelligence/pooling
 * Generates a print-friendly HTML page for the Pooling Report
 */
export async function handlePoolingPrint(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) {
      const url = new URL(request.url);
      return Response.redirect(`/portal/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return new Response('User not found', { status: 404 });

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isIntelligenceAllowed(userOrgId)) {
      return new Response('Intelligence features not available for your account', { status: 403 });
    }

    const url = new URL(request.url);
    const tab = url.searchParams.get('tab') || 'properties';

    // Fetch pooling data (includes marketResearch in same response)
    const apiUrl = new URL('/api/intelligence/pooling-report', request.url);
    const apiRequest = new Request(apiUrl.toString(), { method: 'GET', headers: request.headers });
    const apiResponse = await handleGetPoolingReport(apiRequest, env);
    const data = await apiResponse.json() as any;

    if (data.error) {
      return new Response(`Error: ${data.error}`, { status: 500 });
    }

    const html = generatePoolingPrintHtml(data, userRecord.fields.Name || 'User', { tab });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error) {
    console.error('[Pooling Print] Error:', error);
    return new Response(`Error generating report: ${error instanceof Error ? error.message : 'Unknown'}`, { status: 500 });
  }
}

function generatePoolingPrintHtml(data: any, userName: string, options?: { tab?: string }): string {
  const { summary, byProperty, countyAverages, marketResearch } = data;
  const fmt = (n: number) => n?.toLocaleString() ?? '—';
  const fmtCurrency = (n: number) => n != null ? '$' + Math.round(n).toLocaleString() : '—';

  // Build body content based on active tab
  let bodyContent = '';
  if (options?.tab === 'research') {
    // Market Research tab
    const topFormations = marketResearch?.topFormations || [];
    const topPayingOperators = marketResearch?.topPayingOperators || [];
    const hottestCounties = marketResearch?.hottestCounties || [];

    bodyContent = `
    <div class="section">
      <div class="section-title">Statewide Market Research — Pooling Activity</div>
      <p style="font-size: 10px; color: #64748b; margin-bottom: 16px;">Statewide pooling intelligence from OCC forced pooling orders.</p>
    </div>`;

    if (topFormations.length) {
      bodyContent += `
    <div class="section">
      <div class="section-title">Highest-Paying Formations</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Formation</th>
            <th class="right">Avg Bonus $/Acre</th>
          </tr>
        </thead>
        <tbody>
          ${topFormations.map((f: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(f.name)}</td>
            <td class="right" style="color: #059669; font-weight: 600;">${fmtCurrency(f.avgBonus)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
    }

    if (topPayingOperators.length) {
      bodyContent += `
    <div class="section">
      <div class="section-title">Top-Paying Operators</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Operator</th>
            <th class="right">Avg Bonus $/Acre</th>
            <th class="right">Orders</th>
          </tr>
        </thead>
        <tbody>
          ${topPayingOperators.map((op: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(op.name)}</td>
            <td class="right" style="color: #059669; font-weight: 600;">${fmtCurrency(op.avgBonus)}</td>
            <td class="right">${fmt(op.orderCount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
    }

    if (hottestCounties.length) {
      bodyContent += `
    <div class="section">
      <div class="section-title">Hottest Counties (Last 90 Days)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>County</th>
            <th class="right">Orders</th>
          </tr>
        </thead>
        <tbody>
          ${hottestCounties.map((c: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(c.county)}</td>
            <td class="right" style="font-weight: 600;">${fmt(c.orderCount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
    }
  } else {
    // Portfolio tab (default) — summary + top properties
    const properties = byProperty || [];
    const topProps = properties
      .filter((p: any) => p.nearbyOrders?.length > 0)
      .sort((a: any, b: any) => (b.nearbyOrders?.length || 0) - (a.nearbyOrders?.length || 0))
      .slice(0, 15);

    bodyContent = `
    <div class="section">
      <div class="section-title">Portfolio Summary</div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Nearby Orders</div>
          <div class="summary-value">${fmt(summary?.totalNearbyOrders || 0)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Avg Bonus/Acre</div>
          <div class="summary-value" style="color: #059669;">${fmtCurrency(summary?.avgBonusPerAcre)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Bonus Range</div>
          <div class="summary-value">${fmtCurrency(summary?.bonusRange?.min)} – ${fmtCurrency(summary?.bonusRange?.max)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Counties</div>
          <div class="summary-value">${fmt(summary?.countyCount || 0)}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Properties with Nearby Pooling Orders (Top ${topProps.length})</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Property</th>
            <th>County</th>
            <th class="right">Nearby Orders</th>
            <th class="right">Avg Bonus</th>
          </tr>
        </thead>
        <tbody>
          ${topProps.length > 0 ? topProps.map((p: any, i: number) => {
            const orders = p.nearbyOrders || [];
            const bonuses = orders.flatMap((o: any) => o.bonuses || []);
            const avgBonus = bonuses.length > 0 ? Math.round(bonuses.reduce((a: number, b: number) => a + b, 0) / bonuses.length) : null;
            return `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td class="bold">${escapeHtml(p.propertyName || p.description || '—')}</td>
            <td>${escapeHtml(p.county || '—')}</td>
            <td class="right">${orders.length}</td>
            <td class="right" style="color: #059669; font-weight: 600;">${avgBonus ? fmtCurrency(avgBonus) : '—'}</td>
          </tr>`;
          }).join('') : '<tr><td colspan="4" style="text-align: center; color: #64748b;">No properties with nearby pooling orders</td></tr>'}
        </tbody>
      </table>
      ${properties.filter((p: any) => p.nearbyOrders?.length > 0).length > 15 ? `<p class="note">+ more properties. See full report online.</p>` : ''}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pooling Report - Mineral Watch</title>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 20px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .print-controls { max-width: 8.5in; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 12px; }
    .print-btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .print-btn.primary { background: #1C2B36; color: white; }
    .print-btn.primary:hover { background: #334E68; }
    .print-btn.secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
    .print-btn.secondary:hover { background: #f8fafc; }
    .print-container { width: 8.5in; min-height: 11in; margin: 0 auto; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1C2B36 0%, #334E68 100%); color: white; padding: 20px 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.5px; }
    .header .subtitle { font-size: 12px; opacity: 0.8; }
    .header .brand { text-align: right; }
    .header .brand-name { font-size: 20px; font-weight: 700; font-family: 'Merriweather', Georgia, serif; display: flex; align-items: center; gap: 6px; }
    .header .brand-url { font-size: 10px; opacity: 0.8; margin-top: 4px; }
    .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
    .section-title { font-size: 11px; font-weight: 700; color: #1C2B36; margin-bottom: 12px; letter-spacing: 0.5px; text-transform: uppercase; }
    .summary-grid { display: flex; gap: 24px; flex-wrap: wrap; }
    .summary-item { flex: 1; min-width: 100px; }
    .summary-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .summary-value { font-size: 20px; font-weight: 700; color: #1C2B36; }
    .summary-value.danger { color: #dc2626; }
    .summary-value.warning { color: #d97706; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .data-table th { padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #64748b; background: #f8fafc; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    .data-table th.right { text-align: right; }
    .data-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
    .data-table td.right { text-align: right; font-family: 'JetBrains Mono', monospace; }
    .data-table td.bold { font-weight: 600; color: #1C2B36; }
    .data-table tr.alt { background: #f8fafc; }
    .footer { padding: 12px 24px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; background: #f8fafc; }
    .note { font-size: 9px; color: #64748b; margin-top: 8px; font-style: italic; }
    @media screen and (max-width: 768px) {
      body { padding: 8px; }
      .print-controls { flex-direction: column; align-items: stretch; max-width: 100%; }
      .print-btn { justify-content: center; }
      .print-container { width: 100%; min-height: auto; box-shadow: none; }
      .header { flex-direction: column; gap: 10px; padding: 16px; }
      .header .brand { text-align: left; }
      .header .brand-name { font-size: 17px; }
      .section { padding: 12px 14px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .summary-grid { gap: 12px; }
      .summary-item { min-width: 80px; }
      .summary-value { font-size: 16px; }
      .data-table { min-width: 400px; }
      .footer { flex-direction: column; gap: 4px; padding: 10px 14px; }
    }
    @media print {
      body { background: white; padding: 0; }
      .print-controls { display: none !important; }
      .print-container { box-shadow: none; width: 100%; }
    }
    @page { size: letter; margin: 0.25in; }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn secondary" onclick="window.close()">← Back to Dashboard</button>
    <button class="print-btn primary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      Print Report
    </button>
  </div>

  <div class="print-container">
    <div class="header">
      <div>
        <h1>POOLING REPORT${options?.tab === 'research' ? ' — MARKET RESEARCH' : ''}</h1>
        <div class="subtitle">OCC forced pooling orders near your properties</div>
      </div>
      <div class="brand">
        <div class="brand-name">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          MINERAL WATCH
        </div>
        <div class="brand-url">mymineralwatch.com</div>
      </div>
    </div>

    ${bodyContent}

    <div class="footer">
      <span>Generated by Mineral Watch • mymineralwatch.com • ${new Date().toLocaleDateString()}</span>
      <span>Data sourced from Oklahoma Corporation Commission pooling orders</span>
    </div>
  </div>
</body>
</html>`;
}

// =============================================
// PRODUCTION DECLINE REPORT
// =============================================

interface DeclineWell {
  clientWellId: string;
  wellId: string;
  apiNumber: string;
  wellName: string;
  operator: string;
  county: string;
  formation: string;
  wellType: string;
  isHorizontal: boolean;
  lastReportedMonth: string;
  recentOilBBL: number;
  recentGasMCF: number;
  recentBOE: number;
  yoyChangePct: number | null;
  status: 'active' | 'idle';
}

/**
 * GET /api/intelligence/production-decline
 *
 * Returns production decline analysis for user's wells:
 * - Portfolio summary (active/idle counts, wells in decline)
 * - Per-well metrics (recent production, YoY change, status)
 * - Uses VirtualTable on frontend for 1000+ wells
 */
export async function handleGetProductionDecline(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    // Beta: Intelligence features limited to allowed organizations
    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    // Check KV cache
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`production-decline:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Production Decline] Cache read error:', e);
      }
    }

    // Calculate 24 months back from now
    const now = new Date();
    now.setMonth(now.getMonth() - 24);
    const twentyFourMonthsAgo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Step 1: Get user's wells with metadata from D1
    // CTE approach with scoped production query for performance
    const query = `
      WITH user_wells AS (
        SELECT cw.id as client_well_id, cw.api_number,
               w.id as well_id, w.well_name, w.operator, w.county,
               w.formation_name, w.well_type, w.is_horizontal
        FROM client_wells cw
        JOIN wells w ON w.api_number = cw.api_number
        WHERE (cw.organization_id = ? OR cw.user_id = ? OR cw.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))
      ),
      production AS (
        SELECT wpl.api_number, op.year_month,
               SUM(CASE WHEN op.product_code IN ('1','3') THEN op.gross_volume ELSE 0 END) as oil,
               SUM(CASE WHEN op.product_code IN ('5','6') THEN op.gross_volume ELSE 0 END) as gas
        FROM well_pun_links wpl
        JOIN otc_production op ON op.pun = wpl.pun
        WHERE wpl.api_number IN (SELECT api_number FROM user_wells)
          AND op.year_month >= ?
        GROUP BY wpl.api_number, op.year_month
      )
      SELECT uw.*, p.year_month, p.oil, p.gas
      FROM user_wells uw
      LEFT JOIN production p ON p.api_number = uw.api_number
      ORDER BY uw.well_name, p.year_month DESC
    `;

    const result = await env.WELLS_DB.prepare(query)
      .bind(userOrgId || '', authUser.id, userOrgId || '', twentyFourMonthsAgo)
      .all();

    const rows = result.results as Array<{
      client_well_id: string;
      api_number: string;
      well_id: string;
      well_name: string;
      operator: string;
      county: string;
      formation_name: string;
      well_type: string;
      is_horizontal: number;
      year_month: string | null;
      oil: number | null;
      gas: number | null;
    }>;

    // Step 2: Group rows by well and compute metrics
    const wellMap = new Map<string, {
      clientWellId: string;
      wellId: string;
      apiNumber: string;
      wellName: string;
      operator: string;
      county: string;
      formation: string;
      wellType: string;
      isHorizontal: boolean;
      monthlyData: Array<{ yearMonth: string; oil: number; gas: number; boe: number }>;
    }>();

    // Get the latest data month from all production
    let latestDataMonth = '000000';

    for (const row of rows) {
      const key = row.api_number;

      if (!wellMap.has(key)) {
        wellMap.set(key, {
          clientWellId: row.client_well_id,
          wellId: row.well_id,
          apiNumber: row.api_number,
          wellName: row.well_name || `API ${row.api_number}`,
          operator: row.operator || 'Unknown',
          county: row.county || 'Unknown',
          formation: row.formation_name || 'Unknown',
          wellType: row.well_type || 'Unknown',
          isHorizontal: row.is_horizontal === 1,
          monthlyData: []
        });
      }

      if (row.year_month && (row.oil || row.gas)) {
        const oil = row.oil || 0;
        const gas = row.gas || 0;
        const boe = oil + (gas / 6);

        wellMap.get(key)!.monthlyData.push({
          yearMonth: row.year_month,
          oil,
          gas,
          boe
        });

        if (row.year_month > latestDataMonth) {
          latestDataMonth = row.year_month;
        }
      }
    }

    // Step 3: Compute YoY and status for each well
    const wells: DeclineWell[] = [];
    let activeCount = 0;
    let idleCount = 0;
    let decliningCount = 0;
    let steepDeclineCount = 0;
    let portfolioOil = 0;
    let portfolioGas = 0;

    // Calculate the threshold for "active" (last 3 months from latest data month)
    const latestYear = parseInt(latestDataMonth.substring(0, 4));
    const latestMonth = parseInt(latestDataMonth.substring(4, 6));
    let thresholdMonth = latestMonth - 3;
    let thresholdYear = latestYear;
    if (thresholdMonth <= 0) {
      thresholdMonth += 12;
      thresholdYear -= 1;
    }
    const activeThreshold = `${thresholdYear}${String(thresholdMonth).padStart(2, '0')}`;

    for (const [_, wellData] of wellMap) {
      // Sort monthly data descending (newest first)
      wellData.monthlyData.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

      // Find most recent month with production
      const recentData = wellData.monthlyData.find(m => m.oil > 0 || m.gas > 0);

      let lastReportedMonth = '';
      let recentOil = 0;
      let recentGas = 0;
      let recentBOE = 0;
      let yoyChangePct: number | null = null;
      let status: 'active' | 'idle' = 'idle';

      if (recentData) {
        lastReportedMonth = recentData.yearMonth;
        recentOil = Math.round(recentData.oil);
        recentGas = Math.round(recentData.gas);
        recentBOE = Math.round(recentData.boe);

        // Determine status based on last reported month
        status = lastReportedMonth >= activeThreshold ? 'active' : 'idle';

        // Calculate YoY (compare to same month last year)
        const recentYear = parseInt(lastReportedMonth.substring(0, 4));
        const recentMonth = parseInt(lastReportedMonth.substring(4, 6));
        const priorYearMonth = `${recentYear - 1}${String(recentMonth).padStart(2, '0')}`;

        // Find same month last year (or nearby month)
        const priorData = wellData.monthlyData.find(m => m.yearMonth === priorYearMonth) ||
          wellData.monthlyData.find(m => {
            const mYear = parseInt(m.yearMonth.substring(0, 4));
            const mMonth = parseInt(m.yearMonth.substring(4, 6));
            return mYear === recentYear - 1 && Math.abs(mMonth - recentMonth) <= 1;
          });

        if (priorData && priorData.boe > 0) {
          yoyChangePct = Math.round(((recentBOE - priorData.boe) / priorData.boe) * 100);
        }
      }

      // Add to portfolio totals (most recent month only for active wells)
      if (status === 'active') {
        activeCount++;
        portfolioOil += recentOil;
        portfolioGas += recentGas;
      } else {
        idleCount++;
      }

      // Count decliners
      if (yoyChangePct !== null && yoyChangePct < 0) {
        decliningCount++;
        if (yoyChangePct < -20) {
          steepDeclineCount++;
        }
      }

      wells.push({
        clientWellId: wellData.clientWellId,
        wellId: wellData.wellId,
        apiNumber: wellData.apiNumber,
        wellName: wellData.wellName,
        operator: wellData.operator,
        county: wellData.county,
        formation: wellData.formation,
        wellType: wellData.wellType,
        isHorizontal: wellData.isHorizontal,
        lastReportedMonth,
        recentOilBBL: recentOil,
        recentGasMCF: recentGas,
        recentBOE,
        yoyChangePct,
        status
      });
    }

    // Sort by YoY ascending (steepest decline first) by default
    wells.sort((a, b) => {
      // Idle wells at the bottom
      if (a.status === 'idle' && b.status !== 'idle') return 1;
      if (a.status !== 'idle' && b.status === 'idle') return -1;
      // Null YoY after real values
      if (a.yoyChangePct === null && b.yoyChangePct !== null) return 1;
      if (a.yoyChangePct !== null && b.yoyChangePct === null) return -1;
      if (a.yoyChangePct === null && b.yoyChangePct === null) return 0;
      // Sort by YoY ascending (most negative first)
      return a.yoyChangePct! - b.yoyChangePct!;
    });

    // Step 4: Compute monthly portfolio totals for trend chart
    const monthlyMap = new Map<string, { oil: number; gas: number }>();
    for (const [_, wellData] of wellMap) {
      for (const month of wellData.monthlyData) {
        const existing = monthlyMap.get(month.yearMonth) || { oil: 0, gas: 0 };
        existing.oil += month.oil;
        existing.gas += month.gas;
        monthlyMap.set(month.yearMonth, existing);
      }
    }

    // Convert to sorted array (last 18 months for chart - matches Unit Production Report)
    const allMonths = Array.from(monthlyMap.entries())
      .map(([yearMonth, data]) => ({
        yearMonth,
        totalOil: Math.round(data.oil),
        totalGas: Math.round(data.gas),
        totalBOE: Math.round(data.oil + data.gas / 6)
      }))
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

    // Take last 18 months (industry standard uses 24 months for analysis, 18 for chart display)
    const monthlyTotals = allMonths.slice(-18);

    const response = {
      latestDataMonth,
      summary: {
        totalWells: wells.length,
        activeWells: activeCount,
        idleWells: idleCount,
        portfolioOilBBL: portfolioOil,
        portfolioGasMCF: portfolioGas,
        wellsInDecline: decliningCount,
        wellsSteepDecline: steepDeclineCount
      },
      wells,
      monthlyTotals
    };

    // Cache for 1 hour
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(`production-decline:${cacheId}`, JSON.stringify(response), { expirationTtl: 3600 });
      } catch (e) {
        console.error('[Production Decline] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Production Decline] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load production decline report',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// =============================================
// PRODUCTION DECLINE — MY MARKETS (COUNTY BENCHMARKS)
// =============================================

interface FormationSummary {
  formation: string;
  wellCount: number;
  avgYoyChangePct: number | null;
  activeWells: number;
  idleWells: number;
}

interface CountyAggregate {
  county: string;
  totalWells: number;
  activeWells: number;
  idleWells: number;
  avgYoyChangePct: number | null;
  medianYoyChangePct: number | null;
  weightedAvgYoyPct: number | null;
  userWellCount: number;
  userAvgYoyPct: number | null;
  userMedianYoyPct: number | null;
  userVsCountyDelta: number | null;
  topFormations: FormationSummary[];
}

/**
 * GET /api/intelligence/production-decline/markets
 *
 * Returns county benchmark data for the My Markets tab.
 * Computes YoY decline metrics for ACTIVE wells (produced within 3 months of data horizon)
 * in each of the user's counties. Idle wells are excluded from benchmarks so
 * comparisons reflect producing-well performance, not idle-well dilution.
 *
 * Uses 24-hour cache TTL since county averages barely change day-to-day.
 */
export async function handleGetProductionDeclineMarkets(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    // Check KV cache (24-hour TTL for county aggregates)
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`production-decline-markets:${cacheId}`, 'json');
        if (cached) {
          console.log('[Production Decline Markets] Returning cached data');
          return jsonResponse(cached);
        }
      } catch (e) {
        console.error('[Production Decline Markets] Cache read error:', e);
      }
    }

    console.log('[Production Decline Markets] Computing county benchmarks...');

    // Step 1: Get user's wells with their counties and YoY data
    const now = new Date();
    now.setMonth(now.getMonth() - 24);
    const twentyFourMonthsAgo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get user's wells with production data
    const userWellsQuery = `
      WITH user_wells AS (
        SELECT cw.api_number, w.county, w.formation_name, w.is_horizontal
        FROM client_wells cw
        JOIN wells w ON w.api_number = cw.api_number
        WHERE (cw.organization_id = ? OR cw.user_id = ? OR cw.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))
          AND w.county IS NOT NULL
      ),
      production AS (
        SELECT wpl.api_number, op.year_month,
               SUM(CASE WHEN op.product_code IN ('1','3') THEN op.gross_volume ELSE 0 END) as oil,
               SUM(CASE WHEN op.product_code IN ('5','6') THEN op.gross_volume ELSE 0 END) as gas
        FROM well_pun_links wpl
        JOIN otc_production op ON op.pun = wpl.pun
        WHERE wpl.api_number IN (SELECT api_number FROM user_wells)
          AND op.year_month >= ?
        GROUP BY wpl.api_number, op.year_month
      )
      SELECT uw.api_number, uw.county, uw.formation_name, uw.is_horizontal,
             p.year_month, p.oil, p.gas
      FROM user_wells uw
      LEFT JOIN production p ON p.api_number = uw.api_number
      ORDER BY uw.county, uw.api_number, p.year_month DESC
    `;

    const userWellsResult = await env.WELLS_DB.prepare(userWellsQuery)
      .bind(userOrgId || '', authUser.id, userOrgId || '', twentyFourMonthsAgo)
      .all();

    const userWellRows = userWellsResult.results as Array<{
      api_number: string;
      county: string;
      formation_name: string | null;
      is_horizontal: number | null;
      year_month: string | null;
      oil: number | null;
      gas: number | null;
    }>;

    // Group user wells by api_number to compute their YoY
    const userWellMap = new Map<string, {
      county: string;
      formation: string;
      monthlyData: Array<{ yearMonth: string; oil: number; gas: number; boe: number }>;
    }>();

    let latestDataMonth = '000000';

    for (const row of userWellRows) {
      if (!userWellMap.has(row.api_number)) {
        userWellMap.set(row.api_number, {
          county: row.county,
          formation: row.formation_name || 'Unknown',
          monthlyData: []
        });
      }

      if (row.year_month && (row.oil || row.gas)) {
        const oil = row.oil || 0;
        const gas = row.gas || 0;
        userWellMap.get(row.api_number)!.monthlyData.push({
          yearMonth: row.year_month,
          oil,
          gas,
          boe: oil + gas / 6
        });
        if (row.year_month > latestDataMonth) {
          latestDataMonth = row.year_month;
        }
      }
    }

    // Compute YoY for each user well
    const userWellYoY = new Map<string, { county: string; yoyPct: number | null }>();

    // Calculate active threshold (3 months from latest)
    const latestYear = parseInt(latestDataMonth.substring(0, 4));
    const latestMonth = parseInt(latestDataMonth.substring(4, 6));
    let thresholdMonth = latestMonth - 3;
    let thresholdYear = latestYear;
    if (thresholdMonth <= 0) {
      thresholdMonth += 12;
      thresholdYear -= 1;
    }
    const activeThreshold = `${thresholdYear}${String(thresholdMonth).padStart(2, '0')}`;

    for (const [apiNumber, wellData] of userWellMap) {
      wellData.monthlyData.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
      const recentData = wellData.monthlyData.find(m => m.oil > 0 || m.gas > 0);

      let yoyPct: number | null = null;
      // Only compute YoY for active wells (produced within 3 months of data horizon)
      if (recentData && recentData.yearMonth >= activeThreshold) {
        const recentYear = parseInt(recentData.yearMonth.substring(0, 4));
        const recentMonth = parseInt(recentData.yearMonth.substring(4, 6));
        const priorYearMonth = `${recentYear - 1}${String(recentMonth).padStart(2, '0')}`;

        const priorData = wellData.monthlyData.find(m => m.yearMonth === priorYearMonth) ||
          wellData.monthlyData.find(m => {
            const mYear = parseInt(m.yearMonth.substring(0, 4));
            const mMonth = parseInt(m.yearMonth.substring(4, 6));
            return mYear === recentYear - 1 && Math.abs(mMonth - recentMonth) <= 1;
          });

        if (priorData && priorData.boe > 0) {
          yoyPct = Math.round(((recentData.boe - priorData.boe) / priorData.boe) * 100);
        }
      }

      userWellYoY.set(apiNumber, { county: wellData.county, yoyPct });
    }

    // Get distinct counties from user's wells
    const userCounties = [...new Set(Array.from(userWellMap.values()).map(w => w.county))].filter(Boolean);
    console.log(`[Production Decline Markets] User has wells in ${userCounties.length} counties`);

    if (userCounties.length === 0) {
      return jsonResponse({ latestDataMonth, counties: [] });
    }

    // Step 2: For each county, compute aggregate metrics for ALL wells
    const countyAggregates: CountyAggregate[] = [];

    // Process counties in parallel (batch of 5 to avoid overwhelming D1)
    const BATCH_SIZE = 5;
    for (let i = 0; i < userCounties.length; i += BATCH_SIZE) {
      const batch = userCounties.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(batch.map(async (county) => {
        try {
          return await computeCountyAggregate(
            county,
            twentyFourMonthsAgo,
            activeThreshold,
            userWellYoY,
            env
          );
        } catch (err) {
          console.error(`[Production Decline Markets] Error computing county ${county}:`, err);
          return null;
        }
      }));

      for (const result of batchResults) {
        if (result) {
          countyAggregates.push(result);
        }
      }
    }

    // Sort by user well count descending (most relevant counties first)
    countyAggregates.sort((a, b) => b.userWellCount - a.userWellCount);

    const response = {
      latestDataMonth,
      counties: countyAggregates
    };

    // Cache for 24 hours
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(
          `production-decline-markets:${cacheId}`,
          JSON.stringify(response),
          { expirationTtl: 86400 } // 24 hours
        );
      } catch (e) {
        console.error('[Production Decline Markets] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Production Decline Markets] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load market benchmarks',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Compute aggregate decline metrics for all wells in a county
 */
async function computeCountyAggregate(
  county: string,
  twentyFourMonthsAgo: string,
  activeThreshold: string,
  userWellYoY: Map<string, { county: string; yoyPct: number | null }>,
  env: Env
): Promise<CountyAggregate> {

  // Query all wells in this county with their production
  const query = `
    WITH county_wells AS (
      SELECT w.api_number, w.formation_name, w.is_horizontal
      FROM wells w
      WHERE w.county = ?
    ),
    production AS (
      SELECT wpl.api_number, op.year_month,
             SUM(CASE WHEN op.product_code IN ('1','3') THEN op.gross_volume ELSE 0 END) as oil,
             SUM(CASE WHEN op.product_code IN ('5','6') THEN op.gross_volume ELSE 0 END) as gas
      FROM well_pun_links wpl
      JOIN otc_production op ON op.pun = wpl.pun
      WHERE wpl.api_number IN (SELECT api_number FROM county_wells)
        AND op.year_month >= ?
      GROUP BY wpl.api_number, op.year_month
    )
    SELECT cw.api_number, cw.formation_name, cw.is_horizontal,
           p.year_month, p.oil, p.gas
    FROM county_wells cw
    LEFT JOIN production p ON p.api_number = cw.api_number
    ORDER BY cw.api_number, p.year_month DESC
  `;

  const result = await env.WELLS_DB.prepare(query)
    .bind(county, twentyFourMonthsAgo)
    .all();

  const rows = result.results as Array<{
    api_number: string;
    formation_name: string | null;
    is_horizontal: number | null;
    year_month: string | null;
    oil: number | null;
    gas: number | null;
  }>;

  // Group by well
  const wellMap = new Map<string, {
    formation: string;
    isHorizontal: boolean;
    monthlyData: Array<{ yearMonth: string; oil: number; gas: number; boe: number }>;
  }>();

  for (const row of rows) {
    if (!wellMap.has(row.api_number)) {
      wellMap.set(row.api_number, {
        formation: row.formation_name || 'Unknown',
        isHorizontal: row.is_horizontal === 1,
        monthlyData: []
      });
    }

    if (row.year_month && (row.oil || row.gas)) {
      const oil = row.oil || 0;
      const gas = row.gas || 0;
      wellMap.get(row.api_number)!.monthlyData.push({
        yearMonth: row.year_month,
        oil,
        gas,
        boe: oil + gas / 6
      });
    }
  }

  // Compute YoY for each county well
  const countyYoYValues: number[] = [];
  const weightedYoYPairs: Array<{ yoyPct: number; boe: number }> = [];
  const formationMap = new Map<string, { yoyValues: number[]; activeCount: number; idleCount: number }>();
  let activeCount = 0;
  let idleCount = 0;
  const minMonthlyBoe = MIN_BOE_THRESHOLD / 12;

  for (const [_, wellData] of wellMap) {
    wellData.monthlyData.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    const recentData = wellData.monthlyData.find(m => m.oil > 0 || m.gas > 0);

    // Track formation
    if (!formationMap.has(wellData.formation)) {
      formationMap.set(wellData.formation, { yoyValues: [], activeCount: 0, idleCount: 0 });
    }
    const formationStats = formationMap.get(wellData.formation)!;

    if (!recentData) {
      idleCount++;
      formationStats.idleCount++;
      continue;
    }

    // Determine active/idle based on data horizon threshold
    const isActive = recentData.yearMonth >= activeThreshold;
    if (isActive) {
      activeCount++;
      formationStats.activeCount++;
    } else {
      idleCount++;
      formationStats.idleCount++;
      continue; // Only compare active wells — idle wells skew county benchmarks
    }

    // Compute YoY (active wells only)
    const recentYear = parseInt(recentData.yearMonth.substring(0, 4));
    const recentMonth = parseInt(recentData.yearMonth.substring(4, 6));
    const priorYearMonth = `${recentYear - 1}${String(recentMonth).padStart(2, '0')}`;

    const priorData = wellData.monthlyData.find(m => m.yearMonth === priorYearMonth) ||
      wellData.monthlyData.find(m => {
        const mYear = parseInt(m.yearMonth.substring(0, 4));
        const mMonth = parseInt(m.yearMonth.substring(4, 6));
        return mYear === recentYear - 1 && Math.abs(mMonth - recentMonth) <= 1;
      });

    // Skip marginal wells below threshold — they create extreme % swings
    if (priorData && priorData.boe >= minMonthlyBoe) {
      const yoyPct = Math.round(((recentData.boe - priorData.boe) / priorData.boe) * 100);
      countyYoYValues.push(yoyPct);
      weightedYoYPairs.push({ yoyPct, boe: priorData.boe });
      formationStats.yoyValues.push(yoyPct);
    }
  }

  // Compute county mean
  const avgYoyChangePct = countyYoYValues.length > 0
    ? Math.round(countyYoYValues.reduce((a, b) => a + b, 0) / countyYoYValues.length)
    : null;

  // Compute county median
  let medianYoyChangePct: number | null = null;
  if (countyYoYValues.length > 0) {
    const sorted = [...countyYoYValues].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianYoyChangePct = sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  // Compute volume-weighted average (prior-year BOE as weight)
  let weightedAvgYoyPct: number | null = null;
  if (weightedYoYPairs.length > 0) {
    const totalBoe = weightedYoYPairs.reduce((sum, p) => sum + p.boe, 0);
    if (totalBoe > 0) {
      weightedAvgYoyPct = Math.round(
        weightedYoYPairs.reduce((sum, p) => sum + p.yoyPct * p.boe, 0) / totalBoe
      );
    }
  }

  // Get user's wells in this county
  const userWellsInCounty: number[] = [];
  for (const [apiNumber, data] of userWellYoY) {
    if (data.county === county && data.yoyPct !== null) {
      userWellsInCounty.push(data.yoyPct);
    }
  }

  const userWellCount = Array.from(userWellYoY.values()).filter(w => w.county === county).length;
  const userAvgYoyPct = userWellsInCounty.length > 0
    ? Math.round(userWellsInCounty.reduce((a, b) => a + b, 0) / userWellsInCounty.length)
    : null;

  // Compute user median YoY
  let userMedianYoyPct: number | null = null;
  if (userWellsInCounty.length > 0) {
    const sorted = [...userWellsInCounty].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    userMedianYoyPct = sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  // Delta: median-vs-median comparison
  const userVsCountyDelta = (userMedianYoyPct !== null && medianYoyChangePct !== null)
    ? userMedianYoyPct - medianYoyChangePct
    : null;

  // Build formation summaries (top 5 by well count)
  const topFormations: FormationSummary[] = Array.from(formationMap.entries())
    .map(([formation, stats]) => ({
      formation,
      wellCount: stats.activeCount + stats.idleCount,
      avgYoyChangePct: stats.yoyValues.length > 0
        ? Math.round(stats.yoyValues.reduce((a, b) => a + b, 0) / stats.yoyValues.length)
        : null,
      activeWells: stats.activeCount,
      idleWells: stats.idleCount
    }))
    .filter(f => f.wellCount >= 3 && f.formation !== 'Unknown' && f.formation !== '') // Exclude Unknown/empty + require meaningful data
    .sort((a, b) => b.wellCount - a.wellCount)
    .slice(0, 5);

  return {
    county: county.replace(/^\d{3}-/, ''), // Strip county code prefix
    totalWells: wellMap.size,
    activeWells: activeCount,
    idleWells: idleCount,
    avgYoyChangePct,
    medianYoyChangePct,
    weightedAvgYoyPct,
    userWellCount,
    userAvgYoyPct,
    userMedianYoyPct,
    userVsCountyDelta,
    topFormations
  };
}

/**
 * Compute distance tier between a property and a pooling order
 */
function getDistanceTier(
  propSection: number, propTwp: string, propRng: string,
  orderSection: string, orderTwp: string, orderRng: string
): { tier: number; description: string } {
  const pTwp = parseTownship(propTwp);
  const pRng = parseRange(propRng);
  const oTwp = parseTownship(orderTwp);
  const oRng = parseRange(orderRng);

  if (!pTwp || !pRng || !oTwp || !oRng) return { tier: 99, description: 'Unknown' };

  const sameTwp = pTwp.num === oTwp.num && pTwp.dir === oTwp.dir;
  const sameRng = pRng.num === oRng.num && pRng.dir === oRng.dir;
  const sameSection = propSection === parseInt(orderSection);

  // Tier 0: Same section
  if (sameTwp && sameRng && sameSection) {
    return { tier: 0, description: 'Same section' };
  }

  // Tier 1: Adjacent section (8-connected neighbors)
  const adjacents = getAdjacentLocations(propSection, propTwp, propRng);
  const isAdjacent = adjacents.some(a =>
    a.section === parseInt(orderSection) &&
    a.township.toUpperCase() === orderTwp.toUpperCase() &&
    a.range.toUpperCase() === orderRng.toUpperCase()
  );
  if (isAdjacent) {
    return { tier: 1, description: 'Adjacent' };
  }

  // Tier 2: Within ±1 township and ±1 range (same direction)
  const twpDiff = Math.abs(pTwp.num - oTwp.num);
  const rngDiff = Math.abs(pRng.num - oRng.num);
  if (twpDiff <= 1 && rngDiff <= 1 && pTwp.dir === oTwp.dir && pRng.dir === oRng.dir) {
    return { tier: 2, description: 'Within 2 twp' };
  }

  return { tier: 99, description: 'Distant' };
}

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

// =============================================
// PRINT REPORT HANDLERS
// =============================================

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatReportMonth(yyyymm: string): string {
  if (!yyyymm || yyyymm.length < 6) return yyyymm || '';
  const year = yyyymm.substring(0, 4);
  const month = parseInt(yyyymm.substring(4, 6), 10);
  return MONTH_ABBR[month - 1] + ' ' + year;
}

function escapeHtml(s: string): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * GET /print/intelligence/deduction-audit
 * Generates a print-friendly HTML page for the Deduction Audit report
 */
export async function handleDeductionAuditPrint(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) {
      const url = new URL(request.url);
      return Response.redirect(`/portal/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return new Response('User not found', { status: 404 });

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isIntelligenceAllowed(userOrgId)) {
      return new Response('Intelligence features not available for your account', { status: 403 });
    }

    // Check which tab to print
    const url = new URL(request.url);
    const tab = url.searchParams.get('tab') || 'properties';

    // Fetch data using internal API call pattern (reuse cache)
    const apiUrl = new URL('/api/intelligence/deduction-report', request.url);
    const apiRequest = new Request(apiUrl.toString(), {
      method: 'GET',
      headers: request.headers
    });
    const fetchPromises: Promise<Response>[] = [
      handleGetDeductionReport(apiRequest, env),
    ];

    // Also fetch research data if on research tab
    if (tab === 'research') {
      const researchUrl = new URL('/api/intelligence/deduction-research', request.url);
      fetchPromises.push(
        handleGetDeductionResearch(new Request(researchUrl.toString(), { method: 'GET', headers: request.headers }), env)
      );
    }

    const responses = await Promise.all(fetchPromises);
    const data = await responses[0].json() as any;
    const researchData = tab === 'research' ? await responses[1].json() as any : null;

    if (data.error) {
      return new Response(`Error: ${data.error}`, { status: 500 });
    }

    const html = generateDeductionAuditPrintHtml(data, userRecord.fields.Name || 'User', { tab, researchData });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error) {
    console.error('[Deduction Audit Print] Error:', error);
    return new Response(`Error generating report: ${error instanceof Error ? error.message : 'Unknown'}`, { status: 500 });
  }
}

function generateDeductionResearchPrintSection(options?: { tab?: string; researchData?: any }): string {
  if (!options?.researchData) return '';

  const { researchData } = options;
  const { topDeductionCounties, topPcrrOperators, topNetReturnOperators } = researchData;
  const fmt = (n: number) => n?.toLocaleString() ?? '—';
  const fmtCurrency = (n: number) => n != null ? '$' + Math.round(n).toLocaleString() : '—';

  let html = `
    <div class="section">
      <div class="section-title">Statewide Market Research — Deduction Trends</div>
      <p style="font-size: 10px; color: #64748b; margin-bottom: 16px;">Statewide deduction intelligence from Oklahoma Tax Commission gross production reports (last 6 months).</p>
    </div>`;

  // Top Deduction Counties
  if (topDeductionCounties?.length) {
    html += `
    <div class="section">
      <div class="section-title">Highest Deduction Counties</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>County</th>
            <th class="right">Wells</th>
            <th class="right">Avg Deduction %</th>
          </tr>
        </thead>
        <tbody>
          ${topDeductionCounties.map((c: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(c.county)}</td>
            <td class="right">${fmt(c.well_count)}</td>
            <td class="right ${c.avg_deduction_pct >= 50 ? 'danger' : c.avg_deduction_pct >= 35 ? 'warning' : ''}" style="font-weight: 600;">${c.avg_deduction_pct}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Most Efficient Operators (PCRR)
  if (topPcrrOperators?.length) {
    html += `
    <div class="section">
      <div class="section-title">Most Efficient Operators (Processing Cost Recovery Ratio)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Operator</th>
            <th class="right">Wells</th>
            <th class="right">PCRR</th>
          </tr>
        </thead>
        <tbody>
          ${topPcrrOperators.map((op: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(op.operator_name)}</td>
            <td class="right">${fmt(op.well_count)}</td>
            <td class="right" style="color: #059669; font-weight: 600;">${op.pcrr}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Highest Net Return Operators
  if (topNetReturnOperators?.length) {
    html += `
    <div class="section">
      <div class="section-title">Highest Net Value Return Operators</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Operator</th>
            <th class="right">Wells</th>
            <th class="right">Net Return</th>
          </tr>
        </thead>
        <tbody>
          ${topNetReturnOperators.map((op: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(op.operator_name)}</td>
            <td class="right">${fmt(op.well_count)}</td>
            <td class="right" style="color: #059669; font-weight: 600;">${fmtCurrency(op.net_value_return)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  return html;
}

function generateDeductionAuditPrintHtml(data: any, userName: string, options?: { tab?: string; researchData?: any }): string {
  const { flaggedWells, portfolio, summary } = data;
  const fmt = (n: number) => n?.toLocaleString() ?? '—';
  const fmtCurrency = (n: number) => n != null ? '$' + Math.round(n).toLocaleString() : '—';
  const fmtPct = (n: number) => n != null ? n + '%' : '—';

  // Top 15 wells for print summary
  const topWells = (flaggedWells || []).slice(0, 15);

  const wellRowsHtml = topWells.map((well: any, i: number) => {
    const pctClass = well.agg_deduction_pct >= 50 ? 'danger' : well.agg_deduction_pct >= 35 ? 'warning' : '';
    return `
      <tr class="${i % 2 !== 0 ? 'alt' : ''}">
        <td class="bold">${escapeHtml(well.well_name)}</td>
        <td>${escapeHtml(well.operator || '—')}</td>
        <td>${escapeHtml((well.county || '').replace(/^\d{3}-/, ''))}</td>
        <td class="right ${pctClass}">${fmtPct(well.agg_deduction_pct)}</td>
        <td class="right">${fmtCurrency(well.total_gross)}</td>
        <td class="right">${fmtCurrency(well.total_deductions)}</td>
      </tr>
    `;
  }).join('');

  // Build body content based on active tab
  let bodyContent = '';
  if (options?.tab === 'research') {
    bodyContent = generateDeductionResearchPrintSection(options);
  } else {
    bodyContent = `
    <div class="section">
      <div class="section-title">Portfolio Summary</div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Wells Analyzed</div>
          <div class="summary-value">${fmt(portfolio?.total_wells_analyzed || 0)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Portfolio Avg Rate</div>
          <div class="summary-value">${fmtPct(portfolio?.avg_deduction_pct)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Flagged Wells</div>
          <div class="summary-value ${summary?.flagged_count > 5 ? 'danger' : ''}">${fmt(summary?.flagged_count || 0)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Worst Rate</div>
          <div class="summary-value ${summary?.worst_deduction_pct >= 50 ? 'danger' : 'warning'}">${fmtPct(summary?.worst_deduction_pct)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Excess Deductions</div>
          <div class="summary-value danger">${fmtCurrency(summary?.total_excess_deductions)}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Wells Above 25% Deduction Rate (Top ${topWells.length})</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Well Name</th>
            <th>Operator</th>
            <th>County</th>
            <th class="right">Ded %</th>
            <th class="right">Gross Value</th>
            <th class="right">Deductions</th>
          </tr>
        </thead>
        <tbody>
          ${wellRowsHtml || '<tr><td colspan="6" style="text-align: center; color: #64748b;">No wells above threshold</td></tr>'}
        </tbody>
      </table>
      ${flaggedWells?.length > 15 ? `<p class="note">+ ${flaggedWells.length - 15} more wells. See full report online for complete data.</p>` : ''}
    </div>

    <div class="section">
      <div class="insight-box">
        <div class="insight-title">Recommended Action</div>
        <div class="insight-text">
          Your lease may contain a "market enhancement" or "no deductions" clause that restricts processing costs.
          Review your lease terms and, if warranted, send a formal inquiry to the operator requesting an itemized
          breakdown of deductions and citing specific lease provisions.
        </div>
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Residue Gas Deduction Audit Report - Mineral Watch</title>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 20px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .print-controls { max-width: 8.5in; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 12px; }
    .print-btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .print-btn.primary { background: #1C2B36; color: white; }
    .print-btn.primary:hover { background: #334E68; }
    .print-btn.secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
    .print-btn.secondary:hover { background: #f8fafc; }
    .print-container { width: 8.5in; min-height: 11in; margin: 0 auto; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1C2B36 0%, #334E68 100%); color: white; padding: 20px 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.5px; }
    .header .subtitle { font-size: 12px; opacity: 0.8; }
    .header .brand { text-align: right; }
    .header .brand-name { font-size: 20px; font-weight: 700; font-family: 'Merriweather', Georgia, serif; display: flex; align-items: center; gap: 6px; }
    .header .brand-url { font-size: 10px; opacity: 0.8; margin-top: 4px; }
    .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
    .section-title { font-size: 11px; font-weight: 700; color: #1C2B36; margin-bottom: 12px; letter-spacing: 0.5px; text-transform: uppercase; }
    .summary-grid { display: flex; gap: 24px; flex-wrap: wrap; }
    .summary-item { flex: 1; min-width: 120px; }
    .summary-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .summary-value { font-size: 20px; font-weight: 700; color: #1C2B36; }
    .summary-value.danger { color: #dc2626; }
    .summary-value.warning { color: #d97706; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .data-table th { padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #64748b; background: #f8fafc; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    .data-table th.right { text-align: right; }
    .data-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
    .data-table td.right { text-align: right; font-family: 'JetBrains Mono', monospace; }
    .data-table td.bold { font-weight: 600; color: #1C2B36; }
    .data-table tr.alt { background: #f8fafc; }
    .data-table .danger { color: #dc2626; font-weight: 600; }
    .data-table .warning { color: #d97706; font-weight: 600; }
    .insight-box { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; margin-top: 16px; }
    .insight-title { font-size: 10px; font-weight: 600; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .insight-text { font-size: 11px; color: #78350f; line-height: 1.5; }
    .footer { padding: 12px 24px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; background: #f8fafc; }
    .note { font-size: 9px; color: #64748b; margin-top: 8px; font-style: italic; }
    @media screen and (max-width: 768px) {
      body { padding: 8px; }
      .print-controls { flex-direction: column; align-items: stretch; max-width: 100%; }
      .print-btn { justify-content: center; }
      .print-container { width: 100%; min-height: auto; box-shadow: none; }
      .header { flex-direction: column; gap: 10px; padding: 16px; }
      .header .brand { text-align: left; }
      .header .brand-name { font-size: 17px; }
      .section { padding: 12px 14px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .summary-grid { gap: 12px; }
      .summary-item { min-width: 80px; }
      .summary-value { font-size: 16px; }
      .data-table { min-width: 540px; }
      .insight-box { margin-top: 12px; }
      .footer { flex-direction: column; gap: 4px; padding: 10px 14px; }
    }
    @media print {
      body { background: white; padding: 0; }
      .print-controls { display: none !important; }
      .print-container { box-shadow: none; width: 100%; }
    }
    @page { size: letter; margin: 0.25in; }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn secondary" onclick="window.close()">← Back to Dashboard</button>
    <button class="print-btn primary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      Print Report
    </button>
  </div>

  <div class="print-container">
    <div class="header">
      <div>
        <h1>RESIDUE GAS DEDUCTION AUDIT REPORT${options?.tab === 'research' ? ' — MARKET RESEARCH' : ''}</h1>
        <div class="subtitle">Analysis Period: ${summary?.analysis_period || '6 months'} ending ${formatReportMonth(summary?.latest_month || '')}</div>
      </div>
      <div class="brand">
        <div class="brand-name">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          MINERAL WATCH
        </div>
        <div class="brand-url">mymineralwatch.com</div>
      </div>
    </div>

    ${bodyContent}

    <div class="footer">
      <span>Generated by Mineral Watch • mymineralwatch.com • ${new Date().toLocaleDateString()}</span>
      <span>Data sourced from Oklahoma Tax Commission gross production reports</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * GET /print/intelligence/production-decline
 * Generates a print-friendly HTML page for the Production Decline report
 */
export async function handleProductionDeclinePrint(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) {
      const url = new URL(request.url);
      return Response.redirect(`/portal/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return new Response('User not found', { status: 404 });

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isIntelligenceAllowed(userOrgId)) {
      return new Response('Intelligence features not available for your account', { status: 403 });
    }

    // Check which tab to print
    const url = new URL(request.url);
    const tab = url.searchParams.get('tab') || 'properties';
    const researchView = url.searchParams.get('view') || 'decliners';

    // Fetch decline data and markets data in parallel
    const apiUrl = new URL('/api/intelligence/production-decline', request.url);
    const marketsUrl = new URL('/api/intelligence/production-decline/markets?bust=1', request.url);
    const fetchPromises: Promise<Response>[] = [
      handleGetProductionDecline(new Request(apiUrl.toString(), { method: 'GET', headers: request.headers }), env),
      handleGetProductionDeclineMarkets(new Request(marketsUrl.toString(), { method: 'GET', headers: request.headers }), env),
    ];

    // Also fetch research data if on research tab
    if (tab === 'research') {
      const researchUrl = new URL('/api/intelligence/production-decline/research', request.url);
      fetchPromises.push(
        handleGetDeclineResearch(new Request(researchUrl.toString(), { method: 'GET', headers: request.headers }), env)
      );
    }

    const responses = await Promise.all(fetchPromises);
    const data = await responses[0].json() as any;
    const marketsData = await responses[1].json() as any;
    const researchData = tab === 'research' ? await responses[2].json() as any : null;

    if (data.error) {
      return new Response(`Error: ${data.error}`, { status: 500 });
    }

    const html = generateProductionDeclinePrintHtml(data, userRecord.fields.Name || 'User', marketsData, { tab, researchView, researchData });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error) {
    console.error('[Production Decline Print] Error:', error);
    return new Response(`Error generating report: ${error instanceof Error ? error.message : 'Unknown'}`, { status: 500 });
  }
}

function generateProductionDeclinePrintHtml(data: any, userName: string, marketsData?: any, options?: { tab?: string; researchView?: string; researchData?: any }): string {
  const { latestDataMonth, summary, wells, monthlyTotals } = data;
  const fmt = (n: number) => n?.toLocaleString() ?? '—';

  // Sort wells by YoY ascending (steepest decline first), filter to those with YoY data
  const decliningWells = (wells || [])
    .filter((w: any) => w.yoyChangePct !== null && w.yoyChangePct < 0)
    .sort((a: any, b: any) => a.yoyChangePct - b.yoyChangePct)
    .slice(0, 15);

  // Generate chart SVG for monthly totals
  const chartSvg = generateTrendChartSvg(monthlyTotals || []);

  // Generate risk score bar chart from markets data
  const riskChartSvg = generateRiskChartSvg(marketsData?.counties || []);

  const wellRowsHtml = decliningWells.map((well: any, i: number) => {
    const yoyClass = well.yoyChangePct <= -20 ? 'danger' : 'warning';
    const statusClass = well.status === 'active' ? 'active' : 'idle';
    return `
      <tr class="${i % 2 !== 0 ? 'alt' : ''}">
        <td class="bold">${escapeHtml(well.wellName)}</td>
        <td>${escapeHtml(well.operator || '—')}</td>
        <td>${escapeHtml((well.county || '').replace(/^\d{3}-/, ''))}</td>
        <td class="center"><span class="type-badge">${well.isHorizontal ? 'H' : 'V'}</span></td>
        <td class="right">${fmt(well.recentOilBBL)}</td>
        <td class="right">${fmt(well.recentGasMCF)}</td>
        <td class="right ${yoyClass}">${well.yoyChangePct}%</td>
        <td class="center"><span class="status-badge ${statusClass}">${well.status === 'active' ? 'Active' : 'Idle'}</span></td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Production Decline Analysis - Mineral Watch</title>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 20px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .print-controls { max-width: 8.5in; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 12px; }
    .print-btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .print-btn.primary { background: #1C2B36; color: white; }
    .print-btn.primary:hover { background: #334E68; }
    .print-btn.secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
    .print-btn.secondary:hover { background: #f8fafc; }
    .print-container { width: 8.5in; min-height: 11in; margin: 0 auto; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1C2B36 0%, #334E68 100%); color: white; padding: 20px 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.5px; }
    .header .subtitle { font-size: 12px; opacity: 0.8; }
    .header .brand { text-align: right; }
    .header .brand-name { font-size: 20px; font-weight: 700; font-family: 'Merriweather', Georgia, serif; display: flex; align-items: center; gap: 6px; }
    .header .brand-url { font-size: 10px; opacity: 0.8; margin-top: 4px; }
    .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
    .section-title { font-size: 11px; font-weight: 700; color: #1C2B36; margin-bottom: 12px; letter-spacing: 0.5px; text-transform: uppercase; }
    .summary-grid { display: flex; gap: 24px; flex-wrap: wrap; }
    .summary-item { flex: 1; min-width: 100px; }
    .summary-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .summary-value { font-size: 20px; font-weight: 700; color: #1C2B36; }
    .summary-value.danger { color: #dc2626; }
    .summary-value.warning { color: #d97706; }
    .summary-value.success { color: #059669; }
    .summary-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .chart-container { margin: 12px 0; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .data-table th { padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #64748b; background: #f8fafc; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    .data-table th.right { text-align: right; }
    .data-table th.center { text-align: center; }
    .data-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
    .data-table td.right { text-align: right; font-family: 'JetBrains Mono', monospace; }
    .data-table td.center { text-align: center; }
    .data-table td.bold { font-weight: 600; color: #1C2B36; }
    .data-table tr.alt { background: #f8fafc; }
    .data-table .danger { color: #dc2626; font-weight: 600; }
    .data-table .warning { color: #d97706; font-weight: 600; }
    .type-badge { display: inline-block; width: 20px; height: 20px; line-height: 20px; text-align: center; border-radius: 4px; font-size: 10px; font-weight: 700; background: #e2e8f0; color: #475569; }
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 600; text-transform: uppercase; }
    .status-badge.active { background: #dcfce7; color: #166534; }
    .status-badge.idle { background: #f3f4f6; color: #6b7280; }
    .footer { padding: 12px 24px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; background: #f8fafc; }
    .note { font-size: 9px; color: #64748b; margin-top: 8px; font-style: italic; }
    @media screen and (max-width: 768px) {
      body { padding: 8px; }
      .print-controls { flex-direction: column; align-items: stretch; max-width: 100%; }
      .print-btn { justify-content: center; }
      .print-container { width: 100%; min-height: auto; box-shadow: none; }
      .header { flex-direction: column; gap: 10px; padding: 16px; }
      .header .brand { text-align: left; }
      .header .brand-name { font-size: 17px; }
      .section { padding: 12px 14px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .summary-grid { gap: 12px; }
      .summary-item { min-width: 80px; }
      .summary-value { font-size: 16px; }
      .data-table { min-width: 540px; }
      .chart-container svg { max-width: 100%; height: auto; }
      .footer { flex-direction: column; gap: 4px; padding: 10px 14px; }
    }
    @media print {
      body { background: white; padding: 0; }
      .print-controls { display: none !important; }
      .print-container { box-shadow: none; width: 100%; }
    }
    @page { size: letter; margin: 0.25in; }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn secondary" onclick="window.close()">← Back to Dashboard</button>
    <button class="print-btn primary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      Print Report
    </button>
  </div>

  <div class="print-container">
    <div class="header">
      <div>
        <h1>PRODUCTION DECLINE ANALYSIS${options?.tab === 'research' ? ' — MARKET RESEARCH' : ''}</h1>
        <div class="subtitle">Production through ${formatReportMonth(latestDataMonth || '')}</div>
      </div>
      <div class="brand">
        <div class="brand-name">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          MINERAL WATCH
        </div>
        <div class="brand-url">mymineralwatch.com</div>
      </div>
    </div>

    ${options?.tab === 'research' ? generateDeclineResearchPrintSection(options) : `
    <div class="section">
      <div class="section-title">Portfolio Summary</div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Total Wells</div>
          <div class="summary-value">${fmt(summary?.totalWells || 0)}</div>
          <div class="summary-sub">${fmt(summary?.activeWells || 0)} active / ${fmt(summary?.idleWells || 0)} idle</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Portfolio Oil</div>
          <div class="summary-value">${fmt(summary?.portfolioOilBBL || 0)}</div>
          <div class="summary-sub">BBL (most recent)</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Portfolio Gas</div>
          <div class="summary-value">${fmt(summary?.portfolioGasMCF || 0)}</div>
          <div class="summary-sub">MCF (most recent)</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Wells Declining</div>
          <div class="summary-value warning">${fmt(summary?.wellsInDecline || 0)}</div>
          <div class="summary-sub">YoY production down</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Steep Decline</div>
          <div class="summary-value danger">${fmt(summary?.wellsSteepDecline || 0)}</div>
          <div class="summary-sub">YoY down 20%+</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Portfolio Production Trend (18 Months)</div>
      <div class="chart-container">${chartSvg}</div>
    </div>

    ${riskChartSvg ? `
    <div class="section">
      <div class="section-title">Asset Intervention Priority (Risk Score)</div>
      <div style="font-size: 9px; color: #64748b; margin-bottom: 8px;">Wells x Performance Gap — higher scores indicate more portfolio impact. Red = underperforming, Green = outperforming county median.</div>
      <div class="chart-container">${riskChartSvg}</div>
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">Wells in Decline — 24-Month YoY Analysis (Top ${decliningWells.length})</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Well Name</th>
            <th>Operator</th>
            <th>County</th>
            <th class="center">Type</th>
            <th class="right">Oil (BBL)</th>
            <th class="right">Gas (MCF)</th>
            <th class="right">YoY</th>
            <th class="center">Status</th>
          </tr>
        </thead>
        <tbody>
          ${wellRowsHtml || '<tr><td colspan="8" style="text-align: center; color: #64748b;">No declining wells found</td></tr>'}
        </tbody>
      </table>
      ${(wells || []).filter((w: any) => w.yoyChangePct !== null && w.yoyChangePct < 0).length > 15 ? `<p class="note">+ more wells in decline. See full report online for complete data.</p>` : ''}
    </div>
    `}

    <div class="footer">
      <span>Generated by Mineral Watch • mymineralwatch.com • ${new Date().toLocaleDateString()}</span>
      <span>Data sourced from Oklahoma Tax Commission production reports</span>
    </div>
  </div>
</body>
</html>`;
}

function generateTrendChartSvg(monthlyTotals: Array<{ yearMonth: string; totalBOE: number }>): string {
  if (!monthlyTotals || monthlyTotals.length === 0) {
    return '<div style="padding: 20px; text-align: center; color: #64748b; font-size: 12px;">No production data available</div>';
  }

  const data = monthlyTotals;
  const padding = { top: 25, right: 50, bottom: 35, left: 60 };
  const width = 700;
  const height = 140;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxBOE = Math.max(...data.map(d => d.totalBOE), 1);
  const yScale = (val: number) => chartHeight - (val / maxBOE) * chartHeight;
  const xScale = (i: number) => data.length === 1 ? chartWidth / 2 : (i / (data.length - 1)) * chartWidth;

  // Calculate 3-month moving average for trend/smoothing line
  const calcMovingAvg = (values: number[], windowSize: number = 3): number[] => {
    return values.map((_, i) => {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(values.length, i + Math.ceil(windowSize / 2));
      const window = values.slice(start, end);
      return window.reduce((sum, v) => sum + v, 0) / window.length;
    });
  };

  const boeTrend = calcMovingAvg(data.map(d => d.totalBOE));

  let svg = `<svg viewBox="0 0 ${width} ${height}" style="display: block; width: 100%; height: auto;">`;
  svg += `<g transform="translate(${padding.left}, ${padding.top})">`;

  // Grid lines
  [0, 0.5, 1].forEach(tick => {
    svg += `<line x1="0" y1="${chartHeight * (1 - tick)}" x2="${chartWidth}" y2="${chartHeight * (1 - tick)}" stroke="#e2e8f0" stroke-width="1" ${tick !== 0 ? 'stroke-dasharray="4,4"' : ''}/>`;
  });

  // Y-axis labels
  const ticks = [0, maxBOE * 0.5, maxBOE];
  ticks.forEach(tick => {
    const label = tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : tick.toFixed(0);
    svg += `<text x="-8" y="${yScale(tick) + 4}" text-anchor="end" font-size="9" fill="#059669">${label}</text>`;
  });

  // X-axis labels - show every 3rd for 18 months to avoid crowding
  const labelStep = data.length > 12 ? 3 : 2;
  data.forEach((d, i) => {
    if (i % labelStep === 0 || i === data.length - 1) {
      const month = parseInt(d.yearMonth.substring(4, 6));
      const year = d.yearMonth.substring(2, 4);
      const label = `${MONTH_ABBR[month - 1]} '${year}`;
      svg += `<text x="${xScale(i)}" y="${chartHeight + 18}" text-anchor="middle" font-size="8" fill="#64748b">${label}</text>`;
    }
  });

  if (data.length > 1) {
    // Draw smoothing/trend line FIRST (behind main line) - thicker, semi-transparent
    const trendPath = boeTrend.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(v)}`).join(' ');
    svg += `<path d="${trendPath}" fill="none" stroke="#059669" stroke-width="6" stroke-opacity="0.25" stroke-linecap="round" stroke-linejoin="round"/>`;

    // Main line path on top
    const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.totalBOE)}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="#059669" stroke-width="2"/>`;
  }

  // Data points
  data.forEach((d, i) => {
    svg += `<circle cx="${xScale(i)}" cy="${yScale(d.totalBOE)}" r="4" fill="#059669"/>`;
  });

  // Axis label
  svg += `<text x="-35" y="-12" font-size="9" fill="#059669" font-weight="600">BOE</text>`;

  // Note about period
  svg += `<text x="${chartWidth / 2}" y="${chartHeight + 30}" text-anchor="middle" font-size="8" fill="#94a3b8">${data.length} months shown</text>`;

  svg += '</g></svg>';
  return svg;
}

function generateRiskChartSvg(counties: any[]): string {
  if (!counties || counties.length === 0) return '';

  // Compute risk scores: wells x negative delta (positive score = underperforming = risk)
  const scores = counties
    .filter((c: any) => c.userVsCountyDelta != null && c.userWellCount > 0)
    .map((c: any) => ({
      county: c.county,
      score: Math.round(-c.userVsCountyDelta * c.userWellCount),
      delta: c.userVsCountyDelta,
      wells: c.userWellCount
    }))
    .sort((a, b) => b.score - a.score); // Highest risk first

  if (scores.length < 2) return '';

  const maxAbsScore = Math.max(...scores.map(s => Math.abs(s.score)), 1);

  const barHeight = 18;
  const barGap = 4;
  const labelWidth = 80;
  const valueWidth = 50;
  const chartAreaWidth = 500;
  const centerX = labelWidth + chartAreaWidth / 2;
  const totalWidth = labelWidth + chartAreaWidth + valueWidth + 10;
  const totalHeight = scores.length * (barHeight + barGap) + 10;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" style="display: block; width: 100%; height: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">`;

  // Center line
  svg += `<line x1="${centerX}" y1="0" x2="${centerX}" y2="${totalHeight}" stroke="#e2e8f0" stroke-width="1"/>`;

  scores.forEach((s, i) => {
    const y = i * (barHeight + barGap) + 2;
    const barWidthPx = (Math.abs(s.score) / maxAbsScore) * (chartAreaWidth / 2);
    const isRisk = s.score > 0;
    const color = s.score > 0 ? '#dc2626' : (s.score < 0 ? '#059669' : '#d97706');

    // County label
    svg += `<text x="${labelWidth - 6}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-size="9" font-weight="500" fill="#334155">${escapeHtml(s.county)}</text>`;

    // Bar
    if (s.score >= 0) {
      svg += `<rect x="${centerX}" y="${y + 1}" width="${barWidthPx}" height="${barHeight - 2}" rx="2" fill="${color}"/>`;
    } else {
      svg += `<rect x="${centerX - barWidthPx}" y="${y + 1}" width="${barWidthPx}" height="${barHeight - 2}" rx="2" fill="${color}"/>`;
    }

    // Value label
    svg += `<text x="${labelWidth + chartAreaWidth + 6}" y="${y + barHeight / 2 + 4}" font-size="8" font-weight="700" fill="${color}" font-family="'JetBrains Mono', monospace">${s.score}</text>`;
  });

  svg += '</svg>';
  return svg;
}

function getDeclineColorPrint(rate: number): string {
  if (rate > -10) return '#059669';    // Green — outperforming basin
  if (rate > -35) return '#d97706';    // Yellow — normal basin range
  if (rate > -60) return '#f97316';    // Orange — significantly underperforming
  return '#dc2626';                     // Red — alarming decline
}

function generateDeclineResearchPrintSection(options?: { tab?: string; researchView?: string; researchData?: any }): string {
  if (!options || options.tab !== 'research' || !options.researchData) return '';

  const { researchData, researchView } = options;
  const { summary, operatorsByDecline, operatorsByGrowth, counties } = researchData;
  const fmt = (n: number) => n?.toLocaleString() ?? '—';

  const horizonStr = summary?.dataHorizon
    ? (() => { const m = parseInt(summary.dataHorizon.substring(4, 6)); const y = summary.dataHorizon.substring(0, 4); return `${MONTH_ABBR[m - 1]} ${y}`; })()
    : '';

  // HUD cards — always shown
  let html = `
    <div class="section">
      <div class="section-title">Statewide Market Research — Production Decline</div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Statewide Avg Decline</div>
          <div class="summary-value" style="color: ${getDeclineColorPrint(summary?.avgDecline || 0)}">${summary?.avgDecline ?? '—'}%</div>
          <div class="summary-sub">BOE YoY (active wells)</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Steep Decline (&gt;25%)</div>
          <div class="summary-value danger">${fmt(summary?.steepDecline || 0)}</div>
          <div class="summary-sub">wells declining &gt;25% YoY</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Growing Production</div>
          <div class="summary-value success">${fmt(summary?.growingWells || 0)}</div>
          <div class="summary-sub">wells with positive YoY</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Active PUNs</div>
          <div class="summary-value">${fmt(summary?.activePuns || 0)}</div>
          <div class="summary-sub">statewide${horizonStr ? ` • data thru ${horizonStr}` : ''}</div>
        </div>
      </div>
    </div>`;

  // View-specific section
  if (researchView === 'decliners' && operatorsByDecline?.length) {
    html += `
    <div class="section">
      <div class="section-title">Steepest Declining Operators (Min 20 Active Wells)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Operator</th>
            <th class="right">Active Wells</th>
            <th class="right">Avg Decline</th>
          </tr>
        </thead>
        <tbody>
          ${operatorsByDecline.map((op: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(op.operator)}</td>
            <td class="right">${fmt(op.activeWells)}</td>
            <td class="right" style="color: ${getDeclineColorPrint(op.avgDecline)}; font-weight: 600;">${op.avgDecline > 0 ? '+' : ''}${op.avgDecline}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } else if (researchView === 'growers' && operatorsByGrowth?.length) {
    html += `
    <div class="section">
      <div class="section-title">Top Growing Operators (Min 20 Active Wells)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Operator</th>
            <th class="right">Active Wells</th>
            <th class="right">Avg Decline</th>
          </tr>
        </thead>
        <tbody>
          ${operatorsByGrowth.map((op: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(op.operator)}</td>
            <td class="right">${fmt(op.activeWells)}</td>
            <td class="right" style="color: ${getDeclineColorPrint(op.avgDecline)}; font-weight: 600;">${op.avgDecline > 0 ? '+' : ''}${op.avgDecline}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } else if (researchView === 'counties' && counties?.length) {
    // Sort by decline rate for print
    const sorted = [...counties].sort((a: any, b: any) => a.avgDecline - b.avgDecline);
    html += `
    <div class="section">
      <div class="section-title">County Production Trends (Min 10 Active Wells)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>County</th>
            <th class="right">Active Wells</th>
            <th class="right">Avg Decline</th>
            <th class="right">Declining</th>
            <th class="right">Growing</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((c: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td class="bold">${escapeHtml(c.county)}</td>
            <td class="right">${fmt(c.activeWells)}</td>
            <td class="right" style="color: ${getDeclineColorPrint(c.avgDecline)}; font-weight: 600;">${c.avgDecline > 0 ? '+' : ''}${c.avgDecline}%</td>
            <td class="right">${fmt(c.decliningWells)}</td>
            <td class="right">${fmt(c.growingWells)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  return html;
}

// =============================================
// SHUT-IN DETECTOR
// =============================================

// Tunable thresholds — adjust after launch based on flagging rates
const HBP_MONTHS_THRESHOLD = 60;        // Flag wells with first production within this many months
const SUDDEN_STOP_BOE_THRESHOLD = 50;   // Avg monthly BOE before stop to qualify as "sudden"
const OPERATOR_IDLE_PCT_THRESHOLD = 0.5; // >50% idle wells triggers operator pattern flag
const OPERATOR_MIN_WELLS = 3;            // Minimum wells per operator to evaluate pattern

interface ShutInWell {
  clientWellId: string;
  wellName: string;
  apiNumber: string;
  operator: string;
  county: string;
  wellType: string;
  pun: string | null;
  status: 'recently_idle' | 'extended_idle' | 'no_recent_production' | 'no_data';
  monthsIdle: number;
  lastProdMonth: string | null;
  firstProdMonth: string | null;
  peakMonth: string | null;
  declineRate12m: number | null;
  riskFlags: string[];
  taxPeriodStart: string | null;
  taxPeriodEnd: string | null;      // Latest ended period_end_date (if all periods ended)
  taxPeriodActive: boolean | null;   // true if any tax period is_active=1, false if all ended, null if no tax data
}

/**
 * GET /api/intelligence/shut-in-detector
 *
 * Identifies idle/shut-in wells in user's portfolio with risk flags:
 * - HBP Risk: well within 5 years of first production and idle
 * - Sudden Stop: significant production dropped to zero
 * - Operator Pattern: >50% of operator's wells are idle
 */
export async function handleGetShutInDetector(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    // Check KV cache
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`shut-in-detector:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Shut-In Detector] Cache read error:', e);
      }
    }

    // Step 1: Get ALL user wells with puns data (need all for operator pattern calc)
    const allWellsQuery = `
      SELECT cw.id as client_well_id, cw.api_number, cw.well_name as cw_well_name,
             w.well_name as w_well_name, w.operator, w.county, w.well_type,
             w.spud_date, w.completion_date,
             wpl.pun,
             p.is_stale, p.months_since_production,
             p.first_prod_month, p.last_prod_month,
             p.peak_month, p.decline_rate_12m,
             tp.period_start_date as tp_start_date,
             tp.max_is_active as tp_is_active,
             tp.latest_end_date as tp_end_date,
             (SELECT ol.operator_number FROM otc_leases ol WHERE ol.pun = wpl.pun AND ol.operator_number IS NOT NULL LIMIT 1) as operator_number
      FROM client_wells cw
      JOIN wells w ON w.api_number = cw.api_number
      LEFT JOIN well_pun_links wpl ON wpl.api_number = cw.api_number
      LEFT JOIN puns p ON p.pun = wpl.pun
      LEFT JOIN (
        SELECT pun,
               MIN(period_start_date) as period_start_date,
               MAX(is_active) as max_is_active,
               MAX(CASE WHEN is_active = 0 THEN period_end_date END) as latest_end_date
        FROM otc_pun_tax_periods
        GROUP BY pun
      ) tp ON tp.pun = wpl.pun
      WHERE (cw.organization_id = ? OR cw.user_id = ? OR cw.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))
    `;

    console.log('[Shut-In Detector] Querying wells for user:', authUser.id, 'org:', userOrgId || 'none');

    const allWellsResult = await env.WELLS_DB!.prepare(allWellsQuery)
      .bind(userOrgId || '', authUser.id, userOrgId || '')
      .all();

    console.log('[Shut-In Detector] Query returned', allWellsResult.results.length, 'rows');

    const allRows = allWellsResult.results as Array<{
      client_well_id: string;
      api_number: string;
      cw_well_name: string | null;
      w_well_name: string | null;
      operator: string | null;
      county: string | null;
      well_type: string | null;
      spud_date: string | null;
      completion_date: string | null;
      pun: string | null;
      is_stale: number | null;
      months_since_production: number | null;
      first_prod_month: string | null;
      last_prod_month: string | null;
      peak_month: string | null;
      decline_rate_12m: number | null;
      tp_start_date: string | null;
      tp_is_active: number | null;
      tp_end_date: string | null;
      operator_number: string | null;
    }>;

    // Deduplicate by api_number (a well may have multiple PUNs — take the one with latest production)
    const wellsByApi = new Map<string, typeof allRows[0]>();
    for (const row of allRows) {
      const existing = wellsByApi.get(row.api_number);
      if (!existing) {
        wellsByApi.set(row.api_number, row);
      } else {
        // Keep the row with more recent last_prod_month
        if (row.last_prod_month && (!existing.last_prod_month || row.last_prod_month > existing.last_prod_month)) {
          wellsByApi.set(row.api_number, row);
        }
      }
    }

    const allWells = Array.from(wellsByApi.values());

    console.log('[Shut-In Detector] Deduped to', allWells.length, 'unique wells');

    // Step 2: Classify all wells and compute operator stats
    const operatorStats = new Map<string, { total: number; idle: number }>();
    const idleWells: typeof allRows = [];

    for (const well of allWells) {
      const months = well.months_since_production;
      const operator = well.operator || 'Unknown';

      if (!operatorStats.has(operator)) {
        operatorStats.set(operator, { total: 0, idle: 0 });
      }
      const stats = operatorStats.get(operator)!;
      stats.total++;

      // Idle = 3+ months since production OR no production data at all
      const isIdle = (months !== null && months >= 3) || (well.last_prod_month === null && well.pun !== null) || well.pun === null;

      if (isIdle) {
        stats.idle++;
        idleWells.push(well);
      }
    }

    // Step 3: Compute operator pattern flags
    const flaggedOperators = new Set<string>();
    for (const [operator, stats] of operatorStats) {
      if (stats.total >= OPERATOR_MIN_WELLS && (stats.idle / stats.total) > OPERATOR_IDLE_PCT_THRESHOLD) {
        flaggedOperators.add(operator);
      }
    }

    // Step 4: HBP Risk flag — wells with first production within threshold months
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    function monthsDiff(ym1: string, ym2: string): number {
      const y1 = parseInt(ym1.substring(0, 4));
      const m1 = parseInt(ym1.substring(4, 6));
      const y2 = parseInt(ym2.substring(0, 4));
      const m2 = parseInt(ym2.substring(4, 6));
      return (y2 - y1) * 12 + (m2 - m1);
    }

    console.log('[Shut-In Detector] Idle wells:', idleWells.length, 'Flagged operators:', flaggedOperators.size);

    // Step 5: Sudden Production Stop — need production history for idle wells
    // Collect PUNs for the secondary query
    const idlePuns = idleWells
      .filter(w => w.pun && w.last_prod_month)
      .map(w => ({ pun: w.pun!, lastProdMonth: w.last_prod_month! }));

    const suddenStopPuns = new Set<string>();

    console.log('[Shut-In Detector] Idle PUNs to check for sudden stop:', idlePuns.length);

    try {
      if (idlePuns.length > 0) {
        // Find earliest last_prod_month to scope the query
        const earliestLastProd = idlePuns.reduce((min, p) => p.lastProdMonth < min ? p.lastProdMonth : min, idlePuns[0].lastProdMonth);
        // Go 12 months before the earliest last_prod_month
        const earlyYear = parseInt(earliestLastProd.substring(0, 4));
        const earlyMonth = parseInt(earliestLastProd.substring(4, 6));
        let lookbackMonth = earlyMonth - 12;
        let lookbackYear = earlyYear;
        if (lookbackMonth <= 0) {
          lookbackMonth += 12;
          lookbackYear -= 1;
        }
        const lookbackStart = `${lookbackYear}${String(lookbackMonth).padStart(2, '0')}`;

        // Batch query production data for idle PUNs
        const punList = [...new Set(idlePuns.map(p => p.pun))];
        console.log('[Shut-In Detector] Querying production for', punList.length, 'unique PUNs, lookback from', lookbackStart);
        const punProdMap = new Map<string, Array<{ year_month: string; boe: number }>>();

        // Limit batch size to 100 to avoid D1 query timeouts on otc_production (7M+ rows)
        const BATCH_SIZE = 100;
        for (let i = 0; i < punList.length; i += BATCH_SIZE) {
          const batch = punList.slice(i, i + BATCH_SIZE);
          const placeholders = batch.map(() => '?').join(',');
          const prodResult = await env.WELLS_DB!.prepare(`
            SELECT pun, year_month,
                   COALESCE(SUM(CASE WHEN product_code IN ('1','3') THEN gross_volume ELSE 0 END), 0) +
                   COALESCE(SUM(CASE WHEN product_code IN ('5','6') THEN gross_volume ELSE 0 END), 0) / 6.0 as boe
            FROM otc_production
            WHERE pun IN (${placeholders})
              AND year_month >= ?
            GROUP BY pun, year_month
          `).bind(...batch, lookbackStart).all();

          for (const row of prodResult.results as Array<{ pun: string; year_month: string; boe: number }>) {
            if (!punProdMap.has(row.pun)) {
              punProdMap.set(row.pun, []);
            }
            punProdMap.get(row.pun)!.push({ year_month: row.year_month, boe: row.boe });
          }
        }

        console.log('[Shut-In Detector] Production data retrieved for', punProdMap.size, 'PUNs');

        // For each idle PUN, compute avg monthly BOE in the 12 months ending at last_prod_month
        for (const { pun, lastProdMonth } of idlePuns) {
          const prodData = punProdMap.get(pun);
          if (!prodData) continue;

          // Filter to 12 months ending at lastProdMonth
          const lpYear = parseInt(lastProdMonth.substring(0, 4));
          const lpMonth = parseInt(lastProdMonth.substring(4, 6));
          let startMonth = lpMonth - 11;
          let startYear = lpYear;
          if (startMonth <= 0) {
            startMonth += 12;
            startYear -= 1;
          }
          const windowStart = `${startYear}${String(startMonth).padStart(2, '0')}`;

          const windowData = prodData.filter(d => d.year_month >= windowStart && d.year_month <= lastProdMonth);
          if (windowData.length === 0) continue;

          const avgBoe = windowData.reduce((sum, d) => sum + d.boe, 0) / windowData.length;
          if (avgBoe > SUDDEN_STOP_BOE_THRESHOLD) {
            suddenStopPuns.add(pun);
          }
        }
      }
    } catch (suddenStopError) {
      console.error('[Shut-In Detector] Sudden stop query error (continuing without flag):', suddenStopError instanceof Error ? suddenStopError.message : suddenStopError);
    }

    // Step 6: Build final well list with flags
    const shutInWells: ShutInWell[] = [];
    let hbpRiskCount = 0;
    let recentlyIdleCount = 0;
    let extendedIdleCount = 0;
    let noRecentProdCount = 0;
    let noDataCount = 0;

    for (const well of idleWells) {
      const months = well.months_since_production;
      let status: ShutInWell['status'];

      if (well.last_prod_month === null) {
        // No production data and no tax period info
        status = 'no_data';
        noDataCount++;
      } else if (months !== null && months >= 12) {
        status = 'no_recent_production';
        noRecentProdCount++;
      } else if (months >= 6) {
        status = 'extended_idle';
        extendedIdleCount++;
      } else {
        status = 'recently_idle';
        recentlyIdleCount++;
      }

      const riskFlags: string[] = [];

      // HBP Risk
      if (well.first_prod_month) {
        const wellAge = monthsDiff(well.first_prod_month, currentYearMonth);
        if (wellAge <= HBP_MONTHS_THRESHOLD) {
          riskFlags.push('HBP Risk');
          hbpRiskCount++;
        }
      }

      // Sudden Stop
      if (well.pun && suddenStopPuns.has(well.pun)) {
        riskFlags.push('Sudden Stop');
      }

      // Operator Pattern
      if (well.operator && flaggedOperators.has(well.operator)) {
        riskFlags.push('Operator Pattern');
      }

      shutInWells.push({
        clientWellId: well.client_well_id,
        wellName: well.w_well_name || well.cw_well_name || `API ${well.api_number}`,
        apiNumber: well.api_number,
        operator: well.operator || 'Unknown',
        operatorNumber: well.operator_number || null,
        county: well.county || 'Unknown',
        wellType: well.well_type || 'Unknown',
        pun: well.pun,
        status,
        monthsIdle: months ?? 999,
        lastProdMonth: well.last_prod_month,
        firstProdMonth: well.first_prod_month,
        peakMonth: well.peak_month,
        declineRate12m: well.decline_rate_12m,
        riskFlags,
        taxPeriodStart: well.tp_start_date,
        taxPeriodEnd: well.tp_end_date,
        taxPeriodActive: well.tp_is_active !== null ? well.tp_is_active === 1 : null
      });
    }

    console.log('[Shut-In Detector] Built', shutInWells.length, 'shut-in wells. HBP:', hbpRiskCount, 'Recent:', recentlyIdleCount, 'Extended:', extendedIdleCount, 'NoRecent:', noRecentProdCount, 'NoData:', noDataCount, 'Sudden stops:', suddenStopPuns.size);

    const responseData = {
      summary: {
        totalIdle: shutInWells.length,
        hbpRisk: hbpRiskCount,
        recentlyIdle: recentlyIdleCount,
        extendedIdle: extendedIdleCount,
        noRecentProd: noRecentProdCount,
        noData: noDataCount
      },
      wells: shutInWells,
      generatedAt: new Date().toISOString()
    };

    // Cache the result
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(
          `shut-in-detector:${cacheId}`,
          JSON.stringify(responseData),
          { expirationTtl: 3600 }
        );
      } catch (e) {
        console.error('[Shut-In Detector] Cache write error:', e);
      }
    }

    return jsonResponse(responseData);
  } catch (error) {
    console.error('[Shut-In Detector] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({ error: 'Failed to generate shut-in analysis' }, 500);
  }
}

/**
 * GET /print/intelligence/shut-in-detector
 * Generates a print-friendly HTML page for the Shut-In Detector report
 */
export async function handleShutInDetectorPrint(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) {
      const url = new URL(request.url);
      return Response.redirect(`/portal/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return new Response('User not found', { status: 404 });

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isIntelligenceAllowed(userOrgId)) {
      return new Response('Intelligence features not available for your account', { status: 403 });
    }

    // Check which tab to print
    const url = new URL(request.url);
    const tab = url.searchParams.get('tab') || 'properties';
    const researchView = url.searchParams.get('view') || 'byCount';

    // Fetch data using internal API call pattern (reuse cache)
    const apiUrl = new URL('/api/intelligence/shut-in-detector', request.url);
    const apiRequest = new Request(apiUrl.toString(), {
      method: 'GET',
      headers: request.headers
    });
    const fetchPromises: Promise<Response>[] = [
      handleGetShutInDetector(apiRequest, env),
    ];

    // Also fetch research data if on research tab
    if (tab === 'research') {
      const researchUrl = new URL('/api/intelligence/shut-in-detector/research', request.url);
      fetchPromises.push(
        handleGetShutInResearch(new Request(researchUrl.toString(), { method: 'GET', headers: request.headers }), env)
      );
    }

    const responses = await Promise.all(fetchPromises);
    const data = await responses[0].json() as any;
    const researchData = tab === 'research' ? await responses[1].json() as any : null;

    if (data.error) {
      return new Response(`Error: ${data.error}`, { status: 500 });
    }

    const html = generateShutInDetectorPrintHtml(data, userRecord.fields.Name || 'User', { tab, researchView, researchData });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error) {
    console.error('[Shut-In Detector Print] Error:', error);
    return new Response(`Error generating report: ${error instanceof Error ? error.message : 'Unknown'}`, { status: 500 });
  }
}

function generateShutInDonutSvg(total: number, recentlyIdle: number, extendedIdle: number, noRecentProd: number): string {
  if (total === 0) return '';

  const r = 52;
  const stroke = 18;
  const cx = 70;
  const cy = 70;
  const circumference = 2 * Math.PI * r;

  const segments = [
    { label: 'Idle (3–6 mo)', count: recentlyIdle, color: '#f59e0b' },
    { label: 'Extended Idle (6–12 mo)', count: extendedIdle, color: '#f97316' },
    { label: 'Long-Term Idle (12+ mo)', count: noRecentProd, color: '#ef4444' }
  ].filter(s => s.count > 0);

  let offset = 0;
  const arcs = segments.map(seg => {
    const pct = seg.count / total;
    const len = pct * circumference;
    const arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${stroke}" stroke-dasharray="${len.toFixed(2)} ${(circumference - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
    return arc;
  });

  // Legend items positioned to the right of the donut
  const legendX = 165;
  const legendStartY = 22;
  const legendItems = segments.map((seg, i) => {
    const y = legendStartY + i * 22;
    const pct = Math.round((seg.count / total) * 100);
    return `<rect x="${legendX}" y="${y}" width="10" height="10" rx="2" fill="${seg.color}"/>
      <text x="${legendX + 16}" y="${y + 9}" font-size="10" fill="#475569">${escapeHtml(seg.label)}</text>
      <text x="${legendX + 195}" y="${y + 9}" font-size="10" font-weight="600" fill="#1C2B36" text-anchor="end">${seg.count}</text>
      <text x="${legendX + 230}" y="${y + 9}" font-size="10" fill="#64748b" text-anchor="end">${pct}%</text>`;
  }).join('\n');

  return `<svg viewBox="0 0 400 140" style="display: block; width: 100%; max-width: 400px; height: auto; margin: 0 auto;">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="${stroke}"/>
    ${arcs.join('\n')}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22" font-weight="700" fill="#1C2B36">${total}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="#64748b">idle wells</text>
    ${legendItems}
  </svg>`;
}

function getIdleRateColor(rate: number): string {
  if (rate < 15) return '#059669';     // Green — low idle rate
  if (rate < 30) return '#d97706';     // Yellow — moderate
  if (rate < 50) return '#f97316';     // Orange — high
  return '#dc2626';                     // Red — very high
}

function generateShutInResearchPrintSection(options?: { tab?: string; researchView?: string; researchData?: any }): string {
  if (!options?.researchData) return '';

  const { researchData, researchView } = options;
  const { summary, operatorsByCount, operatorsByRate, counties } = researchData;
  const fmt = (n: number) => n?.toLocaleString() ?? '—';

  const horizonStr = summary?.dataHorizon
    ? (() => { const m = parseInt(summary.dataHorizon.substring(4, 6)); const y = summary.dataHorizon.substring(0, 4); return `${MONTH_ABBR[m - 1]} ${y}`; })()
    : '';

  const idleRatePct = summary?.idleRatePct || 0;

  // HUD cards — always shown
  let html = `
    <div class="section">
      <div class="section-title">Statewide Market Research — Shut-In / Idle Wells</div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Statewide Idle Rate</div>
          <div class="summary-value" style="color: ${getIdleRateColor(idleRatePct)}">${idleRatePct}%</div>
          <div class="summary-sub">${fmt(summary?.idlePuns || 0)} of ${fmt(summary?.totalPuns || 0)} PUNs</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Recently Idle (3-6 mo)</div>
          <div class="summary-value warning">${fmt(summary?.recentlyIdle || 0)}</div>
          <div class="summary-sub">newly went idle</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Extended Idle (6-12 mo)</div>
          <div class="summary-value danger">${fmt(summary?.extendedIdle || 0)}</div>
          <div class="summary-sub">idle 6+ months</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Long-Term Idle (12+ mo)</div>
          <div class="summary-value danger">${fmt(summary?.longTermIdle || 0)}</div>
          <div class="summary-sub">${horizonStr ? `data thru ${horizonStr}` : ''}</div>
        </div>
      </div>
    </div>`;

  // View-specific section
  if (researchView === 'byCount' && operatorsByCount?.length) {
    html += `
    <div class="section">
      <div class="section-title">Operators with Most Idle Wells (Min 50 Total Wells)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Operator</th>
            <th class="right">Total Wells</th>
            <th class="right">Idle Wells</th>
            <th class="right">Idle Rate</th>
          </tr>
        </thead>
        <tbody>
          ${operatorsByCount.map((op: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(op.operator)}</td>
            <td class="right">${fmt(op.totalWells)}</td>
            <td class="right">${fmt(op.idleWells)}</td>
            <td class="right" style="color: ${getIdleRateColor(op.idleRatePct)}; font-weight: 600;">${op.idleRatePct}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } else if (researchView === 'byRate' && operatorsByRate?.length) {
    html += `
    <div class="section">
      <div class="section-title">Operators with Highest Idle Rate (Min 50 Total Wells)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Operator</th>
            <th class="right">Total Wells</th>
            <th class="right">Idle Wells</th>
            <th class="right">Idle Rate</th>
          </tr>
        </thead>
        <tbody>
          ${operatorsByRate.map((op: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td style="color: #64748b;">${i + 1}</td>
            <td class="bold">${escapeHtml(op.operator)}</td>
            <td class="right">${fmt(op.totalWells)}</td>
            <td class="right">${fmt(op.idleWells)}</td>
            <td class="right" style="color: ${getIdleRateColor(op.idleRatePct)}; font-weight: 600;">${op.idleRatePct}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } else if (researchView === 'counties' && counties?.length) {
    const sorted = [...counties].sort((a: any, b: any) => b.idleRatePct - a.idleRatePct);
    html += `
    <div class="section">
      <div class="section-title">County Idle Well Rates (Min 10 Wells)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>County</th>
            <th class="right">Total Wells</th>
            <th class="right">Idle Wells</th>
            <th class="right">Idle Rate</th>
            <th>Top Idle Operator</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((c: any, i: number) => `
          <tr class="${i % 2 !== 0 ? 'alt' : ''}">
            <td class="bold">${escapeHtml(c.county)}</td>
            <td class="right">${fmt(c.totalWells)}</td>
            <td class="right">${fmt(c.idleWells)}</td>
            <td class="right" style="color: ${getIdleRateColor(c.idleRatePct)}; font-weight: 600;">${c.idleRatePct}%</td>
            <td style="font-size: 9px;">${escapeHtml(c.topIdleOperator || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  return html;
}

function generateShutInDetectorPrintHtml(data: any, userName: string, options?: { tab?: string; researchView?: string; researchData?: any }): string {
  const { summary, wells, generatedAt } = data;
  const fmt = (n: number) => n?.toLocaleString() ?? '—';

  // Sort by risk priority (HBP Risk first, then Sudden Stop, then Operator Pattern, then none), then months idle desc
  const sortedWells = [...(wells || [])].sort((a: any, b: any) => {
    const priorityA = a.riskFlags?.includes('HBP Risk') ? 0 : a.riskFlags?.includes('Sudden Stop') ? 1 : a.riskFlags?.includes('Operator Pattern') ? 2 : 3;
    const priorityB = b.riskFlags?.includes('HBP Risk') ? 0 : b.riskFlags?.includes('Sudden Stop') ? 1 : b.riskFlags?.includes('Operator Pattern') ? 2 : 3;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (b.monthsIdle || 0) - (a.monthsIdle || 0);
  });

  // Top 10 wells for print summary (fits on one page)
  const topWells = sortedWells.slice(0, 10);

  // Compute 3-way split for donut (summary.extendedIdle combines 6-12 + 12+)
  const recentlyIdleCount = (wells || []).filter((w: any) => w.status === 'recently_idle').length;
  const extendedIdleCount = (wells || []).filter((w: any) => w.status === 'extended_idle').length;
  const noRecentCount = (wells || []).filter((w: any) => w.status === 'no_recent_production').length;
  const donutSvg = generateShutInDonutSvg(summary?.totalIdle || 0, recentlyIdleCount, extendedIdleCount, noRecentCount);

  const statusLabel = (s: string) => {
    switch (s) {
      case 'recently_idle': return 'Recently Idle';
      case 'extended_idle': return 'Extended Idle';
      case 'no_recent_production': return 'No Recent Prod';
      default: return s;
    }
  };

  const statusClass = (s: string) => {
    switch (s) {
      case 'recently_idle': return 'warning';
      case 'extended_idle': return 'danger';
      case 'no_recent_production': return 'critical';
      default: return '';
    }
  };

  const formatMonth = (ym: string | null) => {
    if (!ym || ym.length < 6) return '—';
    return ym.substring(0, 4) + '-' + ym.substring(4, 6);
  };

  const riskPillsHtml = (flags: string[]) => {
    if (!flags || flags.length === 0) return '<span style="color: #94a3b8;">None</span>';
    return flags.map(f => {
      const cls = f === 'HBP Risk' ? 'pill-hbp' : f === 'Sudden Stop' ? 'pill-sudden' : 'pill-operator';
      return `<span class="risk-pill ${cls}">${escapeHtml(f)}</span>`;
    }).join(' ');
  };

  const shortFlagLabel = (f: string) => f === 'Operator Pattern' ? 'Op Pattern' : f;

  const wellRowsHtml = topWells.map((well: any, i: number) => {
    const rowBorder = well.riskFlags?.includes('HBP Risk') ? 'border-left: 3px solid #dc2626;'
      : well.riskFlags?.includes('Sudden Stop') ? 'border-left: 3px solid #ea580c;'
      : well.riskFlags?.includes('Operator Pattern') ? 'border-left: 3px solid #2563eb;'
      : 'border-left: 3px solid transparent;';
    const flagsPrint = (well.riskFlags || []).length === 0
      ? '<span style="color: #94a3b8;">None</span>'
      : (well.riskFlags || []).map((f: string) => {
          const cls = f === 'HBP Risk' ? 'pill-hbp' : f === 'Sudden Stop' ? 'pill-sudden' : 'pill-operator';
          return `<span class="risk-pill ${cls}">${escapeHtml(shortFlagLabel(f))}</span>`;
        }).join(' ');
    return `
      <tr class="${i % 2 !== 0 ? 'alt' : ''}" style="${rowBorder}">
        <td class="bold">${escapeHtml(well.wellName)}</td>
        <td>${escapeHtml(well.operator || '—')}</td>
        <td>${escapeHtml((well.county || '').replace(/^\d{3}-/, ''))}</td>
        <td class="center"><span class="status-badge ${statusClass(well.status)}">${statusLabel(well.status)}</span></td>
        <td class="right">${well.monthsIdle === 999 ? '—' : well.monthsIdle}</td>
        <td>${formatMonth(well.lastProdMonth)}</td>
        <td>${flagsPrint}</td>
      </tr>
    `;
  }).join('');

  // Count wells by risk flag
  const hbpWells = (wells || []).filter((w: any) => w.riskFlags?.includes('HBP Risk')).length;
  const suddenWells = (wells || []).filter((w: any) => w.riskFlags?.includes('Sudden Stop')).length;
  const operatorWells = (wells || []).filter((w: any) => w.riskFlags?.includes('Operator Pattern')).length;

  // Build body content based on active tab
  let bodyContent = '';
  if (options?.tab === 'research') {
    bodyContent = generateShutInResearchPrintSection(options);
  } else {
    bodyContent = `
    <div class="section">
      <div class="section-title">Portfolio Summary</div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">Total Idle Wells</div>
          <div class="summary-value">${fmt(summary?.totalIdle || 0)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">HBP Risk</div>
          <div class="summary-value ${summary?.hbpRisk > 0 ? 'danger' : ''}">${fmt(summary?.hbpRisk || 0)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Idle (3–6 mo)</div>
          <div class="summary-value ${summary?.recentlyIdle > 0 ? 'warning' : ''}">${fmt(summary?.recentlyIdle || 0)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Extended Idle (6–12 mo)</div>
          <div class="summary-value ${summary?.extendedIdle > 0 ? 'danger' : ''}">${fmt(summary?.extendedIdle || 0)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Long-Term Idle (12+ mo)</div>
          <div class="summary-value ${summary?.noRecentProd > 0 ? 'danger' : ''}">${fmt(summary?.noRecentProd || 0)}</div>
        </div>
      </div>
      <div class="risk-breakdown">
        <div class="risk-item"><span class="risk-dot hbp"></span> HBP Risk: ${hbpWells}</div>
        <div class="risk-item"><span class="risk-dot sudden"></span> Sudden Stop: ${suddenWells}</div>
        <div class="risk-item"><span class="risk-dot operator"></span> Operator Pattern: ${operatorWells}</div>
      </div>
    </div>

    ${donutSvg ? `<div class="section">
      <div class="section-title">Idle Well Distribution</div>
      ${donutSvg}
    </div>` : ''}

    <div class="section">
      <div class="section-title">Highest-Risk Wells (Top ${topWells.length})</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Well Name</th>
            <th>Operator</th>
            <th>County</th>
            <th class="center">Status</th>
            <th class="right">Mo. Idle</th>
            <th>Last Prod</th>
            <th>Risk Flags</th>
          </tr>
        </thead>
        <tbody>
          ${wellRowsHtml || '<tr><td colspan="7" style="text-align: center; color: #64748b;">No idle wells detected — all wells are actively producing</td></tr>'}
        </tbody>
      </table>
      ${wells?.length > 10 ? `<p class="note">+ ${wells.length - 10} more wells. See full report online for complete data.</p>` : ''}
    </div>

    <div class="section">
      <div class="insight-box">
        <div class="insight-title">Understanding Risk Flags</div>
        <div class="insight-text">
          <strong>HBP Risk:</strong> Well's first production is within 60 months — going idle may jeopardize Held-By-Production status on associated leases.<br>
          <strong>Sudden Stop:</strong> Well averaged 50+ BOE/month in its final 12 producing months before going idle — suggests an operational issue rather than natural decline.<br>
          <strong>Operator Pattern:</strong> More than 50% of this operator's wells in your portfolio are idle — may indicate broader operational or financial issues.
        </div>
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shut-In Detector Report - Mineral Watch</title>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 20px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .print-controls { max-width: 8.5in; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 12px; }
    .print-btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .print-btn.primary { background: #1C2B36; color: white; }
    .print-btn.primary:hover { background: #334E68; }
    .print-btn.secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
    .print-btn.secondary:hover { background: #f8fafc; }
    .print-container { width: 8.5in; min-height: 11in; margin: 0 auto; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1C2B36 0%, #334E68 100%); color: white; padding: 20px 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.5px; }
    .header .subtitle { font-size: 12px; opacity: 0.8; }
    .header .brand { text-align: right; }
    .header .brand-name { font-size: 20px; font-weight: 700; font-family: 'Merriweather', Georgia, serif; display: flex; align-items: center; gap: 6px; }
    .header .brand-url { font-size: 10px; opacity: 0.8; margin-top: 4px; }
    .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
    .section-title { font-size: 11px; font-weight: 700; color: #1C2B36; margin-bottom: 12px; letter-spacing: 0.5px; text-transform: uppercase; }
    .summary-grid { display: flex; gap: 24px; flex-wrap: wrap; }
    .summary-item { flex: 1; min-width: 100px; }
    .summary-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .summary-value { font-size: 20px; font-weight: 700; color: #1C2B36; }
    .summary-value.danger { color: #dc2626; }
    .summary-value.warning { color: #d97706; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .data-table th { padding: 8px 8px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #64748b; background: #f8fafc; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    .data-table th.right { text-align: right; }
    .data-table th.center { text-align: center; }
    .data-table td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
    .data-table td.right { text-align: right; font-family: 'JetBrains Mono', monospace; }
    .data-table td.center { text-align: center; }
    .data-table td.bold { font-weight: 600; color: #1C2B36; }
    .data-table tr.alt { background: #f8fafc; }
    .data-table .danger { color: #dc2626; font-weight: 600; }
    .data-table .warning { color: #d97706; font-weight: 600; }
    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 600; text-transform: uppercase; white-space: nowrap; }
    .status-badge.warning { background: #fef3c7; color: #92400e; }
    .status-badge.danger { background: #fee2e2; color: #991b1b; }
    .status-badge.critical { background: #fecaca; color: #7f1d1d; }
    .risk-pill { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
    .pill-hbp { background: #fee2e2; color: #991b1b; }
    .pill-sudden { background: #ffedd5; color: #9a3412; }
    .pill-operator { background: #dbeafe; color: #1e40af; }
    .risk-breakdown { display: flex; gap: 16px; margin-top: 12px; }
    .risk-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #475569; }
    .risk-dot { width: 8px; height: 8px; border-radius: 50%; }
    .risk-dot.hbp { background: #dc2626; }
    .risk-dot.sudden { background: #ea580c; }
    .risk-dot.operator { background: #2563eb; }
    .insight-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-top: 16px; }
    .insight-title { font-size: 10px; font-weight: 600; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .insight-text { font-size: 11px; color: #1e3a5f; line-height: 1.5; }
    .footer { padding: 12px 24px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; background: #f8fafc; }
    .note { font-size: 9px; color: #64748b; margin-top: 8px; font-style: italic; }
    @media screen and (max-width: 768px) {
      body { padding: 8px; }
      .print-controls { flex-direction: column; align-items: stretch; max-width: 100%; }
      .print-btn { justify-content: center; }
      .print-container { width: 100%; min-height: auto; box-shadow: none; }
      .header { flex-direction: column; gap: 10px; padding: 16px; }
      .header .brand { text-align: left; }
      .header .brand-name { font-size: 17px; }
      .section { padding: 12px 14px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .summary-grid { gap: 12px; }
      .summary-item { min-width: 80px; }
      .summary-value { font-size: 16px; }
      .data-table { min-width: 540px; }
      .risk-breakdown { flex-wrap: wrap; gap: 10px; }
      .insight-box { margin-top: 12px; }
      .footer { flex-direction: column; gap: 4px; padding: 10px 14px; }
    }
    @media print {
      body { background: white; padding: 0; }
      .print-controls { display: none !important; }
      .print-container { box-shadow: none; width: 100%; }
    }
    @page { size: letter; margin: 0.25in; }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn secondary" onclick="window.close()">← Back to Dashboard</button>
    <button class="print-btn primary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      Print Report
    </button>
  </div>

  <div class="print-container">
    <div class="header">
      <div>
        <h1>SHUT-IN DETECTOR REPORT${options?.tab === 'research' ? ' — MARKET RESEARCH' : ''}</h1>
        <div class="subtitle">Wells with no reported production in 3+ months</div>
      </div>
      <div class="brand">
        <div class="brand-name">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          MINERAL WATCH
        </div>
        <div class="brand-url">mymineralwatch.com</div>
      </div>
    </div>

    ${bodyContent}

    <div class="footer">
      <span>Generated by Mineral Watch &bull; ${new Date().toLocaleDateString()}</span>
      <span>Full report available at portal.mymineralwatch.com</span>
    </div>
  </div>
</body>
</html>`;
}

// =============================================
// SHUT-IN DETECTOR — MY MARKETS
// =============================================

interface CountyIdleAggregate {
  county: string;
  countyCode: string;
  totalWells: number;
  idleWells: number;
  idleRate: number;
  userWellCount: number;
  userIdleWells: number;
  userIdleRate: number;
  userVsCountyDelta: number | null;
  topOperators: Array<{
    operator: string;
    totalWells: number;
    idleWells: number;
    idleRate: number;
  }>;
}

/**
 * GET /api/intelligence/shut-in-detector/markets
 *
 * Returns county-level idle well statistics with operator breakdown.
 * Uses pre-computed puns table rollups (months_since_production, is_stale).
 * Two queries per county: (1) accurate totals from puns only, (2) operator breakdown via joins.
 */
export async function handleGetShutInDetectorMarkets(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    // Check KV cache (24-hour TTL for county aggregates)
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`shut-in-markets:${cacheId}`, 'json');
        if (cached) {
          console.log('[Shut-In Markets] Returning cached data');
          return jsonResponse(cached);
        }
      } catch (e) {
        console.error('[Shut-In Markets] Cache read error:', e);
      }
    }

    console.log('[Shut-In Markets] Computing county benchmarks...');

    // Step 1: Get user wells with counties + idle status
    const userWellsQuery = `
      SELECT cw.api_number, w.county, w.operator,
             p.months_since_production, p.is_stale
      FROM client_wells cw
      JOIN wells w ON w.api_number = cw.api_number
      LEFT JOIN well_pun_links wpl ON wpl.api_number = cw.api_number
      LEFT JOIN puns p ON p.pun = wpl.pun
      WHERE (cw.organization_id = ? OR cw.user_id = ? OR cw.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))
        AND w.county IS NOT NULL
    `;

    const userWellsResult = await env.WELLS_DB!.prepare(userWellsQuery)
      .bind(userOrgId || '', authUser.id, userOrgId || '')
      .all();

    const userWellRows = userWellsResult.results as Array<{
      api_number: string;
      county: string;
      operator: string | null;
      months_since_production: number | null;
      is_stale: number | null;
    }>;

    // Deduplicate by api_number (take first occurrence)
    const seenApis = new Set<string>();
    const dedupedRows: typeof userWellRows = [];
    for (const row of userWellRows) {
      if (!seenApis.has(row.api_number)) {
        seenApis.add(row.api_number);
        dedupedRows.push(row);
      }
    }

    // Build per-county user stats
    const countyUserStats = new Map<string, { total: number; idle: number }>();
    for (const row of dedupedRows) {
      if (!countyUserStats.has(row.county)) {
        countyUserStats.set(row.county, { total: 0, idle: 0 });
      }
      const stats = countyUserStats.get(row.county)!;
      stats.total++;

      const months = row.months_since_production;
      const isIdle = (months !== null && months >= 3) || months === null;
      if (isIdle) stats.idle++;
    }

    const userCounties = [...countyUserStats.keys()];
    console.log(`[Shut-In Markets] User has wells in ${userCounties.length} counties`);

    if (userCounties.length === 0) {
      return jsonResponse({ counties: [] });
    }

    // Step 2: Process counties in batches of 5
    const countyAggregates: CountyIdleAggregate[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < userCounties.length; i += BATCH_SIZE) {
      const batch = userCounties.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(batch.map(async (county) => {
        try {
          return await computeCountyIdleAggregate(county, countyUserStats.get(county)!, env);
        } catch (err) {
          console.error(`[Shut-In Markets] Error computing county ${county}:`, err);
          return null;
        }
      }));

      for (const result of batchResults) {
        if (result) countyAggregates.push(result);
      }
    }

    // Sort by user well count descending (most relevant counties first)
    countyAggregates.sort((a, b) => b.userWellCount - a.userWellCount);

    const response = { counties: countyAggregates };

    // Cache for 24 hours
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(
          `shut-in-markets:${cacheId}`,
          JSON.stringify(response),
          { expirationTtl: 86400 }
        );
      } catch (e) {
        console.error('[Shut-In Markets] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Shut-In Markets] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load market benchmarks',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Compute county-level idle well stats and operator breakdown.
 * Two queries: (1) accurate totals from puns only, (2) operator ranking via joins.
 */
async function computeCountyIdleAggregate(
  county: string,
  userStats: { total: number; idle: number },
  env: Env
): Promise<CountyIdleAggregate> {
  // Extract county code and name from "017-Canadian" format
  const countyCode = county.substring(0, 3);
  const countyName = county.replace(/^\d{3}-/, '');

  // Query 1: County totals — DISTINCT pun counts via wells.county join
  const totalsResult = await env.WELLS_DB!.prepare(`
    SELECT COUNT(DISTINCT p.pun) as total_puns,
           COUNT(DISTINCT CASE WHEN p.months_since_production >= 3
                 OR p.months_since_production IS NULL THEN p.pun END) as idle_puns
    FROM puns p
    JOIN well_pun_links wpl ON wpl.pun = p.pun
    JOIN wells w ON w.api_number = wpl.api_number
    WHERE w.county = ?
  `).bind(county).first() as { total_puns: number; idle_puns: number } | null;

  const totalWells = totalsResult?.total_puns || 0;
  const idleWells = totalsResult?.idle_puns || 0;
  const idleRate = totalWells > 0 ? Math.round((idleWells / totalWells) * 1000) / 10 : 0;

  // Query 2: Operator breakdown — top 5 by idle PUN count
  const operatorResult = await env.WELLS_DB!.prepare(`
    SELECT w.operator,
           COUNT(DISTINCT p.pun) as total_puns,
           COUNT(DISTINCT CASE WHEN p.months_since_production >= 3
                 OR p.months_since_production IS NULL THEN p.pun END) as idle_puns
    FROM puns p
    JOIN well_pun_links wpl ON wpl.pun = p.pun
    JOIN wells w ON w.api_number = wpl.api_number
    WHERE w.county = ?
    GROUP BY w.operator
    ORDER BY idle_puns DESC
    LIMIT 5
  `).bind(county).all();

  const topOperators = (operatorResult.results as Array<{
    operator: string | null;
    total_puns: number;
    idle_puns: number;
  }>).filter(r => r.operator).map(r => ({
    operator: r.operator!,
    totalWells: r.total_puns,
    idleWells: r.idle_puns,
    idleRate: r.total_puns > 0 ? Math.round((r.idle_puns / r.total_puns) * 1000) / 10 : 0
  }));

  // User stats
  const userIdleRate = userStats.total > 0 ? Math.round((userStats.idle / userStats.total) * 1000) / 10 : 0;
  const userVsCountyDelta = totalWells > 0 ? Math.round((userIdleRate - idleRate) * 10) / 10 : null;

  return {
    county: countyName,
    countyCode,
    totalWells,
    idleWells,
    idleRate,
    userWellCount: userStats.total,
    userIdleWells: userStats.idle,
    userIdleRate,
    userVsCountyDelta,
    topOperators
  };
}

/**
 * GET /api/intelligence/shut-in-detector/research
 *
 * Returns statewide shut-in/idle well data for the Market Research tab:
 * - HUD summary stats (idle rate, newly idle, long-term idle)
 * - Top operators by idle well count
 * - Top operators by idle rate %
 * - County idle rates with top idle operator
 *
 * No user-specific data — shared KV cache across all users.
 */
export async function handleGetShutInResearch(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    // Check KV cache (24-hour TTL, shared across all users since it's statewide)
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get('shut-in-research', 'json');
        if (cached) {
          console.log('[Shut-In Research] Returning cached data');
          return jsonResponse(cached);
        }
      } catch (e) {
        console.error('[Shut-In Research] Cache read error:', e);
      }
    }

    console.log('[Shut-In Research] Computing statewide idle stats...');

    // Query 1: Statewide HUD stats
    const hudResult = await env.WELLS_DB!.prepare(`
      SELECT
        COUNT(*) as total_puns,
        SUM(CASE WHEN months_since_production >= 3 THEN 1 ELSE 0 END) as idle_puns,
        SUM(CASE WHEN months_since_production BETWEEN 3 AND 6 THEN 1 ELSE 0 END) as recently_idle,
        SUM(CASE WHEN months_since_production BETWEEN 7 AND 12 THEN 1 ELSE 0 END) as extended_idle,
        SUM(CASE WHEN months_since_production > 12 THEN 1 ELSE 0 END) as long_term_idle,
        SUM(CASE WHEN months_since_production <= 0 THEN 1 ELSE 0 END) as active_puns
      FROM puns
      WHERE months_since_production IS NOT NULL
    `).first() as any;

    // Query 2: Newly idle (went idle within 6 months of data horizon)
    const newlyIdleResult = await env.WELLS_DB!.prepare(`
      SELECT COUNT(*) as newly_idle
      FROM puns
      WHERE months_since_production BETWEEN 1 AND 6
    `).first() as any;

    // Query 3: Data horizon
    const horizonResult = await env.WELLS_DB!.prepare(`
      SELECT MAX(year_month) as horizon FROM otc_production
    `).first() as any;

    // Query 4: Count of unassigned wells (for data note)
    const unassignedResult = await env.WELLS_DB!.prepare(`
      SELECT COUNT(DISTINCT w.api_number) as unassigned_count
      FROM puns p
      JOIN well_pun_links wpl ON p.pun = wpl.pun
      JOIN wells w ON wpl.api_number = w.api_number
      WHERE p.months_since_production IS NOT NULL
        AND (w.operator IS NULL OR w.operator = 'OTC/OCC NOT ASSIGNED')
    `).first() as any;

    // Query 5: Top operators by idle COUNT (min 50 PUNs)
    // Uses otc_leases → otc_companies join (matches operator detail module — same name source)
    // Counts PUNs (production units), not wells — consistent with operator detail idle rate
    // recently_idle = went idle within 3-6 months (trend indicator)
    const opByCountResult = await env.WELLS_DB!.prepare(`
      SELECT oc.company_name as operator, ol.operator_number,
        COUNT(DISTINCT p.pun) as total_wells,
        COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN p.pun END) as idle_wells,
        COUNT(DISTINCT CASE WHEN p.months_since_production BETWEEN 3 AND 6 THEN p.pun END) as recently_idle,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN p.pun END) / COUNT(DISTINCT p.pun), 1) as idle_rate_pct
      FROM puns p
      JOIN otc_leases ol ON SUBSTR(p.pun, 1, 10) = ol.base_pun
      JOIN otc_companies oc ON ol.operator_number = oc.company_id
      WHERE p.months_since_production IS NOT NULL
        AND ol.operator_number IS NOT NULL
      GROUP BY ol.operator_number
      HAVING total_wells >= 50
      ORDER BY idle_wells DESC
      LIMIT 20
    `).all();

    // Query 6: Top operators by idle RATE (min 50 PUNs)
    const opByRateResult = await env.WELLS_DB!.prepare(`
      SELECT oc.company_name as operator, ol.operator_number,
        COUNT(DISTINCT p.pun) as total_wells,
        COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN p.pun END) as idle_wells,
        COUNT(DISTINCT CASE WHEN p.months_since_production BETWEEN 3 AND 6 THEN p.pun END) as recently_idle,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN p.pun END) / COUNT(DISTINCT p.pun), 1) as idle_rate_pct
      FROM puns p
      JOIN otc_leases ol ON SUBSTR(p.pun, 1, 10) = ol.base_pun
      JOIN otc_companies oc ON ol.operator_number = oc.company_id
      WHERE p.months_since_production IS NOT NULL
        AND ol.operator_number IS NOT NULL
      GROUP BY ol.operator_number
      HAVING total_wells >= 50
      ORDER BY idle_rate_pct DESC
      LIMIT 20
    `).all();

    // Query 7: County idle rates
    const countyResult = await env.WELLS_DB!.prepare(`
      SELECT w.county,
        COUNT(DISTINCT w.api_number) as total_wells,
        COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN w.api_number END) as idle_wells,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN w.api_number END) / COUNT(DISTINCT w.api_number), 1) as idle_rate_pct
      FROM puns p
      JOIN well_pun_links wpl ON p.pun = wpl.pun
      JOIN wells w ON wpl.api_number = w.api_number
      WHERE p.months_since_production IS NOT NULL
        AND w.county IS NOT NULL
      GROUP BY w.county
      HAVING total_wells >= 10
      ORDER BY idle_rate_pct DESC
    `).all();

    // Query 8: Top idle operator per county (using otc_leases + otc_companies for operator resolution)
    const countyOpResult = await env.WELLS_DB!.prepare(`
      SELECT w.county, oc.company_name as operator, ol.operator_number,
        COUNT(DISTINCT CASE WHEN p.months_since_production >= 3 THEN p.pun END) as idle_puns
      FROM puns p
      JOIN otc_leases ol ON SUBSTR(p.pun, 1, 10) = ol.base_pun
      JOIN otc_companies oc ON ol.operator_number = oc.company_id
      JOIN well_pun_links wpl ON p.pun = wpl.pun
      JOIN wells w ON wpl.api_number = w.api_number
      WHERE p.months_since_production IS NOT NULL
        AND p.months_since_production >= 3
        AND w.county IS NOT NULL
        AND ol.operator_number IS NOT NULL
      GROUP BY w.county, ol.operator_number
      ORDER BY w.county, idle_puns DESC
    `).all();

    // Post-process: build top idle operator lookup by county
    const topOpByCounty = new Map<string, { operator: string; operatorNumber: string }>();
    for (const row of countyOpResult.results as any[]) {
      if (!topOpByCounty.has(row.county)) {
        topOpByCounty.set(row.county, { operator: row.operator, operatorNumber: row.operator_number });
      }
    }

    // Build response
    const totalPuns = hudResult?.total_puns || 0;
    const idlePuns = hudResult?.idle_puns || 0;

    const mapOperator = (r: any) => ({
      operator: r.operator,
      operatorNumber: r.operator_number || null,
      totalWells: r.total_wells,
      idleWells: r.idle_wells,
      recentlyIdle: r.recently_idle || 0,
      idleRatePct: r.idle_rate_pct
    });

    const response = {
      summary: {
        totalPuns,
        activePuns: hudResult?.active_puns || 0,
        idlePuns,
        idleRatePct: totalPuns > 0 ? Math.round((idlePuns / totalPuns) * 1000) / 10 : 0,
        recentlyIdle: hudResult?.recently_idle || 0,
        extendedIdle: hudResult?.extended_idle || 0,
        longTermIdle: hudResult?.long_term_idle || 0,
        newlyIdle6mo: newlyIdleResult?.newly_idle || 0,
        unassignedWells: unassignedResult?.unassigned_count || 0,
        dataHorizon: horizonResult?.horizon || ''
      },
      operatorsByCount: (opByCountResult.results as any[]).map(mapOperator),
      operatorsByRate: (opByRateResult.results as any[]).map(mapOperator),
      counties: (countyResult.results as any[]).map((r: any) => {
        const topOp = topOpByCounty.get(r.county);
        return {
          county: r.county,
          totalWells: r.total_wells,
          idleWells: r.idle_wells,
          idleRatePct: r.idle_rate_pct,
          topIdleOperator: topOp?.operator || null,
          topIdleOperatorNumber: topOp?.operatorNumber || null
        };
      })
    };

    console.log(`[Shut-In Research] ${response.operatorsByCount.length} operators by count, ${response.counties.length} counties`);

    // Cache for 24 hours
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put('shut-in-research', JSON.stringify(response), { expirationTtl: 86400 });
      } catch (e) {
        console.error('[Shut-In Research] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Shut-In Research] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load shut-in research data',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * GET /api/intelligence/production-decline/research
 * Statewide production decline intelligence — operator and county decline rankings.
 * Uses pre-computed BOE-based decline_rate_12m from puns table.
 * Cached 24h in KV, shared across all users.
 */
export async function handleGetDeclineResearch(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    // Check KV cache (24-hour TTL, shared across all users)
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get('decline-research', 'json');
        if (cached) {
          console.log('[Decline Research] Returning cached data');
          return jsonResponse(cached);
        }
      } catch (e) {
        console.error('[Decline Research] Cache read error:', e);
      }
    }

    console.log('[Decline Research] Computing statewide decline stats...');

    // Query 1: Statewide HUD stats (active PUNs with reasonable decline data)
    const hudResult = await env.WELLS_DB!.prepare(`
      SELECT
        COUNT(*) as total_puns,
        SUM(CASE WHEN months_since_production <= 3 THEN 1 ELSE 0 END) as active_puns,
        ROUND(AVG(CASE WHEN decline_rate_12m BETWEEN -100 AND 100
          AND months_since_production <= 3 THEN decline_rate_12m END), 1) as avg_decline,
        SUM(CASE WHEN decline_rate_12m < -25 AND decline_rate_12m >= -100
          AND months_since_production <= 3 THEN 1 ELSE 0 END) as steep_decline,
        SUM(CASE WHEN decline_rate_12m BETWEEN -5 AND 5
          AND months_since_production <= 3 THEN 1 ELSE 0 END) as flat_wells,
        SUM(CASE WHEN decline_rate_12m > 5 AND decline_rate_12m <= 100
          AND months_since_production <= 3 THEN 1 ELSE 0 END) as growing_wells
      FROM puns
      WHERE decline_rate_12m IS NOT NULL
    `).first() as any;

    // Query 2: Data horizon
    const horizonResult = await env.WELLS_DB!.prepare(`
      SELECT MAX(year_month) as horizon FROM otc_production
    `).first() as any;

    // Query 3: Top operators by steepest DECLINE (min 20 active PUNs)
    const opByDeclineResult = await env.WELLS_DB!.prepare(`
      SELECT w.operator,
        COUNT(DISTINCT p.pun) as active_wells,
        ROUND(AVG(p.decline_rate_12m), 1) as avg_decline
      FROM puns p
      JOIN well_pun_links wpl ON p.pun = wpl.pun
      JOIN wells w ON wpl.api_number = w.api_number
      WHERE p.decline_rate_12m IS NOT NULL
        AND p.decline_rate_12m BETWEEN -100 AND 100
        AND p.months_since_production <= 3
        AND w.operator IS NOT NULL
        AND w.operator != 'OTC/OCC NOT ASSIGNED'
      GROUP BY w.operator
      HAVING active_wells >= 20
      ORDER BY avg_decline ASC
      LIMIT 20
    `).all();

    // Query 4: Top operators by GROWTH (min 20 active PUNs)
    const opByGrowthResult = await env.WELLS_DB!.prepare(`
      SELECT w.operator,
        COUNT(DISTINCT p.pun) as active_wells,
        ROUND(AVG(p.decline_rate_12m), 1) as avg_decline
      FROM puns p
      JOIN well_pun_links wpl ON p.pun = wpl.pun
      JOIN wells w ON wpl.api_number = w.api_number
      WHERE p.decline_rate_12m IS NOT NULL
        AND p.decline_rate_12m BETWEEN -100 AND 100
        AND p.months_since_production <= 3
        AND w.operator IS NOT NULL
        AND w.operator != 'OTC/OCC NOT ASSIGNED'
      GROUP BY w.operator
      HAVING active_wells >= 20
      ORDER BY avg_decline DESC
      LIMIT 20
    `).all();

    // Query 5: County decline rates (all qualifying counties)
    const countyResult = await env.WELLS_DB!.prepare(`
      SELECT p.county,
        COUNT(*) as active_wells,
        ROUND(AVG(p.decline_rate_12m), 1) as avg_decline,
        SUM(CASE WHEN p.decline_rate_12m < 0 THEN 1 ELSE 0 END) as declining_wells,
        SUM(CASE WHEN p.decline_rate_12m >= 0 THEN 1 ELSE 0 END) as growing_wells
      FROM puns p
      WHERE p.decline_rate_12m IS NOT NULL
        AND p.decline_rate_12m BETWEEN -100 AND 100
        AND p.months_since_production <= 3
        AND p.county IS NOT NULL
      GROUP BY p.county
      HAVING active_wells >= 10
      ORDER BY avg_decline ASC
    `).all();

    // Batch lookup: resolve operator names → operator_numbers
    // Pick the operator_number with the most wells for each name (canonical resolution)
    const allOpNames = new Set<string>();
    for (const r of opByDeclineResult.results as any[]) allOpNames.add(r.operator);
    for (const r of opByGrowthResult.results as any[]) allOpNames.add(r.operator);

    const opNameToNumber = new Map<string, string>();
    if (allOpNames.size > 0) {
      const placeholders = [...allOpNames].map(() => '?').join(',');
      const opLookup = await env.WELLS_DB!.prepare(`
        SELECT w.operator, ol.operator_number, COUNT(DISTINCT w.api_number) as well_count
        FROM wells w
        JOIN well_pun_links wpl ON w.api_number = wpl.api_number
        JOIN otc_leases ol ON wpl.pun = ol.pun
        WHERE w.operator IN (${placeholders})
          AND ol.operator_number IS NOT NULL
        GROUP BY w.operator, ol.operator_number
        ORDER BY well_count DESC
      `).bind(...[...allOpNames]).all();
      for (const r of opLookup.results as any[]) {
        const key = (r.operator as string).toUpperCase();
        if (!opNameToNumber.has(key)) {
          opNameToNumber.set(key, r.operator_number as string);
        }
      }
    }

    // Build response
    const mapOperator = (r: any) => ({
      operator: r.operator,
      operatorNumber: opNameToNumber.get(r.operator?.toUpperCase()) || null,
      activeWells: r.active_wells,
      avgDecline: r.avg_decline
    });

    const response = {
      summary: {
        totalPuns: hudResult?.total_puns || 0,
        activePuns: hudResult?.active_puns || 0,
        avgDecline: hudResult?.avg_decline || 0,
        steepDecline: hudResult?.steep_decline || 0,
        flatWells: hudResult?.flat_wells || 0,
        growingWells: hudResult?.growing_wells || 0,
        dataHorizon: horizonResult?.horizon || ''
      },
      operatorsByDecline: (opByDeclineResult.results as any[]).map(mapOperator),
      operatorsByGrowth: (opByGrowthResult.results as any[]).map(mapOperator),
      counties: (countyResult.results as any[]).map((r: any) => ({
        county: r.county,
        activeWells: r.active_wells,
        avgDecline: r.avg_decline,
        decliningWells: r.declining_wells,
        growingWells: r.growing_wells
      }))
    };

    console.log(`[Decline Research] ${response.operatorsByDecline.length} decliners, ${response.operatorsByGrowth.length} growers, ${response.counties.length} counties`);

    // Cache for 24 hours
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put('decline-research', JSON.stringify(response), { expirationTtl: 86400 });
      } catch (e) {
        console.error('[Decline Research] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Decline Research] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load decline research data',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// =============================================
// OCC FILING ACTIVITY REPORT
// =============================================

/**
 * GET /api/intelligence/occ-filing-activity
 *
 * All OCC filings on and near the user's sections — pooling, spacing,
 * horizontal wells, and more. Uses the same township±1 broad filter and
 * distance-tier post-filtering as the pooling report.
 */
export async function handleGetOccFilingActivity(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('refresh') === '1';

    // Check KV cache
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`occ-filing-activity:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[OCC Filing Activity] Cache read error:', e);
      }
    }

    // Step 1: Get user's properties with TRS data
    const propsQuery = userOrgId
      ? `SELECT id, section, township, range, county, airtable_record_id
         FROM properties
         WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))
           AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`
      : `SELECT id, section, township, range, county, airtable_record_id
         FROM properties
         WHERE user_id = ?
           AND section IS NOT NULL AND township IS NOT NULL AND range IS NOT NULL`;

    const propsResult = userOrgId
      ? await env.WELLS_DB.prepare(propsQuery).bind(userOrgId, userOrgId).all()
      : await env.WELLS_DB.prepare(propsQuery).bind(authUser.id).all();

    const properties = propsResult.results as Array<{
      id: string;
      section: string;
      township: string;
      range: string;
      county: string;
      airtable_record_id: string;
    }>;

    if (!properties || properties.length === 0) {
      const emptyResponse = {
        summary: {
          totalFilings: 0,
          sameSectionFilings: 0,
          filingTypes: {},
          topApplicants: [],
          dateRange: { earliest: null, latest: null },
          propertiesWithActivity: 0
        },
        byProperty: [],
        byCounty: [],
        marketResearch: null,
        _message: 'No properties with location data found'
      };
      return jsonResponse(emptyResponse);
    }

    // Step 2: Build township±1 / range±1 sets for broad filter
    const townships = new Set<string>();
    const ranges = new Set<string>();

    for (const p of properties) {
      const twp = parseTownship(p.township);
      const rng = parseRange(p.range);
      if (twp && rng) {
        townships.add(`${twp.num}${twp.dir}`);
        townships.add(`${twp.num + 1}${twp.dir}`);
        if (twp.num > 1) townships.add(`${twp.num - 1}${twp.dir}`);

        ranges.add(`${rng.num}${rng.dir}`);
        ranges.add(`${rng.num + 1}${rng.dir}`);
        if (rng.num > 1) ranges.add(`${rng.num - 1}${rng.dir}`);
      }
    }

    if (townships.size === 0) {
      const emptyResponse = {
        summary: {
          totalFilings: 0,
          sameSectionFilings: 0,
          filingTypes: {},
          topApplicants: [],
          dateRange: { earliest: null, latest: null },
          propertiesWithActivity: 0
        },
        byProperty: [],
        byCounty: [],
        marketResearch: null,
        _message: 'Could not parse property locations'
      };
      return jsonResponse(emptyResponse);
    }

    // Step 3: Query occ_docket_entries with broad township/range filter
    const twpArray = [...townships];
    const rngArray = [...ranges];
    const twpPlaceholders = twpArray.map(() => '?').join(',');
    const rngPlaceholders = rngArray.map(() => '?').join(',');

    const filingsResult = await env.WELLS_DB.prepare(`
      SELECT id, case_number, relief_type, applicant, county,
             section, township, range, hearing_date, status,
             docket_date, source_url, order_number
      FROM occ_docket_entries
      WHERE township IN (${twpPlaceholders})
        AND range IN (${rngPlaceholders})
        AND docket_date >= date('now', '-12 months')
      ORDER BY docket_date DESC
    `).bind(...twpArray, ...rngArray).all();

    const filingRows = filingsResult.results as Array<{
      id: string;
      case_number: string;
      relief_type: string;
      applicant: string;
      county: string;
      section: string;
      township: string;
      range: string;
      hearing_date: string;
      status: string;
      docket_date: string;
      source_url: string;
      order_number: string;
    }>;

    // Step 4: Compute distance tier for each filing against all properties
    type FilingWithDistance = typeof filingRows[0] & {
      distanceTier: number;
      distanceDescription: string;
      nearestPropertyId: string | null;
    };

    const filingsWithDistance: FilingWithDistance[] = [];

    for (const filing of filingRows) {
      let bestTier = { tier: 99, description: 'Distant', propertyId: null as string | null };

      for (const prop of properties) {
        const tier = getDistanceTier(
          parseInt(prop.section), prop.township, prop.range,
          filing.section, filing.township, filing.range
        );
        if (tier.tier < bestTier.tier) {
          bestTier = { tier: tier.tier, description: tier.description, propertyId: prop.id };
        }
      }

      // Only include filings within distance tier 2
      if (bestTier.tier <= 2) {
        filingsWithDistance.push({
          ...filing,
          distanceTier: bestTier.tier,
          distanceDescription: bestTier.description,
          nearestPropertyId: bestTier.propertyId
        });
      }
    }

    // Step 5: Group by property
    const propertyFilingsMap = new Map<string, FilingWithDistance[]>();
    for (const filing of filingsWithDistance) {
      if (filing.nearestPropertyId) {
        if (!propertyFilingsMap.has(filing.nearestPropertyId)) {
          propertyFilingsMap.set(filing.nearestPropertyId, []);
        }
        propertyFilingsMap.get(filing.nearestPropertyId)!.push(filing);
      }
    }

    const byProperty: Array<{
      propertyId: string;
      propertyName: string;
      section: string;
      township: string;
      range: string;
      county: string;
      filingCount: number;
      sameSectionCount: number;
      filings: Array<{
        caseNumber: string;
        reliefType: string;
        applicant: string;
        county: string;
        section: string;
        township: string;
        range: string;
        hearingDate: string;
        status: string;
        docketDate: string;
        sourceUrl: string;
        distanceTier: number;
        distanceDescription: string;
      }>;
    }> = [];

    for (const prop of properties) {
      const propFilings = propertyFilingsMap.get(prop.id);
      if (propFilings && propFilings.length > 0) {
        propFilings.sort((a, b) => {
          if (a.distanceTier !== b.distanceTier) return a.distanceTier - b.distanceTier;
          return (b.docket_date || '').localeCompare(a.docket_date || '');
        });

        let sameSectionCount = 0;
        for (const f of propFilings) {
          if (f.distanceTier === 0) sameSectionCount++;
        }

        byProperty.push({
          propertyId: prop.id,
          propertyName: `Sec ${prop.section}-${prop.township}-${prop.range}`,
          section: prop.section,
          township: prop.township,
          range: prop.range,
          county: prop.county,
          filingCount: propFilings.length,
          sameSectionCount,
          filings: propFilings.map(f => ({
            caseNumber: f.case_number,
            reliefType: f.relief_type,
            applicant: f.applicant,
            county: f.county,
            section: f.section,
            township: f.township,
            range: f.range,
            hearingDate: f.hearing_date,
            status: f.status,
            docketDate: f.docket_date,
            sourceUrl: f.source_url,
            distanceTier: f.distanceTier,
            distanceDescription: f.distanceDescription
          }))
        });
      }
    }

    byProperty.sort((a, b) => b.filingCount - a.filingCount);

    // Step 6: Summary stats
    const filingTypeMap: Record<string, number> = {};
    const applicantMap: Record<string, number> = {};
    const filingDates: string[] = [];
    let sameSectionTotal = 0;

    for (const filing of filingsWithDistance) {
      if (filing.relief_type) {
        filingTypeMap[filing.relief_type] = (filingTypeMap[filing.relief_type] || 0) + 1;
      }
      if (filing.applicant) {
        applicantMap[filing.applicant] = (applicantMap[filing.applicant] || 0) + 1;
      }
      if (filing.docket_date) filingDates.push(filing.docket_date);
      if (filing.distanceTier === 0) sameSectionTotal++;
    }

    const topApplicants = Object.entries(applicantMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    filingDates.sort();

    // Step 7: By-county breakdown (counties where user has properties)
    const countyFilingMap = new Map<string, {
      count: number;
      applicants: Map<string, number>;
      filingTypes: Map<string, number>;
      latestDate: string;
    }>();

    for (const filing of filingsWithDistance) {
      const county = filing.county || 'Unknown';
      if (!countyFilingMap.has(county)) {
        countyFilingMap.set(county, {
          count: 0,
          applicants: new Map(),
          filingTypes: new Map(),
          latestDate: ''
        });
      }
      const cs = countyFilingMap.get(county)!;
      cs.count++;
      if (filing.applicant) {
        cs.applicants.set(filing.applicant, (cs.applicants.get(filing.applicant) || 0) + 1);
      }
      if (filing.relief_type) {
        cs.filingTypes.set(filing.relief_type, (cs.filingTypes.get(filing.relief_type) || 0) + 1);
      }
      if (filing.docket_date && filing.docket_date > cs.latestDate) {
        cs.latestDate = filing.docket_date;
      }
    }

    const byCounty = [...countyFilingMap.entries()].map(([county, cs]) => ({
      county,
      filingCount: cs.count,
      topApplicants: [...cs.applicants.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      filingTypes: Object.fromEntries(cs.filingTypes),
      latestDate: cs.latestDate
    })).sort((a, b) => b.filingCount - a.filingCount);

    // Step 8: Market Research — statewide 90-day aggregations
    const [hottestCountiesResult, topFilersResult, filingTypesResult] = await Promise.all([
      env.WELLS_DB.prepare(`
        SELECT county, COUNT(*) as cnt FROM occ_docket_entries
        WHERE docket_date >= date('now', '-90 days') AND county IS NOT NULL AND county != ''
        GROUP BY county ORDER BY cnt DESC LIMIT 10
      `).all().catch(() => ({ results: [] })),

      env.WELLS_DB.prepare(`
        SELECT applicant, COUNT(*) as cnt FROM occ_docket_entries
        WHERE docket_date >= date('now', '-90 days') AND applicant IS NOT NULL AND applicant != ''
        GROUP BY applicant ORDER BY cnt DESC LIMIT 10
      `).all().catch(() => ({ results: [] })),

      env.WELLS_DB.prepare(`
        SELECT relief_type, COUNT(*) as cnt FROM occ_docket_entries
        WHERE docket_date >= date('now', '-90 days') AND relief_type IS NOT NULL AND relief_type != ''
        GROUP BY relief_type ORDER BY cnt DESC
      `).all().catch(() => ({ results: [] }))
    ]);

    const totalStatewideResult = await env.WELLS_DB.prepare(`
      SELECT COUNT(*) as cnt FROM occ_docket_entries
      WHERE docket_date >= date('now', '-90 days')
    `).first<{ cnt: number }>().catch(() => ({ cnt: 0 }));

    const marketResearch = {
      hottestCounties: ((hottestCountiesResult.results || []) as any[]).map(r => ({
        county: r.county,
        count: r.cnt
      })),
      topFilers: ((topFilersResult.results || []) as any[]).map(r => ({
        applicant: r.applicant,
        count: r.cnt
      })),
      filingTypeBreakdown: Object.fromEntries(
        ((filingTypesResult.results || []) as any[]).map(r => [r.relief_type, r.cnt])
      ),
      totalStatewideFilings90d: totalStatewideResult?.cnt || 0
    };

    const response = {
      summary: {
        totalFilings: filingsWithDistance.length,
        sameSectionFilings: sameSectionTotal,
        filingTypes: filingTypeMap,
        topApplicants,
        dateRange: {
          earliest: filingDates.length > 0 ? filingDates[0] : null,
          latest: filingDates.length > 0 ? filingDates[filingDates.length - 1] : null
        },
        propertiesWithActivity: byProperty.length
      },
      byProperty,
      byCounty,
      marketResearch
    };

    // Cache for 1 hour
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(`occ-filing-activity:${cacheId}`, JSON.stringify(response), { expirationTtl: 3600 });
      } catch (e) {
        console.error('[OCC Filing Activity] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[OCC Filing Activity] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load OCC filing activity',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// ============================
// WELL RISK PROFILE REPORT
// ============================

/**
 * Pre-compute risk profile assignments on all wells.
 * Called from daily cron (0 8 * * *) after OTC sync.
 * Also caches WTI/Henry Hub prices in KV.
 */
export async function precomputeRiskProfiles(env: Env): Promise<void> {
  console.log('[Risk Profiles] Starting pre-compute...');

  // Step 1: Refresh commodity prices in KV
  try {
    const priceResp = await fetch('https://mymineralwatch.com/api/prices');
    const prices = await priceResp.json() as Record<string, any>;
    await env.OCC_CACHE.put('commodity-prices-cached', JSON.stringify({
      wti: prices.wti?.price || null,
      henryHub: prices.henryHub?.price || null,
      updatedAt: new Date().toISOString(),
      source: prices.source || 'tools-worker'
    }), { expirationTtl: 86400 });
    console.log('[Risk Profiles] Cached commodity prices: WTI=$' + (prices.wti?.price || '?'));
  } catch (e) {
    console.error('[Risk Profiles] Failed to cache prices:', e);
  }

  // Step 2: Reset + batch UPDATE wells with risk_profile_id
  const db = env.WELLS_DB!;

  // 0. Reset all profiles (ensures re-evaluation on data corrections)
  await db.prepare('UPDATE wells SET risk_profile_id = NULL').run();

  // 1. SCOOP/STACK Horizontal (highest confidence)
  await db.prepare(
    `UPDATE wells SET risk_profile_id = 'scoop-stack-hz'
     WHERE is_horizontal = 1
       AND formation_group IN ('Mississippian', 'Woodford', 'Springer')`
  ).run();

  // 2. Other Horizontal
  await db.prepare(
    `UPDATE wells SET risk_profile_id = 'other-hz'
     WHERE is_horizontal = 1
       AND risk_profile_id IS NULL`
  ).run();

  // 3. Deep Conventional Vertical
  await db.prepare(
    `UPDATE wells SET risk_profile_id = 'deep-conventional'
     WHERE is_horizontal = 0
       AND formation_group IN ('Hunton', 'Viola', 'Simpson', 'Arbuckle')`
  ).run();

  // 4. Conventional Vertical (has formation data)
  await db.prepare(
    `UPDATE wells SET risk_profile_id = 'conventional-vert'
     WHERE is_horizontal = 0
       AND formation_group IS NOT NULL
       AND risk_profile_id IS NULL`
  ).run();

  // 5. Unknown Formation (no formation data at all)
  await db.prepare(
    `UPDATE wells SET risk_profile_id = 'unknown-formation'
     WHERE risk_profile_id IS NULL`
  ).run();

  console.log('[Risk Profiles] Pre-compute complete.');
}

interface RiskWellRow {
  client_well_id: string;
  api_number: string;
  cw_well_name: string | null;
  well_name: string | null;
  operator: string | null;
  county: string | null;
  well_type: string | null;
  formation_name: string | null;
  formation_canonical: string | null;
  formation_group: string | null;
  risk_profile_id: string | null;
  completion_date: string | null;
  profile_name: string | null;
  half_cycle_breakeven: number | null;
  full_cycle_breakeven: number | null;
  typical_loe_per_boe: number | null;
  is_gas_flag: number | null;
  profile_description: string | null;
  pun: string | null;
  last_prod_month: string | null;
  is_stale: number | null;
  decline_rate_12m: number | null;
}

function getRiskLevel(wtiPrice: number, breakeven: number): { level: string; cushionPct: number; cushionDollar: number } {
  const cushionDollar = wtiPrice - breakeven;
  const cushionPct = (cushionDollar / breakeven) * 100;
  let level: string;
  if (cushionPct > 25) level = 'comfortable';
  else if (cushionPct > 10) level = 'adequate';
  else if (cushionPct > 0) level = 'tight';
  else level = 'at_risk';
  return { level, cushionPct, cushionDollar };
}

/**
 * GET /api/intelligence/well-risk-profile
 *
 * Breakeven analysis for user's tracked wells at current WTI price.
 * Formation-based profile assignment determines breakeven; risk level
 * computed as % cushion above breakeven.
 */
export async function handleGetWellRiskProfile(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    if (!isIntelligenceAllowed(userOrgId)) {
      return jsonResponse({ error: 'Intelligence features are not yet available for your account' }, 403);
    }

    const cacheId = userOrgId || authUser.id;

    // Check for cache bypass
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('bust') === '1' || url.searchParams.get('refresh') === '1';

    // Check KV cache
    if (env.OCC_CACHE && !skipCache) {
      try {
        const cached = await env.OCC_CACHE.get(`well-risk-profile:${cacheId}`, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Well Risk Profile] Cache read error:', e);
      }
    }

    // Step 1: Get cached WTI price
    let wtiPrice: number | null = null;
    let henryHubPrice: number | null = null;
    let priceDate: string | null = null;
    let priceSource = 'tools-worker';

    if (env.OCC_CACHE) {
      try {
        const cachedPrices = await env.OCC_CACHE.get('commodity-prices-cached', 'json') as {
          wti: number | null; henryHub: number | null; updatedAt: string; source: string;
        } | null;
        if (cachedPrices) {
          wtiPrice = cachedPrices.wti;
          henryHubPrice = cachedPrices.henryHub;
          priceDate = cachedPrices.updatedAt;
          priceSource = cachedPrices.source;
        }
      } catch (e) { /* ignore */ }
    }

    // Fallback: fetch live prices if not cached
    if (wtiPrice === null) {
      try {
        const priceResp = await fetch('https://mymineralwatch.com/api/prices');
        const prices = await priceResp.json() as Record<string, any>;
        wtiPrice = prices.wti?.price || null;
        henryHubPrice = prices.henryHub?.price || null;
        priceDate = new Date().toISOString();
        priceSource = prices.source || 'tools-worker';
      } catch (e) {
        console.error('[Well Risk Profile] Price fetch failed:', e);
      }
    }

    if (wtiPrice === null) {
      return jsonResponse({ error: 'Unable to retrieve current oil prices. Please try again later.' }, 503);
    }

    // Step 2: Query user's tracked wells with risk profile data
    const db = env.WELLS_DB!;

    const wellsQuery = `
      SELECT cw.id as client_well_id, cw.api_number, cw.well_name as cw_well_name,
             w.well_name, w.operator, w.county, w.well_type,
             w.formation_name, w.formation_canonical, w.formation_group,
             w.risk_profile_id, w.completion_date,
             rp.name as profile_name, rp.half_cycle_breakeven,
             rp.full_cycle_breakeven, rp.typical_loe_per_boe,
             rp.is_gas_flag, rp.description as profile_description,
             wpl.pun, p.last_prod_month, p.is_stale, p.decline_rate_12m
      FROM client_wells cw
      JOIN wells w ON w.api_number = cw.api_number
      LEFT JOIN well_risk_profiles rp ON rp.id = w.risk_profile_id
      LEFT JOIN well_pun_links wpl ON wpl.api_number = cw.api_number
      LEFT JOIN puns p ON p.pun = wpl.pun
      WHERE (cw.organization_id = ? OR cw.user_id IN
        (SELECT airtable_record_id FROM users WHERE organization_id = ?))
    `;

    const wellsResult = await db.prepare(wellsQuery)
      .bind(userOrgId || '', userOrgId || '')
      .all();

    const rows = wellsResult.results as unknown as RiskWellRow[];

    // Deduplicate by api_number (keep row with latest production)
    const wellsByApi = new Map<string, RiskWellRow>();
    for (const row of rows) {
      const existing = wellsByApi.get(row.api_number);
      if (!existing) {
        wellsByApi.set(row.api_number, row);
      } else if (row.last_prod_month && (!existing.last_prod_month || row.last_prod_month > existing.last_prod_month)) {
        wellsByApi.set(row.api_number, row);
      }
    }

    const allWells = Array.from(wellsByApi.values());
    console.log('[Well Risk Profile] Queried', rows.length, 'rows, deduped to', allWells.length, 'wells');

    // Step 3: Gas-weighted detection via recent production
    const punsToCheck = allWells
      .filter(w => w.pun)
      .map(w => w.pun!);

    const gasWeightedPuns = new Set<string>();

    if (punsToCheck.length > 0) {
      // Last 6 months cutoff
      const now = new Date();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      const cutoff = `${sixMonthsAgo.getFullYear()}${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

      // Batch in groups of 30 (D1 param limit)
      const BATCH_SIZE = 30;
      for (let i = 0; i < punsToCheck.length; i += BATCH_SIZE) {
        const batch = punsToCheck.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(',');

        try {
          const gasResult = await db.prepare(`
            SELECT base_pun,
              SUM(CASE WHEN product_code IN ('3','5','6') THEN volume ELSE 0 END) as gas_vol,
              SUM(CASE WHEN product_code = '1' THEN volume ELSE 0 END) as oil_vol
            FROM otc_production
            WHERE base_pun IN (${placeholders})
              AND year_month >= ?
            GROUP BY base_pun
          `).bind(...batch, cutoff).all();

          for (const r of gasResult.results as Array<{ base_pun: string; gas_vol: number; oil_vol: number }>) {
            const gasBoe = (r.gas_vol || 0) / 6; // MCF to BOE
            const oilBoe = r.oil_vol || 0;
            if (gasBoe > 2 * oilBoe && gasBoe > 0) {
              gasWeightedPuns.add(r.base_pun);
            }
          }
        } catch (e) {
          console.error('[Well Risk Profile] Gas detection batch error:', e);
        }
      }
    }

    console.log('[Well Risk Profile] Gas-weighted PUNs:', gasWeightedPuns.size);

    // Step 4: Compute risk level per well
    let atRiskCount = 0;
    let tightCount = 0;
    let adequateCount = 0;
    let comfortableCount = 0;
    let gasWeightedCount = 0;
    let scoredCushionSum = 0;
    let scoredCount = 0;

    const wells: Array<{
      clientWellId: string;
      wellName: string;
      apiNumber: string;
      operator: string;
      county: string;
      wellType: string;
      formationCanonical: string | null;
      formationGroup: string | null;
      profileId: string;
      profileName: string;
      halfCycleBreakeven: number | null;
      riskLevel: string;
      cushionDollar: number | null;
      cushionPct: number | null;
      isGasWeighted: boolean;
      isStale: boolean;
      lastProdMonth: string | null;
      declineRate12m: number | null;
    }> = [];

    for (const w of allWells) {
      const isGasWeighted = w.pun ? gasWeightedPuns.has(w.pun) : false;
      const profileId = isGasWeighted ? 'gas-weighted' : (w.risk_profile_id || 'unknown-formation');
      const profileName = isGasWeighted ? 'Gas-Weighted' : (w.profile_name || 'Unknown Formation');
      const breakeven = isGasWeighted ? null : (w.half_cycle_breakeven ?? 38); // fallback to blended avg

      let riskLevel: string;
      let cushionDollar: number | null = null;
      let cushionPct: number | null = null;

      if (isGasWeighted) {
        riskLevel = 'gas_weighted';
        gasWeightedCount++;
      } else {
        const risk = getRiskLevel(wtiPrice, breakeven!);
        riskLevel = risk.level;
        cushionDollar = Math.round(risk.cushionDollar * 100) / 100;
        cushionPct = Math.round(risk.cushionPct * 10) / 10;
        scoredCushionSum += risk.cushionDollar;
        scoredCount++;

        if (riskLevel === 'at_risk') atRiskCount++;
        else if (riskLevel === 'tight') tightCount++;
        else if (riskLevel === 'adequate') adequateCount++;
        else comfortableCount++;
      }

      wells.push({
        clientWellId: w.client_well_id,
        wellName: w.well_name || w.cw_well_name || 'Unknown',
        apiNumber: w.api_number,
        operator: w.operator || 'Unknown',
        county: w.county || 'Unknown',
        wellType: w.well_type || 'Unknown',
        formationCanonical: w.formation_canonical,
        formationGroup: w.formation_group,
        profileId,
        profileName,
        halfCycleBreakeven: isGasWeighted ? null : breakeven,
        riskLevel,
        cushionDollar,
        cushionPct,
        isGasWeighted,
        isStale: w.is_stale === 1,
        lastProdMonth: w.last_prod_month,
        declineRate12m: w.decline_rate_12m
      });
    }

    // Step 5: Build byProfile summary
    const profileMap = new Map<string, { profileId: string; profileName: string; halfCycleBreakeven: number | null; wellCount: number; riskLevel: string; isGasFlag: boolean }>();
    for (const w of wells) {
      const existing = profileMap.get(w.profileId);
      if (!existing) {
        const isGas = w.profileId === 'gas-weighted';
        profileMap.set(w.profileId, {
          profileId: w.profileId,
          profileName: w.profileName,
          halfCycleBreakeven: w.halfCycleBreakeven,
          wellCount: 1,
          riskLevel: isGas ? 'gas_weighted' : getRiskLevel(wtiPrice, w.halfCycleBreakeven || 38).level,
          isGasFlag: isGas
        });
      } else {
        existing.wellCount++;
      }
    }

    const byProfile = Array.from(profileMap.values()).sort((a, b) => {
      const order: Record<string, number> = { 'scoop-stack-hz': 1, 'other-hz': 2, 'deep-conventional': 3, 'conventional-vert': 4, 'unknown-formation': 5, 'gas-weighted': 6 };
      return (order[a.profileId] || 99) - (order[b.profileId] || 99);
    });

    // Step 6: Build byFormation summary
    const formationMap = new Map<string, {
      formationGroup: string;
      wellCount: number;
      breakevenSum: number;
      breakevenCount: number;
      profileDistribution: Record<string, number>;
      atRiskCount: number;
    }>();

    for (const w of wells) {
      const fg = w.formationGroup || 'Unknown';
      let entry = formationMap.get(fg);
      if (!entry) {
        entry = { formationGroup: fg, wellCount: 0, breakevenSum: 0, breakevenCount: 0, profileDistribution: {}, atRiskCount: 0 };
        formationMap.set(fg, entry);
      }
      entry.wellCount++;
      if (w.halfCycleBreakeven !== null) {
        entry.breakevenSum += w.halfCycleBreakeven;
        entry.breakevenCount++;
      }
      entry.profileDistribution[w.profileId] = (entry.profileDistribution[w.profileId] || 0) + 1;
      if (w.riskLevel === 'at_risk') entry.atRiskCount++;
    }

    const byFormation = Array.from(formationMap.values())
      .map(f => ({
        formationGroup: f.formationGroup,
        wellCount: f.wellCount,
        avgBreakeven: f.breakevenCount > 0 ? Math.round(f.breakevenSum / f.breakevenCount * 100) / 100 : null,
        profileDistribution: f.profileDistribution,
        atRiskCount: f.atRiskCount
      }))
      .sort((a, b) => b.wellCount - a.wellCount);

    // Step 7: Build response
    const profileCount = wells.filter(w => w.profileId !== 'unknown-formation').length;
    const coverageRate = allWells.length > 0 ? Math.round((profileCount / allWells.length) * 100) : 0;

    const responseData = {
      wtiPrice: { price: wtiPrice, date: priceDate, source: priceSource },
      henryHubPrice: henryHubPrice ? { price: henryHubPrice, date: priceDate } : null,
      summary: {
        totalWells: allWells.length,
        atRiskCount,
        tightCount,
        adequateCount,
        comfortableCount,
        gasWeightedCount,
        avgCushion: scoredCount > 0 ? Math.round(scoredCushionSum / scoredCount * 100) / 100 : 0,
        coverageRate
      },
      wells,
      byProfile,
      byFormation
    };

    // Cache for 1 hour
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(`well-risk-profile:${cacheId}`, JSON.stringify(responseData), { expirationTtl: 3600 });
      } catch (e) {
        console.error('[Well Risk Profile] Cache write error:', e);
      }
    }

    return jsonResponse(responseData);

  } catch (error) {
    console.error('[Well Risk Profile] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load well risk profile',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
