/**
 * Response Utilities
 * 
 * Common response helpers and utilities for the Portal Worker
 */

import { CORS_HEADERS, SECURITY_HEADERS } from '../constants.js';
import { authenticateRequest } from './auth.js';

/**
 * Create a JSON response with CORS headers
 * @param data The data to return as JSON
 * @param status HTTP status code (default: 200)
 * @returns Response object with JSON content type and CORS headers
 */
export function jsonResponse(data: any, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

/**
 * Serve an HTML page with security headers
 * @param html The HTML content to serve
 * @param request The incoming request (for potential future use)
 * @param env The environment bindings (for potential future use)
 * @returns Response object with HTML content type and security headers
 */
export function servePage(html: string, request?: Request, env?: any): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      ...SECURITY_HEADERS
    }
  });
}

/**
 * Create a redirect response with an error message
 * @param message The error message to include in query params
 * @returns 302 redirect response to login page with error
 */
export function redirectWithError(message: string): Response {
  const params = new URLSearchParams({ error: message });
  return new Response(null, {
    status: 302,
    headers: { "Location": `/portal/login?${params}` }
  });
}

/**
 * Create a simple 404 Not Found response
 * @returns 404 response
 */
export function notFoundResponse(): Response {
  return new Response("Not Found", { status: 404 });
}

/**
 * Create a CORS preflight response
 * @returns Response with CORS headers for OPTIONS requests
 */
export function corsResponse(): Response {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * Create an error response
 * @param message Error message
 * @param status HTTP status code (default: 500)
 * @returns JSON error response
 */
export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Serve a protected HTML page (requires authentication)
 * @param html The HTML content to serve
 * @param request The incoming request
 * @param env The environment bindings
 * @returns Response object with HTML or redirect to login
 */
export async function serveProtectedPage(html: string, request: Request, env: any): Promise<Response> {
  // Check if user is authenticated
  const authResult = await authenticateRequest(request, env);
  if (!authResult.authenticated || !authResult.user) {
    // Not authenticated - redirect to login
    const url = new URL(request.url);
    const returnPath = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": `/portal/login?return=${returnPath}`
      }
    });
  }
  
  // User is authenticated - serve the page
  return servePage(html, request, env);
}