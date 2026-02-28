/**
 * Shared org ownership query helpers.
 *
 * Eliminates repeated `user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?)`
 * correlated subqueries by pre-resolving member IDs once and using IN (?,?,...) directly.
 */

/**
 * Pre-resolve all member airtable_record_ids for an organization (one query, cached per request).
 * Returns null if orgId is falsy (solo user — no org).
 */
export async function getOrgMemberIds(
  db: D1Database,
  orgId: string | null | undefined
): Promise<string[] | null> {
  if (!orgId) return null;
  const result = await db.prepare(
    `SELECT airtable_record_id FROM users WHERE organization_id = ?`
  ).bind(orgId).all();
  return (result.results || []).map((r: any) => r.airtable_record_id as string).filter(Boolean);
}

/**
 * Build a WHERE clause + bind params for ownership filtering on a table.
 *
 * Two calling patterns supported:
 *
 * Pattern A — "standard" (client_wells, properties when queried directly):
 *   `(t.organization_id = ? OR t.user_id IN (?,?,...))` with orgId + memberIds
 *   Falls back to `t.user_id = ?` for solo users.
 *
 * Pattern B — "CTE" (used in CTEs joining client_wells):
 *   `(t.organization_id = ? OR t.user_id = ? OR t.user_id IN (?,?,...))` with orgId + userId + memberIds
 *   Falls back to `t.user_id = ?` for solo users.
 *
 * @param tableAlias  Table alias (e.g. "cw", "p")
 * @param orgId       Organization ID or null/undefined
 * @param userId      Current user's ID (airtable_record_id format)
 * @param memberIds   Pre-resolved org member IDs (from getOrgMemberIds), or null for solo users
 * @param opts.includeUserId  If true, adds explicit `t.user_id = ?` clause (Pattern B for CTEs)
 */
export function buildOwnershipFilter(
  tableAlias: string,
  orgId: string | null | undefined,
  userId: string,
  memberIds: string[] | null,
  opts?: { includeUserId?: boolean }
): { where: string; params: any[] } {
  const t = tableAlias;
  const includeUserId = opts?.includeUserId ?? false;

  if (orgId && memberIds && memberIds.length > 0) {
    const placeholders = memberIds.map(() => '?').join(',');
    if (includeUserId) {
      // Pattern B: CTE style — explicit user_id check + org_id + member IN
      return {
        where: `(${t}.organization_id = ? OR ${t}.user_id = ? OR ${t}.user_id IN (${placeholders}))`,
        params: [orgId, userId, ...memberIds]
      };
    }
    // Pattern A: standard — org_id + member IN
    return {
      where: `(${t}.organization_id = ? OR ${t}.user_id IN (${placeholders}))`,
      params: [orgId, ...memberIds]
    };
  }

  // Solo user — no org
  return {
    where: `${t}.user_id = ?`,
    params: [userId]
  };
}
