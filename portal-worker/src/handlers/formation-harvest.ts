/**
 * Formation Harvest Admin Endpoints
 *
 * GET  /api/admin/wells-missing-formation — paginated API numbers where formation_name IS NULL
 * POST /api/admin/formation-harvest-results — batch write-back of formation + IP data
 *
 * Auth: PROCESSING_API_KEY bearer token (service-to-service)
 */

import { jsonResponse } from '../utils/responses.js';

interface Env {
  WELLS_DB: D1Database;
  PROCESSING_API_KEY: string;
}

/**
 * Returns paginated list of active wells missing formation_name.
 */
export async function handleGetWellsMissingFormation(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000'), 10000);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  try {
    const result = await env.WELLS_DB!.prepare(`
      SELECT api_number, well_name, county, well_status
      FROM wells
      WHERE formation_name IS NULL
        AND well_status IN ('AC', 'NEW')
      ORDER BY api_number
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    return jsonResponse({
      wells: result.results,
      count: result.results.length,
      offset
    });
  } catch (error) {
    console.error('[formation-harvest] Error fetching wells:', error);
    return jsonResponse({
      error: 'Failed to fetch wells',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

interface HarvestResult {
  api_number: string;
  formation_name?: string | null;
  ip_oil_bbl?: number | null;
  ip_gas_mcf?: number | null;
  ip_water_bbl?: number | null;
  source?: string;
}

/**
 * Batch write-back of formation extraction results.
 * Uses COALESCE to only fill NULL values (never overwrites existing data).
 * Formation name is UPPER'd for normalization table lookup.
 * Max 250 results per request (500 D1 statements = 250 × 2).
 */
export async function handleFormationHarvestResults(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { results: HarvestResult[] };
  try {
    body = await request.json() as { results: HarvestResult[] };
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.results || !Array.isArray(body.results)) {
    return jsonResponse({ error: 'results array required' }, 400);
  }

  if (body.results.length > 250) {
    return jsonResponse({ error: 'Max 250 results per batch (D1 statement limit)' }, 400);
  }

  const statements: D1PreparedStatement[] = [];
  let formationCount = 0;
  let ipCount = 0;
  let skipped = 0;

  for (const r of body.results) {
    if (!r.api_number) {
      skipped++;
      continue;
    }

    // Statement 1: Formation update (only if formation_name provided)
    if (r.formation_name) {
      const upperFormation = r.formation_name.trim().toUpperCase();
      statements.push(
        env.WELLS_DB!.prepare(`
          UPDATE wells SET
            formation_name = COALESCE(formation_name, ?),
            formation_canonical = COALESCE(formation_canonical,
              (SELECT canonical_name FROM formation_normalization WHERE raw_name = ?)),
            formation_group = COALESCE(formation_group,
              (SELECT formation_group FROM formation_normalization WHERE raw_name = ?))
          WHERE api_number = ?
        `).bind(upperFormation, upperFormation, upperFormation, r.api_number)
      );
      formationCount++;
    }

    // Statement 2: IP rates update (only if any IP value provided)
    const hasIp = r.ip_oil_bbl != null || r.ip_gas_mcf != null || r.ip_water_bbl != null;
    if (hasIp) {
      statements.push(
        env.WELLS_DB!.prepare(`
          UPDATE wells SET
            ip_oil_bbl = COALESCE(ip_oil_bbl, ?),
            ip_gas_mcf = COALESCE(ip_gas_mcf, ?),
            ip_water_bbl = COALESCE(ip_water_bbl, ?)
          WHERE api_number = ?
        `).bind(
          r.ip_oil_bbl ?? null,
          r.ip_gas_mcf ?? null,
          r.ip_water_bbl ?? null,
          r.api_number
        )
      );
      ipCount++;
    }
  }

  if (statements.length === 0) {
    return jsonResponse({ success: true, updated: 0, skipped: body.results.length });
  }

  try {
    // D1 batch limit is 500 statements
    const BATCH_SIZE = 500;
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const batch = statements.slice(i, i + BATCH_SIZE);
      await env.WELLS_DB!.batch(batch);
    }

    return jsonResponse({
      success: true,
      formations_updated: formationCount,
      ip_updated: ipCount,
      skipped,
      total_statements: statements.length
    });
  } catch (error) {
    console.error('[formation-harvest] Batch write error:', error);
    return jsonResponse({
      error: 'Batch write failed',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}
