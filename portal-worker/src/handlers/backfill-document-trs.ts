interface Env {
  WELLS_DB: D1Database;
}

/**
 * POST /api/admin/backfill-document-trs
 *
 * Populates section, township, range on documents where those columns are NULL.
 * Two-pass approach:
 *   1. From extracted_data JSON (section/township/range or legal_description.*)
 *   2. From linked property (documents.property_id → properties.section/township/range)
 *
 * Uses cursor-based pagination (WHERE id > ?) to avoid offset skip bugs.
 * Auth: PROCESSING_API_KEY bearer token. Idempotent.
 */
export async function handleBackfillDocumentTrs(_request: Request, env: Env): Promise<Response> {
  const db = env.WELLS_DB;
  let fromExtracted = 0;
  let fromProperty = 0;
  let skipped = 0;
  let errors = 0;
  const BATCH = 200;

  // --- Pass 1: From extracted_data JSON ---
  let cursor = '';
  while (true) {
    const rows = await db.prepare(`
      SELECT id, extracted_data
      FROM documents
      WHERE id > ?
        AND extracted_data IS NOT NULL AND LENGTH(extracted_data) > 10
        AND status = 'complete'
        AND deleted_at IS NULL
        AND (section IS NULL OR township IS NULL OR range IS NULL)
      ORDER BY id
      LIMIT ?
    `).bind(cursor, BATCH).all<{ id: string; extracted_data: string }>();

    if (!rows.results || rows.results.length === 0) break;
    cursor = rows.results[rows.results.length - 1].id;

    const stmts: D1PreparedStatement[] = [];
    for (const row of rows.results) {
      try {
        const data = JSON.parse(row.extracted_data);
        const legal = data.legal_description || data.legal || {};
        const section = data.section || legal.section || null;
        const township = data.township || legal.township || null;
        const range = data.range || legal.range || null;

        if (section && township && range) {
          stmts.push(
            db.prepare(
              `UPDATE documents SET section = ?, township = ?, range = ? WHERE id = ? AND (section IS NULL OR township IS NULL OR range IS NULL)`
            ).bind(String(section), String(township), String(range), row.id)
          );
        }
      } catch {}
    }

    if (stmts.length > 0) {
      for (let i = 0; i < stmts.length; i += 500) {
        const chunk = stmts.slice(i, i + 500);
        try {
          await db.batch(chunk);
          fromExtracted += chunk.length;
        } catch (err: any) {
          console.error(`[BackfillTRS] Pass 1 batch error:`, err.message);
          errors += chunk.length;
        }
      }
    }

    if (rows.results.length < BATCH) break;
  }

  // --- Pass 2: From linked property (documents still missing TRS after pass 1) ---
  // documents.property_id stores bare Airtable ID (recXXX) but properties.id = prop_recXXX
  cursor = '';
  while (true) {
    const rows = await db.prepare(`
      SELECT d.id, d.property_id
      FROM documents d
      WHERE d.id > ?
        AND d.status = 'complete'
        AND d.deleted_at IS NULL
        AND (d.section IS NULL OR d.township IS NULL OR d.range IS NULL)
        AND d.property_id IS NOT NULL AND d.property_id != ''
      ORDER BY d.id
      LIMIT ?
    `).bind(cursor, BATCH).all<{ id: string; property_id: string }>();

    if (!rows.results || rows.results.length === 0) break;
    cursor = rows.results[rows.results.length - 1].id;

    const stmts: D1PreparedStatement[] = [];
    for (const row of rows.results) {
      const propId = row.property_id;
      const prop = await db.prepare(
        `SELECT section, township, range FROM properties WHERE id IN (?, ?) LIMIT 1`
      ).bind(propId, `prop_${propId}`).first<{ section: string; township: string; range: string }>();

      if (prop?.section && prop?.township && prop?.range) {
        stmts.push(
          db.prepare(
            `UPDATE documents SET section = ?, township = ?, range = ? WHERE id = ? AND (section IS NULL OR township IS NULL OR range IS NULL)`
          ).bind(prop.section, prop.township, prop.range, row.id)
        );
      } else {
        skipped++;
      }
    }

    if (stmts.length > 0) {
      for (let i = 0; i < stmts.length; i += 500) {
        const chunk = stmts.slice(i, i + 500);
        try {
          await db.batch(chunk);
          fromProperty += chunk.length;
        } catch (err: any) {
          console.error(`[BackfillTRS] Pass 2 batch error:`, err.message);
          errors += chunk.length;
        }
      }
    }

    if (rows.results.length < BATCH) break;
  }

  const remaining = await db.prepare(`
    SELECT COUNT(*) as cnt FROM documents
    WHERE status = 'complete' AND deleted_at IS NULL
      AND (section IS NULL OR township IS NULL OR range IS NULL)
  `).first<{ cnt: number }>();

  return new Response(JSON.stringify({
    success: true,
    fromExtracted,
    fromProperty,
    totalUpdated: fromExtracted + fromProperty,
    skipped,
    errors,
    remaining: remaining?.cnt || 0,
  }), { headers: { 'Content-Type': 'application/json' } });
}
