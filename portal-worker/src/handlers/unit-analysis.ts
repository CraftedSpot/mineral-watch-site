/**
 * AI Production Analysis Handler
 *
 * Generates AI-powered production analysis for unit print reports.
 * Uses Claude API (Sonnet default, Opus enhanced) with production data
 * enriched by deduction rates, user interests, and risk profiles.
 * Persisted in D1 for re-use across page reloads and printing.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { fetchUnitPrintData } from './unit-print.js';
import { UsageTrackingService } from '../services/usage-tracking.js';
import type { Env } from '../types/env.js';

const SYSTEM_PROMPT = `You are a mineral rights production analyst. Today's date is {DATE}.

Oklahoma Tax Commission (OTC) production data typically lags 2-3 months behind actual production. The most recent reported month is {LATEST_MONTH} — this is expected and does NOT indicate the well has been shut in. Only flag a potential shut-in if there are consecutive months of zero or missing production BEFORE the expected OTC reporting lag window.

Analyze this unit's production data and provide a concise report (400-600 words) for a mineral rights owner. You have both annual lifetime data and recent monthly detail — use both to tell the full production story. Cover:

1. **Production Status** — Is this well actively producing? How does recent production compare to its historical trend? Use the annual lifetime data to contextualize — a well producing 100 BBL/month that started at 5,000 BBL/month is in a very different situation than one that always produced 100 BBL/month.
2. **Decline Assessment** — Characterize the full production lifecycle using the annual history. What was peak production? How steep was the initial decline? Has it stabilized? Quantify the decline rate where possible.
3. **Anomalies** — Flag months with unusual spikes or drops. Be specific about which months and values.
4. **GOR Trends** — Analyze the gas-to-oil ratio trend and what it suggests about the reservoir.
5. **Revenue Context** — Using recent production rates, give a rough sense of revenue scale at current commodity prices. Be clear this is approximate.
6. **Forward Outlook** — What should the mineral owner expect? Will it continue producing at low rates, or is it approaching economic limit?

Use specific numbers from the data. Write in clear prose paragraphs, not bullet points. Be direct but not alarmist. Do not repeat the raw production table back. Do not disclaim that you are an AI.`;

/**
 * GET /api/unit-analysis?pun=XXX
 */
export async function handleGetUnitAnalysis(request: Request, env: Env): Promise<Response> {
  try {
    const session = await authenticateRequest(request, env);
    if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

    const url = new URL(request.url);
    const pun = url.searchParams.get('pun');
    if (!pun) return jsonResponse({ error: 'pun parameter required' }, 400);

    const userId = session.airtableUser?.id || session.id;
    const orgId = session.airtableUser?.fields?.Organization?.[0] || null;
    const scopeKey = orgId || userId;

    const analysis = await env.WELLS_DB.prepare(`
      SELECT * FROM unit_analyses WHERE pun = ? AND scope_key = ? LIMIT 1
    `).bind(pun, scopeKey).first<any>();

    if (!analysis) {
      return jsonResponse({ success: true, analysis: null });
    }

    // Check if newer data is available
    const horizonResult = await env.WELLS_DB.prepare(
      `SELECT MAX(year_month) as horizon FROM otc_production`
    ).first<any>();
    const currentHorizon = horizonResult?.horizon || null;
    const newDataAvailable = currentHorizon && analysis.latest_production_month
      ? currentHorizon > analysis.latest_production_month : false;

    return jsonResponse({
      success: true,
      analysis: {
        id: analysis.id,
        analysis_text: analysis.analysis_text,
        model: analysis.model,
        credits_charged: analysis.credits_charged,
        generated_at: analysis.generated_at,
        latest_production_month: analysis.latest_production_month,
      },
      newDataAvailable,
    });
  } catch (error) {
    console.error('[UnitAnalysis] GET error:', error);
    return jsonResponse({ error: 'Failed to fetch analysis' }, 500);
  }
}

/**
 * POST /api/unit-analysis
 */
export async function handleCreateUnitAnalysis(request: Request, env: Env): Promise<Response> {
  try {
    const session = await authenticateRequest(request, env);
    if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'AI analysis not configured' }, 503);
    }

    const body = await request.json() as { pun?: string; wellApi?: string; enhanced?: boolean };
    const { pun, wellApi, enhanced } = body;
    if (!pun) return jsonResponse({ error: 'pun is required' }, 400);

    const userId = session.airtableUser?.id || session.id;
    const orgId = session.airtableUser?.fields?.Organization?.[0] || null;
    const scopeKey = orgId || userId;
    const userPlan = session.airtableUser?.fields?.Plan || 'Free';
    const userEmail = session.email || 'unknown';
    const creditCost = enhanced ? 2 : 1;
    const model = enhanced ? 'claude-opus-4-6' : 'claude-sonnet-4-6';

    // Credit check
    const usageService = new UsageTrackingService(env.WELLS_DB);
    const creditCheck = await usageService.checkCreditsAvailable(userId, userPlan);
    if (creditCheck.totalAvailable < creditCost) {
      return jsonResponse({
        error: `Insufficient credits. Need ${creditCost}, have ${creditCheck.totalAvailable}.`,
        credits: creditCheck,
      }, 402);
    }

    // Assemble production data
    const data = await fetchUnitPrintData(pun, wellApi || null, env, session);

    // Query annual production history for lifetime context
    const basePun = pun.substring(0, 10);
    const wellApis = data.wells.map(w => w.api).filter(Boolean);
    let annualBasePuns = [basePun];
    if (wellApis.length > 0) {
      const apiPlaceholders = wellApis.map(() => '?').join(',');
      const bpResult = await env.WELLS_DB.prepare(
        `SELECT DISTINCT base_pun FROM well_pun_links WHERE api_number IN (${apiPlaceholders}) AND base_pun IS NOT NULL`
      ).bind(...wellApis).all();
      const linked = (bpResult.results as any[]).map((r: any) => r.base_pun).filter(Boolean);
      annualBasePuns = [...new Set([...annualBasePuns, ...linked])];
    }
    const abpPlaceholders = annualBasePuns.map(() => '?').join(',');
    const annualResult = await env.WELLS_DB.prepare(`
      SELECT SUBSTR(year_month, 1, 4) as year,
        SUM(CASE WHEN product_code IN ('1', '3') THEN gross_volume ELSE 0 END) as oil,
        SUM(CASE WHEN product_code IN ('5', '6') THEN gross_volume ELSE 0 END) as gas
      FROM otc_production
      WHERE base_pun IN (${abpPlaceholders})
      GROUP BY SUBSTR(year_month, 1, 4)
      ORDER BY year ASC
    `).bind(...annualBasePuns).all();
    const annualHistory = (annualResult.results as any[]).map((r: any) => ({
      year: r.year, oil: r.oil || 0, gas: r.gas || 0,
    }));

    // Enrich: deduction rates
    let deductionInfo = '';
    if (data.operator) {
      const dedResult = await env.WELLS_DB.prepare(`
        SELECT odp.operator_name, odp.county, odp.blended_all_in_pct,
               odp.oil_marketing_pct, odp.gas_gathering_pct, odp.tax_pct, odp.confidence
        FROM operator_aliases oa
        JOIN operator_deduction_profiles odp ON oa.canonical_operator_number = odp.operator_number
        WHERE UPPER(TRIM(REPLACE(REPLACE(oa.alias_name, '.', ''), ',', ''))) = UPPER(TRIM(REPLACE(REPLACE(?, '.', ''), ',', '')))
        LIMIT 3
      `).bind(data.operator).all();
      if (dedResult.results.length > 0) {
        const d = dedResult.results[0] as any;
        deductionInfo = `\nDEDUCTION RATES (${d.operator_name}, ${d.county} County):\n` +
          `Blended all-in: ${(d.blended_all_in_pct * 100).toFixed(1)}%\n` +
          (d.oil_marketing_pct ? `Oil marketing: ${(d.oil_marketing_pct * 100).toFixed(1)}%\n` : '') +
          (d.gas_gathering_pct ? `Gas gathering: ${(d.gas_gathering_pct * 100).toFixed(1)}%\n` : '') +
          (d.tax_pct ? `Tax: ${(d.tax_pct * 100).toFixed(1)}%\n` : '') +
          `Confidence: ${d.confidence}\n`;
      }
    }

    // Enrich: user interests
    let interestInfo = '';
    const wellApis10 = data.wells.map(w => w.api.substring(0, 10));
    if (wellApis10.length > 0) {
      const intPlaceholders = wellApis10.map(() => '?').join(',');
      const intResult = await env.WELLS_DB.prepare(`
        SELECT api_number, ri_nri, wi_nri, orri_nri FROM client_wells
        WHERE SUBSTR(api_number, 1, 10) IN (${intPlaceholders}) AND user_id = ?
      `).bind(...wellApis10, userId).all();
      if (intResult.results.length > 0) {
        interestInfo = '\nOWNER INTERESTS:\n';
        for (const row of intResult.results as any[]) {
          const parts: string[] = [];
          if (row.ri_nri) parts.push(`RI/NRI: ${row.ri_nri}`);
          if (row.wi_nri) parts.push(`WI: ${row.wi_nri}`);
          if (row.orri_nri) parts.push(`ORRI: ${row.orri_nri}`);
          if (parts.length > 0) {
            interestInfo += `API ${row.api_number}: ${parts.join(', ')}\n`;
          }
        }
      }
    }

    // Build production table for prompt
    const prodTable = data.monthlyHistory.slice(0, 24).map(m =>
      `${m.month}: oil=${m.oil.toLocaleString()} BBL, gas=${m.gas.toLocaleString()} MCF`
    ).join('\n');

    // Wells detail
    const wellsDetail = data.wells.map(w =>
      `- ${w.name} (API: ${w.api}, ${w.direction}, ${w.status}, Formation: ${w.formation || 'Unknown'}` +
      `${w.completionDate ? `, Completed: ${w.completionDate}` : ''})`
    ).join('\n');

    // Linked properties
    const propsDetail = data.linkedProperties.map(p =>
      `${p.county} County, ${p.township}-${p.range}-${p.section}, NMA: ${p.nra}${p.group ? `, Group: ${p.group}` : ''}`
    ).join('\n');

    // YoY and trend
    const last12Oil = data.production.last12.oil;
    const last12Gas = data.production.last12.gas;
    const recentOil = data.production.recent.oil;
    const recentGas = data.production.recent.gas;

    const today = new Date().toISOString().split('T')[0];
    const latestMonth = data.lastReportedYearMonth || 'unknown';
    const latestFormatted = latestMonth !== 'unknown'
      ? `${latestMonth.substring(0, 4)}-${latestMonth.substring(4, 6)}` : 'unknown';

    // Build system prompt with date injection
    const systemPrompt = SYSTEM_PROMPT
      .replace('{DATE}', today)
      .replace('{LATEST_MONTH}', latestFormatted);

    // Build user message
    const userMessage = `Analyze the production data for this unit:

Unit PUN: ${pun}
Operator: ${data.operator}
County: ${data.county}
Location: ${data.location}

WELLS (${data.wells.length}):
${wellsDetail}

PRODUCTION:
- Most recent month (${data.lastReported || 'N/A'}): ${recentOil.toLocaleString()} BBL oil, ${recentGas.toLocaleString()} MCF gas
- Last 12 months: ${last12Oil.toLocaleString()} BBL oil, ${last12Gas.toLocaleString()} MCF gas
- Lifetime: ${data.production.lifetime.oil.toLocaleString()} BBL oil, ${data.production.lifetime.gas.toLocaleString()} MCF gas
- Reporting status: ${data.reportingStatus}

ANNUAL PRODUCTION HISTORY (LIFETIME):
${annualHistory.map(a => `${a.year}: oil=${a.oil.toLocaleString()} BBL, gas=${a.gas.toLocaleString()} MCF`).join('\n')}

MONTHLY HISTORY (RECENT 24 MONTHS):
${prodTable}
${deductionInfo}${interestInfo}
${data.linkedProperties.length > 0 ? `LINKED MINERAL INTERESTS:\n${propsDetail}\n` : ''}
${data.occFilings.length > 0 ? `OCC FILINGS (${data.occFilings.length}):\n${data.occFilings.slice(0, 10).map(f => `- ${f.formType}: ${f.description} (${f.date})`).join('\n')}\n` : ''}
Today's date is ${today}. OTC data typically lags 2-3 months.`;

    // Call Claude API
    console.log(`[UnitAnalysis] Calling ${model} for PUN ${pun}`);
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text().catch(() => 'Unknown error');
      console.error(`[UnitAnalysis] Claude API error: ${apiResponse.status} ${errText}`);
      const detail = apiResponse.status === 401 ? 'API key invalid or expired'
        : apiResponse.status === 429 ? 'Rate limited — try again in a moment'
        : `API error ${apiResponse.status}`;
      return jsonResponse({ error: `Analysis generation failed: ${detail}` }, 502);
    }

    const apiResult = await apiResponse.json() as any;
    const analysisText = apiResult.content?.[0]?.text;
    if (!analysisText) {
      return jsonResponse({ error: 'No analysis generated' }, 502);
    }

    // Deduct credits (after successful generation)
    await usageService.deductCredits(userId, userPlan, creditCost);

    // Persist analysis (upsert)
    const analysisId = `ua_${crypto.randomUUID().slice(0, 12)}`;
    const generatedAt = new Date().toISOString();
    const dataSnapshot = JSON.stringify({
      wells: data.wells.length,
      recent: data.production.recent,
      last12: data.production.last12,
      lifetime: data.production.lifetime,
      latestMonth,
    });

    await env.WELLS_DB.prepare(`
      INSERT INTO unit_analyses (id, pun, user_id, org_id, scope_key, analysis_text, data_snapshot, model, credits_charged, generated_at, latest_production_month)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pun, scope_key) DO UPDATE SET
        analysis_text = excluded.analysis_text,
        data_snapshot = excluded.data_snapshot,
        model = excluded.model,
        credits_charged = excluded.credits_charged,
        generated_at = excluded.generated_at,
        latest_production_month = excluded.latest_production_month
    `).bind(analysisId, pun, userId, orgId, scopeKey, analysisText, dataSnapshot, model, creditCost, generatedAt, latestMonth).run();

    console.log(`[UnitAnalysis] Generated analysis for PUN ${pun} (${model}, ${creditCost} credits)`);

    return jsonResponse({
      success: true,
      analysis: {
        id: analysisId,
        analysis_text: analysisText,
        model,
        credits_charged: creditCost,
        generated_at: generatedAt,
        latest_production_month: latestMonth,
      },
      newDataAvailable: false,
    });
  } catch (error) {
    console.error('[UnitAnalysis] POST error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Analysis failed',
    }, 500);
  }
}
