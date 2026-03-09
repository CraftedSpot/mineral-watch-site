/**
 * Current Owner Interest Handlers
 *
 * Edit interest fields on chain_current_owners rows.
 * - PUT: Update interest_text/interest_decimal/interest_type, set is_manual = 1
 * - DELETE /manual: Revert to auto-extracted values via edge rebuild
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds } from '../utils/ownership.js';
import type { Env } from '../types/env.js';

/** Verify property ownership, return airtableId or error response */
async function verifyPropertyOwnership(propertyId: string, request: Request, env: Env) {
  const authUser = await authenticateRequest(request, env);
  if (!authUser) return { error: jsonResponse({ error: 'Unauthorized' }, 401) };

  const userRecord = await getUserByIdD1First(env, authUser.id);
  if (!userRecord) return { error: jsonResponse({ error: 'User not found' }, 404) };

  const userOrgId = userRecord.fields.Organization?.[0];
  const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
  const propResult = await env.WELLS_DB.prepare(
    `SELECT airtable_record_id, user_id, organization_id FROM properties
     WHERE airtable_record_id = ? OR id = ? LIMIT 1`
  ).bind(bareId, propertyId).first<any>();

  if (!propResult) return { error: jsonResponse({ error: 'Property not found' }, 404) };

  const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
  const propUserId = propResult.user_id;
  const propOrgId = propResult.organization_id;
  const isOwner = propUserId === authUser.id ||
    (userOrgId && (propOrgId === userOrgId || (memberIds || []).includes(propUserId)));
  if (!isOwner) return { error: jsonResponse({ error: 'Access denied' }, 403) };

  return { airtableId: propResult.airtable_record_id as string };
}

/**
 * PUT /api/property/:propertyId/current-owners/:ownerId
 * Body: { interest_text?, interest_decimal?, interest_type? }
 */
export async function handleUpdateCurrentOwnerInterest(
  propertyId: string, ownerId: number, request: Request, env: Env
): Promise<Response> {
  try {
    const result = await verifyPropertyOwnership(propertyId, request, env);
    if ('error' in result) return result.error;
    const { airtableId } = result;

    const body = await request.json() as {
      interest_text?: string;
      interest_decimal?: number | null;
      interest_type?: string | null;
    };

    // Verify owner row exists for this property
    const ownerRow = await env.WELLS_DB.prepare(
      `SELECT id FROM chain_current_owners WHERE id = ? AND property_id = ?`
    ).bind(ownerId, airtableId).first<any>();

    if (!ownerRow) return jsonResponse({ error: 'Current owner not found' }, 404);

    // Update interest fields + mark as manual
    await env.WELLS_DB.prepare(`
      UPDATE chain_current_owners
      SET interest_text = ?, interest_decimal = ?, interest_type = ?, is_manual = 1
      WHERE id = ? AND property_id = ?
    `).bind(
      body.interest_text ?? null,
      body.interest_decimal ?? null,
      body.interest_type ?? null,
      ownerId,
      airtableId,
    ).run();

    // Invalidate cache (no edge rebuild needed — editing owner directly)
    await env.WELLS_DB.prepare(
      `DELETE FROM chain_tree_cache WHERE property_id = ?`
    ).bind(airtableId).run();

    return jsonResponse({
      success: true,
      updated: {
        id: ownerId,
        interest_text: body.interest_text ?? null,
        interest_decimal: body.interest_decimal ?? null,
        interest_type: body.interest_type ?? null,
        is_manual: 1,
      },
    });
  } catch (error) {
    console.error('[CurrentOwners] Update error:', error);
    return jsonResponse({ error: 'Failed to update current owner interest' }, 500);
  }
}

/**
 * DELETE /api/property/:propertyId/current-owners/:ownerId/manual
 * Revert manual interest edit — set is_manual = 0, trigger edge rebuild to restore auto-extracted values.
 */
export async function handleRevertCurrentOwnerInterest(
  propertyId: string, ownerId: number, request: Request, env: Env
): Promise<Response> {
  try {
    const result = await verifyPropertyOwnership(propertyId, request, env);
    if ('error' in result) return result.error;
    const { airtableId } = result;

    // Verify owner row exists and is manual
    const ownerRow = await env.WELLS_DB.prepare(
      `SELECT id, is_manual FROM chain_current_owners WHERE id = ? AND property_id = ?`
    ).bind(ownerId, airtableId).first<any>();

    if (!ownerRow) return jsonResponse({ error: 'Current owner not found' }, 404);
    if (!ownerRow.is_manual) return jsonResponse({ error: 'Owner interest is not manually edited' }, 400);

    // Set is_manual = 0 so the edge rebuild will delete and recreate with auto-extracted values
    await env.WELLS_DB.prepare(
      `UPDATE chain_current_owners SET is_manual = 0 WHERE id = ?`
    ).bind(ownerId).run();

    // Invalidate cache
    await env.WELLS_DB.prepare(
      `DELETE FROM chain_tree_cache WHERE property_id = ?`
    ).bind(airtableId).run();

    // Trigger edge rebuild — rebuild will DELETE is_manual=0 rows then INSERT OR IGNORE with auto-extracted values
    if (env.DOCUMENTS_WORKER) {
      try {
        await env.DOCUMENTS_WORKER.fetch(new Request('https://internal/api/internal/build-chain-edges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ property_id: airtableId }),
        }));
      } catch (err) {
        console.error(`[CurrentOwners] Edge rebuild failed for ${airtableId}:`, err);
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[CurrentOwners] Revert error:', error);
    return jsonResponse({ error: 'Failed to revert current owner interest' }, 500);
  }
}
