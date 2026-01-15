/**
 * Well Link Counts Handler
 *
 * Returns counts of linked properties, documents, and OCC filings for all wells.
 * Used by the dashboard to populate the Links column in the Wells grid.
 *
 * Data sources (matching what well modal uses):
 * - Properties: D1 property_well_links by well_airtable_id
 * - Documents: D1 documents joined with airtable_wells by API number
 * - OCC Filings: D1 occ_docket_entries by well's section/township/range
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { fetchAllAirtableRecords, getUserFromSession } from '../services/airtable.js';
import { BASE_ID, WELLS_TABLE } from '../constants.js';
import type { Env } from '../index';

// Section grid layout (boustrophedon pattern)
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
 * Get adjacent sections within the same township (8 neighbors)
 */
function getAdjacentSectionsInTownship(section: number): number[] {
  const pos = SECTION_TO_POSITION.get(section);
  if (!pos) return [];

  const [row, col] = pos;
  const adjacent: number[] = [];

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
 */
function parseTownship(township: string): { num: number; dir: string } | null {
  const match = township.match(/^(\d+)([NS])$/i);
  if (!match) return null;
  return { num: parseInt(match[1]), dir: match[2].toUpperCase() };
}

/**
 * Parse range string to get number and direction
 */
function parseRange(range: string): { num: number; dir: string } | null {
  const match = range.match(/^(\d+)([EW])$/i);
  if (!match) return null;
  return { num: parseInt(match[1]), dir: match[2].toUpperCase() };
}

/**
 * Get sections that are on edges that border adjacent townships/ranges
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
 * Get adjacent locations including cross-township/range boundaries
 */
function getAdjacentLocations(
  section: number,
  township: string,
  range: string
): Array<{ section: number; township: string; range: string }> {
  const locations: Array<{ section: number; township: string; range: string }> = [];

  // Adjacent within same township
  const adjacentInTownship = getAdjacentSectionsInTownship(section);
  for (const adjSection of adjacentInTownship) {
    locations.push({ section: adjSection, township, range });
  }

  // Cross-township adjacency for edge sections
  const edges = getEdgeSections(section);
  const pos = SECTION_TO_POSITION.get(section);
  if (!pos) return locations;

  const [row, col] = pos;
  const twp = parseTownship(township);
  const rng = parseRange(range);

  if (!twp || !rng) return locations;

  // North edge
  if (edges.north) {
    const northTwp = twp.dir === 'N' ? `${twp.num + 1}N` : (twp.num > 1 ? `${twp.num - 1}S` : '1N');
    const southRowSections = [31, 32, 33, 34, 35, 36];
    for (let dc = -1; dc <= 1; dc++) {
      const newCol = col + dc;
      if (newCol >= 0 && newCol < 6) {
        locations.push({ section: southRowSections[newCol], township: northTwp, range });
      }
    }
  }

  // South edge
  if (edges.south) {
    const southTwp = twp.dir === 'S' ? `${twp.num + 1}S` : (twp.num > 1 ? `${twp.num - 1}N` : '1S');
    const northRowSections = [6, 5, 4, 3, 2, 1];
    for (let dc = -1; dc <= 1; dc++) {
      const newCol = col + dc;
      if (newCol >= 0 && newCol < 6) {
        locations.push({ section: northRowSections[newCol], township: southTwp, range });
      }
    }
  }

  // East edge
  if (edges.east) {
    const eastRng = rng.dir === 'E' ? `${rng.num + 1}E` : (rng.num > 1 ? `${rng.num - 1}W` : '1E');
    const westColSections = [6, 7, 18, 19, 30, 31];
    for (let dr = -1; dr <= 1; dr++) {
      const newRow = row + dr;
      if (newRow >= 0 && newRow < 6) {
        locations.push({ section: westColSections[newRow], township, range: eastRng });
      }
    }
  }

  // West edge
  if (edges.west) {
    const westRng = rng.dir === 'W' ? `${rng.num + 1}W` : (rng.num > 1 ? `${rng.num - 1}E` : '1W');
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
 * Normalize township format
 */
function normalizeTownship(twn: string | null): string | null {
  if (!twn) return null;
  const match = twn.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([NS])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : twn.toUpperCase();
}

/**
 * Normalize range format
 */
function normalizeRange(rng: string | null): string | null {
  if (!rng) return null;
  const match = rng.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([EW])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : rng.toUpperCase();
}

/**
 * Normalize section to integer
 */
function normalizeSection(sec: string | number | null): number | null {
  if (sec === null || sec === undefined) return null;
  const num = parseInt(sec.toString(), 10);
  return isNaN(num) ? null : num;
}

const BATCH_SIZE_D1 = 75;
const WELLS_CACHE_TTL = 300; // 5 minutes

// Document types that show on well modals
const WELL_DOC_TYPES = [
  'completion_report', 'drilling_permit', 'plugging_report', 'well_log',
  'production_report', 'regulatory_filing', 'occ_order', 'division_order'
];

interface LinkCounts {
  [wellId: string]: {
    properties: number;
    documents: number;
    filings: number;
  };
}

interface WellSTR {
  wellId: string;
  apiNumber: string;
  sec: number;
  twn: string;
  rng: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Get cached wells or fetch from Airtable and cache
 */
async function getCachedWells(
  env: Env,
  cacheKey: string,
  wellsFilter: string
): Promise<any[] | null> {
  try {
    const cached = await env.OCC_CACHE.get(cacheKey);
    if (cached) {
      console.log('[WellLinkCounts] Using cached wells');
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error('[WellLinkCounts] Cache read error:', err);
  }

  const wells = await fetchAllAirtableRecords(env, WELLS_TABLE, wellsFilter);

  if (wells && wells.length > 0) {
    try {
      await env.OCC_CACHE.put(cacheKey, JSON.stringify(wells), { expirationTtl: WELLS_CACHE_TTL });
      console.log('[WellLinkCounts] Cached', wells.length, 'wells');
    } catch (err) {
      console.error('[WellLinkCounts] Cache write error:', err);
    }
  }

  return wells;
}

/**
 * Fetch property counts from D1
 */
async function fetchPropertyCounts(
  env: Env,
  wellIds: string[]
): Promise<Map<string, number>> {
  const propertyCounts = new Map<string, number>();
  const batches = chunk(wellIds, BATCH_SIZE_D1);

  const batchPromises = batches.map(async (batch) => {
    try {
      const placeholders = batch.map(() => '?').join(', ');
      const query = `
        SELECT well_airtable_id, COUNT(*) as count
        FROM property_well_links
        WHERE well_airtable_id IN (${placeholders})
          AND status = 'Active'
        GROUP BY well_airtable_id
      `;
      const result = await env.WELLS_DB.prepare(query).bind(...batch).all();
      return result.results as { well_airtable_id: string; count: number }[] || [];
    } catch (err) {
      console.error('[WellLinkCounts] Error fetching property links:', err);
      return [];
    }
  });

  const results = await Promise.all(batchPromises);
  for (const rows of results) {
    for (const row of rows) {
      propertyCounts.set(row.well_airtable_id, row.count);
    }
  }

  return propertyCounts;
}

/**
 * Fetch document counts from D1 by API number
 */
async function fetchDocumentCounts(
  env: Env,
  apiNumbers: string[],
  apiToWellId: Map<string, string>
): Promise<Map<string, number>> {
  const docCounts = new Map<string, number>();
  const batches = chunk(apiNumbers.filter(a => a), BATCH_SIZE_D1);
  const docTypeList = WELL_DOC_TYPES.map(type => `'${type}'`).join(', ');

  const batchPromises = batches.map(async (batch) => {
    try {
      const placeholders = batch.map(() => '?').join(', ');
      const query = `
        SELECT aw.api_number, COUNT(*) as count
        FROM documents d
        JOIN airtable_wells aw ON d.well_id = aw.airtable_record_id
        WHERE aw.api_number IN (${placeholders})
          AND (d.deleted_at IS NULL OR d.deleted_at = '')
          AND d.doc_type IN (${docTypeList})
        GROUP BY aw.api_number
      `;
      const result = await env.WELLS_DB.prepare(query).bind(...batch).all();
      return result.results as { api_number: string; count: number }[] || [];
    } catch (err) {
      console.error('[WellLinkCounts] Error fetching document counts:', err);
      return [];
    }
  });

  const results = await Promise.all(batchPromises);
  for (const rows of results) {
    for (const row of rows) {
      const wellId = apiToWellId.get(row.api_number);
      if (wellId) {
        docCounts.set(wellId, row.count);
      }
    }
  }

  return docCounts;
}

/**
 * Fetch OCC filing counts from D1 (direct + adjacent sections)
 */
async function fetchOCCFilingCounts(
  env: Env,
  wellSTRs: WellSTR[]
): Promise<Map<string, number>> {
  const filingCounts = new Map<string, number>();

  if (wellSTRs.length === 0) return filingCounts;

  // Initialize all wells to 0
  for (const wstr of wellSTRs) {
    filingCounts.set(wstr.wellId, 0);
  }

  // Build maps for direct and adjacent STR lookups
  const directSTRMap: Map<string, string[]> = new Map();
  const adjacentSTRMap: Map<string, string[]> = new Map();

  for (const wstr of wellSTRs) {
    const directKey = `${wstr.sec}|${wstr.twn}|${wstr.rng}`;

    if (!directSTRMap.has(directKey)) {
      directSTRMap.set(directKey, []);
    }
    directSTRMap.get(directKey)!.push(wstr.wellId);

    const adjacentLocations = getAdjacentLocations(wstr.sec, wstr.twn, wstr.rng);
    for (const loc of adjacentLocations) {
      const adjKey = `${loc.section}|${loc.township}|${loc.range}`;
      if (!adjacentSTRMap.has(adjKey)) {
        adjacentSTRMap.set(adjKey, []);
      }
      adjacentSTRMap.get(adjKey)!.push(wstr.wellId);
    }
  }

  // Get all unique STR keys
  const allSTRKeys = new Set([...directSTRMap.keys(), ...adjacentSTRMap.keys()]);
  const allSTRList = Array.from(allSTRKeys).map(key => {
    const [sec, twn, rng] = key.split('|');
    return { sec: parseInt(sec), twn, rng, key };
  });

  console.log('[WellLinkCounts] Querying', directSTRMap.size, 'direct +', adjacentSTRMap.size, 'adjacent STR locations');

  // Query OCC entries in batches (parallelized)
  const strBatches = chunk(allSTRList, BATCH_SIZE_D1);
  const strBatchPromises = strBatches.map(async (batch) => {
    try {
      const whereConditions = batch.map(
        ({ sec, twn, rng }) => `(section = '${sec}' AND UPPER(township) = '${twn}' AND UPPER(range) = '${rng}')`
      ).join(' OR ');

      const query = `
        SELECT section as sec, township as twn, range as rng, relief_type, COUNT(*) as count
        FROM occ_docket_entries
        WHERE (${whereConditions})
        GROUP BY section, township, range, relief_type
      `;
      const result = await env.WELLS_DB.prepare(query).all();
      return result.results as { sec: string; twn: string; rng: string; relief_type: string; count: number }[] || [];
    } catch (err) {
      console.error('[WellLinkCounts] Error querying OCC filings:', err);
      return [];
    }
  });

  const strResults = await Promise.all(strBatchPromises);

  // Process results
  for (const rows of strResults) {
    for (const row of rows) {
      const normSec = normalizeSection(row.sec);
      const normTwn = normalizeTownship(row.twn);
      const normRng = normalizeRange(row.rng);

      if (normSec === null || !normTwn || !normRng) continue;

      const strKey = `${normSec}|${normTwn}|${normRng}`;
      const reliefType = row.relief_type;

      // Direct matches: count ALL relief types
      const directWells = directSTRMap.get(strKey) || [];
      for (const wellId of directWells) {
        filingCounts.set(wellId, (filingCounts.get(wellId) || 0) + row.count);
      }

      // Adjacent matches: only specific relief types
      if (['HORIZONTAL_WELL', 'INCREASED_DENSITY', 'POOLING'].includes(reliefType)) {
        const adjacentWells = adjacentSTRMap.get(strKey) || [];
        for (const wellId of adjacentWells) {
          if (!directWells.includes(wellId)) {
            filingCounts.set(wellId, (filingCounts.get(wellId) || 0) + row.count);
          }
        }
      }
    }
  }

  return filingCounts;
}

/**
 * Get link counts for all wells belonging to the authenticated user
 *
 * Optimizations:
 * - Wells cached in KV for 5 minutes (user/org-specific)
 * - Properties, documents, and OCC queries run in parallel
 * - D1 batches run in parallel within each category
 */
export async function handleGetWellLinkCounts(request: Request, env: Env) {
  const start = Date.now();
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const counts: LinkCounts = {};

  try {
    const userRecord = await getUserFromSession(env, user);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    // Build cache key and filter
    const organizationId = userRecord.fields.Organization?.[0];
    const cacheKey = `link-counts:wells:${organizationId || user.id}`;
    let wellsFilter: string;

    if (organizationId) {
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
        { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
      );

      if (orgResponse.ok) {
        const org = await orgResponse.json() as any;
        wellsFilter = `{Organization} = '${org.fields.Name}'`;
      } else {
        wellsFilter = `FIND("${user.email}", ARRAYJOIN({User})) > 0`;
      }
    } else {
      wellsFilter = `FIND("${user.email}", ARRAYJOIN({User})) > 0`;
    }

    // Get wells (cached or fresh)
    const wells = await getCachedWells(env, cacheKey, wellsFilter);
    console.log('[WellLinkCounts] Found', wells?.length || 0, 'wells');

    if (!wells || wells.length === 0) {
      return jsonResponse(counts);
    }

    // Initialize counts and build well STR list
    const wellSTRs: WellSTR[] = [];
    const wellIds: string[] = [];
    const apiNumbers: string[] = [];
    const apiToWellId: Map<string, string> = new Map();

    for (const well of wells) {
      counts[well.id] = { properties: 0, documents: 0, filings: 0 };
      wellIds.push(well.id);

      const apiNumber = well.fields?.['API Number'];
      if (apiNumber) {
        apiNumbers.push(apiNumber);
        apiToWellId.set(apiNumber, well.id);
      }

      const sec = normalizeSection(well.fields?.Section);
      const twn = normalizeTownship(well.fields?.Township);
      const rng = normalizeRange(well.fields?.Range);

      if (sec !== null && twn && rng) {
        wellSTRs.push({ wellId: well.id, apiNumber: apiNumber || '', sec, twn, rng });
      }
    }

    // Run all three query types in parallel
    const [propertyCounts, docCounts, filingCounts] = await Promise.all([
      fetchPropertyCounts(env, wellIds),
      fetchDocumentCounts(env, apiNumbers, apiToWellId),
      fetchOCCFilingCounts(env, wellSTRs)
    ]);

    // Merge results into counts
    for (const wellId of wellIds) {
      counts[wellId].properties = propertyCounts.get(wellId) || 0;
      counts[wellId].documents = docCounts.get(wellId) || 0;
      counts[wellId].filings = filingCounts.get(wellId) || 0;
    }

    // Log summary
    const withProperties = Object.entries(counts).filter(([_, c]) => c.properties > 0);
    const withDocs = Object.entries(counts).filter(([_, c]) => c.documents > 0);
    const withFilings = Object.entries(counts).filter(([_, c]) => c.filings > 0);
    console.log(`[WellLinkCounts] Done in ${Date.now() - start}ms. Properties: ${withProperties.length}, Docs: ${withDocs.length}, Filings: ${withFilings.length}`);

    return jsonResponse(counts);

  } catch (err) {
    console.error('[WellLinkCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get link counts' }, 500);
  }
}
