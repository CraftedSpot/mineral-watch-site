/**
 * Backfill Completion Report Write-Back
 *
 * Processes extracted 1002A completion report data from the documents table
 * and writes it back to wells, pun_api_crosswalk, well_pun_links, and
 * well_1002a_tracking tables.
 *
 * 758 documents were extracted by Claude but only 1 had write-back applied
 * (the write-back code was added after most documents were already processed,
 * and had API format mismatches).
 *
 * Supports ?dry_run=true to preview changes without writing.
 *
 * POST /api/admin/backfill-completion-writeback
 * POST /api/admin/backfill-completion-writeback?dry_run=true
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

/** Normalize API to 10-char bare digits (tracking table format) */
function normalizeApi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length >= 10 ? digits.substring(0, 10) : digits || null;
}

/** Normalize PUN to 10-char base_pun format: XXX-XXXXXX (county-lease, lease zero-padded to 6) */
function normalizeBasePun(pun: string): string {
  const match = pun.match(/^(\d{3})-(\d+)/);
  if (match) {
    const county = match[1];
    const lease = match[2].substring(0, 6).padStart(6, '0');
    return `${county}-${lease}`;
  }
  // Fallback for dashless PUNs (e.g. from completions_daily): first 3 digits + dash + next 6
  const digits = pun.replace(/[^0-9]/g, '');
  if (digits.length >= 9) {
    return `${digits.substring(0, 3)}-${digits.substring(3, 9)}`;
  }
  return pun.length >= 10 ? pun.substring(0, 10) : pun;
}

/** Resolve API number from all possible extraction paths */
function resolveApi(data: any): string | null {
  const raw = data.api_number_normalized
    || data.api_number
    || data.well_identification?.api_number;
  return normalizeApi(raw);
}

/** Resolve PUN from all possible extraction paths */
function resolvePun(data: any): string | null {
  return data.otc_prod_unit_no
    || data.well_identification?.otc_prod_unit_no
    || null;
}

export async function handleBackfillCompletionWriteback(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${env.PROCESSING_API_KEY}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';

  // Fetch all completed completion reports
  const docs = await env.WELLS_DB.prepare(`
    SELECT id, extracted_data
    FROM documents
    WHERE doc_type = 'completion_report'
      AND status = 'complete'
      AND extracted_data IS NOT NULL
  `).all();

  const results = {
    total: docs.results.length,
    processed: 0,
    skipped: [] as { doc_id: string; reason: string }[],
    errors: [] as { doc_id: string; error: string }[],
    dry_run: dryRun,
    preview: [] as any[],
  };

  // Deduplicate by API number — multiple docs per well (e.g. multi-page extractions)
  // Keep the one with the most data (prefer one with IP rates)
  const byApi = new Map<string, { docId: string; data: any }>();

  for (const row of docs.results) {
    const doc = row as any;
    let data: any;
    try {
      data = typeof doc.extracted_data === 'string'
        ? JSON.parse(doc.extracted_data)
        : doc.extracted_data;
    } catch {
      results.skipped.push({ doc_id: doc.id, reason: 'invalid_json' });
      continue;
    }

    const api = resolveApi(data);
    if (!api) {
      results.skipped.push({ doc_id: doc.id, reason: 'no_api_number' });
      continue;
    }

    const existing = byApi.get(api);
    if (existing) {
      // Keep whichever has more data (IP rates preferred)
      const existingHasIp = existing.data.initial_production?.oil_bbl_per_day != null
        || existing.data.initial_production?.gas_mcf_per_day != null;
      const newHasIp = data.initial_production?.oil_bbl_per_day != null
        || data.initial_production?.gas_mcf_per_day != null;
      if (newHasIp && !existingHasIp) {
        byApi.set(api, { docId: doc.id, data });
      }
      // Otherwise keep existing
    } else {
      byApi.set(api, { docId: doc.id, data });
    }
  }

  // Process each unique API
  const BATCH_SIZE = 50;
  const apis = Array.from(byApi.entries());

  for (let i = 0; i < apis.length; i += BATCH_SIZE) {
    const batch = apis.slice(i, i + BATCH_SIZE);

    for (const [api10, { docId, data }] of batch) {
      try {
        // Check well match count
        const matchCount = await env.WELLS_DB.prepare(
          `SELECT COUNT(*) as cnt FROM wells WHERE api_number = ? OR api_number LIKE ? || '%'`
        ).bind(api10, api10).first<{ cnt: number }>();

        const cnt = matchCount?.cnt || 0;

        if (cnt === 0) {
          results.skipped.push({ doc_id: docId, reason: `no_well_match (api=${api10})` });
          continue;
        }
        if (cnt > 1) {
          results.skipped.push({ doc_id: docId, reason: `multiple_well_matches (api=${api10}, count=${cnt})` });
          continue;
        }

        // Extract fields
        const pun = resolvePun(data);
        const bhLat = data.bottom_hole_location?.latitude || null;
        const bhLon = data.bottom_hole_location?.longitude || null;
        const lateralLength = data.lateral_details?.lateral_length_ft || null;
        const totalDepth = data.surface_location?.total_depth_ft || null;
        const ipOil = data.initial_production?.oil_bbl_per_day || null;
        const ipGas = data.initial_production?.gas_mcf_per_day || null;
        const ipWater = data.initial_production?.water_bbl_per_day || null;
        const completionDate = data.dates?.completion_date || null;
        const wellName = data.well_name || data.well_identification?.well_name || null;
        const operator = data.operator?.name || data.well_identification?.operator || null;

        let formationName: string | null = null;
        let formationDepth: number | null = null;
        if (data.formation_zones?.length > 0) {
          formationName = data.formation_zones[0].formation_name || null;
          const perfs = data.formation_zones[0].perforated_intervals;
          if (perfs?.length > 0) {
            formationDepth = perfs[0].from_ft || null;
          }
        } else if (data.formation_tops?.length > 0) {
          formationName = data.formation_tops[0].name || null;
          formationDepth = data.formation_tops[0].depth_ft || null;
        }

        if (dryRun) {
          results.preview.push({
            doc_id: docId,
            api: api10,
            pun,
            ip_oil: ipOil,
            ip_gas: ipGas,
            formation: formationName,
            completion_date: completionDate,
            bh_lat: bhLat,
            bh_lon: bhLon,
            well_name: wellName,
          });
          results.processed++;
          continue;
        }

        // --- LIVE WRITES ---

        // 1. pun_api_crosswalk (actual columns: api_number, pun, confidence, match_source, pun_1002a)
        if (pun) {
          await env.WELLS_DB.prepare(`
            INSERT INTO pun_api_crosswalk (api_number, pun, confidence, match_source, pun_1002a)
            VALUES (?, ?, 'high', '1002a_backfill', ?)
            ON CONFLICT(api_number) DO UPDATE SET
              pun = excluded.pun,
              pun_1002a = COALESCE(excluded.pun_1002a, pun_api_crosswalk.pun_1002a),
              updated_at = CURRENT_TIMESTAMP
          `).bind(api10, pun, pun).run();

          // well_pun_links
          const basePun = normalizeBasePun(pun);
          await env.WELLS_DB.prepare(`
            INSERT INTO well_pun_links (api_number, pun, base_pun, match_method, confidence)
            VALUES (?, ?, ?, '1002a_backfill', 'high')
            ON CONFLICT(api_number, pun) DO UPDATE SET
              base_pun = COALESCE(excluded.base_pun, well_pun_links.base_pun),
              updated_at = CURRENT_TIMESTAMP
          `).bind(api10, pun, basePun).run();
        }

        // 2. Multi-section PUNs from allocation_factors
        if (data.allocation_factors?.length) {
          for (const factor of data.allocation_factors) {
            if (factor.pun && factor.pun !== pun) {
              const factorBasePun = normalizeBasePun(factor.pun);
              await env.WELLS_DB.prepare(`
                INSERT INTO well_pun_links (api_number, pun, base_pun, match_method, confidence)
                VALUES (?, ?, ?, '1002a_backfill', 'high')
                ON CONFLICT(api_number, pun) DO UPDATE SET
                  base_pun = COALESCE(excluded.base_pun, well_pun_links.base_pun),
                  updated_at = CURRENT_TIMESTAMP
              `).bind(api10, factor.pun, factorBasePun).run();
            }
          }
        }

        // 3. Update wells table — COALESCE to only fill NULLs
        const updates: string[] = [];
        const values: any[] = [];

        if (bhLat !== null) { updates.push('bh_latitude = COALESCE(bh_latitude, ?)'); values.push(bhLat); }
        if (bhLon !== null) { updates.push('bh_longitude = COALESCE(bh_longitude, ?)'); values.push(bhLon); }
        if (lateralLength !== null) { updates.push('lateral_length = COALESCE(lateral_length, ?)'); values.push(lateralLength); }
        if (totalDepth !== null) { updates.push('measured_total_depth = COALESCE(measured_total_depth, ?)'); values.push(totalDepth); }
        if (ipOil !== null) { updates.push('ip_oil_bbl = COALESCE(ip_oil_bbl, ?)'); values.push(ipOil); }
        if (ipGas !== null) { updates.push('ip_gas_mcf = COALESCE(ip_gas_mcf, ?)'); values.push(ipGas); }
        if (ipWater !== null) { updates.push('ip_water_bbl = COALESCE(ip_water_bbl, ?)'); values.push(ipWater); }
        if (formationName !== null) { updates.push('formation_name = COALESCE(formation_name, ?)'); values.push(formationName); }
        if (formationDepth !== null) { updates.push('formation_depth = COALESCE(formation_depth, ?)'); values.push(formationDepth); }
        if (completionDate !== null) { updates.push('completion_date = COALESCE(completion_date, ?)'); values.push(completionDate); }
        if (pun) { updates.push('otc_prod_unit_no = COALESCE(otc_prod_unit_no, ?)'); values.push(pun); }

        if (updates.length > 0) {
          updates.push('updated_at = CURRENT_TIMESTAMP');
          const sql = `UPDATE wells SET ${updates.join(', ')} WHERE api_number = ? OR api_number LIKE ? || '%'`;
          values.push(api10, api10);
          await env.WELLS_DB.prepare(sql).bind(...values).run();
        }

        // 4. Update well_1002a_tracking
        await env.WELLS_DB.prepare(`
          UPDATE well_1002a_tracking
          SET status = 'processed',
              extracted_pun = COALESCE(?, extracted_pun),
              extraction_method = 'backfill',
              confidence = 'high',
              processed_at = datetime('now'),
              updated_at = CURRENT_TIMESTAMP
          WHERE api_number = ? OR api_number = ?
        `).bind(pun, api10, api10).run();

        results.processed++;
      } catch (err: any) {
        results.errors.push({ doc_id: docId, error: err.message || String(err) });
      }
    }
  }

  // Trim preview in non-dry-run (it's empty anyway)
  if (!dryRun) {
    delete (results as any).preview;
  }

  return jsonResponse(results);
}
