/**
 * Unit Print Report Handler
 *
 * Serves a print-friendly production report for a PUN (Production Unit Number)
 * GET /print/unit?pun=XXX-XXXXXX-X-XXXX&wellApi=XXXXXXXXXX
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

// Airtable config
const BASE_ID = 'appIX0OpR1mxMZMX2';
const PROPERTIES_TABLE = 'tblKrZhI2b0lIVE1O';

interface UnitPrintData {
  pun: string;
  operator: string;
  operatorPhone: string | null;
  operatorContact: string | null;
  location: string;
  county: string;
  lastReported: string | null;
  wells: Array<{
    api: string;
    name: string;
    direction: string;
    status: string;
    wellType: string;
    formation: string | null;
    spudDate: string | null;
    completionDate: string | null;
    firstProdDate: string | null;
    currentWell: boolean;
  }>;
  production: {
    recent: { oil: number; gas: number };
    last12: { oil: number; gas: number };
    lifetime: { oil: number; gas: number };
  };
  monthlyHistory: Array<{ month: string; oil: number; gas: number }>;
  linkedProperties: Array<{
    name: string;
    section: string;
    township: string;
    range: string;
    county: string;
    nra: string;
  }>;
}

/**
 * Fetch all data needed for the unit print report
 */
async function fetchUnitPrintData(
  pun: string,
  wellApi: string | null,
  env: Env
): Promise<UnitPrintData> {
  if (!env.WELLS_DB) {
    throw new Error('Database not available');
  }

  // 1. Get wells in this PUN from well_pun_links
  const wellsResult = await env.WELLS_DB.prepare(`
    SELECT DISTINCT l.api_number, w.well_name, w.operator, w.county,
           w.section, w.township, w.range, w.meridian,
           w.well_type, w.well_status, w.formation_name,
           w.spud_date, w.completion_date, w.first_production_date,
           w.lateral_length,
           o.phone as operator_phone, o.contact_name as operator_contact
    FROM well_pun_links l
    JOIN wells w ON l.api_number = w.api_number OR l.api_number = SUBSTR(w.api_number, 1, 10)
    LEFT JOIN operators o ON UPPER(TRIM(REPLACE(REPLACE(w.operator, '.', ''), ',', ''))) = o.operator_name_normalized
    WHERE l.pun = ?
    ORDER BY w.first_production_date ASC
  `).bind(pun).all();

  const wells = (wellsResult.results || []) as Array<any>;

  // Determine operator info from first well
  const firstWell = wells[0] || {};
  const operator = firstWell.operator || 'Unknown';
  const operatorPhone = firstWell.operator_phone || null;
  const operatorContact = firstWell.operator_contact || null;
  const county = firstWell.county || '';

  // Format location from first well
  const location = firstWell.township && firstWell.range && firstWell.section
    ? `T${firstWell.township} R${firstWell.range} Section ${firstWell.section}`
    : '';

  // Format wells data
  const formattedWells = wells.map(w => {
    const isHorizontal = w.lateral_length && parseInt(w.lateral_length) > 0;
    return {
      api: w.api_number,
      name: w.well_name || 'Unknown',
      direction: isHorizontal ? 'Horizontal' : 'Vertical',
      status: w.well_status || 'Unknown',
      wellType: w.well_type || 'Unknown',
      formation: w.formation_name || null,
      spudDate: w.spud_date ? formatDate(w.spud_date) : null,
      completionDate: w.completion_date ? formatDate(w.completion_date) : null,
      firstProdDate: w.first_production_date ? formatDate(w.first_production_date) : null,
      currentWell: wellApi ? (w.api_number === wellApi || w.api_number.startsWith(wellApi) || wellApi.startsWith(w.api_number)) : false
    };
  });

  // 2. Get production data for this PUN
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const twelveMonthsAgoYM = `${twelveMonthsAgo.getFullYear()}${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

  const twentyFourMonthsAgo = new Date(now);
  twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);
  const twentyFourMonthsAgoYM = `${twentyFourMonthsAgo.getFullYear()}${String(twentyFourMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

  // Get monthly production for last 24 months
  const monthlyResult = await env.WELLS_DB.prepare(`
    SELECT year_month,
           SUM(CASE WHEN product_code IN ('1', '3') THEN gross_volume ELSE 0 END) as oil_volume,
           SUM(CASE WHEN product_code IN ('5', '6') THEN gross_volume ELSE 0 END) as gas_volume
    FROM otc_production
    WHERE pun = ? AND year_month >= ?
    GROUP BY year_month
    ORDER BY year_month DESC
  `).bind(pun, twentyFourMonthsAgoYM).all();

  // Get lifetime totals
  const lifetimeResult = await env.WELLS_DB.prepare(`
    SELECT product_code, SUM(gross_volume) as volume
    FROM otc_production
    WHERE pun = ?
    GROUP BY product_code
  `).bind(pun).all();

  // Process monthly data
  const monthlyMap = new Map<string, { oil: number; gas: number }>();
  for (const row of (monthlyResult.results || []) as any[]) {
    monthlyMap.set(row.year_month, {
      oil: Math.round(row.oil_volume || 0),
      gas: Math.round(row.gas_volume || 0)
    });
  }

  // Generate 24 months of history (most recent first)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyHistory: Array<{ month: string; oil: number; gas: number }> = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const data = monthlyMap.get(ym) || { oil: 0, gas: 0 };
    monthlyHistory.push({
      month: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
      oil: data.oil,
      gas: data.gas
    });
  }

  // Calculate production summaries
  const recent = monthlyHistory[0] || { oil: 0, gas: 0 };
  const last12 = { oil: 0, gas: 0 };
  for (let i = 0; i < 12 && i < monthlyHistory.length; i++) {
    last12.oil += monthlyHistory[i].oil;
    last12.gas += monthlyHistory[i].gas;
  }

  // Process lifetime totals
  const lifetime = { oil: 0, gas: 0 };
  for (const row of (lifetimeResult.results || []) as any[]) {
    if (['1', '3'].includes(row.product_code)) {
      lifetime.oil += Math.round(row.volume || 0);
    } else {
      lifetime.gas += Math.round(row.volume || 0);
    }
  }

  // Last reported month
  const lastReported = monthlyHistory.find(m => m.oil > 0 || m.gas > 0)?.month || null;

  // 3. Get linked properties via property_well_links
  const linkedProperties: UnitPrintData['linkedProperties'] = [];

  // Get well Airtable IDs for property lookups
  // First, get the Airtable IDs for wells by API number from client_wells
  const wellApiNumbers = formattedWells.map(w => w.api);
  if (wellApiNumbers.length > 0) {
    const placeholders = wellApiNumbers.map(() => '?').join(',');

    // Join client_wells to get Airtable IDs, then join property_well_links
    const linksResult = await env.WELLS_DB.prepare(`
      SELECT DISTINCT pwl.property_airtable_id
      FROM client_wells cw
      JOIN property_well_links pwl ON pwl.well_airtable_id = cw.airtable_id
      WHERE cw.api_number IN (${placeholders})
        AND pwl.status = 'Active'
    `).bind(...wellApiNumbers).all();

    const propertyIds = (linksResult.results || []).map((r: any) => r.property_airtable_id).filter(Boolean);

    // Fetch property details from Airtable
    if (propertyIds.length > 0) {
      const formula = `OR(${propertyIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
      const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${PROPERTIES_TABLE}?filterByFormula=${encodeURIComponent(formula)}`;

      try {
        const response = await fetch(airtableUrl, {
          headers: { 'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        });

        if (response.ok) {
          const data = await response.json() as { records: Array<{ id: string; fields: any }> };
          for (const record of data.records) {
            const f = record.fields;
            linkedProperties.push({
              name: f['Property Name'] || f['Name'] || 'Unknown',
              section: f['Section'] || '',
              township: f['Township'] || '',
              range: f['Range'] || '',
              county: f['County'] || '',
              nra: String(f['Total Acres'] || f['NRA'] || '0')
            });
          }
        }
      } catch (err) {
        console.error('Error fetching properties from Airtable:', err);
      }
    }
  }

  return {
    pun,
    operator,
    operatorPhone,
    operatorContact,
    location,
    county,
    lastReported,
    wells: formattedWells,
    production: { recent, last12, lifetime },
    monthlyHistory,
    linkedProperties
  };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

/**
 * GET /print/unit?pun=XXX&wellApi=YYY
 * Serves the unit print report page
 */
export async function handleUnitPrint(
  request: Request,
  env: Env
): Promise<Response> {
  // Require authentication
  const session = await authenticateRequest(request, env);
  if (!session) {
    const url = new URL(request.url);
    const redirectUrl = `/portal/login?redirect=${encodeURIComponent(url.pathname + url.search)}`;
    return Response.redirect(redirectUrl, 302);
  }

  const url = new URL(request.url);
  const pun = url.searchParams.get('pun');
  const wellApi = url.searchParams.get('wellApi');

  if (!pun) {
    return new Response('Missing pun parameter', { status: 400 });
  }

  try {
    // Fetch all data for the report
    const data = await fetchUnitPrintData(pun, wellApi, env);

    // Return the HTML page with data injected
    const html = generateUnitPrintHtml(data);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  } catch (error) {
    console.error('Error generating unit print report:', error);
    return new Response(`Error generating report: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      status: 500
    });
  }
}

/**
 * GET /api/unit-print-data?pun=XXX&wellApi=YYY
 * Returns JSON data for unit print report (for client-side rendering if needed)
 */
export async function handleUnitPrintData(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await authenticateRequest(request, env);
  if (!session) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const url = new URL(request.url);
  const pun = url.searchParams.get('pun');
  const wellApi = url.searchParams.get('wellApi');

  if (!pun) {
    return jsonResponse({ error: 'Missing pun parameter' }, 400);
  }

  try {
    const data = await fetchUnitPrintData(pun, wellApi, env);
    return jsonResponse({ success: true, data });
  } catch (error) {
    console.error('Error fetching unit print data:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

function generateUnitPrintHtml(data: UnitPrintData): string {
  const fmt = (n: number) => n.toLocaleString();
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Generate wells HTML
  const wellsHtml = data.wells.map((well, i) => {
    const rowClass = well.currentWell ? 'current' : (i % 2 !== 0 ? 'alt' : '');
    return `
      <div class="well-row ${rowClass}">
        <span class="well-arrow">▸</span>
        <div class="well-info">
          <div class="well-name">${escapeHtml(well.name)}</div>
          <div class="well-api">API: ${escapeHtml(well.api)}</div>
        </div>
        <span class="badge badge-direction">${escapeHtml(well.direction)}</span>
        <span class="badge badge-status">${escapeHtml(well.status)}</span>
        <span class="badge badge-type">${escapeHtml(well.wellType)}</span>
        ${well.formation ? `<span class="badge badge-formation">${escapeHtml(well.formation)}</span>` : ''}
        <div class="well-dates">
          ${well.spudDate ? `<div>Spud: ${escapeHtml(well.spudDate)}</div>` : ''}
          ${well.completionDate ? `<div>Comp: ${escapeHtml(well.completionDate)}</div>` : ''}
          ${well.firstProdDate ? `<div>Prod: ${escapeHtml(well.firstProdDate)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Generate totals HTML
  const activeCount = data.wells.filter(w => w.status === 'Active' || w.status === 'AC').length;
  const totalsHtml = `
    <div class="totals-item">
      <div class="totals-label">RECENT${data.lastReported ? ` (${data.lastReported.toUpperCase()})` : ''}</div>
      <div class="totals-oil">${fmt(data.production.recent.oil)} <span class="totals-unit">BBL</span></div>
      <div class="totals-gas">${fmt(data.production.recent.gas)} <span class="totals-unit">MCF</span></div>
    </div>
    <div class="totals-item">
      <div class="totals-label">LAST 12 MONTHS</div>
      <div class="totals-oil">${fmt(data.production.last12.oil)} <span class="totals-unit">BBL</span></div>
      <div class="totals-gas">${fmt(data.production.last12.gas)} <span class="totals-unit">MCF</span></div>
    </div>
    <div class="totals-item">
      <div class="totals-label">LIFETIME (ALL WELLS)</div>
      <div class="totals-oil">${fmt(data.production.lifetime.oil)} <span class="totals-unit">BBL</span></div>
      <div class="totals-gas">${fmt(data.production.lifetime.gas)} <span class="totals-unit">MCF</span></div>
    </div>
    <div class="totals-item">
      <div class="totals-label">WELLS</div>
      <div class="totals-wells">${data.wells.length} <span class="totals-unit">total</span></div>
      <div class="totals-active">${activeCount} active</div>
    </div>
  `;

  // Generate monthly table rows (24 months, 4 columns)
  // Show "—" for months with no reported data instead of "0"
  const fmtValue = (m: { oil: number; gas: number } | undefined, field: 'oil' | 'gas') => {
    if (!m) return '';
    const hasData = m.oil > 0 || m.gas > 0;
    if (!hasData) return '<span class="no-data">—</span>';
    return fmt(m[field]);
  };

  let monthlyRows = '';
  for (let i = 0; i < 6; i++) {
    const rowClass = i % 2 !== 0 ? 'class="alt"' : '';
    monthlyRows += `
      <tr ${rowClass}>
        <td>${data.monthlyHistory[i]?.month || ''}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i], 'oil')}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i], 'gas')}</td>
        <td class="month-start">${data.monthlyHistory[i + 6]?.month || ''}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i + 6], 'oil')}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i + 6], 'gas')}</td>
        <td class="month-start">${data.monthlyHistory[i + 12]?.month || ''}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i + 12], 'oil')}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i + 12], 'gas')}</td>
        <td class="month-start">${data.monthlyHistory[i + 18]?.month || ''}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i + 18], 'oil')}</td>
        <td class="value">${fmtValue(data.monthlyHistory[i + 18], 'gas')}</td>
      </tr>
    `;
  }

  // Generate properties HTML
  const propertiesHtml = data.linkedProperties.length > 0
    ? data.linkedProperties.map((prop, i) => `
        <tr ${i % 2 !== 0 ? 'class="alt"' : ''}>
          <td class="bold">${escapeHtml(prop.name)}</td>
          <td>Sec ${escapeHtml(prop.section)}, T${escapeHtml(prop.township)}, R${escapeHtml(prop.range)}</td>
          <td>${escapeHtml(prop.county)}</td>
          <td class="right bold">${escapeHtml(prop.nra)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" style="color: #64748b; font-style: italic;">No linked properties</td></tr>';

  // Calculate trend
  const oldest = data.monthlyHistory[data.monthlyHistory.length - 1];
  const newest = data.monthlyHistory[0];
  let trendHtml = '';
  if (oldest && newest && oldest.oil > 0) {
    const oilChange = Math.round(((newest.oil - oldest.oil) / oldest.oil) * 100);
    const isPositive = oilChange >= 0;
    trendHtml = `
      <span class="trend-label">24-Mo Change:</span>
      <span class="${isPositive ? 'trend-positive' : 'trend-negative'}">
        ${isPositive ? '↑' : '↓'} ${Math.abs(oilChange)}%
      </span>
      <span class="trend-detail">
        (${oldest.month}: ${fmt(oldest.oil)} BBL → ${newest.month}: ${fmt(newest.oil)} BBL)
      </span>
    `;
  }

  // Generate SVG chart - filter to only months with reported data
  const reportedMonths = data.monthlyHistory.filter(m => m.oil > 0 || m.gas > 0);
  const chartSvg = generateSparseProductionChart(reportedMonths);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unit Production Report - ${escapeHtml(data.pun)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f1f5f9; padding: 20px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .print-controls { max-width: 8.5in; margin: 0 auto 16px auto; display: flex; justify-content: flex-end; gap: 12px; }
    .print-btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .print-btn.primary { background: #1C2B36; color: white; }
    .print-btn.primary:hover { background: #334E68; }
    .print-btn.secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
    .print-btn.secondary:hover { background: #f8fafc; }
    .print-container { width: 8.5in; min-height: 11in; margin: 0 auto; background: white; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #1C2B36 0%, #334E68 100%); color: white; padding: 20px 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-size: 18px; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.5px; }
    .header .pun { font-size: 14px; font-weight: 500; opacity: 0.9; margin-bottom: 4px; font-family: monospace; }
    .header .location { font-size: 12px; opacity: 0.8; }
    .header .brand { text-align: right; }
    .header .brand-name { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 6px; font-family: 'Merriweather', Georgia, serif; }
    .header .brand-url { font-size: 10px; opacity: 0.8; margin-top: 4px; }
    .operator-bar { padding: 12px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .operator-bar .label { font-size: 10px; color: #64748b; font-weight: 500; }
    .operator-bar .name { font-size: 12px; font-weight: 600; color: #1C2B36; }
    .operator-bar .contact { font-size: 11px; color: #64748b; }
    .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
    .section-title { font-size: 11px; font-weight: 700; color: #1C2B36; margin-bottom: 12px; letter-spacing: 0.5px; }
    .wells-container { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
    .well-row { padding: 10px 14px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #e2e8f0; }
    .well-row:last-child { border-bottom: none; }
    .well-row.current { background: #1C2B36; color: white; }
    .well-row.alt { background: #f8fafc; }
    .well-arrow { width: 12px; font-size: 10px; }
    .well-row:not(.current) .well-arrow { color: transparent; }
    .well-info { flex: 1; min-width: 140px; }
    .well-name { font-size: 12px; font-weight: 600; }
    .well-api { font-size: 10px; opacity: 0.7; }
    .badge { font-size: 9px; font-weight: 600; padding: 3px 8px; border-radius: 4px; }
    .badge-direction { background: #e2e8f0; color: #475569; }
    .badge-status { background: rgba(5, 150, 105, 0.1); color: #059669; }
    .badge-type { background: #fef3c7; color: #92400e; }
    .badge-formation { background: #f1f5f9; color: #475569; font-style: italic; font-weight: 500; }
    .well-row.current .badge-direction, .well-row.current .badge-formation { background: rgba(255,255,255,0.15); color: white; }
    .well-row.current .badge-status { background: rgba(5, 150, 105, 0.3); color: #86efac; }
    .well-row.current .badge-type { background: rgba(255,255,255,0.15); color: white; }
    .well-dates { font-size: 9px; text-align: right; opacity: 0.8; min-width: 100px; line-height: 1.4; }
    .production-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .legend { display: flex; gap: 16px; font-size: 10px; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-line { width: 12px; height: 2px; display: inline-block; }
    .legend-oil { background: #059669; }
    .legend-gas { border-top: 2px dashed #6366f1; }
    .totals-grid { display: flex; gap: 24px; margin-bottom: 16px; padding: 12px 16px; background: #f8fafc; border-radius: 6px; }
    .totals-item { border-left: 1px solid #e2e8f0; padding-left: 24px; }
    .totals-item:first-child { border-left: none; padding-left: 0; }
    .totals-label { font-size: 9px; color: #64748b; margin-bottom: 2px; font-weight: 500; }
    .totals-oil { font-size: 14px; font-weight: 700; color: #059669; }
    .totals-gas { font-size: 14px; font-weight: 700; color: #6366f1; }
    .totals-unit { font-size: 10px; font-weight: 400; }
    .totals-wells { font-size: 14px; font-weight: 700; color: #1C2B36; }
    .totals-active { font-size: 12px; font-weight: 600; color: #059669; }
    .chart-container { margin-bottom: 8px; }
    .trend-line { font-size: 10px; color: #64748b; display: flex; align-items: center; gap: 4px; }
    .trend-label { font-weight: 600; color: #475569; }
    .trend-positive { color: #059669; font-weight: 600; }
    .trend-negative { color: #dc2626; font-weight: 600; }
    .trend-detail { color: #94a3b8; }
    .monthly-table { width: 100%; border-collapse: collapse; font-size: 9px; }
    .monthly-table th { padding: 5px 6px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #64748b; background: #f8fafc; }
    .monthly-table th.oil { color: #059669; text-align: right; }
    .monthly-table th.gas { color: #6366f1; text-align: right; }
    .monthly-table th.month-start { padding-left: 16px; }
    .monthly-table td { padding: 4px 6px; }
    .monthly-table td.value { text-align: right; font-weight: 500; }
    .monthly-table td.month-start { padding-left: 16px; }
    .monthly-table tr.alt { background: #f8fafc; }
    .monthly-table .no-data { color: #94a3b8; font-weight: 400; }
    .data-note { font-size: 8px; color: #64748b; font-style: italic; margin-top: 6px; line-height: 1.4; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .data-table th { padding: 5px 8px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #64748b; background: #f8fafc; }
    .data-table th.right { text-align: right; }
    .data-table td { padding: 5px 8px; }
    .data-table td.right { text-align: right; }
    .data-table td.bold { font-weight: 600; }
    .data-table td.small { font-size: 9px; color: #64748b; }
    .data-table tr.alt { background: #f8fafc; }
    .footer { padding: 10px 24px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; background: #f8fafc; }
    @media print {
      body { background: white; padding: 0; }
      .print-controls { display: none !important; }
      .print-container { box-shadow: none; width: 100%; }
      .header { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .well-row.current { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
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
        <h1>UNIT PRODUCTION REPORT</h1>
        <div class="pun">${escapeHtml(data.pun)}</div>
        <div class="location">${escapeHtml(data.location)} • ${escapeHtml(data.county)} County</div>
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

    <div class="operator-bar">
      <div>
        <span class="label">OPERATOR: </span>
        <span class="name">${escapeHtml(data.operator)}</span>
      </div>
      <div class="contact">${data.operatorContact ? escapeHtml(data.operatorContact) + ' • ' : ''}${data.operatorPhone || ''}</div>
    </div>

    <div class="section">
      <div class="section-title">WELLS IN THIS UNIT (${data.wells.length})</div>
      <div class="wells-container">${wellsHtml}</div>
    </div>

    <div class="section">
      <div class="production-header">
        <div class="section-title" style="margin-bottom: 0;">COMBINED UNIT PRODUCTION</div>
        <div class="legend">
          <div class="legend-item"><span class="legend-line legend-oil"></span><span style="color: #059669; font-weight: 600;">Oil (BBL)</span></div>
          <div class="legend-item"><span class="legend-line legend-gas"></span><span style="color: #6366f1; font-weight: 600;">Gas (MCF)</span></div>
        </div>
      </div>
      <div class="totals-grid">${totalsHtml}</div>
      <div class="chart-container">${chartSvg}</div>
      <div class="trend-line">${trendHtml}</div>
    </div>

    <div class="section">
      <div class="section-title">REPORTED PRODUCTION HISTORY (24 MONTHS)</div>
      <table class="monthly-table">
        <thead>
          <tr>
            <th>Month</th><th class="oil">Oil</th><th class="gas">Gas</th>
            <th class="month-start">Month</th><th class="oil">Oil</th><th class="gas">Gas</th>
            <th class="month-start">Month</th><th class="oil">Oil</th><th class="gas">Gas</th>
            <th class="month-start">Month</th><th class="oil">Oil</th><th class="gas">Gas</th>
          </tr>
        </thead>
        <tbody>${monthlyRows}</tbody>
      </table>
      <div class="data-note">
        Note: "—" indicates no production reported to OTC for that month. OTC data typically lags 2-3 months behind actual production.
        Missing months may reflect late reporting, shut-in periods, or production held in storage pending sale.
      </div>
    </div>

    ${data.linkedProperties.length > 0 ? `
    <div class="section" style="padding: 14px 24px;">
      <div class="section-title" style="margin-bottom: 8px;">LINKED MINERAL INTERESTS</div>
      <table class="data-table">
        <thead>
          <tr><th>Property</th><th>Location</th><th>County</th><th class="right">NRA</th></tr>
        </thead>
        <tbody>${propertiesHtml}</tbody>
      </table>
    </div>
    ` : ''}

    <div class="footer">
      <span>Generated by Mineral Watch • mymineralwatch.com • ${new Date().toLocaleDateString()}</span>
      <span>Data sourced from Oklahoma Corporation Commission and Oklahoma Tax Commission</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate a sparse production chart that only shows months with actual data.
 * This avoids misleading "cliff to zero" patterns for wells that report quarterly.
 */
function generateSparseProductionChart(reportedMonths: Array<{ month: string; oil: number; gas: number }>): string {
  // Handle empty or single data point
  if (reportedMonths.length === 0) {
    return `<div style="padding: 20px; text-align: center; color: #64748b; font-size: 12px;">No production data reported in last 24 months</div>`;
  }

  const data = [...reportedMonths].reverse(); // Oldest to newest for chart
  const padding = { top: 25, right: 55, bottom: 40, left: 50 };
  const width = 650;
  const height = 160;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxOil = Math.max(...data.map(d => d.oil), 1);
  const maxGas = Math.max(...data.map(d => d.gas), 1);

  const oilScale = (val: number) => chartHeight - (val / maxOil) * chartHeight;
  const gasScale = (val: number) => chartHeight - (val / maxGas) * chartHeight;

  // Space data points evenly across the chart width
  const xScale = (i: number) => data.length === 1 ? chartWidth / 2 : (i / (data.length - 1)) * chartWidth;

  let svgContent = `<g transform="translate(${padding.left}, ${padding.top})">`;

  // Grid lines
  [0, 0.5, 1].forEach((tick) => {
    svgContent += `<line x1="0" y1="${chartHeight * (1 - tick)}" x2="${chartWidth}" y2="${chartHeight * (1 - tick)}" stroke="#e2e8f0" stroke-width="1" ${tick !== 0 ? 'stroke-dasharray="4,4"' : ''}/>`;
  });

  // Y-axis labels (Oil on left)
  const oilTicks = [0, maxOil * 0.5, maxOil];
  oilTicks.forEach((tick) => {
    const label = tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : tick.toFixed(0);
    svgContent += `<text x="-8" y="${oilScale(tick) + 4}" text-anchor="end" font-size="9" fill="#059669">${label}</text>`;
  });

  // Y-axis labels (Gas on right)
  const gasTicks = [0, maxGas * 0.5, maxGas];
  gasTicks.forEach((tick) => {
    const label = tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : tick.toFixed(0);
    svgContent += `<text x="${chartWidth + 8}" y="${gasScale(tick) + 4}" text-anchor="start" font-size="9" fill="#6366f1">${label}</text>`;
  });

  // X-axis month labels - show each reported month
  const maxLabels = 12; // Don't show more than 12 labels to avoid crowding
  const labelStep = data.length <= maxLabels ? 1 : Math.ceil(data.length / maxLabels);

  data.forEach((d, i) => {
    if (i % labelStep === 0 || i === data.length - 1) {
      const parts = d.month.split(' ');
      const label = parts[0].slice(0, 3) + " '" + parts[1].slice(2);
      const x = xScale(i);
      // Rotate labels slightly if many data points
      if (data.length > 8) {
        svgContent += `<text x="${x}" y="${chartHeight + 12}" text-anchor="end" font-size="8" fill="#64748b" transform="rotate(-25, ${x}, ${chartHeight + 12})">${label}</text>`;
      } else {
        svgContent += `<text x="${x}" y="${chartHeight + 18}" text-anchor="middle" font-size="9" fill="#64748b">${label}</text>`;
      }
    }
  });

  // Draw lines connecting data points
  if (data.length > 1) {
    // Oil line (solid green)
    const oilPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${oilScale(d.oil)}`).join(' ');
    svgContent += `<path d="${oilPath}" fill="none" stroke="#059669" stroke-width="2"/>`;

    // Gas line (dashed purple)
    const gasPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${gasScale(d.gas)}`).join(' ');
    svgContent += `<path d="${gasPath}" fill="none" stroke="#6366f1" stroke-width="2" stroke-dasharray="5,3"/>`;
  }

  // Draw data points for each month with data
  data.forEach((d, i) => {
    const x = xScale(i);
    // Oil point
    svgContent += `<circle cx="${x}" cy="${oilScale(d.oil)}" r="4" fill="#059669"/>`;
    // Gas point
    svgContent += `<circle cx="${x}" cy="${gasScale(d.gas)}" r="4" fill="#6366f1"/>`;
  });

  // Axis labels
  svgContent += `<text x="-35" y="-12" font-size="9" fill="#059669" font-weight="600">BBL</text>`;
  svgContent += `<text x="${chartWidth + 20}" y="-12" font-size="9" fill="#6366f1" font-weight="600">MCF</text>`;

  // Note about sparse data
  if (data.length < 12) {
    svgContent += `<text x="${chartWidth / 2}" y="${chartHeight + 32}" text-anchor="middle" font-size="8" fill="#94a3b8" font-style="italic">${data.length} months with reported production</text>`;
  }

  svgContent += '</g>';

  return `<svg width="${width}" height="${height}" style="display: block; max-width: 100%;">${svgContent}</svg>`;
}
