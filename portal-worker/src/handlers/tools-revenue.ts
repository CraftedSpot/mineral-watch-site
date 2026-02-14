/**
 * Tools Revenue Estimator Handler
 *
 * GET /api/tools/property-production?property_id=recXXX
 *
 * Returns a property's linked wells with OTC production data
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

    // Determine interest decimal and source
    let interestDecimal: number | null = null;
    let interestSource: string = 'none';
    if (well.ri_nri) {
      interestDecimal = well.ri_nri;
      interestSource = 'well_override';
    } else if (property.ri_decimal) {
      interestDecimal = property.ri_decimal;
      interestSource = 'property';
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
