/**
 * Response Utilities
 * 
 * Common response helpers and utilities for the Portal Worker
 */

import { CORS_HEADERS } from '../constants.js';

/**
 * Create a JSON response with CORS headers
 * @param data The data to return as JSON
 * @param status HTTP status code (default: 200)
 * @returns Response object with JSON content type and CORS headers
 */
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

/**
 * Serve an HTML page
 * @param html The HTML content to serve
 * @param request The incoming request (for potential future use)
 * @param env The environment bindings (for potential future use)
 * @returns Response object with HTML content type
 */
export function servePage(html: string, request?: Request, env?: any): Response {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
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