/**
 * Authentication Utilities
 * 
 * Handles session management, token generation/verification, and cookie parsing
 * for the Portal Worker authentication system
 */

import { COOKIE_NAME } from '../constants.js';
import type { Env } from '../types/env.js';

/**
 * Session payload interface
 */
export interface SessionPayload {
  id: string;
  email: string;
  name?: string;
  exp: number;
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
 * Authenticate a request by verifying the session cookie
 * @param request The incoming request
 * @param env Worker environment
 * @returns User session payload or null if not authenticated
 */
export async function authenticateRequest(request: Request, env: Env): Promise<SessionPayload | null> {
  const cookie = request.headers.get("Cookie") || "";
  const sessionToken = getCookieValue(cookie, COOKIE_NAME);
  if (!sessionToken) return null;
  
  try {
    const payload = await verifySession(env, sessionToken);
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
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
 * Verify a session token without consuming it (for repeated checks)
 * @param env Worker environment  
 * @param token Session token to verify
 * @returns Session payload data
 * @throws Error if session not found or expired
 */
export async function verifySession(env: Env, token: string): Promise<SessionPayload> {
  const data = await env.AUTH_TOKENS.get(token, "json");
  if (!data) throw new Error("Session not found or expired");
  return data;
}