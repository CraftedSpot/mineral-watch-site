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
  BASE_URL, 
  PLAN_LIMITS, 
  OCC_CACHE_TTL, 
  CORS_HEADERS 
} from './src/constants.js';

import { 
  jsonResponse, 
  servePage, 
  redirectWithError, 
  notFoundResponse, 
  corsResponse, 
  errorResponse 
} from './src/utils/responses.js';

import { 
  dashboardHtml, 
  loginHtml, 
  accountHtml, 
  upgradeHtml 
} from './src/templates/index.js';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var index_default = {
  async fetch(request, env, ctx) {
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
// WELL HANDLERS
// ====================

async function handleListWells(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const formula = `FIND('${user.email}', ARRAYJOIN({User})) > 0`;
  const records = await fetchAllAirtableRecords(env, WELLS_TABLE, formula);
  
  return jsonResponse(records);
}
__name(handleListWells, "handleListWells");

async function handleAddWell(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json();
  
  // Validate API Number (required, 10 digits)
  if (!body.apiNumber) {
    return jsonResponse({ error: "API Number is required" }, 400);
  }
  
  // Clean and validate API format (10 digits, Oklahoma format: 35-XXX-XXXXX)
  const cleanApi = body.apiNumber.replace(/\D/g, '');
  if (cleanApi.length !== 10 || !cleanApi.startsWith('35')) {
    return jsonResponse({ error: "Invalid API format. Must be 10 digits starting with 35 (e.g., 3515322352)" }, 400);
  }
  
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  
  // Check if plan allows wells
  if (planLimits.wells === 0) {
    return jsonResponse({ 
      error: `Your ${plan} plan does not include well monitoring. Please upgrade to add wells.` 
    }, 403);
  }
  
  // Count wells only (separate from properties limit)
  const wellsCount = await countUserWells(env, user.email);
  
  if (wellsCount >= planLimits.wells) {
    return jsonResponse({ 
      error: `Well limit reached (${planLimits.wells} wells on ${plan} plan). You have ${wellsCount} wells.` 
    }, 403);
  }
  
  // Check for duplicate well API for this user
  const isDuplicate = await checkDuplicateWell(env, user.email, cleanApi);
  if (isDuplicate) {
    return jsonResponse({ error: "You are already monitoring this well API." }, 409);
  }
  
  // Query OCC API to get well details and coordinates
  console.log(`Querying OCC for well API: ${cleanApi}`);
  const wellDetails = await fetchWellDetailsFromOCC(cleanApi, env);
  
  let occMapLink = "#";
  let suggestedWellName = body.wellName || "";
  let operator = "";
  let county = "";
  let section = "";
  let township = "";
  let range = "";
  let wellType = "";
  let wellStatus = "";
  
  if (wellDetails) {
    // Generate proper map link with coordinates
    occMapLink = generateMapLink(wellDetails.lat, wellDetails.lon, wellDetails.wellName);
    
    // If user didn't provide a well name, use the one from OCC
    if (!suggestedWellName && wellDetails.wellName) {
      suggestedWellName = wellDetails.wellName;
    }
    
    // Capture all OCC data
    operator = wellDetails.operator || "";
    county = wellDetails.county || "";
    section = wellDetails.section ? String(wellDetails.section) : "";
    township = wellDetails.township || "";
    range = wellDetails.range || "";
    wellType = wellDetails.wellType || "";
    wellStatus = wellDetails.wellStatus || "";
    
    console.log(`OCC well found: ${wellDetails.wellName} - ${operator} - ${county} County`);
  } else {
    console.warn(`Well API ${cleanApi} not found in OCC database - may be pending or invalid`);
    // Still allow adding, but with placeholder link and empty fields
  }
  
  const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}`;
  const response = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: {
        User: [user.id],
        "API Number": cleanApi,
        "Well Name": suggestedWellName,
        Status: "Active",
        "OCC Map Link": occMapLink,
        Operator: operator,
        County: county,
        Section: section,
        Township: township,
        Range: range,
        "Well Type": wellType,
        "Well Status": wellStatus,
        Notes: body.notes || ""
      }
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.error("Airtable create well error:", err);
    throw new Error("Failed to create well");
  }
  
  const newRecord = await response.json();
  console.log(`Well added: API ${cleanApi} for ${user.email}`);
  return jsonResponse(newRecord, 201);
}
__name(handleAddWell, "handleAddWell");

// --- TOKEN VALIDATION HELPER ---
async function validateTrackToken(userId, apiNumber, expiration, token, secret) {
  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (now > expiration) {
    return { valid: false, error: 'Link has expired' };
  }
  
  // Generate expected token
  const payload = `${userId}:${apiNumber}:${expiration}:${secret}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const expectedToken = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Compare tokens
  if (token !== expectedToken) {
    return { valid: false, error: 'Invalid token' };
  }
  
  return { valid: true };
}

async function handleTrackThisWell(request, env, url) {
  const apiNumber = url.searchParams.get('api');
  const userId = url.searchParams.get('user');
  const token = url.searchParams.get('token');
  const exp = url.searchParams.get('exp');
  
  // Check if we have signed token parameters
  if (userId && token && exp && env.TRACK_WELL_SECRET) {
    // Token-based flow (no auth required)
    
    // Validate API parameter
    if (!apiNumber) {
      return new Response(generateTrackWellErrorPage('Missing API number in tracking link.'), {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }
    
    // Clean and validate API format
    const cleanApi = apiNumber.replace(/\D/g, '');
    if (cleanApi.length !== 10 || !cleanApi.startsWith('35')) {
      return new Response(generateTrackWellErrorPage('Invalid API format in tracking link.'), {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }
    
    // Validate token
    const expiration = parseInt(exp);
    const tokenValidation = await validateTrackToken(userId, cleanApi, expiration, token, env.TRACK_WELL_SECRET);
    
    if (!tokenValidation.valid) {
      return new Response(generateTrackWellErrorPage(`Tracking link is ${tokenValidation.error}. Please request a new alert email.`), {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }
    
    try {
      // Get user record
      const userRecord = await getUserById(env, userId);
      if (!userRecord) {
        return new Response(generateTrackWellErrorPage('User not found. Please contact support.'), {
          headers: { 'Content-Type': 'text/html' },
          status: 404
        });
      }
      
      const userEmail = userRecord.fields.Email;
      
      // Check for duplicate well API for this user
      const isDuplicate = await checkDuplicateWell(env, userEmail, cleanApi);
      if (isDuplicate) {
        return new Response(generateTrackWellSuccessPage(cleanApi, true), {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      // Check plan limits
      const plan = userRecord?.fields.Plan || "Free";
      const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
      
      if (planLimits.wells === 0) {
        return new Response(generateTrackWellErrorPage(`Your ${plan} plan does not include well monitoring. Please upgrade to add wells.`, true), {
          headers: { 'Content-Type': 'text/html' },
          status: 403
        });
      }
      
      const wellsCount = await countUserWells(env, userEmail);
      if (wellsCount >= planLimits.wells) {
        return new Response(generateTrackWellErrorPage(`Well limit reached (${planLimits.wells} wells on ${plan} plan). You have ${wellsCount} wells.`, true), {
          headers: { 'Content-Type': 'text/html' },
          status: 403
        });
      }
      
      // Query OCC API to get well details
      const wellDetails = await fetchWellDetailsFromOCC(cleanApi, env);
      
      let occMapLink = "#";
      let wellName = "";
      let operator = "";
      let county = "";
      let section = "";
      let township = "";
      let range = "";
      let wellType = "";
      let wellStatus = "";
      
      if (wellDetails) {
        occMapLink = generateMapLink(wellDetails.lat, wellDetails.lon, wellDetails.wellName);
        wellName = wellDetails.wellName || "";
        operator = wellDetails.operator || "";
        county = wellDetails.county || "";
        section = wellDetails.section ? String(wellDetails.section) : "";
        township = wellDetails.township || "";
        range = wellDetails.range || "";
        wellType = wellDetails.wellType || "";
        wellStatus = wellDetails.wellStatus || "";
      }
      
      // Add the well to Airtable
      const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}`;
      const response = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: {
            User: [userId],
            "API Number": cleanApi,
            "Well Name": wellName,
            Status: "Active",
            "OCC Map Link": occMapLink,
            Operator: operator,
            County: county,
            Section: section,
            Township: township,
            Range: range,
            "Well Type": wellType,
            "Well Status": wellStatus,
            Notes: "Added via signed email tracking link"
          }
        })
      });
      
      if (!response.ok) {
        const err = await response.text();
        console.error("Airtable create well error:", err);
        return new Response(generateTrackWellErrorPage('Failed to add well. Please try again later.'), {
          headers: { 'Content-Type': 'text/html' },
          status: 500
        });
      }
      
      console.log(`Well added via signed email link: API ${cleanApi} for ${userEmail}`);
      return new Response(generateTrackWellSuccessPage(cleanApi, false, wellName), {
        headers: { 'Content-Type': 'text/html' }
      });
      
    } catch (error) {
      console.error("Track well error:", error);
      return new Response(generateTrackWellErrorPage('An error occurred. Please try again later.'), {
        headers: { 'Content-Type': 'text/html' },
        status: 500
      });
    }
    
  } else {
    // Fallback to old auth-required flow
    
    // Validate API parameter
    if (!apiNumber) {
      return new Response(generateTrackWellErrorPage('Missing API number. Please use a valid tracking link.'), {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }
    
    // Clean and validate API format
    const cleanApi = apiNumber.replace(/\D/g, '');
    if (cleanApi.length !== 10 || !cleanApi.startsWith('35')) {
      return new Response(generateTrackWellErrorPage('Invalid API format. Must be 10 digits starting with 35.'), {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }
    
    // Check authentication
    const user = await authenticateRequest(request, env);
    if (!user) {
      // Redirect to login with return URL
      const returnUrl = encodeURIComponent(`/add-well?api=${cleanApi}`);
      return Response.redirect(`${BASE_URL}/portal/login?return=${returnUrl}`, 302);
    }
    
    return new Response(generateTrackWellErrorPage('This tracking link requires authentication. Please log in and try again.'), {
      headers: { 'Content-Type': 'text/html' },
      status: 400
    });
  }
}
__name(handleTrackThisWell, "handleTrackThisWell");

async function handleDeleteWell(wellId, request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}/${wellId}`;
  const getResponse = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!getResponse.ok) {
    return jsonResponse({ error: "Well not found" }, 404);
  }
  
  const well = await getResponse.json();
  if (well.fields.User?.[0] !== user.id) {
    return jsonResponse({ error: "Not authorized" }, 403);
  }
  
  const deleteUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}/${wellId}`;
  await fetch(deleteUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  console.log(`Well deleted: ${wellId} by ${user.email}`);
  return jsonResponse({ success: true });
}
__name(handleDeleteWell, "handleDeleteWell");

// --- HANDLER: UPDATE WELL NOTES ---
async function handleUpdateWellNotes(wellId, request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  let notes = body.notes || "";
  
  // Limit notes length to prevent abuse
  if (notes.length > 1000) {
    notes = notes.substring(0, 1000);
  }
  
  // Verify ownership
  const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}/${wellId}`;
  const getResponse = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!getResponse.ok) {
    return jsonResponse({ error: "Well not found" }, 404);
  }
  
  const well = await getResponse.json();
  if (well.fields.User?.[0] !== user.id) {
    return jsonResponse({ error: "Not authorized" }, 403);
  }
  
  // Update notes
  const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}/${wellId}`;
  const updateResponse = await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: { Notes: notes } })
  });
  
  if (!updateResponse.ok) {
    return jsonResponse({ error: "Failed to update notes" }, 500);
  }
  
  return jsonResponse({ success: true });
}
__name(handleUpdateWellNotes, "handleUpdateWellNotes");

// --- HANDLER: UPDATE PROPERTY ---
async function handleUpdateProperty(propertyId, request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  
  // Build fields object with allowed editable fields
  const updateFields = {};
  if (body.notes !== undefined) {
    let notes = body.notes || "";
    // Limit notes length to prevent abuse
    if (notes.length > 1000) {
      notes = notes.substring(0, 1000);
    }
    updateFields['Notes'] = notes;
  }
  if (body.meridian !== undefined) {
    // Validate meridian value
    if (!['IM', 'CM'].includes(body.meridian)) {
      return jsonResponse({ error: 'Invalid meridian value' }, 400);
    }
    updateFields['MERIDIAN'] = body.meridian;
  }
  
  // Verify ownership
  const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}/${propertyId}`;
  const getResponse = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!getResponse.ok) {
    return jsonResponse({ error: "Property not found" }, 404);
  }
  
  const property = await getResponse.json();
  if (property.fields.User?.[0] !== user.id) {
    return jsonResponse({ error: "Not authorized" }, 403);
  }
  
  // Update property
  const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}/${propertyId}`;
  const updateResponse = await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: updateFields })
  });
  
  if (!updateResponse.ok) {
    return jsonResponse({ error: "Failed to update property" }, 500);
  }
  
  return jsonResponse({ success: true });
}
__name(handleUpdateProperty, "handleUpdateProperty");

// ====================
// ACTIVITY LOG HANDLERS
// ====================

var ACTIVITY_TABLE = "📋 Activity Log";

// Plan-based activity history limits (in days)
var ACTIVITY_LIMITS = {
  "Free": 7,
  "Starter": 30,
  "Standard": 90,
  "Professional": 365 * 10,  // 10 years = essentially unlimited
  "Enterprise": 365 * 10
};

async function handleListActivity(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get plan-based date limit
  const daysLimit = ACTIVITY_LIMITS[user.plan] || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);
  const cutoffISO = cutoffDate.toISOString();
  
  // Build formula: user's records, after cutoff date, sorted by date desc
  const formula = `AND({Email} = '${user.email}', {Detected At} >= '${cutoffISO}')`;
  
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Detected At&sort[0][direction]=desc&maxRecords=100`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    console.error("Airtable list activity error:", errText);
    throw new Error(`Airtable error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Include the limit info for the UI
  return jsonResponse({
    records: data.records,
    daysLimit: daysLimit,
    plan: user.plan
  });
}
__name(handleListActivity, "handleListActivity");

async function handleActivityStats(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get all activity for this user (for stats, we count everything)
  const formula = `{Email} = '${user.email}'`;
  
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Detected At&sort[0][direction]=desc`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    return jsonResponse({ lastAlert: null, thisMonth: 0, thisYear: 0, total: 0 });
  }
  
  const data = await response.json();
  const records = data.records || [];
  
  if (records.length === 0) {
    return jsonResponse({ lastAlert: null, thisMonth: 0, thisYear: 0, total: 0 });
  }
  
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  
  let thisMonth = 0;
  let thisYear = 0;
  
  records.forEach(r => {
    const detectedAt = new Date(r.fields['Detected At']);
    if (detectedAt >= startOfMonth) thisMonth++;
    if (detectedAt >= startOfYear) thisYear++;
  });
  
  // Last alert date
  const lastAlertDate = records[0]?.fields['Detected At'] || null;
  
  return jsonResponse({
    lastAlert: lastAlertDate,
    thisMonth: thisMonth,
    thisYear: thisYear,
    total: records.length
  });
}
__name(handleActivityStats, "handleActivityStats");

// --- HELPER: QUERY OCC FOR WELL DETAILS ---

// ====================
// BULK UPLOAD HANDLERS
// ====================

async function handleBulkValidateProperties(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  const { properties } = body; // Array of parsed property objects
  
  if (!properties || !Array.isArray(properties)) {
    return jsonResponse({ error: "Invalid data format" }, 400);
  }
  
  // Get user's current properties for duplicate checking
  const existingProperties = await fetchUserProperties(env, user.email);
  const existingSet = new Set(
    existingProperties.map(p => 
      `${p.SEC}-${p.TWN}-${p.RNG}-${p.MERIDIAN || 'IM'}`
    )
  );
  
  // Get user's plan limits
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  
  const propertiesCount = await countUserProperties(env, user.email);
  const currentPropertyCount = propertiesCount;
  
  // Validate each property
  const results = properties.map((prop, index) => {
    const errors = [];
    const warnings = [];
    
    // Normalize data
    const normalized = normalizePropertyData(prop);
    
    // Validate required fields
    if (!normalized.SEC) {
      errors.push("Missing section number");
    } else if (normalized.SEC < 1 || normalized.SEC > 36) {
      errors.push("Section must be 1-36");
    }
    
    if (!normalized.TWN) {
      errors.push("Missing township");
    } else if (!validateTownship(normalized.TWN)) {
      errors.push("Invalid township format (e.g. 12N)");
    }
    
    if (!normalized.RNG) {
      errors.push("Missing range");
    } else if (!validateRange(normalized.RNG)) {
      errors.push("Invalid range format (e.g. 4W)");
    }
    
    // Check for duplicates
    const key = `${normalized.SEC}-${normalized.TWN}-${normalized.RNG}-${normalized.MERIDIAN}`;
    const isDuplicate = existingSet.has(key);
    if (isDuplicate) {
      warnings.push("Already monitoring this property");
    }
    
    // Default meridian warning
    if (!prop.MERIDIAN && !prop.MER && !prop.Meridian && !prop.M) {
      warnings.push("Meridian defaulted to IM (Indian Meridian)");
    }
    
    return {
      index,
      original: prop,
      normalized,
      errors,
      warnings,
      isDuplicate,
      isValid: errors.length === 0
    };
  });
  
  // Count valid non-duplicates
  const validCount = results.filter(r => r.isValid && !r.isDuplicate).length;
  const newPropertyCount = currentPropertyCount + validCount;
  const wouldExceedLimit = newPropertyCount > planLimits.properties;
  
  return jsonResponse({
    results,
    summary: {
      total: properties.length,
      valid: results.filter(r => r.isValid).length,
      invalid: results.filter(r => !r.isValid).length,
      duplicates: results.filter(r => r.isDuplicate).length,
      warnings: results.filter(r => r.warnings.length > 0).length,
      willImport: validCount
    },
    planCheck: {
      current: currentPropertyCount,
      limit: planLimits.properties,
      plan,
      afterUpload: newPropertyCount,
      wouldExceedLimit
    }
  });
}

// --- HANDLER: BULK UPLOAD PROPERTIES ---
async function handleBulkUploadProperties(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  const { properties } = body; // Array of validated, normalized property objects
  
  if (!properties || !Array.isArray(properties)) {
    return jsonResponse({ error: "Invalid data format" }, 400);
  }
  
  // Final validation check (security - never trust client)
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  
  const propertiesCount = await countUserProperties(env, user.email);
  
  if (propertiesCount + properties.length > planLimits.properties) {
    return jsonResponse({ 
      error: `Would exceed property limit (${planLimits.properties} properties on ${plan} plan)` 
    }, 403);
  }
  
  // Get existing properties for duplicate check
  const existingProperties = await fetchUserProperties(env, user.email);
  const existingSet = new Set(
    existingProperties.map(p => 
      `${p.SEC}-${p.TWN}-${p.RNG}-${p.MERIDIAN || 'IM'}`
    )
  );
  
  // Filter out duplicates and invalid
  const toCreate = properties.filter(prop => {
    const key = `${prop.SEC}-${prop.TWN}-${prop.RNG}-${prop.MERIDIAN}`;
    return !existingSet.has(key) && 
           prop.SEC >= 1 && prop.SEC <= 36 &&
           validateTownship(prop.TWN) &&
           validateRange(prop.RNG);
  });
  
  console.log(`Bulk upload: Creating ${toCreate.length} properties for ${user.email}`);
  
  // Create in batches of 10 (Airtable limit)
  const batchSize = 10;
  const results = {
    successful: 0,
    failed: 0,
    skipped: properties.length - toCreate.length,
    errors: []
  };
  
  for (let i = 0; i < toCreate.length; i += batchSize) {
    const batch = toCreate.slice(i, i + batchSize);
    
    const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}`;
    const response = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        records: batch.map(prop => ({
          fields: {
            User: [user.id],
            SEC: String(prop.SEC).padStart(2, '0'),
            TWN: prop.TWN,
            RNG: prop.RNG,
            MERIDIAN: prop.MERIDIAN,
            COUNTY: prop.COUNTY || "",
            "Monitor Adjacent": true,
            Status: "Active",
            Notes: prop.NOTES || ""
          }
        }))
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      results.successful += data.records.length;
    } else {
      const err = await response.text();
      console.error(`Batch create failed:`, err);
      results.failed += batch.length;
      results.errors.push(`Batch ${Math.floor(i/batchSize) + 1} failed: ${err}`);
    }
    
    // Small delay between batches to be nice to Airtable
    if (i + batchSize < toCreate.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log(`Bulk upload complete: ${results.successful} created, ${results.failed} failed, ${results.skipped} skipped`);
  
  return jsonResponse({
    success: true,
    results
  });
}

// --- HANDLER: BULK VALIDATE WELLS ---
async function handleBulkValidateWells(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  const { wells } = body; // Array of { apiNumber, wellName? }
  
  if (!wells || !Array.isArray(wells) || wells.length === 0) {
    return jsonResponse({ error: "No wells data provided" }, 400);
  }
  
  // Check plan allows wells
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  
  if (planLimits.wells === 0) {
    return jsonResponse({ 
      error: `Your ${plan} plan does not include well monitoring. Please upgrade to add wells.` 
    }, 403);
  }
  
  // Get user's existing wells for duplicate checking
  const existingWells = await fetchUserWells(env, user.email);
  const existingSet = new Set(existingWells.map(w => w.apiNumber));
  
  const wellsCount = existingWells.length;
  
  // Validate each well
  const results = wells.map((well, index) => {
    const errors = [];
    const warnings = [];
    
    // Clean API number
    const rawApi = well.apiNumber || well.API || well.api || '';
    const cleanApi = String(rawApi).replace(/\D/g, '');
    
    // Validate API format
    if (!cleanApi) {
      errors.push("Missing API number");
    } else if (cleanApi.length !== 10) {
      errors.push("API must be 10 digits");
    } else if (!cleanApi.startsWith('35')) {
      errors.push("Oklahoma APIs start with 35");
    }
    
    // Check for duplicate in existing wells
    const isDuplicate = existingSet.has(cleanApi);
    if (isDuplicate) {
      // Not an error, just flagged
    }
    
    // Check for duplicate in this batch
    const batchDuplicates = wells.slice(0, index).filter(w => {
      const api = String(w.apiNumber || w.API || w.api || '').replace(/\D/g, '');
      return api === cleanApi;
    });
    if (batchDuplicates.length > 0) {
      warnings.push("Duplicate in this file");
    }
    
    // Truncate notes to prevent abuse
    let notes = well.notes || well.Notes || well.NOTE || well.Note || well.Comments || well.comments || '';
    if (notes.length > 1000) {
      notes = notes.substring(0, 1000);
    }
    
    return {
      row: index + 1,
      original: well,
      normalized: {
        apiNumber: cleanApi,
        wellName: well.wellName || well.WELL_NAME || well.Well_Name || well.name || '',
        notes: notes
      },
      errors,
      warnings,
      isDuplicate,
      isValid: errors.length === 0
    };
  });
  
  // Count valid non-duplicates
  const validCount = results.filter(r => r.isValid && !r.isDuplicate).length;
  const newWellCount = wellsCount + validCount;
  const wouldExceedLimit = newWellCount > planLimits.wells;
  
  return jsonResponse({
    results,
    summary: {
      total: wells.length,
      valid: results.filter(r => r.isValid).length,
      invalid: results.filter(r => !r.isValid).length,
      duplicates: results.filter(r => r.isDuplicate).length,
      warnings: results.filter(r => r.warnings.length > 0).length,
      willImport: validCount
    },
    planCheck: {
      current: wellsCount,
      limit: planLimits.wells,
      plan,
      afterUpload: newWellCount,
      wouldExceedLimit
    }
  });
}

// --- HANDLER: BULK UPLOAD WELLS ---
async function handleBulkUploadWells(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  const { wells } = body; // Array of validated, normalized well objects
  
  if (!wells || !Array.isArray(wells)) {
    return jsonResponse({ error: "Invalid data format" }, 400);
  }
  
  // Final validation check
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  
  if (planLimits.wells === 0) {
    return jsonResponse({ 
      error: `Your ${plan} plan does not include well monitoring.` 
    }, 403);
  }
  
  const wellsCount = await countUserWells(env, user.email);
  
  if (wellsCount + wells.length > planLimits.wells) {
    return jsonResponse({ 
      error: `Would exceed well limit (${planLimits.wells} wells on ${plan} plan)` 
    }, 403);
  }
  
  // Get existing wells for duplicate check
  const existingWells = await fetchUserWells(env, user.email);
  const existingSet = new Set(existingWells.map(w => w.apiNumber));
  
  // Filter out duplicates and invalid
  const toCreate = wells.filter(well => {
    return !existingSet.has(well.apiNumber) && 
           well.apiNumber.length === 10 &&
           well.apiNumber.startsWith('35');
  });
  
  const results = {
    successful: 0,
    failed: 0,
    skipped: wells.length - toCreate.length,
    errors: []
  };
  
  // Fetch OCC data for each well (in parallel batches to speed up)
  const wellsWithData = [];
  const occBatchSize = 5; // Fetch 5 at a time from OCC
  
  for (let i = 0; i < toCreate.length; i += occBatchSize) {
    const occBatch = toCreate.slice(i, i + occBatchSize);
    const occPromises = occBatch.map(async (well) => {
    const occData = await fetchWellDetailsFromOCC(well.apiNumber, env);
    return { ...well, occData };
});
    const batchResults = await Promise.all(occPromises);
    wellsWithData.push(...batchResults);
    
    // Small delay between OCC batches
    if (i + occBatchSize < toCreate.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Create in Airtable batches of 10
  const batchSize = 10;
  for (let i = 0; i < wellsWithData.length; i += batchSize) {
    const batch = wellsWithData.slice(i, i + batchSize);
    
    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: batch.map(well => {
          const occ = well.occData || {};
          const mapLink = occ.lat && occ.lon ? generateMapLink(occ.lat, occ.lon, occ.wellName) : '#';
          
          return {
            fields: {
              User: [user.id],
              "API Number": well.apiNumber,
              "Well Name": occ.wellName || well.wellName || "",
              Status: "Active",
              "OCC Map Link": mapLink,
              Operator: occ.operator || "",
              County: occ.county || "",
              Section: occ.section ? String(occ.section) : "",
              Township: occ.township || "",
              Range: occ.range || "",
              "Well Type": occ.wellType || "",
              "Well Status": occ.wellStatus || "",
              Notes: well.notes || ""
            }
          };
        })
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      results.successful += data.records.length;
    } else {
      const err = await response.text();
      console.error(`Batch create wells failed:`, err);
      results.failed += batch.length;
      results.errors.push(`Batch ${Math.floor(i/batchSize) + 1} failed: ${err}`);
    }
    
    // Small delay between batches
    if (i + batchSize < toCreate.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log(`Bulk wells upload complete: ${results.successful} created, ${results.failed} failed, ${results.skipped} skipped`);
  
  return jsonResponse({
    success: true,
    results
  });
}

// --- HELPER: FETCH USER WELLS ---
async function fetchUserWells(env, userEmail) {
  const user = await findUserByEmail(env, userEmail);
  if (!user) return [];
  
  const formula = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) return [];
  
  const data = await response.json();
  return data.records.map(r => ({
    id: r.id,
    apiNumber: r.fields["API Number"] || '',
    wellName: r.fields["Well Name"] || ''
  }));
}
async function fetchUserProperties(env, userEmail) {
  const user = await findUserByEmail(env, userEmail);
  if (!user) return [];
  
  const formula = `{User Email} = "${userEmail}"`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`
    }
  });
  
  if (!response.ok) return [];
  
  const data = await response.json();
  return data.records.map(r => ({
    SEC: r.fields.SEC,
    TWN: r.fields.TWN,
    RNG: r.fields.RNG,
    MERIDIAN: r.fields.MERIDIAN || 'IM'
  }));
}


// --- HELPER: NORMALIZE PROPERTY DATA ---
var MAX_NOTES_LENGTH = 1000;

function normalizePropertyData(prop) {
  let notes = prop.NOTES || prop.Notes || prop.Note || prop.Comments || "";
  // Truncate notes to prevent abuse
  if (notes.length > MAX_NOTES_LENGTH) {
    notes = notes.substring(0, MAX_NOTES_LENGTH);
  }
  
  return {
    SEC: normalizeSectionNumber(prop.SEC || prop.Section || prop.Sec || prop.S),
    TWN: normalizeTownship(prop.TWN || prop.Township || prop.Town || prop.T),
    RNG: normalizeRange(prop.RNG || prop.Range || prop.R),
    MERIDIAN: normalizeMeridian(prop.MERIDIAN || prop.Meridian || prop.MER || prop.M),
    COUNTY: normalizeCounty(prop.COUNTY || prop.County || prop.Co || prop.CTY),
    NOTES: notes
  };
}

// --- HELPER: NORMALIZE SECTION NUMBER ---
function normalizeSectionNumber(value) {
  if (!value) return null;
  
  // Convert to string and clean
  let str = String(value).trim().toUpperCase();
  
  // Remove common prefixes
  str = str.replace(/^(S|SEC|SECTION)\s*/i, '');
  
  // Extract just the number
  const match = str.match(/(\d+)/);
  if (!match) return null;
  
  const num = parseInt(match[1]);
  
  // Validate range
  if (num < 1 || num > 36) return null;
  
  return String(num).padStart(2, '0');
}

// --- HELPER: NORMALIZE TOWNSHIP ---
function normalizeTownship(value) {
  if (!value) return null;
  
  let str = String(value).trim().toUpperCase();
  
  // Remove prefixes
  str = str.replace(/^(T|TOWN|TOWNSHIP)\s*/i, '');
  
  // Remove spaces
  str = str.replace(/\s+/g, '');
  
  // Handle formats: "12N", "N12", "12 N"
  const match = str.match(/(\d+)\s*([NS])|([NS])\s*(\d+)/i);
  if (!match) return null;
  
  const number = match[1] || match[4];
  const direction = match[2] || match[3];
  
  if (!number || !direction) return null;
  
  return `${number}${direction.toUpperCase()}`;
}

// --- HELPER: NORMALIZE RANGE ---
function normalizeRange(value) {
  if (!value) return null;
  
  let str = String(value).trim().toUpperCase();
  
  // Remove prefixes
  str = str.replace(/^(R|RANGE)\s*/i, '');
  
  // Remove spaces
  str = str.replace(/\s+/g, '');
  
  // Handle formats: "4W", "W4", "4 W"
  const match = str.match(/(\d+)\s*([EW])|([EW])\s*(\d+)/i);
  if (!match) return null;
  
  const number = match[1] || match[4];
  const direction = match[2] || match[3];
  
  if (!number || !direction) return null;
  
  return `${number}${direction.toUpperCase()}`;
}

// --- HELPER: NORMALIZE MERIDIAN ---
function normalizeMeridian(value) {
  if (!value) return "IM"; // Default to Indian Meridian
  
  const str = String(value).trim().toUpperCase();
  
  // Indian Meridian
  if (str.match(/^(IM|I|INDIAN)/i)) {
    return "IM";
  }
  
  // Cimarron Meridian
  if (str.match(/^(CM|C|CIMARRON)/i)) {
    return "CM";
  }
  
  // Default to IM if unknown
  return "IM";
}

// --- HELPER: NORMALIZE COUNTY ---
function normalizeCounty(value) {
  if (!value) return "";
  
  const str = String(value).trim();
  
  // Capitalize first letter of each word
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// --- HELPER: VALIDATE TOWNSHIP FORMAT ---
function validateTownship(value) {
  if (!value) return false;
  return /^\d+[NS]$/i.test(value);
}

// --- HELPER: VALIDATE RANGE FORMAT ---
function validateRange(value) {
  if (!value) return false;
  return /^\d+[EW]$/i.test(value);
}

// Export functions (add to existing exports at end of file)


async function fetchWellDetailsFromOCC(apiNumber, env) {
  // Check cache first
  if (env?.OCC_CACHE) {
    const cacheKey = `well_${apiNumber}`;
    try {
      const cached = await env.OCC_CACHE.get(cacheKey, 'json');
      if (cached) {
        console.log(`OCC cache hit: ${apiNumber}`);
        return cached;
      }
    } catch (e) {
      console.warn('OCC cache read error:', e);
    }
  }
  
  console.log(`OCC cache miss: ${apiNumber} - fetching from API`);
  
  const baseUrl = "https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query";
  
  const params = new URLSearchParams({
    where: `api=${apiNumber}`,
    outFields: "api,well_name,well_num,operator,county,section,township,range,welltype,wellstatus,sh_lat,sh_lon",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "1"
  });

  try {
    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { "User-Agent": "MineralWatch-Portal/1.0" }
    });

    if (!response.ok) {
      console.error(`OCC API Error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      const attr = data.features[0].attributes;
      const wellDetails = {
        api: attr.api,
        wellName: attr.well_name && attr.well_num && !attr.well_name.includes('#') 
          ? `${attr.well_name} #${attr.well_num}` 
          : (attr.well_name || ''),
        operator: attr.operator || null,
        county: attr.county || null,
        section: attr.section || null,
        township: attr.township || null,
        range: attr.range || null,
        wellType: attr.welltype || null,
        wellStatus: attr.wellstatus || null,
        lat: attr.sh_lat,
        lon: attr.sh_lon,
        cachedAt: Date.now()
      };
      
      // Cache the result
      if (env?.OCC_CACHE) {
        try {
          await env.OCC_CACHE.put(
            `well_${apiNumber}`, 
            JSON.stringify(wellDetails), 
            { expirationTtl: OCC_CACHE_TTL }
          );
          console.log(`OCC cached: ${apiNumber}`);
        } catch (e) {
          console.warn('OCC cache write error:', e);
        }
      }
      
      return wellDetails;
    }
    
    return null;
  } catch (error) {
    console.error("Failed to fetch well from OCC:", error);
    return null;
  }
}
__name(fetchWellDetailsFromOCC, "fetchWellDetailsFromOCC");

// --- HELPER: GENERATE MAP LINK ---
function generateMapLink(lat, lon, title) {
  if (!lat || !lon) return "#"; 
  const appId = "ba9b8612132f4106be6e3553dc0b827b";
  const markerTemplate = JSON.stringify({
    title: title || "Well Location",
    longitude: lon,
    latitude: lat,
    isIncludeShareUrl: true
  });
  return `https://gis.occ.ok.gov/portal/apps/webappviewer/index.html?id=${appId}&marker=${lon},${lat},,,,&markertemplate=${encodeURIComponent(markerTemplate)}&level=19`;
}
__name(generateMapLink, "generateMapLink");

async function countUserWells(env, userEmail) {
  const formula = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=API Number`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return 0;
  const data = await response.json();
  return data.records?.length || 0;
}
__name(countUserWells, "countUserWells");

async function checkDuplicateWell(env, userEmail, apiNumber) {
  const formula = `AND(FIND('${userEmail}', ARRAYJOIN({User})) > 0, {API Number} = '${apiNumber}')`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.records?.length > 0;
}
__name(checkDuplicateWell, "checkDuplicateWell");

// ====================
// AUTH HANDLERS
// ====================

async function handleSendMagicLink(request, env) {
  const { email } = await request.json();
  if (!email || !email.includes("@")) {
    return jsonResponse({ error: "Valid email required" }, 400);
  }
  const normalizedEmail = email.toLowerCase().trim();
  const user = await findUserByEmail(env, normalizedEmail);
  if (!user || user.fields.Status !== "Active") {
    console.log(`Login attempt for non-existent/inactive user: ${normalizedEmail}`);
    return jsonResponse({ success: true });
  }
  const token = await generateToken(env, {
    email: normalizedEmail,
    id: user.id,
    exp: Date.now() + TOKEN_EXPIRY
  });
  const magicLink = `${BASE_URL}/api/auth/verify?token=${token}`;
  await sendMagicLinkEmail(env, normalizedEmail, user.fields.Name || "there", magicLink);
  console.log(`Magic link sent to: ${normalizedEmail}`);
  return jsonResponse({ success: true });
}
__name(handleSendMagicLink, "handleSendMagicLink");

async function handleVerifyToken(request, env, url) {
  const token = url.searchParams.get("token");
  if (!token) {
    return redirectWithError("Missing token");
  }
  let payload;
  try {
    payload = await verifyToken(env, token);
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return redirectWithError("Invalid or expired link. Please request a new one.");
  }
  if (Date.now() > payload.exp) {
    return redirectWithError("This link has expired. Please request a new one.");
  }
  const sessionToken = await generateToken(env, {
    email: payload.email,
    id: payload.id,
    exp: Date.now() + SESSION_EXPIRY
  }, 30 * 24 * 60 * 60);
  console.log(`User logged in: ${payload.email}`);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/portal",
      "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`
    }
  });
}
__name(handleVerifyToken, "handleVerifyToken");

function handleLogout() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
      ...CORS_HEADERS
    }
  });
}
__name(handleLogout, "handleLogout");

async function handleGetCurrentUser(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const userRecord = await findUserByEmail(env, user.email);
  if (!userRecord) {
    return jsonResponse({ error: "User not found" }, 401);
  }
  return jsonResponse({
    id: userRecord.id,
    email: userRecord.fields.Email,
    name: userRecord.fields.Name,
    plan: userRecord.fields.Plan || "Free",
    status: userRecord.fields.Status,
    stripeCustomerId: userRecord.fields["Stripe Customer ID"]
  });
}
__name(handleGetCurrentUser, "handleGetCurrentUser");

// --- HANDLER: REGISTER FREE USER ---
async function handleRegister(request, env) {
  try {
    console.log("Starting user registration");
    
    const body = await request.json();
    console.log("Request body parsed successfully");
    
    const { email, name } = body;
    
    // Validate email
    if (!email || !email.includes('@')) {
      console.log("Invalid email provided");
      return jsonResponse({ error: "Valid email is required" }, 400);
    }
    
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Processing registration for: ${normalizedEmail}`);
    
    // Check if user already exists
    console.log("Checking if user already exists");
    const existingUser = await findUserByEmail(env, normalizedEmail);
    if (existingUser) {
      console.log("User already exists");
      return jsonResponse({ error: "An account with this email already exists" }, 409);
    }
    console.log("User does not exist, proceeding with creation");
    
    // Create new Free user
    console.log("Creating user in Airtable");
    const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
    const response = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          Email: normalizedEmail,
          Name: name || normalizedEmail.split('@')[0],
          Plan: "Free",
          Status: "Active"
        }
      })
    });
    
    if (!response.ok) {
      const err = await response.text();
      console.error("Airtable create user error:", err);
      return jsonResponse({ error: "Failed to create account" }, 500);
    }
    
    console.log("User created successfully in Airtable");
    const newUser = await response.json();
    console.log(`New Free user registered: ${normalizedEmail}`);
    
    // Generate magic link token and send login email
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + (15 * 60 * 1000); // 15 min
    
    // Store token (using same logic as handleLogin)
    await env.AUTH_TOKENS.put(token, JSON.stringify({
      email: normalizedEmail,
      expiresAt
    }), { expirationTtl: 900 });
    
    // Send welcome/login email via Postmark
    const magicLink = `${BASE_URL}/api/auth/verify?token=${token}`;
    
    console.log(`Sending welcome email to: ${normalizedEmail}`);
    
    let htmlBody, textBody;
    try {
      const userName = name || normalizedEmail.split("@")[0];
      console.log(`Generating email templates for user: ${userName}`);
      htmlBody = getFreeWelcomeEmailHtml(userName, magicLink);
      textBody = getFreeWelcomeEmailText(userName, magicLink);
      console.log("Email templates generated successfully");
    } catch (templateError) {
      console.error("Error generating email templates:", templateError);
      throw templateError;
    }
    
    const emailResponse = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: "support@mymineralwatch.com",
        To: normalizedEmail,
        Subject: "Welcome to Mineral Watch - Verify Your Account",
        HtmlBody: htmlBody,
        TextBody: textBody
      })
    });
    
    if (!emailResponse.ok) {
      const emailError = await emailResponse.text();
      console.error("Postmark email error:", emailError);
      // Don't fail registration if email fails - just log the error
    }
    
    return jsonResponse({ 
      success: true, 
      message: "Account created! Check your email to verify and log in."
    }, 201);
    
  } catch (err) {
    console.error("Registration error:", err.message);
    console.error("Full error:", err.stack || err);
    return jsonResponse({ error: "Registration failed" }, 500);
  }
}
__name(handleRegister, "handleRegister");

function getFreeWelcomeEmailHtml(name, magicLink) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      
      <!-- Header -->
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>
      
      <!-- Content -->
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${name},</p>
        
        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          Welcome to Mineral Watch! Your free account is ready.
        </p>
        
        <!-- CTA Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicLink}" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Verify & Log In →</a>
        </div>
        
        <p style="text-align: center; font-size: 13px; color: #718096; margin: 0 0 30px;">
          This link expires in 15 minutes.
        </p>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <!-- What You're Getting -->
        <h2 style="color: #1C2B36; font-size: 18px; margin: 0 0 16px;">What You're Getting</h2>
        
        <p style="font-size: 15px; color: #334E68; line-height: 1.6; margin: 0 0 20px;">
          Mineral Watch monitors Oklahoma Corporation Commission filings and alerts you when something happens on your minerals. Here's what makes us different:
        </p>
        
        <!-- Feature: Watch the neighbors -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We watch the neighbors</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            Enter your property once and we automatically monitor your section PLUS the 8 surrounding sections. This catches horizontal wells headed your way—not just activity in your exact section.
          </p>
        </div>
        
        <!-- Feature: Check daily -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We check daily</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            Every day we scan for new drilling permits, rigs on location, and well completions.
          </p>
        </div>
        
        <!-- Feature: Status changes -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We track status changes</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            Every week we check for changes like "Shut-In," "Plugged," or change of operator.
          </p>
        </div>
        
        <!-- Feature: Translate -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We translate it</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            No confusing OCC codes. You get plain English alerts like "New Drilling Permit" or "Rig on Location."
          </p>
        </div>
        
        <!-- Feature: Every operator -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">We track every operator</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            We scan the official state database, so we catch activity from everyone—including small operators who don't show up in paid services.
          </p>
        </div>
        
        <!-- Feature: Set and forget -->
        <div style="margin-bottom: 20px;">
          <h3 style="color: #1C2B36; font-size: 15px; margin: 0 0 6px;">Set it and forget it</h3>
          <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
            You enter your legal description once. We handle the rest and only email you when something changes.
          </p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <!-- Your Free Plan -->
        <div style="background: #F7FAFC; border-radius: 6px; padding: 20px; margin: 0 0 25px;">
          <h3 style="margin: 0 0 12px; color: #1C2B36; font-size: 16px;">Your Free Plan</h3>
          <ul style="margin: 0; padding: 0 0 0 20px; color: #334E68; line-height: 1.8; font-size: 14px;">
            <li>1 monitored property</li>
            <li>Adjacent section monitoring included</li>
            <li>Daily permit scans + weekly status checks</li>
            <li>Plain English email alerts</li>
          </ul>
          <p style="font-size: 14px; color: #718096; margin: 16px 0 0;">
            Want to monitor more properties or track specific wells by API number? Upgrade anytime from your dashboard.
          </p>
        </div>
        
        <!-- What We Don't Do -->
        <h3 style="color: #1C2B36; font-size: 16px; margin: 0 0 10px;">What We Don't Do</h3>
        <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0 0 25px;">
          We're focused on drilling activity and well status—not revenue. We don't track pooling applications or royalty payments.
        </p>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <!-- Getting Started -->
        <h3 style="color: #1C2B36; font-size: 16px; margin: 0 0 12px;">Getting Started</h3>
        <p style="font-size: 14px; color: #334E68; line-height: 1.6; margin: 0 0 12px;">
          After you log in, add your first property. You'll need:
        </p>
        <ul style="margin: 0 0 20px; padding: 0 0 0 20px; color: #334E68; line-height: 1.8; font-size: 14px;">
          <li>County</li>
          <li>Section (1-36)</li>
          <li>Township (e.g., 12N)</li>
          <li>Range (e.g., 4W)</li>
        </ul>
        <p style="font-size: 14px; color: #334E68; line-height: 1.5; margin: 0;">
          Paid plans also let you monitor individual wells by API number—with a direct link to the well location on the OCC map.
        </p>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <p style="font-size: 14px; color: #718096; margin: 0;">
          <strong>Questions?</strong> Just reply to this email.
        </p>
        
        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">
          — Mineral Watch
        </p>
      </div>
      
      <!-- Footer -->
      <div style="background: #F7FAFC; padding: 20px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 12px; color: #A0AEC0; margin: 0;">
          You signed up at mymineralwatch.com
        </p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;
}

function getFreeWelcomeEmailText(name, magicLink) {
  return `Hi ${name},

Welcome to Mineral Watch! Your free account is ready.

Click here to verify your email and log in:
${magicLink}

This link expires in 15 minutes.

---

WHAT YOU'RE GETTING

Mineral Watch monitors Oklahoma Corporation Commission filings and alerts you when something happens on your minerals. Here's what makes us different:

WE WATCH THE NEIGHBORS
Enter your property once and we automatically monitor your section PLUS the 8 surrounding sections. This catches horizontal wells headed your way—not just activity in your exact section.

WE CHECK DAILY
Every day we scan for new drilling permits, rigs on location, and well completions.

WE TRACK STATUS CHANGES
Every week we check for changes like "Shut-In," "Plugged," or change of operator.

WE TRANSLATE IT
No confusing OCC codes. You get plain English alerts like "New Drilling Permit" or "Rig on Location."

WE TRACK EVERY OPERATOR
We scan the official state database, so we catch activity from everyone—including small operators who don't show up in paid services.

SET IT AND FORGET IT
You enter your legal description once. We handle the rest and only email you when something changes.

---

YOUR FREE PLAN
- 1 monitored property
- Adjacent section monitoring included
- Daily permit scans + weekly status checks
- Plain English email alerts

Want to monitor more properties or track specific wells by API number? Upgrade anytime from your dashboard.

---

WHAT WE DON'T DO

We're focused on drilling activity and well status—not revenue. We don't track pooling applications or royalty payments.

---

GETTING STARTED

After you log in, add your first property. You'll need:
- County
- Section (1-36)
- Township (e.g., 12N)
- Range (e.g., 4W)

Paid plans also let you monitor individual wells by API number—with a direct link to the well location on the OCC map.

---

Questions? Just reply to this email.

— Mineral Watch

---
You signed up at mymineralwatch.com`;
}

// ====================
// PROPERTY HANDLERS
// ====================

async function handleListProperties(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const formula = `FIND('${user.email}', ARRAYJOIN({User})) > 0`;
  const records = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, formula);
  
  return jsonResponse(records);
}
__name(handleListProperties, "handleListProperties");

async function handleAddProperty(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const body = await request.json();
  const required = ["COUNTY", "SEC", "TWN", "RNG"];
  for (const field of required) {
    if (!body[field]) {
      return jsonResponse({ error: `${field} is required` }, 400);
    }
  }
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  
  // Count properties only (separate from wells limit)
  const propertiesCount = await countUserProperties(env, user.email);
  
  if (propertiesCount >= planLimits.properties) {
    return jsonResponse({ 
      error: `Property limit reached (${planLimits.properties} properties on ${plan} plan). You have ${propertiesCount} properties.` 
    }, 403);
  }
  
  const section = String(body.SEC).padStart(2, "0");
  const township = body.TWN.toUpperCase().replace(/\s/g, "");
  const range = body.RNG.toUpperCase().replace(/\s/g, "");
  const meridian = body.MERIDIAN || "IM";
  const isDuplicate = await checkDuplicateProperty(env, user.email, body.COUNTY, section, township, range);
  if (isDuplicate) {
    return jsonResponse({ error: "You are already monitoring this property." }, 409);
  }
  
  // Generate OCC Map Link (placeholder - adjust as needed for section lookups)
  const occMapLink = `https://occeweb.occ.ok.gov/PublicDocs/`;
  
  const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}`;
  const response = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: {
        User: [user.id],
        COUNTY: body.COUNTY,
        SEC: section,
        TWN: township,
        RNG: range,
        MERIDIAN: meridian,
        "OCC Map Link": occMapLink
      }
    })
  });
  if (!response.ok) {
    const err = await response.text();
    console.error("Airtable create error:", err);
    throw new Error("Failed to create property");
  }
  const newRecord = await response.json();
  console.log(`Property added: ${body.COUNTY} S${section} T${township} R${range} for ${user.email}`);
  return jsonResponse(newRecord, 201);
}
__name(handleAddProperty, "handleAddProperty");

async function handleDeleteProperty(propertyId, request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}/${propertyId}`;
  const getResponse = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!getResponse.ok) {
    return jsonResponse({ error: "Property not found" }, 404);
  }
  const property = await getResponse.json();
  if (property.fields.User?.[0] !== user.id) {
    return jsonResponse({ error: "Not authorized" }, 403);
  }
  const deleteUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}/${propertyId}`;
  await fetch(deleteUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  console.log(`Property deleted: ${propertyId} by ${user.email}`);
  return jsonResponse({ success: true });
}
__name(handleDeleteProperty, "handleDeleteProperty");

async function handleBillingPortal(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const userRecord = await findUserByEmail(env, user.email);
  const customerId = userRecord?.fields["Stripe Customer ID"];
  if (!customerId) {
    return jsonResponse({ error: "No billing account found" }, 404);
  }
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `customer=${customerId}&return_url=${encodeURIComponent(BASE_URL + "/portal/account")}`
  });
  if (!response.ok) {
    console.error("Stripe error:", await response.text());
    return jsonResponse({ error: "Failed to create billing session" }, 500);
  }
  const session = await response.json();
  return jsonResponse({ url: session.url });
}
__name(handleBillingPortal, "handleBillingPortal");

// ====================
// UPGRADE HANDLERS
// ====================

// Price IDs - NEW pricing
const PRICE_IDS = {
  starter_monthly: 'price_1SXDS9641UqM8A7NeSc0MOTv',    // $9/mo
  starter_annual: 'price_1SXDSG641UqM8A7N9PbCLsvG',     // $86/yr
  standard_monthly: 'price_1SXDSL641UqM8A7NSS10CWBd',   // $29/mo
  standard_annual: 'price_1SXDSQ641UqM8A7NIWcuCzmp',    // $278/yr
  professional_monthly: 'price_1SXDSV641UqM8A7NZTXdvUls', // $99/mo
  professional_annual: 'price_1SXDSZ641UqM8A7NvTHEJy9s'   // $950/yr
};

// Map price ID to plan name
const PRICE_TO_PLAN = {
  [PRICE_IDS.starter_monthly]: 'Starter',
  [PRICE_IDS.starter_annual]: 'Starter',
  [PRICE_IDS.standard_monthly]: 'Standard',
  [PRICE_IDS.standard_annual]: 'Standard',
  [PRICE_IDS.professional_monthly]: 'Professional',
  [PRICE_IDS.professional_annual]: 'Professional'
};

async function handleUpgrade(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  const { plan, interval } = body; // plan: 'starter'|'standard'|'professional', interval: 'monthly'|'annual'
  
  const priceKey = `${plan}_${interval}`;
  const priceId = PRICE_IDS[priceKey];
  
  if (!priceId) {
    return jsonResponse({ error: "Invalid plan or interval" }, 400);
  }
  
  const userRecord = await getUserById(env, user.id);
  const currentPlan = userRecord?.fields.Plan || 'Free';
  const stripeCustomerId = userRecord?.fields["Stripe Customer ID"];
  const subscriptionId = userRecord?.fields["Stripe Subscription ID"];
  
  // Determine target plan name
  const targetPlan = PRICE_TO_PLAN[priceId];
  
  // Don't allow "upgrading" to same plan
  if (currentPlan === targetPlan) {
    return jsonResponse({ error: "You're already on this plan" }, 400);
  }
  
  // CASE 1: Free user or no subscription - create Checkout session
  if (currentPlan === 'Free' || !subscriptionId) {
    return await createCheckoutSession(env, user, priceId, stripeCustomerId);
  }
  
  // CASE 2: Existing subscriber - update subscription directly
  return await updateSubscription(env, user, subscriptionId, priceId, targetPlan);
}
__name(handleUpgrade, "handleUpgrade");

async function createCheckoutSession(env, user, priceId, existingCustomerId) {
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('success_url', `${BASE_URL}/api/upgrade/success?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${BASE_URL}/portal/upgrade`);
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('customer_email', user.email);
  
  // If they have a customer ID (e.g., cancelled before), use it
  if (existingCustomerId) {
    params.delete('customer_email');
    params.append('customer', existingCustomerId);
  }
  
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.error('Checkout session error:', err);
    return jsonResponse({ error: 'Failed to create checkout session' }, 500);
  }
  
  const session = await response.json();
  return jsonResponse({ url: session.url, type: 'checkout' });
}
__name(createCheckoutSession, "createCheckoutSession");

async function updateSubscription(env, user, subscriptionId, newPriceId, targetPlan) {
  // First, get the current subscription to find the item ID
  const getSubResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  
  if (!getSubResponse.ok) {
    return jsonResponse({ error: 'Could not find subscription' }, 404);
  }
  
  const subscription = await getSubResponse.json();
  const itemId = subscription.items?.data?.[0]?.id;
  
  if (!itemId) {
    return jsonResponse({ error: 'Subscription has no items' }, 400);
  }
  
  // Update the subscription with the new price
  const params = new URLSearchParams();
  params.append('items[0][id]', itemId);
  params.append('items[0][price]', newPriceId);
  params.append('proration_behavior', 'always_invoice'); // Charge/credit immediately
  
  const updateResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  if (!updateResponse.ok) {
    const err = await updateResponse.text();
    console.error('Subscription update error:', err);
    return jsonResponse({ error: 'Failed to update subscription' }, 500);
  }
  
  // Update Airtable immediately (webhook will also fire, but this is faster)
  const userRecord = await findUserByEmail(env, user.email);
  if (userRecord) {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userRecord.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { Plan: targetPlan } })
    });
  }
  
  console.log(`User ${user.email} upgraded to ${targetPlan}`);
  
  return jsonResponse({ 
    success: true, 
    type: 'updated',
    message: `Successfully changed to ${targetPlan} plan!`
  });
}
__name(updateSubscription, "updateSubscription");

async function handleUpgradeSuccess(request, env, url) {
  const sessionId = url.searchParams.get('session_id');
  
  if (!sessionId) {
    return Response.redirect(`${BASE_URL}/portal/upgrade?error=missing_session`, 302);
  }
  
  // Webhook will handle the actual user creation/update
  // Just redirect to dashboard with success message
  return Response.redirect(`${BASE_URL}/portal?upgraded=true`, 302);
}
__name(handleUpgradeSuccess, "handleUpgradeSuccess");

// ====================
// UTILITY FUNCTIONS
// ====================

// Fetch all records from Airtable with pagination
async function fetchAllAirtableRecords(env, table, formula) {
  let allRecords = [];
  let offset = null;
  
  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}`;
    if (offset) {
      url += `&offset=${offset}`;
    }
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Airtable fetch error for ${table}:`, errText);
      throw new Error(`Airtable error: ${response.status}`);
    }
    
    const data = await response.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset; // Will be undefined when no more pages
    
  } while (offset);
  
  return allRecords;
}
__name(fetchAllAirtableRecords, "fetchAllAirtableRecords");


function getCookieValue(cookieString, name) {
  const match = cookieString.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}
__name(getCookieValue, "getCookieValue");

async function authenticateRequest(request, env) {
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
__name(authenticateRequest, "authenticateRequest");

async function findUserByEmail(env, email) {
  const formula = `LOWER({Email}) = '${email.toLowerCase()}'`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) throw new Error(`Airtable error: ${response.status}`);
  const data = await response.json();
  return data.records?.[0] || null;
}
__name(findUserByEmail, "findUserByEmail");

async function getUserById(env, userId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return null;
  return await response.json();
}
__name(getUserById, "getUserById");

async function countUserProperties(env, userEmail) {
  const formula = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=SEC`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return 0;
  const data = await response.json();
  return data.records?.length || 0;
}
__name(countUserProperties, "countUserProperties");

async function checkDuplicateProperty(env, userEmail, county, section, township, range) {
  const formula = `AND(FIND('${userEmail}', ARRAYJOIN({User})) > 0, {COUNTY} = '${county}', {SEC} = '${section}', {TWN} = '${township}', {RNG} = '${range}')`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.records?.length > 0;
}
__name(checkDuplicateProperty, "checkDuplicateProperty");

async function generateToken(env, payload, ttlSeconds = 900) {
  const tokenId = crypto.randomUUID();
  await env.AUTH_TOKENS.put(tokenId, JSON.stringify(payload), {
    expirationTtl: ttlSeconds
  });
  return tokenId;
}
__name(generateToken, "generateToken");

async function verifyToken(env, token) {
  const data = await env.AUTH_TOKENS.get(token, "json");
  if (!data) throw new Error("Token not found or expired");
  await env.AUTH_TOKENS.delete(token);
  return data;
}
__name(verifyToken, "verifyToken");

async function verifySession(env, token) {
  const data = await env.AUTH_TOKENS.get(token, "json");
  if (!data) throw new Error("Session not found or expired");
  return data;
}
__name(verifySession, "verifySession");

async function sendMagicLinkEmail(env, email, name, magicLink) {
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      From: "support@mymineralwatch.com",
      To: email,
      Subject: "Your Mineral Watch Login Link",
      HtmlBody: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #1C2B36;">Log in to Mineral Watch</h2>
          <p style="color: #334E68;">Hi ${name},</p>
          <p style="color: #334E68;">Click below to log in. This link expires in 15 minutes.</p>
          <div style="margin: 30px 0;">
            <a href="${magicLink}" style="background-color: #C05621; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; font-weight: 600;">Log In to Mineral Watch</a>
          </div>
          <p style="color: #718096; font-size: 14px;">If you didn't request this, you can ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
          <p style="color: #A0AEC0; font-size: 12px;">Mineral Watch - Oklahoma Mineral Rights Monitoring</p>
        </div>
      `,
      TextBody: `Hi ${name},

Click this link to log in to Mineral Watch: ${magicLink}

This link expires in 15 minutes.

If you didn't request this, you can ignore this email.`
    })
  });
  if (!response.ok) {
    console.error("Postmark error:", await response.text());
    throw new Error("Failed to send email");
  }
}
__name(sendMagicLinkEmail, "sendMagicLinkEmail");

// --- TRACK WELL PAGE GENERATORS ---
function generateTrackWellSuccessPage(apiNumber, alreadyTracking, wellName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Well Tracked - Mineral Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Inter, sans-serif; background: #F3F4F6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); padding: 40px; text-align: center; }
        .success-icon { width: 80px; height: 80px; border-radius: 50%; background: #D1FAE5; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 40px; }
        h1 { font-family: Merriweather, serif; font-size: 28px; color: #047857; margin-bottom: 16px; }
        .subtitle { font-size: 18px; color: #6B7280; margin-bottom: 32px; }
        .well-info { background: #F9FAFB; border-radius: 8px; padding: 20px; margin-bottom: 32px; text-align: left; }
        .well-info h3 { color: #374151; margin-bottom: 12px; }
        .well-detail { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .well-detail:last-child { margin-bottom: 0; }
        .label { color: #6B7280; }
        .value { color: #111827; font-weight: 500; }
        .buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
        .btn { padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; display: inline-block; }
        .btn-primary { background: #047857; color: white; }
        .btn-secondary { background: #E5E7EB; color: #374151; }
        .btn:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="success-icon">${alreadyTracking ? '✓' : '🎉'}</div>
            <h1>${alreadyTracking ? 'Already Tracking' : 'Successfully Added!'}</h1>
            <p class="subtitle">
                ${alreadyTracking 
                  ? 'You\'re already tracking this well.' 
                  : 'This well has been added to your tracking list.'}
            </p>
            
            <div class="well-info">
                <h3>Well Information</h3>
                <div class="well-detail">
                    <span class="label">API Number:</span>
                    <span class="value">${apiNumber}</span>
                </div>
                ${wellName ? `
                <div class="well-detail">
                    <span class="label">Well Name:</span>
                    <span class="value">${wellName}</span>
                </div>
                ` : ''}
                <div class="well-detail">
                    <span class="label">Status:</span>
                    <span class="value">Active Monitoring</span>
                </div>
            </div>
            
            <div class="buttons">
                <a href="${BASE_URL}/portal" class="btn btn-primary">View Dashboard</a>
                <a href="${BASE_URL}/portal" class="btn btn-secondary">Manage Wells</a>
            </div>
        </div>
    </div>
</body>
</html>`;
}

function generateTrackWellErrorPage(message, showUpgrade = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error - Mineral Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Inter, sans-serif; background: #F3F4F6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); padding: 40px; text-align: center; }
        .error-icon { width: 80px; height: 80px; border-radius: 50%; background: #FEF2F2; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 40px; color: #DC2626; }
        h1 { font-family: Merriweather, serif; font-size: 28px; color: #DC2626; margin-bottom: 16px; }
        .message { font-size: 16px; color: #6B7280; margin-bottom: 32px; line-height: 1.5; }
        .buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
        .btn { padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; display: inline-block; }
        .btn-primary { background: #047857; color: white; }
        .btn-secondary { background: #E5E7EB; color: #374151; }
        .btn-warning { background: #F59E0B; color: white; }
        .btn:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="error-icon">⚠️</div>
            <h1>Unable to Track Well</h1>
            <p class="message">${message}</p>
            
            <div class="buttons">
                ${showUpgrade 
                  ? '<a href="' + BASE_URL + '/portal/upgrade" class="btn btn-warning">Upgrade Plan</a>'
                  : ''
                }
                <a href="${BASE_URL}/portal" class="btn btn-primary">Go to Dashboard</a>
                <a href="${BASE_URL}/portal/login" class="btn btn-secondary">Login</a>
            </div>
        </div>
    </div>
</body>
</html>`;
}

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

