/**
 * Document Duplicate Review API Handlers
 *
 * Endpoints for reviewing and resolving duplicate document flags.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import type { Env } from '../types/env.js';

/**
 * POST /api/documents/:id/duplicate-review
 * Body: { action: 'confirm' | 'dismiss' }
 */
export async function handleDuplicateReview(documentId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body: any = await request.json();
    const { action } = body;
    if (action !== 'confirm' && action !== 'dismiss') {
      return jsonResponse({ error: 'Invalid action. Must be "confirm" or "dismiss".' }, 400);
    }

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, authUser.id, memberIds, { includeUserId: true });

    // Verify the document exists, belongs to user, and is pending review
    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.duplicate_status
      FROM documents d
      WHERE d.id = ?
        AND d.duplicate_status = 'pending_review'
        AND ${docOwner.where}
    `).bind(documentId, ...docOwner.params).first<any>();

    if (!doc) {
      return jsonResponse({ error: 'Document not found or not pending review' }, 404);
    }

    const newStatus = action === 'confirm' ? 'confirmed' : 'dismissed';
    await env.WELLS_DB.prepare(`
      UPDATE documents SET duplicate_status = ? WHERE id = ?
    `).bind(newStatus, documentId).run();

    console.log(`[DuplicateReview] Document ${documentId} ${newStatus} by ${authUser.id}`);

    return jsonResponse({ success: true, updated: 1 });
  } catch (error) {
    console.error('[DuplicateReview] Error:', error);
    return jsonResponse({ error: 'Failed to review duplicate' }, 500);
  }
}

/**
 * POST /api/documents/duplicate-review-batch
 * Body: { action: 'confirm' | 'dismiss', document_ids: string[] }
 */
export async function handleDuplicateReviewBatch(request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body: any = await request.json();
    const { action, document_ids } = body;

    if (action !== 'confirm' && action !== 'dismiss') {
      return jsonResponse({ error: 'Invalid action. Must be "confirm" or "dismiss".' }, 400);
    }
    if (!Array.isArray(document_ids) || document_ids.length === 0) {
      return jsonResponse({ error: 'document_ids must be a non-empty array' }, 400);
    }
    if (document_ids.length > 100) {
      return jsonResponse({ error: 'Maximum 100 documents per batch' }, 400);
    }

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, authUser.id, memberIds, { includeUserId: true });

    const newStatus = action === 'confirm' ? 'confirmed' : 'dismissed';
    let updated = 0;

    // Process in batches to stay under D1 bind param limit
    const BATCH = 20;
    for (let i = 0; i < document_ids.length; i += BATCH) {
      const batch = document_ids.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(`
        UPDATE documents
        SET duplicate_status = ?
        WHERE id IN (${placeholders})
          AND duplicate_status = 'pending_review'
          AND id IN (
            SELECT d.id FROM documents d WHERE ${docOwner.where}
          )
      `).bind(newStatus, ...batch, ...docOwner.params).run();
      updated += result.meta.changes;
    }

    console.log(`[DuplicateReviewBatch] ${updated} documents ${newStatus} by ${authUser.id}`);

    return jsonResponse({ success: true, updated });
  } catch (error) {
    console.error('[DuplicateReviewBatch] Error:', error);
    return jsonResponse({ error: 'Failed to batch review duplicates' }, 500);
  }
}
