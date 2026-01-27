/**
 * Backfill Section Centers
 *
 * Computes centroid lat/lng for each PLSS section from its GeoJSON geometry.
 * Supports ?limit=N parameter to process in batches (default 5000).
 *
 * POST /api/admin/backfill-section-centers
 * POST /api/admin/backfill-section-centers?limit=5000
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

/**
 * Calculate centroid from GeoJSON polygon coordinates
 * Uses simple average of exterior ring vertices
 */
function calculateCentroid(geometry: any): { lat: number; lng: number } | null {
  try {
    const coords = geometry?.coordinates?.[0]; // Exterior ring
    if (!coords || coords.length === 0) return null;

    let sumLng = 0;
    let sumLat = 0;
    // Exclude last point (duplicate of first in closed polygon)
    const count = coords[coords.length - 1][0] === coords[0][0] &&
                  coords[coords.length - 1][1] === coords[0][1]
      ? coords.length - 1
      : coords.length;

    for (let i = 0; i < count; i++) {
      sumLng += coords[i][0];
      sumLat += coords[i][1];
    }

    return {
      lng: sumLng / count,
      lat: sumLat / count
    };
  } catch {
    return null;
  }
}

export async function handleBackfillSectionCenters(request: Request, env: Env): Promise<Response> {
  // Verify admin key
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${env.PROCESSING_API_KEY}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const maxToProcess = parseInt(url.searchParams.get('limit') || '5000', 10);

  // Check how many need processing
  const remaining = await env.WELLS_DB.prepare(`
    SELECT COUNT(*) as count FROM plss_sections WHERE center_lat IS NULL
  `).first();

  console.log(`[BackfillSectionCenters] ${remaining?.count} sections need centers. Processing up to ${maxToProcess}.`);

  const DB_BATCH = 100; // D1 batch limit
  const FETCH_BATCH = 500; // Rows to fetch per query
  let processed = 0;
  let updated = 0;
  let errors = 0;

  while (processed < maxToProcess) {
    const sections = await env.WELLS_DB.prepare(`
      SELECT id, geometry FROM plss_sections
      WHERE center_lat IS NULL
      LIMIT ?
    `).bind(Math.min(FETCH_BATCH, maxToProcess - processed)).all();

    if (sections.results.length === 0) break;

    const statements = [];

    for (const section of sections.results) {
      processed++;
      try {
        const geometry = JSON.parse(section.geometry as string);
        const center = calculateCentroid(geometry);

        if (center) {
          statements.push(
            env.WELLS_DB.prepare(`
              UPDATE plss_sections SET center_lat = ?, center_lng = ? WHERE id = ?
            `).bind(center.lat, center.lng, section.id)
          );
          updated++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }

    // Execute in D1 batch chunks of 100
    for (let i = 0; i < statements.length; i += DB_BATCH) {
      const chunk = statements.slice(i, i + DB_BATCH);
      await env.WELLS_DB.batch(chunk);
    }

    console.log(`[BackfillSectionCenters] Progress: ${processed} processed, ${updated} updated`);

    if (sections.results.length < FETCH_BATCH) break;
  }

  const remainingAfter = (remaining?.count as number || 0) - updated;

  return jsonResponse({
    success: true,
    processed,
    updated,
    errors,
    remaining: Math.max(0, remainingAfter),
    message: remainingAfter > 0
      ? `Call again to process remaining ${remainingAfter} sections`
      : 'All sections have centers computed'
  });
}
