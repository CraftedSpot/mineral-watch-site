/**
 * Nearby Wells Handler
 * 
 * Queries D1 WELLS_DB for wells matching provided TRS values
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

/**
 * Normalize township/range values to match D1 database format
 * Examples: '9N' → '09N', '5W' → '05W', '15N' stays '15N'
 */
function normalizeTownshipRange(value: string): string {
  // Extract numeric part and direction
  const match = value.match(/^(\d+)([NSEW])$/);
  if (!match) return value;
  
  const [, num, direction] = match;
  const numericPart = parseInt(num);
  
  // Pad single digits with leading zero
  const paddedNum = numericPart < 10 ? `0${numericPart}` : numericPart.toString();
  
  return `${paddedNum}${direction}`;
}

/**
 * Query wells by TRS values
 * Endpoints: 
 * - GET /api/nearby-wells?trs=15-9N-5W-IM&trs=16-9N-5W-IM
 * - POST /api/nearby-wells with JSON body { trs: string[], status: 'active' | 'all', limit?: number }
 * 
 * Query params (GET) or JSON body (POST):
 * - trs: One or more TRS values in format "section-township-range-meridian"
 * - status: 'active' | 'all' (defaults to 'active')
 * - limit: Maximum number of results (default 1000, max 5000 for POST)
 * - offset: Pagination offset (default 0) - GET only
 */
export async function handleNearbyWells(request: Request, env: Env): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[NearbyWells] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Wells database not configured',
        message: 'The nearby wells feature is not available at this time'
      }, 503);
    }

    let trsParams: string[] = [];
    let limit: number;
    let offset = 0;
    let status: string;

    // Handle both GET and POST requests
    if (request.method === 'POST') {
      // Parse JSON body
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ 
          error: 'Invalid JSON',
          message: 'Request body must be valid JSON'
        }, 400);
      }

      trsParams = body.trs || [];
      // Allow higher limit for POST requests
      limit = Math.min(parseInt(body.limit?.toString() || '10000'), 50000);
      // Map frontend status values to database values
      const statusUpper = body.status?.toUpperCase();
      if (statusUpper === 'ALL') {
        status = 'ALL';
      } else if (statusUpper === 'PA') {
        status = 'PA';
      } else {
        status = 'AC'; // default to active (includes 'AC' or undefined)
      }
      
      console.log(`[NearbyWells] POST request for ${trsParams.length} TRS values, status: ${status}, body.status: ${body.status}`);
    } else {
      // Parse query parameters for GET
      const url = new URL(request.url);
      trsParams = url.searchParams.getAll('trs');
      limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
      offset = parseInt(url.searchParams.get('offset') || '0');
      const statusParam = url.searchParams.get('status');
      // Map frontend status values to database values
      if (statusParam === 'ALL' || statusParam === 'all') {
        status = 'ALL';
      } else if (statusParam === 'PA' || statusParam === 'plugged') {
        status = 'PA';
      } else {
        status = 'AC'; // default to active
      }
    }

    if (trsParams.length === 0) {
      return jsonResponse({ 
        error: 'Missing required parameter',
        message: request.method === 'POST' 
          ? 'Please provide TRS values in the request body as { trs: ["section-township-range-meridian", ...] }'
          : 'Please provide at least one TRS value using ?trs=section-township-range-meridian'
      }, 400);
    }

    // Parse and validate TRS values
    const trsValues = [];
    
    // Log first few TRS values for debugging
    console.log(`[NearbyWells] First 5 TRS params:`, trsParams.slice(0, 5));
    
    for (const trsParam of trsParams) {
      // Parse "18-18N-17W-IM" format with regex
      const match = trsParam.match(/^(\d+)-(\d+[NS])-(\d+[EW])-([IC]M)$/i);
      if (!match) {
        return jsonResponse({ 
          error: 'Invalid TRS format',
          message: `Invalid TRS value: "${trsParam}". Expected format: "section-township-range-meridian" (e.g., "15-9N-5W-IM")`
        }, 400);
      }

      const [_, section, township, range, meridian] = match;
      
      // Debug first TRS parsing
      if (trsValues.length === 0) {
        console.log(`[NearbyWells] Parsing first TRS: "${trsParam}"`);
        console.log(`[NearbyWells] Regex parsed: section="${section}", township="${township}", range="${range}", meridian="${meridian}"`);
      }
      
      // Validate section (1-36)
      const sectionNum = parseInt(section);
      if (isNaN(sectionNum) || sectionNum < 1 || sectionNum > 36) {
        return jsonResponse({ 
          error: 'Invalid section',
          message: `Invalid section "${section}". Must be a number between 1 and 36`
        }, 400);
      }

      // Normalize township and range to match D1 format (pad with leading zeros)
      const normalizedTownship = normalizeTownshipRange(township.toUpperCase());
      const normalizedRange = normalizeTownshipRange(range.toUpperCase());
      
      // Validate meridian
      const validMeridian = meridian.toUpperCase();
      
      // Log normalization for debugging
      if (trsValues.length < 3 || (township !== normalizedTownship || range !== normalizedRange)) {
        console.log(`[NearbyWells] TRS #${trsValues.length + 1}: "${trsParam}" → section=${sectionNum}, township=${normalizedTownship}, range=${normalizedRange}, meridian=${validMeridian}`);
      }
      if (validMeridian !== 'IM' && validMeridian !== 'CM') {
        return jsonResponse({ 
          error: 'Invalid meridian',
          message: `Invalid meridian "${meridian}". Must be either "IM" (Indian Meridian) or "CM" (Cimarron Meridian)`
        }, 400);
      }

      trsValues.push({
        section: sectionNum,
        township: normalizedTownship,
        range: normalizedRange,
        meridian: validMeridian
      });
    }

    console.log(`[NearbyWells] ${trsValues.length} TRS locations, status=${status}`);
    
    const startTime = Date.now();

    // Build all D1 statements and execute in a single batch (1 round-trip)
    const statusFilter = status === 'ALL' ? '' : ' AND well_status = ?';
    const query = `
      SELECT
        w.api_number, w.well_name, w.well_number,
        w.section, w.township, w.range, w.meridian,
        w.county, w.latitude, w.longitude,
        w.operator, w.well_type, w.well_status,
        w.spud_date, w.completion_date,
        w.bh_latitude, w.bh_longitude,
        w.formation_name, w.formation_depth,
        w.true_vertical_depth, w.measured_total_depth,
        w.lateral_length,
        w.ip_oil_bbl, w.ip_gas_mcf, w.ip_water_bbl,
        o.phone, o.contact_name
      FROM wells w
      LEFT JOIN operators o ON UPPER(TRIM(REPLACE(REPLACE(w.operator, '.', ''), ',', ''))) = o.operator_name_normalized
      WHERE section = ? AND township = ? AND range = ? AND meridian = ?${statusFilter}
      ORDER BY well_name
    `;

    const allWells: any[] = [];

    // D1 batch limit is 500 statements per call
    const D1_BATCH = 500;
    for (let i = 0; i < trsValues.length; i += D1_BATCH) {
      const chunk = trsValues.slice(i, i + D1_BATCH);
      const stmts = chunk.map(trs => {
        const params = status === 'ALL'
          ? [trs.section, trs.township, trs.range, trs.meridian]
          : [trs.section, trs.township, trs.range, trs.meridian, status];
        return env.WELLS_DB!.prepare(query).bind(...params);
      });

      const batchResults = await env.WELLS_DB!.batch(stmts);
      for (const result of batchResults) {
        const rows = (result as any).results as any[];
        if (rows && rows.length > 0) {
          allWells.push(...rows);
        }
      }
      console.log(`[NearbyWells] D1 batch ${Math.floor(i / D1_BATCH) + 1}: ${chunk.length} TRS queried, ${allWells.length} wells so far`);
    }

    console.log(`[NearbyWells] ${trsValues.length} TRS queried in ${Date.now() - startTime}ms, ${allWells.length} wells found`);

    // Remove duplicates (wells might appear in multiple batches)
    const uniqueWells = Array.from(
      new Map(allWells.map((w: any) => [w.api_number, w])).values()
    );
    
    // Apply limit and offset to the combined results
    const sortedWells = uniqueWells.sort((a: any, b: any) => {
      const townshipCompare = a.township.localeCompare(b.township);
      if (townshipCompare !== 0) return townshipCompare;
      const rangeCompare = a.range.localeCompare(b.range);
      if (rangeCompare !== 0) return rangeCompare;
      const sectionCompare = a.section - b.section;
      if (sectionCompare !== 0) return sectionCompare;
      return (a.well_name || '').localeCompare(b.well_name || '');
    });
    
    const paginatedWells = sortedWells.slice(offset, offset + limit);
    
    const totalCount = uniqueWells.length;
    const totalTime = Date.now() - startTime;
    console.log(`[NearbyWells] ${totalCount} unique wells, returning ${paginatedWells.length} in ${totalTime}ms`);

    const response = {
      success: true,
      data: {
        wells: paginatedWells,
        pagination: {
          offset,
          limit,
          total: totalCount,
          hasMore: offset + limit < totalCount
        },
        query: {
          trsCount: trsValues.length,
          executionTime: totalTime
        }
      }
    };

    return jsonResponse(response);

  } catch (error) {
    console.error('[NearbyWells] Error:', error);
    return jsonResponse({ 
      error: 'Failed to query wells',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}

/**
 * Alternative endpoint that accepts a single location and searches surrounding sections
 * GET /api/wells/surrounding?section=15&township=9N&range=5W&meridian=IM&radius=1
 */
export async function handleSurroundingWells(request: Request, env: Env): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!env.WELLS_DB) {
      return jsonResponse({ 
        error: 'Wells database not configured',
        message: 'The surrounding wells feature is not available at this time'
      }, 503);
    }

    // Parse query parameters
    const url = new URL(request.url);
    const section = parseInt(url.searchParams.get('section') || '');
    const township = url.searchParams.get('township')?.toUpperCase() || '';
    const range = url.searchParams.get('range')?.toUpperCase() || '';
    const meridian = url.searchParams.get('meridian')?.toUpperCase() || '';
    const radius = parseInt(url.searchParams.get('radius') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);

    // Validate required parameters
    if (!section || !township || !range || !meridian) {
      return jsonResponse({ 
        error: 'Missing required parameters',
        message: 'Required parameters: section, township, range, meridian'
      }, 400);
    }

    // Validate values
    if (isNaN(section) || section < 1 || section > 36) {
      return jsonResponse({ 
        error: 'Invalid section',
        message: 'Section must be between 1 and 36'
      }, 400);
    }

    if (meridian !== 'IM' && meridian !== 'CM') {
      return jsonResponse({ 
        error: 'Invalid meridian',
        message: 'Meridian must be either "IM" or "CM"'
      }, 400);
    }

    if (radius < 0 || radius > 3) {
      return jsonResponse({ 
        error: 'Invalid radius',
        message: 'Radius must be between 0 and 3'
      }, 400);
    }

    console.log(`[SurroundingWells] Searching around S${section} T${township} R${range} ${meridian} with radius ${radius}`);

    // Calculate surrounding sections based on radius
    const sections = getSurroundingSections(section, radius);

    // For radius > 0, we might need to check adjacent townships/ranges
    // For now, we'll keep it simple and just search sections within the same township/range
    const query = `
      SELECT 
        api_number,
        well_name,
        well_number,
        section,
        township,
        range,
        meridian,
        county,
        latitude,
        longitude,
        operator,
        well_type,
        well_status,
        spud_date,
        completion_date
      FROM wells
      WHERE township = ?1 
        AND range = ?2 
        AND meridian = ?3
        AND section IN (${sections.map(() => '?').join(',')})
      ORDER BY section, well_name
      LIMIT ?${4 + sections.length}
    `;

    const params = [township, range, meridian, ...sections, limit];

    const result = await env.WELLS_DB.prepare(query)
      .bind(...params)
      .all();

    return jsonResponse({
      success: true,
      data: {
        wells: result.results,
        query: {
          center: { section, township, range, meridian },
          radius,
          sectionsSearched: sections
        }
      }
    });

  } catch (error) {
    console.error('[SurroundingWells] Error:', error);
    return jsonResponse({ 
      error: 'Failed to query wells',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}

/**
 * Get surrounding sections based on radius
 * Simplified version - doesn't handle township/range boundaries
 */
function getSurroundingSections(centerSection: number, radius: number): number[] {
  if (radius === 0) return [centerSection];

  const sections = new Set<number>();
  sections.add(centerSection);

  // Standard 6x6 grid section layout
  // 6  5  4  3  2  1
  // 7  8  9  10 11 12
  // 18 17 16 15 14 13
  // 19 20 21 22 23 24
  // 30 29 28 27 26 25
  // 31 32 33 34 35 36

  // Simple adjacent section logic
  const adjacentMap: { [key: number]: number[] } = {
    1: [2, 12],
    2: [1, 3, 11, 12],
    3: [2, 4, 10, 11],
    4: [3, 5, 9, 10],
    5: [4, 6, 8, 9],
    6: [5, 7, 8],
    7: [6, 8, 18],
    8: [5, 6, 7, 9, 17, 18],
    9: [4, 5, 8, 10, 16, 17],
    10: [3, 4, 9, 11, 15, 16],
    11: [2, 3, 10, 12, 14, 15],
    12: [1, 2, 11, 13, 14],
    13: [12, 14, 24],
    14: [11, 12, 13, 15, 23, 24],
    15: [10, 11, 14, 16, 22, 23],
    16: [9, 10, 15, 17, 21, 22],
    17: [8, 9, 16, 18, 20, 21],
    18: [7, 8, 17, 19, 20],
    19: [18, 20, 30],
    20: [17, 18, 19, 21, 29, 30],
    21: [16, 17, 20, 22, 28, 29],
    22: [15, 16, 21, 23, 27, 28],
    23: [14, 15, 22, 24, 26, 27],
    24: [13, 14, 23, 25, 26],
    25: [24, 26, 36],
    26: [23, 24, 25, 27, 35, 36],
    27: [22, 23, 26, 28, 34, 35],
    28: [21, 22, 27, 29, 33, 34],
    29: [20, 21, 28, 30, 32, 33],
    30: [19, 20, 29, 31, 32],
    31: [30, 32],
    32: [29, 30, 31, 33],
    33: [28, 29, 32, 34],
    34: [27, 28, 33, 35],
    35: [26, 27, 34, 36],
    36: [25, 26, 35]
  };

  // Add sections based on radius
  let currentSections = [centerSection];
  for (let r = 1; r <= radius; r++) {
    const newSections: number[] = [];
    for (const section of currentSections) {
      const adjacent = adjacentMap[section] || [];
      for (const adj of adjacent) {
        if (!sections.has(adj)) {
          sections.add(adj);
          newSections.push(adj);
        }
      }
    }
    currentSections = newSections;
  }

  return Array.from(sections).sort((a, b) => a - b);
}