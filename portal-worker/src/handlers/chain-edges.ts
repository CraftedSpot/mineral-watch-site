/**
 * Chain Edge API Handlers
 *
 * Manual edge management for chain-of-title tree:
 * - POST link/unlink edges between documents
 * - GET edges for a property (admin/debug)
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import type { Env } from '../types/env.js';

/**
 * POST /api/property/:propertyId/chain-edges
 * Body: { parent_doc_id, child_doc_id, action: 'link' | 'unlink' }
 */
export async function handleManageChainEdge(propertyId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    // Verify property ownership
    const userOrgId = userRecord.fields.Organization?.[0];
    const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
    const propResult = await env.WELLS_DB.prepare(
      `SELECT airtable_record_id, user_id, organization_id FROM properties
       WHERE airtable_record_id = ? OR id = ? LIMIT 1`
    ).bind(bareId, propertyId).first<any>();

    if (!propResult) return jsonResponse({ error: 'Property not found' }, 404);

    // Ownership check
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const propUserId = propResult.user_id;
    const propOrgId = propResult.organization_id;
    const isOwner = propUserId === authUser.id ||
      (userOrgId && (propOrgId === userOrgId || (memberIds || []).includes(propUserId)));
    if (!isOwner) return jsonResponse({ error: 'Access denied' }, 403);

    const airtableId = propResult.airtable_record_id;
    const body = await request.json() as {
      parent_doc_id?: string;
      child_doc_id?: string;
      action?: 'link' | 'unlink';
    };

    if (!body.parent_doc_id || !body.child_doc_id || !body.action) {
      return jsonResponse({ error: 'parent_doc_id, child_doc_id, and action required' }, 400);
    }

    if (body.action === 'link') {
      // Insert manual edge
      await env.WELLS_DB.prepare(`
        INSERT OR REPLACE INTO document_chain_edges
          (property_id, parent_doc_id, child_doc_id, match_type, match_confidence, is_manual)
        VALUES (?, ?, ?, 'manual', 1.0, 1)
      `).bind(airtableId, body.parent_doc_id, body.child_doc_id).run();
    } else if (body.action === 'unlink') {
      // Delete edge (even auto-generated ones)
      await env.WELLS_DB.prepare(`
        DELETE FROM document_chain_edges
        WHERE parent_doc_id = ? AND child_doc_id = ?
      `).bind(body.parent_doc_id, body.child_doc_id).run();
    } else {
      return jsonResponse({ error: 'action must be "link" or "unlink"' }, 400);
    }

    // Invalidate tree cache
    await env.WELLS_DB.prepare(
      `UPDATE chain_tree_cache SET invalidated_at = datetime('now') WHERE property_id = ?`
    ).bind(airtableId).run();

    return jsonResponse({ success: true, action: body.action });
  } catch (error) {
    console.error('[ChainEdges] Manage error:', error);
    return jsonResponse({ error: 'Failed to manage chain edge' }, 500);
  }
}

/**
 * GET /api/property/:propertyId/chain-edges
 * Returns raw edges for debugging/admin. Optional ?include_orphans=1.
 */
export async function handleGetChainEdges(propertyId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
    const propResult = await env.WELLS_DB.prepare(
      `SELECT airtable_record_id FROM properties
       WHERE airtable_record_id = ? OR id = ? LIMIT 1`
    ).bind(bareId, propertyId).first<any>();

    if (!propResult) return jsonResponse({ error: 'Property not found' }, 404);
    const airtableId = propResult.airtable_record_id;

    const edgesResult = await env.WELLS_DB.prepare(
      `SELECT * FROM document_chain_edges WHERE property_id = ? ORDER BY created_at`
    ).bind(airtableId).all();

    const ownersResult = await env.WELLS_DB.prepare(
      `SELECT * FROM chain_current_owners WHERE property_id = ? ORDER BY owner_name`
    ).bind(airtableId).all();

    const url = new URL(request.url);
    let orphanDocIds: string[] = [];

    if (url.searchParams.get('include_orphans') === '1') {
      const userOrgId = userRecord.fields.Organization?.[0];
      const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
      const docOwner = buildOwnershipFilter('d', userOrgId, authUser.id, memberIds, { includeUserId: true });

      const startsWithPattern = `${airtableId},%`;
      const endsWithPattern = `%,${airtableId}`;
      const containsPattern = `%,${airtableId},%`;

      const allDocsResult = await env.WELLS_DB.prepare(`
        SELECT d.id FROM documents d
        WHERE d.chain_of_title = 1
          AND (d.deleted_at IS NULL OR d.deleted_at = '')
          AND d.status = 'complete'
          AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
          AND (d.property_id = ? OR d.property_id LIKE ? OR d.property_id LIKE ? OR d.property_id LIKE ?)
          AND ${docOwner.where}
      `).bind(airtableId, startsWithPattern, endsWithPattern, containsPattern, ...docOwner.params).all();

      const allDocIds = new Set((allDocsResult.results as any[]).map(r => r.id));
      const edgeDocIds = new Set<string>();
      for (const edge of edgesResult.results as any[]) {
        edgeDocIds.add(edge.parent_doc_id);
        edgeDocIds.add(edge.child_doc_id);
      }
      orphanDocIds = [...allDocIds].filter(id => !edgeDocIds.has(id));
    }

    return jsonResponse({
      success: true,
      edges: edgesResult.results,
      currentOwners: ownersResult.results,
      orphanDocIds: orphanDocIds.length > 0 ? orphanDocIds : undefined,
    });
  } catch (error) {
    console.error('[ChainEdges] Get error:', error);
    return jsonResponse({ error: 'Failed to fetch chain edges' }, 500);
  }
}

/**
 * POST /api/property/:propertyId/mark-root
 * Body: { doc_id: string }
 * Designates an orphan as a manual chain root.
 */
export async function handleMarkRoot(propertyId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
    const propResult = await env.WELLS_DB.prepare(
      `SELECT airtable_record_id, user_id, organization_id FROM properties
       WHERE airtable_record_id = ? OR id = ? LIMIT 1`
    ).bind(bareId, propertyId).first<any>();

    if (!propResult) return jsonResponse({ error: 'Property not found' }, 404);

    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const propUserId = propResult.user_id;
    const propOrgId = propResult.organization_id;
    const isOwner = propUserId === authUser.id ||
      (userOrgId && (propOrgId === userOrgId || (memberIds || []).includes(propUserId)));
    if (!isOwner) return jsonResponse({ error: 'Access denied' }, 403);

    const airtableId = propResult.airtable_record_id;
    const body = await request.json() as { doc_id?: string };
    if (!body.doc_id) return jsonResponse({ error: 'doc_id required' }, 400);

    await env.WELLS_DB.prepare(
      `INSERT OR IGNORE INTO chain_manual_roots (property_id, doc_id) VALUES (?, ?)`
    ).bind(airtableId, body.doc_id).run();

    // Invalidate tree cache
    await env.WELLS_DB.prepare(
      `UPDATE chain_tree_cache SET invalidated_at = datetime('now') WHERE property_id = ?`
    ).bind(airtableId).run();

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[ChainEdges] Mark root error:', error);
    return jsonResponse({ error: 'Failed to mark as root' }, 500);
  }
}

/**
 * POST /api/property/:propertyId/unmark-root
 * Body: { doc_id: string }
 * Removes manual chain root designation.
 */
export async function handleUnmarkRoot(propertyId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
    const propResult = await env.WELLS_DB.prepare(
      `SELECT airtable_record_id, user_id, organization_id FROM properties
       WHERE airtable_record_id = ? OR id = ? LIMIT 1`
    ).bind(bareId, propertyId).first<any>();

    if (!propResult) return jsonResponse({ error: 'Property not found' }, 404);

    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const propUserId = propResult.user_id;
    const propOrgId = propResult.organization_id;
    const isOwner = propUserId === authUser.id ||
      (userOrgId && (propOrgId === userOrgId || (memberIds || []).includes(propUserId)));
    if (!isOwner) return jsonResponse({ error: 'Access denied' }, 403);

    const airtableId = propResult.airtable_record_id;
    const body = await request.json() as { doc_id?: string };
    if (!body.doc_id) return jsonResponse({ error: 'doc_id required' }, 400);

    await env.WELLS_DB.prepare(
      `DELETE FROM chain_manual_roots WHERE property_id = ? AND doc_id = ?`
    ).bind(airtableId, body.doc_id).run();

    // Invalidate tree cache
    await env.WELLS_DB.prepare(
      `UPDATE chain_tree_cache SET invalidated_at = datetime('now') WHERE property_id = ?`
    ).bind(airtableId).run();

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[ChainEdges] Unmark root error:', error);
    return jsonResponse({ error: 'Failed to unmark root' }, 500);
  }
}
