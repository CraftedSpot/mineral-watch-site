/**
 * Operator Efficiency Index Handlers
 *
 * API endpoints for the Operator Directory - a market research tool
 * showing statewide operator metrics including PCRR (Post-Production
 * Cost Recovery Ratio), county benchmarking, and efficiency tiers.
 *
 * Key Metrics:
 * - PCRR: Product 6 / Product 5 deductions × 100 (plant efficiency)
 * - Total Liquid ROI: (Product 3 + 6) / Product 5 × 100 (includes wellhead)
 * - Dry Gas Profile: When Product 2 > 80% of gross value
 * - County Variance: Operator rate vs county median
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserFromSession } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Operator Directory is limited to specific organizations during beta
const OPERATORS_ALLOWED_ORGS = [
  'rec9fYy8Xwl3jNAbf', // Price Minerals
];

// Minimum gross volume for county benchmark inclusion (filters trivial operators)
const MIN_BENCHMARK_VOLUME = 10000;

// Efficiency tier types
type EfficiencyTier = 'outperformer' | 'standard' | 'outlier' | 'dry_gas_focus';

function isOperatorsAllowed(orgId: string | undefined): boolean {
  return orgId ? OPERATORS_ALLOWED_ORGS.includes(orgId) : false;
}

/**
 * Calculate true median from an array of numbers
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Get county median deduction rates using true median calculation
 */
async function getCountyBenchmarks(env: Env, sixMonthsAgo: string): Promise<Map<string, number>> {
  const result = await env.WELLS_DB.prepare(`
    SELECT
      ol.county,
      ol.operator_number,
      ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) * 100.0
            / NULLIF(SUM(opf.gross_value), 0), 1) AS deduction_pct,
      SUM(opf.gross_value) AS volume
    FROM otc_production_financial opf
    JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
    WHERE opf.gross_value > 0
      AND opf.year_month >= ?
      AND ol.county IS NOT NULL
      AND ol.operator_number IS NOT NULL
    GROUP BY ol.county, ol.operator_number
    HAVING volume > ?
      AND SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) > 0
  `).bind(sixMonthsAgo, MIN_BENCHMARK_VOLUME).all();

  interface CountyOperatorRate {
    county: string;
    operator_number: string;
    deduction_pct: number;
    volume: number;
  }

  const rates = result.results as unknown as CountyOperatorRate[];

  // Group by county
  const byCounty = new Map<string, number[]>();
  for (const rate of rates) {
    if (rate.deduction_pct === null) continue;
    if (!byCounty.has(rate.county)) {
      byCounty.set(rate.county, []);
    }
    byCounty.get(rate.county)!.push(rate.deduction_pct);
  }

  // Calculate true median for each county (min 3 operators for statistical relevance)
  const benchmarks = new Map<string, number>();
  for (const [county, pcts] of byCounty) {
    if (pcts.length < 3) continue;
    const median = calculateMedian(pcts);
    benchmarks.set(county, Math.round(median * 10) / 10);
  }

  return benchmarks;
}

/**
 * Classify operator into efficiency tier
 */
function classifyTier(
  pcrr: number | null,
  countyVariance: number | null,
  isDryGas: boolean
): EfficiencyTier {
  if (isDryGas) return 'dry_gas_focus';
  if (pcrr !== null && pcrr > 100 && (countyVariance ?? 0) < 0) return 'outperformer';
  if (pcrr !== null && pcrr < 10 && (countyVariance ?? 0) > 20) return 'outlier';
  return 'standard';
}

/**
 * Generate Technical Auditor Note based on efficiency tier
 */
function generateAuditorNote(
  tier: EfficiencyTier,
  pcrr: number | null,
  countyVariance: number | null,
  primaryCounty: string | null,
  gatheringCostPerMcf: number | null,
  countyMedianCostPerMcf: number | null
): string {
  switch (tier) {
    case 'outperformer':
      return `Data indicates high operational efficiency. Liquid recovery offsets (Product 6) ` +
        `exceed aggregate processing fees (Product 5) with a PCRR of ${pcrr}%, ` +
        `suggesting a value-enhancement model that outperforms regional benchmarks ` +
        `by ${Math.abs(countyVariance ?? 0)} percentage points.`;

    case 'outlier': {
      const deductionMultiple = pcrr && pcrr > 0 ? 100 / pcrr : 0;
      return `Elevated variance from regional norms detected. ` +
        `Aggregate processing expenses (Product 5) are ${deductionMultiple.toFixed(1)}x ` +
        `higher than total liquid recovery (Product 6). ` +
        `This PCRR of ${pcrr}% is in the bottom decile of Oklahoma operators. ` +
        `This pattern may reflect legacy contract terms, remote geography, or ` +
        `processing arrangements that warrant detailed review.`;
    }

    case 'dry_gas_focus':
      if (gatheringCostPerMcf !== null && countyMedianCostPerMcf !== null) {
        return `Dry Gas Profile: Efficiency is measured via Unit Cost (Deductions per MCF). ` +
          `Operator expenses are $${gatheringCostPerMcf.toFixed(3)}/MCF, ` +
          `compared to a regional median of $${countyMedianCostPerMcf.toFixed(3)}/MCF.`;
      }
      return `Dry Gas Profile: This operator primarily produces dry gas (Product 2 > 80%). ` +
        `PCRR metrics are less applicable; efficiency should be evaluated via gathering cost per MCF.`;

    case 'standard':
    default:
      return `Post-production cost structures are consistent with regional medians. ` +
        `PCRR of ${pcrr ?? 'N/A'}% remains within standard operating range ` +
        `for the ${primaryCounty || 'Oklahoma'} area.`;
  }
}

/**
 * GET /api/operators/directory
 *
 * Returns statewide operator metrics for the Operator Directory.
 * Query params:
 *   - search: optional name search
 *   - sort: 'deduction_ratio' | 'ngl_recovery' | 'well_count' | 'name' (default: well_count desc)
 *   - limit: number of results (default 100, max 500)
 *   - offset: pagination offset
 *   - min_wells: minimum well count filter (default 20)
 */
export async function handleGetOperatorDirectory(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    // Beta: Limited to allowed organizations
    if (!isOperatorsAllowed(userOrgId)) {
      return jsonResponse({ error: 'Operator Directory is not yet available for your account' }, 403);
    }

    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim().toUpperCase() || '';
    const sort = url.searchParams.get('sort') || 'well_count';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const minWells = parseInt(url.searchParams.get('min_wells') || '20');

    // Cache key includes search/sort/pagination params
    const cacheKey = `operator-directory:${search}:${sort}:${limit}:${offset}:${minWells}`;

    // Check KV cache (15 min TTL for directory data)
    if (env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get(cacheKey, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Operator Directory] Cache read error:', e);
      }
    }

    const sixMonthsAgo = getMonthsAgo(6);

    // Build sort clause
    let orderBy = 'well_count DESC';
    switch (sort) {
      case 'deduction_ratio':
        orderBy = 'deduction_ratio DESC';
        break;
      case 'ngl_recovery':
      case 'pcrr':
        orderBy = 'pcrr ASC'; // Lower = worse, so ASC shows worst first
        break;
      case 'value_return':
        orderBy = '(os.pcrr_value - os.residue_deductions) ASC'; // Worst (most negative) first
        break;
      case 'name':
        orderBy = 'company_name ASC';
        break;
      case 'well_count':
      default:
        orderBy = 'well_count DESC';
    }

    // Build search clause
    const searchClause = search
      ? `AND oc.company_name LIKE '%' || ? || '%'`
      : '';

    // Get county benchmarks for variance calculation
    const countyBenchmarks = await getCountyBenchmarks(env, sixMonthsAgo);

    // Main query for operator metrics with PCRR, dry gas detection, and contact info
    const query = `
      WITH operator_summary AS (
        SELECT
          ol.operator_number,
          oc.company_name,
          COUNT(DISTINCT ol.base_pun) AS well_count,
          ROUND(SUM(opf.gross_value), 0) AS total_gross,
          ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS residue_deductions,
          -- PCRR: Product 6 ONLY (plant NGLs)
          ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END), 0) AS pcrr_value,
          -- Condensate: Product 3 separately (wellhead liquids)
          ROUND(SUM(CASE WHEN opf.product_code = '3' THEN opf.gross_value ELSE 0 END), 0) AS condensate_value,
          -- Dry Gas: Product 2 for mix detection
          ROUND(SUM(CASE WHEN opf.product_code = '2' THEN opf.gross_value ELSE 0 END), 0) AS dry_gas_value,
          -- Gas volume for gathering efficiency (MCF)
          ROUND(SUM(CASE WHEN opf.product_code IN ('2', '5') THEN opf.gross_volume ELSE 0 END), 0) AS gas_volume_mcf,
          -- Primary county (by volume)
          (SELECT ol2.county FROM otc_leases ol2
           JOIN otc_production_financial opf2 ON SUBSTR(opf2.pun, 1, 10) = ol2.base_pun
           WHERE ol2.operator_number = ol.operator_number
             AND opf2.year_month >= ?
             AND opf2.gross_value > 0
           GROUP BY ol2.county
           ORDER BY SUM(opf2.gross_value) DESC
           LIMIT 1) AS primary_county
        FROM otc_production_financial opf
        JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
        LEFT JOIN otc_companies oc ON ol.operator_number = oc.company_id
        WHERE opf.gross_value > 0
          AND opf.year_month >= ?
          AND ol.operator_number IS NOT NULL
          ${searchClause}
        GROUP BY ol.operator_number
        HAVING well_count >= ?
          AND residue_deductions > 0
      )
      SELECT
        os.operator_number,
        os.company_name,
        os.well_count,
        os.total_gross,
        os.residue_deductions,
        os.pcrr_value,
        os.condensate_value,
        os.dry_gas_value,
        os.gas_volume_mcf,
        os.primary_county,
        ROUND(os.residue_deductions * 100.0 / NULLIF(os.total_gross, 0), 1) AS deduction_ratio,
        -- PCRR: Product 6 / Product 5 deductions
        ROUND(os.pcrr_value * 100.0 / NULLIF(os.residue_deductions, 0), 1) AS pcrr,
        -- Total Liquid ROI: (Product 3 + 6) / Product 5
        ROUND((os.pcrr_value + os.condensate_value) * 100.0 / NULLIF(os.residue_deductions, 0), 1) AS total_liquid_roi,
        -- Dry gas percentage
        ROUND(os.dry_gas_value * 100.0 / NULLIF(os.total_gross, 0), 1) AS dry_gas_pct,
        -- Gathering cost per MCF
        ROUND(os.residue_deductions * 1.0 / NULLIF(os.gas_volume_mcf, 0), 4) AS gathering_cost_per_mcf,
        op.status AS operator_status,
        op.phone,
        op.address,
        op.city,
        op.state,
        op.zip,
        op.contact_name
      FROM operator_summary os
      LEFT JOIN operators op ON os.operator_number = op.operator_number
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    // Bindings: sixMonthsAgo appears twice (once for primary_county subquery, once for main WHERE)
    const bindings = search
      ? [sixMonthsAgo, sixMonthsAgo, search, minWells, limit, offset]
      : [sixMonthsAgo, sixMonthsAgo, minWells, limit, offset];

    const result = await env.WELLS_DB.prepare(query).bind(...bindings).all();

    interface OperatorRow {
      operator_number: string;
      company_name: string | null;
      well_count: number;
      total_gross: number;
      residue_deductions: number;
      pcrr_value: number;
      condensate_value: number;
      dry_gas_value: number;
      gas_volume_mcf: number;
      primary_county: string | null;
      deduction_ratio: number | null;
      pcrr: number | null;
      total_liquid_roi: number | null;
      dry_gas_pct: number | null;
      gathering_cost_per_mcf: number | null;
      operator_status: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      contact_name: string | null;
    }

    const operators = (result.results as unknown as OperatorRow[]).map(row => {
      const isDryGasProfile = (row.dry_gas_pct ?? 0) > 80;
      const countyMedian = row.primary_county ? countyBenchmarks.get(row.primary_county) ?? null : null;
      const countyVariance = countyMedian !== null && row.deduction_ratio !== null
        ? Math.round((row.deduction_ratio - countyMedian) * 10) / 10
        : null;
      const tier = classifyTier(row.pcrr, countyVariance, isDryGasProfile);

      // Net Value Return = what was returned minus what was taken (positive = good)
      const netValueReturn = (row.pcrr_value ?? 0) - (row.residue_deductions ?? 0);

      return {
        operator_number: row.operator_number,
        operator_name: row.company_name || `Operator ${row.operator_number}`,
        well_count: row.well_count,
        total_gross: row.total_gross,
        residue_deductions: row.residue_deductions,
        pcrr_value: row.pcrr_value, // Product 6 - NGL value returned
        net_value_return: netValueReturn, // NGL Returned - Deductions (positive = good)
        // Legacy field for backward compatibility
        deduction_ratio: row.deduction_ratio ?? 0,
        // New PCRR metrics
        pcrr: row.pcrr,
        total_liquid_roi: row.total_liquid_roi,
        dry_gas_pct: row.dry_gas_pct ?? 0,
        is_dry_gas_profile: isDryGasProfile,
        gathering_cost_per_mcf: row.gathering_cost_per_mcf,
        // County benchmarking
        primary_county: row.primary_county,
        county_median_deduction: countyMedian,
        county_variance: countyVariance,
        efficiency_tier: tier,
        // Contact info from operators table
        status: row.operator_status || 'UNKNOWN',
        phone: row.phone,
        address: row.address,
        city: row.city,
        state: row.state,
        zip: row.zip,
        contact_name: row.contact_name
      };
    });

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT ol.operator_number) as total
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      LEFT JOIN otc_companies oc ON ol.operator_number = oc.company_id
      WHERE opf.gross_value > 0
        AND opf.year_month >= ?
        AND ol.operator_number IS NOT NULL
        ${searchClause}
      GROUP BY ol.operator_number
      HAVING COUNT(DISTINCT ol.base_pun) >= ?
    `;

    const countBindings = search ? [sixMonthsAgo, search, minWells] : [sixMonthsAgo, minWells];
    const countResult = await env.WELLS_DB.prepare(`SELECT COUNT(*) as total FROM (${countQuery})`).bind(...countBindings).first() as { total: number } | null;
    const totalCount = countResult?.total || 0;

    // Get statewide averages with PCRR
    const statewideResult = await env.WELLS_DB.prepare(`
      SELECT
        ROUND(SUM(opf.gross_value), 0) AS total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS residue_deductions,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END), 0) AS pcrr_value,
        ROUND(SUM(CASE WHEN opf.product_code = '3' THEN opf.gross_value ELSE 0 END), 0) AS condensate_value
      FROM otc_production_financial opf
      WHERE opf.gross_value > 0
        AND opf.year_month >= ?
    `).bind(sixMonthsAgo).first() as {
      total_gross: number;
      residue_deductions: number;
      pcrr_value: number;
      condensate_value: number;
    } | null;

    // Get distribution counts by Net Value Return category (for all operators, not filtered)
    const distributionResult = await env.WELLS_DB.prepare(`
      WITH operator_nvr AS (
        SELECT
          ol.operator_number,
          SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END)
            - SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) AS net_value_return,
          COUNT(DISTINCT ol.base_pun) AS well_count,
          SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) AS deductions
        FROM otc_production_financial opf
        JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
        WHERE opf.gross_value > 0
          AND opf.year_month >= ?
          AND ol.operator_number IS NOT NULL
        GROUP BY ol.operator_number
        HAVING well_count >= ? AND deductions > 0
      )
      SELECT
        COUNT(*) AS total_operators,
        SUM(well_count) AS total_wells,
        SUM(CASE WHEN net_value_return >= 0 THEN 1 ELSE 0 END) AS positive_count,
        SUM(CASE WHEN net_value_return < 0 AND net_value_return > -1000000 THEN 1 ELSE 0 END) AS neutral_count,
        SUM(CASE WHEN net_value_return <= -1000000 AND net_value_return > -10000000 THEN 1 ELSE 0 END) AS warning_count,
        SUM(CASE WHEN net_value_return <= -10000000 THEN 1 ELSE 0 END) AS danger_count
      FROM operator_nvr
    `).bind(sixMonthsAgo, minWells).first() as {
      total_operators: number;
      total_wells: number;
      positive_count: number;
      neutral_count: number;
      warning_count: number;
      danger_count: number;
    } | null;

    // Build statewide object - always include distribution counts
    const statewide = {
      median_deduction_pct: (statewideResult && statewideResult.total_gross > 0)
        ? Math.round((statewideResult.residue_deductions / statewideResult.total_gross) * 1000) / 10
        : 0,
      avg_pcrr: (statewideResult && statewideResult.residue_deductions > 0)
        ? Math.round((statewideResult.pcrr_value / statewideResult.residue_deductions) * 1000) / 10
        : 0,
      // Distribution counts (always include)
      total_operators: distributionResult?.total_operators || 0,
      total_wells: distributionResult?.total_wells || 0,
      distribution: {
        positive: distributionResult?.positive_count || 0,
        neutral: distributionResult?.neutral_count || 0,
        warning: distributionResult?.warning_count || 0,
        danger: distributionResult?.danger_count || 0
      }
    };

    const response = {
      operators,
      total_count: totalCount,
      statewide,
      // Also include distribution at top level for easier debugging
      distribution: {
        total_operators: distributionResult?.total_operators || 0,
        total_wells: distributionResult?.total_wells || 0,
        positive: distributionResult?.positive_count || 0,
        neutral: distributionResult?.neutral_count || 0,
        warning: distributionResult?.warning_count || 0,
        danger: distributionResult?.danger_count || 0
      },
      analysis_period: '6 months',
      pagination: {
        limit,
        offset,
        has_more: offset + operators.length < totalCount
      }
    };

    // Cache for 15 minutes
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 900 });
      } catch (e) {
        console.error('[Operator Directory] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Operator Directory] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load operator directory',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * GET /api/operators/:operatorNumber
 *
 * Returns detailed data for a single operator including:
 * - Monthly trends
 * - County breakdown
 * - Top wells by production
 */
export async function handleGetOperatorDetail(request: Request, env: Env, operatorNumber: string): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];

    if (!isOperatorsAllowed(userOrgId)) {
      return jsonResponse({ error: 'Operator Directory is not yet available for your account' }, 403);
    }

    const sixMonthsAgo = getMonthsAgo(6);

    // Get county benchmarks
    const countyBenchmarks = await getCountyBenchmarks(env, sixMonthsAgo);

    // Get operator name and contact info
    const operatorInfo = await env.WELLS_DB.prepare(`
      SELECT
        oc.company_name,
        op.status,
        op.phone,
        op.address,
        op.city,
        op.state,
        op.zip,
        op.contact_name
      FROM otc_companies oc
      LEFT JOIN operators op ON oc.company_id = op.operator_number
      WHERE oc.company_id = ?
    `).bind(operatorNumber).first() as {
      company_name: string | null;
      status: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      contact_name: string | null;
    } | null;

    const operatorName = operatorInfo?.company_name || `Operator ${operatorNumber}`;
    const contact = operatorInfo ? {
      status: operatorInfo.status || 'UNKNOWN',
      phone: operatorInfo.phone,
      address: operatorInfo.address,
      city: operatorInfo.city,
      state: operatorInfo.state,
      zip: operatorInfo.zip,
      contact_name: operatorInfo.contact_name
    } : null;

    // Get monthly trend with PCRR metrics
    const monthlyResult = await env.WELLS_DB.prepare(`
      SELECT
        opf.year_month,
        ROUND(SUM(opf.gross_value), 0) AS total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS residue_deductions,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END), 0) AS pcrr_value,
        ROUND(SUM(CASE WHEN opf.product_code = '3' THEN opf.gross_value ELSE 0 END), 0) AS condensate_value,
        ROUND(SUM(CASE WHEN opf.product_code = '2' THEN opf.gross_value ELSE 0 END), 0) AS dry_gas_value,
        ROUND(SUM(CASE WHEN opf.product_code IN ('2', '5') THEN opf.gross_volume ELSE 0 END), 0) AS gas_volume_mcf,
        COUNT(DISTINCT ol.base_pun) AS well_count
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE ol.operator_number = ?
        AND opf.gross_value > 0
        AND opf.year_month >= ?
      GROUP BY opf.year_month
      HAVING residue_deductions > 0
      ORDER BY opf.year_month DESC
    `).bind(operatorNumber, sixMonthsAgo).all();

    interface MonthlyRow {
      year_month: string;
      total_gross: number;
      residue_deductions: number;
      pcrr_value: number;
      condensate_value: number;
      dry_gas_value: number;
      gas_volume_mcf: number;
      well_count: number;
    }

    const monthly = (monthlyResult.results as unknown as MonthlyRow[]).map(row => ({
      year_month: row.year_month,
      total_gross: row.total_gross,
      residue_deductions: row.residue_deductions,
      pcrr_value: row.pcrr_value,
      well_count: row.well_count,
      deduction_ratio: row.total_gross > 0
        ? Math.round((row.residue_deductions / row.total_gross) * 1000) / 10
        : 0,
      pcrr: row.residue_deductions > 0
        ? Math.round((row.pcrr_value / row.residue_deductions) * 1000) / 10
        : null
    }));

    // Get county breakdown with deduction rates
    const countyResult = await env.WELLS_DB.prepare(`
      SELECT
        ol.county,
        COUNT(DISTINCT ol.base_pun) AS well_count,
        ROUND(SUM(opf.gross_value), 0) AS total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS residue_deductions,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END), 0) AS pcrr_value
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE ol.operator_number = ?
        AND opf.gross_value > 0
        AND opf.year_month >= ?
      GROUP BY ol.county
      HAVING residue_deductions > 0
      ORDER BY total_gross DESC
      LIMIT 10
    `).bind(operatorNumber, sixMonthsAgo).all();

    interface CountyRow {
      county: string;
      well_count: number;
      total_gross: number;
      residue_deductions: number;
      pcrr_value: number;
    }

    const counties = (countyResult.results as unknown as CountyRow[]).map(row => ({
      county: row.county,
      well_count: row.well_count,
      total_gross: row.total_gross,
      deduction_pct: row.total_gross > 0
        ? Math.round((row.residue_deductions / row.total_gross) * 1000) / 10
        : 0,
      county_median: countyBenchmarks.get(row.county) ?? null
    }));

    // Calculate totals from monthly data
    const totals = monthly.reduce((acc, m) => ({
      total_gross: acc.total_gross + m.total_gross,
      residue_deductions: acc.residue_deductions + m.residue_deductions,
      pcrr_value: acc.pcrr_value + m.pcrr_value
    }), { total_gross: 0, residue_deductions: 0, pcrr_value: 0 });

    // Calculate aggregate metrics
    const deductionRatio = totals.total_gross > 0
      ? Math.round((totals.residue_deductions / totals.total_gross) * 1000) / 10
      : 0;
    const pcrr = totals.residue_deductions > 0
      ? Math.round((totals.pcrr_value / totals.residue_deductions) * 1000) / 10
      : null;

    // Get primary county (highest volume)
    const primaryCounty = counties.length > 0 ? counties[0].county : null;
    const countyMedian = primaryCounty ? countyBenchmarks.get(primaryCounty) ?? null : null;
    const countyVariance = countyMedian !== null
      ? Math.round((deductionRatio - countyMedian) * 10) / 10
      : null;

    // Dry gas detection from totals
    const dryGasResult = await env.WELLS_DB.prepare(`
      SELECT
        ROUND(SUM(CASE WHEN opf.product_code = '2' THEN opf.gross_value ELSE 0 END) * 100.0
              / NULLIF(SUM(opf.gross_value), 0), 1) AS dry_gas_pct,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END)
              / NULLIF(SUM(CASE WHEN opf.product_code IN ('2', '5') THEN opf.gross_volume ELSE 0 END), 0), 4) AS gathering_cost_per_mcf
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE ol.operator_number = ?
        AND opf.gross_value > 0
        AND opf.year_month >= ?
    `).bind(operatorNumber, sixMonthsAgo).first() as {
      dry_gas_pct: number | null;
      gathering_cost_per_mcf: number | null;
    } | null;

    const dryGasPct = dryGasResult?.dry_gas_pct ?? 0;
    const isDryGasProfile = dryGasPct > 80;
    const gatheringCostPerMcf = dryGasResult?.gathering_cost_per_mcf ?? null;

    // Calculate efficiency tier and generate auditor note
    const tier = classifyTier(pcrr, countyVariance, isDryGasProfile);
    const technicalAuditorNote = generateAuditorNote(
      tier,
      pcrr,
      countyVariance,
      primaryCounty,
      gatheringCostPerMcf,
      null // TODO: county median cost per MCF
    );

    return jsonResponse({
      operator_number: operatorNumber,
      operator_name: operatorName,
      contact,
      // Efficiency Scorecard
      efficiency: {
        pcrr,
        deduction_ratio: deductionRatio,
        dry_gas_pct: dryGasPct,
        is_dry_gas_profile: isDryGasProfile,
        tier,
        county_median: countyMedian,
        county_variance: countyVariance,
        gathering_cost_per_mcf: gatheringCostPerMcf,
        technical_auditor_note: technicalAuditorNote
      },
      summary: {
        total_gross: totals.total_gross,
        residue_deductions: totals.residue_deductions,
        pcrr_value: totals.pcrr_value,
        deduction_ratio: deductionRatio,
        pcrr,
        well_count: monthly.length > 0 ? Math.max(...monthly.map(m => m.well_count)) : 0
      },
      monthly,
      counties,
      analysis_period: '6 months'
    });

  } catch (error) {
    console.error('[Operator Detail] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load operator details',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// Utility function
function getMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}
