import { normalizePartyName } from '../utils/normalize-party-name.js';

interface Env {
  WELLS_DB: D1Database;
}

/**
 * POST /api/admin/renormalize-parties
 *
 * Re-applies the current normalizePartyName() to all document_parties rows.
 * Fixes inconsistencies from earlier normalization bugs (e.g. "H.M." vs "H. M.").
 * Idempotent — safe to run multiple times.
 *
 * Auth: PROCESSING_API_KEY bearer token.
 */
export async function handleRenormalizeParties(_request: Request, env: Env): Promise<Response> {
  const db = env.WELLS_DB;
  const BATCH = 500; // D1 batch limit
  let offset = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  while (true) {
    const rows = await db.prepare(
      `SELECT id, party_name, party_name_normalized FROM document_parties ORDER BY id LIMIT ? OFFSET ?`
    ).bind(BATCH, offset).all<{ id: number; party_name: string; party_name_normalized: string }>();

    if (!rows.results || rows.results.length === 0) break;

    const stmts: D1PreparedStatement[] = [];
    for (const row of rows.results) {
      const correct = normalizePartyName(row.party_name);
      if (correct !== row.party_name_normalized) {
        stmts.push(
          db.prepare('UPDATE document_parties SET party_name_normalized = ? WHERE id = ?')
            .bind(correct, row.id)
        );
      } else {
        unchanged++;
      }
    }

    if (stmts.length > 0) {
      // D1 batch limit is 500 statements
      for (let i = 0; i < stmts.length; i += BATCH) {
        const chunk = stmts.slice(i, i + BATCH);
        try {
          await db.batch(chunk);
          updated += chunk.length;
        } catch (err: any) {
          console.error(`[Renormalize] Batch error at offset ${offset}:`, err.message);
          errors += chunk.length;
        }
      }
    }

    offset += rows.results.length;
    if (rows.results.length < BATCH) break;
  }

  return new Response(JSON.stringify({
    success: true,
    total: offset,
    updated,
    unchanged,
    errors,
  }), { headers: { 'Content-Type': 'application/json' } });
}
