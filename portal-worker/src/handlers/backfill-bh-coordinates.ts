/**
 * Backfill BH Coordinates from Section Centers
 *
 * For horizontal wells that have a bottom-hole section (TRS) but no lat/lng,
 * sets approximate BH coordinates from the PLSS section centroid.
 * Marks these as 'section_center' source so they can be replaced with
 * more accurate data (e.g. from OCC API) when available.
 *
 * Supports ?limit=N parameter to process in batches (default 5000).
 *
 * POST /api/admin/backfill-bh-coordinates
 * POST /api/admin/backfill-bh-coordinates?limit=5000
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

/**
 * Convert wells township format to plss_sections format
 * Wells: "27N" → PLSS: "270N" (number * 10 + direction)
 */
function convertTownship(wellsTownship: string): string | null {
  if (!wellsTownship || wellsTownship.length < 2) return null;
  const dir = wellsTownship.slice(-1); // N or S
  const num = parseInt(wellsTownship.slice(0, -1), 10);
  if (isNaN(num)) return null;
  return `${num * 10}${dir}`;
}

/**
 * Convert wells range format to plss_sections format
 * Wells: "09W" → PLSS: "9W" (strip leading zeros)
 */
function convertRange(wellsRange: string): string | null {
  if (!wellsRange || wellsRange.length < 2) return null;
  const dir = wellsRange.slice(-1); // W or E
  const num = parseInt(wellsRange.slice(0, -1), 10);
  if (isNaN(num)) return null;
  return `${num}${dir}`;
}

/**
 * Convert wells meridian to plss_sections format
 * Wells: "IM" → PLSS: "indian", "CM" → "cimarron"
 */
function convertMeridian(wellsMeridian: string): string | null {
  const upper = wellsMeridian?.toUpperCase();
  if (upper === 'IM') return 'indian';
  if (upper === 'CM') return 'cimarron';
  return null;
}

export async function handleBackfillBhCoordinates(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${env.PROCESSING_API_KEY}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const maxToProcess = parseInt(url.searchParams.get('limit') || '5000', 10);

  // Count remaining wells to process
  const remaining = await env.WELLS_DB.prepare(`
    SELECT COUNT(*) as count FROM wells
    WHERE bh_section IS NOT NULL
      AND bh_township IS NOT NULL
      AND bh_latitude IS NULL
  `).first();

  console.log(`[BackfillBhCoords] ${remaining?.count} wells need BH coordinates. Processing up to ${maxToProcess}.`);

  // Pre-load section centers into a lookup map for fast matching
  const sections = await env.WELLS_DB.prepare(`
    SELECT section, township, range, meridian, center_lat, center_lng
    FROM plss_sections
    WHERE center_lat IS NOT NULL
  `).all();

  const sectionMap = new Map<string, { lat: number; lng: number }>();
  for (const s of sections.results) {
    const key = `${s.section}|${s.township}|${s.range}|${s.meridian}`;
    sectionMap.set(key, { lat: s.center_lat as number, lng: s.center_lng as number });
  }
  console.log(`[BackfillBhCoords] Loaded ${sectionMap.size} section centers into lookup map`);

  const DB_BATCH = 100;
  const FETCH_BATCH = 500;
  let processed = 0;
  let updated = 0;
  let noMatch = 0;
  let errors = 0;

  while (processed < maxToProcess) {
    const wells = await env.WELLS_DB.prepare(`
      SELECT id, bh_section, bh_township, bh_range, meridian
      FROM wells
      WHERE bh_section IS NOT NULL
        AND bh_township IS NOT NULL
        AND bh_latitude IS NULL
      LIMIT ?
    `).bind(Math.min(FETCH_BATCH, maxToProcess - processed)).all();

    if (wells.results.length === 0) break;

    const statements = [];

    for (const well of wells.results) {
      processed++;
      try {
        const township = convertTownship(well.bh_township as string);
        const range = convertRange(well.bh_range as string);
        const meridian = convertMeridian(well.meridian as string);
        const section = String(well.bh_section);

        if (!township || !range || !meridian) {
          errors++;
          continue;
        }

        // Try both padded and unpadded section (plss stores "02" or "2")
        let center = sectionMap.get(`${section}|${township}|${range}|${meridian}`);
        if (!center) {
          const paddedSection = section.padStart(2, '0');
          center = sectionMap.get(`${paddedSection}|${township}|${range}|${meridian}`);
        }

        if (center) {
          statements.push(
            env.WELLS_DB.prepare(`
              UPDATE wells SET bh_latitude = ?, bh_longitude = ?, bh_coordinate_source = 'section_center'
              WHERE id = ?
            `).bind(center.lat, center.lng, well.id)
          );
          updated++;
        } else {
          noMatch++;
        }
      } catch {
        errors++;
      }
    }

    // Execute in D1 batch chunks
    for (let i = 0; i < statements.length; i += DB_BATCH) {
      const chunk = statements.slice(i, i + DB_BATCH);
      await env.WELLS_DB.batch(chunk);
    }

    console.log(`[BackfillBhCoords] Progress: ${processed} processed, ${updated} updated, ${noMatch} no match`);

    if (wells.results.length < FETCH_BATCH) break;
  }

  const remainingAfter = (remaining?.count as number || 0) - updated;

  return jsonResponse({
    success: true,
    processed,
    updated,
    noMatch,
    errors,
    remaining: Math.max(0, remainingAfter),
    message: remainingAfter > 0
      ? `Call again to process remaining ${remainingAfter} wells`
      : 'All eligible wells have BH coordinates'
  });
}
