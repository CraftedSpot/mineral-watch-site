/**
 * OCC Docket Entries Handler
 *
 * Provides API endpoints for fetching docket entries by section/township/range
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

// Section grid layout (boustrophedon pattern)
// Sections are numbered in a snake pattern within a township
const SECTION_GRID = [
  [ 6,  5,  4,  3,  2,  1],
  [ 7,  8,  9, 10, 11, 12],
  [18, 17, 16, 15, 14, 13],
  [19, 20, 21, 22, 23, 24],
  [30, 29, 28, 27, 26, 25],
  [31, 32, 33, 34, 35, 36]
];

// Build reverse lookup: section number -> [row, col]
const SECTION_TO_POSITION: Map<number, [number, number]> = new Map();
for (let row = 0; row < 6; row++) {
  for (let col = 0; col < 6; col++) {
    SECTION_TO_POSITION.set(SECTION_GRID[row][col], [row, col]);
  }
}

/**
 * Get adjacent sections for a given section within the same township
 * Returns array of section numbers (1-36) that are adjacent
 */
function getAdjacentSectionsInTownship(section: number): number[] {
  const pos = SECTION_TO_POSITION.get(section);
  if (!pos) return [];

  const [row, col] = pos;
  const adjacent: number[] = [];

  // Check all 8 directions
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [ 0, -1],          [ 0, 1],
    [ 1, -1], [ 1, 0], [ 1, 1]
  ];

  for (const [dr, dc] of directions) {
    const newRow = row + dr;
    const newCol = col + dc;

    if (newRow >= 0 && newRow < 6 && newCol >= 0 && newCol < 6) {
      adjacent.push(SECTION_GRID[newRow][newCol]);
    }
  }

  return adjacent;
}

/**
 * Parse township string to get number and direction
 * e.g., "24N" -> { num: 24, dir: 'N' }
 */
function parseTownship(township: string): { num: number; dir: string } | null {
  const match = township.match(/^(\d+)([NS])$/i);
  if (!match) return null;
  return { num: parseInt(match[1]), dir: match[2].toUpperCase() };
}

/**
 * Parse range string to get number and direction
 * e.g., "12W" -> { num: 12, dir: 'W' }
 */
function parseRange(range: string): { num: number; dir: string } | null {
  const match = range.match(/^(\d+)([EW])$/i);
  if (!match) return null;
  return { num: parseInt(match[1]), dir: match[2].toUpperCase() };
}

/**
 * Get sections that are on edges that border adjacent townships
 * Returns object mapping edge type to section numbers
 */
function getEdgeSections(section: number): { north: boolean; south: boolean; east: boolean; west: boolean } {
  const pos = SECTION_TO_POSITION.get(section);
  if (!pos) return { north: false, south: false, east: false, west: false };

  const [row, col] = pos;
  return {
    north: row === 0,
    south: row === 5,
    east: col === 5,
    west: col === 0
  };
}

/**
 * Get adjacent locations including cross-township boundaries
 * This is more complex - for edge sections, we need to look into adjacent townships
 */
function getAdjacentLocations(
  section: number,
  township: string,
  range: string
): Array<{ section: number; township: string; range: string }> {
  const locations: Array<{ section: number; township: string; range: string }> = [];

  // First, get adjacent sections within the same township
  const adjacentInTownship = getAdjacentSectionsInTownship(section);
  for (const adjSection of adjacentInTownship) {
    locations.push({ section: adjSection, township, range });
  }

  // For cross-township adjacency, check if section is on an edge
  const edges = getEdgeSections(section);
  const pos = SECTION_TO_POSITION.get(section);
  if (!pos) return locations;

  const [row, col] = pos;
  const twp = parseTownship(township);
  const rng = parseRange(range);

  if (!twp || !rng) return locations;

  // North edge - look into township to the north
  if (edges.north) {
    const northTwp = twp.dir === 'N' ? `${twp.num + 1}N` : (twp.num > 1 ? `${twp.num - 1}S` : '1N');
    // Southern row of north township: sections 31-36
    const southRowSections = [31, 32, 33, 34, 35, 36];
    // Get the 3 sections directly above (based on column position)
    for (let dc = -1; dc <= 1; dc++) {
      const newCol = col + dc;
      if (newCol >= 0 && newCol < 6) {
        locations.push({ section: southRowSections[newCol], township: northTwp, range });
      }
    }
  }

  // South edge - look into township to the south
  if (edges.south) {
    const southTwp = twp.dir === 'S' ? `${twp.num + 1}S` : (twp.num > 1 ? `${twp.num - 1}N` : '1S');
    // Northern row of south township: sections 1-6
    const northRowSections = [6, 5, 4, 3, 2, 1];
    for (let dc = -1; dc <= 1; dc++) {
      const newCol = col + dc;
      if (newCol >= 0 && newCol < 6) {
        locations.push({ section: northRowSections[newCol], township: southTwp, range });
      }
    }
  }

  // East edge - look into range to the east
  if (edges.east) {
    const eastRng = rng.dir === 'E' ? `${rng.num + 1}E` : (rng.num > 1 ? `${rng.num - 1}W` : '1E');
    // Western column of east range
    const westColSections = [6, 7, 18, 19, 30, 31];
    for (let dr = -1; dr <= 1; dr++) {
      const newRow = row + dr;
      if (newRow >= 0 && newRow < 6) {
        locations.push({ section: westColSections[newRow], township, range: eastRng });
      }
    }
  }

  // West edge - look into range to the west
  if (edges.west) {
    const westRng = rng.dir === 'W' ? `${rng.num + 1}W` : (rng.num > 1 ? `${rng.num - 1}E` : '1W');
    // Eastern column of west range
    const eastColSections = [1, 12, 13, 24, 25, 36];
    for (let dr = -1; dr <= 1; dr++) {
      const newRow = row + dr;
      if (newRow >= 0 && newRow < 6) {
        locations.push({ section: eastColSections[newRow], township, range: westRng });
      }
    }
  }

  return locations;
}

/**
 * Format relief type for display
 */
function formatReliefType(reliefType: string): string {
  const typeMap: Record<string, string> = {
    'LOCATION_EXCEPTION': 'Location Exception',
    'HORIZONTAL_WELL': 'Horizontal Well',
    'INCREASED_DENSITY': 'Increased Density',
    'POOLING': 'Pooling',
    'SPACING': 'Spacing',
    'OPERATOR_CHANGE': 'Operator Change',
    'ORDER_MODIFICATION': 'Order Modification'
  };
  return typeMap[reliefType] || reliefType || 'Unknown';
}

/**
 * Format status for display
 */
function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'CONTINUED': 'Continued',
    'UNKNOWN': 'Filed',
    'HEARD': 'Heard',
    'RECOMMENDED': 'Recommended',
    'DISMISSED': 'Dismissed',
    'SCHEDULED': 'Scheduled',
    'WITHDRAWN': 'Withdrawn'
  };
  return statusMap[status] || status || 'Filed';
}

/**
 * Normalize township format - strip leading zeros
 * "08N" -> "8N", "7N" -> "7N", "07 N" -> "7N"
 */
function normalizeTownship(twn: string): string {
  const match = twn.trim().toUpperCase().match(/^0*(\d{1,2})\s*([NS])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : twn.toUpperCase();
}

/**
 * Normalize range format - strip leading zeros
 * "04W" -> "4W", "13E" -> "13E"
 */
function normalizeRange(rng: string): string {
  const match = rng.trim().toUpperCase().match(/^0*(\d{1,2})\s*([EW])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : rng.toUpperCase();
}

/**
 * GET /api/docket-entries
 * Fetch docket entries for a section/township/range
 */
export async function handleGetDocketEntries(request: Request, env: Env): Promise<Response> {
  const start = Date.now();

  try {
    // Authentication required
    const authUser = await authenticateRequest(request, env);
    if (!authUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const section = url.searchParams.get('section');
    const township = url.searchParams.get('township');
    const range = url.searchParams.get('range');
    const meridian = url.searchParams.get('meridian') || 'IM'; // Default to Indian Meridian
    const includeAdjacent = url.searchParams.get('includeAdjacent') === 'true';

    if (!section || !township || !range) {
      return jsonResponse({
        error: 'Missing required parameters',
        message: 'section, township, and range are required'
      }, 400);
    }

    // Normalize inputs - strip leading zeros from township/range to match docket data format
    const sectionNum = parseInt(section);
    const townshipNorm = normalizeTownship(township);
    const rangeNorm = normalizeRange(range);
    const meridianNorm = meridian.toUpperCase();

    if (isNaN(sectionNum) || sectionNum < 1 || sectionNum > 36) {
      return jsonResponse({ error: 'Invalid section number (must be 1-36)' }, 400);
    }

    if (meridianNorm !== 'IM' && meridianNorm !== 'CM') {
      return jsonResponse({ error: 'Invalid meridian (must be IM or CM)' }, 400);
    }

    console.log(`[DocketEntries] Querying for S${sectionNum}-T${townshipNorm}-R${rangeNorm} (${meridianNorm}), includeAdjacent=${includeAdjacent}`);

    // Query direct matches
    const directResults = await env.WELLS_DB.prepare(`
      SELECT
        case_number,
        relief_type,
        applicant,
        county,
        section,
        township,
        range,
        hearing_date,
        status,
        source_url,
        docket_date,
        order_number
      FROM occ_docket_entries
      WHERE section = ? AND township = ? AND range = ? AND meridian = ?
      ORDER BY hearing_date DESC
      LIMIT 50
    `).bind(String(sectionNum), townshipNorm, rangeNorm, meridianNorm).all();

    // Format direct results
    const direct = (directResults.results || []).map((row: any) => ({
      caseNumber: row.case_number,
      reliefType: row.relief_type,
      reliefTypeDisplay: formatReliefType(row.relief_type),
      applicant: row.applicant,
      county: row.county,
      section: row.section,
      township: row.township,
      range: row.range,
      hearingDate: row.hearing_date,
      status: row.status,
      statusDisplay: formatStatus(row.status),
      sourceUrl: row.source_url,
      docketDate: row.docket_date,
      orderNumber: row.order_number
    }));

    let adjacent: any[] = [];

    if (includeAdjacent) {
      // Get adjacent locations (including cross-township)
      const adjacentLocations = getAdjacentLocations(sectionNum, townshipNorm, rangeNorm);

      // Relief types that are relevant for adjacent section queries
      // (horizontal wells and multi-section operations that could affect neighbors)
      const relevantTypes = ['HORIZONTAL_WELL', 'INCREASED_DENSITY', 'POOLING'];
      const typesList = relevantTypes.map(t => `'${t}'`).join(', ');

      // Build a query for all adjacent locations
      // Group by location to avoid duplicates
      const locationConditions = adjacentLocations.map(() =>
        '(section = ? AND township = ? AND range = ?)'
      ).join(' OR ');

      if (locationConditions) {
        const adjacentQuery = `
          SELECT
            case_number,
            relief_type,
            applicant,
            county,
            section,
            township,
            range,
            hearing_date,
            status,
            source_url,
            docket_date,
            order_number
          FROM occ_docket_entries
          WHERE relief_type IN (${typesList})
            AND meridian = ?
            AND (${locationConditions})
          ORDER BY hearing_date DESC
          LIMIT 30
        `;

        // Flatten location parameters (meridian first, then locations)
        const params = [
          meridianNorm,
          ...adjacentLocations.flatMap(loc => [
            String(loc.section),
            loc.township,
            loc.range
          ])
        ];

        const adjacentResults = await env.WELLS_DB.prepare(adjacentQuery)
          .bind(...params)
          .all();

        adjacent = (adjacentResults.results || []).map((row: any) => ({
          caseNumber: row.case_number,
          reliefType: row.relief_type,
          reliefTypeDisplay: formatReliefType(row.relief_type),
          applicant: row.applicant,
          county: row.county,
          section: row.section,
          township: row.township,
          range: row.range,
          hearingDate: row.hearing_date,
          status: row.status,
          statusDisplay: formatStatus(row.status),
          sourceUrl: row.source_url,
          docketDate: row.docket_date,
          orderNumber: row.order_number
        }));
      }
    }

    console.log(`[DocketEntries] Found ${direct.length} direct, ${adjacent.length} adjacent in ${Date.now() - start}ms`);

    return jsonResponse({
      success: true,
      direct,
      adjacent,
      queryTime: Date.now() - start
    });

  } catch (error) {
    console.error('[DocketEntries] Error:', error);
    return jsonResponse({
      error: 'Failed to fetch docket entries',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
