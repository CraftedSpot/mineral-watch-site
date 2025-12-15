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
 * Authenticate a request by verifying the session cookie with auth-worker
 * @param request The incoming request
 * @param env Worker environment
 * @returns User session payload or null if not authenticated
 */
export async function authenticateRequest(request: Request, env: Env): Promise<SessionPayload | null> {
  // Get the session cookie from the request
  const cookie = request.headers.get("Cookie") || "";
  
  // Use service binding if available, otherwise fall back to HTTP
  try {
    let authResponse: Response;
    
    if (env.AUTH_WORKER) {
      // Use service binding (faster, no request limits)
      const authRequest = new Request('https://auth-worker/api/auth/me', {
        headers: {
          'Cookie': cookie
        }
      });
      authResponse = await env.AUTH_WORKER.fetch(authRequest);
    } else {
      // Fallback to HTTP
      console.warn('AUTH_WORKER service binding not configured, using HTTP');
      authResponse = await fetch('https://auth-worker.photog12.workers.dev/api/auth/me', {
        headers: {
          'Cookie': cookie
        }
      });
    }
    
    if (!authResponse.ok) {
      return null;
    }
    
    const userData = await authResponse.json() as any;
    
    // Convert auth-worker response to SessionPayload format
    return {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // Session valid for 30 days
    };
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

// Note: Session verification is now handled by auth-worker
// The generateToken and verifyToken functions below are still used
// for the Track This Well feature, not for user authentication

/**
 * Generate a session token compatible with auth-worker
 * This creates the same HMAC-based token format that auth-worker expects
 */
export async function generateSessionToken(env: Env, email: string, userId: string): Promise<string> {
  const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
  
  const payload = {
    email: email,
    id: userId,
    exp: Date.now() + SESSION_EXPIRY
  };
  
  // Use the same secret as auth-worker
  const secret = env.AUTH_SECRET || 'default-secret-change-me';
  
  // Create the token in the same format as auth-worker
  const data = JSON.stringify(payload);
  const encoder = new TextEncoder();
  
  // Import the secret for HMAC
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // Create signature
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  
  // Encode both parts as base64
  const dataBase64 = btoa(data);
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  // Return in the format expected by auth-worker
  return `${dataBase64}.${sigBase64}`;
}