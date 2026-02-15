import type { Env } from "../types/env.js";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleGetPlssSection(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: "Database not configured" }, 500);
    }

    const url = new URL(request.url);
    const section = url.searchParams.get("section");
    const township = url.searchParams.get("township");
    const range = url.searchParams.get("range");

    if (!section || !township || !range) {
      return jsonResponse({ error: "Missing required parameters: section, township, range" }, 400);
    }

    // Pad section to 2 digits for matching
    const paddedSection = section.toString().padStart(2, "0");

    // PLSS table stores townships in fractional format (e.g., "15N" → "150N")
    // Normalize: extract number and direction, multiply by 10
    const twnMatch = township.match(/^(\d+)([NS])$/i);
    const plssTownship = twnMatch
      ? `${parseInt(twnMatch[1]) * 10}${twnMatch[2].toUpperCase()}`
      : township;

    // Query D1 for the section geometry
    const result = await env.WELLS_DB.prepare(`
      SELECT id, section, township, range, meridian, acres, geometry
      FROM plss_sections
      WHERE section = ? AND township = ? AND range = ?
      LIMIT 1
    `).bind(paddedSection, plssTownship, range).first();

    if (!result) {
      // Try without padding
      const result2 = await env.WELLS_DB.prepare(`
        SELECT id, section, township, range, meridian, acres, geometry
        FROM plss_sections
        WHERE section = ? AND township = ? AND range = ?
        LIMIT 1
      `).bind(section, plssTownship, range).first();

      if (!result2) {
        return jsonResponse({ error: "Section not found" }, 404);
      }

      // Convert to GeoJSON feature format expected by the map
      const geometry = JSON.parse(result2.geometry as string);
      return jsonResponse({
        type: "Feature",
        properties: {
          frstdivno: result2.section,
          plssid: result2.id,
          gisacre: result2.acres,
          meridian: result2.meridian,
        },
        geometry,
      });
    }

    // Convert to GeoJSON feature format expected by the map
    const geometry = JSON.parse(result.geometry as string);
    return jsonResponse({
      type: "Feature",
      properties: {
        frstdivno: result.section,
        plssid: result.id,
        gisacre: result.acres,
        meridian: result.meridian,
      },
      geometry,
    });
  } catch (error) {
    console.error("[PlssSections] Error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

export async function handleGetPlssSectionsBatch(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: "Database not configured" }, 500);
    }

    const body = await request.json() as { sections: Array<{ section: string; township: string; range: string }> };

    if (!body.sections || !Array.isArray(body.sections)) {
      return jsonResponse({ error: "Missing sections array in request body" }, 400);
    }

    // Limit batch size
    const sections = body.sections.slice(0, 50);
    const results: Record<string, unknown> = {};

    // Query each section (could optimize with IN clause but keeping simple for now)
    for (const s of sections) {
      const paddedSection = s.section.toString().padStart(2, "0");
      const cacheKey = `${s.section}-${s.township}-${s.range}`;

      // PLSS table stores townships in fractional format (e.g., "15N" → "150N")
      const twnMatch = s.township.match(/^(\d+)([NS])$/i);
      const plssTownship = twnMatch
        ? `${parseInt(twnMatch[1]) * 10}${twnMatch[2].toUpperCase()}`
        : s.township;

      const result = await env.WELLS_DB.prepare(`
        SELECT id, section, township, range, meridian, acres, geometry
        FROM plss_sections
        WHERE section = ? AND township = ? AND range = ?
        LIMIT 1
      `).bind(paddedSection, plssTownship, s.range).first();

      if (result) {
        const geometry = JSON.parse(result.geometry as string);
        results[cacheKey] = {
          type: "Feature",
          properties: {
            frstdivno: result.section,
            plssid: result.id,
            gisacre: result.acres,
            meridian: result.meridian,
          },
          geometry,
        };
      }
    }

    return jsonResponse(results);
  } catch (error) {
    console.error("[PlssSections] Batch error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}
