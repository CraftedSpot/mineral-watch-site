/**
 * Operator Deduction Matrix — Admin endpoints for building operator-level deduction profiles
 *
 * Three endpoints:
 * A) bootstrap-operator-aliases: PUN bridge + name matching to link freeform operator names to OTC operator_numbers
 * B) seed-operator-profiles: Aggregate OTC financial data into operator_deduction_profiles
 * C) ingest-check-stub-deductions: Parse check stub extracted_data into deduction_observations
 */

import type { Env } from '../types/env.js';
import { jsonResponse } from '../utils/responses.js';

// Common suffixes to strip for name matching
const BUSINESS_SUFFIXES = /\b(LLC|INC|CORP|CORPORATION|LTD|LIMITED|COMPANY|CO|LP|LC|PLLC|L\.?P\.?|L\.?L\.?C\.?)\b\.?/gi;
const PUNCTUATION = /[.,;:'"()\-\/\\]/g;

function normalizeOperatorName(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(BUSINESS_SUFFIXES, '')
    .replace(PUNCTUATION, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// Endpoint A: POST /api/admin/bootstrap-operator-aliases
// ============================================================
export async function handleBootstrapOperatorAliases(request: Request, env: Env): Promise<Response> {
  const db = env.WELLS_DB;
  if (!db) return jsonResponse({ error: 'Database not available' }, 503);

  const stats = { total_operators: 0, matched: 0, unmatched: 0, by_method: { pun_bridge: 0, exact: 0, fuzzy: 0 } };

  try {
    // Source 1: PUN bridge — highest confidence
    // For all tracked wells with PUN linkage, extract wells.operator → otc_leases.operator_number
    const punBridgeResult = await db.prepare(`
      SELECT DISTINCT UPPER(TRIM(w.operator)) as alias_name,
        ol.operator_number, oc.company_name
      FROM client_wells cw
      JOIN wells w ON w.api_number = cw.api_number
      JOIN well_pun_links wpl ON wpl.api_number = w.api_number
      JOIN otc_leases ol ON wpl.base_pun = ol.base_pun
      JOIN otc_companies oc ON ol.operator_number = oc.company_id
      WHERE w.operator IS NOT NULL AND w.operator != ''
        AND ol.operator_number IS NOT NULL
    `).all();

    // Deduplicate: same alias_name may map to different operators via different wells
    // Pick the most common mapping per alias
    const aliasVotes = new Map<string, Map<string, { name: string; count: number }>>();
    for (const r of punBridgeResult.results as Array<{ alias_name: string; operator_number: string; company_name: string }>) {
      if (!r.alias_name || !r.operator_number) continue;
      if (!aliasVotes.has(r.alias_name)) aliasVotes.set(r.alias_name, new Map());
      const votes = aliasVotes.get(r.alias_name)!;
      const existing = votes.get(r.operator_number);
      if (existing) {
        existing.count++;
      } else {
        votes.set(r.operator_number, { name: r.company_name || r.operator_number, count: 1 });
      }
    }

    // Insert PUN bridge aliases in batches
    const punAliases: Array<{ alias: string; opNum: string; opName: string }> = [];
    for (const [alias, votes] of aliasVotes) {
      // Pick operator with most votes
      let bestOpNum = '';
      let bestOpName = '';
      let bestCount = 0;
      for (const [opNum, info] of votes) {
        if (info.count > bestCount) {
          bestCount = info.count;
          bestOpNum = opNum;
          bestOpName = info.name;
        }
      }
      if (bestOpNum) {
        punAliases.push({ alias, opNum: bestOpNum, opName: bestOpName });
      }
    }

    // Batch insert (D1 limit: 500 statements per batch)
    const BATCH_SIZE = 100;
    for (let i = 0; i < punAliases.length; i += BATCH_SIZE) {
      const batch = punAliases.slice(i, i + BATCH_SIZE);
      const stmts = batch.map(a =>
        db.prepare(`
          INSERT OR IGNORE INTO operator_aliases (alias_name, canonical_operator_number, canonical_operator_name, match_method)
          VALUES (?, ?, ?, 'pun_bridge')
        `).bind(a.alias, a.opNum, a.opName)
      );
      await db.batch(stmts);
    }
    stats.by_method.pun_bridge = punAliases.length;
    console.log(`[Bootstrap Aliases] PUN bridge: ${punAliases.length} aliases`);

    // Source 2: Name matching for remaining unmatched operators
    // Get all distinct operator names from tracked wells not yet in aliases
    const unmatchedResult = await db.prepare(`
      SELECT DISTINCT UPPER(TRIM(w.operator)) as op_name
      FROM client_wells cw
      JOIN wells w ON w.api_number = cw.api_number
      WHERE w.operator IS NOT NULL AND w.operator != ''
        AND UPPER(TRIM(w.operator)) NOT IN (SELECT alias_name FROM operator_aliases)
    `).all();

    const unmatchedNames = (unmatchedResult.results as Array<{ op_name: string }>)
      .map(r => r.op_name)
      .filter(Boolean);

    console.log(`[Bootstrap Aliases] ${unmatchedNames.length} unmatched operator names to try name matching`);

    // For each unmatched name, try exact then fuzzy match against otc_companies
    const nameMatches: Array<{ alias: string; opNum: string; opName: string; method: string }> = [];

    for (const opName of unmatchedNames) {
      const normalized = normalizeOperatorName(opName);
      if (!normalized || normalized.length < 3) continue;

      // Try exact match on company_name (case-insensitive)
      let matchResult = await db.prepare(`
        SELECT company_id, company_name FROM otc_companies
        WHERE UPPER(TRIM(company_name)) = ?
        LIMIT 1
      `).bind(opName).first<{ company_id: string; company_name: string }>();

      if (matchResult) {
        nameMatches.push({ alias: opName, opNum: matchResult.company_id, opName: matchResult.company_name, method: 'exact' });
        continue;
      }

      // Try normalized exact match
      matchResult = await db.prepare(`
        SELECT company_id, company_name FROM otc_companies
        WHERE UPPER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(company_name, ',', ''), '.', ''), '-', ''), '''', ''))) = ?
        LIMIT 1
      `).bind(normalized.replace(/'/g, '')).first<{ company_id: string; company_name: string }>();

      if (matchResult) {
        nameMatches.push({ alias: opName, opNum: matchResult.company_id, opName: matchResult.company_name, method: 'exact' });
        continue;
      }

      // Try LIKE prefix match (first significant word + %)
      const words = normalized.split(/\s+/).filter(w => w.length > 2);
      if (words.length > 0) {
        const likePattern = words[0] + '%';
        const fuzzyResult = await db.prepare(`
          SELECT company_id, company_name FROM otc_companies
          WHERE UPPER(company_name) LIKE ?
          LIMIT 5
        `).bind(likePattern).all();

        if (fuzzyResult.results.length === 1) {
          // Unambiguous match
          const r = fuzzyResult.results[0] as { company_id: string; company_name: string };
          nameMatches.push({ alias: opName, opNum: r.company_id, opName: r.company_name, method: 'fuzzy' });
        } else if (fuzzyResult.results.length > 1 && words.length > 1) {
          // Multiple matches — try two-word prefix
          const twoWordPattern = words.slice(0, 2).join(' ') + '%';
          const refined = await db.prepare(`
            SELECT company_id, company_name FROM otc_companies
            WHERE UPPER(company_name) LIKE ?
            LIMIT 3
          `).bind(twoWordPattern).all();

          if (refined.results.length === 1) {
            const r = refined.results[0] as { company_id: string; company_name: string };
            nameMatches.push({ alias: opName, opNum: r.company_id, opName: r.company_name, method: 'fuzzy' });
          }
        }
      }
    }

    // Batch insert name matches
    for (let i = 0; i < nameMatches.length; i += BATCH_SIZE) {
      const batch = nameMatches.slice(i, i + BATCH_SIZE);
      const stmts = batch.map(m =>
        db.prepare(`
          INSERT OR IGNORE INTO operator_aliases (alias_name, canonical_operator_number, canonical_operator_name, match_method)
          VALUES (?, ?, ?, ?)
        `).bind(m.alias, m.opNum, m.opName, m.method)
      );
      await db.batch(stmts);
    }

    const exactCount = nameMatches.filter(m => m.method === 'exact').length;
    const fuzzyCount = nameMatches.filter(m => m.method === 'fuzzy').length;
    stats.by_method.exact = exactCount;
    stats.by_method.fuzzy = fuzzyCount;

    stats.total_operators = punAliases.length + unmatchedNames.length;
    stats.matched = punAliases.length + nameMatches.length;
    stats.unmatched = unmatchedNames.length - nameMatches.length;

    console.log(`[Bootstrap Aliases] Name matching: ${exactCount} exact, ${fuzzyCount} fuzzy, ${stats.unmatched} unmatched`);

    return jsonResponse({ success: true, ...stats });

  } catch (error) {
    console.error('[Bootstrap Aliases] Error:', error);
    return jsonResponse({
      error: 'Failed to bootstrap operator aliases',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// ============================================================
// Endpoint B: POST /api/admin/seed-operator-profiles
// ============================================================
export async function handleSeedOperatorProfiles(request: Request, env: Env): Promise<Response> {
  const db = env.WELLS_DB;
  if (!db) return jsonResponse({ error: 'Database not available' }, 503);

  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const cutoff = `${sixMonthsAgo.getFullYear()}${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`;
    const periodStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}`;
    const periodEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get distinct operators to process in pages (avoid D1 CPU timeout)
    const operatorListResult = await db.prepare(`
      SELECT DISTINCT ol.operator_number
      FROM otc_leases ol
      WHERE ol.operator_number IS NOT NULL
      ORDER BY ol.operator_number
    `).all();

    const allOperators = (operatorListResult.results as Array<{ operator_number: string }>)
      .map(r => r.operator_number);

    console.log(`[Seed Profiles] Processing ${allOperators.length} operators`);

    let profilesCreated = 0;
    let operatorsCovered = 0;
    let totalBlended = 0;

    // Process operators in batches of 30 (keeps bind params under 100)
    const OP_BATCH = 30;
    for (let i = 0; i < allOperators.length; i += OP_BATCH) {
      const opBatch = allOperators.slice(i, i + OP_BATCH);
      const placeholders = opBatch.map(() => '?').join(',');

      try {
        const result = await db.prepare(`
          SELECT ol.operator_number, oc.company_name, ol.county,
            COUNT(DISTINCT ol.base_pun) as well_count,
            COUNT(DISTINCT opf.year_month) as month_count,
            SUM(opf.gross_value) as total_gross,
            SUM(opf.net_value) as total_net,
            SUM(opf.gp_tax) as total_gp_tax,
            SUM(opf.pe_tax) as total_pe_tax,
            SUM(CASE WHEN opf.product_code = '1' THEN opf.gross_value ELSE 0 END) as oil_gross,
            SUM(CASE WHEN opf.product_code = '1' THEN opf.net_value ELSE 0 END) as oil_net,
            SUM(CASE WHEN opf.product_code = '3' THEN opf.gross_value ELSE 0 END) as ngl_gross,
            SUM(CASE WHEN opf.product_code = '3' THEN opf.net_value ELSE 0 END) as ngl_net,
            SUM(CASE WHEN opf.product_code IN ('5','6') THEN opf.gross_value ELSE 0 END) as gas_gross,
            SUM(CASE WHEN opf.product_code IN ('5','6') THEN opf.net_value ELSE 0 END) as gas_net
          FROM otc_production_financial opf
          JOIN otc_leases ol ON SUBSTR(opf.pun, 1, 10) = ol.base_pun
          LEFT JOIN otc_companies oc ON ol.operator_number = oc.company_id
          WHERE opf.gross_value > 0 AND opf.year_month >= ?
            AND ol.operator_number IN (${placeholders})
          GROUP BY ol.operator_number, ol.county
          HAVING well_count >= 3 AND SUM(opf.gross_value) > 5000
        `).bind(cutoff, ...opBatch).all();

        if (result.results.length === 0) continue;

        // Prepare UPSERT statements
        const stmts: D1PreparedStatement[] = [];
        for (const r of result.results as Array<{
          operator_number: string; company_name: string | null; county: string;
          well_count: number; month_count: number;
          total_gross: number; total_net: number;
          total_gp_tax: number; total_pe_tax: number;
          oil_gross: number; oil_net: number;
          ngl_gross: number; ngl_net: number;
          gas_gross: number; gas_net: number;
        }>) {
          // Blended rate (fallback)
          const ownerNet = r.total_net - r.total_gp_tax - r.total_pe_tax;
          const rawBlended = r.total_gross > 0 ? 1 - (ownerNet / r.total_gross) : 0;
          const blended = Math.max(0.25, Math.min(rawBlended, 1));

          // Tax rate
          const taxPct = r.total_gross > 0 ? (r.total_gp_tax + r.total_pe_tax) / r.total_gross : 0;

          // Product-level deduction rates (NULL if no production for that product)
          // Oil: apply 0.25 floor (OTC blind to oil marketing deductions)
          const oilMarketingPct = r.oil_gross > 0
            ? Math.max(0.25, Math.min(1 - (r.oil_net / r.oil_gross), 1))
            : null;

          // Gas (codes 5+6): no floor — OTC captures gas deductions accurately
          const gasGatheringPct = r.gas_gross > 0
            ? Math.max(0, Math.min(1 - (r.gas_net / r.gas_gross), 1))
            : null;

          // NGL: no floor
          const nglDeductionPct = r.ngl_gross > 0
            ? Math.max(0, Math.min(1 - (r.ngl_net / r.ngl_gross), 1))
            : null;

          const confidence = r.well_count >= 10 ? 'high' : r.well_count >= 3 ? 'medium' : 'low';

          stmts.push(db.prepare(`
            INSERT INTO operator_deduction_profiles
              (operator_number, operator_name, county, formation_group,
               oil_marketing_pct, gas_gathering_pct, ngl_deduction_pct, tax_pct, blended_all_in_pct,
               observation_count, well_count, confidence, source, period_start, period_end, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'otc', ?, ?, datetime('now'))
            ON CONFLICT(operator_number, county, formation_group) DO UPDATE SET
              operator_name = excluded.operator_name,
              oil_marketing_pct = excluded.oil_marketing_pct,
              gas_gathering_pct = excluded.gas_gathering_pct,
              ngl_deduction_pct = excluded.ngl_deduction_pct,
              tax_pct = excluded.tax_pct,
              blended_all_in_pct = excluded.blended_all_in_pct,
              observation_count = excluded.observation_count,
              well_count = excluded.well_count,
              confidence = excluded.confidence,
              source = excluded.source,
              period_start = excluded.period_start,
              period_end = excluded.period_end,
              updated_at = datetime('now')
          `).bind(
            r.operator_number,
            r.company_name || r.operator_number,
            r.county,
            oilMarketingPct,
            gasGatheringPct,
            nglDeductionPct,
            taxPct,
            blended,
            r.month_count,
            r.well_count,
            confidence,
            periodStart,
            periodEnd
          ));

          profilesCreated++;
          totalBlended += blended;
        }

        // Execute batch (max 500 per batch)
        for (let j = 0; j < stmts.length; j += 400) {
          await db.batch(stmts.slice(j, j + 400));
        }

        operatorsCovered += new Set((result.results as Array<{ operator_number: string }>).map(r => r.operator_number)).size;

      } catch (e) {
        console.error(`[Seed Profiles] Batch error at offset ${i}:`, e);
      }
    }

    // Also create operator-wide defaults (county IS NULL) for operators with data in multiple counties
    try {
      const multiCountyResult = await db.prepare(`
        SELECT operator_number, operator_name,
          SUM(well_count) as total_wells,
          SUM(observation_count) as total_obs,
          AVG(blended_all_in_pct) as avg_blended,
          AVG(oil_marketing_pct) as avg_oil_mkt,
          AVG(gas_gathering_pct) as avg_gas_gath,
          AVG(tax_pct) as avg_tax,
          MIN(period_start) as ps,
          MAX(period_end) as pe
        FROM operator_deduction_profiles
        WHERE county IS NOT NULL
        GROUP BY operator_number
        HAVING COUNT(DISTINCT county) >= 2
      `).all();

      const defaultStmts: D1PreparedStatement[] = [];
      for (const r of multiCountyResult.results as Array<{
        operator_number: string; operator_name: string;
        total_wells: number; total_obs: number;
        avg_blended: number; avg_oil_mkt: number; avg_gas_gath: number; avg_tax: number;
        ps: string; pe: string;
      }>) {
        const confidence = r.total_wells >= 10 ? 'high' : r.total_wells >= 3 ? 'medium' : 'low';
        defaultStmts.push(db.prepare(`
          INSERT INTO operator_deduction_profiles
            (operator_number, operator_name, county, formation_group,
             oil_marketing_pct, gas_gathering_pct, tax_pct, blended_all_in_pct,
             observation_count, well_count, confidence, source, period_start, period_end, updated_at)
          VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'otc', ?, ?, datetime('now'))
          ON CONFLICT(operator_number, county, formation_group) DO UPDATE SET
            operator_name = excluded.operator_name,
            oil_marketing_pct = excluded.oil_marketing_pct,
            gas_gathering_pct = excluded.gas_gathering_pct,
            tax_pct = excluded.tax_pct,
            blended_all_in_pct = excluded.blended_all_in_pct,
            observation_count = excluded.observation_count,
            well_count = excluded.well_count,
            confidence = excluded.confidence,
            updated_at = datetime('now')
        `).bind(
          r.operator_number, r.operator_name,
          r.avg_oil_mkt, r.avg_gas_gath, r.avg_tax, r.avg_blended,
          r.total_obs, r.total_wells, confidence,
          r.ps, r.pe
        ));
        profilesCreated++;
      }

      for (let j = 0; j < defaultStmts.length; j += 400) {
        await db.batch(defaultStmts.slice(j, j + 400));
      }
    } catch (e) {
      console.error('[Seed Profiles] Operator-wide defaults error:', e);
    }

    const avgBlended = profilesCreated > 0 ? Math.round(totalBlended / profilesCreated * 1000) / 10 : 0;
    console.log(`[Seed Profiles] Created ${profilesCreated} profiles for ${operatorsCovered} operators, avg ${avgBlended}%`);

    return jsonResponse({
      success: true,
      profiles_created: profilesCreated,
      operators_covered: operatorsCovered,
      avg_blended_pct: avgBlended
    });

  } catch (error) {
    console.error('[Seed Profiles] Error:', error);
    return jsonResponse({
      error: 'Failed to seed operator profiles',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// ============================================================
// Endpoint C: POST /api/admin/ingest-check-stub-deductions
// ============================================================
export async function handleIngestCheckStubDeductions(request: Request, env: Env): Promise<Response> {
  const db = env.WELLS_DB;
  if (!db) return jsonResponse({ error: 'Database not available' }, 503);

  try {
    // Find all check stub documents with extracted data
    const docsResult = await db.prepare(`
      SELECT id, well_id, extracted_data
      FROM documents
      WHERE doc_type = 'check_stub'
        AND extracted_data IS NOT NULL
        AND extracted_data != ''
    `).all();

    const docs = docsResult.results as Array<{
      id: string; well_id: string | null;
      extracted_data: string;
    }>;

    console.log(`[Ingest Stubs] Found ${docs.length} check stub documents`);

    let observationsCreated = 0;
    let documentsProcessed = 0;
    const wellsCovered = new Set<string>();

    for (const doc of docs) {
      try {
        const data = JSON.parse(doc.extracted_data);
        if (!data.wells || !Array.isArray(data.wells)) continue;

        const stmts: D1PreparedStatement[] = [];

        for (const well of data.wells) {
          const apiNumber = well.api_number || data.api_number;
          if (!apiNumber) continue;

          const operatorName = well.operator || data.operator || '';
          const county = well.county || data.county || '';

          // Resolve operator_number via aliases
          let operatorNumber: string | null = null;
          if (operatorName) {
            const aliasResult = await db.prepare(`
              SELECT canonical_operator_number FROM operator_aliases
              WHERE alias_name = ?
              LIMIT 1
            `).bind(operatorName.toUpperCase().trim()).first<{ canonical_operator_number: string }>();
            operatorNumber = aliasResult?.canonical_operator_number || null;
          }

          const months = well.production_months || [];
          if (months.length === 0 && well.production_month) {
            months.push(well);
          }

          for (const month of months) {
            const prodMonth = month.production_month || month.period;
            if (!prodMonth) continue;

            // Sum product-level data
            let oilGross = 0, gasGross = 0, nglGross = 0;
            let oilDeductions = 0, gasDeductions = 0, nglDeductions = 0;
            let taxes = 0;
            let oilPurchaser: string | null = null;
            let oilPrice: number | null = null;
            let gasPurchaser: string | null = null;
            let gasPrice: number | null = null;

            const products = month.products || [];
            for (const p of products) {
              const type = (p.type || p.product || '').toLowerCase();
              const gross = parseFloat(p.gross_value || p.gross || 0) || 0;
              const deductions = parseFloat(p.deductions || p.marketing || 0) || 0;
              const tax = parseFloat(p.taxes || p.tax || 0) || 0;

              if (type.includes('oil') || type.includes('crude')) {
                oilGross += gross;
                oilDeductions += deductions;
                oilPurchaser = p.purchaser || oilPurchaser;
                oilPrice = p.price_per_unit || p.price || oilPrice;
              } else if (type.includes('ngl') || type.includes('liquids')) {
                nglGross += gross;
                nglDeductions += deductions;
              } else {
                // gas or residue
                gasGross += gross;
                gasDeductions += deductions;
                gasPurchaser = p.purchaser || gasPurchaser;
                gasPrice = p.price_per_unit || p.price || gasPrice;
              }
              taxes += tax;
            }

            // Also support flat format (not nested products)
            if (products.length === 0) {
              oilGross = parseFloat(month.oil_gross || 0) || 0;
              gasGross = parseFloat(month.gas_gross || 0) || 0;
              nglGross = parseFloat(month.ngl_gross || 0) || 0;
              oilDeductions = parseFloat(month.oil_deductions || 0) || 0;
              gasDeductions = parseFloat(month.gas_deductions || 0) || 0;
              nglDeductions = parseFloat(month.ngl_deductions || 0) || 0;
              taxes = parseFloat(month.taxes || month.tax || 0) || 0;
            }

            const totalGross = oilGross + gasGross + nglGross;
            if (totalGross <= 0) continue;

            const totalDeductions = oilDeductions + gasDeductions + nglDeductions + taxes;
            const totalNet = totalGross - totalDeductions;
            const effectivePct = totalDeductions / totalGross;

            stmts.push(db.prepare(`
              INSERT INTO deduction_observations
                (api_number, well_name, operator_name, operator_number, county,
                 production_month, oil_gross, gas_gross, ngl_gross, total_gross,
                 oil_deductions, gas_deductions, ngl_deductions, taxes,
                 total_deductions, total_net, effective_deduction_pct,
                 oil_purchaser, oil_price_per_bbl, gas_purchaser, gas_price_per_mcf,
                 source, source_document_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'check_stub', ?)
              ON CONFLICT(api_number, production_month, source) DO UPDATE SET
                well_name = excluded.well_name,
                operator_name = excluded.operator_name,
                operator_number = excluded.operator_number,
                county = excluded.county,
                oil_gross = excluded.oil_gross,
                gas_gross = excluded.gas_gross,
                ngl_gross = excluded.ngl_gross,
                total_gross = excluded.total_gross,
                oil_deductions = excluded.oil_deductions,
                gas_deductions = excluded.gas_deductions,
                ngl_deductions = excluded.ngl_deductions,
                taxes = excluded.taxes,
                total_deductions = excluded.total_deductions,
                total_net = excluded.total_net,
                effective_deduction_pct = excluded.effective_deduction_pct,
                oil_purchaser = excluded.oil_purchaser,
                oil_price_per_bbl = excluded.oil_price_per_bbl,
                gas_purchaser = excluded.gas_purchaser,
                gas_price_per_mcf = excluded.gas_price_per_mcf,
                source_document_id = excluded.source_document_id
            `).bind(
              apiNumber,
              well.well_name || data.well_name || null,
              operatorName,
              operatorNumber,
              county,
              prodMonth,
              oilGross, gasGross, nglGross, totalGross,
              oilDeductions, gasDeductions, nglDeductions, taxes,
              totalDeductions, totalNet, effectivePct,
              oilPurchaser, oilPrice, gasPurchaser, gasPrice,
              doc.id
            ));

            observationsCreated++;
            wellsCovered.add(apiNumber);
          }
        }

        // Execute batch
        for (let j = 0; j < stmts.length; j += 400) {
          await db.batch(stmts.slice(j, j + 400));
        }
        documentsProcessed++;

      } catch (e) {
        console.error(`[Ingest Stubs] Error processing document ${doc.id}:`, e);
      }
    }

    console.log(`[Ingest Stubs] Processed ${documentsProcessed} docs, ${observationsCreated} observations, ${wellsCovered.size} wells`);

    return jsonResponse({
      success: true,
      documents_processed: documentsProcessed,
      observations_created: observationsCreated,
      wells_covered: wellsCovered.size
    });

  } catch (error) {
    console.error('[Ingest Stubs] Error:', error);
    return jsonResponse({
      error: 'Failed to ingest check stub deductions',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}
