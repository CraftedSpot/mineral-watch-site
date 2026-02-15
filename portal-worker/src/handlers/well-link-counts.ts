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
import { getAdjacentLocations } from '../utils/property-well-matching.js';
import { escapeAirtableValue } from '../utils/airtable-escape.js';
import type { Env } from '../index';

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

const BATCH_SIZE_D1 = 30; // D1 limit: 100 bound params; STR queries use 3 per item
const WELLS_CACHE_TTL = 300; // 5 minutes

// Document types that show on well modals (keep in sync with property-documents-d1.ts WELL_DOC_TYPES)
const WELL_DOC_TYPES = [
  'completion_report', 'drilling_permit', 'plugging_report', 'well_log',
  'production_report', 'regulatory_filing', 'occ_order', 'division_order',
  'transfer_order', 'revenue_statement', 'check_stub'
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
          AND status IN ('Active', 'Linked')
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
  const filteredApis = apiNumbers.filter(a => a);
  const docTypeList = WELL_DOC_TYPES.map(type => `'${type}'`).join(', ');

  // Step 1: Batch-resolve API numbers to record IDs via client_wells and statewide wells
  const apiToRecordId = new Map<string, string>();
  const recordIdToApi = new Map<string, string>();
  const apiBatches = chunk(filteredApis, BATCH_SIZE_D1);

  const resolvePromises = apiBatches.map(async (batch) => {
    const results: { api_number: string; record_id: string }[] = [];
    try {
      const placeholders = batch.map(() => '?').join(', ');
      // Try client_wells first (airtable_id — matches documents linked via client_wells)
      const clientResult = await env.WELLS_DB.prepare(
        `SELECT api_number, airtable_id as record_id FROM client_wells WHERE api_number IN (${placeholders})`
      ).bind(...batch).all();
      if (clientResult.results) {
        for (const row of clientResult.results as any[]) {
          if (row.record_id) results.push({ api_number: row.api_number, record_id: row.record_id });
        }
      }
      // Also check statewide wells table (airtable_record_id — matches documents linked via wells)
      const wellsResult = await env.WELLS_DB.prepare(
        `SELECT api_number, airtable_record_id as record_id FROM wells WHERE api_number IN (${placeholders})`
      ).bind(...batch).all();
      if (wellsResult.results) {
        for (const row of wellsResult.results as any[]) {
          if (row.record_id) results.push({ api_number: row.api_number, record_id: row.record_id });
        }
      }
    } catch (err) {
      console.error('[WellLinkCounts] Error resolving API to record IDs:', err);
    }
    return results;
  });

  const resolveResults = await Promise.all(resolvePromises);
  for (const rows of resolveResults) {
    for (const row of rows) {
      apiToRecordId.set(row.api_number, row.record_id);
      recordIdToApi.set(row.record_id, row.api_number);
    }
  }

  // Step 2: Count documents per well using LIKE patterns (supports comma-separated well_id)
  const recordIds = Array.from(recordIdToApi.keys());
  const idBatches = chunk(recordIds, 25); // Smaller batches — each ID generates 4 WHERE conditions

  const countPromises = idBatches.map(async (batch) => {
    try {
      // Count documents for each well individually within the batch
      const results: { recordId: string; count: number }[] = [];
      for (const recordId of batch) {
        const startsWithPattern = `${recordId},%`;
        const endsWithPattern = `%,${recordId}`;
        const containsPattern = `%,${recordId},%`;

        const row = await env.WELLS_DB.prepare(`
          SELECT COUNT(*) as count FROM documents
          WHERE (well_id = ? OR well_id LIKE ? OR well_id LIKE ? OR well_id LIKE ?)
            AND (deleted_at IS NULL OR deleted_at = '')
            AND doc_type IN (${docTypeList})
        `).bind(recordId, startsWithPattern, endsWithPattern, containsPattern).first();

        if (row && (row.count as number) > 0) {
          results.push({ recordId, count: row.count as number });
        }
      }
      return results;
    } catch (err) {
      console.error('[WellLinkCounts] Error fetching document counts:', err);
      return [];
    }
  });

  const countResults = await Promise.all(countPromises);
  for (const rows of countResults) {
    for (const { recordId, count } of rows) {
      const api = recordIdToApi.get(recordId);
      if (api) {
        const wellId = apiToWellId.get(api);
        if (wellId) {
          docCounts.set(wellId, count);
        }
      }
    }
  }

  return docCounts;
}

/**
 * Fetch OCC filing counts from D1 (direct section only - no adjacent)
 * This matches the well modal behavior which now uses PUN-based queries
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

  // Build map for direct STR lookups only (no adjacent)
  const directSTRMap: Map<string, string[]> = new Map();

  for (const wstr of wellSTRs) {
    const directKey = `${wstr.sec}|${wstr.twn}|${wstr.rng}`;

    if (!directSTRMap.has(directKey)) {
      directSTRMap.set(directKey, []);
    }
    directSTRMap.get(directKey)!.push(wstr.wellId);
  }

  // Get all unique direct STR keys
  const allSTRList = Array.from(directSTRMap.keys()).map(key => {
    const [sec, twn, rng] = key.split('|');
    return { sec: parseInt(sec), twn, rng, key };
  });

  console.log('[WellLinkCounts] Querying', directSTRMap.size, 'direct STR locations (no adjacent)');

  // Query OCC entries in batches (parallelized)
  const strBatches = chunk(allSTRList, BATCH_SIZE_D1);
  const strBatchPromises = strBatches.map(async (batch) => {
    try {
      const whereConditions = batch.map(() =>
        `(section = ? AND UPPER(township) = ? AND UPPER(range) = ?)`
      ).join(' OR ');
      const whereBindings = batch.flatMap(({ sec, twn, rng }) => [String(sec), twn, rng]);

      const query = `
        SELECT section as sec, township as twn, range as rng, COUNT(*) as count
        FROM occ_docket_entries
        WHERE (${whereConditions})
        GROUP BY section, township, range
      `;
      const result = await env.WELLS_DB.prepare(query).bind(...whereBindings).all();
      return result.results as { sec: string; twn: string; rng: string; count: number }[] || [];
    } catch (err) {
      console.error('[WellLinkCounts] Error querying OCC filings:', err);
      return [];
    }
  });

  const strResults = await Promise.all(strBatchPromises);

  // Process results - direct matches only
  for (const rows of strResults) {
    for (const row of rows) {
      const normSec = normalizeSection(row.sec);
      const normTwn = normalizeTownship(row.twn);
      const normRng = normalizeRange(row.rng);

      if (normSec === null || !normTwn || !normRng) continue;

      const strKey = `${normSec}|${normTwn}|${normRng}`;

      // Direct matches only
      const directWells = directSTRMap.get(strKey) || [];
      for (const wellId of directWells) {
        filingCounts.set(wellId, (filingCounts.get(wellId) || 0) + row.count);
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

    const userEmail = escapeAirtableValue(user.email);

    if (organizationId) {
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
        { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
      );

      if (orgResponse.ok) {
        const org = await orgResponse.json() as any;
        const orgName = escapeAirtableValue(org.fields.Name || '');
        const orgFind = `FIND('${orgName}', ARRAYJOIN({Organization}))`;
        const userFind = `FIND('${userEmail}', ARRAYJOIN({User}))`;
        wellsFilter = `OR(${orgFind} > 0, ${userFind} > 0)`;
      } else {
        wellsFilter = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
      }
    } else {
      wellsFilter = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
    }

    // Get wells (cached or fresh)
    const wells = await getCachedWells(env, cacheKey, wellsFilter);
    console.log('[WellLinkCounts] Found', wells?.length || 0, 'wells');

    if (!wells || wells.length === 0) {
      return jsonResponse(counts);
    }

    // Initialize counts and collect API numbers
    const wellSTRs: WellSTR[] = [];
    const wellIds: string[] = [];
    const apiNumbers: string[] = [];
    const apiToWellId: Map<string, string> = new Map();
    const wellsNeedingTRS: string[] = []; // API numbers that don't have TRS in Airtable

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
      } else if (apiNumber) {
        // Mark for D1 lookup
        wellsNeedingTRS.push(apiNumber);
      }
    }

    // Fetch TRS data from D1 for wells that don't have it in Airtable
    if (wellsNeedingTRS.length > 0) {
      try {
        const trsBatches = chunk(wellsNeedingTRS, BATCH_SIZE_D1);
        const trsPromises = trsBatches.map(async (batch) => {
          const placeholders = batch.map(() => '?').join(', ');
          const result = await env.WELLS_DB.prepare(`
            SELECT api_number, section, township, range
            FROM wells
            WHERE api_number IN (${placeholders})
          `).bind(...batch).all();
          return result.results as { api_number: string; section: number; township: string; range: string }[] || [];
        });
        const trsResults = await Promise.all(trsPromises);

        for (const rows of trsResults) {
          for (const row of rows) {
            const wellId = apiToWellId.get(row.api_number);
            if (wellId) {
              const sec = normalizeSection(row.section);
              const twn = normalizeTownship(row.township);
              const rng = normalizeRange(row.range);
              if (sec !== null && twn && rng) {
                wellSTRs.push({ wellId, apiNumber: row.api_number, sec, twn, rng });
              }
            }
          }
        }
        console.log(`[WellLinkCounts] Fetched TRS from D1 for ${wellsNeedingTRS.length} wells, found ${wellSTRs.length} with valid TRS`);
      } catch (err) {
        console.error('[WellLinkCounts] Error fetching TRS from D1:', err);
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
