/**
 * Operator Handlers
 *
 * Split into two reports:
 * 1. Operator Directory - Contact info, counties, well count (no financial data)
 * 2. Operator Efficiency Index - PCRR, deductions, financial metrics (paginated)
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserFromSession } from '../services/airtable.js';
import { classifyOperatorGor } from '../utils/gor-classification.js';
import type { Env } from '../types/env.js';

const OPERATORS_ALLOWED_ORGS = [
  'rec9fYy8Xwl3jNAbf', // Price Minerals
];

function isOperatorsAllowed(orgId: string | undefined): boolean {
  return orgId ? OPERATORS_ALLOWED_ORGS.includes(orgId) : false;
}

function getMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

// ============================================
// OPERATOR DIRECTORY (No financial data - fast)
// ============================================

/**
 * GET /api/operators/directory
 *
 * Returns operator contact info, counties, and well counts.
 * No OTC financial joins - should be fast.
 */
export async function handleGetOperatorDirectory(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isOperatorsAllowed(userOrgId)) {
      return jsonResponse({ error: 'Operator Directory is not yet available for your account' }, 403);
    }

    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim().toUpperCase() || '';
    const minWells = parseInt(url.searchParams.get('min_wells') || '20');

    // Cache key
    const cacheKey = `operator-directory-v4:${minWells}:${search.substring(0, 20)}`;

    // Check cache
    if (env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get(cacheKey, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Operator Directory] Cache read error:', e);
      }
    }

    // Simple query - NO otc_production_financial joins
    // Just operators + companies + lease counts
    const searchClause = search ? `AND oc.company_name LIKE '%' || ? || '%'` : '';

    const query = `
      SELECT
        oc.company_id AS operator_number,
        oc.company_name,
        op.status,
        op.phone,
        op.address,
        op.city,
        op.state,
        op.zip,
        op.contact_name,
        COUNT(DISTINCT ol.base_pun) AS well_count,
        GROUP_CONCAT(DISTINCT ol.county) AS counties
      FROM otc_companies oc
      LEFT JOIN operators op ON oc.company_id = op.operator_number
      LEFT JOIN otc_leases ol ON oc.company_id = ol.operator_number
      WHERE 1=1
        ${searchClause}
      GROUP BY oc.company_id
      HAVING well_count >= ?
      ORDER BY well_count DESC
    `;

    const bindings = search
      ? [search, minWells]
      : [minWells];

    const result = await env.WELLS_DB.prepare(query).bind(...bindings).all();

    interface DirectoryRow {
      operator_number: string;
      company_name: string | null;
      status: string | null;
      phone: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      contact_name: string | null;
      well_count: number;
      counties: string | null;
    }

    const operators = (result.results as unknown as DirectoryRow[]).map(row => ({
      operator_number: row.operator_number,
      operator_name: row.company_name || `Operator ${row.operator_number}`,
      well_count: row.well_count,
      counties: row.counties ? row.counties.split(',').slice(0, 5) : [], // Top 5 counties
      status: row.status || 'UNKNOWN',
      phone: row.phone,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      contact_name: row.contact_name
    }));

    const response = {
      operators,
      total_count: operators.length
    };

    // Cache for 1 hour (directory data doesn't change often)
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 3600 });
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

// ============================================
// OPERATOR EFFICIENCY INDEX (Financial data - paginated)
// ============================================

/**
 * GET /api/operators/efficiency
 *
 * Returns PCRR, Net Value Return, deduction metrics.
 * Uses pagination to stay within D1 limits.
 */
export async function handleGetOperatorEfficiency(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isOperatorsAllowed(userOrgId)) {
      return jsonResponse({ error: 'Operator Efficiency Index is not yet available for your account' }, 403);
    }

    const url = new URL(request.url);
    const minWells = parseInt(url.searchParams.get('min_wells') || '20');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const sort = url.searchParams.get('sort') || 'well_count';

    // Cache key
    const cacheKey = `operator-efficiency-v1:${minWells}:${limit}:${offset}:${sort}`;

    // Check cache
    if (env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get(cacheKey, 'json');
        if (cached) return jsonResponse(cached);
      } catch (e) {
        console.error('[Operator Efficiency] Cache read error:', e);
      }
    }

    const sixMonthsAgo = getMonthsAgo(6);
    const sortDir = url.searchParams.get('sort_dir') === 'asc' ? 'ASC' : 'DESC';

    // Build ORDER BY clause
    let orderBy = 'well_count DESC';
    switch (sort) {
      case 'well_count':
        orderBy = `well_count ${sortDir}`;
        break;
      case 'net_value_return':
        orderBy = `net_value_return ${sortDir}`;
        break;
      case 'pcrr':
        orderBy = `pcrr ${sortDir} NULLS LAST`;
        break;
      case 'pcrr_value':
        orderBy = `pcrr_value ${sortDir}`;
        break;
      case 'deductions':
        orderBy = `residue_deductions ${sortDir}`;
        break;
      case 'name':
        orderBy = `company_name ${sortDir}`;
        break;
    }

    // Financial query with pagination
    const result = await env.WELLS_DB.prepare(`
      SELECT
        ol.operator_number,
        oc.company_name,
        op.status,
        MAX(ol.county) AS primary_county,
        COUNT(DISTINCT ol.base_pun) AS well_count,
        ROUND(SUM(opf.gross_value), 0) AS total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS residue_deductions,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) * 100.0
              / NULLIF(SUM(opf.gross_value), 0), 1) AS deduction_pct,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END), 0) AS pcrr_value,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END)
              - SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS net_value_return,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END) * 100.0
              / NULLIF(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0), 1) AS pcrr
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      LEFT JOIN otc_companies oc ON ol.operator_number = oc.company_id
      LEFT JOIN operators op ON ol.operator_number = op.operator_number
      WHERE opf.gross_value > 0
        AND opf.year_month >= ?
        AND ol.operator_number IS NOT NULL
      GROUP BY ol.operator_number
      HAVING well_count >= ?
        AND residue_deductions > 0
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(sixMonthsAgo, minWells, limit, offset).all();

    interface EfficiencyRow {
      operator_number: string;
      company_name: string | null;
      status: string | null;
      well_count: number;
      total_gross: number;
      residue_deductions: number;
      deduction_pct: number | null;
      pcrr_value: number;
      net_value_return: number;
      pcrr: number | null;
      primary_county: string | null;
    }

    // Get primary purchaser for each operator (most common purchaser by volume)
    const operatorNumbers = (result.results as unknown as EfficiencyRow[]).map(r => r.operator_number);

    // GOR classification — runs in parallel with purchaser queries
    const gorOpPromise = classifyOperatorGor(env.WELLS_DB!, operatorNumbers);

    // Query for primary purchaser per operator
    const purchaserResult = await env.WELLS_DB.prepare(`
      SELECT
        ol.operator_number,
        opf.purchaser_id,
        SUM(opf.gross_value) as volume
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE opf.product_code = '5'
        AND opf.purchaser_id IS NOT NULL
        AND opf.purchaser_id != ''
        AND opf.year_month >= ?
        AND opf.gross_value > 0
      GROUP BY ol.operator_number, opf.purchaser_id
      ORDER BY ol.operator_number, volume DESC
    `).bind(sixMonthsAgo).all();

    // Build map of operator -> primary purchaser (highest volume)
    const purchaserMap = new Map<string, string>();
    for (const row of purchaserResult.results as Array<{operator_number: string; purchaser_id: string; volume: number}>) {
      if (!purchaserMap.has(row.operator_number)) {
        purchaserMap.set(row.operator_number, row.purchaser_id);
      }
    }

    // Get purchaser names from otc_companies
    const uniquePurchaserIds = [...new Set(purchaserMap.values())];
    const purchaserNames = new Map<string, string>();

    if (uniquePurchaserIds.length > 0) {
      // Query in batches to avoid too many placeholders
      const batchSize = 100;
      for (let i = 0; i < uniquePurchaserIds.length; i += batchSize) {
        const batch = uniquePurchaserIds.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        const nameResult = await env.WELLS_DB.prepare(
          `SELECT company_id, company_name FROM otc_companies WHERE company_id IN (${placeholders})`
        ).bind(...batch).all();

        for (const row of nameResult.results as Array<{company_id: string; company_name: string}>) {
          purchaserNames.set(row.company_id, row.company_name);
        }
      }
    }

    // Helper for fuzzy name matching
    function isAffiliated(operatorNumber: string, operatorName: string, purchaserId: string | null, purchaserName: string | null): boolean {
      if (!purchaserId) return false;
      // ID match
      if (operatorNumber === purchaserId) return true;
      // Fuzzy name match
      if (operatorName && purchaserName) {
        const opNorm = operatorName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const purchNorm = purchaserName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (opNorm.length > 5 && purchNorm.includes(opNorm.substring(0, 10))) return true;
        if (purchNorm.length > 5 && opNorm.includes(purchNorm.substring(0, 10))) return true;
      }
      return false;
    }

    // Await GOR classifications
    let gorOpMap = new Map<string, any>();
    try {
      gorOpMap = await gorOpPromise;
    } catch (e) {
      console.error('[Operator Efficiency] GOR classification error:', e);
    }

    const operators = (result.results as unknown as EfficiencyRow[]).map(row => {
      const purchaserId = purchaserMap.get(row.operator_number) || null;
      const purchaserName = purchaserId ? (purchaserNames.get(purchaserId) || `Purchaser ${purchaserId}`) : null;
      const operatorName = row.company_name || `Operator ${row.operator_number}`;

      return {
        operator_number: row.operator_number,
        operator_name: operatorName,
        status: row.status || 'UNKNOWN',
        well_count: row.well_count,
        total_gross: row.total_gross,
        residue_deductions: row.residue_deductions,
        deduction_pct: row.deduction_pct,
        pcrr_value: row.pcrr_value,
        net_value_return: row.net_value_return,
        pcrr: row.pcrr,
        primary_county: row.primary_county,
        primary_purchaser_id: purchaserId,
        primary_purchaser_name: purchaserName,
        is_affiliated: isAffiliated(row.operator_number, operatorName, purchaserId, purchaserName),
        gas_profile: gorOpMap.get(row.operator_number)?.label || null
      };
    });

    // Get total count (separate lighter query)
    const countResult = await env.WELLS_DB.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT ol.operator_number
        FROM otc_production_financial opf
        JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
        WHERE opf.gross_value > 0
          AND opf.year_month >= ?
          AND ol.operator_number IS NOT NULL
        GROUP BY ol.operator_number
        HAVING COUNT(DISTINCT ol.base_pun) >= ?
          AND SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END) > 0
      )
    `).bind(sixMonthsAgo, minWells).first() as { cnt: number } | null;

    const totalCount = countResult?.cnt || 0;

    // Calculate distribution from current page
    const distribution = operators.reduce((acc, op) => {
      acc.total_wells += op.well_count;
      if (op.net_value_return >= 0) acc.positive++;
      else if (op.net_value_return > -1000000) acc.neutral++;
      else if (op.net_value_return > -10000000) acc.warning++;
      else acc.danger++;
      return acc;
    }, { total_wells: 0, positive: 0, neutral: 0, warning: 0, danger: 0 });

    const response = {
      operators,
      total_count: totalCount,
      distribution: {
        total_operators: totalCount,
        page_wells: distribution.total_wells,
        positive: distribution.positive,
        neutral: distribution.neutral,
        warning: distribution.warning,
        danger: distribution.danger
      },
      pagination: {
        limit,
        offset,
        has_more: offset + operators.length < totalCount
      },
      analysis_period: '6 months'
    };

    // Cache for 15 minutes
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 900 });
      } catch (e) {
        console.error('[Operator Efficiency] Cache write error:', e);
      }
    }

    return jsonResponse(response);

  } catch (error) {
    console.error('[Operator Efficiency] Error:', error instanceof Error ? error.message : error);
    return jsonResponse({
      error: 'Failed to load operator efficiency data',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// ============================================
// OPERATOR DETAIL (Single operator view)
// ============================================

/**
 * GET /api/operators/:operatorNumber
 */
export async function handleGetOperatorDetail(request: Request, env: Env, operatorNumber: string): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isOperatorsAllowed(userOrgId)) {
      return jsonResponse({ error: 'Not available for your account' }, 403);
    }

    const sixMonthsAgo = getMonthsAgo(6);

    // Get operator info (fast - no financial joins)
    const operatorInfo = await env.WELLS_DB.prepare(`
      SELECT
        oc.company_name,
        op.status, op.phone, op.address, op.city, op.state, op.zip, op.contact_name,
        (SELECT GROUP_CONCAT(DISTINCT county) FROM otc_leases WHERE operator_number = oc.company_id) AS counties
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
      counties: string | null;
    } | null;

    // Get monthly financial data
    const monthlyResult = await env.WELLS_DB.prepare(`
      SELECT
        opf.year_month,
        ROUND(SUM(opf.gross_value), 0) AS total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS residue_deductions,
        ROUND(SUM(CASE WHEN opf.product_code = '6' THEN opf.gross_value ELSE 0 END), 0) AS pcrr_value,
        COUNT(DISTINCT ol.base_pun) AS well_count
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE ol.operator_number = ?
        AND opf.gross_value > 0
        AND opf.year_month >= ?
      GROUP BY opf.year_month
      ORDER BY opf.year_month DESC
    `).bind(operatorNumber, sixMonthsAgo).all();

    // Get county breakdown
    const countyResult = await env.WELLS_DB.prepare(`
      SELECT
        ol.county,
        COUNT(DISTINCT ol.base_pun) AS well_count,
        ROUND(SUM(opf.gross_value), 0) AS total_gross,
        ROUND(SUM(CASE WHEN opf.product_code = '5' THEN opf.market_deduction ELSE 0 END), 0) AS residue_deductions
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE ol.operator_number = ?
        AND opf.gross_value > 0
        AND opf.year_month >= ?
      GROUP BY ol.county
      ORDER BY total_gross DESC
      LIMIT 10
    `).bind(operatorNumber, sixMonthsAgo).all();

    interface MonthlyRow {
      year_month: string;
      total_gross: number;
      residue_deductions: number;
      pcrr_value: number;
      well_count: number;
    }

    interface CountyRow {
      county: string;
      well_count: number;
      total_gross: number;
      residue_deductions: number;
    }

    const monthly = (monthlyResult.results as unknown as MonthlyRow[]).map(row => ({
      year_month: row.year_month,
      total_gross: row.total_gross,
      residue_deductions: row.residue_deductions,
      pcrr_value: row.pcrr_value,
      well_count: row.well_count,
      deduction_ratio: row.total_gross > 0
        ? Math.round((row.residue_deductions / row.total_gross) * 1000) / 10 : 0,
      pcrr: row.residue_deductions > 0
        ? Math.round((row.pcrr_value / row.residue_deductions) * 1000) / 10 : null
    }));

    const counties = (countyResult.results as unknown as CountyRow[]).map(row => ({
      county: row.county,
      well_count: row.well_count,
      total_gross: row.total_gross,
      deduction_pct: row.total_gross > 0
        ? Math.round((row.residue_deductions / row.total_gross) * 1000) / 10 : 0
    }));

    // Calculate totals
    const totals = monthly.reduce((acc, m) => ({
      total_gross: acc.total_gross + m.total_gross,
      residue_deductions: acc.residue_deductions + m.residue_deductions,
      pcrr_value: acc.pcrr_value + m.pcrr_value
    }), { total_gross: 0, residue_deductions: 0, pcrr_value: 0 });

    const deductionRatio = totals.total_gross > 0
      ? Math.round((totals.residue_deductions / totals.total_gross) * 1000) / 10 : 0;
    const pcrr = totals.residue_deductions > 0
      ? Math.round((totals.pcrr_value / totals.residue_deductions) * 1000) / 10 : null;

    // Get primary purchaser for this operator
    const purchaserResult = await env.WELLS_DB.prepare(`
      SELECT
        opf.purchaser_id,
        SUM(opf.gross_value) as volume
      FROM otc_production_financial opf
      JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
      WHERE ol.operator_number = ?
        AND opf.product_code = '5'
        AND opf.purchaser_id IS NOT NULL
        AND opf.purchaser_id != ''
        AND opf.year_month >= ?
        AND opf.gross_value > 0
      GROUP BY opf.purchaser_id
      ORDER BY volume DESC
      LIMIT 1
    `).bind(operatorNumber, sixMonthsAgo).first() as { purchaser_id: string; volume: number } | null;

    let primaryPurchaserId: string | null = null;
    let primaryPurchaserName: string | null = null;
    let isAffiliated = false;

    if (purchaserResult?.purchaser_id) {
      primaryPurchaserId = purchaserResult.purchaser_id;

      // Get purchaser name
      const purchaserNameResult = await env.WELLS_DB.prepare(
        `SELECT company_name FROM otc_companies WHERE company_id = ?`
      ).bind(primaryPurchaserId).first() as { company_name: string } | null;

      primaryPurchaserName = purchaserNameResult?.company_name || `Purchaser ${primaryPurchaserId}`;

      // Check affiliation
      const operatorName = operatorInfo?.company_name || '';
      if (operatorNumber === primaryPurchaserId) {
        isAffiliated = true;
      } else if (operatorName && primaryPurchaserName) {
        const opNorm = operatorName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const purchNorm = primaryPurchaserName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (opNorm.length > 5 && purchNorm.includes(opNorm.substring(0, 10))) isAffiliated = true;
        if (purchNorm.length > 5 && opNorm.includes(purchNorm.substring(0, 10))) isAffiliated = true;
      }
    }

    return jsonResponse({
      operator_number: operatorNumber,
      operator_name: operatorInfo?.company_name || `Operator ${operatorNumber}`,
      contact: operatorInfo ? {
        status: operatorInfo.status || 'UNKNOWN',
        phone: operatorInfo.phone,
        address: operatorInfo.address,
        city: operatorInfo.city,
        state: operatorInfo.state,
        zip: operatorInfo.zip,
        contact_name: operatorInfo.contact_name
      } : null,
      all_counties: operatorInfo?.counties?.split(',') || [],
      summary: {
        total_gross: totals.total_gross,
        residue_deductions: totals.residue_deductions,
        pcrr_value: totals.pcrr_value,
        net_value_return: totals.pcrr_value - totals.residue_deductions,
        deduction_ratio: deductionRatio,
        pcrr,
        well_count: monthly.length > 0 ? Math.max(...monthly.map(m => m.well_count)) : 0
      },
      efficiency: {
        pcrr,
        deduction_ratio: deductionRatio
      },
      purchaser: {
        primary_purchaser_id: primaryPurchaserId,
        primary_purchaser_name: primaryPurchaserName,
        is_affiliated: isAffiliated
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
