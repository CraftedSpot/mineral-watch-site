// UPDATED MINERAL WATCH PORTAL WORKER - WITH WELLS SUPPORT
// Deploy with: wrangler deploy

// Import constants and utilities from modular files
import { 
  COOKIE_NAME, 
  TOKEN_EXPIRY, 
  SESSION_EXPIRY, 
  BASE_ID, 
  USERS_TABLE, 
  PROPERTIES_TABLE, 
  WELLS_TABLE, 
  ACTIVITY_TABLE,
  WELL_LOCATIONS_TABLE,
  BASE_URL, 
  PLAN_LIMITS,
  OCC_CACHE_TTL, 
  CORS_HEADERS,
  PRICE_IDS,
  PRICE_TO_PLAN
} from './constants.js';

import { 
  jsonResponse, 
  servePage,
  serveProtectedPage,
  redirectWithError, 
  notFoundResponse, 
  corsResponse, 
  errorResponse 
} from './utils/responses.js';

import { 
  dashboardHtml, 
  loginHtml, 
  accountHtml, 
  upgradeHtml,
  myPropertiesMapHtml,
  oklahomaMapHtml,
  adminBackfillHtml
} from './templates/index.js';

import {
  findUserByEmail,
  getUserById,
  countUserProperties,
  countUserWells,
  checkDuplicateProperty,
  checkDuplicateWell,
  fetchAllAirtableRecords,
  fetchUserProperties,
  fetchUserWells
} from './services/airtable.js';

import {
  authenticateRequest,
  generateToken,
  verifyToken,
  getCookieValue
} from './utils/auth.js';

import {
  sendMagicLinkEmail,
  sendWelcomeEmail,
  sendInviteEmail,
  getFreeWelcomeEmailHtml,
  getFreeWelcomeEmailText,
  getInviteEmailHtml,
  getInviteEmailText
} from './services/postmark.js';

// Import all handlers from central index
import {
  // Activity handlers
  handleListActivity,
  handleActivityStats,
  handleDeleteActivity,
  // Property handlers
  handleListProperties,
  handleAddProperty,
  handleUpdateProperty,
  handleDeleteProperty,
  // Wells handlers
  handleListWells,
  handleAddWell,
  handleDeleteWell,
  handleUpdateWellNotes,
  fetchWellDetailsFromOCC,
  // Billing handlers
  handleBillingPortal,
  handleUpgrade,
  handleUpgradeSuccess,
  // Bulk handlers
  handleBulkValidateProperties,
  handleBulkUploadProperties,
  handleBulkValidateWells,
  handleBulkUploadWells,
  // Track-well handlers
  handleTrackThisWell,
  validateTrackToken,
  generateTrackWellSuccessPage,
  generateTrackWellErrorPage,
  // OCC proxy handler
  handleOccProxy,
  // Formation backfill handlers
  handleBackfillFormations,
  handleGetFormationForActivity,
  // Well locations backfill handler
  handleBackfillWellLocations,
  // Statewide activity handler
  handleStatewideActivity,
  // Statewide activity backfill handler
  handleBackfillStatewideActivity
} from './handlers/index.js';

import type { Env } from './types/env.js';


var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var index_default = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Debug logging
    console.log(`[Portal] Incoming request: ${request.method} ${path}`);
    console.log(`[Portal] Full URL: ${url.href}`);
    console.log(`[Portal] AUTH_WORKER binding available: ${!!env.AUTH_WORKER}`);
    
    if (request.method === "OPTIONS") {
      return corsResponse();
    }
    try {
      if (path === "/" || path === "") {
        return Response.redirect(`${BASE_URL}/portal`, 302);
      }
      if (path === "/portal" || path === "/portal/") {
        return servePage(dashboardHtml, request, env);
      }
      if (path === "/portal/login" || path === "/portal/login/") {
        return servePage(loginHtml, request, env);
      }
      if (path === "/portal/account" || path === "/portal/account/") {
        return servePage(accountHtml, request, env);
      }
      if (path === "/portal/upgrade" || path === "/portal/upgrade/") {
        return servePage(upgradeHtml, request, env);
      }
      if (path === "/portal/map" || path === "/portal/map/") {
        return servePage(myPropertiesMapHtml, request, env);
      }
      if (path === "/portal/oklahoma-map" || path === "/portal/oklahoma-map/") {
        return servePage(oklahomaMapHtml, request, env);
      }
      
      // Safari-compatible session setting endpoint - MUST come before auth proxy
      if (path === "/api/auth/set-session" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) {
          return Response.redirect(`${BASE_URL}/portal/login?error=Missing%20session%20token`, 302);
        }
        
        // Serve an intermediate HTML page that sets cookie via JavaScript
        const html = `<!DOCTYPE html>
<html>
<head>
  <title>Completing login...</title>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .loading {
      text-align: center;
      color: #334E68;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #e0e0e0;
      border-top: 4px solid #C05621;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <div>Completing login...</div>
  </div>
  <script>
    // Clear any existing session cookie first
    document.cookie = "${COOKIE_NAME}=; path=/; secure; samesite=lax; max-age=0";
    
    // Try auth-worker verification first (for regular login/registration)
    // If that fails, try portal's invite verification (for organization invites)
    fetch('/api/auth/verify?token=${token}', {
      credentials: 'same-origin'
    })
      .then(response => {
        if (response.redirected) {
          // Auth-worker handled it with a redirect
          window.location.href = response.url;
        } else if (!response.ok) {
          // Auth-worker couldn't verify, try invite verification
          return fetch('/api/auth/verify-invite?token=${token}')
            .then(inviteResponse => inviteResponse.json())
            .then(data => {
              if (data.success && data.sessionToken) {
                // Set the session token as cookie
                document.cookie = "${COOKIE_NAME}=" + data.sessionToken + "; path=/; secure; samesite=lax; max-age=2592000";
                
                // Redirect to dashboard after small delay
                setTimeout(() => {
                  window.location.href = "/portal";
                }, 100);
              } else {
                // Verification failed - redirect to login with error
                window.location.href = "/portal/login?error=" + encodeURIComponent(data.error || "Invalid or expired link");
              }
            });
        }
      })
      .catch(error => {
        console.error('Verification error:', error);
        window.location.href = "/portal/login?error=Verification%20failed";
      });
  </script>
</body>
</html>`;
        
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        });
      }
      
      // Handle email verification/magic links
      if (path === "/portal/verify" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) {
          return Response.redirect(`${BASE_URL}/portal/login?error=Invalid%20verification%20link`, 302);
        }
        
        // Redirect to set-session endpoint which handles the token verification
        return Response.redirect(`${BASE_URL}/api/auth/set-session?token=${token}`, 302);
      }
      
      // Handle invite token verification BEFORE auth proxy (different from regular magic links)
      if (path === "/api/auth/verify-invite" && request.method === "GET") {
        const { handleVerifyInvite } = await import('./handlers/organization.js');
        return handleVerifyInvite(request, env, url);
      }
      
      // Registration stays in portal-worker (creates users, sends welcome emails)
      if (path === "/api/auth/register" && request.method === "POST") {
        const { handleRegister } = await import('./handlers/auth.js');
        return handleRegister(request, env);
      }
      
      // Proxy auth endpoints to auth-worker
      if (path.startsWith("/api/auth/")) {
        console.log(`[Portal] Proxying auth request: ${path}`);
        try {
          let authResponse: Response;
          
          if (env.AUTH_WORKER) {
            // Use service binding (faster, more reliable)
            const authRequest = new Request(`https://auth-worker${path}${url.search}`, {
              method: request.method,
              headers: request.headers,
              body: request.body,
              redirect: 'manual' // Don't follow redirects automatically
            });
            authResponse = await env.AUTH_WORKER.fetch(authRequest);
          } else {
            // Fallback to HTTP
            console.warn('AUTH_WORKER service binding not configured, using HTTP');
            const authUrl = `https://auth-worker.photog12.workers.dev${path}${url.search}`;
            authResponse = await fetch(authUrl, {
              method: request.method,
              headers: request.headers,
              body: request.body,
              redirect: 'manual' // Don't follow redirects automatically
            });
          }
          
          // Handle redirects from auth-worker specially
          if (authResponse.status === 302 || authResponse.status === 301) {
            const location = authResponse.headers.get('Location');
            if (location) {
              // If it's a relative redirect, make it absolute
              const absoluteLocation = location.startsWith('http') 
                ? location 
                : `https://portal.mymineralwatch.com${location}`;
              
              // Create new headers without duplicating Location
              const responseHeaders = new Headers();
              
              // Copy all headers except Location
              authResponse.headers.forEach((value, key) => {
                if (key.toLowerCase() !== 'location') {
                  responseHeaders.set(key, value);
                }
              });
              
              // Set the corrected Location
              responseHeaders.set('Location', absoluteLocation);
              
              // Add CORS headers
              Object.entries(CORS_HEADERS).forEach(([key, value]) => {
                responseHeaders.set(key, value);
              });
              
              // Return the redirect
              return new Response(null, {
                status: authResponse.status,
                headers: responseHeaders
              });
            }
          }
          
          // Return auth-worker response with CORS headers
          return new Response(await authResponse.text(), {
            status: authResponse.status,
            headers: {
              ...Object.fromEntries(authResponse.headers.entries()),
              ...CORS_HEADERS
            }
          });
        } catch (error) {
          console.error('Auth proxy error:', error);
          return jsonResponse({ 
            error: 'Authentication service temporarily unavailable. Please try again later.' 
          }, 503);
        }
      }
      
      // Properties endpoints
      if (path === "/api/properties" && request.method === "GET") {
        return handleListProperties(request, env);
      }
      if (path === "/api/properties" && request.method === "POST") {
        return handleAddProperty(request, env);
      }
      const propertyIdMatch = path.match(/^\/api\/properties\/([a-zA-Z0-9]+)$/);
      if (propertyIdMatch && request.method === "PATCH") {
        return handleUpdateProperty(propertyIdMatch[1], request, env);
      }
      if (propertyIdMatch && request.method === "DELETE") {
        return handleDeleteProperty(propertyIdMatch[1], request, env);
      }
      
      // Wells endpoints
      if (path === "/api/wells" && request.method === "GET") {
        return handleListWells(request, env);
      }
      if (path === "/api/wells" && request.method === "POST") {
        return handleAddWell(request, env);
      }
      const deleteWellMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)$/);
      if (deleteWellMatch && request.method === "DELETE") {
        return handleDeleteWell(deleteWellMatch[1], request, env);
      }
      const wellNotesMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/notes$/);
      if (wellNotesMatch && request.method === "PATCH") {
        return handleUpdateWellNotes(wellNotesMatch[1], request, env);
      }
      
      // Activity endpoint
      if (path === "/api/activity" && request.method === "GET") {
        return handleListActivity(request, env);
      }
      if (path === "/api/activity/stats" && request.method === "GET") {
        return handleActivityStats(request, env);
      }
      const deleteActivityMatch = path.match(/^\/api\/activity\/([a-zA-Z0-9]+)$/);
      if (deleteActivityMatch && request.method === "DELETE") {
        return handleDeleteActivity(deleteActivityMatch[1], request, env);
      }
      
      // Organization endpoints
      if (path === "/api/organization" && request.method === "GET") {
        const { handleGetOrganization } = await import('./handlers/organization.js');
        return handleGetOrganization(request, env);
      }
      if (path === "/api/organization/invite" && request.method === "POST") {
        const { handleInviteMember } = await import('./handlers/organization.js');
        return handleInviteMember(request, env);
      }
      const memberRoleMatch = path.match(/^\/api\/organization\/members\/([a-zA-Z0-9]+)\/role$/);
      if (memberRoleMatch && request.method === "PATCH") {
        const { handleUpdateMemberRole } = await import('./handlers/organization.js');
        return handleUpdateMemberRole(request, env, memberRoleMatch[1]);
      }
      const memberDeleteMatch = path.match(/^\/api\/organization\/members\/([a-zA-Z0-9]+)$/);
      if (memberDeleteMatch && request.method === "DELETE") {
        const { handleRemoveMember } = await import('./handlers/organization.js');
        return handleRemoveMember(request, env, memberDeleteMatch[1]);
      }
      
      // Statewide activity endpoint (for heatmap)
      if (path === "/api/activity/statewide" && request.method === "GET") {
        return handleStatewideActivity(request, env);
      }
      
      // Bulk upload endpoints
      if (path === "/api/bulk-validate-properties" && request.method === "POST") {
        return handleBulkValidateProperties(request, env);
      }
      if (path === "/api/bulk-upload-properties" && request.method === "POST") {
        return handleBulkUploadProperties(request, env);
      }
      
      // Bulk wells endpoints
      if (path === "/api/bulk-validate-wells" && request.method === "POST") {
        return handleBulkValidateWells(request, env);
      }
      if (path === "/api/bulk-upload-wells" && request.method === "POST") {
        return handleBulkUploadWells(request, env);
      }

      
      if (path === "/api/billing/portal" && request.method === "POST") {
        return handleBillingPortal(request, env);
      }
      if (path === "/api/upgrade" && request.method === "POST") {
        return handleUpgrade(request, env);
      }
      if (path === "/api/upgrade/success" && request.method === "GET") {
        return handleUpgradeSuccess(request, env, url);
      }
      
      // OCC proxy endpoint
      if (path === "/api/occ-proxy" && request.method === "GET") {
        return handleOccProxy(request, env);
      }
      
      // Formation backfill endpoints
      if (path === "/api/backfill-formations" && request.method === "POST") {
        return handleBackfillFormations(request, env);
      }
      if (path === "/api/formation-for-activity" && request.method === "GET") {
        return handleGetFormationForActivity(request, env);
      }
      
      // Well locations backfill endpoint
      if (path === "/api/backfill-well-locations" && request.method === "POST") {
        return handleBackfillWellLocations(request, env);
      }
      
      // Statewide activity backfill endpoint
      if (path === "/api/backfill-statewide-activity" && request.method === "POST") {
        return handleBackfillStatewideActivity(request, env);
      }
      
      // TEMPORARY: Debug Stripe key endpoint
      if (path === "/debug/stripe" && request.method === "GET") {
        const keyPrefix = env.STRIPE_SECRET_KEY?.substring(0, 12) || 'not set';
        const isLive = keyPrefix.includes('sk_live');
        return jsonResponse({ 
          prefix: keyPrefix,
          mode: isLive ? 'LIVE' : 'TEST',
          timestamp: new Date().toISOString()
        });
      }

      // TEMPORARY: Domain bridge for testing
      if (path === "/test-upgrade" && request.method === "GET") {
        return Response.redirect(`https://portal-worker.photog12.workers.dev/portal/upgrade`, 302);
      }

      // Track This Well endpoint
      if (path === "/add-well" && request.method === "GET") {
        return handleTrackThisWell(request, env, url);
      }
      
      // Debug endpoint for token validation
      if (path === "/debug-token" && request.method === "GET") {
        return handleTrackThisWell(request, env, url);
      }
      
      console.log(`[Portal] No route matched for: ${request.method} ${path}`);
      console.log(`[Portal] Path starts with /api/auth/: ${path.startsWith("/api/auth/")}`);
      return notFoundResponse();
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
};

// ====================
// SECURITY HELPERS
// ====================

// HTML escape to prevent XSS attacks from user-generated content
function escapeHtml(text) {
  if (!text) return '';
  const str = String(text);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
__name(escapeHtml, "escapeHtml");
























// ====================
// HTML PAGES
// ====================


// HTML templates removed - now imported from separate files
// - LOGIN_HTML
// - DASHBOARD_HTML
// - ACCOUNT_HTML
// - UPGRADE_HTML

export {
  index_default as default
};

