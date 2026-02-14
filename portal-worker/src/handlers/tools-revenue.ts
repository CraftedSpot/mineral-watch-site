/**
 * Tools Revenue Estimator Handlers
 *
 * GET /api/tools/property-production?property_id=recXXX
 * GET /api/tools/well-production?well_id=cwellXXX
 *
 * Returns property/well linked wells with OTC production data
 * for client-side revenue estimation. Handles:
 * - Interest decimal priority (well ri_nri > property ri_decimal)
 * - Shared PUN detection (multi-well production units)
 * - D1 parameter batching (100-param limit)
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

// Batch sizes to stay under D1's 100-param limit
const API_BATCH = 50;
const PUN_BATCH = 90;  // leaves room for year_month param

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function getMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0');
}

interface WellRow {
  airtable_id: string;
  well_name: string;
  api_number: string;
  operator: string;
  county: string;
  well_status: string;
  ri_nri: number | null;
  wi_nri: number | null;
  orri_nri: number | null;
  interest_source: string | null;
  interest_source_doc_id: string | null;
  interest_source_date: string | null;
  wi_nri_source: string | null;
  wi_nri_source_doc_id: string | null;
  wi_nri_source_date: string | null;
  orri_nri_source: string | null;
  orri_nri_source_doc_id: string | null;
  orri_nri_source_date: string | null;
}

interface PunLink {
  api_number: string;
  base_pun: string;
}

interface ProdRow {
  base_pun: string;
  year_month: string;
  oil_bbl: number;
  gas_mcf: number;
}

export async function handlePropertyProduction(request: Request, env: Env): Promise<Response> {
  // Auth
  const session = await authenticateRequest(request, env);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const propertyId = url.searchParams.get('property_id');
  if (!propertyId) return jsonResponse({ error: 'property_id required' }, 400);

  const userId = session.id;
  const orgId = session.airtableUser?.fields?.Organization?.[0] || null;

  // 1. Verify property ownership and get property data
  const propQuery = orgId
    ? `SELECT * FROM properties WHERE airtable_record_id = ? AND (organization_id = ? OR user_id = ?)`
    : `SELECT * FROM properties WHERE airtable_record_id = ? AND user_id = ?`;
  const propBinds = orgId ? [propertyId, orgId, userId] : [propertyId, userId];

  const propResult = await env.WELLS_DB!.prepare(propQuery).bind(...propBinds).first() as any;
  if (!propResult) return jsonResponse({ error: 'Property not found' }, 404);

  const property = {
    id: propResult.airtable_record_id,
    county: propResult.county,
    section: propResult.section,
    township: propResult.township,
    range: propResult.range,
    meridian: propResult.meridian,
    ri_decimal: propResult.ri_decimal || null,
    wi_decimal: propResult.wi_decimal || null,
    orri_decimal: propResult.orri_decimal || null,
    ri_acres: propResult.ri_acres || null,
    total_acres: propResult.total_acres || null,
    acres: propResult.acres || null,
  };

  // 2. Get linked wells
  const wellsResult = await env.WELLS_DB!.prepare(`
    SELECT cw.airtable_id, cw.well_name, cw.api_number, cw.operator,
           cw.county, cw.well_status, cw.ri_nri, cw.wi_nri, cw.orri_nri
    FROM property_well_links pwl
    JOIN client_wells cw ON cw.airtable_id = pwl.well_airtable_id
    WHERE pwl.property_airtable_id = ? AND pwl.status IN ('Active', 'Linked')
    ORDER BY cw.well_name
  `).bind(propertyId).all();

  const wells = (wellsResult.results || []) as WellRow[];

  if (wells.length === 0) {
    return jsonResponse({
      property,
      dataHorizon: null,
      wells: [],
      sharedPunGroups: [],
    });
  }

  // 3. Clean API numbers to api10 and resolve base_puns
  const wellApi10Map = new Map<string, string>(); // api10 → wellId
  const wellsByApi10 = new Map<string, WellRow>();
  for (const w of wells) {
    if (!w.api_number) continue;
    const api10 = w.api_number.replace(/-/g, '').substring(0, 10);
    wellApi10Map.set(api10, w.airtable_id);
    wellsByApi10.set(api10, w);
  }

  const api10s = Array.from(wellApi10Map.keys());
  const punLinks: PunLink[] = [];

  for (const batch of chunk(api10s, API_BATCH)) {
    const ph = batch.map(() => '?').join(',');
    const result = await env.WELLS_DB!.prepare(
      `SELECT DISTINCT api_number, base_pun FROM well_pun_links WHERE api_number IN (${ph}) AND base_pun IS NOT NULL`
    ).bind(...batch).all();
    punLinks.push(...(result.results as PunLink[]));
  }

  // Build maps: api10 → basePuns, basePun → api10s
  const api10ToPuns = new Map<string, string[]>();
  const punToApi10s = new Map<string, string[]>();

  for (const pl of punLinks) {
    const existing = api10ToPuns.get(pl.api_number) || [];
    existing.push(pl.base_pun);
    api10ToPuns.set(pl.api_number, existing);

    const existingWells = punToApi10s.get(pl.base_pun) || [];
    existingWells.push(pl.api_number);
    punToApi10s.set(pl.base_pun, existingWells);
  }

  // Identify shared PUNs (base_pun linked to >1 well in this property)
  const sharedPunSet = new Set<string>();
  for (const [pun, apis] of punToApi10s) {
    const uniqueApis = [...new Set(apis)];
    if (uniqueApis.length > 1) sharedPunSet.add(pun);
  }

  // 4. Query production for all unique base_puns (last 6 months)
  const allBasePuns = [...new Set(punLinks.map(pl => pl.base_pun))];
  const sixMonthsAgo = getMonthsAgo(6);
  const prodRows: ProdRow[] = [];

  for (const batch of chunk(allBasePuns, PUN_BATCH)) {
    const ph = batch.map(() => '?').join(',');
    const result = await env.WELLS_DB!.prepare(`
      SELECT base_pun, year_month,
        SUM(CASE WHEN product_code IN ('1','3') THEN gross_volume ELSE 0 END) as oil_bbl,
        SUM(CASE WHEN product_code IN ('5','6') THEN gross_volume ELSE 0 END) as gas_mcf
      FROM otc_production
      WHERE base_pun IN (${ph}) AND year_month >= ?
      GROUP BY base_pun, year_month ORDER BY year_month DESC
    `).bind(...batch, sixMonthsAgo).all();
    prodRows.push(...(result.results as ProdRow[]));
  }

  // Build production lookup: basePun → [{yearMonth, oilBbl, gasMcf}]
  const prodByPun = new Map<string, Array<{ yearMonth: string; oilBbl: number; gasMcf: number }>>();
  for (const row of prodRows) {
    const arr = prodByPun.get(row.base_pun) || [];
    arr.push({ yearMonth: row.year_month, oilBbl: row.oil_bbl || 0, gasMcf: row.gas_mcf || 0 });
    prodByPun.set(row.base_pun, arr);
  }

  // Data horizon = latest month across all production
  let dataHorizon: string | null = null;
  for (const row of prodRows) {
    if (!dataHorizon || row.year_month > dataHorizon) dataHorizon = row.year_month;
  }

  // 5. Build response: wells + shared PUN groups
  const responseWells: any[] = [];
  const sharedPunGroups: any[] = [];
  const processedSharedPuns = new Set<string>();

  for (const well of wells) {
    const api10 = well.api_number ? well.api_number.replace(/-/g, '').substring(0, 10) : null;
    const basePuns = api10 ? (api10ToPuns.get(api10) || []) : [];

    // Determine interest decimal and source (primary RI for backward compat)
    let interestDecimal: number | null = null;
    let interestSource: string = 'none';
    let interestSourceDocId: string | null = null;
    let interestSourceDate: string | null = null;
    if (well.ri_nri) {
      interestDecimal = well.ri_nri;
      interestSource = well.interest_source || 'well_override';
      interestSourceDocId = well.interest_source_doc_id || null;
      interestSourceDate = well.interest_source_date || null;
    } else if (property.ri_decimal) {
      interestDecimal = property.ri_decimal;
      interestSource = 'property';
    }

    // Build all interest types for multi-interest display
    const interests: any[] = [];
    if (well.ri_nri) {
      interests.push({ type: 'RI', label: 'Royalty Interest', decimal: well.ri_nri,
        source: well.interest_source || 'well_override', sourceDocId: well.interest_source_doc_id, sourceDate: well.interest_source_date });
    } else if (property.ri_decimal) {
      interests.push({ type: 'RI', label: 'Royalty Interest', decimal: property.ri_decimal,
        source: 'property', sourceDocId: null, sourceDate: null });
    }
    if (well.wi_nri) {
      interests.push({ type: 'WI', label: 'Working Interest', decimal: well.wi_nri,
        source: well.wi_nri_source || 'well_override', sourceDocId: well.wi_nri_source_doc_id, sourceDate: well.wi_nri_source_date });
    }
    if (well.orri_nri) {
      interests.push({ type: 'ORRI', label: 'Overriding Royalty', decimal: well.orri_nri,
        source: well.orri_nri_source || 'well_override', sourceDocId: well.orri_nri_source_doc_id, sourceDate: well.orri_nri_source_date });
    }

    // Check if any of this well's PUNs are shared
    const wellSharedPuns = basePuns.filter(p => sharedPunSet.has(p));
    const wellOwnPuns = basePuns.filter(p => !sharedPunSet.has(p));

    // Add shared PUN groups (only once per PUN)
    for (const sp of wellSharedPuns) {
      if (processedSharedPuns.has(sp)) continue;
      processedSharedPuns.add(sp);

      const punApis = [...new Set(punToApi10s.get(sp) || [])];
      const wellIds = punApis
        .map(a => wellApi10Map.get(a))
        .filter(Boolean) as string[];
      const wellNames = punApis
        .map(a => wellsByApi10.get(a)?.well_name)
        .filter(Boolean) as string[];

      const punProd = prodByPun.get(sp) || [];
      punProd.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

      const trail3 = punProd.slice(0, 3);
      const avgOil = trail3.length > 0 ? trail3.reduce((s, p) => s + p.oilBbl, 0) / trail3.length : 0;
      const avgGas = trail3.length > 0 ? trail3.reduce((s, p) => s + p.gasMcf, 0) / trail3.length : 0;

      sharedPunGroups.push({
        basePun: sp,
        wellIds,
        wellNames,
        production: punProd.slice(0, 6),
        trailing3mo: { avgOilBbl: Math.round(avgOil), avgGasMcf: Math.round(avgGas) },
      });
    }

    // Aggregate production from this well's own (non-shared) PUNs
    const ownProduction = new Map<string, { oilBbl: number; gasMcf: number }>();
    for (const pun of wellOwnPuns) {
      for (const p of (prodByPun.get(pun) || [])) {
        const existing = ownProduction.get(p.yearMonth) || { oilBbl: 0, gasMcf: 0 };
        existing.oilBbl += p.oilBbl;
        existing.gasMcf += p.gasMcf;
        ownProduction.set(p.yearMonth, existing);
      }
    }

    const production = Array.from(ownProduction.entries())
      .map(([ym, v]) => ({ yearMonth: ym, oilBbl: Math.round(v.oilBbl), gasMcf: Math.round(v.gasMcf) }))
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
      .slice(0, 6);

    const trail3 = production.slice(0, 3);
    const avgOil = trail3.length > 0 ? trail3.reduce((s, p) => s + p.oilBbl, 0) / trail3.length : 0;
    const avgGas = trail3.length > 0 ? trail3.reduce((s, p) => s + p.gasMcf, 0) / trail3.length : 0;

    responseWells.push({
      wellId: well.airtable_id,
      wellName: well.well_name || 'Unknown Well',
      apiNumber: well.api_number || null,
      operator: well.operator || null,
      wellStatus: well.well_status || null,
      interestDecimal,
      interestSource,
      interestSourceDocId,
      interestSourceDate,
      interests,
      basePuns,
      sharedPun: wellSharedPuns.length > 0,
      production,
      trailing3mo: { avgOilBbl: Math.round(avgOil), avgGasMcf: Math.round(avgGas) },
    });
  }

  return jsonResponse({
    property,
    dataHorizon,
    wells: responseWells,
    sharedPunGroups,
  });
}

export async function handleWellProduction(request: Request, env: Env): Promise<Response> {
  const session = await authenticateRequest(request, env);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const wellId = url.searchParams.get('well_id');
  if (!wellId) return jsonResponse({ error: 'well_id required' }, 400);

  const userId = session.id;
  const orgId = session.airtableUser?.fields?.Organization?.[0] || null;

  // 1. Verify well ownership through property_well_links → properties
  const ownerQuery = orgId
    ? `SELECT cw.* FROM client_wells cw
       JOIN property_well_links pwl ON pwl.well_airtable_id = cw.airtable_id
       JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
       WHERE cw.airtable_id = ? AND (p.organization_id = ? OR p.user_id = ?)
       AND pwl.status IN ('Active', 'Linked') LIMIT 1`
    : `SELECT cw.* FROM client_wells cw
       JOIN property_well_links pwl ON pwl.well_airtable_id = cw.airtable_id
       JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
       WHERE cw.airtable_id = ? AND p.user_id = ?
       AND pwl.status IN ('Active', 'Linked') LIMIT 1`;
  const ownerBinds = orgId ? [wellId, orgId, userId] : [wellId, userId];

  const wellResult = await env.WELLS_DB!.prepare(ownerQuery).bind(...ownerBinds).first() as any;
  if (!wellResult) return jsonResponse({ error: 'Well not found' }, 404);

  const well = {
    id: wellResult.airtable_id,
    wellName: wellResult.well_name || 'Unknown Well',
    apiNumber: wellResult.api_number || null,
    operator: wellResult.operator || null,
    county: wellResult.county || null,
    wellStatus: wellResult.well_status || null,
    ri_nri: wellResult.ri_nri || null,
    wi_nri: wellResult.wi_nri || null,
    orri_nri: wellResult.orri_nri || null,
    interest_source: wellResult.interest_source || null,
    interest_source_doc_id: wellResult.interest_source_doc_id || null,
    interest_source_date: wellResult.interest_source_date || null,
    wi_nri_source: wellResult.wi_nri_source || null,
    wi_nri_source_doc_id: wellResult.wi_nri_source_doc_id || null,
    wi_nri_source_date: wellResult.wi_nri_source_date || null,
    orri_nri_source: wellResult.orri_nri_source || null,
    orri_nri_source_doc_id: wellResult.orri_nri_source_doc_id || null,
    orri_nri_source_date: wellResult.orri_nri_source_date || null,
  };

  // 2. Get linked property for ri_decimal fallback
  let linkedProperty: any = null;
  const linkQuery = orgId
    ? `SELECT p.airtable_record_id, p.county, p.section, p.township, p.range, p.meridian,
              p.ri_decimal, p.wi_decimal, p.ri_acres, p.total_acres, p.acres
       FROM property_well_links pwl
       JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
       WHERE pwl.well_airtable_id = ? AND pwl.status IN ('Active', 'Linked')
       AND (p.organization_id = ? OR p.user_id = ?)
       ORDER BY p.ri_decimal DESC NULLS LAST, COALESCE(p.ri_acres, p.total_acres, p.acres, 0) DESC LIMIT 1`
    : `SELECT p.airtable_record_id, p.county, p.section, p.township, p.range, p.meridian,
              p.ri_decimal, p.wi_decimal, p.ri_acres, p.total_acres, p.acres
       FROM property_well_links pwl
       JOIN properties p ON p.airtable_record_id = pwl.property_airtable_id
       WHERE pwl.well_airtable_id = ? AND pwl.status IN ('Active', 'Linked')
       AND p.user_id = ?
       ORDER BY p.ri_decimal DESC NULLS LAST, COALESCE(p.ri_acres, p.total_acres, p.acres, 0) DESC LIMIT 1`;
  const linkBinds = orgId ? [wellId, orgId, userId] : [wellId, userId];

  const linkResult = await env.WELLS_DB!.prepare(linkQuery).bind(...linkBinds).first() as any;
  if (linkResult) {
    linkedProperty = {
      id: linkResult.airtable_record_id,
      county: linkResult.county,
      section: linkResult.section,
      township: linkResult.township,
      range: linkResult.range,
      meridian: linkResult.meridian,
      ri_decimal: linkResult.ri_decimal || null,
      ri_acres: linkResult.ri_acres || null,
      total_acres: linkResult.total_acres || null,
      acres: linkResult.acres || null,
    };
  }

  // 3. Determine interest decimal and source
  let interestDecimal: number | null = null;
  let interestSource = 'none';
  let interestSourceDocId: string | null = null;
  let interestSourceDate: string | null = null;
  if (well.ri_nri) {
    interestDecimal = well.ri_nri;
    interestSource = well.interest_source || 'well_override';
    interestSourceDocId = well.interest_source_doc_id || null;
    interestSourceDate = well.interest_source_date || null;
  } else if (linkedProperty?.ri_decimal) {
    interestDecimal = linkedProperty.ri_decimal;
    interestSource = 'property';
  }

  // Build all interest types
  const interests: any[] = [];
  if (well.ri_nri) {
    interests.push({ type: 'RI', label: 'Royalty Interest', decimal: well.ri_nri,
      source: well.interest_source || 'well_override', sourceDocId: well.interest_source_doc_id, sourceDate: well.interest_source_date });
  } else if (linkedProperty?.ri_decimal) {
    interests.push({ type: 'RI', label: 'Royalty Interest', decimal: linkedProperty.ri_decimal,
      source: 'property', sourceDocId: null, sourceDate: null });
  }
  if (well.wi_nri) {
    interests.push({ type: 'WI', label: 'Working Interest', decimal: well.wi_nri,
      source: well.wi_nri_source || 'well_override', sourceDocId: well.wi_nri_source_doc_id, sourceDate: well.wi_nri_source_date });
  }
  if (well.orri_nri) {
    interests.push({ type: 'ORRI', label: 'Overriding Royalty', decimal: well.orri_nri,
      source: well.orri_nri_source || 'well_override', sourceDocId: well.orri_nri_source_doc_id, sourceDate: well.orri_nri_source_date });
  }

  // 4. Resolve base_puns
  if (!well.apiNumber) {
    return jsonResponse({
      well: { ...well, interestDecimal, interestSource, interestSourceDocId, interestSourceDate, interests },
      linkedProperty,
      dataHorizon: null,
      production: [],
      trailing3mo: { avgOilBbl: 0, avgGasMcf: 0 },
    });
  }

  const api10 = well.apiNumber.replace(/-/g, '').substring(0, 10);
  const punResult = await env.WELLS_DB!.prepare(
    `SELECT DISTINCT base_pun FROM well_pun_links WHERE api_number = ? AND base_pun IS NOT NULL`
  ).bind(api10).all();

  const basePuns = (punResult.results as any[]).map(r => r.base_pun);

  if (basePuns.length === 0) {
    return jsonResponse({
      well: { ...well, interestDecimal, interestSource, interestSourceDocId, interestSourceDate, interests, basePuns: [] },
      linkedProperty,
      dataHorizon: null,
      production: [],
      trailing3mo: { avgOilBbl: 0, avgGasMcf: 0 },
    });
  }

  // 5. Query production (last 6 months)
  const sixMonthsAgo = getMonthsAgo(6);
  const prodRows: ProdRow[] = [];

  for (const batch of chunk(basePuns, PUN_BATCH)) {
    const ph = batch.map(() => '?').join(',');
    const result = await env.WELLS_DB!.prepare(`
      SELECT base_pun, year_month,
        SUM(CASE WHEN product_code IN ('1','3') THEN gross_volume ELSE 0 END) as oil_bbl,
        SUM(CASE WHEN product_code IN ('5','6') THEN gross_volume ELSE 0 END) as gas_mcf
      FROM otc_production
      WHERE base_pun IN (${ph}) AND year_month >= ?
      GROUP BY base_pun, year_month ORDER BY year_month DESC
    `).bind(...batch, sixMonthsAgo).all();
    prodRows.push(...(result.results as ProdRow[]));
  }

  // 6. Aggregate production across PUNs by month
  const monthlyProd = new Map<string, { oilBbl: number; gasMcf: number }>();
  for (const row of prodRows) {
    const existing = monthlyProd.get(row.year_month) || { oilBbl: 0, gasMcf: 0 };
    existing.oilBbl += row.oil_bbl || 0;
    existing.gasMcf += row.gas_mcf || 0;
    monthlyProd.set(row.year_month, existing);
  }

  const production = Array.from(monthlyProd.entries())
    .map(([ym, v]) => ({ yearMonth: ym, oilBbl: Math.round(v.oilBbl), gasMcf: Math.round(v.gasMcf) }))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
    .slice(0, 6);

  let dataHorizon: string | null = null;
  for (const row of prodRows) {
    if (!dataHorizon || row.year_month > dataHorizon) dataHorizon = row.year_month;
  }

  const trail3 = production.slice(0, 3);
  const avgOil = trail3.length > 0 ? trail3.reduce((s, p) => s + p.oilBbl, 0) / trail3.length : 0;
  const avgGas = trail3.length > 0 ? trail3.reduce((s, p) => s + p.gasMcf, 0) / trail3.length : 0;

  return jsonResponse({
    well: { ...well, interestDecimal, interestSource, interestSourceDocId, interestSourceDate, interests, basePuns },
    linkedProperty,
    dataHorizon,
    production,
    trailing3mo: { avgOilBbl: Math.round(avgOil), avgGasMcf: Math.round(avgGas) },
  });
}
