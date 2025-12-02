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
  BASE_URL, 
  PLAN_LIMITS, 
  ACTIVITY_LIMITS,
  OCC_CACHE_TTL, 
  CORS_HEADERS,
  PRICE_IDS,
  PRICE_TO_PLAN
} from './constants.js';

import { 
  jsonResponse, 
  servePage, 
  redirectWithError, 
  notFoundResponse, 
  corsResponse, 
  errorResponse 
} from './utils/responses.js';

import { 
  dashboardHtml, 
  loginHtml, 
  accountHtml, 
  upgradeHtml 
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
  verifySession,
  getCookieValue
} from './utils/auth.js';

import {
  sendMagicLinkEmail,
  sendWelcomeEmail,
  getFreeWelcomeEmailHtml,
  getFreeWelcomeEmailText
} from './services/postmark.js';

// Import all handlers from central index
import {
  // Activity handlers
  handleListActivity,
  handleActivityStats,
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
  // Auth handlers
  handleSendMagicLink,
  handleVerifyToken,
  handleLogout,
  handleGetCurrentUser,
  handleRegister,
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
  generateTrackWellErrorPage
} from './handlers/index.js';

import type { Env } from './types/env.js';


var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var index_default = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
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
      if (path === "/api/auth/send-magic-link" && request.method === "POST") {
        return handleSendMagicLink(request, env);
      }
      if (path === "/api/auth/verify" && request.method === "GET") {
        return handleVerifyToken(request, env, url);
      }
      if (path === "/api/auth/logout" && request.method === "POST") {
        return handleLogout();
      }
      if (path === "/api/auth/me" && request.method === "GET") {
        return handleGetCurrentUser(request, env);
      }
      if (path === "/api/auth/register" && request.method === "POST") {
        return handleRegister(request, env);
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

