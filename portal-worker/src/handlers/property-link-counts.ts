/**
 * Property Link Counts Handler
 *
 * Returns counts of linked wells, documents, and OCC filings for all properties.
 * Used by the dashboard to populate the Links column.
 *
 * OCC filing counts match the modal's behavior:
 * - Direct matches: all relief types for the exact section
 * - Adjacent matches: HORIZONTAL_WELL, INCREASED_DENSITY, POOLING for 8 neighboring sections
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { fetchAllAirtableRecords, getUserFromSession } from '../services/airtable.js';
import { BASE_ID, PROPERTIES_TABLE } from '../constants.js';
import type { Env } from '../index';

// Section grid layout (boustrophedon pattern) - same as docket-entries.ts
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
 * e.g., "12N" -> { num: 12, dir: 'N' }
 */
function parseTownship(township: string): { num: number; dir: string } | null {
  const match = township.match(/^(\d+)([NS])$/i);
  if (!match) return null;
  return { num: parseInt(match[1]), dir: match[2].toUpperCase() };
}

/**
 * Parse range string to get number and direction
 * e.g., "8W" -> { num: 8, dir: 'W' }
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
 * For edge sections, includes adjacent sections in neighboring townships/ranges
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
    const southRowSections = [31, 32, 33, 34, 35, 36];
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
 * Normalize township format for comparison
 * "7N" -> "7N", "7 N" -> "7N", "07N" -> "7N"
 */
function normalizeTownship(twn: string | null): string | null {
  if (!twn) return null;
  const match = twn.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([NS])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : twn.toUpperCase();
}

/**
 * Normalize range format for comparison
 * "4W" -> "4W", "4 W" -> "4W", "04W" -> "4W"
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

const BATCH_SIZE_D1 = 75; // Larger batch to reduce round trips

// Document types that show on property modals (same as property-documents-d1.ts)
const PROPERTY_DOC_TYPES = [
  'mineral_deed', 'royalty_deed', 'assignment_of_interest', 'warranty_deed', 'quitclaim_deed',
  'oil_gas_lease', 'extension_agreement', 'amendment', 'ratification', 'release',
  'affidavit', 'probate', 'power_of_attorney', 'judgment',
  'division_order', 'transfer_order', 'revenue_statement',
  'pooling_order', 'spacing_order', 'occ_order', 'increased_density_order', 'location_exception_order',
  'unitization_order', 'multi_unit_horizontal_order', 'change_of_operator_order', 'well_transfer'
];

interface LinkCounts {
  [propertyId: string]: {
    wells: number;
    documents: number;
    filings: number;
  };
}

interface PropertySTR {
  propId: string;
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

const PROPERTIES_CACHE_TTL = 300; // 5 minutes in seconds

/**
 * Get cached properties or fetch from Airtable and cache
 */
async function getCachedProperties(
  env: Env,
  cacheKey: string,
  propertiesFilter: string
): Promise<any[] | null> {
  // Try to get from cache
  try {
    const cached = await env.OCC_CACHE.get(cacheKey);
    if (cached) {
      console.log('[LinkCounts] Using cached properties');
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error('[LinkCounts] Cache read error:', err);
  }

  // Fetch from Airtable
  const properties = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter);

  // Cache the result
  if (properties && properties.length > 0) {
    try {
      await env.OCC_CACHE.put(cacheKey, JSON.stringify(properties), { expirationTtl: PROPERTIES_CACHE_TTL });
      console.log('[LinkCounts] Cached', properties.length, 'properties');
    } catch (err) {
      console.error('[LinkCounts] Cache write error:', err);
    }
  }

  return properties;
}

/**
 * Fetch well counts from D1
 */
async function fetchWellCounts(
  env: Env,
  propertyIds: string[]
): Promise<Map<string, number>> {
  const wellCounts = new Map<string, number>();
  const batches = chunk(propertyIds, BATCH_SIZE_D1);

  const batchPromises = batches.map(async (batch) => {
    try {
      const placeholders = batch.map(() => '?').join(', ');
      const query = `
        SELECT property_airtable_id, COUNT(*) as count
        FROM property_well_links
        WHERE property_airtable_id IN (${placeholders})
          AND status = 'Active'
        GROUP BY property_airtable_id
      `;
      const result = await env.WELLS_DB.prepare(query).bind(...batch).all();
      return result.results as { property_airtable_id: string; count: number }[] || [];
    } catch (err) {
      console.error('[LinkCounts] Error fetching well links:', err);
      return [];
    }
  });

  const results = await Promise.all(batchPromises);
  for (const rows of results) {
    for (const row of rows) {
      wellCounts.set(row.property_airtable_id, row.count);
    }
  }

  return wellCounts;
}

/**
 * Fetch document counts from D1
 */
async function fetchDocumentCounts(
  env: Env,
  propertyIds: string[]
): Promise<Map<string, number>> {
  const docCounts = new Map<string, number>();
  const batches = chunk(propertyIds, BATCH_SIZE_D1);
  const docTypeList = PROPERTY_DOC_TYPES.map(type => `'${type}'`).join(', ');

  const batchPromises = batches.map(async (batch) => {
    try {
      const placeholders = batch.map(() => '?').join(', ');
      const query = `
        SELECT property_id, COUNT(*) as count
        FROM documents
        WHERE property_id IN (${placeholders})
          AND (deleted_at IS NULL OR deleted_at = '')
          AND doc_type IN (${docTypeList})
        GROUP BY property_id
      `;
      const result = await env.WELLS_DB.prepare(query).bind(...batch).all();
      return result.results as { property_id: string; count: number }[] || [];
    } catch (err) {
      console.error('[LinkCounts] Error fetching document counts:', err);
      return [];
    }
  });

  const results = await Promise.all(batchPromises);
  for (const rows of results) {
    for (const row of rows) {
      docCounts.set(row.property_id, row.count);
    }
  }

  return docCounts;
}

/**
 * Fetch OCC filing counts from D1 (direct + adjacent sections)
 */
async function fetchOCCFilingCounts(
  env: Env,
  propertySTRs: PropertySTR[]
): Promise<Map<string, number>> {
  const filingCounts = new Map<string, number>();

  if (propertySTRs.length === 0) return filingCounts;

  // Initialize all properties to 0
  for (const pstr of propertySTRs) {
    filingCounts.set(pstr.propId, 0);
  }

  // Build maps for direct and adjacent STR lookups
  const directSTRMap: Map<string, string[]> = new Map();
  const adjacentSTRMap: Map<string, string[]> = new Map();

  for (const pstr of propertySTRs) {
    const directKey = `${pstr.sec}|${pstr.twn}|${pstr.rng}`;

    if (!directSTRMap.has(directKey)) {
      directSTRMap.set(directKey, []);
    }
    directSTRMap.get(directKey)!.push(pstr.propId);

    const adjacentLocations = getAdjacentLocations(pstr.sec, pstr.twn, pstr.rng);
    for (const loc of adjacentLocations) {
      const adjKey = `${loc.section}|${loc.township}|${loc.range}`;
      if (!adjacentSTRMap.has(adjKey)) {
        adjacentSTRMap.set(adjKey, []);
      }
      adjacentSTRMap.get(adjKey)!.push(pstr.propId);
    }
  }

  // Get all unique STR keys
  const allSTRKeys = new Set([...directSTRMap.keys(), ...adjacentSTRMap.keys()]);
  const allSTRList = Array.from(allSTRKeys).map(key => {
    const [sec, twn, rng] = key.split('|');
    return { sec: parseInt(sec), twn, rng, key };
  });

  console.log('[LinkCounts] Querying', directSTRMap.size, 'direct +', adjacentSTRMap.size, 'adjacent STR locations');

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
      console.error('[LinkCounts] Error querying OCC filings:', err);
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
      const directProps = directSTRMap.get(strKey) || [];
      for (const propId of directProps) {
        filingCounts.set(propId, (filingCounts.get(propId) || 0) + row.count);
      }

      // Adjacent matches: only specific relief types
      if (['HORIZONTAL_WELL', 'INCREASED_DENSITY', 'POOLING'].includes(reliefType)) {
        const adjacentProps = adjacentSTRMap.get(strKey) || [];
        for (const propId of adjacentProps) {
          if (!directProps.includes(propId)) {
            filingCounts.set(propId, (filingCounts.get(propId) || 0) + row.count);
          }
        }
      }
    }
  }

  // Also check additional_sections JSON (parallelized)
  const directBatches = chunk(Array.from(directSTRMap.entries()), BATCH_SIZE_D1);
  const additionalBatchPromises = directBatches.map(async (batch) => {
    try {
      const likeConditions = batch.map(([key]) => {
        const [sec, twn, rng] = key.split('|');
        return `additional_sections LIKE '%"section":"${sec}"%"township":"${twn}"%"range":"${rng}"%'`;
      }).join(' OR ');

      const query = `
        SELECT additional_sections, COUNT(*) as count
        FROM occ_docket_entries
        WHERE (${likeConditions})
        GROUP BY additional_sections
      `;
      const result = await env.WELLS_DB.prepare(query).all();
      return { results: result.results as { additional_sections: string; count: number }[] || [], batch };
    } catch (err) {
      console.error('[LinkCounts] Error querying additional sections:', err);
      return { results: [], batch };
    }
  });

  const additionalResults = await Promise.all(additionalBatchPromises);

  for (const { results: rows } of additionalResults) {
    for (const row of rows) {
      try {
        const sections = JSON.parse(row.additional_sections || '[]');
        for (const section of sections) {
          const normSec = normalizeSection(section.section);
          const normTwn = normalizeTownship(section.township);
          const normRng = normalizeRange(section.range);
          if (normSec !== null && normTwn && normRng) {
            const strKey = `${normSec}|${normTwn}|${normRng}`;
            const propIds = directSTRMap.get(strKey) || [];
            for (const propId of propIds) {
              filingCounts.set(propId, (filingCounts.get(propId) || 0) + row.count);
            }
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  return filingCounts;
}

/**
 * Get link counts for all properties belonging to the authenticated user
 * Matches modal behavior: direct + adjacent section filings
 *
 * Optimizations:
 * - Properties cached in KV for 5 minutes (user/org-specific)
 * - Wells, documents, and OCC queries run in parallel
 * - D1 batches run in parallel within each category
 */
export async function handleGetPropertyLinkCounts(request: Request, env: Env) {
  const start = Date.now();
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const counts: LinkCounts = {};

  try {
    const userRecord = await getUserFromSession(env, user);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    // Build cache key and filter
    const organizationId = userRecord.fields.Organization?.[0];
    const cacheKey = `link-counts:properties:${organizationId || user.id}`;
    let propertiesFilter: string;

    if (organizationId) {
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
        { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
      );

      if (orgResponse.ok) {
        const org = await orgResponse.json() as any;
        propertiesFilter = `{Organization} = '${org.fields.Name}'`;
      } else {
        propertiesFilter = `FIND("${user.email}", ARRAYJOIN({User})) > 0`;
      }
    } else {
      propertiesFilter = `FIND("${user.email}", ARRAYJOIN({User})) > 0`;
    }

    // Get properties (cached or fresh)
    const properties = await getCachedProperties(env, cacheKey, propertiesFilter);
    console.log('[LinkCounts] Found', properties?.length || 0, 'properties');

    if (!properties || properties.length === 0) {
      return jsonResponse(counts);
    }

    // Initialize counts and build property STR list
    const propertySTRs: PropertySTR[] = [];
    const propertyIds: string[] = [];

    for (const prop of properties) {
      counts[prop.id] = { wells: 0, documents: 0, filings: 0 };
      propertyIds.push(prop.id);

      const sec = normalizeSection(prop.fields?.SEC);
      const twn = normalizeTownship(prop.fields?.TWN);
      const rng = normalizeRange(prop.fields?.RNG);

      if (sec !== null && twn && rng) {
        propertySTRs.push({ propId: prop.id, sec, twn, rng });
      }
    }

    // Run all three query types in parallel
    const [wellCounts, docCounts, filingCounts] = await Promise.all([
      fetchWellCounts(env, propertyIds),
      fetchDocumentCounts(env, propertyIds),
      fetchOCCFilingCounts(env, propertySTRs)
    ]);

    // Merge results into counts
    for (const propId of propertyIds) {
      counts[propId].wells = wellCounts.get(propId) || 0;
      counts[propId].documents = docCounts.get(propId) || 0;
      counts[propId].filings = filingCounts.get(propId) || 0;
    }

    // Log summary
    const withFilings = Object.entries(counts).filter(([_, c]) => c.filings > 0);
    const withWells = Object.entries(counts).filter(([_, c]) => c.wells > 0);
    const withDocs = Object.entries(counts).filter(([_, c]) => c.documents > 0);
    console.log(`[LinkCounts] Done in ${Date.now() - start}ms. Filings: ${withFilings.length}, Wells: ${withWells.length}, Docs: ${withDocs.length}`);

    return jsonResponse(counts);

  } catch (err) {
    console.error('[LinkCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get link counts' }, 500);
  }
}
