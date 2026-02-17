/**
 * Authentication Utilities
 * 
 * Handles session management, token generation/verification, and cookie parsing
 * for the Portal Worker authentication system
 */

import { COOKIE_NAME, SUPER_ADMIN_EMAILS } from '../constants.js';
import { getUserById } from '../services/airtable.js';
import type { Env } from '../types/env.js';

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
    const sessionPayload: SessionPayload = {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // Session valid for 30 days
      airtableUser: userData.airtableUser
    };

    // Session revocation check: compare session iat against per-user revocation timestamp
    if (env.AUTH_TOKENS && sessionPayload.id) {
      const revokedAfter = await env.AUTH_TOKENS.get(`sess_valid_after:${sessionPayload.id}`);
      if (revokedAfter) {
        // Decode cookie to extract iat from the session token
        const sessionCookie = getCookieValue(cookie, COOKIE_NAME);
        let sessionIat = 0;
        if (sessionCookie) {
          try {
            const [dataB64] = sessionCookie.split('.');
            const padded = dataB64.replace(/-/g, '+').replace(/_/g, '/');
            const decoded = JSON.parse(atob(padded));
            sessionIat = decoded.iat || 0;
          } catch { /* old token format without iat */ }
        }
        // Reject if session was issued before revocation (or has no iat)
        if (sessionIat < parseInt(revokedAfter, 10)) {
          console.log(`[Auth] Session revoked for user ${sessionPayload.id}: iat=${sessionIat} < valid_after=${revokedAfter}`);
          return null;
        }
      }
    }

    // Super admin impersonation: ?act_as=recXXX
    const url = new URL(request.url);
    const actAs = url.searchParams.get('act_as');

    if (actAs) {
      if (!isSuperAdmin(sessionPayload.email)) {
        // Non-admin tried act_as — silently ignore
        return sessionPayload;
      }

      const targetUser = await getUserById(env, actAs);
      if (!targetUser) {
        console.warn(`[Impersonate] Target user ${actAs} not found`);
        return sessionPayload;
      }

      console.log(`[Impersonate] ${sessionPayload.email} acting as ${targetUser.fields.Email} (${actAs})`);

      // Audit trail: write to KV with 90-day TTL
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
        env.OCC_CACHE.put(auditKey, auditEntry, { expirationTtl: 7776000 }); // 90 days
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
    iat: Date.now(),
    exp: Date.now() + SESSION_EXPIRY
  };
  
  // Use the same secret as auth-worker
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET not configured');
  
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
  
  // Use URL-safe base64 encoding to prevent mobile email client issues
  const dataBase64 = btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  // Return in the format expected by auth-worker
  return `${dataBase64}.${sigBase64}`;
}