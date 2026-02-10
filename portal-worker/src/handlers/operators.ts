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
// OPERATOR NAME → NUMBER LOOKUP
// ============================================

/**
 * GET /api/operators/lookup?name=OPERATOR NAME
 *
 * Resolves an operator name (from wells table) to an operator_number (from otc_companies).
 * Uses progressively fuzzier matching: exact → stripped suffixes → first two words → first word.
 */
export async function handleGetOperatorLookup(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || '').trim().toUpperCase();
    if (!name) return jsonResponse({ error: 'Missing name parameter' }, 400);

    // Try exact match first
    let result = await env.WELLS_DB!.prepare(
      `SELECT company_id, company_name FROM otc_companies WHERE UPPER(company_name) = ? LIMIT 1`
    ).bind(name).first() as any;

    // Try with suffixes stripped
    if (!result) {
      const stripped = name
        .replace(/[,.]*/g, '')
        .replace(/\b(LLC|INC|CORP|CORPORATION|CO|LP|LLP|LTD|COMPANY|OPERATING)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (stripped !== name) {
        result = await env.WELLS_DB!.prepare(
          `SELECT company_id, company_name FROM otc_companies WHERE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(company_name, ',', ''), '.', ''), ' LLC', ''), ' INC', ''), ' CORP', ''), ' CORPORATION', ''), ' CO', ''), ' LP', ''), ' LLP', ''), ' LTD', '')) LIKE '%' || ? || '%' LIMIT 1`
        ).bind(stripped).first() as any;
      }
    }

    // Try LIKE search with cleaned name
    if (!result) {
      const cleaned = name
        .replace(/[&,.]*/g, '')
        .replace(/\b(LLC|INC|CORP|CORPORATION|CO|LP|LLP|LTD|COMPANY|OPERATING)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      result = await env.WELLS_DB!.prepare(
        `SELECT company_id, company_name FROM otc_companies WHERE UPPER(company_name) LIKE '%' || ? || '%' ORDER BY LENGTH(company_name) ASC LIMIT 1`
      ).bind(cleaned).first() as any;
    }

    // Try first two words
    if (!result) {
      const words = name.replace(/[^A-Z0-9\s]/g, '').trim().split(/\s+/);
      if (words.length >= 2) {
        const twoWords = words.slice(0, 2).join(' ');
        result = await env.WELLS_DB!.prepare(
          `SELECT company_id, company_name FROM otc_companies WHERE UPPER(company_name) LIKE ? || '%' ORDER BY LENGTH(company_name) ASC LIMIT 1`
        ).bind(twoWords).first() as any;
      }
    }

    if (result) {
      return jsonResponse({ operator_number: result.company_id, company_name: result.company_name });
    }

    return jsonResponse({ operator_number: null, company_name: null });
  } catch (error) {
    console.error('[Operator Lookup] Error:', error);
    return jsonResponse({ error: 'Lookup failed' }, 500);
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

    // Gas profile classification (GOR-based)
    const gorMap = await classifyOperatorGor(env.WELLS_DB!, [operatorNumber]);
    const gorInfo = gorMap.get(operatorNumber);

    // Production health metrics — subquery approach (single bind param, no D1 variable limit issues)
    // The subquery is fast: otc_leases.operator_number is indexed, result set is small
    let healthResult: {
      total_puns: number; active_puns: number; idle_puns: number;
      recently_idle: number; extended_idle: number; long_term_idle: number;
      avg_decline: number | null; declining_wells: number; growing_wells: number;
    } | null = null;

    healthResult = await env.WELLS_DB.prepare(`
      SELECT
        COUNT(*) as total_puns,
        SUM(CASE WHEN p.months_since_production < 3 THEN 1 ELSE 0 END) as active_puns,
        SUM(CASE WHEN p.months_since_production >= 3 THEN 1 ELSE 0 END) as idle_puns,
        SUM(CASE WHEN p.months_since_production >= 3 AND p.months_since_production < 6 THEN 1 ELSE 0 END) as recently_idle,
        SUM(CASE WHEN p.months_since_production >= 6 AND p.months_since_production < 12 THEN 1 ELSE 0 END) as extended_idle,
        SUM(CASE WHEN p.months_since_production >= 12 THEN 1 ELSE 0 END) as long_term_idle,
        ROUND(AVG(CASE WHEN p.decline_rate_12m BETWEEN -100 AND 100
          AND p.months_since_production < 3 THEN p.decline_rate_12m END), 1) as avg_decline,
        SUM(CASE WHEN p.decline_rate_12m < -5 AND p.months_since_production < 3 THEN 1 ELSE 0 END) as declining_wells,
        SUM(CASE WHEN p.decline_rate_12m > 5 AND p.months_since_production < 3 THEN 1 ELSE 0 END) as growing_wells
      FROM puns p
      WHERE SUBSTR(p.pun, 1, 10) IN (
        SELECT DISTINCT base_pun FROM otc_leases WHERE operator_number = ?
      )
    `).bind(operatorNumber).first();

    return jsonResponse({
      operator_number: operatorNumber,
      operator_name: operatorInfo?.company_name || `Operator ${operatorNumber}`,
      status: operatorInfo?.status || 'UNKNOWN',
      contact: operatorInfo ? {
        status: operatorInfo.status || 'UNKNOWN',
        phone: operatorInfo.phone,
        address: operatorInfo.address,
        city: operatorInfo.city,
        state: operatorInfo.state,
        zip: operatorInfo.zip,
        contact_name: operatorInfo.contact_name
      } : null,
      gas_profile: gorInfo ? {
        label: gorInfo.label,
        lean_pct: gorInfo.lean_pct,
        oil_pct: gorInfo.oil_pct
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
      production_health: healthResult && healthResult.total_puns > 0 ? {
        totalPuns: healthResult.total_puns,
        activePuns: healthResult.active_puns,
        idlePuns: healthResult.idle_puns,
        recentlyIdle: healthResult.recently_idle,
        extendedIdle: healthResult.extended_idle,
        longTermIdle: healthResult.long_term_idle,
        idleRatePct: Math.round(healthResult.idle_puns / healthResult.total_puns * 1000) / 10,
        avgDecline: healthResult.avg_decline,
        decliningWells: healthResult.declining_wells,
        growingWells: healthResult.growing_wells
      } : null,
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

// ============================================
// OPERATOR PRINT SUMMARY
// ============================================

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * GET /print/operators/:operatorNumber
 * Generates a print-friendly HTML page for an operator summary
 */
export async function handleOperatorPrint(request: Request, env: Env, operatorNumber: string): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) {
      const url = new URL(request.url);
      return Response.redirect(`/portal/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    const userRecord = await getUserFromSession(env, authUser);
    if (!userRecord) return new Response('User not found', { status: 404 });

    const userOrgId = userRecord.fields.Organization?.[0];
    if (!isOperatorsAllowed(userOrgId)) {
      return new Response('Operator features not available for your account', { status: 403 });
    }

    // Fetch operator detail data by calling the internal handler
    const apiUrl = new URL(`/api/operators/${operatorNumber}`, request.url);
    const apiRequest = new Request(apiUrl.toString(), { method: 'GET', headers: request.headers });
    const response = await handleGetOperatorDetail(apiRequest, env, operatorNumber);
    const data = await response.json() as any;

    if (data.error) {
      return new Response(`Error: ${data.error}`, { status: 500 });
    }

    const html = generateOperatorPrintHtml(data, userRecord.fields.Name || 'User');
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error) {
    console.error('[Operator Print] Error:', error);
    return new Response(`Error generating report: ${error instanceof Error ? error.message : 'Unknown'}`, { status: 500 });
  }
}

function generateOperatorPrintHtml(data: any, userName: string): string {
  const fmt = (n: number) => n != null ? n.toLocaleString('en-US') : '—';
  const fmtDollar = (n: number) => n != null ? '$' + Math.round(n).toLocaleString('en-US') : '—';
  const fmtPct = (n: number | null) => n != null ? n.toFixed(1) + '%' : '—';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const statusLabel = data.status === 'OPEN' ? 'Active' : data.status === 'CLOSED' ? 'Inactive' : data.status || 'Unknown';
  const statusColor = data.status === 'OPEN' ? '#059669' : '#6b7280';

  // Gas profile — use mineral-owner-friendly labels in this general context
  const gasProfileRaw = data.gas_profile?.label || '';
  const gasProfile = gasProfileRaw.includes('Lean') ? 'Primarily Gas' :
                     gasProfileRaw.includes('Rich') ? 'Primarily Oil' :
                     gasProfileRaw ? 'Mixed Portfolio' : 'N/A';

  // Contact
  const contact = data.contact || {};
  const addressParts = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean);
  const fullAddress = addressParts.join(', ');

  // Summary
  const summary = data.summary || {};

  // Production health
  const health = data.production_health;

  // Purchaser
  const purchaser = data.purchaser || {};

  // Monthly trend table
  const monthly = data.monthly || [];
  const monthlyRowsHtml = monthly.map((m: any, i: number) => {
    const ym = String(m.year_month);
    const monthLabel = ym.length === 6
      ? new Date(parseInt(ym.substring(0, 4)), parseInt(ym.substring(4, 6)) - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
      : ym;
    return `<tr class="${i % 2 !== 0 ? 'alt' : ''}">
      <td>${escapeHtml(monthLabel)}</td>
      <td class="right">${fmt(m.well_count)}</td>
      <td class="right">${fmtDollar(m.total_gross)}</td>
      <td class="right">${fmtDollar(m.residue_deductions)}</td>
      <td class="right">${fmtPct(m.deduction_ratio)}</td>
      <td class="right">${m.pcrr != null ? fmtPct(m.pcrr) : '—'}</td>
    </tr>`;
  }).join('');

  // Counties table
  const counties = data.counties || [];
  const countyRowsHtml = counties.map((c: any, i: number) => {
    return `<tr class="${i % 2 !== 0 ? 'alt' : ''}">
      <td>${escapeHtml((c.county || '').replace(/^\d{3}-/, ''))}</td>
      <td class="right">${fmt(c.well_count)}</td>
      <td class="right">${fmtDollar(c.total_gross)}</td>
      <td class="right">${fmtPct(c.deduction_pct)}</td>
    </tr>`;
  }).join('');

  // Idle breakdown bar (if health data exists)
  let idleBarHtml = '';
  if (health && health.idlePuns > 0) {
    const total = health.idlePuns;
    const recentPct = Math.round((health.recentlyIdle / total) * 100);
    const extPct = Math.round((health.extendedIdle / total) * 100);
    const longPct = 100 - recentPct - extPct;
    idleBarHtml = `
      <div style="margin-top: 12px;">
        <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px;">Idle Breakdown</div>
        <div style="display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: #f3f4f6;">
          ${health.recentlyIdle > 0 ? `<div style="width: ${recentPct}%; background: #f59e0b;" title="Recently Idle (3-6mo)"></div>` : ''}
          ${health.extendedIdle > 0 ? `<div style="width: ${extPct}%; background: #f97316;" title="Extended Idle (6-12mo)"></div>` : ''}
          ${health.longTermIdle > 0 ? `<div style="width: ${longPct}%; background: #9ca3af;" title="Long-term Idle (12+mo)"></div>` : ''}
        </div>
        <div style="display: flex; gap: 16px; font-size: 10px; color: #6b7280; margin-top: 4px;">
          ${health.recentlyIdle > 0 ? `<span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; margin-right: 3px;"></span>3-6mo: ${health.recentlyIdle}</span>` : ''}
          ${health.extendedIdle > 0 ? `<span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f97316; margin-right: 3px;"></span>6-12mo: ${health.extendedIdle}</span>` : ''}
          ${health.longTermIdle > 0 ? `<span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; margin-right: 3px;"></span>12+mo: ${health.longTermIdle}</span>` : ''}
        </div>
      </div>`;
  }

  // Monthly chart SVG
  const chartSvg = generateMonthlyChartSvg(monthly);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.operator_name)} - Operator Summary</title>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 20px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .print-controls { max-width: 800px; margin: 0 auto 16px auto; display: flex; justify-content: flex-end; gap: 12px; }
    .print-btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .print-btn.primary { background: #7c3aed; color: white; }
    .print-btn.primary:hover { background: #6d28d9; }
    .print-btn.secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
    .print-btn.secondary:hover { background: #f8fafc; }
    .page { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    @media print {
      body { background: white; padding: 0; }
      .page { box-shadow: none; border-radius: 0; }
      .print-controls { display: none !important; }
    }
    @page { size: letter; margin: 0.25in; }

    .header { background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%); color: white; padding: 28px 32px; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-family: 'Merriweather', serif; font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .header-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
    .header-meta span { font-size: 13px; opacity: 0.9; }
    .status-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 12px; background: rgba(255,255,255,0.2); }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; }
    .gas-pill { font-size: 12px; padding: 2px 10px; border-radius: 12px; background: rgba(255,255,255,0.15); }
    .brand { font-size: 11px; opacity: 0.7; }

    .content { padding: 24px 32px 32px; }

    .section { margin-bottom: 24px; }
    .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #7c3aed; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #ede9fe; }

    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat-box { background: #faf5ff; border: 1px solid #ede9fe; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-value { font-size: 20px; font-weight: 700; color: #1f2937; }
    .stat-label { font-size: 11px; color: #6b7280; margin-top: 2px; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
    .info-item { display: flex; flex-direction: column; padding: 4px 0; }
    .info-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.03em; }
    .info-value { font-size: 14px; color: #1f2937; font-weight: 500; }

    .health-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .health-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; }
    .health-value { font-size: 18px; font-weight: 700; }
    .health-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .green { color: #059669; }
    .amber { color: #d97706; }
    .orange { color: #ea580c; }
    .red { color: #dc2626; }
    .muted { color: #9ca3af; }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 10px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #374151; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
    td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
    .alt td { background: #fafbfc; }
    .right { text-align: right; }
    .center { text-align: center; }
    .bold { font-weight: 600; }
    .danger { color: #dc2626; font-weight: 600; }
    .warning { color: #d97706; font-weight: 600; }
    .good { color: #059669; font-weight: 600; }

    .chart-container { margin: 16px 0; text-align: center; }

    .footer { padding: 16px 32px; background: #f8fafc; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn secondary" onclick="window.close()">&#8592; Back to Dashboard</button>
    <button class="print-btn primary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      Print Summary
    </button>
  </div>

  <div class="page">
    <div class="header">
      <div class="header-top">
        <div>
          <h1>${escapeHtml(data.operator_name)}</h1>
          <div class="header-meta">
            <span>#${escapeHtml(data.operator_number)}</span>
            <span class="status-pill"><span class="status-dot" style="background: ${statusColor};"></span>${escapeHtml(statusLabel)}</span>
            ${data.gas_profile ? `<span class="gas-pill">${gasProfile}</span>` : ''}
          </div>
        </div>
        <div class="brand">Mineral Watch</div>
      </div>
    </div>

    <div class="content">
      <!-- Summary Stats -->
      <div class="section">
        <div class="section-title">6-Month Summary</div>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-value">${fmtDollar(summary.total_gross)}</div>
            <div class="stat-label">Gross Revenue</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${fmtPct(summary.deduction_ratio)}</div>
            <div class="stat-label">Deduction Rate</div>
          </div>
          <div class="stat-box">
            <div class="stat-value">${summary.pcrr != null ? fmtPct(summary.pcrr) : '—'}</div>
            <div class="stat-label">PCRR</div>
          </div>
        </div>
      </div>

      <!-- Contact Information -->
      ${contact.phone || fullAddress || contact.contact_name ? `
      <div class="section">
        <div class="section-title">Contact Information</div>
        <div class="info-grid">
          ${contact.contact_name ? `<div class="info-item"><span class="info-label">Contact</span><span class="info-value">${escapeHtml(contact.contact_name)}</span></div>` : ''}
          ${contact.phone ? `<div class="info-item"><span class="info-label">Phone</span><span class="info-value">${escapeHtml(contact.phone)}</span></div>` : ''}
          ${fullAddress ? `<div class="info-item"><span class="info-label">Address</span><span class="info-value">${escapeHtml(fullAddress)}</span></div>` : ''}
          ${purchaser.primary_purchaser_name ? `<div class="info-item"><span class="info-label">Primary Gas Purchaser</span><span class="info-value">${escapeHtml(purchaser.primary_purchaser_name)}${purchaser.is_affiliated ? ' (Affiliated)' : ''}</span></div>` : ''}
        </div>
      </div>` : ''}

      <!-- Operational Health -->
      ${health ? `
      <div class="section">
        <div class="section-title">Operational Health</div>
        <div class="health-grid">
          <div class="health-card">
            <div class="health-value ${getIdleRateColorClass(health.idleRatePct)}">${fmtPct(health.idleRatePct)}</div>
            <div class="health-sub">${health.idlePuns} idle of ${health.totalPuns} PUNs</div>
          </div>
          <div class="health-card">
            <div class="health-value ${getDeclineColorClass(health.avgDecline)}">${health.avgDecline != null ? health.avgDecline + '%' : '—'}</div>
            <div class="health-sub">Avg Decline (12mo BOE)</div>
          </div>
          <div class="health-card">
            <div class="health-value">${health.decliningWells || 0} <span style="color:#dc2626; font-size: 14px;">&#9660;</span> / ${health.growingWells || 0} <span style="color:#059669; font-size: 14px;">&#9650;</span></div>
            <div class="health-sub">Declining vs Growing</div>
          </div>
        </div>
        ${idleBarHtml}
      </div>` : `
      <div class="section">
        <div class="section-title">Operational Health</div>
        <p style="color: #9ca3af; font-size: 13px; font-style: italic;">No production unit data available.</p>
      </div>`}

      <!-- Monthly Trend Chart -->
      ${monthly.length > 0 ? `
      <div class="section">
        <div class="section-title">Monthly Trend</div>
        <div class="chart-container">${chartSvg}</div>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th class="right">Wells</th>
              <th class="right">Gross</th>
              <th class="right">Deductions</th>
              <th class="right">Ded. Rate</th>
              <th class="right">PCRR</th>
            </tr>
          </thead>
          <tbody>${monthlyRowsHtml}</tbody>
        </table>
      </div>` : ''}

      <!-- Counties -->
      ${counties.length > 0 ? `
      <div class="section">
        <div class="section-title">Top Counties</div>
        <table>
          <thead>
            <tr>
              <th>County</th>
              <th class="right">Wells</th>
              <th class="right">Gross Revenue</th>
              <th class="right">Ded. Rate</th>
            </tr>
          </thead>
          <tbody>${countyRowsHtml}</tbody>
        </table>
      </div>` : ''}
    </div>

    <div class="footer">
      <span>Generated ${dateStr} by ${escapeHtml(userName)}</span>
      <span>Data: Oklahoma Tax Commission &bull; ${data.analysis_period || '6 months'}</span>
    </div>
  </div>

</body>
</html>`;
}

function getIdleRateColorClass(rate: number): string {
  if (rate < 20) return 'green';
  if (rate < 50) return 'amber';
  if (rate < 75) return 'orange';
  return 'red';
}

function getDeclineColorClass(rate: number | null): string {
  if (rate == null) return 'muted';
  if (rate > -10) return 'green';
  if (rate > -35) return 'amber';
  if (rate > -60) return 'orange';
  return 'red';
}

function generateMonthlyChartSvg(monthly: any[]): string {
  if (!monthly || monthly.length < 2) return '';

  // Reverse so oldest is first (monthly comes in DESC order)
  const data = [...monthly].reverse();
  const width = 700;
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 30, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxGross = Math.max(...data.map(d => d.total_gross || 0));
  if (maxGross === 0) return '';

  const barWidth = Math.min(60, (chartW / data.length) - 8);
  const barGap = (chartW - barWidth * data.length) / (data.length + 1);

  let bars = '';
  let labels = '';

  data.forEach((d, i) => {
    const x = padding.left + barGap + i * (barWidth + barGap);
    const barH = (d.total_gross / maxGross) * chartH;
    const y = padding.top + chartH - barH;

    // Gross bar
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="#7c3aed" rx="3" opacity="0.8"/>`;

    // Deduction overlay
    if (d.residue_deductions > 0) {
      const dedH = (d.residue_deductions / maxGross) * chartH;
      const dedY = padding.top + chartH - dedH;
      bars += `<rect x="${x}" y="${dedY}" width="${barWidth}" height="${dedH}" fill="#dc2626" rx="3" opacity="0.5"/>`;
    }

    // Month label
    const ym = String(d.year_month);
    const label = ym.length === 6
      ? new Date(parseInt(ym.substring(0, 4)), parseInt(ym.substring(4, 6)) - 1).toLocaleDateString('en-US', { month: 'short' })
      : ym;
    labels += `<text x="${x + barWidth / 2}" y="${height - 5}" text-anchor="middle" font-size="10" fill="#6b7280">${label}</text>`;
  });

  // Y-axis labels
  const yLabels = [0, maxGross / 2, maxGross].map((v, i) => {
    const y = padding.top + chartH - (v / maxGross) * chartH;
    const label = v >= 1000000 ? '$' + (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? '$' + Math.round(v / 1000) + 'K' : '$' + Math.round(v);
    return `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${label}</text>
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`;
  }).join('');

  // Legend
  const legend = `
    <rect x="${padding.left}" y="${height + 5}" width="10" height="10" fill="#7c3aed" rx="2" opacity="0.8"/>
    <text x="${padding.left + 14}" y="${height + 13}" font-size="10" fill="#6b7280">Gross Revenue</text>
    <rect x="${padding.left + 100}" y="${height + 5}" width="10" height="10" fill="#dc2626" rx="2" opacity="0.5"/>
    <text x="${padding.left + 114}" y="${height + 13}" font-size="10" fill="#6b7280">Deductions</text>
  `;

  return `<svg viewBox="0 0 ${width} ${height + 20}" style="width: 100%; max-width: ${width}px;">
    ${yLabels}
    ${bars}
    ${labels}
    ${legend}
  </svg>`;
}
