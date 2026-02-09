/**
 * KV-based rate limiter for portal-worker.
 *
 * Uses KV expiration TTL as the window. Keys: rl:{endpoint}:{ip}
 * Value: request count (string). TTL = window duration.
 *
 * Note: KV is eventually consistent, so concurrent requests from different
 * PoPs may race. This is acceptable for abuse prevention — worst case a
 * few extra requests slip through at the boundary.
 */

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function rateLimit(
  kv: KVNamespace,
  endpoint: string,
  ip: string,
  max: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const key = `rl:${endpoint}:${ip}`;

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
