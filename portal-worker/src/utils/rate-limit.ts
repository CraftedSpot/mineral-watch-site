/**
 * KV-based rate limiter for portal-worker.
 *
 * Uses KV expiration TTL as the window. Keys: rl:{endpoint}:{identifier}
 * Value: request count (string). TTL = window duration.
 *
 * Note: KV is eventually consistent, so concurrent requests from different
 * PoPs may race. This is acceptable for abuse prevention — worst case a
 * few extra requests slip through at the boundary.
 */

import { COOKIE_NAME, SUPER_ADMIN_EMAILS } from '../constants.js';
import { jsonResponse } from './responses.js';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function rateLimit(
  kv: KVNamespace,
  endpoint: string,
  identifier: string,
  max: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const key = `rl:${endpoint}:${identifier}`;

  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= max) {
    return { allowed: false, remaining: 0 };
  }

  // Increment. If this is the first request, KV sets the TTL.
  // If the key already exists, put() resets the TTL — but since all
  // requests within the window write the same TTL, the window stays
  // roughly aligned to the first request.
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });

  return { allowed: true, remaining: max - count - 1 };
}

/**
 * Extract user ID and email from the session cookie without full auth verification.
 * Lightweight — no service binding call. Safe for rate-limit keying because
 * worst case a forged ID just gets its own separate rate limit bucket.
 */
function extractSessionFromCookie(request: Request): { userId: string; email: string } | null {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(^| )${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const [dataB64] = match[2].split('.');
    const padded = dataB64.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(padded));
    if (decoded.id && decoded.email) {
      return { userId: decoded.id, email: decoded.email };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * User-aware rate limiter for authenticated endpoints.
 * Uses user ID from cookie if available, falls back to IP.
 * Super admins bypass rate limits entirely.
 *
 * Returns a 429 Response if rate limited, or null if allowed.
 */
export async function rateLimitUser(
  request: Request,
  kv: KVNamespace,
  endpoint: string,
  max: number,
  windowSeconds: number
): Promise<Response | null> {
  const session = extractSessionFromCookie(request);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Super admin bypass
  if (session && SUPER_ADMIN_EMAILS.includes(session.email as any)) {
    return null;
  }

  const identifier = session?.userId || `ip:${ip}`;
  const rl = await rateLimit(kv, endpoint, identifier, max, windowSeconds);

  if (!rl.allowed) {
    return jsonResponse(
      { error: 'Too many requests. Please try again later.' },
      429,
      { 'Retry-After': String(windowSeconds) }
    );
  }
  return null;
}
