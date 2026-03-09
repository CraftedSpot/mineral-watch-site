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

  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });

  return { allowed: true, remaining: max - count - 1 };
}

/**
 * Extract user ID from session cookie by verifying the HMAC signature.
 * Returns null if cookie is missing, malformed, or signature is invalid.
 */
async function extractVerifiedSession(
  request: Request,
  authSecret: string | undefined,
): Promise<{ userId: string; email: string } | null> {
  if (!authSecret) return null;
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(^| )${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const token = match[2];
  const [dataB64, sigB64] = token.split('.');
  if (!dataB64 || !sigB64) return null;

  try {
    const encoder = new TextEncoder();
    const standardData = dataB64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(dataB64.length + (4 - dataB64.length % 4) % 4, '=');
    const data = atob(standardData);

    // Verify HMAC
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(authSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const standardSig = sigB64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(sigB64.length + (4 - sigB64.length % 4) % 4, '=');
    const sigBytes = Uint8Array.from(atob(standardSig), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
    if (!valid) return null;

    const decoded = JSON.parse(data);
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
 * Verifies session HMAC before trusting user identity.
 * Super admins bypass rate limits entirely.
 *
 * Returns a 429 Response if rate limited, or null if allowed.
 */
export async function rateLimitUser(
  request: Request,
  kv: KVNamespace,
  endpoint: string,
  max: number,
  windowSeconds: number,
  authSecret?: string,
): Promise<Response | null> {
  const session = await extractVerifiedSession(request, authSecret);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Super admin bypass — only trusted after HMAC verification
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
