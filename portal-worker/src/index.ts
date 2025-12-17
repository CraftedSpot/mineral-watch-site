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
        
        // Base64 encode the token to avoid any injection issues
        // This prevents special characters from breaking the JavaScript string
        const tokenBase64 = btoa(token);
        
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
  <div class="loading" onclick="document.getElementById('debug-info').style.display='block'">
    <div class="spinner"></div>
    <div id="status-message">Completing login v2...</div>
    <div id="timeout-message" style="margin-top: 20px; color: #718096; font-size: 14px; display: none;">
      This is taking longer than usual. Please wait...
    </div>
    <div id="debug-info" style="margin-top: 30px; padding: 10px; background: #f0f0f0; border-radius: 4px; font-size: 12px; color: #666; max-width: 400px; word-break: break-all; display: none;">
      <strong>Debug Info:</strong>
      <div id="debug-content"></div>
      <div style="margin-top: 10px; color: #999;">Tap anywhere to hide</div>
    </div>
  </div>
  <script>
    // Show debug info on mobile
    const debugInfo = [];
    function addDebug(msg) {
      debugInfo.push(new Date().toISOString().substr(11, 12) + ': ' + msg);
      document.getElementById('debug-content').innerHTML = debugInfo.join('<br>');
      console.log(msg);
    }
    
    
    // Only show debug panel if there's an error or URL has debug=true
    const showDebug = window.location.search.includes('debug=true');
    if (showDebug) {
      setTimeout(() => {
        document.getElementById('debug-info').style.display = 'block';
      }, 500);
    }
    
    // Decode the base64 encoded token
    let fullToken;
    try {
      fullToken = atob('${tokenBase64}');
    } catch (e) {
      console.error('Failed to decode token:', e);
      addDebug('ERROR: Failed to decode token: ' + e.message);
      window.location.href = "/portal/login?error=Invalid%20authentication%20token";
      return;
    }
    
    // Only log detailed debug info if debug mode is on
    if (showDebug) {
      addDebug('Token length: ' + fullToken.length);
      addDebug('Is mobile: ' + /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    }
    
    // Clear any existing session cookie first
    document.cookie = "${COOKIE_NAME}=; path=/; secure; samesite=lax; max-age=0";
    
    // Add a small delay for mobile browsers to ensure cookie is cleared
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const verifyDelay = isMobile ? 500 : 0;
    
    // Show "taking longer" message after 3 seconds
    setTimeout(() => {
      document.getElementById('timeout-message').style.display = 'block';
    }, 3000);
    
    // Add timeout handler - if takes more than 15 seconds, show error
    const timeoutId = setTimeout(() => {
      console.error('Authentication timeout - took more than 15 seconds');
      window.location.href = "/portal/login?error=" + encodeURIComponent("Authentication timeout. Please try again.");
    }, 15000);
    
    setTimeout(() => {
      // Try auth-worker verification first
      const verifyUrl = '/api/auth/verify?token=' + encodeURIComponent(fullToken);
      fetch(verifyUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin'
      })
      .then(async response => {
        addDebug('Auth response: ' + response.status + ', redirected: ' + response.redirected);
        
        // Read response text once
        const responseText = await response.text();
        addDebug('Response length: ' + responseText.length + ' chars');
        
        if (response.ok) {
          try {
            // Try to parse JSON response
            const data = JSON.parse(responseText);
            addDebug('Auth success: ' + data.success);
            if (data.success) {
              // Clear timeout since we succeeded
              clearTimeout(timeoutId);
              addDebug('Login successful, redirecting...');
              // Successful verification
              window.location.href = data.redirect || '/portal';
              return;
            }
          } catch (jsonError) {
            addDebug('JSON parse error: ' + jsonError.message);
          }
        }
        
        if (!response.ok) {
          // Show debug panel on error
          document.getElementById('debug-info').style.display = 'block';
          
          // Try to get error message from auth response
          try {
            const errorData = JSON.parse(responseText);
            addDebug('Auth error: ' + errorData.error);
            // If we have a specific error from auth-worker, use it
            if (errorData.error) {
              setTimeout(() => {
                window.location.href = "/portal/login?error=" + encodeURIComponent(errorData.error);
              }, 3000); // Give time to read debug info
              return;
            }
          } catch (e) {
            addDebug('Could not parse error response');
          }
          
          // Only try invite verification if auth-worker returned 401/404 (not 400 bad request)
          if (response.status === 401 || response.status === 404) {
            console.log('Trying invite verification as fallback...');
            return fetch('/api/auth/verify-invite?token=${token}')
              .then(inviteResponse => inviteResponse.json())
              .then(data => {
                console.log('Invite verify response:', data);
                if (data.success && data.sessionToken) {
                  // Clear timeout since we succeeded
                  clearTimeout(timeoutId);
                  // Set the session token as cookie
                  document.cookie = "${COOKIE_NAME}=" + data.sessionToken + "; path=/; secure; samesite=lax; max-age=2592000";
                  console.log('Set session cookie for invite verification');
                  
                  // Redirect to dashboard after small delay (longer for mobile)
                  const redirectDelay = isMobile ? 500 : 100;
                  setTimeout(() => {
                    window.location.href = "/portal";
                  }, redirectDelay);
                } else {
                  // Verification failed - redirect to login with error
                  window.location.href = "/portal/login?error=" + encodeURIComponent(data.error || "Invalid or expired link");
                }
              })
              .catch(err => {
                console.error('Invite verification also failed:', err);
                window.location.href = "/portal/login?error=Invalid%20or%20expired%20link";
              });
          } else {
            // For other errors, show generic message
            window.location.href = "/portal/login?error=Verification%20failed";
          }
        }
      })
      .catch(error => {
        console.error('Verification error:', error.message || error);
        console.error('Error stack:', error.stack);
        
        // Clear the timeout since we're handling an error
        clearTimeout(timeoutId);
        
        // Show debug panel on network/fetch errors too
        document.getElementById('debug-info').style.display = 'block';
        addDebug('Network/Fetch error: ' + (error.message || error));
        addDebug('This might be a connection issue or CORS problem');
        
        // Give time to see the error before redirecting
        setTimeout(() => {
          window.location.href = "/portal/login?error=Verification%20failed";
        }, 3000);
      });
    }, verifyDelay); // End of setTimeout
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
        console.log(`[Portal] AUTH_WORKER binding available: ${!!env.AUTH_WORKER}`);
        try {
          let authResponse: Response;
          
          if (env.AUTH_WORKER) {
            // Use service binding (faster, more reliable)
            console.log(`[Portal] Using service binding to auth-worker`);
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
          
          // Only handle redirects if it's not a JSON response
          const contentType = authResponse.headers.get('Content-Type');
          const isJsonResponse = contentType && contentType.includes('application/json');
          
          if (!isJsonResponse && (authResponse.status === 302 || authResponse.status === 301)) {
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

