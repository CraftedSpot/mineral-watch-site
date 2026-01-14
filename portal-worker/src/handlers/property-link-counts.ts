/**
 * Property Link Counts Handler
 *
 * Returns counts of linked wells, documents, and OCC filings for all properties.
 * Used by the dashboard to populate the Links column.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { fetchAllAirtableRecords } from '../services/airtable.js';
import { BASE_ID, PROPERTIES_TABLE } from '../constants.js';
import type { Env } from '../index';

const LINKS_TABLE = '🔗 Property-Well Links';

interface LinkCounts {
  [propertyId: string]: {
    wells: number;
    documents: number;
    filings: number;
  };
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
    // 1. Get all properties for this user (to get their STR locations)
    const propertiesFilter = user.organizationId
      ? `OR({User} = "${user.id}", FIND("${user.organizationId}", ARRAYJOIN({Organization})) > 0)`
      : `{User} = "${user.id}"`;

    const properties = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter);

    if (!properties || properties.length === 0) {
      return jsonResponse(counts);
    }

    // Initialize counts for all properties
    for (const prop of properties) {
      counts[prop.id] = { wells: 0, documents: 0, filings: 0 };
    }

    // 2. Get well counts from Property-Well Links table
    // Query all links for these properties
    const propertyIds = properties.map(p => p.id);
    const linksFilter = `OR(${propertyIds.map(id => `FIND("${id}", ARRAYJOIN({Property})) > 0`).join(',')})`;

    try {
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
      console.error('[LinkCounts] Error fetching well links:', err);
    }

    // 3. Get OCC filing counts from D1 (batch query)
    // Build a single query that counts filings by STR
    const strConditions: string[] = [];
    const strToPropertyMap: Map<string, string[]> = new Map();

    for (const prop of properties) {
      const f = prop.fields;
      const sec = f.SEC?.toString();
      const twn = f.TWN?.toString()?.toUpperCase();
      const rng = f.RNG?.toString()?.toUpperCase();

      if (sec && twn && rng) {
        const strKey = `${sec}|${twn}|${rng}`;
        if (!strToPropertyMap.has(strKey)) {
          strToPropertyMap.set(strKey, []);
          strConditions.push(`(CAST(section AS INTEGER) = ${parseInt(sec, 10)} AND UPPER(township) = '${twn}' AND UPPER(range) = '${rng}')`);
        }
        strToPropertyMap.get(strKey)!.push(prop.id);
      }
    }

    if (strConditions.length > 0) {
      try {
        // Query filing counts grouped by STR
        const filingsQuery = `
          SELECT
            CAST(section AS TEXT) as sec,
            UPPER(township) as twn,
            UPPER(range) as rng,
            COUNT(*) as count
          FROM occ_docket_entries
          WHERE (${strConditions.join(' OR ')})
            AND relief_type IN ('POOLING', 'INCREASED_DENSITY', 'SPACING', 'HORIZONTAL_WELL',
                               'LOCATION_EXCEPTION', 'OPERATOR_CHANGE', 'WELL_TRANSFER', 'ORDER_MODIFICATION')
          GROUP BY CAST(section AS INTEGER), UPPER(township), UPPER(range)
        `;

        const filingsResult = await env.WELLS_DB.prepare(filingsQuery).all();

        if (filingsResult.results) {
          for (const row of filingsResult.results as { sec: string; twn: string; rng: string; count: number }[]) {
            const strKey = `${row.sec}|${row.twn}|${row.rng}`;
            const propertyIds = strToPropertyMap.get(strKey) || [];
            for (const propId of propertyIds) {
              if (counts[propId]) {
                counts[propId].filings = row.count;
              }
            }
          }
        }

        // Also check additional_sections for multi-section orders
        // This is a secondary pass that adds to existing counts
        for (const prop of properties) {
          const f = prop.fields;
          const sec = f.SEC?.toString();
          const twn = f.TWN?.toString()?.toUpperCase();
          const rng = f.RNG?.toString()?.toUpperCase();

          if (sec && twn && rng) {
            const jsonPattern = `%"section":"${sec}"%"township":"${twn}"%"range":"${rng}"%`;
            const additionalQuery = `
              SELECT COUNT(*) as count
              FROM occ_docket_entries
              WHERE additional_sections LIKE ?
                AND relief_type IN ('POOLING', 'INCREASED_DENSITY', 'SPACING', 'HORIZONTAL_WELL',
                                   'LOCATION_EXCEPTION', 'OPERATOR_CHANGE', 'WELL_TRANSFER', 'ORDER_MODIFICATION')
            `;
            const additionalResult = await env.WELLS_DB.prepare(additionalQuery).bind(jsonPattern).first<{ count: number }>();
            if (additionalResult && additionalResult.count > 0) {
              counts[prop.id].filings += additionalResult.count;
            }
          }
        }
      } catch (err) {
        console.error('[LinkCounts] Error querying OCC filings:', err);
      }
    }

    // 4. Document counts - check if documents table exists and query
    // Documents are typically linked by property STR in the documents table
    // For now, we'll leave documents at 0 and implement when document linking is confirmed
    // TODO: Add document count query when document-property linking model is confirmed

    return jsonResponse(counts);

  } catch (err) {
    console.error('[LinkCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get link counts' }, 500);
  }
}
