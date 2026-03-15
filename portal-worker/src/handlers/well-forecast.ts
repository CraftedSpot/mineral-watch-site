/**
 * Well Performance Forecast — PUN-Based
 *
 * Operates at the production unit (PUN) level, matching how OTC reports production
 * and how royalties are paid. User selects a well → system resolves to PUN →
 * finds comparable PUNs → computes lifetime type curve.
 *
 * GET /api/well-forecast/comparables?api=XXX (or ?pun=XXX-XXXXXX)
 * GET /api/well-forecast?api=XXX (or ?pun=XXX-XXXXXX)
 * POST /api/well-forecast
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { UsageTrackingService } from '../services/usage-tracking.js';
import type { Env } from '../types/env.js';

// ─── Helpers ────────────────────────────────────────────────────────

function parseCompletionToYYYYMM(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return m[1] + m[2].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
  if (m) return m[2] + m[1].padStart(2, '0');
  m = s.match(/^(\d{4})(\d{2})\d{2}$/);
  if (m) return m[1] + m[2];
  m = s.match(/^(\d{6})$/);
  if (m) return m[1];
  return null;
}

function monthDiff(fromYYYYMM: string, toYYYYMM: string): number {
  const fromYear = parseInt(fromYYYYMM.substring(0, 4));
  const fromMonth = parseInt(fromYYYYMM.substring(4, 6));
  const toYear = parseInt(toYYYYMM.substring(0, 4));
  const toMonth = parseInt(toYYYYMM.substring(4, 6));
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const frac = idx - lower;
  if (lower + 1 < sorted.length) {
    return Math.round((sorted[lower] + frac * (sorted[lower + 1] - sorted[lower])) * 100) / 100;
  }
  return Math.round(sorted[lower] * 100) / 100;
}

/**
 * Resolve an API number or PUN to the target unit context:
 * - The target well metadata
 * - The PUN (base_pun)
 * - All wells on that PUN
 */
async function resolveUnit(apiOrPun: string, env: Env): Promise<{
  targetWell: any;
  basePun: string | null;
  unitWells: any[];
} | null> {
  const api10 = apiOrPun.replace(/-/g, '').substring(0, 10);
  const isPun = /^\d{3}-\d{5,6}/.test(apiOrPun);

  let basePun: string | null = null;
  let targetWell: any = null;

  if (isPun) {
    // Input is a PUN — find the base_pun and a representative well
    basePun = apiOrPun.substring(0, 10);
    const wellResult = await env.WELLS_DB.prepare(`
      SELECT w.api_number, w.well_name, w.operator, w.county, w.section, w.township, w.range,
             w.formation_canonical, w.formation_group, w.is_horizontal, w.well_type, w.well_status,
             w.completion_date, w.first_production_date, w.lateral_length, w.true_vertical_depth
      FROM well_pun_links wpl
      JOIN wells w ON w.api_number = wpl.api_number
      WHERE wpl.base_pun = ?
      ORDER BY w.completion_date ASC NULLS LAST
      LIMIT 1
    `).bind(basePun).first<any>();
    targetWell = wellResult;
  } else {
    // Input is an API — look up the well, then resolve to PUN
    targetWell = await env.WELLS_DB.prepare(`
      SELECT api_number, well_name, operator, county, section, township, range,
             formation_canonical, formation_group, is_horizontal, well_type, well_status,
             completion_date, first_production_date, lateral_length, true_vertical_depth
      FROM wells WHERE api_number = ? OR api_number = ?
      LIMIT 1
    `).bind(apiOrPun, api10).first<any>();

    if (targetWell) {
      const punResult = await env.WELLS_DB.prepare(
        `SELECT base_pun FROM well_pun_links WHERE api_number = ? OR api_number = ? LIMIT 1`
      ).bind(targetWell.api_number, api10).first<any>();
      basePun = punResult?.base_pun || null;
    }
  }

  if (!targetWell) return null;

  // Find all wells on this PUN
  let unitWells: any[] = [targetWell];
  if (basePun) {
    const allWells = await env.WELLS_DB.prepare(`
      SELECT w.api_number, w.well_name, w.operator, w.county, w.section, w.township, w.range,
             w.formation_canonical, w.is_horizontal, w.well_type, w.well_status,
             w.completion_date, w.lateral_length
      FROM well_pun_links wpl
      JOIN wells w ON w.api_number = wpl.api_number
      WHERE wpl.base_pun = ?
      GROUP BY w.api_number
      ORDER BY w.completion_date ASC NULLS LAST
    `).bind(basePun).all();
    if (allWells.results.length > 0) {
      unitWells = allWells.results as any[];
    }
  }

  return { targetWell, basePun, unitWells };
}

// ─── Comparables Handler ────────────────────────────────────────────

export async function handleGetComparables(apiOrPun: string, request: Request, env: Env): Promise<Response> {
  try {
    const session = await authenticateRequest(request, env);
    if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

    // 1. Resolve to unit
    const unit = await resolveUnit(apiOrPun, env);
    if (!unit) return jsonResponse({ error: 'Well not found' }, 404);

    const { targetWell, basePun, unitWells } = unit;
    const formation = targetWell.formation_canonical;
    const isHorizontal = targetWell.is_horizontal ? 1 : 0;
    const county = targetWell.county;
    const formationGroup = targetWell.formation_group;

    if (!formation) {
      return jsonResponse({ error: 'Well has no formation data — cannot find comparables' }, 400);
    }

    // 2. Find comparable wells (tiered, same as before)
    let comparables: any[] = [];
    let tier = 1;

    comparables = (await env.WELLS_DB.prepare(`
      SELECT api_number, well_name, operator, completion_date, county, formation_canonical, is_horizontal
      FROM wells
      WHERE formation_canonical = ? AND is_horizontal = ? AND county = ?
        AND completion_date IS NOT NULL AND completion_date != ''
        AND well_status NOT IN ('PA') AND api_number != ?
      ORDER BY completion_date DESC LIMIT 200
    `).bind(formation, isHorizontal, county, targetWell.api_number).all()).results as any[];

    if (comparables.length < 15 && formationGroup) {
      tier = 2;
      comparables = (await env.WELLS_DB.prepare(`
        SELECT api_number, well_name, operator, completion_date, county, formation_canonical, is_horizontal
        FROM wells
        WHERE formation_canonical = ? AND is_horizontal = ?
          AND completion_date IS NOT NULL AND completion_date != ''
          AND well_status NOT IN ('PA') AND api_number != ?
        ORDER BY completion_date DESC LIMIT 200
      `).bind(formation, isHorizontal, targetWell.api_number).all()).results as any[];
    }

    if (comparables.length < 15 && formationGroup) {
      tier = 3;
      comparables = (await env.WELLS_DB.prepare(`
        SELECT api_number, well_name, operator, completion_date, county, formation_canonical, is_horizontal
        FROM wells
        WHERE formation_group = ? AND is_horizontal = ? AND county = ?
          AND completion_date IS NOT NULL AND completion_date != ''
          AND well_status NOT IN ('PA') AND api_number != ?
        ORDER BY completion_date DESC LIMIT 200
      `).bind(formationGroup, isHorizontal, county, targetWell.api_number).all()).results as any[];
    }

    if (comparables.length < 10) {
      return jsonResponse({
        success: true,
        target: formatTarget(targetWell),
        unit: formatUnit(basePun, unitWells, targetWell.api_number),
        cohort: { count: comparables.length, insufficient: true, tier },
        type_curve: null,
      });
    }

    // 3. Resolve each comparable well to its PUN and DEDUPLICATE by PUN
    const BATCH = 50;
    const compApis = comparables.map(c => c.api_number);
    // Map: api → base_pun
    const apiToPun = new Map<string, string>();
    for (let i = 0; i < compApis.length; i += BATCH) {
      const batch = compApis.slice(i, i + BATCH);
      const ph = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(
        `SELECT api_number, base_pun FROM well_pun_links WHERE api_number IN (${ph}) AND base_pun IS NOT NULL`
      ).bind(...batch).all();
      for (const row of result.results as any[]) {
        apiToPun.set(row.api_number, row.base_pun);
      }
    }

    // Group by PUN — each PUN counts as one comparable unit
    const punUnits = new Map<string, { basePun: string; earliestCompletion: string; wells: any[] }>();
    for (const comp of comparables) {
      const bp = apiToPun.get(comp.api_number);
      if (!bp) continue;
      // Skip the target's own PUN
      if (bp === basePun) continue;

      const existing = punUnits.get(bp);
      if (existing) {
        existing.wells.push(comp);
        if (comp.completion_date && comp.completion_date < existing.earliestCompletion) {
          existing.earliestCompletion = comp.completion_date;
        }
      } else {
        punUnits.set(bp, {
          basePun: bp,
          earliestCompletion: comp.completion_date || '9999',
          wells: [comp],
        });
      }
    }

    const linkedPuns = [...punUnits.values()];
    const totalCompWells = linkedPuns.reduce((sum, p) => sum + p.wells.length, 0);

    if (linkedPuns.length < 10) {
      return jsonResponse({
        success: true,
        target: formatTarget(targetWell),
        unit: formatUnit(basePun, unitWells, targetWell.api_number),
        cohort: { count: linkedPuns.length, total_wells: totalCompWells, insufficient: true, tier, note: 'Too few comparable units with production data' },
        type_curve: null,
      });
    }

    // 4. Get monthly production for all comparable PUNs (batched)
    const allCompPuns = linkedPuns.map(p => p.basePun);
    const prodByPun = new Map<string, Array<{ year_month: string; oil: number; gas: number }>>();
    for (let i = 0; i < allCompPuns.length; i += BATCH) {
      const batch = allCompPuns.slice(i, i + BATCH);
      const ph = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(`
        SELECT base_pun, year_month,
          SUM(CASE WHEN product_code IN ('1','3') THEN gross_volume ELSE 0 END) as oil,
          SUM(CASE WHEN product_code IN ('5','6') THEN gross_volume ELSE 0 END) as gas
        FROM otc_production WHERE base_pun IN (${ph})
        GROUP BY base_pun, year_month ORDER BY base_pun, year_month
      `).bind(...batch).all();
      for (const row of result.results as any[]) {
        if (!prodByPun.has(row.base_pun)) prodByPun.set(row.base_pun, []);
        prodByPun.get(row.base_pun)!.push({ year_month: row.year_month as string, oil: (row.oil as number) || 0, gas: (row.gas as number) || 0 });
      }
    }

    // 5. Normalize to months-from-first-production per PUN and build type curve
    const curve: Map<number, { oilValues: number[]; gasValues: number[] }> = new Map();
    let maxMonth = 0;
    let earliestComp = '9999', latestComp = '0000';

    for (const pu of linkedPuns) {
      if (pu.earliestCompletion < earliestComp) earliestComp = pu.earliestCompletion;
      if (pu.earliestCompletion > latestComp) latestComp = pu.earliestCompletion;

      const records = prodByPun.get(pu.basePun) || [];
      if (records.length === 0) continue;

      const firstProdMonth = records[0].year_month;
      for (const r of records) {
        const monthNum = monthDiff(firstProdMonth, r.year_month);
        if (monthNum < 0 || monthNum > 300) continue;
        if (!curve.has(monthNum)) curve.set(monthNum, { oilValues: [], gasValues: [] });
        curve.get(monthNum)!.oilValues.push(r.oil);
        curve.get(monthNum)!.gasValues.push(r.gas);
        if (monthNum > maxMonth) maxMonth = monthNum;
      }
    }

    // 6. Compute percentiles
    const MIN_WELLS = 5;
    const typeCurveMonths: number[] = [];
    const p10Oil: number[] = [], p50Oil: number[] = [], p90Oil: number[] = [];
    const p10Gas: number[] = [], p50Gas: number[] = [], p90Gas: number[] = [];
    const wellCounts: number[] = [];

    for (let m = 0; m <= maxMonth; m++) {
      const data = curve.get(m);
      if (!data || data.oilValues.length < MIN_WELLS) continue;
      typeCurveMonths.push(m);
      p10Oil.push(percentile(data.oilValues, 10)); p50Oil.push(percentile(data.oilValues, 50)); p90Oil.push(percentile(data.oilValues, 90));
      p10Gas.push(percentile(data.gasValues, 10)); p50Gas.push(percentile(data.gasValues, 50)); p90Gas.push(percentile(data.gasValues, 90));
      wellCounts.push(data.oilValues.length);
    }

    // 7. Summary stats
    const peakIdx = p50Oil.indexOf(Math.max(...p50Oil));
    let declineRate: number | null = null;
    if (peakIdx >= 0 && typeCurveMonths.length > peakIdx + 12) {
      const peakVal = p50Oil[peakIdx];
      const m12Idx = typeCurveMonths.findIndex(m => m >= typeCurveMonths[peakIdx] + 12);
      if (m12Idx >= 0 && peakVal > 0) {
        declineRate = Math.round(((peakVal - p50Oil[m12Idx]) / peakVal) * 1000) / 10;
      }
    }
    let cumOil = 0, cumGas = 0;
    for (let i = 0; i < p50Oil.length; i++) { cumOil += p50Oil[i]; cumGas += p50Gas[i]; }

    // 8. Target unit production vs curve
    let targetVsCurve: any = null;
    if (basePun) {
      const targetProd = await env.WELLS_DB.prepare(`
        SELECT year_month,
          SUM(CASE WHEN product_code IN ('1','3') THEN gross_volume ELSE 0 END) as oil,
          SUM(CASE WHEN product_code IN ('5','6') THEN gross_volume ELSE 0 END) as gas
        FROM otc_production WHERE base_pun = ?
        GROUP BY year_month ORDER BY year_month
      `).bind(basePun).all();

      if (targetProd.results.length > 0) {
        const firstMonth = (targetProd.results[0] as any).year_month as string;
        let totalDiff = 0, compMonths = 0;
        for (const row of targetProd.results as any[]) {
          const mNum = monthDiff(firstMonth, row.year_month as string);
          if (mNum < 0) continue;
          const curveIdx = typeCurveMonths.indexOf(mNum);
          if (curveIdx >= 0) {
            const p50 = p50Oil[curveIdx] > 0 ? p50Oil[curveIdx] : p50Gas[curveIdx];
            const actual = p50Oil[curveIdx] > 0 ? (row.oil || 0) : (row.gas || 0);
            if (p50 > 0) { totalDiff += (actual - p50) / p50; compMonths++; }
          }
        }
        const avgVsP50 = compMonths > 0 ? Math.round((totalDiff / compMonths) * 1000) / 10 : null;
        targetVsCurve = {
          months_producing: targetProd.results.length,
          performance_vs_p50: avgVsP50 !== null ? `${avgVsP50 > 0 ? '+' : ''}${avgVsP50}%` : null,
        };
      }
    }

    // 9. Operator sub-cohort
    let operatorSubCohort: any = null;
    if (targetWell.operator) {
      const opPuns = linkedPuns.filter(p => p.wells.some(w => w.operator?.toUpperCase() === targetWell.operator?.toUpperCase()));
      if (opPuns.length >= 10) {
        operatorSubCohort = {
          count: opPuns.length,
          total_wells: opPuns.reduce((s, p) => s + p.wells.length, 0),
          operator: targetWell.operator,
        };
      }
    }

    // 10. Milestones
    const milestones = [1, 6, 12, 24, 36, 60, 120].map(m => {
      const idx = typeCurveMonths.indexOf(m);
      if (idx < 0) return null;
      return {
        month: m,
        p10_oil: p10Oil[idx], p50_oil: p50Oil[idx], p90_oil: p90Oil[idx],
        p10_gas: p10Gas[idx], p50_gas: p50Gas[idx], p90_gas: p90Gas[idx],
        well_count: wellCounts[idx],
      };
    }).filter(Boolean);

    return jsonResponse({
      success: true,
      target: formatTarget(targetWell),
      unit: formatUnit(basePun, unitWells, targetWell.api_number),
      cohort: {
        count: linkedPuns.length,
        total_wells: totalCompWells,
        formation, well_type: isHorizontal ? 'Horizontal' : 'Vertical',
        county: tier === 2 ? 'Multiple counties' : county,
        completion_range: `${earliestComp.substring(0, 7)} to ${latestComp.substring(0, 7)}`,
        tier,
      },
      type_curve: {
        months: typeCurveMonths,
        p10: { oil: p10Oil, gas: p10Gas }, p50: { oil: p50Oil, gas: p50Gas }, p90: { oil: p90Oil, gas: p90Gas },
        well_count_at_month: wellCounts, max_month: maxMonth,
      },
      milestones,
      summary: {
        peak_oil_month: typeCurveMonths[peakIdx] || 0, peak_p50_oil: p50Oil[peakIdx] || 0,
        peak_p50_gas: p50Gas[peakIdx] || 0, first_year_decline_rate: declineRate,
        cumulative_p50_oil: Math.round(cumOil), cumulative_p50_gas: Math.round(cumGas),
        max_months_of_data: maxMonth,
      },
      target_vs_curve: targetVsCurve,
      operator_sub_cohort: operatorSubCohort,
    });
  } catch (error) {
    console.error('[WellForecast] Comparables error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Failed to compute comparables' }, 500);
  }
}

function formatTarget(w: any) {
  return {
    api: w.api_number, well_name: w.well_name, operator: w.operator,
    formation: w.formation_canonical, formation_group: w.formation_group,
    county: w.county, trs: `${w.township}-${w.range}-${w.section}`,
    well_type: w.is_horizontal ? 'Horizontal' : 'Vertical',
    completion_date: w.completion_date, well_status: w.well_status,
    lateral_length: w.lateral_length,
  };
}

function formatUnit(basePun: string | null, wells: any[], selectedApi: string) {
  return {
    pun: basePun,
    well_count: wells.length,
    wells: wells.map(w => ({
      api: w.api_number, name: w.well_name, operator: w.operator,
      formation: w.formation_canonical, type: w.is_horizontal ? 'Horizontal' : 'Vertical',
      status: w.well_status, completion_date: w.completion_date,
      is_selected: w.api_number === selectedApi,
    })),
  };
}

// ─── Phase B: AI Narrative Forecast ─────────────────────────────────

const FORECAST_SYSTEM_PROMPT = `You are a Petroleum Production Analyst providing a Well Performance Forecast for a mineral rights owner in Oklahoma. You synthesize production data from comparable production units, operator performance metrics, and economic indicators to project future production and revenue.

Today's date is {DATE}.
OTC production data typically lags 2-3 months behind actual production.

Your Forecast Should Cover:

1. **Comparable Unit Summary** — Describe the cohort: how many comparable units, formation, county, completion range.

2. **Production Forecast** — Project monthly oil and gas production using the type curve. Use P50 (median) with P10/P90 bookends. If the target unit is producing, compare against the curve.

3. **Decline Curve Characterization** — Describe the expected decline profile and estimated well life.

4. **Operator Performance Context** — If operator sub-cohort data is available, compare vs full cohort.

5. **Revenue Projection** — Estimate gross monthly revenue at key time horizons using current commodity prices.

6. **Economic Risk Assessment** — What commodity price decline would approach economic limit?

7. **Key Risks and Considerations** — Flag concerns and positive indicators.

Formatting Rules:
- Write in clear prose paragraphs with section headings
- Use specific numbers, 600-900 words
- Be direct but measured
- Do NOT repeat raw data tables or disclaim that you are an AI`;

export async function handleGetForecast(apiOrPun: string, request: Request, env: Env): Promise<Response> {
  try {
    const session = await authenticateRequest(request, env);
    if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userId = session.airtableUser?.id || session.id;
    const orgId = session.airtableUser?.fields?.Organization?.[0] || null;
    const scopeKey = orgId || userId;

    // Try PUN first, then API
    const isPun = /^\d{3}-\d{5,6}/.test(apiOrPun);
    let forecast: any = null;
    if (isPun) {
      forecast = await env.WELLS_DB.prepare(
        `SELECT * FROM well_forecasts WHERE target_pun = ? AND scope_key = ? LIMIT 1`
      ).bind(apiOrPun.substring(0, 10), scopeKey).first();
    }
    if (!forecast) {
      forecast = await env.WELLS_DB.prepare(
        `SELECT * FROM well_forecasts WHERE target_api = ? AND scope_key = ? LIMIT 1`
      ).bind(apiOrPun, scopeKey).first();
    }

    if (!forecast) return jsonResponse({ success: true, forecast: null });

    return jsonResponse({
      success: true,
      forecast: {
        id: forecast.id, forecast_text: forecast.forecast_text, model: forecast.model,
        credits_charged: forecast.credits_charged, generated_at: forecast.generated_at,
        formation: forecast.formation, well_type: forecast.well_type,
        county: forecast.county, comparable_count: forecast.comparable_count,
      },
    });
  } catch (error) {
    console.error('[WellForecast] GET error:', error);
    return jsonResponse({ error: 'Failed to fetch forecast' }, 500);
  }
}

export async function handleCreateForecast(request: Request, env: Env): Promise<Response> {
  try {
    const session = await authenticateRequest(request, env);
    if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

    if (!env.ANTHROPIC_API_KEY) return jsonResponse({ error: 'AI forecast not configured' }, 503);

    const body = await request.json() as { api_number?: string; pun?: string };
    const apiOrPun = body.pun || body.api_number;
    if (!apiOrPun) return jsonResponse({ error: 'api_number or pun required' }, 400);

    const userId = session.airtableUser?.id || session.id;
    const orgId = session.airtableUser?.fields?.Organization?.[0] || null;
    const scopeKey = orgId || userId;
    const userPlan = session.airtableUser?.fields?.Plan || 'Free';
    const creditCost = 3;

    const usageService = new UsageTrackingService(env.WELLS_DB);
    const creditCheck = await usageService.checkCreditsAvailable(userId, userPlan);
    if (creditCheck.totalAvailable < creditCost) {
      return jsonResponse({ error: `Insufficient credits. Need ${creditCost}, have ${creditCheck.totalAvailable}.` }, 402);
    }

    // Get comparables
    const compRequest = new Request(`https://internal/api/well-forecast/comparables?api=${apiOrPun}`, { headers: request.headers });
    const compResponse = await handleGetComparables(apiOrPun, compRequest, env);
    const compData = await compResponse.json() as any;

    if (!compData.success || !compData.type_curve) {
      return jsonResponse({ error: compData.cohort?.insufficient ? `Only ${compData.cohort.count} comparable units found.` : 'Could not compute comparables' }, 400);
    }

    const milestoneText = (compData.milestones || []).map((m: any) =>
      `  Month ${m.month}: Oil P10=${m.p10_oil} P50=${m.p50_oil} P90=${m.p90_oil} BBL | Gas P10=${m.p10_gas} P50=${m.p50_gas} P90=${m.p90_gas} MCF (${m.well_count} units)`
    ).join('\n');

    // Deduction data
    let deductionInfo = '';
    if (compData.target?.operator) {
      const dedResult = await env.WELLS_DB.prepare(`
        SELECT odp.operator_name, odp.county, odp.blended_all_in_pct, odp.oil_marketing_pct, odp.gas_gathering_pct, odp.tax_pct, odp.confidence
        FROM operator_aliases oa JOIN operator_deduction_profiles odp ON oa.canonical_operator_number = odp.operator_number
        WHERE UPPER(TRIM(REPLACE(REPLACE(oa.alias_name, '.', ''), ',', ''))) = UPPER(TRIM(REPLACE(REPLACE(?, '.', ''), ',', '')))
        LIMIT 3
      `).bind(compData.target.operator).all();
      if (dedResult.results.length > 0) {
        const d = dedResult.results[0] as any;
        deductionInfo = `\nOperator Deductions (${d.operator_name}):\n  All-in: ${(d.blended_all_in_pct * 100).toFixed(1)}%` +
          (d.gas_gathering_pct ? `, Gathering: ${(d.gas_gathering_pct * 100).toFixed(1)}%` : '') +
          (d.tax_pct ? `, Tax: ${(d.tax_pct * 100).toFixed(1)}%` : '') + '\n';
      }
    }

    // Prices
    let priceInfo = '';
    try {
      const priceResp = await env.TOOLS_WORKER?.fetch(new Request('https://dummy/api/prices'));
      if (priceResp?.ok) {
        const prices = await priceResp.json() as any;
        if (prices.wti?.price || prices.henryHub?.price) {
          priceInfo = `\nCommodity Prices:\n` +
            (prices.wti?.price ? `  WTI: $${prices.wti.price.toFixed(2)}/BBL\n` : '') +
            (prices.henryHub?.price ? `  Henry Hub: $${prices.henryHub.price.toFixed(2)}/MMBtu\n` : '');
        }
      }
    } catch { /* non-fatal */ }

    const today = new Date().toISOString().split('T')[0];
    const t = compData.target;
    const c = compData.cohort;
    const s = compData.summary;
    const u = compData.unit;

    const unitWellsList = (u?.wells || []).map((w: any) =>
      `  - ${w.name} (API: ${w.api}, ${w.type}, ${w.formation || 'Unknown'}, ${w.completion_date ? `Completed: ${w.completion_date}` : 'No completion date'})`
    ).join('\n');

    const systemPrompt = FORECAST_SYSTEM_PROMPT.replace('{DATE}', today);
    const userMessage = `Generate a Well Performance Forecast for:

**Production Unit:** ${u?.pun || 'Unknown PUN'}
**Location:** ${t.trs}, ${t.county} County
**Operator:** ${t.operator || 'Unknown'}
**Formation:** ${t.formation || 'Unknown'} (${t.well_type})

**Wells in Unit (${u?.well_count || 1}):**
${unitWellsList || `  - ${t.well_name} (API: ${t.api})`}

**Comparable Cohort:** ${c.count} comparable units (${c.total_wells || c.count} wells)
Formation: ${c.formation}, Type: ${c.well_type}, County: ${c.county}
Completion range: ${c.completion_range}, Tier ${c.tier}

**Type Curve Milestones (P10 / P50 / P90):**
${milestoneText}

**Summary:**
- Cumulative P50 oil: ${s.cumulative_p50_oil?.toLocaleString()} BBL
- Cumulative P50 gas: ${s.cumulative_p50_gas?.toLocaleString()} MCF
- Data spans: ${Math.round(s.max_months_of_data / 12)} years

${compData.target_vs_curve ? `**Unit vs Comparable Curve:** ${compData.target_vs_curve.performance_vs_p50 || 'N/A'} (${compData.target_vs_curve.months_producing} months producing)` : '**New unit — no production data yet**'}
${compData.operator_sub_cohort ? `**Operator sub-cohort:** ${compData.operator_sub_cohort.count} units by ${compData.operator_sub_cohort.operator}` : ''}
${deductionInfo}${priceInfo}
Today's date is ${today}. OTC data lags 2-3 months.`;

    console.log(`[WellForecast] Calling Claude Opus for ${apiOrPun}`);
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 4096, temperature: 0.3, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
    });

    if (!apiResponse.ok) {
      console.error(`[WellForecast] Claude API error: ${apiResponse.status}`);
      return jsonResponse({ error: 'Forecast generation failed.' }, 502);
    }

    const apiResult = await apiResponse.json() as any;
    const forecastText = apiResult.content?.[0]?.text;
    if (!forecastText) return jsonResponse({ error: 'No forecast generated' }, 502);

    await usageService.deductCredits(userId, userPlan, creditCost);

    const forecastId = `wf_${crypto.randomUUID().slice(0, 12)}`;
    const generatedAt = new Date().toISOString();

    await env.WELLS_DB.prepare(`
      INSERT INTO well_forecasts (id, target_api, target_pun, user_id, org_id, scope_key,
        formation, well_type, county, operator, comparable_count,
        forecast_text, data_snapshot, model, credits_charged, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_api, scope_key) DO UPDATE SET
        target_pun = excluded.target_pun, forecast_text = excluded.forecast_text,
        data_snapshot = excluded.data_snapshot, comparable_count = excluded.comparable_count,
        model = excluded.model, credits_charged = excluded.credits_charged,
        generated_at = excluded.generated_at
    `).bind(
      forecastId, t.api, u?.pun || null, userId, orgId, scopeKey,
      t.formation, t.well_type, t.county, t.operator, c.count,
      forecastText, JSON.stringify({ milestones: compData.milestones, summary: s }),
      'claude-opus-4-6', creditCost, generatedAt
    ).run();

    return jsonResponse({
      success: true,
      forecast: {
        id: forecastId, forecast_text: forecastText, model: 'claude-opus-4-6',
        credits_charged: creditCost, generated_at: generatedAt,
        formation: t.formation, well_type: t.well_type, county: t.county, comparable_count: c.count,
      },
    });
  } catch (error) {
    console.error('[WellForecast] POST error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Forecast failed' }, 500);
  }
}
