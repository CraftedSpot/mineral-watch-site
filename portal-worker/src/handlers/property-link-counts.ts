/**
 * Property Link Counts Handler
 *
 * Returns counts of linked wells, documents, and OCC filings for all properties.
 * Used by the dashboard to populate the Links column.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { fetchAllAirtableRecords, getUserFromSession } from '../services/airtable.js';
import { BASE_ID, PROPERTIES_TABLE } from '../constants.js';
import type { Env } from '../index';

/**
 * Normalize township format for comparison (from docket-matching.ts)
 * "7N" -> "7N", "7 N" -> "7N", "07N" -> "7N"
 */
function normalizeTownship(twn: string | null): string | null {
  if (!twn) return null;
  const match = twn.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([NS])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : twn.toUpperCase();
}

/**
 * Normalize range format for comparison (from docket-matching.ts)
 * "4W" -> "4W", "4 W" -> "4W", "04W" -> "4W"
 */
function normalizeRange(rng: string | null): string | null {
  if (!rng) return null;
  const match = rng.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([EW])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : rng.toUpperCase();
}

/**
 * Normalize section to integer (from docket-matching.ts)
 */
function normalizeSection(sec: string | number | null): number | null {
  if (sec === null || sec === undefined) return null;
  const num = parseInt(sec.toString(), 10);
  return isNaN(num) ? null : num;
}

const LINKS_TABLE = '🔗 Property-Well Links';
const BATCH_SIZE_AIRTABLE = 30; // Airtable filter batch size
const BATCH_SIZE_D1 = 30; // D1 OR condition batch size

interface LinkCounts {
  [propertyId: string]: {
    wells: number;
    documents: number;
    filings: number;
  };
}

/**
 * Helper to batch an array into chunks
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Get link counts for all properties belonging to the authenticated user
 *
 * Returns: { [propertyId]: { wells, documents, filings } }
 */
export async function handleGetPropertyLinkCounts(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const counts: LinkCounts = {};

  try {
    // Get full user record to check for organization (same as handleListProperties)
    const userRecord = await getUserFromSession(env, user);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    // Build filter matching handleListProperties logic
    let propertiesFilter: string;
    const organizationId = userRecord.fields.Organization?.[0];

    if (organizationId) {
      // User has organization - get org name for filter
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
        { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
      );

      if (orgResponse.ok) {
        const org = await orgResponse.json() as any;
        const orgName = org.fields.Name;
        propertiesFilter = `{Organization} = '${orgName}'`;
      } else {
        propertiesFilter = `FIND("${user.email}", ARRAYJOIN({User})) > 0`;
      }
    } else {
      propertiesFilter = `FIND("${user.email}", ARRAYJOIN({User})) > 0`;
    }

    const properties = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter);
    console.log('[LinkCounts] Found', properties?.length || 0, 'properties for user', user.id);

    if (!properties || properties.length === 0) {
      return jsonResponse(counts);
    }

    // Initialize counts for all properties
    const propertyIdSet = new Set<string>();
    for (const prop of properties) {
      counts[prop.id] = { wells: 0, documents: 0, filings: 0 };
      propertyIdSet.add(prop.id);
    }

    // 2. Get well counts from Property-Well Links table (batched)
    const propertyIds = properties.map(p => p.id);
    const propertyIdBatches = chunk(propertyIds, BATCH_SIZE_AIRTABLE);

    for (const batch of propertyIdBatches) {
      try {
        const linksFilter = `OR(${batch.map(id => `FIND("${id}", ARRAYJOIN({Property})) > 0`).join(',')})`;
        const links = await fetchAllAirtableRecords(env, LINKS_TABLE, linksFilter);
        for (const link of links || []) {
          const linkedPropertyIds = link.fields?.Property || [];
          for (const propId of linkedPropertyIds) {
            if (counts[propId]) {
              counts[propId].wells++;
            }
          }
        }
      } catch (err) {
        console.error('[LinkCounts] Error fetching well links batch:', err);
      }
    }

    // 3. Get OCC filing counts from D1 (batched)
    // Build STR conditions and map
    const strToPropertyMap: Map<string, string[]> = new Map();
    const strConditions: { sec: number; twn: string; rng: string; strKey: string }[] = [];

    for (const prop of properties) {
      const f = prop.fields;
      const sec = f.SEC?.toString();
      const twn = f.TWN?.toString()?.toUpperCase();
      const rng = f.RNG?.toString()?.toUpperCase();

      if (sec && twn && rng) {
        const strKey = `${sec}|${twn}|${rng}`;
        if (!strToPropertyMap.has(strKey)) {
          strToPropertyMap.set(strKey, []);
          strConditions.push({ sec: parseInt(sec, 10), twn, rng, strKey });
        }
        strToPropertyMap.get(strKey)!.push(prop.id);
      }
    }

    if (strConditions.length > 0) {
      // Batch D1 queries to avoid expression tree depth limit
      const strBatches = chunk(strConditions, BATCH_SIZE_D1);
      console.log('[LinkCounts] Processing', strConditions.length, 'unique STR locations in', strBatches.length, 'batches');
      console.log('[LinkCounts] Sample STR values:', strConditions.slice(0, 5).map(s => `${s.sec}|${s.twn}|${s.rng}`));

      for (const batch of strBatches) {
        try {
          const whereConditions = batch.map(
            ({ sec, twn, rng }) => `(CAST(section AS INTEGER) = ${sec} AND UPPER(township) = '${twn}' AND UPPER(range) = '${rng}')`
          ).join(' OR ');

          const filingsQuery = `
            SELECT
              section as sec,
              township as twn,
              range as rng,
              COUNT(*) as count
            FROM occ_docket_entries
            WHERE (${whereConditions})
              AND relief_type IN ('POOLING', 'INCREASED_DENSITY', 'SPACING', 'HORIZONTAL_WELL',
                                 'LOCATION_EXCEPTION', 'OPERATOR_CHANGE', 'WELL_TRANSFER', 'ORDER_MODIFICATION')
            GROUP BY section, township, range
          `;

          const filingsResult = await env.WELLS_DB.prepare(filingsQuery).all();
          console.log('[LinkCounts] Batch filings query returned:', filingsResult.results?.length || 0, 'results');

          if (filingsResult.results) {
            for (const row of filingsResult.results as { sec: string; twn: string; rng: string; count: number }[]) {
              const strKey = `${row.sec}|${(row.twn || '').toUpperCase()}|${(row.rng || '').toUpperCase()}`;
              const propIds = strToPropertyMap.get(strKey) || [];
              if (propIds.length > 0) {
                console.log('[LinkCounts] Match found: DB row', row.sec, row.twn, row.rng, 'count:', row.count, '-> properties:', propIds.length);
              }
              for (const propId of propIds) {
                if (counts[propId]) {
                  counts[propId].filings = row.count;
                }
              }
            }
          }
        } catch (err) {
          console.error('[LinkCounts] Error querying OCC filings batch:', err);
        }
      }

      // Check additional_sections for multi-section orders (batched)
      // Use a single query with OR conditions for all unique STR patterns
      const additionalBatches = chunk(strConditions, BATCH_SIZE_D1);
      for (const batch of additionalBatches) {
        try {
          // Build LIKE conditions for additional_sections JSON field
          const likeConditions = batch.map(({ sec, twn, rng }) =>
            `additional_sections LIKE '%"section":"${sec}"%"township":"${twn}"%"range":"${rng}"%'`
          ).join(' OR ');

          const additionalQuery = `
            SELECT
              additional_sections,
              COUNT(*) as count
            FROM occ_docket_entries
            WHERE (${likeConditions})
              AND relief_type IN ('POOLING', 'INCREASED_DENSITY', 'SPACING', 'HORIZONTAL_WELL',
                                 'LOCATION_EXCEPTION', 'OPERATOR_CHANGE', 'WELL_TRANSFER', 'ORDER_MODIFICATION')
            GROUP BY additional_sections
          `;

          const additionalResult = await env.WELLS_DB.prepare(additionalQuery).all();

          if (additionalResult.results) {
            for (const row of additionalResult.results as { additional_sections: string; count: number }[]) {
              // Parse the additional_sections JSON and match to properties
              try {
                const sections = JSON.parse(row.additional_sections || '[]');
                for (const section of sections) {
                  const strKey = `${section.section}|${(section.township || '').toUpperCase()}|${(section.range || '').toUpperCase()}`;
                  const propIds = strToPropertyMap.get(strKey) || [];
                  for (const propId of propIds) {
                    if (counts[propId]) {
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
          console.error('[LinkCounts] Error querying additional sections batch:', err);
        }
      }
    }

    // 4. Get document counts from D1 documents table (batched)
    // Documents can be matched by section/township/range
    if (strConditions.length > 0) {
      const docBatches = chunk(strConditions, BATCH_SIZE_D1);

      for (const batch of docBatches) {
        try {
          const whereConditions = batch.map(
            ({ sec, twn, rng }) => `(CAST(section AS INTEGER) = ${sec} AND UPPER(township) = '${twn}' AND UPPER(range) = '${rng}')`
          ).join(' OR ');

          const docsQuery = `
            SELECT
              section as sec,
              township as twn,
              range as rng,
              COUNT(*) as count
            FROM documents
            WHERE (${whereConditions})
              AND deleted_at IS NULL
            GROUP BY section, township, range
          `;

          const docsResult = await env.DOCUMENTS_DB.prepare(docsQuery).all();

          if (docsResult.results) {
            for (const row of docsResult.results as { sec: string; twn: string; rng: string; count: number }[]) {
              const strKey = `${row.sec}|${(row.twn || '').toUpperCase()}|${(row.rng || '').toUpperCase()}`;
              const propIds = strToPropertyMap.get(strKey) || [];
              for (const propId of propIds) {
                if (counts[propId]) {
                  counts[propId].documents = row.count;
                }
              }
            }
          }
        } catch (err) {
          // Documents table may not have section/township/range columns
          // This is expected if document-property linking isn't implemented yet
          console.log('[LinkCounts] Document count query skipped (may not be implemented yet)');
          break; // Don't retry other batches
        }
      }
    }

    console.log('[LinkCounts] Completed. Sample counts:', Object.entries(counts).slice(0, 3));
    return jsonResponse(counts);

  } catch (err) {
    console.error('[LinkCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get link counts' }, 500);
  }
}
