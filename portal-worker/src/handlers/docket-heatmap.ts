/**
 * Docket Heatmap Handler
 *
 * Returns OCC docket entries for heatmap visualization (pooling, increased density, spacing, horizontal well)
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

/**
 * Get OCC docket entries for heatmap display
 * GET /api/docket-heatmap?days=90
 *
 * Returns entries with location data (section, township, range) for map visualization
 */
export async function handleGetDocketHeatmap(request: Request, env: Env): Promise<Response> {
  try {
    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[DocketHeatmap] WELLS_DB not configured');
      return jsonResponse({
        error: 'Database not configured',
        message: 'The docket heatmap feature is not available at this time'
      }, 503);
    }

    // Parse query parameters
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '90');

    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const minDate = startDate.toISOString().split('T')[0];

    console.log(`[DocketHeatmap] Fetching entries from last ${days} days (since ${minDate})`);

    // Query docket entries for heatmap-relevant relief types
    const query = `
      SELECT
        section,
        township,
        range,
        meridian,
        county,
        relief_type,
        case_number,
        applicant,
        docket_date,
        hearing_date
      FROM occ_docket_entries
      WHERE relief_type IN ('POOLING', 'INCREASED_DENSITY', 'SPACING', 'HORIZONTAL_WELL')
        AND docket_date >= ?
      ORDER BY docket_date DESC
    `;

    const result = await env.WELLS_DB.prepare(query).bind(minDate).all();

    const entries = result.results || [];
    console.log(`[DocketHeatmap] Found ${entries.length} entries`);

    // Count by relief type for logging
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      const type = (entry as any).relief_type;
      counts[type] = (counts[type] || 0) + 1;
    }
    console.log('[DocketHeatmap] Counts by type:', counts);

    return jsonResponse({
      success: true,
      entries: entries,
      count: entries.length,
      days_back: days,
      counts_by_type: counts
    });

  } catch (error) {
    console.error('[DocketHeatmap] Error:', error);
    return jsonResponse({
      error: 'Failed to fetch docket heatmap data',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
