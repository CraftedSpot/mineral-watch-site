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

const LINKS_TABLE = '🔗 Property-Well Links';
const BATCH_SIZE_AIRTABLE = 30;
const BATCH_SIZE_D1 = 25; // Smaller batch for more complex queries

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

/**
 * Get link counts for all properties belonging to the authenticated user
 * Matches modal behavior: direct + adjacent section filings
 */
export async function handleGetPropertyLinkCounts(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const counts: LinkCounts = {};

  try {
    const userRecord = await getUserFromSession(env, user);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    // Build filter matching handleListProperties logic
    let propertiesFilter: string;
    const organizationId = userRecord.fields.Organization?.[0];

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

    const properties = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter);
    console.log('[LinkCounts] Found', properties?.length || 0, 'properties');

    if (!properties || properties.length === 0) {
      return jsonResponse(counts);
    }

    // Initialize counts and build property STR list
    const propertySTRs: PropertySTR[] = [];
    for (const prop of properties) {
      counts[prop.id] = { wells: 0, documents: 0, filings: 0 };

      const sec = normalizeSection(prop.fields?.SEC);
      const twn = normalizeTownship(prop.fields?.TWN);
      const rng = normalizeRange(prop.fields?.RNG);

      if (sec !== null && twn && rng) {
        propertySTRs.push({ propId: prop.id, sec, twn, rng });
      }
    }

    // =====================================================
    // WELL COUNTS - from Property-Well Links table
    // =====================================================
    const propertyIds = properties.map(p => p.id);
    const propertyIdBatches = chunk(propertyIds, BATCH_SIZE_AIRTABLE);

    for (const batch of propertyIdBatches) {
      try {
        const linksFilter = `OR(${batch.map(id => `FIND("${id}", ARRAYJOIN({Property})) > 0`).join(',')})`;
        const links = await fetchAllAirtableRecords(env, LINKS_TABLE, linksFilter);
        for (const link of links || []) {
          for (const propId of link.fields?.Property || []) {
            if (counts[propId]) counts[propId].wells++;
          }
        }
      } catch (err) {
        console.error('[LinkCounts] Error fetching well links:', err);
      }
    }

    // =====================================================
    // OCC FILING COUNTS - Direct + Adjacent (matching modal)
    // =====================================================
    if (propertySTRs.length > 0) {
      // Build maps for direct and adjacent STR lookups
      // Direct: propId -> STR key
      // Adjacent: STR key -> list of propIds (for adjacent section matching)
      const directSTRMap: Map<string, string[]> = new Map(); // strKey -> propIds (for direct matches)
      const adjacentSTRMap: Map<string, string[]> = new Map(); // strKey -> propIds (properties where this is an adjacent section)

      for (const pstr of propertySTRs) {
        const directKey = `${pstr.sec}|${pstr.twn}|${pstr.rng}`;

        // Add to direct map
        if (!directSTRMap.has(directKey)) {
          directSTRMap.set(directKey, []);
        }
        directSTRMap.get(directKey)!.push(pstr.propId);

        // Get adjacent sections and add to adjacent map
        const adjacentSections = getAdjacentSectionsInTownship(pstr.sec);
        for (const adjSec of adjacentSections) {
          const adjKey = `${adjSec}|${pstr.twn}|${pstr.rng}`;
          if (!adjacentSTRMap.has(adjKey)) {
            adjacentSTRMap.set(adjKey, []);
          }
          adjacentSTRMap.get(adjKey)!.push(pstr.propId);
        }
      }

      // Get all unique STR keys (both direct and adjacent)
      const allSTRKeys = new Set([...directSTRMap.keys(), ...adjacentSTRMap.keys()]);
      const allSTRList = Array.from(allSTRKeys).map(key => {
        const [sec, twn, rng] = key.split('|');
        return { sec: parseInt(sec), twn, rng, key };
      });

      console.log('[LinkCounts] Querying', directSTRMap.size, 'direct +', adjacentSTRMap.size, 'adjacent STR locations');

      // Query in batches
      const strBatches = chunk(allSTRList, BATCH_SIZE_D1);

      for (const batch of strBatches) {
        try {
          // Build query for this batch - get counts by STR and relief_type
          const whereConditions = batch.map(
            ({ sec, twn, rng }) => `(section = '${sec}' AND UPPER(township) = '${twn}' AND UPPER(range) = '${rng}')`
          ).join(' OR ');

          const query = `
            SELECT
              section as sec,
              township as twn,
              range as rng,
              relief_type,
              COUNT(*) as count
            FROM occ_docket_entries
            WHERE (${whereConditions})
            GROUP BY section, township, range, relief_type
          `;

          const result = await env.WELLS_DB.prepare(query).all();

          if (result.results) {
            for (const row of result.results as { sec: string; twn: string; rng: string; relief_type: string; count: number }[]) {
              const normSec = normalizeSection(row.sec);
              const normTwn = normalizeTownship(row.twn);
              const normRng = normalizeRange(row.rng);

              if (normSec === null || !normTwn || !normRng) continue;

              const strKey = `${normSec}|${normTwn}|${normRng}`;
              const reliefType = row.relief_type;

              // Check if this is a direct match for any properties
              const directProps = directSTRMap.get(strKey) || [];
              for (const propId of directProps) {
                // Direct matches: count ALL relief types
                counts[propId].filings += row.count;
              }

              // Check if this is an adjacent match for any properties
              // Only count specific relief types for adjacent sections
              if (['HORIZONTAL_WELL', 'INCREASED_DENSITY', 'POOLING'].includes(reliefType)) {
                const adjacentProps = adjacentSTRMap.get(strKey) || [];
                for (const propId of adjacentProps) {
                  // Don't double-count if this property also has this as a direct match
                  if (!directProps.includes(propId)) {
                    counts[propId].filings += row.count;
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error('[LinkCounts] Error querying OCC filings:', err);
        }
      }

      // Also check additional_sections JSON for multi-section orders
      const directBatches = chunk(Array.from(directSTRMap.entries()), BATCH_SIZE_D1);
      for (const batch of directBatches) {
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

          if (result.results) {
            for (const row of result.results as { additional_sections: string; count: number }[]) {
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
                      counts[propId].filings += row.count;
                    }
                  }
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } catch (err) {
          console.error('[LinkCounts] Error querying additional sections:', err);
        }
      }
    }

    // =====================================================
    // DOCUMENT COUNTS - from D1 documents table
    // =====================================================
    if (propertySTRs.length > 0) {
      const strBatches = chunk(propertySTRs, BATCH_SIZE_D1);

      for (const batch of strBatches) {
        try {
          const whereConditions = batch.map(
            ({ sec, twn, rng }) => `(CAST(section AS INTEGER) = ${sec} AND UPPER(township) = '${twn}' AND UPPER(range) = '${rng}')`
          ).join(' OR ');

          const query = `
            SELECT section as sec, township as twn, range as rng, COUNT(*) as count
            FROM documents
            WHERE (${whereConditions}) AND deleted_at IS NULL
            GROUP BY section, township, range
          `;

          const result = await env.DOCUMENTS_DB.prepare(query).all();

          if (result.results) {
            for (const row of result.results as { sec: string; twn: string; rng: string; count: number }[]) {
              const normSec = normalizeSection(row.sec);
              const normTwn = normalizeTownship(row.twn);
              const normRng = normalizeRange(row.rng);
              if (normSec !== null && normTwn && normRng) {
                const strKey = `${normSec}|${normTwn}|${normRng}`;
                // Find matching properties
                for (const pstr of batch) {
                  if (pstr.sec === normSec && pstr.twn === normTwn && pstr.rng === normRng) {
                    counts[pstr.propId].documents = row.count;
                  }
                }
              }
            }
          }
        } catch (err) {
          console.log('[LinkCounts] Document count query skipped');
          break;
        }
      }
    }

    // Log summary
    const withFilings = Object.entries(counts).filter(([_, c]) => c.filings > 0);
    const withWells = Object.entries(counts).filter(([_, c]) => c.wells > 0);
    console.log('[LinkCounts] Done. With filings:', withFilings.length, 'With wells:', withWells.length);
    console.log('[LinkCounts] Sample with filings:', withFilings.slice(0, 3));

    return jsonResponse(counts);

  } catch (err) {
    console.error('[LinkCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get link counts' }, 500);
  }
}
