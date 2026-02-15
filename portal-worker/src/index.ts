// UPDATED MINERAL WATCH PORTAL WORKER - WITH WELLS SUPPORT
// Deploy with: wrangler deploy

// Import constants and utilities from modular files
import { 
  COOKIE_NAME,
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
  adminBackfillHtml,
  learnHtml,
  intelligenceHtml,
  operatorsHtml
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
  isSuperAdmin,
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
} from './services/email.js';

// Import all handlers from central index
import {
  // Activity handlers
  handleListActivity,
  handleActivityStats,
  handleDeleteActivity,
  // Property handlers
  handleListProperties,
  handleListPropertiesV2,
  handleAddProperty,
  handleUpdateProperty,
  handleDeleteProperty,
  // Property link counts
  handleGetPropertyLinkCounts,
  // Tools revenue estimator
  handlePropertyProduction,
  handleWellProduction,
  // Wells handlers
  handleListWells,
  handleListWellsV2,
  handleAddWell,
  handleDeleteWell,
  handleUpdateWellNotes,
  handleUpdateWellInterests,
  handleSearchWells,
  fetchWellDetailsFromOCC,
  // Well link counts
  handleGetWellLinkCounts,
  // Nearby wells handlers
  handleNearbyWells,
  handleSurroundingWells,
  // Well enrichment handlers
  handleWellEnrichment,
  handleBulkWellEnrichment,
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
  handleBackfillStatewideActivity,
  handleBackfillSectionCenters,
  handleBackfillBhCoordinates,
  // Property-well matching handler
  handleMatchPropertyWells,
  // Debug handler
  handleDebugAirtable,
  // Property-Wells handlers (now using D1 handlers with dynamic imports)
  // handleGetPropertyLinkedWells, // Removed - using D1 handler
  // handleGetWellLinkedProperties, // Removed - using D1 handler
  handleUnlinkPropertyWell,
  handleRelinkPropertyWell,
  // Single item matching handlers
  handleMatchSingleProperty,
  handleMatchSingleWell,
  // Sync handler
  handleAirtableSync,
  // Map data handlers
  handleGetCounties,
  handleGetTownships,
  handleGetCountyStats,
  handleGetCountyProduction,
  handleGetPoolingRates,
  handleGetMapDataVersion,
  // Docket heatmap handler
  handleGetDocketHeatmap,
  // OTC file sync handlers
  handleGetOtcSyncFiles,
  handleCheckOtcFile,
  handleCheckOtcFilesBatch,
  handleRecordOtcFile,
  // OTC production upload handlers
  handleUploadProductionData,
  handleGetProductionStats,
  handleUploadPunProductionData,
  handleComputePunRollups,
  handleGetPunProductionStats,
  handleTruncatePunProduction,
  // OTC financial upload handlers
  handleUploadFinancialData,
  handleGetFinancialStats,
  handleTruncateFinancial,
  // Completion reports handlers
  handleGetCompletionReports,
  handleAnalyzeCompletion,
  handleGetProductionSummary,
  handleGetDecimalInterest,
  // Drilling permits handlers (Form 1000)
  handleGetDrillingPermits,
  handleAnalyzePermit,
  handleSyncPermitToWell,
  // Completions-to-wells sync handlers
  handleSyncCompletionsToWells,
  handleSyncSingleCompletion,
  // Unit print report handlers
  handleUnitPrint,
  handleUnitPrintData,
  // Document print report handler
  handleDocumentPrint,
  // PLSS sections handlers
  handleGetPlssSection,
  handleGetPlssSectionsBatch,
  // County records handlers
  handleCountyRecordsCounties,
  handleCountyRecordsInstrumentTypes,
  handleCountyRecordsSearch,
  handleCountyRecordsRetrieve
} from './handlers/index.js';

import { rateLimit } from './utils/rate-limit.js';
import type { Env } from './types/env.js';
import { syncAirtableData } from './sync.js';


var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// OTC Fly machine URL (static IP for OTC allowlist)
const OTC_FLY_URL = 'https://mineral-watch-otc-fetch.fly.dev';

async function triggerOTCSync(env: Env): Promise<void> {
  console.log('[OTC Sync] Triggering OTC production sync...');

  try {
    const response = await fetch(`${OTC_FLY_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OTC_SYNC_AUTH_TOKEN || ''}`
      }
    });

    const result = await response.json() as Record<string, unknown>;

    if (response.ok) {
      console.log('[OTC Sync] Sync triggered successfully:', result);
    } else {
      console.error('[OTC Sync] Failed to trigger sync:', response.status, result);
    }
  } catch (error) {
    console.error('[OTC Sync] Error triggering sync:', error);
  }
}

var index_default = {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cronExpression = event.cron;
    console.log(`Cron triggered: ${cronExpression}`);

    // Daily OTC sync (8am UTC / 2am CT)
    if (cronExpression === '0 8 * * *') {
      console.log('Running daily OTC production sync...');
      try {
        await triggerOTCSync(env);
      } catch (error) {
        console.error('OTC sync trigger failed:', error);
      }
      return;
    }

    // Default: Airtable sync (every 15 minutes)
    console.log('Running Airtable sync...');
    try {
      const result = await syncAirtableData(env);
      console.log('Sync completed:', result);
    } catch (error) {
      console.error('Scheduled sync failed:', error);
    }
  },
  
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

    // Simple version endpoint to verify deployments
    if (path === "/api/version") {
      return jsonResponse({ version: "2025-02-06-v3", deployed: new Date().toISOString() });
    }

    // Block search engine crawling of portal subdomain
    if (path === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" }
      });
    }

    try {
      if (path === "/" || path === "") {
        return Response.redirect(`${BASE_URL}/portal`, 302);
      }

      // Legacy signup URLs — redirect to login
      if (path === "/signup" || path === "/signup/") {
        return Response.redirect(`${BASE_URL}/portal/login`, 301);
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
        return servePage(oklahomaMapHtml, request, env);
      }
      if (path === "/portal/oklahoma-map" || path === "/portal/oklahoma-map/") {
        return servePage(oklahomaMapHtml, request, env);
      }
      if (path === "/portal/intelligence" || path === "/portal/intelligence/") {
        return servePage(intelligenceHtml, request, env);
      }
      if (path === "/portal/operators" || path === "/portal/operators/") {
        return servePage(operatorsHtml, request, env);
      }
      if (path === "/portal/learn" || path === "/portal/learn/") {
        return servePage(learnHtml, request, env);
      }

      // Analyze OCC order route - handles email link clicks
      if (path === "/analyze" || path === "/analyze/") {
        const caseNumber = url.searchParams.get("case");
        if (!caseNumber) {
          return Response.redirect(`${BASE_URL}/portal?error=Missing%20case%20number`, 302);
        }
        const safeCaseNumber = escapeHtml(caseNumber);

        // Serve an HTML page that handles the analyze flow
        const analyzeHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Analyzing OCC Order...</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 40px;
      max-width: 500px;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255,255,255,0.3);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 { font-size: 24px; margin-bottom: 10px; }
    p { color: #94a3b8; margin: 10px 0; }
    .case-number {
      background: rgba(255,255,255,0.1);
      padding: 8px 16px;
      border-radius: 6px;
      font-family: monospace;
      display: inline-block;
      margin: 10px 0;
    }
    .error {
      background: #dc2626;
      padding: 15px 20px;
      border-radius: 8px;
      margin-top: 20px;
      display: none;
    }
    .login-prompt {
      background: rgba(255,255,255,0.1);
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
      display: none;
    }
    .login-prompt a {
      display: inline-block;
      background: #10b981;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: bold;
      margin-top: 10px;
    }
    .status { margin-top: 15px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner" id="spinner"></div>
    <h1 id="title">Analyzing OCC Order</h1>
    <div class="case-number">${safeCaseNumber}</div>
    <p class="status" id="status">Fetching order from OCC...</p>
    <div class="error" id="error"></div>
    <div class="login-prompt" id="loginPrompt">
      <p>Please log in to analyze this order.</p>
      <a href="${BASE_URL}/portal/login?redirect=${encodeURIComponent('/analyze?case=' + caseNumber)}">Log In</a>
    </div>
  </div>

  <script>
    const caseNumber = ${JSON.stringify(caseNumber)};

    async function analyzeOrder() {
      const spinner = document.getElementById('spinner');
      const title = document.getElementById('title');
      const status = document.getElementById('status');
      const error = document.getElementById('error');
      const loginPrompt = document.getElementById('loginPrompt');

      try {
        status.textContent = 'Fetching order from OCC...';

        const response = await fetch('/api/occ/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ caseNumber })
        });

        const data = await response.json();

        if (response.status === 401) {
          spinner.style.display = 'none';
          title.textContent = 'Login Required';
          status.style.display = 'none';
          loginPrompt.style.display = 'block';
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || 'Failed to analyze order');
        }

        status.textContent = 'Order fetched! Redirecting...';

        // Redirect to the document view
        if (data.document && data.document.id) {
          window.location.href = '/portal?doc=' + data.document.id;
        } else {
          window.location.href = '/portal';
        }

      } catch (err) {
        spinner.style.display = 'none';
        title.textContent = 'Error';
        status.style.display = 'none';
        error.style.display = 'block';
        error.textContent = err.message || 'Something went wrong. Please try again.';
      }
    }

    // Start analyzing
    analyzeOrder();
  </script>
</body>
</html>`;

        return new Response(analyzeHtml, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ...CORS_HEADERS
          }
        });
      }

      // Safari-compatible session setting endpoint - MUST come before auth proxy
      if (path === "/api/auth/set-session" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) {
          return Response.redirect(`${BASE_URL}/portal/login?error=Missing%20session%20token`, 302);
        }
        
        // Serve an intermediate HTML page that sets cookie via JavaScript
        // We'll pass the token via URL parameter to avoid template injection issues
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
    <div id="status-message">Completing login...</div>
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
    // Immediate test to see if script runs at all
    document.getElementById('debug-content').innerHTML = 'Script started at ' + new Date().toISOString();
    
    // Show debug info on mobile
    const debugInfo = ['Script initialized'];
    function addDebug(msg) {
      debugInfo.push(new Date().toISOString().substr(11, 12) + ': ' + msg);
      document.getElementById('debug-content').innerHTML = debugInfo.join('<br>');
      console.log(msg);
    }
    
    // Get token and redirect from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const fullToken = urlParams.get('token');
    const rawRedirect = urlParams.get('redirect');

    // Validate redirect to prevent open redirect attacks
    function safeRedirect(path) {
      if (!path) return '/portal';
      if (!path.startsWith('/')) return '/portal';
      if (path.startsWith('//')) return '/portal';
      if (path.includes('://')) return '/portal';
      return path;
    }
    const redirectPath = safeRedirect(rawRedirect);

    addDebug('Token from URL: ' + (fullToken ? fullToken.substring(0, 20) + '...' : 'missing'));
    if (rawRedirect) addDebug('Redirect: ' + redirectPath);
    
    if (!fullToken) {
      addDebug('ERROR: No token found in URL');
      setTimeout(() => {
        window.location.href = "/portal/login?error=Missing%20authentication%20token";
      }, 2000);
    } else {
    
    addDebug('Token length: ' + fullToken.length);
    
    // Clear any existing session cookie first
    document.cookie = "mw_session=; path=/; secure; samesite=lax; max-age=0";
    addDebug('Cleared existing session cookie');
    
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
              addDebug('Login successful, redirecting to ' + redirectPath);
              // Successful verification - use redirect from URL param (validated)
              window.location.href = redirectPath;
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
            }
          } catch (e) {
            addDebug('Could not parse error response');
          }
          
          // Only try invite verification if auth-worker returned 401/404 (not 400 bad request)
          if (response.status === 401 || response.status === 404) {
            console.log('Trying invite verification as fallback...');
            return fetch('/api/auth/verify-invite?token=' + encodeURIComponent(fullToken))
              .then(inviteResponse => inviteResponse.json())
              .then(data => {
                console.log('Invite verify response:', data);
                if (data.success && data.sessionToken) {
                  // Clear timeout since we succeeded
                  clearTimeout(timeoutId);
                  // Set the session token as cookie
                  document.cookie = "${COOKIE_NAME}=" + data.sessionToken + "; path=/; secure; samesite=lax; max-age=2592000";
                  console.log('Set session cookie for invite verification');
                  
                  // Redirect after small delay (longer for mobile)
                  const redirectDelay = isMobile ? 500 : 100;
                  setTimeout(() => {
                    window.location.href = redirectPath;
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
    } // End of else block (if fullToken exists)
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

        // Check if this is a KV magic link token (64 hex chars) vs JWT
        // KV tokens are 64 hex characters, JWTs have dots and are longer
        const isKVToken = /^[a-f0-9]{64}$/i.test(token);

        if (isKVToken) {
          // This is a magic link (invite/login) - look up in KV and create session
          const { handleVerifyInvite } = await import('./handlers/organization.js');
          return handleVerifyInvite(request, env, url);
        }

        // JWT/HMAC token - redirect to set-session endpoint
        const redirect = url.searchParams.get("redirect");
        const setSessionUrl = redirect
          ? `${BASE_URL}/api/auth/set-session?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirect)}`
          : `${BASE_URL}/api/auth/set-session?token=${token}`;
        return Response.redirect(setSessionUrl, 302);
      }
      
      // Handle email change verification
      if (path === "/portal/verify-email-change" && request.method === "GET") {
        const { handleVerifyEmailChange } = await import('./handlers/auth.js');
        return handleVerifyEmailChange(request, env, url);
      }
      
      // Handle invite token verification BEFORE auth proxy (different from regular magic links)
      if (path === "/api/auth/verify-invite" && request.method === "GET") {
        const { handleVerifyInvite } = await import('./handlers/organization.js');
        return handleVerifyInvite(request, env, url);
      }
      
      // Registration stays in portal-worker (creates users, sends welcome emails)
      if (path === "/api/auth/register" && request.method === "POST") {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rl = await rateLimit(env.AUTH_TOKENS, 'register', ip, 3, 60);
        if (!rl.allowed) {
          return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429,
            { 'Retry-After': '60' });
        }
        const { handleRegister } = await import('./handlers/auth.js');
        return handleRegister(request, env);
      }
      
      // Handle email change requests
      if (path === "/api/auth/change-email" && request.method === "POST") {
        const { handleChangeEmail } = await import('./handlers/auth.js');
        return handleChangeEmail(request, env);
      }

      // Handle user preferences update
      if (path === "/api/user/preferences" && request.method === "PATCH") {
        const { handleUpdatePreferences } = await import('./handlers/preferences.js');
        return handleUpdatePreferences(request, env);
      }

      // Rate limit magic link requests before proxying to auth-worker
      if (path === "/api/auth/send-magic-link" && request.method === "POST") {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rl = await rateLimit(env.AUTH_TOKENS, 'magic-link', ip, 5, 60);
        if (!rl.allowed) {
          return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429,
            { 'Retry-After': '60' });
        }
        // Fall through to auth proxy below
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

              // Copy all headers except Location and Set-Cookie
              authResponse.headers.forEach((value, key) => {
                if (key.toLowerCase() !== 'location' && key.toLowerCase() !== 'set-cookie') {
                  responseHeaders.set(key, value);
                }
              });
              // Preserve all Set-Cookie headers (getAll supported in CF Workers)
              const redirectCookies = (authResponse.headers as any).getAll('set-cookie');
              for (const cookie of redirectCookies) {
                responseHeaders.append('set-cookie', cookie);
              }
              
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
          // Use Headers object to preserve multiple Set-Cookie headers
          // (Object.fromEntries deduplicates them, breaking logout)
          const respHeaders = new Headers();
          for (const [key, value] of authResponse.headers.entries()) {
            if (key.toLowerCase() !== 'set-cookie') {
              respHeaders.set(key, value);
            }
          }
          // getAll('set-cookie') is supported in Cloudflare Workers
          const setCookies = (authResponse.headers as any).getAll('set-cookie');
          for (const cookie of setCookies) {
            respHeaders.append('set-cookie', cookie);
          }
          Object.entries(CORS_HEADERS).forEach(([key, value]) => {
            respHeaders.set(key, value as string);
          });
          return new Response(await authResponse.text(), {
            status: authResponse.status,
            headers: respHeaders
          });
        } catch (error) {
          console.error('Auth proxy error:', error);
          return jsonResponse({ 
            error: 'Authentication service temporarily unavailable. Please try again later.' 
          }, 503);
        }
      }
      
      // Proxy documents endpoints to documents-worker
      if (path.startsWith("/api/documents")) {
        console.log(`[Portal] Proxying documents request: ${path}${url.search}`);
        if (!env.DOCUMENTS_WORKER) {
          return jsonResponse({ error: 'Documents service not available' }, 503);
        }

        try {
          // Create new request with full URL for service binding (include query params!)
          const documentsUrl = new URL(path + url.search, request.url);
          const headers = new Headers(request.headers);

          // If impersonating, inject trusted headers for documents-worker
          const actAs = url.searchParams.get('act_as');
          if (actAs) {
            const realUser = await authenticateRequest(new Request(request.url, { headers: { Cookie: request.headers.get('Cookie') || '' } }), env);
            if (realUser && realUser.impersonating) {
              headers.set('X-Impersonate-User-Id', realUser.id);
              headers.set('X-Impersonate-User-Email', realUser.email);
              const targetOrg = realUser.airtableUser?.fields?.Organization?.[0] || '';
              if (targetOrg) headers.set('X-Impersonate-Org-Id', targetOrg);
              const targetPlan = realUser.airtableUser?.fields?.Plan || '';
              if (targetPlan) headers.set('X-Impersonate-Plan', targetPlan);
              console.log(`[Portal] Impersonation headers injected for documents proxy: ${realUser.email}`);
            }
          }

          const documentsRequest = new Request(documentsUrl.toString(), {
            method: request.method,
            headers,
            body: request.body,
            redirect: 'manual'
          });
          
          // Forward the request with all headers intact
          const documentsResponse = await env.DOCUMENTS_WORKER.fetch(documentsRequest);
          
          // Check if this is a binary response (like PDF download)
          const contentType = documentsResponse.headers.get('Content-Type');
          const isBinary = contentType && (
            contentType.includes('application/pdf') || 
            contentType.includes('application/octet-stream') ||
            contentType.includes('image/')
          );
          
          // Return the response with CORS headers
          // For binary data, use the body stream directly
          return new Response(
            isBinary ? documentsResponse.body : await documentsResponse.text(), 
            {
              status: documentsResponse.status,
              headers: {
                ...Object.fromEntries(documentsResponse.headers.entries()),
                ...CORS_HEADERS
              }
            }
          );
        } catch (error) {
          console.error('Documents proxy error:', error);
          return jsonResponse({ 
            error: 'Documents service temporarily unavailable. Please try again later.' 
          }, 503);
        }
      }

      // Proxy OCC fetch endpoint to documents-worker (except /api/occ-proxy which is handled separately)
      if (path.startsWith("/api/occ") && path !== "/api/occ-proxy") {
        console.log(`[Portal] Proxying OCC request: ${path}`);
        if (!env.DOCUMENTS_WORKER) {
          return jsonResponse({ error: 'Documents service not available' }, 503);
        }

        try {
          // Create new request with full URL for service binding
          const occUrl = new URL(path, request.url);
          const occRequest = new Request(occUrl.toString(), {
            method: request.method,
            headers: request.headers,
            body: request.body,
            redirect: 'manual'
          });

          const occResponse = await env.DOCUMENTS_WORKER.fetch(occRequest);

          // Return the response with CORS headers
          return new Response(await occResponse.text(), {
            status: occResponse.status,
            headers: {
              ...Object.fromEntries(occResponse.headers.entries()),
              ...CORS_HEADERS
            }
          });
        } catch (error) {
          console.error('OCC proxy error:', error);
          return jsonResponse({
            error: 'OCC service temporarily unavailable. Please try again later.'
          }, 503);
        }
      }

      // Tools revenue estimator
      if (path === "/api/tools/property-production" && request.method === "GET") {
        return handlePropertyProduction(request, env);
      }
      if (path === "/api/tools/well-production" && request.method === "GET") {
        return handleWellProduction(request, env);
      }

      // Properties endpoints
      // GET /api/properties/v2 - D1-first endpoint (fast, source of truth)
      if (path === "/api/properties/v2" && request.method === "GET") {
        return handleListPropertiesV2(request, env);
      }
      // GET /api/properties - Legacy Airtable endpoint
      if (path === "/api/properties" && request.method === "GET") {
        return handleListProperties(request, env);
      }
      if (path === "/api/properties/link-counts" && request.method === "GET") {
        return handleGetPropertyLinkCounts(request, env);
      }
      if (path === "/api/properties" && request.method === "POST") {
        return handleAddProperty(request, env, ctx);
      }
      const propertyIdMatch = path.match(/^\/api\/properties\/([a-zA-Z0-9]+)$/);
      if (propertyIdMatch && request.method === "PATCH") {
        return handleUpdateProperty(propertyIdMatch[1], request, env);
      }
      if (propertyIdMatch && request.method === "DELETE") {
        return handleDeleteProperty(propertyIdMatch[1], request, env);
      }
      
      // Wells endpoints
      // GET /api/wells - Legacy endpoint (returns raw Airtable data)
      // Still used by: oklahoma_map.html, account.html
      // TODO: Migrate these pages to v2, then remove this endpoint
      if (path === "/api/wells" && request.method === "GET") {
        return handleListWells(request, env);
      }
      // GET /api/wells/v2 - Primary endpoint (D1 metadata + Airtable tracking)
      if (path === "/api/wells/v2" && request.method === "GET") {
        return handleListWellsV2(request, env);
      }
      if (path === "/api/wells/link-counts" && request.method === "GET") {
        return handleGetWellLinkCounts(request, env);
      }
      if (path === "/api/wells" && request.method === "POST") {
        return handleAddWell(request, env, ctx);
      }
      // Wells search endpoint
      if (path === "/api/wells/search" && request.method === "GET") {
        return handleSearchWells(request, env);
      }
      // Track well endpoint (alias for adding wells)
      if (path === "/api/wells/track" && request.method === "POST") {
        return handleAddWell(request, env, ctx);
      }
      const deleteWellMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)$/);
      if (deleteWellMatch && request.method === "DELETE") {
        return handleDeleteWell(deleteWellMatch[1], request, env);
      }
      const wellNotesMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/notes$/);
      if (wellNotesMatch && request.method === "PATCH") {
        return handleUpdateWellNotes(wellNotesMatch[1], request, env);
      }
      const wellInterestsMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/interests$/);
      if (wellInterestsMatch && request.method === "PATCH") {
        return handleUpdateWellInterests(wellInterestsMatch[1], request, env);
      }

      // Completion reports endpoints
      const completionReportsMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/completion-reports$/);
      if (completionReportsMatch && request.method === "GET") {
        return handleGetCompletionReports(completionReportsMatch[1], env);
      }
      const analyzeCompletionMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/analyze-completion$/);
      if (analyzeCompletionMatch && request.method === "POST") {
        return handleAnalyzeCompletion(analyzeCompletionMatch[1], request, env);
      }

      // Drilling permits endpoints (Form 1000)
      const drillingPermitsMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/drilling-permits$/);
      if (drillingPermitsMatch && request.method === "GET") {
        return handleGetDrillingPermits(drillingPermitsMatch[1], env);
      }
      const analyzePermitMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/analyze-permit$/);
      if (analyzePermitMatch && request.method === "POST") {
        return handleAnalyzePermit(analyzePermitMatch[1], request, env);
      }

      // Production summary endpoint
      const productionSummaryMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/production-summary$/);
      if (productionSummaryMatch && request.method === "GET") {
        return handleGetProductionSummary(productionSummaryMatch[1], env);
      }

      // Decimal interest endpoint
      const decimalInterestMatch = path.match(/^\/api\/wells\/([a-zA-Z0-9]+)\/decimal-interest$/);
      if (decimalInterestMatch && request.method === "GET") {
        return handleGetDecimalInterest(decimalInterestMatch[1], env);
      }

      // Nearby wells endpoints (D1 database queries)
      if (path === "/api/nearby-wells" && (request.method === "GET" || request.method === "POST")) {
        return handleNearbyWells(request, env);
      }
      if (path === "/api/wells/surrounding" && request.method === "GET") {
        return handleSurroundingWells(request, env);
      }
      
      // Well enrichment endpoint
      if (path.startsWith("/api/well-enrichment/") && request.method === "GET") {
        const apiNumber = path.split('/').pop() || '';
        return handleWellEnrichment(request, env, apiNumber);
      }
      
      // Bulk well enrichment endpoint
      if (path === "/api/well-enrichment/bulk" && request.method === "POST") {
        return handleBulkWellEnrichment(request, env);
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
      
      // Admin impersonation info endpoint (for banner display)
      if (path === "/api/admin/impersonate-info" && request.method === "GET") {
        const user = await authenticateRequest(request, env);
        if (!user || !isSuperAdmin(user.email)) {
          return jsonResponse({ error: 'Admin required' }, 403);
        }
        const targetId = url.searchParams.get('user_id');
        if (!targetId) return jsonResponse({ error: 'user_id required' }, 400);

        const targetUser = await getUserById(env, targetId);
        if (!targetUser) return jsonResponse({ error: 'User not found' }, 404);

        let orgName = null;
        const orgId = targetUser.fields.Organization?.[0];
        if (orgId) {
          try {
            const orgRes = await fetch(
              `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${orgId}`,
              { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
            );
            if (orgRes.ok) {
              const org = await orgRes.json() as any;
              orgName = org.fields.Name;
            }
          } catch (e) { /* org lookup failed, non-fatal */ }
        }

        return jsonResponse({
          id: targetUser.id,
          name: targetUser.fields.Name,
          email: targetUser.fields.Email,
          plan: targetUser.fields.Plan,
          orgId,
          orgName
        });
      }

      // Admin: revoke all sessions for a specific user
      if (path === "/api/admin/revoke-sessions" && request.method === "POST") {
        const user = await authenticateRequest(request, env);
        if (!user || !isSuperAdmin(user.email)) {
          return jsonResponse({ error: 'Admin required' }, 403);
        }
        const targetId = url.searchParams.get('user_id');
        if (!targetId) return jsonResponse({ error: 'user_id required' }, 400);
        // Set revocation timestamp — any session issued before this is rejected
        await env.AUTH_TOKENS.put(
          `sess_valid_after:${targetId}`,
          String(Date.now()),
          { expirationTtl: 30 * 24 * 60 * 60 } // 30 days (matches session lifetime)
        );
        console.log(`[Admin] Sessions revoked for user ${targetId} by ${user.email}`);
        return jsonResponse({ success: true, user_id: targetId });
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
      if (path === "/api/organization/settings" && request.method === "PATCH") {
        const { handleUpdateOrganizationSettings } = await import('./handlers/organization.js');
        return handleUpdateOrganizationSettings(request, env);
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
        return handleBulkUploadProperties(request, env, ctx);
      }
      
      // Bulk wells endpoints
      if (path === "/api/bulk-validate-wells" && request.method === "POST") {
        return handleBulkValidateWells(request, env);
      }
      if (path === "/api/bulk-upload-wells" && request.method === "POST") {
        return handleBulkUploadWells(request, env, ctx);
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
        console.log('[Portal] OCC proxy route matched!');
        return handleOccProxy(request, env);
      }
      if (path === "/api/occ-proxy") {
        console.log(`[Portal] OCC proxy path matched but method was ${request.method}, not GET`);
      }
      
      // Docket entries endpoint
      if (path === "/api/docket-entries" && request.method === "GET") {
        const { handleGetDocketEntries } = await import('./handlers/docket-entries.js');
        return handleGetDocketEntries(request, env);
      }

      // Docket entries by well (PUN-scoped, no adjacent)
      if (path === "/api/docket-entries-by-well" && request.method === "GET") {
        const { handleGetDocketEntriesByWell } = await import('./handlers/docket-entries.js');
        return handleGetDocketEntriesByWell(request, env);
      }

      // Map data endpoints
      if (path === "/api/map/counties" && request.method === "GET") {
        return handleGetCounties(request, env);
      }
      if (path === "/api/map/townships" && request.method === "GET") {
        return handleGetTownships(request, env);
      }
      if (path === "/api/map/county-stats" && request.method === "GET") {
        return handleGetCountyStats(request, env);
      }
      if (path === "/api/map/county-production" && request.method === "GET") {
        return handleGetCountyProduction(request, env);
      }
      if (path === "/api/map/pooling-rates" && request.method === "GET") {
        return handleGetPoolingRates(request, env);
      }
      if (path === "/api/map-data/version" && request.method === "GET") {
        return handleGetMapDataVersion(request, env);
      }

      // Docket heatmap endpoint (OCC applications for map visualization)
      if (path === "/api/docket-heatmap" && request.method === "GET") {
        return handleGetDocketHeatmap(request, env);
      }

      // PLSS section geometry endpoints (for map section boundaries from D1)
      if (path === "/api/plss-section" && request.method === "GET") {
        return handleGetPlssSection(request, env);
      }
      if (path === "/api/plss-sections/batch" && request.method === "POST") {
        return handleGetPlssSectionsBatch(request, env);
      }

      // County records endpoints (OKCountyRecords integration)
      if (path === "/api/county-records/counties" && request.method === "GET") {
        return handleCountyRecordsCounties(request, env);
      }
      if (path === "/api/county-records/instrument-types" && request.method === "GET") {
        return handleCountyRecordsInstrumentTypes(request, env);
      }
      if (path === "/api/county-records/search" && request.method === "POST") {
        return handleCountyRecordsSearch(request, env, ctx);
      }
      if (path === "/api/county-records/retrieve" && request.method === "POST") {
        return handleCountyRecordsRetrieve(request, env);
      }

      // OTC sync endpoints — all require PROCESSING_API_KEY (except /trigger which has its own check)
      if (path.startsWith("/api/otc-sync/")) {
        // Auth guard for all OTC sync endpoints
        if (path !== "/api/otc-sync/trigger") {
          const authHeader = request.headers.get('Authorization');
          if (authHeader !== `Bearer ${env.PROCESSING_API_KEY}`) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
          }
        }

        if (path === "/api/otc-sync/files" && request.method === "GET") {
          return handleGetOtcSyncFiles(request, env);
        }
        if (path === "/api/otc-sync/check" && request.method === "GET") {
          return handleCheckOtcFile(request, env);
        }
        if (path === "/api/otc-sync/check-batch" && request.method === "POST") {
          return handleCheckOtcFilesBatch(request, env);
        }
        if (path === "/api/otc-sync/record" && request.method === "POST") {
          return handleRecordOtcFile(request, env);
        }
        if (path === "/api/otc-sync/upload-production" && request.method === "POST") {
          return handleUploadProductionData(request, env);
        }
        if (path === "/api/otc-sync/production-stats" && request.method === "GET") {
          return handleGetProductionStats(request, env);
        }
        if (path === "/api/otc-sync/upload-pun-production" && request.method === "POST") {
          return handleUploadPunProductionData(request, env);
        }
        if (path === "/api/otc-sync/truncate-pun-production" && request.method === "POST") {
          return handleTruncatePunProduction(request, env);
        }
        if (path === "/api/otc-sync/compute-pun-rollups" && request.method === "POST") {
          return handleComputePunRollups(request, env);
        }
        if (path === "/api/otc-sync/pun-production-stats" && request.method === "GET") {
          return handleGetPunProductionStats(request, env);
        }
        if (path === "/api/otc-sync/upload-financial" && request.method === "POST") {
          return handleUploadFinancialData(request, env);
        }
        if (path === "/api/otc-sync/financial-stats" && request.method === "GET") {
          return handleGetFinancialStats(request, env);
        }
        if (path === "/api/otc-sync/truncate-financial" && request.method === "POST") {
          return handleTruncateFinancial(request, env);
        }
        // Manual trigger for OTC sync (calls Fly machine)
        if (path === "/api/otc-sync/trigger" && request.method === "POST") {
          const authHeader = request.headers.get('Authorization');
          if (authHeader !== `Bearer ${env.PROCESSING_API_KEY}`) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
          }
          try {
            await triggerOTCSync(env);
            return jsonResponse({
              success: true,
              message: 'OTC sync triggered on Fly machine',
              check_status: `${OTC_FLY_URL}/status`
            });
          } catch (error) {
            return jsonResponse({
              error: 'Failed to trigger sync',
              details: error instanceof Error ? error.message : String(error)
            }, 500);
          }
        }
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

      // Section centers backfill endpoint
      if (path === "/api/admin/backfill-section-centers" && request.method === "POST") {
        return handleBackfillSectionCenters(request, env);
      }

      // BH coordinates backfill endpoint
      if (path === "/api/admin/backfill-bh-coordinates" && request.method === "POST") {
        return handleBackfillBhCoordinates(request, env);
      }

      // Property-well matching endpoint
      if (path === "/api/match-property-wells" && request.method === "POST") {
        return handleMatchPropertyWells(request, env);
      }
      
      // Admin sync endpoint
      if (path === "/api/admin/sync" && request.method === "POST") {
        return handleAirtableSync(request, env);
      }

      // Completions-to-wells sync endpoints
      if (path === "/api/admin/sync-completions-to-wells" && request.method === "POST") {
        return handleSyncCompletionsToWells(request, env);
      }
      const syncSingleCompletionMatch = path.match(/^\/api\/admin\/sync-single-completion\/([a-zA-Z0-9-]+)$/);
      if (syncSingleCompletionMatch && request.method === "POST") {
        return handleSyncSingleCompletion(request, env, syncSingleCompletionMatch[1]);
      }

      // Permit-to-well enrichment sync endpoint
      const syncPermitMatch = path.match(/^\/api\/admin\/sync-permit-to-well\/([a-zA-Z0-9-]+)$/);
      if (syncPermitMatch && request.method === "POST") {
        return handleSyncPermitToWell(syncPermitMatch[1], request, env);
      }

      // Intelligence API endpoints
      if (path === "/api/intelligence/data" && request.method === "GET") {
        const { handleGetIntelligenceData } = await import('./handlers/intelligence.js');
        return handleGetIntelligenceData(request, env);
      }
      if (path === "/api/intelligence/summary" && request.method === "GET") {
        const { handleGetIntelligenceSummary } = await import('./handlers/intelligence.js');
        return handleGetIntelligenceSummary(request, env);
      }
      if (path === "/api/intelligence/insights" && request.method === "GET") {
        const { handleGetIntelligenceInsights } = await import('./handlers/intelligence.js');
        return handleGetIntelligenceInsights(request, env);
      }
      if (path === "/api/intelligence/deduction-report" && request.method === "GET") {
        const { handleGetDeductionReport } = await import('./handlers/intelligence.js');
        return handleGetDeductionReport(request, env);
      }
      if (path === "/api/intelligence/operator-comparison" && request.method === "GET") {
        const { handleGetOperatorComparison } = await import('./handlers/intelligence.js');
        return handleGetOperatorComparison(request, env);
      }
      if (path === "/api/intelligence/deduction-research" && request.method === "GET") {
        const { handleGetDeductionResearch } = await import('./handlers/intelligence.js');
        return handleGetDeductionResearch(request, env);
      }
      if (path === "/api/intelligence/pooling-report" && request.method === "GET") {
        const { handleGetPoolingReport } = await import('./handlers/intelligence.js');
        return handleGetPoolingReport(request, env);
      }
      if (path === "/api/intelligence/production-decline" && request.method === "GET") {
        const { handleGetProductionDecline } = await import('./handlers/intelligence.js');
        return handleGetProductionDecline(request, env);
      }
      if (path === "/api/intelligence/production-decline/markets" && request.method === "GET") {
        const { handleGetProductionDeclineMarkets } = await import('./handlers/intelligence.js');
        return handleGetProductionDeclineMarkets(request, env);
      }
      if (path === "/api/intelligence/production-decline/research" && request.method === "GET") {
        const { handleGetDeclineResearch } = await import('./handlers/intelligence.js');
        return handleGetDeclineResearch(request, env);
      }
      if (path === "/api/intelligence/shut-in-detector" && request.method === "GET") {
        const { handleGetShutInDetector } = await import('./handlers/intelligence.js');
        return handleGetShutInDetector(request, env);
      }
      if (path === "/api/intelligence/shut-in-detector/markets" && request.method === "GET") {
        const { handleGetShutInDetectorMarkets } = await import('./handlers/intelligence.js');
        return handleGetShutInDetectorMarkets(request, env);
      }
      if (path === "/api/intelligence/shut-in-detector/research" && request.method === "GET") {
        const { handleGetShutInResearch } = await import('./handlers/intelligence.js');
        return handleGetShutInResearch(request, env);
      }

      // Operator Directory API (contact info, no financial data - fast)
      if (path === "/api/operators/directory" && request.method === "GET") {
        const { handleGetOperatorDirectory } = await import('./handlers/operators.js');
        return handleGetOperatorDirectory(request, env);
      }
      // Operator Efficiency Index API (PCRR, deductions - paginated)
      if (path === "/api/operators/efficiency" && request.method === "GET") {
        const { handleGetOperatorEfficiency } = await import('./handlers/operators.js');
        return handleGetOperatorEfficiency(request, env);
      }
      // Operator name → number lookup (used by clickable operator names across all reports)
      if (path === "/api/operators/lookup" && request.method === "GET") {
        const { handleGetOperatorLookup } = await import('./handlers/operators.js');
        return handleGetOperatorLookup(request, env);
      }
      // Operator detail - must check after /directory, /efficiency, /lookup to avoid path conflicts
      const operatorDetailMatch = path.match(/^\/api\/operators\/(\d+)$/);
      if (operatorDetailMatch && request.method === "GET") {
        const { handleGetOperatorDetail } = await import('./handlers/operators.js');
        return handleGetOperatorDetail(request, env, operatorDetailMatch[1]);
      }

      // Debug endpoint
      if (path === "/api/debug-airtable" && request.method === "GET") {
        return handleDebugAirtable(request, env);
      }
      
      // Property linked wells endpoint (using D1 with fallback)
      const propertyLinkedWellsMatch = path.match(/^\/api\/property\/([a-zA-Z0-9]+)\/linked-wells$/);
      if (propertyLinkedWellsMatch && request.method === "GET") {
        // Import and use D1 handler
        const { handleGetPropertyLinkedWells } = await import('./handlers/property-wells-d1.js');
        return handleGetPropertyLinkedWells(propertyLinkedWellsMatch[1], request, env);
      }
      
      // Well linked properties endpoint (using D1 with fallback)
      const wellLinkedPropertiesMatch = path.match(/^\/api\/well\/([a-zA-Z0-9]+)\/linked-properties$/);
      if (wellLinkedPropertiesMatch && request.method === "GET") {
        // Import and use D1 handler
        const { handleGetWellLinkedProperties } = await import('./handlers/property-wells-d1.js');
        return handleGetWellLinkedProperties(wellLinkedPropertiesMatch[1], request, env);
      }
      
      // Property linked documents endpoint (using D1)
      const propertyLinkedDocumentsMatch = path.match(/^\/api\/property\/([a-zA-Z0-9-]+)\/linked-documents$/);
      if (propertyLinkedDocumentsMatch && request.method === "GET") {
        // Import and use D1 handler
        const { handleGetPropertyLinkedDocuments } = await import('./handlers/property-documents-d1.js');
        return handleGetPropertyLinkedDocuments(propertyLinkedDocumentsMatch[1], request, env);
      }
      
      // Well linked documents endpoint (using D1 with API number)
      const wellLinkedDocumentsMatch = path.match(/^\/api\/well\/([a-zA-Z0-9-]+)\/linked-documents$/);
      if (wellLinkedDocumentsMatch && request.method === "GET") {
        // Check if api_number query parameter is provided
        const url = new URL(request.url);
        const apiNumber = url.searchParams.get('api_number');
        
        if (apiNumber) {
          // Use API number for lookup (preferred)
          const { handleGetWellLinkedDocuments } = await import('./handlers/property-documents-d1.js');
          return handleGetWellLinkedDocuments(apiNumber, request, env);
        } else {
          // Legacy fallback: still support Airtable ID (though it may not work due to stale data)
          console.log(`[WellDocuments] No api_number provided, trying legacy Airtable ID lookup for ${wellLinkedDocumentsMatch[1]}`);
          return jsonResponse({ 
            error: "API number required", 
            message: "Please provide api_number query parameter for well documents lookup" 
          }, 400);
        }
      }
      
      // Unlink/Relink property-well endpoint
      const unlinkMatch = path.match(/^\/api\/property-well-link\/([a-zA-Z0-9_]+)$/);
      if (unlinkMatch && request.method === "DELETE") {
        return handleUnlinkPropertyWell(unlinkMatch[1], request, env);
      }
      if (unlinkMatch && request.method === "PATCH") {
        return handleRelinkPropertyWell(unlinkMatch[1], request, env);
      }
      
      // Match single property endpoint
      const matchPropertyMatch = path.match(/^\/api\/match-single-property\/([a-zA-Z0-9]+)$/);
      if (matchPropertyMatch && request.method === "POST") {
        return handleMatchSingleProperty(matchPropertyMatch[1], request, env);
      }
      
      // Match single well endpoint
      const matchWellMatch = path.match(/^\/api\/match-single-well\/([a-zA-Z0-9]+)$/);
      if (matchWellMatch && request.method === "POST") {
        return handleMatchSingleWell(matchWellMatch[1], request, env);
      }
      
      // Test endpoint for TRS parsing debug
      if (path === "/api/test-wells" && request.method === "GET") {
        const { handleTestWells } = await import('./handlers/test-wells.js');
        return handleTestWells(request, env);
      }
      
      // TEMPORARY: Domain bridge for testing
      if (path === "/test-upgrade" && request.method === "GET") {
        return Response.redirect(`https://portal-worker.photog12.workers.dev/portal/upgrade`, 302);
      }

      // Unit Print Report - printable production report by PUN
      if (path === "/print/unit" && request.method === "GET") {
        return handleUnitPrint(request, env);
      }
      // Unit Print Data API - JSON data for unit print report
      if (path === "/api/unit-print-data" && request.method === "GET") {
        return handleUnitPrintData(request, env);
      }

      // Document Print Report - printable document summary
      if (path === "/print/document" && request.method === "GET") {
        return handleDocumentPrint(request, env);
      }

      // Intelligence Print Reports
      if (path === "/print/intelligence/deduction-audit" && request.method === "GET") {
        const { handleDeductionAuditPrint } = await import('./handlers/intelligence.js');
        return handleDeductionAuditPrint(request, env);
      }
      if (path === "/print/intelligence/production-decline" && request.method === "GET") {
        const { handleProductionDeclinePrint } = await import('./handlers/intelligence.js');
        return handleProductionDeclinePrint(request, env);
      }
      if (path === "/print/intelligence/shut-in-detector" && request.method === "GET") {
        const { handleShutInDetectorPrint } = await import('./handlers/intelligence.js');
        return handleShutInDetectorPrint(request, env);
      }
      if (path === "/print/intelligence/pooling" && request.method === "GET") {
        const { handlePoolingPrint } = await import('./handlers/intelligence.js');
        return handlePoolingPrint(request, env);
      }

      // Operator Print Summary
      const operatorPrintMatch = path.match(/^\/print\/operators\/(\d+)$/);
      if (operatorPrintMatch && request.method === "GET") {
        const { handleOperatorPrint } = await import('./handlers/operators.js');
        return handleOperatorPrint(request, env, operatorPrintMatch[1]);
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

