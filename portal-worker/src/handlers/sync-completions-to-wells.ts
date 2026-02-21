/**
 * Sync Completions to Wells Handler
 *
 * Syncs completion data from COMPLETIONS_CACHE KV to D1 wells table.
 * This enriches the wells table with formation, bottom hole location,
 * IP data, depths, and dates extracted from 1002A completion reports.
 *
 * POST /api/admin/sync-completions-to-wells
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env, CompletionData } from '../types/env.js';

interface SyncResult {
  apiNumber: string;
  updated: boolean;
  fields?: string[];
  error?: string;
}

interface SyncStats {
  total: number;
  updated: number;
  skipped: number;
  errors: number;
  fieldsUpdated: { [key: string]: number };
}

/**
 * Sync a single well's completion data from KV to D1
 */
async function syncWellCompletion(
  apiNumber: string,
  completionData: CompletionData,
  env: Env
): Promise<SyncResult> {
  if (!env.WELLS_DB) {
    return { apiNumber, updated: false, error: 'Database not available' };
  }

  try {
    // Build SET clauses for non-null fields only (additive update)
    const updates: string[] = [];
    const values: any[] = [];
    const fieldsUpdated: string[] = [];

    // Formation data
    if (completionData.formationName) {
      updates.push('formation_name = COALESCE(formation_name, ?)');
      values.push(completionData.formationName);
      fieldsUpdated.push('formation_name');

      // Also set formation_canonical and formation_group from normalization table
      updates.push('formation_canonical = COALESCE(formation_canonical, (SELECT canonical_name FROM formation_normalization WHERE raw_name = ?))');
      values.push(completionData.formationName);
      updates.push('formation_group = COALESCE(formation_group, (SELECT formation_group FROM formation_normalization WHERE raw_name = ?))');
      values.push(completionData.formationName);
    }

    if (completionData.formationDepth) {
      updates.push('formation_depth = COALESCE(formation_depth, ?)');
      values.push(completionData.formationDepth);
      fieldsUpdated.push('formation_depth');
    }

    // Bottom hole location
    if (completionData.bhSection && completionData.bhTownship && completionData.bhRange) {
      updates.push('bh_section = COALESCE(bh_section, ?)');
      updates.push('bh_township = COALESCE(bh_township, ?)');
      updates.push('bh_range = COALESCE(bh_range, ?)');
      values.push(completionData.bhSection, completionData.bhTownship, completionData.bhRange);
      fieldsUpdated.push('bh_section', 'bh_township', 'bh_range');
    }

    // Depth measurements
    if (completionData.totalDepth) {
      updates.push('measured_total_depth = COALESCE(measured_total_depth, ?)');
      values.push(completionData.totalDepth);
      fieldsUpdated.push('measured_total_depth');
    }

    if (completionData.lateralLength) {
      updates.push('lateral_length = COALESCE(lateral_length, ?)');
      values.push(completionData.lateralLength);
      fieldsUpdated.push('lateral_length');
    }

    // Initial production data
    if (completionData.ipOil !== undefined && completionData.ipOil !== null) {
      updates.push('ip_oil_bbl = COALESCE(ip_oil_bbl, ?)');
      values.push(completionData.ipOil);
      fieldsUpdated.push('ip_oil_bbl');
    }

    if (completionData.ipGas !== undefined && completionData.ipGas !== null) {
      updates.push('ip_gas_mcf = COALESCE(ip_gas_mcf, ?)');
      values.push(completionData.ipGas);
      fieldsUpdated.push('ip_gas_mcf');
    }

    if (completionData.ipWater !== undefined && completionData.ipWater !== null) {
      updates.push('ip_water_bbl = COALESCE(ip_water_bbl, ?)');
      values.push(completionData.ipWater);
      fieldsUpdated.push('ip_water_bbl');
    }

    // Dates
    if (completionData.completionDate) {
      updates.push('completion_date = COALESCE(completion_date, ?)');
      values.push(completionData.completionDate);
      fieldsUpdated.push('completion_date');
    }

    if (completionData.spudDate) {
      updates.push('spud_date = COALESCE(spud_date, ?)');
      values.push(completionData.spudDate);
      fieldsUpdated.push('spud_date');
    }

    if (completionData.firstProdDate) {
      updates.push('first_production_date = COALESCE(first_production_date, ?)');
      values.push(completionData.firstProdDate);
      fieldsUpdated.push('first_production_date');
    }

    // Skip if nothing to update
    if (updates.length === 0) {
      return { apiNumber, updated: false };
    }

    // Add API number for WHERE clause
    values.push(apiNumber);

    const query = `
      UPDATE wells
      SET ${updates.join(', ')}
      WHERE api_number = ? OR api_number LIKE ?
    `;
    values.push(`${apiNumber}%`);

    const result = await env.WELLS_DB.prepare(query).bind(...values).run();

    return {
      apiNumber,
      updated: (result.meta?.changes || 0) > 0,
      fields: fieldsUpdated
    };

  } catch (error) {
    console.error(`Error syncing completion for ${apiNumber}:`, error);
    return {
      apiNumber,
      updated: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * POST /api/admin/sync-completions-to-wells
 *
 * Syncs all completion data from COMPLETIONS_CACHE to D1 wells table.
 * Requires admin authentication (SYNC_API_KEY).
 *
 * Query params:
 * - limit: Max number of completions to process (default: 100)
 * - dryRun: If "true", show what would be updated without making changes
 */
export async function handleSyncCompletionsToWells(
  request: Request,
  env: Env
): Promise<Response> {
  // Validate admin key
  const authHeader = request.headers.get('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '');

  if (!apiKey || apiKey !== env.SYNC_API_KEY) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (!env.WELLS_DB || !env.COMPLETIONS_CACHE) {
    return jsonResponse({ error: 'Required services not configured' }, 503);
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const dryRun = url.searchParams.get('dryRun') === 'true';

  try {
    // List all keys in COMPLETIONS_CACHE
    const listResult = await env.COMPLETIONS_CACHE.list({ prefix: 'well:', limit });

    const stats: SyncStats = {
      total: listResult.keys.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      fieldsUpdated: {}
    };

    const results: SyncResult[] = [];

    for (const key of listResult.keys) {
      // Extract API number from key (format: "well:XXXXXXXXXX")
      const apiNumber = key.name.replace('well:', '');

      // Get completion data from KV
      const completionData = await env.COMPLETIONS_CACHE.get(key.name, 'json') as CompletionData | null;

      if (!completionData) {
        stats.skipped++;
        continue;
      }

      if (dryRun) {
        // In dry run, just report what would be updated
        const result: SyncResult = {
          apiNumber,
          updated: true,
          fields: []
        };

        if (completionData.formationName) result.fields!.push('formation_name');
        if (completionData.bhSection) result.fields!.push('bh_location');
        if (completionData.totalDepth) result.fields!.push('measured_total_depth');
        if (completionData.lateralLength) result.fields!.push('lateral_length');
        if (completionData.ipOil !== undefined) result.fields!.push('ip_oil_bbl');
        if (completionData.ipGas !== undefined) result.fields!.push('ip_gas_mcf');
        if (completionData.completionDate) result.fields!.push('completion_date');
        if (completionData.firstProdDate) result.fields!.push('first_production_date');

        if (result.fields!.length > 0) {
          results.push(result);
          stats.updated++;
          for (const field of result.fields!) {
            stats.fieldsUpdated[field] = (stats.fieldsUpdated[field] || 0) + 1;
          }
        } else {
          stats.skipped++;
        }
      } else {
        // Actually perform the sync
        const result = await syncWellCompletion(apiNumber, completionData, env);
        results.push(result);

        if (result.updated) {
          stats.updated++;
          for (const field of result.fields || []) {
            stats.fieldsUpdated[field] = (stats.fieldsUpdated[field] || 0) + 1;
          }
        } else if (result.error) {
          stats.errors++;
        } else {
          stats.skipped++;
        }
      }
    }

    return jsonResponse({
      success: true,
      dryRun,
      stats,
      results: results.slice(0, 50), // Limit detailed results in response
      hasMore: listResult.list_complete === false
    });

  } catch (error) {
    console.error('Error in handleSyncCompletionsToWells:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * POST /api/admin/sync-single-completion
 *
 * Syncs completion data for a single well by API number.
 * Useful for testing or triggering sync after document processing.
 */
export async function handleSyncSingleCompletion(
  request: Request,
  env: Env,
  apiNumber: string
): Promise<Response> {
  // Validate admin key or processing key (for automated triggers)
  const authHeader = request.headers.get('Authorization');
  const apiKey = authHeader?.replace('Bearer ', '');

  if (!apiKey || (apiKey !== env.SYNC_API_KEY && apiKey !== env.PROCESSING_API_KEY)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (!env.WELLS_DB || !env.COMPLETIONS_CACHE) {
    return jsonResponse({ error: 'Required services not configured' }, 503);
  }

  try {
    // Get completion data from KV
    const cacheKey = `well:${apiNumber}`;
    const completionData = await env.COMPLETIONS_CACHE.get(cacheKey, 'json') as CompletionData | null;

    if (!completionData) {
      return jsonResponse({
        success: false,
        apiNumber,
        error: 'No completion data found in cache'
      }, 404);
    }

    const result = await syncWellCompletion(apiNumber, completionData, env);

    return jsonResponse({
      success: result.updated,
      ...result
    });

  } catch (error) {
    console.error(`Error in handleSyncSingleCompletion for ${apiNumber}:`, error);
    return jsonResponse({
      success: false,
      apiNumber,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
