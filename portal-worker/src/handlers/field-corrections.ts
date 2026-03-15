/**
 * Document Field Corrections Handler
 *
 * Allows users to correct AI-extracted field values (recording info, dates)
 * directly from the document detail modal.
 *
 * Corrections target extracted_data JSON fields (not document_parties rows).
 * On save: patches extracted_data, re-derives document_date, re-runs dedup,
 * invalidates chain cache, triggers edge rebuild.
 * Original AI extraction is preserved in the correction record for undo.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import { invalidateAndRebuild } from '../utils/invalidate-rebuild.js';
import type { Env } from '../types/env.js';

// Phase 1 editable fields (canonical field_path → allowed)
const EDITABLE_FIELDS = new Set([
  'recording.book', 'recording.page', 'recording.instrument_number',
  'recording.recording_date', 'execution_date', 'effective_date',
]);

/**
 * Resolve a canonical field_path to the actual container + key in extracted_data.
 * Handles recording vs recording_info abstraction.
 */
function resolveFieldPath(data: any, fieldPath: string): { container: any; key: string; current: any } | null {
  if (fieldPath.startsWith('recording.')) {
    const subKey = fieldPath.slice('recording.'.length);
    // Determine which container key the doc uses
    const container = data.recording_info || data.recording;
    const containerKey = data.recording_info ? 'recording_info' : 'recording';
    if (!container) {
      // Create recording object if neither exists
      data.recording = {};
      return { container: data.recording, key: subKey, current: null };
    }
    return { container, key: subKey, current: container[subKey] ?? null };
  }
  // Top-level field
  return { container: data, key: fieldPath, current: data[fieldPath] ?? null };
}

/**
 * Re-derive document_date using the same priority chain as documents-worker.
 */
function deriveDocumentDate(data: any): string | null {
  const ri = data.recording_info || data.recording;
  const candidates = [
    data.execution_date,
    data.effective_date,
    ri?.recording_date,
    data.order_info?.order_date,
    data.order_info?.effective_date,
  ];
  for (const d of candidates) {
    if (d && typeof d === 'string' && d.trim()) return d.trim();
  }
  return null;
}

/**
 * GET /api/documents/:id/field-corrections
 */
export async function handleGetFieldCorrections(docId: string, request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const result = await env.WELLS_DB.prepare(`
      SELECT id, field_path, original_value, corrected_value
      FROM document_field_corrections WHERE document_id = ?
    `).bind(docId).all();

    const corrections: Record<string, { id: string; field_path: string; original_value: string | null; corrected_value: string }> = {};
    for (const row of result.results as any[]) {
      corrections[row.field_path] = {
        id: row.id,
        field_path: row.field_path,
        original_value: row.original_value,
        corrected_value: row.corrected_value,
      };
    }

    return jsonResponse(corrections);
  } catch (error) {
    console.error('[FieldCorrections] GET error:', error);
    return jsonResponse({ error: 'Failed to fetch field corrections' }, 500);
  }
}

/**
 * PUT /api/documents/:id/field-corrections
 * Body: { corrections: [{ field_path, value }] }
 */
export async function handleSaveFieldCorrections(docId: string, request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await request.json() as any;
    const corrections: Array<{ field_path: string; value: string }> = body.corrections;
    if (!Array.isArray(corrections) || corrections.length === 0) {
      return jsonResponse({ error: 'corrections array required' }, 400);
    }

    // Validate field paths
    for (const c of corrections) {
      if (!EDITABLE_FIELDS.has(c.field_path)) {
        return jsonResponse({ error: `Field not editable: ${c.field_path}` }, 400);
      }
    }

    // Verify document exists and user has access
    const userRecord = await getUserByIdD1First(env, user.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, user.id, memberIds, { includeUserId: true });

    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.property_id, d.extracted_data
      FROM documents d
      WHERE d.id = ? AND (d.deleted_at IS NULL OR d.deleted_at = '') AND ${docOwner.where}
    `).bind(docId, ...docOwner.params).first<any>();

    if (!doc) return jsonResponse({ error: 'Document not found or access denied' }, 404);

    let extractedData: any;
    try {
      extractedData = doc.extracted_data ? JSON.parse(doc.extracted_data) : {};
    } catch {
      extractedData = {};
    }

    // Load existing corrections to preserve original_value on re-save
    const existingResult = await env.WELLS_DB.prepare(`
      SELECT field_path, original_value FROM document_field_corrections WHERE document_id = ?
    `).bind(docId).all();
    const existingOriginals = new Map<string, string | null>();
    for (const row of existingResult.results as any[]) {
      existingOriginals.set(row.field_path, row.original_value);
    }

    // Apply each correction
    const stmts: D1PreparedStatement[] = [];
    for (const c of corrections) {
      const resolved = resolveFieldPath(extractedData, c.field_path);
      if (!resolved) continue;

      // Capture original: use existing correction's original if one exists, else current value
      const originalValue = existingOriginals.has(c.field_path)
        ? existingOriginals.get(c.field_path)
        : (resolved.current != null ? String(resolved.current) : null);

      // Apply correction to in-memory extracted_data
      resolved.container[resolved.key] = c.value || null;

      // Upsert correction record
      const corrId = `fcorr_${crypto.randomUUID().slice(0, 12)}`;
      stmts.push(env.WELLS_DB.prepare(`
        INSERT INTO document_field_corrections (id, document_id, field_path, original_value, corrected_value, corrected_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(document_id, field_path) DO UPDATE SET
          corrected_value = excluded.corrected_value,
          corrected_by = excluded.corrected_by,
          updated_at = datetime('now')
      `).bind(corrId, docId, c.field_path, originalValue, c.value, user.email));
    }

    // Write updated extracted_data + re-derive document_date
    const newDocDate = deriveDocumentDate(extractedData);
    stmts.push(env.WELLS_DB.prepare(`
      UPDATE documents SET extracted_data = ?, document_date = COALESCE(?, document_date)
      WHERE id = ?
    `).bind(JSON.stringify(extractedData), newDocDate, docId));

    // Execute all in one batch
    await env.WELLS_DB.batch(stmts);

    // Re-run dedup (non-fatal)
    try {
      await env.DOCUMENTS_WORKER.fetch(new Request('https://internal/api/internal/rerun-dedup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: docId }),
      }));
    } catch (e) {
      console.error('[FieldCorrections] Dedup re-run failed:', e);
    }

    // Invalidate chain cache + rebuild edges
    await invalidateAndRebuild(env, doc.property_id);

    // Return updated corrections map
    const updatedResult = await env.WELLS_DB.prepare(`
      SELECT id, field_path, original_value, corrected_value
      FROM document_field_corrections WHERE document_id = ?
    `).bind(docId).all();

    const result: Record<string, any> = {};
    for (const row of updatedResult.results as any[]) {
      result[row.field_path] = {
        id: row.id,
        field_path: row.field_path,
        original_value: row.original_value,
        corrected_value: row.corrected_value,
      };
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('[FieldCorrections] PUT error:', error);
    return jsonResponse({ error: 'Failed to save field corrections' }, 500);
  }
}

/**
 * DELETE /api/documents/:id/field-corrections/:correctionId
 */
export async function handleDeleteFieldCorrection(docId: string, correctionId: string, request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    // Fetch correction
    const correction = await env.WELLS_DB.prepare(`
      SELECT id, document_id, field_path, original_value FROM document_field_corrections WHERE id = ? AND document_id = ?
    `).bind(correctionId, docId).first<any>();

    if (!correction) return jsonResponse({ error: 'Correction not found' }, 404);

    // Verify access
    const userRecord = await getUserByIdD1First(env, user.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, user.id, memberIds, { includeUserId: true });

    const doc = await env.WELLS_DB.prepare(`
      SELECT d.id, d.property_id, d.extracted_data FROM documents d
      WHERE d.id = ? AND ${docOwner.where}
    `).bind(docId, ...docOwner.params).first<any>();

    if (!doc) return jsonResponse({ error: 'Access denied' }, 403);

    // Restore original value in extracted_data
    let extractedData: any;
    try {
      extractedData = doc.extracted_data ? JSON.parse(doc.extracted_data) : {};
    } catch {
      extractedData = {};
    }

    const resolved = resolveFieldPath(extractedData, correction.field_path);
    if (resolved) {
      if (correction.original_value != null) {
        resolved.container[resolved.key] = correction.original_value;
      } else {
        delete resolved.container[resolved.key];
      }
    }

    // Delete correction + write restored extracted_data + re-derive document_date
    const newDocDate = deriveDocumentDate(extractedData);
    await env.WELLS_DB.batch([
      env.WELLS_DB.prepare(`DELETE FROM document_field_corrections WHERE id = ?`).bind(correctionId),
      env.WELLS_DB.prepare(`
        UPDATE documents SET extracted_data = ?, document_date = COALESCE(?, document_date) WHERE id = ?
      `).bind(JSON.stringify(extractedData), newDocDate, docId),
    ]);

    // Re-run dedup (non-fatal)
    try {
      await env.DOCUMENTS_WORKER.fetch(new Request('https://internal/api/internal/rerun-dedup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: docId }),
      }));
    } catch (e) {
      console.error('[FieldCorrections] Dedup re-run failed:', e);
    }

    // Invalidate chain cache + rebuild edges
    await invalidateAndRebuild(env, doc.property_id);

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[FieldCorrections] DELETE error:', error);
    return jsonResponse({ error: 'Failed to delete field correction' }, 500);
  }
}
