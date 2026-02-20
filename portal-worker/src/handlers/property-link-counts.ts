/**
 * Property Link Counts Handler
 *
 * Returns denormalized counts of linked wells, documents, and OCC filings
 * for all properties. Counts are stored directly on the properties table
 * and kept accurate via write-time increments (wells) and periodic
 * reconciliation in the sync cron (all 3 counts every 15 min).
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserFromSession } from '../services/airtable.js';
import type { Env } from '../index';

interface LinkCounts {
  [propertyId: string]: {
    wells: number;
    documents: number;
    filings: number;
  };
}

/**
 * Get link counts for all properties belonging to the authenticated user.
 * Reads denormalized counts directly from the properties table — single query, no batching.
 */
export async function handleGetPropertyLinkCounts(request: Request, env: Env) {
  const start = Date.now();
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const counts: LinkCounts = {};

  try {
    const userRecord = await getUserFromSession(env, user);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const organizationId = userRecord.fields.Organization?.[0];

    // Single D1 query — org members see all properties belonging to any user in the org
    const whereClause = organizationId
      ? `WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `WHERE user_id = ?`;
    const bindParams = organizationId ? [organizationId, organizationId] : [user.id];

    const result = await env.WELLS_DB.prepare(`
      SELECT airtable_record_id, id, well_count, document_count, filing_count
      FROM properties
      ${whereClause}
    `).bind(...bindParams).all();

    for (const row of result.results as any[]) {
      const propId = row.airtable_record_id || row.id;
      counts[propId] = {
        wells: row.well_count || 0,
        documents: row.document_count || 0,
        filings: row.filing_count || 0,
      };
    }

    console.log(`[LinkCounts] Done in ${Date.now() - start}ms. ${result.results.length} properties (denormalized)`);
    return jsonResponse(counts);

  } catch (err) {
    console.error('[LinkCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get link counts' }, 500);
  }
}
