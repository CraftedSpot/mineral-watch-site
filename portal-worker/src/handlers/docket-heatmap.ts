/**
 * Docket Heatmap Handler
 *
 * Returns OCC docket entries for heatmap visualization (pooling, increased density, spacing, horizontal well)
 * Enriches entries with lat/lng centroids from plss_sections to eliminate per-entry frontend geometry fetches.
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

/**
 * Compute centroid of a GeoJSON Polygon or MultiPolygon.
 * Simple average of outer ring coordinates.
 */
function computeCentroid(geometry: any): { lat: number; lng: number } | null {
  if (!geometry || !geometry.coordinates) return null;

  let ring: number[][];
  if (geometry.type === 'Polygon') {
    ring = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    ring = geometry.coordinates[0][0];
  } else {
    return null;
  }

  if (!ring || ring.length === 0) return null;

  let sumLat = 0, sumLng = 0;
  for (const [lng, lat] of ring) {
    sumLat += lat;
    sumLng += lng;
  }

  return {
    lat: Math.round((sumLat / ring.length) * 1e6) / 1e6,
    lng: Math.round((sumLng / ring.length) * 1e6) / 1e6,
  };
}

/**
 * Get OCC docket entries for heatmap display
 * GET /api/docket-heatmap?days=90
 *
 * Returns entries with latitude/longitude for direct map plotting (no frontend geometry lookups needed).
 */
export async function handleGetDocketHeatmap(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      console.error('[DocketHeatmap] WELLS_DB not configured');
      return jsonResponse({
        error: 'Database not configured',
        message: 'The docket heatmap feature is not available at this time'
      }, 503);
    }

    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '90');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const minDate = startDate.toISOString().split('T')[0];

    console.log(`[DocketHeatmap] Fetching entries from last ${days} days (since ${minDate})`);

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
      LIMIT 5000
    `;

    const result = await env.WELLS_DB.prepare(query).bind(minDate).all();
    const entries = (result.results || []) as any[];
    console.log(`[DocketHeatmap] Found ${entries.length} entries`);

    // --- Enrich with centroids from plss_sections ---
    // 1. Collect unique TRS combos
    const uniqueTRS = new Map<string, { section: string; township: string; range: string }>();
    for (const entry of entries) {
      if (!entry.section || !entry.township || !entry.range) continue;
      const key = `${entry.section}-${entry.township}-${entry.range}`;
      if (!uniqueTRS.has(key)) {
        uniqueTRS.set(key, { section: entry.section, township: entry.township, range: entry.range });
      }
    }

    console.log(`[DocketHeatmap] ${uniqueTRS.size} unique TRS combos to resolve`);

    // 2. Batch-query plss_sections (D1 batch limit = 500)
    const coords = new Map<string, { lat: number; lng: number }>();
    const trsArray = Array.from(uniqueTRS.entries());

    for (let i = 0; i < trsArray.length; i += 450) {
      const batch = trsArray.slice(i, i + 450);
      const stmts = batch.map(([, trs]) => {
        const paddedSection = trs.section.toString().padStart(2, '0');
        // PLSS table stores townships in fractional format (e.g., "15N" → "150N")
        const twnMatch = trs.township.match(/^(\d+)([NS])$/i);
        const plssTownship = twnMatch
          ? `${parseInt(twnMatch[1]) * 10}${twnMatch[2].toUpperCase()}`
          : trs.township;
        return env.WELLS_DB.prepare(
          'SELECT geometry FROM plss_sections WHERE section = ? AND township = ? AND range = ? LIMIT 1'
        ).bind(paddedSection, plssTownship, trs.range);
      });

      const batchResults = await env.WELLS_DB.batch(stmts);

      for (let j = 0; j < batchResults.length; j++) {
        const rows = batchResults[j].results as any[];
        if (rows && rows.length > 0 && rows[0].geometry) {
          try {
            const geom = JSON.parse(rows[0].geometry as string);
            const centroid = computeCentroid(geom);
            if (centroid) {
              coords.set(batch[j][0], centroid);
            }
          } catch (e) {
            // Skip unparseable geometry
          }
        }
      }
    }

    console.log(`[DocketHeatmap] Resolved ${coords.size}/${uniqueTRS.size} TRS coords`);

    // 3. Attach coordinates to entries
    const enrichedEntries = entries.map(entry => {
      const key = `${entry.section}-${entry.township}-${entry.range}`;
      const coord = coords.get(key);
      return {
        ...entry,
        latitude: coord?.lat ?? null,
        longitude: coord?.lng ?? null,
      };
    });

    // Count by relief type
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      const type = entry.relief_type;
      counts[type] = (counts[type] || 0) + 1;
    }
    console.log('[DocketHeatmap] Counts by type:', counts);

    return jsonResponse({
      success: true,
      entries: enrichedEntries,
      count: enrichedEntries.length,
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
