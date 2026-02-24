/**
 * Well Link Counts Handler
 *
 * Returns counts of linked properties, documents, and OCC filings for all wells.
 * Used by the dashboard to populate the Links column in the Wells grid.
 *
 * D1-first: Wells loaded from D1 client_wells (same source as /api/wells/v2).
 * No Airtable dependency.
 *
 * Data sources:
 * - Properties: D1 property_well_links by well_airtable_id
 * - Documents: D1 documents joined with client_wells/wells by API number
 * - OCC Filings: D1 occ_docket_entries by unit sections (PUN-scoped: all wells in the production unit)
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { BATCH_SIZE_D1 } from '../constants.js';
import { normalizeTownship, normalizeRange, normalizeSection, chunk } from '../utils/str-normalize.js';
import type { Env } from '../types/env';

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

interface WellLocation {
  sec: number;
  twn: string;
  rng: string;
}

interface WellFilingData {
  wellId: string;
  apiNumber: string;
  locations: WellLocation[];  // surface + bottom hole (deduplicated)
}

/**
 * Fetch property counts from D1
 */
async function fetchPropertyCounts(
  env: Env,
  wellIds: string[]
): Promise<{ data: Map<string, number>; hadErrors: boolean }> {
  const propertyCounts = new Map<string, number>();
  let hadErrors = false;
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
      hadErrors = true;
      return [];
    }
  });

  const results = await Promise.all(batchPromises);
  for (const rows of results) {
    for (const row of rows) {
      propertyCounts.set(row.well_airtable_id, row.count);
    }
  }

  return { data: propertyCounts, hadErrors };
}

/**
 * Fetch document counts from D1 by API number
 */
async function fetchDocumentCounts(
  env: Env,
  apiNumbers: string[],
  apiToWellId: Map<string, string>
): Promise<{ data: Map<string, number>; hadErrors: boolean }> {
  const docCounts = new Map<string, number>();
  let hadErrors = false;
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
      hadErrors = true;
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

  // Step 2: Count documents per well (batched — single query per chunk instead of per-well)
  // Each record ID needs 4 bind params (exact + 3 LIKE patterns for comma-separated well_id)
  // D1 limit: 100 params → 25 IDs per batch
  const recordIds = Array.from(recordIdToApi.keys());
  const idBatches = chunk(recordIds, 25);

  const countPromises = idBatches.map(async (batch) => {
    try {
      // Build combined OR conditions for all record IDs in this batch
      const conditions = batch.map(() =>
        `(well_id = ? OR well_id LIKE ? OR well_id LIKE ? OR well_id LIKE ?)`
      ).join(' OR ');

      const bindings = batch.flatMap(id => [
        id,           // exact match (single-well doc)
        `${id},%`,    // first in comma-separated list
        `%,${id}`,    // last in comma-separated list
        `%,${id},%`   // middle of comma-separated list
      ]);

      const rows = await env.WELLS_DB.prepare(`
        SELECT well_id FROM documents
        WHERE (${conditions})
          AND (deleted_at IS NULL OR deleted_at = '')
          AND doc_type IN (${docTypeList})
      `).bind(...bindings).all();

      // Parse comma-separated well_ids and count per record ID
      const batchSet = new Set(batch);
      const counts = new Map<string, number>();
      for (const row of (rows.results || [])) {
        const ids = (row.well_id as string).split(',').map(s => s.trim());
        for (const id of ids) {
          if (batchSet.has(id)) {
            counts.set(id, (counts.get(id) || 0) + 1);
          }
        }
      }

      return Array.from(counts.entries()).map(([recordId, count]) => ({ recordId, count }));
    } catch (err) {
      console.error('[WellLinkCounts] Error fetching document counts:', err);
      hadErrors = true;
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

  return { data: docCounts, hadErrors };
}

/**
 * Fetch OCC filing counts using PUN-scoped (unit-centric) counting.
 *
 * Each well's filing locations are expanded to include ALL sections covered by
 * the well's production unit (PUN). This matches the modal's behavior:
 * if a sibling well in your unit has an OCC filing, it affects your check.
 *
 * Uses three match paths:
 * 1. STR matching (expanded unit sections) against occ_docket_entries
 * 2. API number matching against occ_docket_entries.api_numbers JSON
 * 3. Junction table matching against docket_entry_sections
 *
 * DISTINCT case_number deduplicates across all paths.
 */
async function fetchOCCFilingCounts(
  env: Env,
  wellData: WellFilingData[]
): Promise<{ data: Map<string, number>; hadErrors: boolean }> {
  const filingCounts = new Map<string, number>();
  let hadErrors = false;

  if (wellData.length === 0) return { data: filingCounts, hadErrors };

  // Initialize all wells to 0
  for (const wd of wellData) {
    filingCounts.set(wd.wellId, 0);
  }

  // === PUN EXPANSION: Get unit footprint for each well ===
  // Step 1: Look up PUNs for all user wells
  const apiToWellIdLocal = new Map<string, string>();
  const apisWithData: string[] = [];
  for (const wd of wellData) {
    if (wd.apiNumber) {
      apiToWellIdLocal.set(wd.apiNumber, wd.wellId);
      apisWithData.push(wd.apiNumber);
    }
  }

  const wellToPuns = new Map<string, Set<string>>();
  const allPuns = new Set<string>();

  if (apisWithData.length > 0) {
    const punBatches = chunk(apisWithData, 90);
    const punResults = await Promise.all(punBatches.map(async (batch) => {
      try {
        const ph = batch.map(() => '?').join(', ');
        const r = await env.WELLS_DB.prepare(
          `SELECT api_number, pun FROM well_pun_links WHERE api_number IN (${ph})`
        ).bind(...batch).all();
        return (r.results || []) as { api_number: string; pun: string }[];
      } catch (err) {
        console.error('[WellLinkCounts] Error fetching PUNs:', err);
        hadErrors = true;
        return [];
      }
    }));

    for (const rows of punResults) {
      for (const row of rows) {
        const wellId = apiToWellIdLocal.get(row.api_number);
        if (wellId) {
          if (!wellToPuns.has(wellId)) wellToPuns.set(wellId, new Set());
          wellToPuns.get(wellId)!.add(row.pun);
          allPuns.add(row.pun);
        }
      }
    }
  }

  // Step 2: Get all sibling well locations for those PUNs
  // Split into two fast indexed queries instead of one slow OR+SUBSTR JOIN
  const punToLocations = new Map<string, WellLocation[]>();

  if (allPuns.size > 0) {
    const punArray = Array.from(allPuns);

    // Step 2a: Get all sibling API numbers from well_pun_links (indexed on pun)
    const sibApiBatches = chunk(punArray, 90);
    const sibApiResults = await Promise.all(sibApiBatches.map(async (batch) => {
      try {
        const ph = batch.map(() => '?').join(', ');
        const r = await env.WELLS_DB.prepare(
          `SELECT api_number, pun FROM well_pun_links WHERE pun IN (${ph})`
        ).bind(...batch).all();
        return (r.results || []) as { api_number: string; pun: string }[];
      } catch (err) {
        console.error('[WellLinkCounts] Error fetching PUN sibling APIs:', err);
        hadErrors = true;
        return [];
      }
    }));

    // Build api→puns map for sibling wells
    const sibApiToPuns = new Map<string, string[]>();
    for (const rows of sibApiResults) {
      for (const row of rows) {
        if (!sibApiToPuns.has(row.api_number)) sibApiToPuns.set(row.api_number, []);
        sibApiToPuns.get(row.api_number)!.push(row.pun);
      }
    }

    // Step 2b: Look up locations for sibling APIs from wells table (indexed on api_number)
    const sibApiList = Array.from(sibApiToPuns.keys());
    const locBatches = chunk(sibApiList, 90);
    const locResults = await Promise.all(locBatches.map(async (batch) => {
      try {
        const ph = batch.map(() => '?').join(', ');
        const r = await env.WELLS_DB.prepare(`
          SELECT api_number, section, township, range, bh_section, bh_township, bh_range
          FROM wells WHERE api_number IN (${ph})
        `).bind(...batch).all();
        return (r.results || []) as any[];
      } catch (err) {
        console.error('[WellLinkCounts] Error fetching sibling well locations:', err);
        hadErrors = true;
        return [];
      }
    }));

    for (const rows of locResults) {
      for (const row of rows) {
        const puns = sibApiToPuns.get(row.api_number) || [];
        for (const pun of puns) {
          if (!punToLocations.has(pun)) punToLocations.set(pun, []);
          const locs = punToLocations.get(pun)!;

          const sec = normalizeSection(row.section);
          const twn = normalizeTownship(row.township);
          const rng = normalizeRange(row.range);
          if (sec !== null && twn && rng) locs.push({ sec, twn, rng });

          const bhSec = normalizeSection(row.bh_section);
          const bhTwn = normalizeTownship(row.bh_township);
          const bhRng = normalizeRange(row.bh_range);
          if (bhSec !== null && bhTwn && bhRng) locs.push({ sec: bhSec, twn: bhTwn, rng: bhRng });
        }
      }
    }
  }

  // Step 3: Build expanded locations per well (own sections + PUN sibling sections)
  const expandedWellData: WellFilingData[] = [];
  let totalExpanded = 0;

  for (const wd of wellData) {
    const locSet = new Set<string>();
    const expandedLocs: WellLocation[] = [];

    // Add well's own locations
    for (const loc of wd.locations) {
      const key = `${loc.sec}|${loc.twn}|${loc.rng}`;
      if (!locSet.has(key)) { locSet.add(key); expandedLocs.push(loc); }
    }

    // Add PUN sibling locations
    const puns = wellToPuns.get(wd.wellId);
    if (puns) {
      for (const pun of puns) {
        for (const loc of (punToLocations.get(pun) || [])) {
          const key = `${loc.sec}|${loc.twn}|${loc.rng}`;
          if (!locSet.has(key)) { locSet.add(key); expandedLocs.push(loc); }
        }
      }
    }

    if (expandedLocs.length > wd.locations.length) totalExpanded++;
    expandedWellData.push({ wellId: wd.wellId, apiNumber: wd.apiNumber, locations: expandedLocs });
  }

  console.log(`[WellLinkCounts] PUN expansion: ${wellToPuns.size} wells have PUNs, ${allPuns.size} unique PUNs, ${totalExpanded} wells gained extra sections`);

  // === FILING QUERIES (3 paths with expanded unit locations) ===

  // Build STR→wellIds map (expanded unit locations)
  const strToWellIds: Map<string, string[]> = new Map();
  for (const wd of expandedWellData) {
    for (const loc of wd.locations) {
      const key = `${loc.sec}|${loc.twn}|${loc.rng}`;
      if (!strToWellIds.has(key)) strToWellIds.set(key, []);
      strToWellIds.get(key)!.push(wd.wellId);
    }
  }

  // Build API→wellIds map (for API number matching)
  const apiToWellIds: Map<string, string> = new Map();
  for (const wd of expandedWellData) {
    if (wd.apiNumber) apiToWellIds.set(wd.apiNumber, wd.wellId);
  }

  // Collect case_numbers per wellId using a Set for dedup
  const wellCaseNumbers: Map<string, Set<string>> = new Map();
  for (const wd of expandedWellData) {
    wellCaseNumbers.set(wd.wellId, new Set());
  }

  const uniqueSTRs = Array.from(strToWellIds.keys()).map(key => {
    const [sec, twn, rng] = key.split('|');
    return { sec: parseInt(sec), twn, rng, key };
  });

  const uniqueApis = Array.from(apiToWellIds.keys());

  console.log(`[WellLinkCounts] Filing query: ${uniqueSTRs.length} STR locations (${totalExpanded} PUN-expanded), ${uniqueApis.length} API numbers`);

  // --- Path 1: STR matching against occ_docket_entries (surface + BH) ---
  const strBatches = chunk(uniqueSTRs, BATCH_SIZE_D1);
  const strPromises = strBatches.map(async (batch) => {
    try {
      const conditions = batch.map(() =>
        `(CAST(section AS INTEGER) = ? AND UPPER(township) = ? AND UPPER(range) = ?)`
      ).join(' OR ');
      const bindings = batch.flatMap(({ sec, twn, rng }) => [sec, twn, rng]);

      const result = await env.WELLS_DB.prepare(`
        SELECT case_number, section as sec, township as twn, range as rng
        FROM occ_docket_entries
        WHERE (${conditions})
      `).bind(...bindings).all();
      return result.results as { case_number: string; sec: string; twn: string; rng: string }[] || [];
    } catch (err) {
      console.error('[WellLinkCounts] Error querying OCC filings (STR):', err);
      hadErrors = true;
      return [];
    }
  });

  // --- Path 2: API number matching against occ_docket_entries.api_numbers ---
  // api_numbers is stored as JSON array like ["049-24518","035-20123"]
  // Use INSTR to find API substrings in the JSON text. Batch by 50 (2 params each = 100 max).
  const apiBatches = chunk(uniqueApis, 50);
  const apiPromises = apiBatches.map(async (batch) => {
    try {
      const conditions = batch.map(() => `INSTR(api_numbers, ?) > 0`).join(' OR ');
      const result = await env.WELLS_DB.prepare(`
        SELECT case_number, api_numbers
        FROM occ_docket_entries
        WHERE api_numbers IS NOT NULL AND (${conditions})
      `).bind(...batch).all();
      return result.results as { case_number: string; api_numbers: string }[] || [];
    } catch (err) {
      console.error('[WellLinkCounts] Error querying OCC filings (API):', err);
      hadErrors = true;
      return [];
    }
  });

  // --- Path 3: Junction table (docket_entry_sections) matching ---
  const junctionBatches = chunk(uniqueSTRs, BATCH_SIZE_D1);
  const junctionPromises = junctionBatches.map(async (batch) => {
    try {
      const conditions = batch.map(() =>
        `(CAST(section AS INTEGER) = ? AND UPPER(township) = ? AND UPPER(range) = ?)`
      ).join(' OR ');
      const bindings = batch.flatMap(({ sec, twn, rng }) => [sec, twn, rng]);

      const result = await env.WELLS_DB.prepare(`
        SELECT case_number, section as sec, township as twn, range as rng
        FROM docket_entry_sections
        WHERE (${conditions})
      `).bind(...bindings).all();
      return result.results as { case_number: string; sec: string; twn: string; rng: string }[] || [];
    } catch (err) {
      console.error('[WellLinkCounts] Error querying docket_entry_sections:', err);
      hadErrors = true;
      return [];
    }
  });

  // Run all three paths in parallel
  const [strResults, apiResults, junctionResults] = await Promise.all([
    Promise.all(strPromises),
    Promise.all(apiPromises),
    Promise.all(junctionPromises)
  ]);

  // Process Path 1 results: STR matches
  for (const rows of strResults) {
    for (const row of rows) {
      const normSec = normalizeSection(row.sec);
      const normTwn = normalizeTownship(row.twn);
      const normRng = normalizeRange(row.rng);
      if (normSec === null || !normTwn || !normRng) continue;

      const strKey = `${normSec}|${normTwn}|${normRng}`;
      const wellIds = strToWellIds.get(strKey) || [];
      for (const wellId of wellIds) {
        wellCaseNumbers.get(wellId)!.add(row.case_number);
      }
    }
  }

  // Process Path 2 results: API number matches
  for (const rows of apiResults) {
    for (const row of rows) {
      // Parse api_numbers JSON and match against our well API numbers
      try {
        const apis: string[] = JSON.parse(row.api_numbers);
        for (const api of apis) {
          const wellId = apiToWellIds.get(api);
          if (wellId) {
            wellCaseNumbers.get(wellId)!.add(row.case_number);
          }
        }
      } catch {
        // Malformed JSON — try substring match as fallback
        for (const [api, wellId] of apiToWellIds) {
          if (row.api_numbers.includes(api)) {
            wellCaseNumbers.get(wellId)!.add(row.case_number);
          }
        }
      }
    }
  }

  // Process Path 3 results: Junction table matches
  for (const rows of junctionResults) {
    for (const row of rows) {
      const normSec = normalizeSection(row.sec);
      const normTwn = normalizeTownship(row.twn);
      const normRng = normalizeRange(row.rng);
      if (normSec === null || !normTwn || !normRng) continue;

      const strKey = `${normSec}|${normTwn}|${normRng}`;
      const wellIds = strToWellIds.get(strKey) || [];
      for (const wellId of wellIds) {
        wellCaseNumbers.get(wellId)!.add(row.case_number);
      }
    }
  }

  // Convert Sets to counts
  for (const [wellId, cases] of wellCaseNumbers) {
    filingCounts.set(wellId, cases.size);
  }

  const wellsWithFilings = wellData.filter(wd => filingCounts.get(wd.wellId)! > 0).length;
  const totalFilings = Array.from(filingCounts.values()).reduce((a, b) => a + b, 0);
  console.log(`[WellLinkCounts] Filing results: ${wellsWithFilings} wells with filings, ${totalFilings} total case matches`);

  return { data: filingCounts, hadErrors };
}

/**
 * Get link counts for all wells belonging to the authenticated user
 *
 * D1-first: Loads wells from D1 client_wells (same as /api/wells/v2).
 * No Airtable dependency.
 *
 * Optimizations:
 * - Properties, documents, and OCC queries run in parallel
 * - D1 batches run in parallel within each category
 */
export async function handleGetWellLinkCounts(request: Request, env: Env) {
  const start = Date.now();
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const tAuth = Date.now();

  const counts: LinkCounts = {};

  try {
    // Get user record (D1-first) for org membership
    const userRecord = await getUserByIdD1First(env, user.id);
    const organizationId = userRecord?.fields.Organization?.[0];
    const tSession = Date.now();

    // Query wells from D1 (same ownership pattern as /api/wells/v2)
    const whereClause = organizationId
      ? `WHERE (cw.organization_id = ? OR cw.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `WHERE cw.user_id = ?`;
    const bindParams = organizationId ? [organizationId, organizationId] : [user.id];

    const wellsResult = await env.WELLS_DB!.prepare(`
      SELECT cw.airtable_id, cw.api_number, cw.section, cw.township, cw.range_val,
             w.section AS occ_section, w.township AS occ_township, w.range AS occ_range,
             w.bh_section, w.bh_township, w.bh_range
      FROM client_wells cw
      LEFT JOIN wells w ON w.api_number = cw.api_number
      ${whereClause}
    `).bind(...bindParams).all();

    const wells = wellsResult.results || [];
    const tWellsFetch = Date.now();
    console.log(`[WellLinkCounts timing] auth=${tAuth-start}ms session=${tSession-tAuth}ms wellsFetch=${tWellsFetch-tSession}ms (${wells.length} wells)`);

    if (wells.length === 0) {
      return jsonResponse(counts);
    }

    // Initialize counts and collect data for parallel queries
    const wellFilingData: WellFilingData[] = [];
    const wellIds: string[] = [];
    const apiNumbers: string[] = [];
    const apiToWellId: Map<string, string> = new Map();

    for (const row of wells as any[]) {
      const wellId = row.airtable_id; // Matches V2 response id field
      if (!wellId) continue;

      counts[wellId] = { properties: 0, documents: 0, filings: 0 };
      wellIds.push(wellId);

      if (row.api_number) {
        apiNumbers.push(row.api_number);
        apiToWellId.set(row.api_number, wellId);
      }

      // Collect all STR locations for this well (surface + bottom hole)
      const locations: WellLocation[] = [];

      // Surface location: prefer OCC well data, fall back to client_wells
      const sec = normalizeSection(row.occ_section ?? row.section);
      const twn = normalizeTownship(row.occ_township ?? row.township);
      const rng = normalizeRange(row.occ_range ?? row.range_val);
      if (sec !== null && twn && rng) {
        locations.push({ sec, twn, rng });
      }

      // Bottom hole location (for horizontals — different section than surface)
      const bhSec = normalizeSection(row.bh_section);
      const bhTwn = normalizeTownship(row.bh_township);
      const bhRng = normalizeRange(row.bh_range);
      if (bhSec !== null && bhTwn && bhRng) {
        // Only add if different from surface location
        const isDuplicate = sec === bhSec && twn === bhTwn && rng === bhRng;
        if (!isDuplicate) {
          locations.push({ sec: bhSec, twn: bhTwn, rng: bhRng });
        }
      }

      if (locations.length > 0 || row.api_number) {
        wellFilingData.push({ wellId, apiNumber: row.api_number || '', locations });
      }
    }

    // Run all three query types in parallel
    const tD1Start = Date.now();
    const [propertyResult, docResult, filingResult] = await Promise.all([
      fetchPropertyCounts(env, wellIds),
      fetchDocumentCounts(env, apiNumbers, apiToWellId),
      fetchOCCFilingCounts(env, wellFilingData)
    ]);
    const tD1End = Date.now();

    // Merge results into counts
    for (const wellId of wellIds) {
      counts[wellId].properties = propertyResult.data.get(wellId) || 0;
      counts[wellId].documents = docResult.data.get(wellId) || 0;
      counts[wellId].filings = filingResult.data.get(wellId) || 0;
    }

    // Track if any queries had errors — frontend can show "counts may be incomplete"
    const hadErrors = propertyResult.hadErrors || docResult.hadErrors || filingResult.hadErrors;

    // Log summary
    const withProperties = Object.entries(counts).filter(([_, c]) => c.properties > 0);
    const withDocs = Object.entries(counts).filter(([_, c]) => c.documents > 0);
    const withFilings = Object.entries(counts).filter(([_, c]) => c.filings > 0);
    console.log(`[WellLinkCounts timing] d1Queries=${tD1End-tD1Start}ms TOTAL=${Date.now()-start}ms. Properties: ${withProperties.length}, Docs: ${withDocs.length}, Filings: ${withFilings.length}${hadErrors ? ' (PARTIAL - some queries failed)' : ''}`);

    // If any batch queries failed, include _partial flag so frontend
    // can show a subtle indicator instead of displaying silent zeros
    if (hadErrors) {
      return jsonResponse({ ...counts, _partial: true });
    }
    return jsonResponse(counts);

  } catch (err) {
    console.error('[WellLinkCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get link counts' }, 500);
  }
}
