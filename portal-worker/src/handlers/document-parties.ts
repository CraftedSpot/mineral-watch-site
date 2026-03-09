/**
 * Document Parties Handler
 *
 * Add, delete (soft/hard), and restore parties on documents.
 * Complements corrections.ts which handles edits to existing party names.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import { normalizePartyName } from '../utils/normalize-party-name.js';
import { invalidateAndRebuild } from '../utils/invalidate-rebuild.js';
import type { Env } from '../types/env.js';

/**
 * POST /api/documents/:id/parties
 * Add a new party to a document.
 * Body: { party_name, party_role }
 */
export async function handleAddDocumentParty(request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const url = new URL(request.url);
    const docIdMatch = url.pathname.match(/^\/api\/documents\/([a-zA-Z0-9_-]+)\/parties$/);
    if (!docIdMatch) return jsonResponse({ error: 'Invalid path' }, 400);
    const documentId = docIdMatch[1];

    const body = await request.json() as any;
    const { party_name, party_role } = body;

    if (!party_name || !party_role) {
      return jsonResponse({ error: 'party_name and party_role are required' }, 400);
    }

    const trimmedName = party_name.trim();
    if (trimmedName.length < 2) {
      return jsonResponse({ error: 'Party name must be at least 2 characters' }, 400);
    }

    // Verify document exists and user has access
    const userRecord = await getUserByIdD1First(env, user.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, user.id, memberIds, { includeUserId: true });

    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.property_id
      FROM documents d
      WHERE d.id = ? AND ${docOwner.where}
    `).bind(documentId, ...docOwner.params).first<any>();

    if (!doc) return jsonResponse({ error: 'Document not found or access denied' }, 404);

    // Insert manual party
    const normalized = normalizePartyName(trimmedName);
    const result = await env.WELLS_DB.prepare(`
      INSERT INTO document_parties (document_id, party_name, party_name_normalized, party_role, is_manual)
      VALUES (?, ?, ?, ?, 1)
    `).bind(documentId, trimmedName, normalized, party_role).run();

    const partyId = result.meta.last_row_id;

    // Invalidate cache + trigger edge rebuild
    await invalidateAndRebuild(env, doc.property_id);

    return jsonResponse({
      success: true,
      party: {
        id: partyId,
        party_name: trimmedName,
        party_name_normalized: normalized,
        party_role,
        is_manual: 1,
      },
    });
  } catch (error) {
    console.error('[DocumentParties] Add error:', error);
    return jsonResponse({ error: 'Failed to add party' }, 500);
  }
}

/**
 * DELETE /api/documents/:id/parties/:partyRowId
 * Delete a party from a document.
 * - Manual parties (is_manual=1): hard DELETE
 * - Extracted parties (is_manual=0): soft-delete (SET is_deleted=1)
 */
export async function handleDeleteDocumentParty(
  documentId: string, partyRowId: string, request: Request, env: Env
): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    // Verify document exists and user has access
    const userRecord = await getUserByIdD1First(env, user.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, user.id, memberIds, { includeUserId: true });

    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.property_id
      FROM documents d
      WHERE d.id = ? AND ${docOwner.where}
    `).bind(documentId, ...docOwner.params).first<any>();

    if (!doc) return jsonResponse({ error: 'Document not found or access denied' }, 404);

    // Check party row exists
    const party = await env.WELLS_DB.prepare(`
      SELECT id, is_manual FROM document_parties
      WHERE id = ? AND document_id = ?
    `).bind(partyRowId, documentId).first<any>();

    if (!party) return jsonResponse({ error: 'Party not found' }, 404);

    if (party.is_manual === 1) {
      // Hard delete user-added party
      await env.WELLS_DB.prepare(`
        DELETE FROM document_parties WHERE id = ? AND document_id = ?
      `).bind(partyRowId, documentId).run();
    } else {
      // Soft-delete extracted party
      await env.WELLS_DB.prepare(`
        UPDATE document_parties SET is_deleted = 1
        WHERE id = ? AND document_id = ?
      `).bind(partyRowId, documentId).run();
    }

    // Clean up any corrections for this party row
    await env.WELLS_DB.prepare(`
      DELETE FROM user_corrections WHERE document_id = ? AND party_row_id = ?
    `).bind(documentId, partyRowId).run();

    // Invalidate cache + trigger edge rebuild
    await invalidateAndRebuild(env, doc.property_id);

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[DocumentParties] Delete error:', error);
    return jsonResponse({ error: 'Failed to delete party' }, 500);
  }
}

/**
 * POST /api/documents/:id/parties/:partyRowId/restore
 * Restore a soft-deleted extracted party.
 */
export async function handleRestoreDocumentParty(
  documentId: string, partyRowId: string, request: Request, env: Env
): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    // Verify document exists and user has access
    const userRecord = await getUserByIdD1First(env, user.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, user.id, memberIds, { includeUserId: true });

    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.property_id
      FROM documents d
      WHERE d.id = ? AND ${docOwner.where}
    `).bind(documentId, ...docOwner.params).first<any>();

    if (!doc) return jsonResponse({ error: 'Document not found or access denied' }, 404);

    // Restore
    await env.WELLS_DB.prepare(`
      UPDATE document_parties SET is_deleted = 0
      WHERE id = ? AND document_id = ?
    `).bind(partyRowId, documentId).run();

    // Invalidate cache + trigger edge rebuild
    await invalidateAndRebuild(env, doc.property_id);

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[DocumentParties] Restore error:', error);
    return jsonResponse({ error: 'Failed to restore party' }, 500);
  }
}
