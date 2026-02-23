/**
 * Admin Dashboard API Handlers
 * Super-admin only endpoints for user health, system monitoring, billing, and notes.
 */

import { Env } from '../types/env';
import { jsonResponse } from '../utils/responses';
import { authenticateRequest, isSuperAdmin } from '../utils/auth';

// Plan prices for MRR calculation
const PLAN_PRICES: Record<string, number> = {
  'Free': 0,
  'Starter': 9,
  'Standard': 29,
  'Professional': 99,
  'Business': 249,
  'Enterprise 1K': 499, // custom — adjust as needed
};

/**
 * Middleware: verify super-admin + basic rate limit
 */
async function requireSuperAdmin(request: Request, env: Env): Promise<{ user: any } | Response> {
  const user = await authenticateRequest(request, env);
  if (!user || !isSuperAdmin(user.email)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  // Basic rate limit: 100 req/min per IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `admin-rate:${ip}`;
  const count = parseInt(await env.AUTH_TOKENS.get(rlKey) || '0', 10);
  if (count >= 100) {
    return jsonResponse({ error: 'Rate limit exceeded' }, 429);
  }
  await env.AUTH_TOKENS.put(rlKey, String(count + 1), { expirationTtl: 60 });

  return { user };
}

// ==========================================
// Tab 1: User Overview
// ==========================================
export async function handleAdminUsers(request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const result = await env.WELLS_DB.prepare(`
      SELECT u.*, o.name as org_name,
        (SELECT COUNT(*) FROM properties p WHERE p.user_id = u.airtable_record_id AND p.status = 'Active') as prop_count,
        (SELECT COUNT(*) FROM client_wells cw WHERE cw.user_id = u.airtable_record_id AND cw.status = 'Active') as well_count,
        (SELECT COUNT(*) FROM activity_log al WHERE al.user_id = u.airtable_record_id AND al.detected_at > datetime('now', '-30 days')) as alerts_30d,
        (SELECT COUNT(*) FROM activity_log al WHERE al.user_id = u.airtable_record_id AND al.email_sent = 0 AND al.detected_at > datetime('now', '-7 days')) as failed_emails
      FROM users u
      LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
      WHERE u.status != 'Deleted'
      ORDER BY u.last_login DESC
    `).all();

    return jsonResponse({ users: result.results });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Tab 2: Attention Needed
// ==========================================
export async function handleAdminAttention(request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    // Run all category queries in parallel
    const [neverLogged, dormantPaid, emptyAccount, failedEmails, recentlyCanceled, staleFree, engagedNoWells] = await Promise.all([
      // Never logged in (created > 3 days ago)
      env.WELLS_DB.prepare(`
        SELECT u.*, o.name as org_name FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        WHERE u.status != 'Deleted' AND (u.total_logins IS NULL OR u.total_logins = 0)
          AND u.created_at < datetime('now', '-3 days')
        ORDER BY u.created_at DESC
      `).all(),

      // Dormant paid (no login in 30d, paid plan)
      env.WELLS_DB.prepare(`
        SELECT u.*, o.name as org_name FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        WHERE u.status = 'Active' AND u.plan != 'Free'
          AND u.last_login < datetime('now', '-30 days')
        ORDER BY u.last_login ASC
      `).all(),

      // Empty account (0 properties AND 0 wells, created > 7 days)
      env.WELLS_DB.prepare(`
        SELECT u.*, o.name as org_name FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        WHERE u.status != 'Deleted'
          AND u.created_at < datetime('now', '-7 days')
          AND (SELECT COUNT(*) FROM properties p WHERE p.user_id = u.airtable_record_id AND p.status = 'Active') = 0
          AND (SELECT COUNT(*) FROM client_wells cw WHERE cw.user_id = u.airtable_record_id AND cw.status = 'Active') = 0
        ORDER BY u.created_at DESC
      `).all(),

      // Failed emails in last 7 days
      env.WELLS_DB.prepare(`
        SELECT DISTINCT u.*, o.name as org_name FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        INNER JOIN activity_log al ON al.user_id = u.airtable_record_id
        WHERE u.status != 'Deleted' AND al.email_sent = 0
          AND al.detected_at > datetime('now', '-7 days')
        ORDER BY u.name
      `).all(),

      // Recently canceled (last 30 days)
      env.WELLS_DB.prepare(`
        SELECT u.*, o.name as org_name FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        WHERE u.cancellation_date > datetime('now', '-30 days')
        ORDER BY u.cancellation_date DESC
      `).all(),

      // Stale free (Free plan, no login in 60 days)
      env.WELLS_DB.prepare(`
        SELECT u.*, o.name as org_name FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        WHERE u.status = 'Active' AND u.plan = 'Free'
          AND u.last_login < datetime('now', '-60 days')
        ORDER BY u.last_login ASC
      `).all(),

      // Engaged but empty wells (active logins, 0 wells)
      env.WELLS_DB.prepare(`
        SELECT u.*, o.name as org_name FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        WHERE u.status != 'Deleted'
          AND u.total_logins >= 3
          AND u.last_login > datetime('now', '-14 days')
          AND (SELECT COUNT(*) FROM client_wells cw WHERE cw.user_id = u.airtable_record_id AND cw.status = 'Active') = 0
        ORDER BY u.total_logins DESC
      `).all(),
    ]);

    return jsonResponse({
      categories: {
        never_logged_in: { label: 'Never Logged In', users: neverLogged.results },
        dormant_paid: { label: 'Dormant Paid', users: dormantPaid.results },
        empty_account: { label: 'Empty Account', users: emptyAccount.results },
        failed_emails: { label: 'Failed Emails', users: failedEmails.results },
        recently_canceled: { label: 'Recently Canceled', users: recentlyCanceled.results },
        stale_free: { label: 'Stale Free', users: staleFree.results },
        engaged_no_wells: { label: 'Engaged, No Wells', users: engagedNoWells.results },
      }
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Tab 3: User Detail
// ==========================================
export async function handleAdminUserDetail(userId: string, request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const [user, activity, properties, wells, notes, orgMembers, authEvents] = await Promise.all([
      // User record
      env.WELLS_DB.prepare(`
        SELECT u.*, o.name as org_name, o.plan as org_plan, o.stripe_customer_id as org_stripe_id
        FROM users u
        LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
        WHERE u.airtable_record_id = ?
      `).bind(userId).first(),

      // Recent activity (last 25)
      env.WELLS_DB.prepare(`
        SELECT * FROM activity_log
        WHERE user_id = ?
        ORDER BY detected_at DESC
        LIMIT 25
      `).bind(userId).all(),

      // Properties
      env.WELLS_DB.prepare(`
        SELECT id, county, section, township, "range", well_count, document_count, filing_count, status, created_at
        FROM properties
        WHERE user_id = ? AND status = 'Active'
        ORDER BY county, section
      `).bind(userId).all(),

      // Wells
      env.WELLS_DB.prepare(`
        SELECT api_number, well_name, well_status, operator, county, updated_at, notes, ri_nri
        FROM client_wells
        WHERE user_id = ? AND status = 'Active'
        ORDER BY well_name
      `).bind(userId).all(),

      // Admin notes
      env.WELLS_DB.prepare(`
        SELECT * FROM admin_notes
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).bind(userId).all(),

      // Org member count (if org exists)
      env.WELLS_DB.prepare(`
        SELECT COUNT(*) as member_count FROM users
        WHERE organization_id = (SELECT organization_id FROM users WHERE airtable_record_id = ?)
          AND organization_id IS NOT NULL
          AND status != 'Deleted'
      `).bind(userId).first(),

      // Auth events (last 30 days for this user's email)
      env.WELLS_DB.prepare(`
        SELECT event_type, ip, user_agent, error, created_at FROM auth_events
        WHERE email = (SELECT LOWER(email) FROM users WHERE airtable_record_id = ?)
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(userId).all().catch(() => ({ results: [] })),
    ]);

    if (!user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    return jsonResponse({
      user,
      activity: activity.results,
      properties: properties.results,
      wells: wells.results,
      notes: notes.results,
      orgMemberCount: orgMembers?.member_count || 0,
      authEvents: (authEvents as any).results,
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Tab 4: System Health
// ==========================================
export async function handleAdminHealth(request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const date = new Date().toISOString().split('T')[0];

    // D1 queries + KV reads in parallel
    const [
      nullStatuses,
      failedEmailsToday,
      tableCounts,
      authStats,
      pendingLocations,
      d1WriteFailures,
      lastSyncDaily,
      lastSyncWeekly,
      lastSyncDocket,
    ] = await Promise.all([
      env.WELLS_DB.prepare(`SELECT COUNT(*) as count FROM client_wells WHERE status='Active' AND well_status IS NULL`).first(),
      env.WELLS_DB.prepare(`SELECT COUNT(*) as count FROM activity_log WHERE date(detected_at) = date('now') AND email_sent = 0`).first(),

      // Table row counts
      Promise.all([
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM users`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM properties`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM client_wells`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM wells`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM activity_log`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM statewide_activity`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM organizations`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM admin_notes`).first(),
        env.WELLS_DB.prepare(`SELECT COUNT(*) as c FROM auth_events`).first(),
      ]),

      // Auth event stats (last 7 days)
      env.WELLS_DB.prepare(`
        SELECT event_type, COUNT(*) as count FROM auth_events
        WHERE created_at > datetime('now', '-7 days')
        GROUP BY event_type ORDER BY count DESC
      `).all().catch(() => ({ results: [] })),

      // Pending well locations (KV list)
      env.OCC_CACHE.list({ prefix: 'pending-well-location:' }).then(r => r.keys.length).catch(() => 0),

      // D1 write failures from MINERAL_CACHE — use OCC_CACHE fallback key if MINERAL_CACHE not bound
      env.MINERAL_CACHE?.get(`rbdms-d1-write-failures:${date}`).catch(() => null) || Promise.resolve(null),

      // Cron health from MINERAL_CACHE (mineral-monitor keys)
      env.MINERAL_CACHE?.get('mineral-monitor:last-run:daily', { type: 'json' }).catch(() => null) || Promise.resolve(null),
      env.MINERAL_CACHE?.get('mineral-monitor:last-run:weekly', { type: 'json' }).catch(() => null) || Promise.resolve(null),
      env.MINERAL_CACHE?.get('mineral-monitor:last-run:docket', { type: 'json' }).catch(() => null) || Promise.resolve(null),
    ]);

    const [users, properties, clientWells, wells, activityLog, statewideActivity, organizations, adminNotes, authEvents] = tableCounts;

    return jsonResponse({
      d1WriteFailuresToday: d1WriteFailures ? parseInt(d1WriteFailures as string, 10) : 0,
      nullWellStatuses: (nullStatuses as any)?.count || 0,
      failedEmailsToday: (failedEmailsToday as any)?.count || 0,
      pendingWellLocations: pendingLocations,
      tableCounts: {
        users: (users as any)?.c || 0,
        properties: (properties as any)?.c || 0,
        client_wells: (clientWells as any)?.c || 0,
        wells: (wells as any)?.c || 0,
        activity_log: (activityLog as any)?.c || 0,
        statewide_activity: (statewideActivity as any)?.c || 0,
        organizations: (organizations as any)?.c || 0,
        admin_notes: (adminNotes as any)?.c || 0,
        auth_events: (authEvents as any)?.c || 0,
      },
      cronHealth: {
        daily: lastSyncDaily,
        weekly: lastSyncWeekly,
        docket: lastSyncDocket,
      },
      authEvents7d: (authStats as any).results,
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Tab 5: Activity Feed
// ==========================================
export async function handleAdminActivity(request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);
    const search = url.searchParams.get('search');

    let query = `
      SELECT al.*, u.email as user_email, u.name as user_name
      FROM activity_log al
      LEFT JOIN users u ON u.airtable_record_id = al.user_id
      WHERE 1=1
    `;
    const binds: any[] = [];

    if (type) {
      query += ` AND al.activity_type = ?`;
      binds.push(type);
    }
    if (search) {
      query += ` AND (al.api_number LIKE ? OR al.well_name LIKE ?)`;
      binds.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY al.detected_at DESC LIMIT ? OFFSET ?`;
    binds.push(limit, offset);

    const result = await env.WELLS_DB.prepare(query).bind(...binds).all();

    // Get distinct activity types for filter dropdown
    const types = await env.WELLS_DB.prepare(`
      SELECT DISTINCT activity_type FROM activity_log WHERE activity_type IS NOT NULL ORDER BY activity_type
    `).all();

    return jsonResponse({
      entries: result.results,
      activityTypes: types.results.map((r: any) => r.activity_type),
      hasMore: result.results.length === limit,
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Tab 6: Billing & Revenue
// ==========================================
export async function handleAdminBilling(request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const [planBreakdown, recentCancellations, orgPlans] = await Promise.all([
      // Plan breakdown (individual users — non-org or org primary)
      env.WELLS_DB.prepare(`
        SELECT plan, status, COUNT(*) as user_count
        FROM users WHERE status != 'Deleted'
        GROUP BY plan, status
        ORDER BY plan
      `).all(),

      // Recent cancellations (last 30 days)
      env.WELLS_DB.prepare(`
        SELECT name, email, plan, cancellation_date, cancellation_reason, cancellation_feedback, stripe_customer_id
        FROM users
        WHERE cancellation_date > datetime('now', '-30 days')
        ORDER BY cancellation_date DESC
      `).all(),

      // Org-level plans for MRR (avoid double-counting org members)
      env.WELLS_DB.prepare(`
        SELECT o.plan, o.name as org_name, COUNT(u.id) as member_count
        FROM organizations o
        LEFT JOIN users u ON u.organization_id = o.airtable_record_id AND u.status != 'Deleted'
        WHERE o.plan IS NOT NULL AND o.plan != ''
        GROUP BY o.airtable_record_id
      `).all(),
    ]);

    // Calculate MRR: org subscriptions + individual non-org users
    let mrr = 0;
    const orgIds = new Set<string>();

    // Org-level MRR (one subscription per org)
    for (const org of (orgPlans.results as any[])) {
      mrr += PLAN_PRICES[org.plan] || 0;
    }

    // Get org member user IDs to exclude from individual calc
    const orgMembers = await env.WELLS_DB.prepare(`
      SELECT airtable_record_id FROM users WHERE organization_id IS NOT NULL AND status != 'Deleted'
    `).all();
    const orgMemberIds = new Set((orgMembers.results as any[]).map(r => r.airtable_record_id));

    // Individual non-org users MRR
    for (const row of (planBreakdown.results as any[])) {
      if (row.status === 'Active' && row.plan !== 'Free') {
        // We need to subtract org members from the count
        // Since we have aggregate counts, we'll do a separate query
      }
    }

    // More precise individual MRR
    const individualPaid = await env.WELLS_DB.prepare(`
      SELECT plan, COUNT(*) as user_count FROM users
      WHERE status = 'Active' AND plan != 'Free'
        AND (organization_id IS NULL OR organization_id = '')
      GROUP BY plan
    `).all();

    for (const row of (individualPaid.results as any[])) {
      mrr += (PLAN_PRICES[(row as any).plan] || 0) * (row as any).user_count;
    }

    // Summary counts
    const activePaid = (planBreakdown.results as any[])
      .filter(r => r.status === 'Active' && r.plan !== 'Free')
      .reduce((sum, r) => sum + r.user_count, 0);
    const freeUsers = (planBreakdown.results as any[])
      .filter(r => r.plan === 'Free')
      .reduce((sum, r) => sum + r.user_count, 0);
    const churn30d = (recentCancellations.results as any[]).length;

    return jsonResponse({
      mrr,
      activePaid,
      freeUsers,
      churn30d,
      planBreakdown: planBreakdown.results,
      recentCancellations: recentCancellations.results,
      orgPlans: orgPlans.results,
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Tab 7: Admin Notes — List
// ==========================================
export async function handleAdminNotesList(request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const tag = url.searchParams.get('tag');
    const showResolved = url.searchParams.get('resolved') === '1';

    let query = `
      SELECT an.*, u.name as user_name, u.email as user_email
      FROM admin_notes an
      LEFT JOIN users u ON u.airtable_record_id = an.user_id
      WHERE 1=1
    `;
    const binds: any[] = [];

    if (!showResolved) {
      query += ` AND an.resolved = 0`;
    }
    if (tag) {
      query += ` AND an.tag = ?`;
      binds.push(tag);
    }

    query += ` ORDER BY an.created_at DESC`;

    const result = await env.WELLS_DB.prepare(query).bind(...binds).all();
    return jsonResponse({ notes: result.results });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Admin Notes — Create
// ==========================================
export async function handleAdminNotesCreate(request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json() as any;
    const { user_id, note, tag } = body;

    if (!user_id || !note) {
      return jsonResponse({ error: 'user_id and note are required' }, 400);
    }

    const validTags = ['follow-up', 'billing', 'onboarding', 'churn-risk', 'support'];
    if (tag && !validTags.includes(tag)) {
      return jsonResponse({ error: `Invalid tag. Must be one of: ${validTags.join(', ')}` }, 400);
    }

    const id = `anote_${crypto.randomUUID()}`;
    await env.WELLS_DB.prepare(`
      INSERT INTO admin_notes (id, user_id, author, note, tag)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, user_id, (auth as any).user.email, note, tag || null).run();

    return jsonResponse({ id, success: true }, 201);
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Admin Notes — Update (resolve/edit)
// ==========================================
export async function handleAdminNotesUpdate(noteId: string, request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json() as any;
    const updates: string[] = [];
    const binds: any[] = [];

    if (body.note !== undefined) {
      updates.push('note = ?');
      binds.push(body.note);
    }
    if (body.tag !== undefined) {
      updates.push('tag = ?');
      binds.push(body.tag);
    }
    if (body.resolved !== undefined) {
      updates.push('resolved = ?');
      binds.push(body.resolved ? 1 : 0);
      if (body.resolved) {
        updates.push("resolved_at = datetime('now')");
      }
    }

    if (updates.length === 0) {
      return jsonResponse({ error: 'No fields to update' }, 400);
    }

    updates.push("updated_at = datetime('now')");
    binds.push(noteId);

    await env.WELLS_DB.prepare(`
      UPDATE admin_notes SET ${updates.join(', ')} WHERE id = ?
    `).bind(...binds).run();

    return jsonResponse({ success: true });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ==========================================
// Admin Notes — Delete
// ==========================================
export async function handleAdminNotesDelete(noteId: string, request: Request, env: Env): Promise<Response> {
  const auth = await requireSuperAdmin(request, env);
  if (auth instanceof Response) return auth;

  try {
    await env.WELLS_DB.prepare(`DELETE FROM admin_notes WHERE id = ?`).bind(noteId).run();
    return jsonResponse({ success: true });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
}
