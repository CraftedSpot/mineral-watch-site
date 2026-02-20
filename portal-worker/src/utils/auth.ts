/**
 * Authentication Utilities
 * 
 * Handles session management, token generation/verification, and cookie parsing
 * for the Portal Worker authentication system
 */

import { COOKIE_NAME, SUPER_ADMIN_EMAILS, BASE_ID, ORGANIZATION_TABLE, SESSION_EXPIRY } from '../constants.js';
import { getUserById, getUserByIdD1First } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Per-Worker-instance dedup for D1 user upserts.
// Idempotent by design (ON CONFLICT DO UPDATE) — the Set is a perf optimization, not correctness.
const recentlyUpsertedUsers = new Set<string>();

/**
 * Check if a user is a super admin (can act on behalf of other users/orgs)
 */
export function isSuperAdmin(email: string): boolean {
  return SUPER_ADMIN_EMAILS.includes(email as any);
}

/**
 * Session payload interface
 */
export interface SessionPayload {
  id: string;
  email: string;
  name?: string;
  exp: number;
  // Full Airtable user record to avoid redundant API calls
  airtableUser?: {
    id: string;
    fields: {
      Email: string;
      Name?: string;
      Plan?: string;
      Organization?: string[];
      Role?: string;
      'Stripe Customer ID'?: string;
      Status?: string;
      'Created Time'?: string;
    };
  };
  // Set when a super admin is impersonating another user via ?act_as=
  impersonating?: {
    adminEmail: string;
    adminId: string;
  };
}

/**
 * Parse a cookie value from a cookie string
 * @param cookieString The full cookie header value
 * @param name The cookie name to extract
 * @returns Cookie value or null if not found
 */
export function getCookieValue(cookieString: string, name: string): string | null {
  const match = cookieString.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}

/**
 * Authenticate a request by verifying the session cookie locally (no service binding).
 * Verifies HMAC token, fetches fresh user data from Airtable, ensures user exists in D1.
 */
export async function authenticateRequest(request: Request, env: Env): Promise<SessionPayload | null> {
  const cookie = request.headers.get("Cookie") || "";

  try {
    // 1. Extract session cookie
    const sessionToken = getCookieValue(cookie, COOKIE_NAME);
    if (!sessionToken) return null;

    // 2. Verify HMAC signature locally — no network call
    let payload: any;
    try {
      payload = await verifySessionToken(env, sessionToken);
    } catch {
      return null;
    }

    // 3. Check expiry
    if (Date.now() > payload.exp) {
      return null;
    }

    // 4. Session revocation check (KV)
    if (env.AUTH_TOKENS && payload.id) {
      const revokedAfter = await env.AUTH_TOKENS.get(`sess_valid_after:${payload.id}`);
      if (revokedAfter) {
        const sessionIat = payload.iat || 0;
        if (sessionIat < parseInt(revokedAfter, 10)) {
          console.log(`[Auth] Session revoked for user ${payload.id}: iat=${sessionIat} < valid_after=${revokedAfter}`);
          return null;
        }
      }
    }

    // 5. Fetch user data — D1 first (fast, resilient), Airtable fallback
    const userRecord = await getUserByIdD1First(env, payload.id);
    if (!userRecord) return null;

    // 6. Construct SessionPayload (same shape as before — all handlers work unchanged)
    const sessionPayload: SessionPayload = {
      id: userRecord.id,
      email: userRecord.fields.Email,
      name: userRecord.fields.Name,
      exp: payload.exp,
      airtableUser: userRecord as any
    };

    // 7. JIT D1 user sync (deduped per Worker instance)
    if (env.WELLS_DB && !recentlyUpsertedUsers.has(payload.id)) {
      try {
        await ensureUserInD1(env, userRecord);
        recentlyUpsertedUsers.add(payload.id);
      } catch (e) {
        console.error('[Auth] D1 user sync failed (non-fatal):', e);
      }
    }

    // 8. Super admin impersonation: ?act_as=recXXX
    const url = new URL(request.url);
    const actAs = url.searchParams.get('act_as');

    if (actAs) {
      if (!isSuperAdmin(sessionPayload.email)) {
        return sessionPayload;
      }

      const targetUser = await getUserByIdD1First(env, actAs);
      if (!targetUser) {
        console.warn(`[Impersonate] Target user ${actAs} not found`);
        return sessionPayload;
      }

      console.log(`[Impersonate] ${sessionPayload.email} acting as ${targetUser.fields.Email} (${actAs})`);

      if (env.OCC_CACHE) {
        const auditKey = `impersonate:${Date.now()}:${sessionPayload.id}`;
        const auditEntry = JSON.stringify({
          adminEmail: sessionPayload.email,
          adminId: sessionPayload.id,
          targetUserId: actAs,
          targetEmail: targetUser.fields.Email,
          path: url.pathname,
          timestamp: new Date().toISOString()
        });
        env.OCC_CACHE.put(auditKey, auditEntry, { expirationTtl: 7776000 });
      }

      // Also ensure impersonated user is in D1
      if (env.WELLS_DB && !recentlyUpsertedUsers.has(actAs)) {
        try {
          await ensureUserInD1(env, targetUser);
          recentlyUpsertedUsers.add(actAs);
        } catch (e) {
          console.error('[Auth] D1 target user sync failed (non-fatal):', e);
        }
      }

      return {
        id: targetUser.id,
        email: targetUser.fields.Email,
        name: targetUser.fields.Name,
        exp: sessionPayload.exp,
        airtableUser: targetUser as any,
        impersonating: {
          adminEmail: sessionPayload.email,
          adminId: sessionPayload.id
        }
      };
    }

    return sessionPayload;
  } catch (error) {
    console.error('Auth verification failed:', error);
    return null;
  }
}

/**
 * Generate a new token and store it in KV with expiration
 * @param env Worker environment
 * @param payload Data to store with the token
 * @param ttlSeconds Time to live in seconds (default: 900 = 15 minutes)
 * @returns Generated token ID
 */
export async function generateToken(env: Env, payload: any, ttlSeconds: number = 900): Promise<string> {
  const tokenId = crypto.randomUUID();
  await env.AUTH_TOKENS.put(tokenId, JSON.stringify(payload), {
    expirationTtl: ttlSeconds
  });
  return tokenId;
}

/**
 * Verify and consume a one-time token (deletes after verification)
 * @param env Worker environment
 * @param token Token to verify
 * @returns Stored payload data
 * @throws Error if token not found or expired
 */
export async function verifyToken(env: Env, token: string): Promise<any> {
  const data = await env.AUTH_TOKENS.get(token, "json");
  if (!data) throw new Error("Token not found or expired");
  await env.AUTH_TOKENS.delete(token);
  return data;
}

/**
 * Sign an arbitrary payload with HMAC-SHA256 using AUTH_SECRET.
 * Returns URL-safe base64: `{dataBase64}.{signatureBase64}`
 * Used for both magic link tokens and session tokens.
 */
export async function signPayload(env: Env, payload: object): Promise<string> {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET not configured');

  const data = JSON.stringify(payload);
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  const dataBase64 = btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${dataBase64}.${sigBase64}`;
}

/**
 * Verify an HMAC-SHA256 signed token. Returns the parsed payload.
 * Throws on invalid format, bad signature, or decode errors.
 */
export async function verifySessionToken(env: Env, token: string): Promise<any> {
  const [dataBase64, sigBase64] = token.split('.');
  if (!dataBase64 || !sigBase64) {
    throw new Error('Invalid token format');
  }

  const encoder = new TextEncoder();

  // Convert URL-safe base64 → standard base64 → decode
  let data: string;
  try {
    const standardData = dataBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(dataBase64.length + (4 - dataBase64.length % 4) % 4, '=');
    data = atob(standardData);
  } catch {
    throw new Error('Invalid token encoding');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  let signature: Uint8Array;
  try {
    const standardSig = sigBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(sigBase64.length + (4 - sigBase64.length % 4) % 4, '=');
    signature = Uint8Array.from(atob(standardSig), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('Invalid signature encoding');
  }

  const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
  if (!valid) {
    throw new Error('Invalid signature');
  }

  return JSON.parse(data);
}

/**
 * Generate a 30-day session token for a user.
 * Delegates to signPayload() for HMAC signing.
 */
export async function generateSessionToken(env: Env, email: string, userId: string): Promise<string> {
  return signPayload(env, {
    email,
    id: userId,
    iat: Date.now(),
    exp: Date.now() + SESSION_EXPIRY
  });
}

/**
 * JIT D1 user sync — upserts user record on login/auth.
 * Uses ON CONFLICT DO UPDATE to keep D1 fresh while preserving D1-only fields
 * (last_login, total_logins, cancellation fields, etc.).
 */
export async function ensureUserInD1(env: Env, user: any): Promise<void> {
  if (!env.WELLS_DB) return;

  const id = `user_${user.id}`;
  const fields = user.fields || {};

  await env.WELLS_DB.prepare(`
    INSERT INTO users (
      id, airtable_record_id, email, name, plan, status,
      organization_id, role, stripe_customer_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(airtable_record_id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      plan = excluded.plan,
      status = excluded.status,
      organization_id = excluded.organization_id,
      role = excluded.role,
      stripe_customer_id = excluded.stripe_customer_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id,
    user.id,
    fields.Email || null,
    fields.Name || null,
    fields.Plan || 'Free',
    fields.Status || 'Active',
    fields.Organization?.[0] || null,
    fields.Role || 'Viewer',
    fields['Stripe Customer ID'] || null
  ).run();
}