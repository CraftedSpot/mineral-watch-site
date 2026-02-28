/**
 * Dashboard Counts Handler
 *
 * Lightweight endpoint returning just well and document counts for the usage bar.
 * Called eagerly on page load so counts display immediately even with lazy tab loading.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserFromSession } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import type { Env } from '../types/env';

export async function handleGetDashboardCounts(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const userRecord = await getUserFromSession(env, user);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const organizationId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, organizationId);

    const wellOwner = buildOwnershipFilter('cw', organizationId, user.id, memberIds);
    const docOwner = buildOwnershipFilter('d', organizationId, user.id, memberIds);

    const [wellResult, docResult] = await env.WELLS_DB.batch([
      env.WELLS_DB.prepare(
        `SELECT COUNT(*) as cnt FROM client_wells cw WHERE ${wellOwner.where}`
      ).bind(...wellOwner.params),
      env.WELLS_DB.prepare(
        `SELECT COUNT(*) as cnt FROM documents d WHERE ${docOwner.where} AND (deleted_at IS NULL OR deleted_at = '')`
      ).bind(...docOwner.params),
    ]);

    return jsonResponse({
      wells: (wellResult.results as any[])[0]?.cnt || 0,
      documents: (docResult.results as any[])[0]?.cnt || 0,
    });
  } catch (err) {
    console.error('[DashboardCounts] Error:', err);
    return jsonResponse({ error: 'Failed to get counts' }, 500);
  }
}
