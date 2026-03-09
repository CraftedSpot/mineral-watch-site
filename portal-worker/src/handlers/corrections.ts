/**
 * User Corrections Handler
 *
 * Allows users to correct AI-extracted party names on documents.
 * Corrections target individual party rows (document_parties.id).
 * On save: updates document_parties, invalidates chain cache, triggers edge rebuild.
 * Original AI extraction is preserved in the correction record for undo.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import { normalizePartyName } from '../utils/normalize-party-name.js';
import { invalidateAndRebuild } from '../utils/invalidate-rebuild.js';
import type { Env } from '../types/env.js';

/** Role classification for field label derivation */
const GRANTOR_ROLES = ['grantor', 'lessor', 'assignor'];

/**
 * GET /api/corrections?document_id=xxx
 * Returns corrections for a given document, keyed by party_row_id.
 */
export async function handleGetCorrections(request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const url = new URL(request.url);
    const documentId = url.searchParams.get('document_id');
    if (!documentId) return jsonResponse({ error: 'document_id required' }, 400);

    const result = await env.WELLS_DB.prepare(`
      SELECT id, document_id, field, party_row_id, original_value, corrected_value
      FROM user_corrections
      WHERE document_id = ?
    `).bind(documentId).all();

    // Return keyed by party_row_id
    const corrections: Record<string, { id: string; party_row_id: number; field: string; original: string; corrected: string }> = {};
    for (const row of result.results as any[]) {
      if (row.party_row_id != null) {
        corrections[String(row.party_row_id)] = {
          id: row.id,
          party_row_id: row.party_row_id,
          field: row.field,
          original: row.original_value,
          corrected: row.corrected_value,
        };
      }
    }

    return jsonResponse(corrections);
  } catch (error) {
    console.error('[Corrections] GET error:', error);
    return jsonResponse({ error: 'Failed to fetch corrections' }, 500);
  }
}

/**
 * PUT /api/corrections
 * Create or update a correction for a specific party row.
 * Body: { document_id, party_row_id, corrected_value }
 *
 * After saving:
 * 1. Updates document_parties (party_name + party_name_normalized)
 * 2. Invalidates chain_tree_cache
 * 3. Triggers edge rebuild via DOCUMENTS_WORKER service binding
 */
export async function handleSaveCorrection(request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await request.json() as any;
    const { document_id, party_row_id, corrected_value } = body;

    if (!document_id || party_row_id == null || !corrected_value) {
      return jsonResponse({ error: 'document_id, party_row_id, and corrected_value are required' }, 400);
    }

    const correctedTrimmed = corrected_value.trim();
    if (correctedTrimmed.length < 2) {
      return jsonResponse({ error: 'Corrected value must be at least 2 characters' }, 400);
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
    `).bind(document_id, ...docOwner.params).first<any>();

    if (!doc) return jsonResponse({ error: 'Document not found or access denied' }, 404);

    // Verify party row exists and belongs to this document
    const partyRow = await env.WELLS_DB.prepare(`
      SELECT id, party_name, party_role FROM document_parties
      WHERE id = ? AND document_id = ?
    `).bind(party_row_id, document_id).first<any>();

    if (!partyRow) return jsonResponse({ error: 'Party row not found' }, 404);

    const originalValue = partyRow.party_name;
    const field = GRANTOR_ROLES.includes(partyRow.party_role) ? 'grantor' : 'grantee';

    // Upsert correction
    const id = `corr_${crypto.randomUUID()}`;
    await env.WELLS_DB.prepare(`
      INSERT INTO user_corrections (id, document_id, field, party_row_id, original_value, corrected_value, corrected_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(document_id, party_row_id) DO UPDATE SET
        corrected_value = excluded.corrected_value,
        corrected_by = excluded.corrected_by,
        updated_at = datetime('now')
    `).bind(id, document_id, field, party_row_id, originalValue, correctedTrimmed, user.email).run();

    // Update document_parties with corrected name + normalized form
    const normalizedCorrected = normalizePartyName(correctedTrimmed);
    await env.WELLS_DB.prepare(`
      UPDATE document_parties SET party_name = ?, party_name_normalized = ?
      WHERE id = ? AND document_id = ?
    `).bind(correctedTrimmed, normalizedCorrected, party_row_id, document_id).run();

    // Invalidate cache + trigger edge rebuild
    await invalidateAndRebuild(env, doc.property_id);

    // Fetch the saved correction row
    const saved = await env.WELLS_DB.prepare(`
      SELECT id, party_row_id, original_value, corrected_value
      FROM user_corrections
      WHERE document_id = ? AND party_row_id = ?
    `).bind(document_id, party_row_id).first<any>();

    return jsonResponse({
      id: saved.id,
      party_row_id: saved.party_row_id,
      original_value: saved.original_value,
      corrected_value: saved.corrected_value,
    });
  } catch (error) {
    console.error('[Corrections] PUT error:', error);
    return jsonResponse({ error: 'Failed to save correction' }, 500);
  }
}

/**
 * DELETE /api/corrections/:id
 * Remove a correction, restoring the original AI extraction.
 * Also restores document_parties and triggers rebuild.
 */
export async function handleDeleteCorrection(correctionId: string, request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    // Fetch correction with all fields needed for restore
    const correction = await env.WELLS_DB.prepare(`
      SELECT id, document_id, party_row_id, original_value FROM user_corrections WHERE id = ?
    `).bind(correctionId).first<any>();

    if (!correction) return jsonResponse({ error: 'Correction not found' }, 404);

    // Verify user has access to the document
    const userRecord = await getUserByIdD1First(env, user.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, user.id, memberIds, { includeUserId: true });

    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.property_id FROM documents d
      WHERE d.id = ? AND ${docOwner.where}
    `).bind(correction.document_id, ...docOwner.params).first<any>();

    if (!doc) return jsonResponse({ error: 'Access denied' }, 403);

    // Delete the correction
    await env.WELLS_DB.prepare(`
      DELETE FROM user_corrections WHERE id = ?
    `).bind(correctionId).run();

    // Restore original name in document_parties
    if (correction.party_row_id != null) {
      const normalizedOriginal = normalizePartyName(correction.original_value);
      await env.WELLS_DB.prepare(`
        UPDATE document_parties SET party_name = ?, party_name_normalized = ?
        WHERE id = ? AND document_id = ?
      `).bind(correction.original_value, normalizedOriginal, correction.party_row_id, correction.document_id).run();
    }

    // Invalidate cache + trigger edge rebuild
    await invalidateAndRebuild(env, doc.property_id);

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[Corrections] DELETE error:', error);
    return jsonResponse({ error: 'Failed to delete correction' }, 500);
  }
}

