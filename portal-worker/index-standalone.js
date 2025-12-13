// UPDATED MINERAL WATCH PORTAL WORKER - WITH WELLS SUPPORT
// Deploy with: wrangler deploy

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var COOKIE_NAME = "mw_session";
var TOKEN_EXPIRY = 15 * 60 * 1e3;
var SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1e3;
var BASE_ID = "app3j3X29Uvp5stza";
var USERS_TABLE = "👤 Users";
var PROPERTIES_TABLE = "📍 Client Properties";
var WELLS_TABLE = "🛢️ Client Wells";
var BASE_URL = "https://portal.mymineralwatch.com";
var PLAN_LIMITS = {
  "Free": { properties: 1, wells: 0 },
  "Starter": { properties: 10, wells: 10 },
  "Standard": { properties: 50, wells: 50 },
  "Professional": { properties: 500, wells: 500 },
  "Enterprise": { properties: Infinity, wells: Infinity }
};
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    try {
      if (path === "/" || path === "") {
        return Response.redirect(`${BASE_URL}/portal`, 302);
      }
      if (path === "/portal" || path === "/portal/") {
        return servePage(DASHBOARD_HTML, request, env);
      }
      if (path === "/portal/login" || path === "/portal/login/") {
        return servePage(LOGIN_HTML, request, env);
      }
      if (path === "/portal/account" || path === "/portal/account/") {
        return servePage(ACCOUNT_HTML, request, env);
      }
      if (path === "/portal/upgrade" || path === "/portal/upgrade/") {
        return servePage(UPGRADE_HTML, request, env);
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
      const deletePropertyMatch = path.match(/^\/api\/properties\/([a-zA-Z0-9]+)$/);
      if (deletePropertyMatch && request.method === "DELETE") {
        return handleDeleteProperty(deletePropertyMatch[1], request, env);
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
      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }
};

// ====================
// WELL HANDLERS
// ====================

async function handleListWells(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const formula = `FIND('${user.email}', ARRAYJOIN({User})) > 0`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Airtable list wells error:", errText);
    throw new Error(`Airtable error: ${response.status}`);
  }
  const data = await response.json();
  return jsonResponse(data.records);
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
  const wellDetails = await fetchWellDetailsFromOCC(cleanApi);
  
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
  const formula = `AND(FIND('${user.id}', ARRAYJOIN({User})) > 0, {Detected At} >= '${cutoffISO}')`;
  
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
  const formula = `FIND('${user.id}', ARRAYJOIN({User})) > 0`;
  
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
    } else if (Number(normalized.SEC) < 1 || Number(normalized.SEC) > 36) {
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
    
    return {
      row: index + 1,
      original: well,
      normalized: {
        apiNumber: cleanApi,
        wellName: well.wellName || well.WELL_NAME || well.Well_Name || well.name || ''
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
      const occData = await fetchWellDetailsFromOCC(well.apiNumber);
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
              Notes: ""
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
function normalizePropertyData(prop) {
  return {
    SEC: normalizeSectionNumber(prop.SEC || prop.Section || prop.Sec || prop.S),
    TWN: normalizeTownship(prop.TWN || prop.Township || prop.Town || prop.T),
    RNG: normalizeRange(prop.RNG || prop.Range || prop.R),
    MERIDIAN: normalizeMeridian(prop.MERIDIAN || prop.Meridian || prop.MER || prop.M),
    COUNTY: normalizeCounty(prop.COUNTY || prop.County || prop.Co || prop.CTY),
    NOTES: prop.NOTES || prop.Notes || prop.Note || prop.Comments || ""
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


async function fetchWellDetailsFromOCC(apiNumber) {
  const baseUrl = "https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query";
  
  // Fetch all useful fields from OCC GIS
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
      // Combine well_name and well_num, but check if well_num is already in well_name
      let wellName = attr.well_name || '';
      if (attr.well_num && !wellName.includes(attr.well_num)) {
        wellName = `${wellName} ${attr.well_num}`.trim();
      }
      return {
        api: attr.api,
        wellName: wellName,
        operator: attr.operator || null,
        county: attr.county || null,
        section: attr.section || null,
        township: attr.township || null,
        range: attr.range || null,
        wellType: attr.welltype || null,
        wellStatus: attr.wellstatus || null,
        lat: attr.sh_lat,
        lon: attr.sh_lon
      };
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
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?filterByFormula=${encodeURIComponent(formula)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Airtable list error:", errText);
    throw new Error(`Airtable error: ${response.status}`);
  }
  const data = await response.json();
  return jsonResponse(data.records);
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
__name(jsonResponse, "jsonResponse");

function servePage(html, request, env) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
__name(servePage, "servePage");

function redirectWithError(message) {
  const params = new URLSearchParams({ error: message });
  return new Response(null, {
    status: 302,
    headers: { "Location": `/portal/login?${params}` }
  });
}
__name(redirectWithError, "redirectWithError");

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

// ====================
// HTML PAGES
// ====================

var LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Mineral Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        :root { --oil-navy: #1C2B36; --slate-blue: #334E68; --red-dirt: #C05621; --red-dirt-dark: #9C4215; --paper: #F8F9FA; --border: #E2E8F0; --success: #03543F; --success-bg: #DEF7EC; --error: #DC2626; --error-bg: #FEE2E2; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background: #F7FAFC; min-height: 100vh; display: flex; flex-direction: column; }
        h1, h2, .logo { font-family: 'Merriweather', serif; }
        header { background: var(--oil-navy); padding: 20px 0; text-align: center; }
        .logo { font-size: 24px; font-weight: 900; color: white; text-decoration: none; }
        main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 20px; }
        .login-card { background: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); padding: 40px; width: 100%; max-width: 420px; }
        .login-card h1 { font-size: 24px; margin-bottom: 8px; }
        .login-card p { color: var(--slate-blue); margin-bottom: 30px; font-size: 15px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--oil-navy); }
        input[type="email"], input[type="text"] { width: 100%; padding: 12px 14px; border: 1px solid var(--border); border-radius: 4px; font-size: 15px; transition: border-color 0.2s; }
        input[type="email"]:focus, input[type="text"]:focus { outline: none; border-color: var(--red-dirt); }
        .btn { width: 100%; padding: 14px; background: var(--red-dirt); color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
        .btn:hover { background: var(--red-dirt-dark); }
        .btn:disabled { opacity: 0.7; cursor: not-allowed; }
        .message { padding: 12px 16px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
        .message.error { background: var(--error-bg); color: var(--error); }
        .message.success { background: var(--success-bg); color: var(--success); }
        .toggle-mode { text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 14px; color: var(--slate-blue); }
        .toggle-mode a { color: var(--red-dirt); text-decoration: none; font-weight: 600; }
        .toggle-mode a:hover { text-decoration: underline; }
        footer { background: var(--oil-navy); color: #A0AEC0; padding: 20px; text-align: center; font-size: 13px; }
    </style>
</head>
<body>
    <header><a href="/" class="logo">Mineral Watch</a></header>
    <main>
        <div class="login-card">
            <!-- Login Form -->
            <div id="loginSection">
                <h1>Welcome back</h1>
                <p>Enter your email to receive a secure login link.</p>
                <div id="loginMessage"></div>
                <form id="loginForm">
                    <div class="form-group">
                        <label for="loginEmail">Email Address</label>
                        <input type="email" id="loginEmail" placeholder="you@example.com" required>
                    </div>
                    <button type="submit" class="btn" id="loginBtn">Send Login Link</button>
                </form>
                <div class="toggle-mode">
                    Don't have an account? <a href="#" onclick="showSignup(event)">Sign up free</a>
                </div>
            </div>
            
            <!-- Signup Form -->
            <div id="signupSection" style="display: none;">
                <h1>Start free</h1>
                <p>Monitor 1 property free. No credit card required.</p>
                <div id="signupMessage"></div>
                <form id="signupForm">
                    <div class="form-group">
                        <label for="signupName">Your Name</label>
                        <input type="text" id="signupName" placeholder="John Smith" required>
                    </div>
                    <div class="form-group">
                        <label for="signupEmail">Email Address</label>
                        <input type="email" id="signupEmail" placeholder="you@example.com" required>
                    </div>
                    <button type="submit" class="btn" id="signupBtn">Create Free Account</button>
                </form>
                <div class="toggle-mode">
                    Already have an account? <a href="#" onclick="showLogin(event)">Log in</a>
                </div>
            </div>
        </div>
    </main>
    <footer>&copy; 2025 Mineral Watch</footer>
    <script>
        // Check for error params
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            document.getElementById('loginMessage').innerHTML = '<div class="message error">' + error + '</div>';
        }
        
        // Toggle between login and signup
        function showSignup(e) {
            e.preventDefault();
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('signupSection').style.display = 'block';
        }
        
        function showLogin(e) {
            e.preventDefault();
            document.getElementById('signupSection').style.display = 'none';
            document.getElementById('loginSection').style.display = 'block';
        }
        
        // Login form handler
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('loginBtn');
            const email = document.getElementById('loginEmail').value;
            
            btn.disabled = true;
            btn.textContent = 'Sending...';
            
            try {
                const res = await fetch('/api/auth/send-magic-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                
                if (res.ok) {
                    document.getElementById('loginMessage').innerHTML = '<div class="message success">Check your email for a login link!</div>';
                    document.getElementById('loginForm').style.display = 'none';
                } else {
                    const data = await res.json();
                    throw new Error(data.error || 'Failed to send');
                }
            } catch (err) {
                document.getElementById('loginMessage').innerHTML = '<div class="message error">' + (err.message || 'Something went wrong. Please try again.') + '</div>';
                btn.disabled = false;
                btn.textContent = 'Send Login Link';
            }
        });
        
        // Signup form handler
        document.getElementById('signupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('signupBtn');
            const name = document.getElementById('signupName').value;
            const email = document.getElementById('signupEmail').value;
            
            btn.disabled = true;
            btn.textContent = 'Creating account...';
            
            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email })
                });
                
                const data = await res.json();
                
                if (res.ok) {
                    document.getElementById('signupMessage').innerHTML = '<div class="message success">' + data.message + '</div>';
                    document.getElementById('signupForm').style.display = 'none';
                } else {
                    throw new Error(data.error || 'Registration failed');
                }
            } catch (err) {
                document.getElementById('signupMessage').innerHTML = '<div class="message error">' + (err.message || 'Something went wrong. Please try again.') + '</div>';
                btn.disabled = false;
                btn.textContent = 'Create Free Account';
            }
        });
    </script>
</body>
</html>`;

var DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Mineral Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        :root { --oil-navy: #1C2B36; --slate-blue: #334E68; --red-dirt: #C05621; --red-dirt-dark: #9C4215; --paper: #F8F9FA; --border: #E2E8F0; --success: #03543F; --success-bg: #DEF7EC; --error: #DC2626; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background: #F7FAFC; min-height: 100vh; }
        h1, h2, .logo { font-family: 'Merriweather', serif; }
        header { background: var(--oil-navy); padding: 15px 0; color: white; }
        .container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
        .header-inner { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 20px; font-weight: 900; color: white; text-decoration: none; }
        .nav-links { display: flex; gap: 25px; }
        .nav-links a { color: rgba(255,255,255,0.8); text-decoration: none; font-weight: 500; font-size: 14px; }
        .nav-links a:hover, .nav-links a.active { color: white; }
        .user-menu { display: flex; align-items: center; gap: 15px; }
        .user-name { font-size: 14px; color: rgba(255,255,255,0.8); }
        .btn-logout { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 8px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; }
        main { padding: 40px 0; }
        .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .page-header h1 { font-size: 28px; }
        .header-actions { display: flex; gap: 12px; }
        .btn-add { background: var(--red-dirt); color: white; padding: 12px 20px; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .btn-add:hover { background: var(--red-dirt-dark); }
        .plan-info { background: white; border-radius: 8px; padding: 16px 20px; margin-bottom: 25px; display: flex; align-items: center; gap: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); flex-wrap: wrap; }
        .plan-badge { background: var(--success-bg); color: var(--success); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .plan-usage { font-size: 14px; color: var(--slate-blue); display: flex; gap: 20px; flex-wrap: wrap; }
        .usage-item { display: flex; align-items: center; gap: 6px; }
        .upgrade-link { margin-left: auto; color: var(--red-dirt); text-decoration: none; font-size: 14px; font-weight: 600; }
        .stats-card { background: white; border-radius: 8px; padding: 20px 30px; margin-bottom: 25px; display: flex; align-items: center; justify-content: center; gap: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .stat-item { text-align: center; }
        .stat-label { display: block; font-size: 12px; color: var(--slate-blue); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .stat-value { display: block; font-size: 24px; font-weight: 700; color: var(--oil-navy); font-family: 'Merriweather', serif; }
        .stat-divider { width: 1px; height: 40px; background: var(--border); }
        .activity-list { padding: 0; }
        .activity-item { display: flex; gap: 16px; padding: 20px; border-bottom: 1px solid var(--border); }
        .activity-item:last-child { border-bottom: none; }
        .activity-icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
        .activity-icon.permit { background: #DBEAFE; }
        .activity-icon.drilling { background: #FEF3C7; }
        .activity-icon.completed { background: #DEF7EC; }
        .activity-icon.transfer { background: #EDE9FE; }
        .activity-icon.status { background: #E0F2FE; }
        .activity-icon.abandoned { background: #F3F4F6; }
        .activity-details { flex: 1; }
        .activity-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
        .activity-type { font-weight: 600; font-size: 14px; color: var(--oil-navy); }
        .activity-level { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
        .activity-level.property { background: #FEE2E2; color: #991B1B; }
        .activity-level.adjacent { background: #FEF3C7; color: #92400E; }
        .activity-level.tracked { background: #CCFBF1; color: #115E59; }
        .activity-well { font-size: 15px; font-weight: 500; margin-bottom: 4px; }
        .activity-meta { font-size: 13px; color: var(--slate-blue); }
        .activity-change { background: var(--paper); padding: 8px 12px; border-radius: 4px; font-size: 13px; margin-top: 8px; display: inline-block; }
        .activity-actions { display: flex; gap: 8px; margin-top: 10px; }
        .activity-btn { display: inline-block; padding: 6px 12px; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 4px; background: var(--paper); color: var(--slate-blue); border: 1px solid var(--border); transition: all 0.2s; }
        .activity-btn:hover { background: var(--red-dirt); color: white; border-color: var(--red-dirt); }
        .activity-date { font-size: 12px; color: #718096; white-space: nowrap; }
        .activity-limit-notice { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 16px; margin: 16px 20px; border-radius: 0 4px 4px 0; font-size: 13px; color: #92400E; }
        .activity-limit-notice a { color: #92400E; font-weight: 600; }
        .tabs { display: flex; gap: 4px; margin-bottom: 20px; }
        .tab { background: #E2E8F0; border: none; padding: 12px 24px; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 14px; font-weight: 600; color: var(--slate-blue); transition: all 0.2s; }
        .tab.active { background: white; color: var(--oil-navy); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .tab:not(.active):hover { background: #CBD5E1; }
        .content-card { background: white; border-radius: 0 8px 8px 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .data-table { width: 100%; border-collapse: collapse; }
        .data-table th { background: var(--paper); text-align: left; padding: 14px 20px; font-size: 12px; font-weight: 600; color: var(--slate-blue); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
        .data-table th.sortable { cursor: pointer; user-select: none; }
        .data-table th.sortable:hover { background: #E2E8F0; }
        .data-table td { padding: 16px 20px; border-bottom: 1px solid var(--border); font-size: 14px; }
        .data-table tr:last-child td { border-bottom: none; }
        .status-active { color: var(--success); font-weight: 600; }
        .btn-link { background: none; border: none; color: var(--red-dirt); cursor: pointer; font-size: 13px; text-decoration: underline; margin-right: 12px; }
        .btn-link:hover { color: var(--red-dirt-dark); }
        .btn-delete { background: none; border: none; color: #DC2626; cursor: pointer; font-size: 13px; }
        .btn-delete:hover { text-decoration: underline; }
        .empty-state { text-align: center; padding: 60px 20px; color: var(--slate-blue); }
        .empty-state p { margin-bottom: 20px; }
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: white; border-radius: 8px; padding: 30px; width: 90%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
        .modal h2 { margin-bottom: 20px; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
        .form-group { margin-bottom: 15px; }
        .form-group.full { grid-column: span 2; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 14px; font-family: inherit; }
        .form-group textarea { resize: vertical; min-height: 60px; }
        .form-hint { font-size: 12px; color: var(--slate-blue); margin-top: 4px; }
        .modal-buttons { display: flex; gap: 10px; justify-content: flex-end; margin-top: 25px; }
        .btn-cancel { padding: 10px 20px; border: 1px solid var(--border); background: white; border-radius: 4px; cursor: pointer; font-size: 14px; }
        .btn-submit { padding: 10px 20px; background: var(--red-dirt); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600; }
        .details-grid { display: flex; flex-direction: column; gap: 12px; }
        .details-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border); }
        .details-row:last-child { border-bottom: none; }
        .details-label { font-size: 13px; color: var(--slate-blue); font-weight: 500; }
        .details-value { font-size: 14px; color: var(--oil-navy); font-weight: 500; text-align: right; max-width: 60%; }
        .details-actions { display: flex; gap: 10px; margin-top: 20px; }
        .details-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 4px; background: var(--paper); color: var(--slate-blue); border: 1px solid var(--border); flex: 1; text-align: center; }
        .details-btn:hover { background: #E2E8F0; }
        .details-btn.primary { background: var(--red-dirt); color: white; border-color: var(--red-dirt); }
        .details-btn.primary:hover { background: var(--red-dirt-dark); }
        footer { background: var(--oil-navy); color: #A0AEC0; padding: 20px 0; font-size: 13px; text-align: center; margin-top: auto; }
        @media (max-width: 768px) { 
            .form-row { grid-template-columns: 1fr; } 
            .form-group.full { grid-column: span 1; } 
            .user-name { display: none; } 
            .data-table { font-size: 13px; } 
            .data-table th, .data-table td { padding: 12px; }
            .plan-usage { gap: 10px; }
            .header-actions { flex-direction: column; width: 100%; }
            .btn-add { width: 100%; justify-content: center; }
            .stats-card { flex-direction: column; gap: 15px; padding: 15px 20px; }
            .stat-divider { width: 60px; height: 1px; }
            .stat-value { font-size: 20px; }
            .activity-item { flex-direction: column; gap: 12px; }
            .activity-header { flex-direction: column; gap: 8px; }
            .activity-date { align-self: flex-start; }
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <div class="header-inner">
                <a href="/" class="logo">Mineral Watch</a>
                <nav class="nav-links">
                    <a href="/portal" class="active">Dashboard</a>
                    <a href="/portal/account">Account</a>
                </nav>
                <div class="user-menu">
                    <span class="user-name" id="userName">Loading...</span>
                    <button class="btn-logout" id="logoutBtn">Log Out</button>
                </div>
            </div>
        </div>
    </header>
    <main>
        <div class="container">
            <div class="page-header">
                <h1>My Monitoring</h1>
                <div class="header-actions">
                    <button class="btn-add" id="addPropertyBtn">+ Add Property</button>
                    <button class="btn-add" id="bulkUploadBtn" style="background: var(--slate-blue);">📄 Import Properties</button>
                    <button class="btn-add" id="exportPropertiesBtn" style="background: var(--success); display: none;" onclick="exportPropertiesCSV()">⬇️ Export Properties</button>
                    <button class="btn-add" id="removeAllPropertiesBtn" style="background: #DC2626; display: none;" onclick="removeAllProperties()">🗑️ Remove All</button>
                    <button class="btn-add" id="addWellBtn">+ Add Well</button>
                    <button class="btn-add" id="bulkUploadWellsBtn" style="background: var(--slate-blue);">🛢️ Import Wells</button>
                    <button class="btn-add" id="exportWellsBtn" style="background: var(--success); display: none;" onclick="exportWellsCSV()">⬇️ Export Wells</button>
                    <button class="btn-add" id="removeAllWellsBtn" style="background: #DC2626; display: none;" onclick="removeAllWells()">🗑️ Remove All</button>
                </div>
            </div>
            
            <div class="plan-info">
                <span class="plan-badge" id="planBadge">FREE</span>
                <div class="plan-usage">
                    <div class="usage-item">
                        <span><strong id="propCount">0</strong> / <strong id="propLimit">1</strong> Properties</span>
                    </div>
                    <div class="usage-item">
                        <span>|</span>
                    </div>
                    <div class="usage-item">
                        <span><strong id="wellCount">0</strong> / <strong id="wellLimit">0</strong> Wells</span>
                    </div>
                </div>
                <a href="/portal/upgrade" class="upgrade-link" id="upgradeLink">Upgrade →</a>
            </div>
            
            <div class="stats-card" id="statsCard">
                <div class="stat-item">
                    <span class="stat-label">Last Alert</span>
                    <span class="stat-value" id="statLastAlert">—</span>
                </div>
                <div class="stat-divider"></div>
                <div class="stat-item">
                    <span class="stat-label">This Month</span>
                    <span class="stat-value" id="statThisMonth">0</span>
                </div>
                <div class="stat-divider"></div>
                <div class="stat-item">
                    <span class="stat-label">This Year</span>
                    <span class="stat-value" id="statThisYear">0</span>
                </div>
            </div>

            <div class="tabs">
                <button class="tab active" data-tab="properties">Properties</button>
                <button class="tab" data-tab="wells">Wells</button>
                <button class="tab" data-tab="activity">📋 Activity Log</button>
            </div>

            <div class="content-card">
                <div id="properties-tab" class="tab-content active">
                    <div id="propertiesContent">
                        <div class="empty-state"><p>Loading properties...</p></div>
                    </div>
                </div>
                
                <div id="wells-tab" class="tab-content">
                    <div id="wellsContent">
                        <div class="empty-state"><p>Loading wells...</p></div>
                    </div>
                </div>
                
                <div id="activity-tab" class="tab-content">
                    <div id="activityContent">
                        <div class="empty-state"><p>Loading activity...</p></div>
                    </div>
                </div>
            </div>
        </div>
    </main>
    <footer><div class="container">&copy; 2025 Mineral Watch</div></footer>
    
    <!-- Add Property Modal -->
    <div class="modal-overlay" id="addPropertyModal">
        <div class="modal">
            <h2>Add Property</h2>
            <form id="addPropertyForm">
                <div class="form-group full">
                    <label for="county">County</label>
                    <select id="county" required>
                        <option value="">Select County</option>
                        <option>Alfalfa</option><option>Atoka</option><option>Beaver</option><option>Beckham</option><option>Blaine</option><option>Bryan</option><option>Caddo</option><option>Canadian</option><option>Carter</option><option>Cherokee</option><option>Choctaw</option><option>Cimarron</option><option>Cleveland</option><option>Coal</option><option>Comanche</option><option>Cotton</option><option>Craig</option><option>Creek</option><option>Custer</option><option>Delaware</option><option>Dewey</option><option>Ellis</option><option>Garfield</option><option>Garvin</option><option>Grady</option><option>Grant</option><option>Greer</option><option>Harmon</option><option>Harper</option><option>Haskell</option><option>Hughes</option><option>Jackson</option><option>Jefferson</option><option>Johnston</option><option>Kay</option><option>Kingfisher</option><option>Kiowa</option><option>Latimer</option><option>Le Flore</option><option>Lincoln</option><option>Logan</option><option>Love</option><option>Major</option><option>Marshall</option><option>Mayes</option><option>McClain</option><option>McCurtain</option><option>McIntosh</option><option>Murray</option><option>Muskogee</option><option>Noble</option><option>Nowata</option><option>Okfuskee</option><option>Oklahoma</option><option>Okmulgee</option><option>Osage</option><option>Ottawa</option><option>Pawnee</option><option>Payne</option><option>Pittsburg</option><option>Pontotoc</option><option>Pottawatomie</option><option>Pushmataha</option><option>Roger Mills</option><option>Rogers</option><option>Seminole</option><option>Sequoyah</option><option>Stephens</option><option>Texas</option><option>Tillman</option><option>Tulsa</option><option>Wagoner</option><option>Washington</option><option>Washita</option><option>Woods</option><option>Woodward</option>
                    </select>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="section">Section</label>
                        <input type="text" id="section" placeholder="e.g. 15" required>
                    </div>
                    <div class="form-group">
                        <label for="township">Township</label>
                        <input type="text" id="township" placeholder="e.g. 12N" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="range">Range</label>
                        <input type="text" id="range" placeholder="e.g. 4W" required>
                    </div>
                    <div class="form-group">
                        <label for="meridian">Meridian</label>
                        <select id="meridian">
                            <option value="IM">Indian Meridian (IM)</option>
                            <option value="CM">Cimarron Meridian (CM)</option>
                        </select>
                    </div>
                </div>
                <div class="modal-buttons">
                    <button type="button" class="btn-cancel" onclick="closePropertyModal()">Cancel</button>
                    <button type="submit" class="btn-submit">Add Property</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Add Well Modal -->
    <div class="modal-overlay" id="addWellModal">
        <div class="modal">
            <h2>Add Well API</h2>
            <form id="addWellForm">
                <div class="form-group full">
                    <label for="apiNumber">API Number *</label>
                    <input type="text" id="apiNumber" placeholder="3515322352" required>
                    <div class="form-hint">10-digit Oklahoma well API (starts with 35)</div>
                </div>
                <div class="form-group full">
                    <label for="wellName">Well Name (Optional)</label>
                    <input type="text" id="wellName" placeholder="Your reference name">
                    <div class="form-hint">Optional nickname for your own reference</div>
                </div>
                <div class="form-group full">
                    <label for="wellNotes">Notes (Optional)</label>
                    <textarea id="wellNotes" placeholder="Any notes about this well"></textarea>
                </div>
                <div class="modal-buttons">
                    <button type="button" class="btn-cancel" onclick="closeWellModal()">Cancel</button>
                    <button type="submit" class="btn-submit">Add Well</button>
                </div>
            </form>
        </div>
    </div>
    
    <!-- Well Details Modal -->
    <div class="modal-overlay" id="wellDetailsModal">
        <div class="modal" style="max-width: 550px;">
            <h2 style="margin-bottom: 5px;" id="wellDetailsTitle">Well Details</h2>
            <p style="color: var(--slate-blue); font-size: 14px; margin-bottom: 20px;" id="wellDetailsApi">API: —</p>
            
            <div class="details-grid">
                <div class="details-row">
                    <span class="details-label">Operator</span>
                    <span class="details-value" id="wellDetailsOperator">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Location</span>
                    <span class="details-value" id="wellDetailsLocation">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">County</span>
                    <span class="details-value" id="wellDetailsCounty">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Well Type</span>
                    <span class="details-value" id="wellDetailsType">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">OCC Status</span>
                    <span class="details-value" id="wellDetailsStatus">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Notes</span>
                    <span class="details-value" id="wellDetailsNotes">—</span>
                </div>
            </div>
            
            <div class="details-actions">
                <a href="#" target="_blank" class="details-btn primary" id="wellDetailsMapLink">📍 View on Map</a>
                <a href="#" target="_blank" class="details-btn" id="wellDetailsOccLink">📄 OCC Filing</a>
            </div>
            
            <div class="modal-buttons" style="margin-top: 20px;">
                <button type="button" class="btn-cancel" onclick="closeWellDetailsModal()">Close</button>
            </div>
        </div>
    </div>
    
    <!-- Property Details Modal -->
    <div class="modal-overlay" id="propertyDetailsModal">
        <div class="modal" style="max-width: 500px;">
            <h2 style="margin-bottom: 5px;" id="propertyDetailsTitle">Property Details</h2>
            <p style="color: var(--slate-blue); font-size: 14px; margin-bottom: 20px;" id="propertyDetailsLegal">—</p>
            
            <div class="details-grid">
                <div class="details-row">
                    <span class="details-label">County</span>
                    <span class="details-value" id="propertyDetailsCounty">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Section</span>
                    <span class="details-value" id="propertyDetailsSection">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Township</span>
                    <span class="details-value" id="propertyDetailsTownship">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Range</span>
                    <span class="details-value" id="propertyDetailsRange">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Meridian</span>
                    <span class="details-value" id="propertyDetailsMeridian">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Monitor Adjacent</span>
                    <span class="details-value" id="propertyDetailsAdjacent">—</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Notes</span>
                    <span class="details-value" id="propertyDetailsNotes">—</span>
                </div>
            </div>
            
            <div class="modal-buttons" style="margin-top: 20px;">
                <button type="button" class="btn-cancel" onclick="closePropertyDetailsModal()">Close</button>
            </div>
        </div>
    </div>
    
    <script>
        const planConfigs = { 
            'Free': { properties: 1, wells: 0 }, 
            'Starter': { properties: 10, wells: 10 }, 
            'Standard': { properties: 50, wells: 50 }, 
            'Professional': { properties: 500, wells: 500 }, 
            'Enterprise': { properties: Infinity, wells: Infinity } 
        };
        let currentTab = 'properties';
        let currentUser = null; // Store user data globally
        let loadedProperties = []; // Store for details modal
        let loadedWells = []; // Store for details modal
        
        document.addEventListener('DOMContentLoaded', async () => {
            try {
                const res = await fetch('/api/auth/me');
                if (!res.ok) { window.location.href = '/portal/login'; return; }
                currentUser = await res.json();
                document.getElementById('userName').textContent = currentUser.name || currentUser.email;
                document.getElementById('planBadge').textContent = currentUser.plan || 'FREE';
                const limits = planConfigs[currentUser.plan] || { properties: 1, wells: 0 };
                document.getElementById('propLimit').textContent = limits.properties === Infinity ? '∞' : limits.properties;
                document.getElementById('wellLimit').textContent = limits.wells === Infinity ? '∞' : limits.wells;
                
                // Hide upgrade link for Enterprise users
                if (currentUser.plan === 'Enterprise') {
                    document.getElementById('upgradeLink').style.display = 'none';
                }
                
                // Show export buttons for Professional and Enterprise users
                if (currentUser.plan === 'Professional' || currentUser.plan === 'Enterprise') {
                    document.getElementById('exportPropertiesBtn').style.display = 'inline-flex';
                    document.getElementById('exportWellsBtn').style.display = 'inline-flex';
                }
                
                // Show remove all buttons for all users
                document.getElementById('removeAllPropertiesBtn').style.display = 'inline-flex';
                document.getElementById('removeAllWellsBtn').style.display = 'inline-flex';
                
                await loadAllData();
            } catch { window.location.href = '/portal/login'; }

            // Tab switching
            document.querySelectorAll('.tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    currentTab = tab.dataset.tab;
                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    document.getElementById(currentTab + '-tab').classList.add('active');
                    
                    // Load activity data when tab is selected (lazy load)
                    if (currentTab === 'activity') {
                        loadActivity();
                    }
                });
            });
        });
        
        async function loadAllData() {
            await Promise.all([loadProperties(), loadWells(), loadActivityStats()]);
        }

        async function loadProperties() {
            try {
                const res = await fetch('/api/properties');
                if (!res.ok) throw new Error('Failed to load');
                const properties = await res.json();
                loadedProperties = properties; // Store for details modal
                document.getElementById('propCount').textContent = properties.length;
                updateTotalCount();
                
                if (properties.length === 0) {
                    document.getElementById('propertiesContent').innerHTML = '<div class="empty-state"><p>No properties yet. Add your first property to start monitoring.</p></div>';
                } else {
                    let html = '<table class="data-table"><thead><tr><th class="sortable" onclick="sortProperties(\'county\')">County ⇅</th><th class="sortable" onclick="sortProperties(\'legal\')">Legal Description ⇅</th><th>Notes</th><th></th></tr></thead><tbody>';
                    properties.forEach(p => {
                        const f = p.fields;
                        const str = \`S\${f.SEC} T\${f.TWN} R\${f.RNG}\`;
                        const notes = f.Notes ? \`<span style="color: var(--slate-blue); font-size: 13px;">\${f.Notes.substring(0, 30)}\${f.Notes.length > 30 ? '...' : ''}</span>\` : '<em style="color: #A0AEC0;">—</em>';
                        // Generate section map link
                        const mapLink = generateSectionMapLink(f.SEC, f.TWN, f.RNG, f.COUNTY);
                        
                        html += \`<tr>
                            <td>\${f.COUNTY || '—'}</td>
                            <td><strong>\${str}</strong></td>
                            <td>\${notes}</td>
                            <td style="white-space: nowrap;">
                                <button class="btn-link" onclick="openPropertyDetails('\${p.id}')">Details</button>
                                \${mapLink ? \`<button class="btn-link" onclick="window.open('\${mapLink}', '_blank')">Map</button>\` : ''}
                                <button class="btn-delete" onclick="deleteProperty('\${p.id}')">Remove</button>
                            </td>
                        </tr>\`;
                    });
                    html += '</tbody></table>';
                    document.getElementById('propertiesContent').innerHTML = html;
                }
            } catch { document.getElementById('propertiesContent').innerHTML = '<div class="empty-state"><p style="color: var(--error);">Error loading. Refresh page.</p></div>'; }
        }
        
        // Generate a map link for a property section (centers on general area)
        function generateSectionMapLink(sec, twn, rng, county) {
            // Link to OCC GIS with a search query - this will show the general area
            // We can't pin-drop without coordinates, but we can search
            const searchTerm = encodeURIComponent(\`\${county || ''} \${sec} \${twn} \${rng}\`.trim());
            return \`https://gis.occ.ok.gov/portal/apps/webappviewer/index.html?id=ba9b8612132f4106be6e3553dc0b827b\`;
        }

        async function loadWells() {
            try {
                const res = await fetch('/api/wells');
                if (!res.ok) throw new Error('Failed to load');
                const wells = await res.json();
                loadedWells = wells; // Store for details modal
                document.getElementById('wellCount').textContent = wells.length;
                updateTotalCount();
                
                if (wells.length === 0) {
                    document.getElementById('wellsContent').innerHTML = '<div class="empty-state"><p>No wells yet. Add your first well API to start monitoring.</p></div>';
                } else {
                    let html = '<table class="data-table"><thead><tr><th class="sortable" onclick="sortWells(\'name\')">Well Name ⇅</th><th class="sortable" onclick="sortWells(\'operator\')">Operator ⇅</th><th>API</th><th class="sortable" onclick="sortWells(\'county\')">County ⇅</th><th>Location</th><th></th></tr></thead><tbody>';
                    wells.forEach(w => {
                        const f = w.fields;
                        const wellName = f['Well Name'] || '<em style="color: #A0AEC0;">Unknown</em>';
                        const operator = f['Operator'] || '<em style="color: #A0AEC0;">—</em>';
                        const county = f['County'] || '—';
                        const section = f['Section'] || '';
                        const township = f['Township'] || '';
                        const range = f['Range'] || '';
                        const str = (section && township && range) ? \`S\${section} T\${township} R\${range}\` : '—';
                        const mapLink = f['OCC Map Link'] && f['OCC Map Link'] !== '#' ? f['OCC Map Link'] : null;
                        
                        html += \`<tr>
                            <td><strong>\${wellName}</strong></td>
                            <td>\${operator}</td>
                            <td>\${f['API Number']}</td>
                            <td>\${county}</td>
                            <td>\${str}</td>
                            <td style="white-space: nowrap;">
                                <button class="btn-link" onclick="openWellDetails('\${w.id}')">Details</button>
                                \${mapLink ? \`<button class="btn-link" onclick="window.open('\${mapLink}', '_blank')">Map</button>\` : ''}
                                <button class="btn-delete" onclick="deleteWell('\${w.id}')">Remove</button>
                            </td>
                        </tr>\`;
                    });
                    html += '</tbody></table>';
                    document.getElementById('wellsContent').innerHTML = html;
                }
            } catch { document.getElementById('wellsContent').innerHTML = '<div class="empty-state"><p style="color: var(--error);">Error loading. Refresh page.</p></div>'; }
        }

        function updateTotalCount() {
            // No longer needed - separate limits shown
        }
        
        async function loadActivityStats() {
            try {
                const res = await fetch('/api/activity/stats');
                if (!res.ok) return;
                const stats = await res.json();
                
                // Format last alert date
                if (stats.lastAlert) {
                    const date = new Date(stats.lastAlert);
                    const now = new Date();
                    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
                    
                    let lastAlertText;
                    if (diffDays === 0) lastAlertText = 'Today';
                    else if (diffDays === 1) lastAlertText = 'Yesterday';
                    else if (diffDays < 7) lastAlertText = diffDays + ' days ago';
                    else if (diffDays < 30) lastAlertText = Math.floor(diffDays / 7) + ' weeks ago';
                    else lastAlertText = date.toLocaleDateString();
                    
                    document.getElementById('statLastAlert').textContent = lastAlertText;
                } else {
                    document.getElementById('statLastAlert').textContent = 'No alerts yet';
                }
                
                document.getElementById('statThisMonth').textContent = stats.thisMonth;
                document.getElementById('statThisYear').textContent = stats.thisYear;
            } catch (err) {
                console.error('Failed to load activity stats:', err);
            }
        }
        
        async function loadActivity() {
            try {
                const res = await fetch('/api/activity');
                if (!res.ok) throw new Error('Failed to load');
                const data = await res.json();
                const records = data.records || [];
                const daysLimit = data.daysLimit || 7;
                const plan = data.plan || 'Free';
                
                if (records.length === 0) {
                    let msg = '<div class="empty-state"><p>No activity recorded yet.</p><p style="font-size: 13px; color: var(--slate-blue);">When wells on your properties have status changes, they\\'ll appear here.</p></div>';
                    document.getElementById('activityContent').innerHTML = msg;
                    return;
                }
                
                let html = '<div class="activity-list">';
                
                // Show limit notice for lower tiers
                if (daysLimit <= 30 && plan !== 'Professional' && plan !== 'Enterprise') {
                    html += \`<div class="activity-limit-notice">Showing last \${daysLimit} days of activity. <a href="/portal/upgrade">Upgrade</a> for full history.</div>\`;
                }
                
                records.forEach(r => {
                    const f = r.fields;
                    const activityType = f['Activity Type'] || 'Status Change';
                    const alertLevel = f['Alert Level'] || 'YOUR PROPERTY';
                    
                    // Icon and class based on activity type
                    let icon = '📋';
                    let iconClass = 'status';
                    if (activityType.includes('Permit')) { icon = '📋'; iconClass = 'permit'; }
                    else if (activityType.includes('Drilling')) { icon = '🔨'; iconClass = 'drilling'; }
                    else if (activityType.includes('Completed')) { icon = '✅'; iconClass = 'completed'; }
                    else if (activityType.includes('Transfer')) { icon = '🔄'; iconClass = 'transfer'; }
                    else if (activityType.includes('Abandoned') || activityType.includes('Plugged')) { icon = '⛔'; iconClass = 'abandoned'; }
                    
                    // Alert level class
                    let levelClass = 'property';
                    if (alertLevel.includes('ADJACENT')) levelClass = 'adjacent';
                    else if (alertLevel.includes('TRACKED')) levelClass = 'tracked';
                    
                    // Format date
                    const date = new Date(f['Detected At']);
                    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    
                    // Build change text
                    let changeText = '';
                    if (f['Previous Value'] && f['New Value']) {
                        if (activityType.includes('Transfer')) {
                            changeText = \`\${f['Previous Value']} → \${f['New Value']}\`;
                        } else {
                            changeText = \`Status: \${f['Previous Value']} → \${f['New Value']}\`;
                        }
                    }
                    
                    // Build action buttons
                    const occLink = f['OCC Link'];
                    const mapLink = f['Map Link'];
                    let actionsHtml = '<div class="activity-actions">';
                    if (occLink) {
                        actionsHtml += \`<a href="\${occLink}" target="_blank" class="activity-btn">OCC Filing</a>\`;
                    }
                    if (mapLink) {
                        actionsHtml += \`<a href="\${mapLink}" target="_blank" class="activity-btn">View Map</a>\`;
                    }
                    actionsHtml += '</div>';
                    
                    html += \`
                        <div class="activity-item">
                            <div class="activity-icon \${iconClass}">\${icon}</div>
                            <div class="activity-details">
                                <div class="activity-header">
                                    <span class="activity-type">\${activityType}</span>
                                    <span class="activity-level \${levelClass}">\${alertLevel.replace('_', ' ')}</span>
                                </div>
                                <div class="activity-well">\${f['Well Name'] || 'Unknown Well'}</div>
                                <div class="activity-meta">\${f['Operator'] || ''} • \${f['Section-Township-Range'] || ''} • \${f['County'] || ''}</div>
                                \${changeText ? \`<div class="activity-change">\${changeText}</div>\` : ''}
                                \${(occLink || mapLink) ? actionsHtml : ''}
                            </div>
                            <div class="activity-date">\${dateStr}</div>
                        </div>
                    \`;
                });
                
                html += '</div>';
                document.getElementById('activityContent').innerHTML = html;
            } catch (err) {
                document.getElementById('activityContent').innerHTML = '<div class="empty-state"><p style="color: var(--error);">Error loading activity. Refresh page.</p></div>';
            }
        }
        
        // Property Modal
        document.getElementById('addPropertyBtn').addEventListener('click', () => { 
            document.getElementById('addPropertyModal').style.display = 'flex'; 
        });
        
        function closePropertyModal() { 
            document.getElementById('addPropertyModal').style.display = 'none'; 
            document.getElementById('addPropertyForm').reset(); 
        }
        
        document.getElementById('addPropertyModal').addEventListener('click', e => { 
            if (e.target.id === 'addPropertyModal') closePropertyModal(); 
        });
        
        document.getElementById('addPropertyForm').addEventListener('submit', async e => {
            e.preventDefault();
            const data = { 
                COUNTY: document.getElementById('county').value, 
                SEC: document.getElementById('section').value, 
                TWN: document.getElementById('township').value, 
                RNG: document.getElementById('range').value, 
                MERIDIAN: document.getElementById('meridian').value 
            };
            try {
                const res = await fetch('/api/properties', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify(data) 
                });
                if (!res.ok) { 
                    const err = await res.json(); 
                    throw new Error(err.error); 
                }
                closePropertyModal();
                await loadProperties();
            } catch (err) { alert(err.message); }
        });

        // Well Modal
        document.getElementById('addWellBtn').addEventListener('click', () => { 
            document.getElementById('addWellModal').style.display = 'flex'; 
        });
        
        // Bulk Upload Properties Modal
        document.getElementById('bulkUploadBtn').addEventListener('click', () => {
            openBulkUploadModal();
        });
        
        // Bulk Upload Wells Modal
        document.getElementById('bulkUploadWellsBtn').addEventListener('click', () => {
            openBulkUploadWellsModal();
        });
        
        function closeWellModal() { 
            document.getElementById('addWellModal').style.display = 'none'; 
            document.getElementById('addWellForm').reset(); 
        }
        
        document.getElementById('addWellModal').addEventListener('click', e => { 
            if (e.target.id === 'addWellModal') closeWellModal(); 
        });
        
        document.getElementById('addWellForm').addEventListener('submit', async e => {
            e.preventDefault();
            const data = { 
                apiNumber: document.getElementById('apiNumber').value, 
                wellName: document.getElementById('wellName').value,
                notes: document.getElementById('wellNotes').value
            };
            try {
                const res = await fetch('/api/wells', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify(data) 
                });
                if (!res.ok) { 
                    const err = await res.json(); 
                    throw new Error(err.error); 
                }
                closeWellModal();
                await loadWells();
            } catch (err) { alert(err.message); }
        });
        
        async function deleteProperty(id) {
            if (!confirm('Remove this property?')) return;
            try {
                await fetch('/api/properties/' + id, { method: 'DELETE' });
                await loadProperties();
            } catch { alert('Error deleting.'); }
        }

        async function deleteWell(id) {
            if (!confirm('Remove this well?')) return;
            try {
                await fetch('/api/wells/' + id, { method: 'DELETE' });
                await loadWells();
            } catch { alert('Error deleting.'); }
        }
        
        async function removeAllProperties() {
            if (!loadedProperties.length) {
                alert('No properties to remove.');
                return;
            }
            if (!confirm(\`Are you sure you want to remove ALL \${loadedProperties.length} properties? This cannot be undone.\`)) return;
            if (!confirm('This is your last chance to cancel. Remove all properties?')) return;
            
            try {
                for (const prop of loadedProperties) {
                    await fetch('/api/properties/' + prop.id, { method: 'DELETE' });
                }
                await loadProperties();
                alert('All properties removed.');
            } catch { alert('Error removing properties.'); }
        }
        
        async function removeAllWells() {
            if (!loadedWells.length) {
                alert('No wells to remove.');
                return;
            }
            if (!confirm(\`Are you sure you want to remove ALL \${loadedWells.length} wells? This cannot be undone.\`)) return;
            if (!confirm('This is your last chance to cancel. Remove all wells?')) return;
            
            try {
                for (const well of loadedWells) {
                    await fetch('/api/wells/' + well.id, { method: 'DELETE' });
                }
                await loadWells();
                alert('All wells removed.');
            } catch { alert('Error removing wells.'); }
        }
        
        // Sorting state
        let propertiesSortField = null;
        let propertiesSortAsc = true;
        let wellsSortField = null;
        let wellsSortAsc = true;
        
        function sortProperties(field) {
            if (propertiesSortField === field) {
                propertiesSortAsc = !propertiesSortAsc;
            } else {
                propertiesSortField = field;
                propertiesSortAsc = true;
            }
            
            loadedProperties.sort((a, b) => {
                let valA, valB;
                if (field === 'county') {
                    valA = (a.fields.COUNTY || '').toLowerCase();
                    valB = (b.fields.COUNTY || '').toLowerCase();
                } else if (field === 'legal') {
                    valA = \`\${a.fields.SEC}-\${a.fields.TWN}-\${a.fields.RNG}\`.toLowerCase();
                    valB = \`\${b.fields.SEC}-\${b.fields.TWN}-\${b.fields.RNG}\`.toLowerCase();
                }
                if (valA < valB) return propertiesSortAsc ? -1 : 1;
                if (valA > valB) return propertiesSortAsc ? 1 : -1;
                return 0;
            });
            
            renderPropertiesTable();
        }
        
        function sortWells(field) {
            if (wellsSortField === field) {
                wellsSortAsc = !wellsSortAsc;
            } else {
                wellsSortField = field;
                wellsSortAsc = true;
            }
            
            loadedWells.sort((a, b) => {
                let valA, valB;
                if (field === 'name') {
                    valA = (a.fields['Well Name'] || '').toLowerCase();
                    valB = (b.fields['Well Name'] || '').toLowerCase();
                } else if (field === 'operator') {
                    valA = (a.fields['Operator'] || '').toLowerCase();
                    valB = (b.fields['Operator'] || '').toLowerCase();
                } else if (field === 'county') {
                    valA = (a.fields['County'] || '').toLowerCase();
                    valB = (b.fields['County'] || '').toLowerCase();
                }
                if (valA < valB) return wellsSortAsc ? -1 : 1;
                if (valA > valB) return wellsSortAsc ? 1 : -1;
                return 0;
            });
            
            renderWellsTable();
        }
        
        function renderPropertiesTable() {
            let html = '<table class="data-table"><thead><tr><th class="sortable" onclick="sortProperties(\'county\')">County ⇅</th><th class="sortable" onclick="sortProperties(\'legal\')">Legal Description ⇅</th><th>Notes</th><th></th></tr></thead><tbody>';
            loadedProperties.forEach(p => {
                const f = p.fields;
                const str = \`S\${f.SEC} T\${f.TWN} R\${f.RNG}\`;
                const notes = f.Notes ? \`<span style="color: var(--slate-blue); font-size: 13px;">\${f.Notes.substring(0, 30)}\${f.Notes.length > 30 ? '...' : ''}</span>\` : '<em style="color: #A0AEC0;">—</em>';
                const mapLink = generateSectionMapLink(f.SEC, f.TWN, f.RNG, f.COUNTY);
                
                html += \`<tr>
                    <td>\${f.COUNTY || '—'}</td>
                    <td><strong>\${str}</strong></td>
                    <td>\${notes}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn-link" onclick="openPropertyDetails('\${p.id}')">Details</button>
                        \${mapLink ? \`<button class="btn-link" onclick="window.open('\${mapLink}', '_blank')">Map</button>\` : ''}
                        <button class="btn-delete" onclick="deleteProperty('\${p.id}')">Remove</button>
                    </td>
                </tr>\`;
            });
            html += '</tbody></table>';
            document.getElementById('propertiesContent').innerHTML = html;
        }
        
        function renderWellsTable() {
            let html = '<table class="data-table"><thead><tr><th class="sortable" onclick="sortWells(\'name\')">Well Name ⇅</th><th class="sortable" onclick="sortWells(\'operator\')">Operator ⇅</th><th>API</th><th class="sortable" onclick="sortWells(\'county\')">County ⇅</th><th>Location</th><th></th></tr></thead><tbody>';
            loadedWells.forEach(w => {
                const f = w.fields;
                const wellName = f['Well Name'] || '<em style="color: #A0AEC0;">Unknown</em>';
                const operator = f['Operator'] || '<em style="color: #A0AEC0;">—</em>';
                const county = f['County'] || '—';
                const section = f['Section'] || '';
                const township = f['Township'] || '';
                const range = f['Range'] || '';
                const str = (section && township && range) ? \`S\${section} T\${township} R\${range}\` : '—';
                const mapLink = f['OCC Map Link'] && f['OCC Map Link'] !== '#' ? f['OCC Map Link'] : null;
                
                html += \`<tr>
                    <td><strong>\${wellName}</strong></td>
                    <td>\${operator}</td>
                    <td>\${f['API Number']}</td>
                    <td>\${county}</td>
                    <td>\${str}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn-link" onclick="openWellDetails('\${w.id}')">Details</button>
                        \${mapLink ? \`<button class="btn-link" onclick="window.open('\${mapLink}', '_blank')">Map</button>\` : ''}
                        <button class="btn-delete" onclick="deleteWell('\${w.id}')">Remove</button>
                    </td>
                </tr>\`;
            });
            html += '</tbody></table>';
            document.getElementById('wellsContent').innerHTML = html;
        }
        
        // Well Details Modal Functions
        function openWellDetails(wellId) {
            const well = loadedWells.find(w => w.id === wellId);
            if (!well) return;
            
            const f = well.fields;
            document.getElementById('wellDetailsTitle').textContent = f['Well Name'] || 'Unknown Well';
            document.getElementById('wellDetailsApi').textContent = 'API: ' + (f['API Number'] || '—');
            document.getElementById('wellDetailsOperator').textContent = f['Operator'] || '—';
            
            const sec = f['Section'] || '';
            const twn = f['Township'] || '';
            const rng = f['Range'] || '';
            document.getElementById('wellDetailsLocation').textContent = (sec && twn && rng) ? \`S\${sec} T\${twn} R\${rng}\` : '—';
            
            document.getElementById('wellDetailsCounty').textContent = f['County'] || '—';
            document.getElementById('wellDetailsType').textContent = f['Well Type'] || '—';
            document.getElementById('wellDetailsStatus').textContent = f['Well Status'] || '—';
            document.getElementById('wellDetailsNotes').textContent = f['Notes'] || '—';
            
            // Map link
            const mapLink = f['OCC Map Link'];
            const mapBtn = document.getElementById('wellDetailsMapLink');
            if (mapLink && mapLink !== '#') {
                mapBtn.href = mapLink;
                mapBtn.style.display = 'inline-flex';
            } else {
                mapBtn.style.display = 'none';
            }
            
            // OCC Well lookup link (Well Browse)
            const occLink = \`https://wellbrowse.occ.ok.gov/?APINumber=\${f['API Number']}\`;
            document.getElementById('wellDetailsOccLink').href = occLink;
            
            document.getElementById('wellDetailsModal').style.display = 'flex';
        }
        
        function closeWellDetailsModal() {
            document.getElementById('wellDetailsModal').style.display = 'none';
        }
        
        document.getElementById('wellDetailsModal').addEventListener('click', e => {
            if (e.target.id === 'wellDetailsModal') closeWellDetailsModal();
        });
        
        // Property Details Modal Functions
        function openPropertyDetails(propId) {
            const prop = loadedProperties.find(p => p.id === propId);
            if (!prop) return;
            
            const f = prop.fields;
            document.getElementById('propertyDetailsTitle').textContent = f['COUNTY'] || 'Property Details';
            document.getElementById('propertyDetailsLegal').textContent = \`S\${f.SEC} T\${f.TWN} R\${f.RNG}\`;
            document.getElementById('propertyDetailsCounty').textContent = f['COUNTY'] || '—';
            document.getElementById('propertyDetailsSection').textContent = f['SEC'] || '—';
            document.getElementById('propertyDetailsTownship').textContent = f['TWN'] || '—';
            document.getElementById('propertyDetailsRange').textContent = f['RNG'] || '—';
            document.getElementById('propertyDetailsMeridian').textContent = f['MERIDIAN'] || 'IM';
            document.getElementById('propertyDetailsAdjacent').textContent = f['Monitor Adjacent'] ? 'Yes' : 'No';
            document.getElementById('propertyDetailsNotes').textContent = f['Notes'] || '—';
            
            document.getElementById('propertyDetailsModal').style.display = 'flex';
        }
        
        function closePropertyDetailsModal() {
            document.getElementById('propertyDetailsModal').style.display = 'none';
        }
        
        document.getElementById('propertyDetailsModal').addEventListener('click', e => {
            if (e.target.id === 'propertyDetailsModal') closePropertyDetailsModal();
        });
        
        // CSV Export Functions (Professional tier)
        function exportWellsCSV() {
            if (!loadedWells.length) {
                alert('No wells to export.');
                return;
            }
            
            const headers = ['API Number', 'Well Name', 'Operator', 'County', 'Section', 'Township', 'Range', 'Well Type', 'Well Status', 'OCC Map Link', 'Notes'];
            const rows = loadedWells.map(w => {
                const f = w.fields;
                return [
                    f['API Number'] || '',
                    (f['Well Name'] || '').replace(/,/g, ';'),
                    (f['Operator'] || '').replace(/,/g, ';'),
                    f['County'] || '',
                    f['Section'] || '',
                    f['Township'] || '',
                    f['Range'] || '',
                    f['Well Type'] || '',
                    f['Well Status'] || '',
                    f['OCC Map Link'] || '',
                    (f['Notes'] || '').replace(/,/g, ';').replace(/\\n/g, ' ')
                ].join(',');
            });
            
            const csv = [headers.join(','), ...rows].join('\\n');
            downloadCSV(csv, 'mineral-watch-wells.csv');
        }
        
        function exportPropertiesCSV() {
            if (!loadedProperties.length) {
                alert('No properties to export.');
                return;
            }
            
            const headers = ['County', 'Section', 'Township', 'Range', 'Meridian', 'Notes'];
            const rows = loadedProperties.map(p => {
                const f = p.fields;
                return [
                    f['COUNTY'] || '',
                    f['SEC'] || '',
                    f['TWN'] || '',
                    f['RNG'] || '',
                    f['MERIDIAN'] || 'IM',
                    (f['Notes'] || '').replace(/,/g, ';').replace(/\\n/g, ' ')
                ].join(',');
            });
            
            const csv = [headers.join(','), ...rows].join('\\n');
            downloadCSV(csv, 'mineral-watch-properties.csv');
        }
        
        function downloadCSV(csvContent, filename) {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
        }
        
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/portal/login';
        });
    </script>

<!-- BULK UPLOAD MODAL - REDESIGNED -->
<div class="modal-overlay" id="bulk-upload-modal">
    <div class="modal bulk-modal">
        <!-- Header -->
        <div class="bulk-header">
            <h2>Bulk Upload Properties</h2>
            <button class="bulk-close" onclick="closeBulkUploadModal()">&times;</button>
        </div>
        
        <!-- Step 1: File Upload -->
        <div id="upload-step" style="display:block;">
            <!-- Instructions -->
            <div class="bulk-section">
                <p class="bulk-intro">Upload a CSV or Excel file with your properties. We'll automatically detect columns and format your data.</p>
            </div>
            
            <!-- File Formats -->
            <div class="bulk-section bulk-section-gray">
                <div class="bulk-label">Supported File Formats</div>
                <div class="bulk-text">CSV (.csv), Excel (.xlsx, .xls), Tab-delimited (.txt, .tsv)</div>
            </div>
            
            <!-- Two Column: Column Names + Format Examples -->
            <div class="bulk-section">
                <div class="bulk-two-col">
                    <!-- Column Names -->
                    <div>
                        <div class="bulk-label">Column Names (Flexible)</div>
                        <div class="bulk-columns">
                            <div><strong>Section:</strong> <code>SEC</code> <code>Section</code> <code>Sec</code> <code>S</code></div>
                            <div><strong>Township:</strong> <code>TWN</code> <code>Township</code> <code>Town</code> <code>T</code></div>
                            <div><strong>Range:</strong> <code>RNG</code> <code>Range</code> <code>R</code></div>
                            <div><strong>Optional:</strong> County, Meridian, Notes</div>
                        </div>
                    </div>
                    
                    <!-- Format Examples -->
                    <div>
                        <div class="bulk-label">We Auto-Format These</div>
                        <div class="bulk-formats">
                            <div class="bulk-format"><code>3</code> <span class="arrow">→</span> <code>03</code></div>
                            <div class="bulk-format"><code>S3</code> <span class="arrow">→</span> <code>03</code></div>
                            <div class="bulk-format"><code>12 N</code> <span class="arrow">→</span> <code>12N</code></div>
                            <div class="bulk-format"><code>T12N</code> <span class="arrow">→</span> <code>12N</code></div>
                            <div class="bulk-format"><code>8W</code> <span class="arrow">→</span> <code>8W</code></div>
                            <div class="bulk-format"><code>R08W</code> <span class="arrow">→</span> <code>8W</code></div>
                        </div>
                        <p class="bulk-note">Missing meridian defaults to IM (Indian Meridian)</p>
                    </div>
                </div>
            </div>
            
            <!-- Upload Area -->
            <div class="bulk-section">
                <div class="bulk-dropzone" id="dropzone" 
                     ondrop="handleFileDrop(event)" 
                     ondragover="handleDragOver(event)"
                     ondragleave="handleDragLeave(event)"
                     onclick="document.getElementById('fileInput').click()">
                    <div class="dropzone-icon">📄</div>
                    <div class="dropzone-text">Drop your file here or click to browse</div>
                    <div class="dropzone-subtext">Maximum file size: 5MB</div>
                </div>
                
                <input type="file" id="fileInput" accept=".csv,.xlsx,.xls,.txt,.tsv" style="display:none;" onchange="handleFileSelect(event)">
                
                <div id="file-info" class="bulk-file-info" style="display: none;">
                    <span class="file-name" id="filename"></span>
                    <span class="file-size" id="filesize"></span>
                </div>
                
                <div id="parse-error" class="bulk-error" style="display: none;">
                    <strong>Error parsing file:</strong> <span id="error-message"></span>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="bulk-footer">
                <button class="btn-secondary" onclick="closeBulkUploadModal()">Cancel</button>
            </div>
        </div>
        
        <!-- Step 2: Preview & Validate -->
        <div id="preview-step" style="display:none;">
            <div class="bulk-section">
                <h3 style="margin-bottom: 8px; font-family: 'Merriweather', serif;">Preview & Validate</h3>
                <p class="bulk-text">Review the detected properties before importing:</p>
            </div>
            
            <div class="bulk-section">
                <!-- Validation Badges -->
                <div id="validation-summary" class="bulk-badges"></div>
                
                <!-- Plan Check -->
                <div id="plan-check"></div>
                
                <!-- Preview Table -->
                <div class="bulk-table-container">
                    <table class="bulk-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>SEC</th>
                                <th>TWN</th>
                                <th>RNG</th>
                                <th>MER</th>
                                <th>County</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="preview-table-body"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="bulk-footer">
                <button class="btn-secondary" onclick="resetBulkUpload()">Start Over</button>
                <button id="import-btn" class="btn-primary" onclick="startImport()">Import Properties</button>
            </div>
        </div>
        
        <!-- Step 3: Importing Progress -->
        <div id="import-step" style="display:none;">
            <div class="bulk-progress">
                <div class="progress-icon">⚡</div>
                <h3>Importing Properties...</h3>
                <p class="bulk-text">Please wait while we create your properties.</p>
                <div class="progress-bar-track">
                    <div class="progress-bar-fill" id="progress-bar"></div>
                </div>
                <div class="progress-percent" id="progress-percent">0%</div>
                <div class="progress-count" id="import-progress">0 of 0 properties created</div>
            </div>
        </div>
        
        <!-- Step 4: Results -->
        <div id="results-step" style="display:none;">
            <div class="bulk-results">
                <div class="results-icon" id="results-icon">✅</div>
                <h3 class="results-title" id="results-title">Import Complete!</h3>
                <div class="results-stats">
                    <div class="stat-box">
                        <div class="stat-number stat-success" id="result-created">0</div>
                        <div class="stat-label">Created</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number stat-warning" id="result-skipped">0</div>
                        <div class="stat-label">Skipped</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number stat-error" id="result-failed">0</div>
                        <div class="stat-label">Failed</div>
                    </div>
                </div>
                <p class="bulk-text" id="results-details">Your properties are now being monitored for OCC activity.</p>
                <button class="btn-primary" onclick="finishBulkUpload()">Done</button>
            </div>
        </div>
    </div>
</div>

<!-- BULK UPLOAD WELLS MODAL -->
<div class="modal-overlay" id="bulk-upload-wells-modal">
    <div class="modal bulk-modal">
        <!-- Header -->
        <div class="bulk-header">
            <h2>Bulk Upload Wells</h2>
            <button class="bulk-close" onclick="closeBulkUploadWellsModal()">&times;</button>
        </div>
        
        <!-- Step 1: File Upload -->
        <div id="wells-upload-step" style="display:block;">
            <div class="bulk-section">
                <p class="bulk-intro">Upload a CSV or Excel file with API numbers. We'll validate each one and add them to your monitored wells.</p>
            </div>
            
            <div class="bulk-section bulk-section-gray">
                <div class="bulk-label">Required Column</div>
                <div class="bulk-text">
                    <strong>API Number</strong> — Oklahoma 10-digit format (e.g., 3501520001)
                </div>
                <div class="bulk-columns" style="margin-top: 12px;">
                    <div>Accepted headers: <code>API</code> <code>API Number</code> <code>apiNumber</code> <code>api</code></div>
                </div>
            </div>
            
            <div class="bulk-section">
                <div class="bulk-two-col">
                    <div>
                        <div class="bulk-label">Optional Column</div>
                        <div class="bulk-columns">
                            <div><strong>Well Name:</strong> <code>Well Name</code> <code>WELL_NAME</code> <code>wellName</code></div>
                        </div>
                    </div>
                    <div>
                        <div class="bulk-label">Format Flexibility</div>
                        <div class="bulk-formats">
                            <div class="bulk-format"><code>35-015-20001</code> <span class="arrow">→</span> <code>3501520001</code></div>
                            <div class="bulk-format"><code>35 015 20001</code> <span class="arrow">→</span> <code>3501520001</code></div>
                        </div>
                        <p class="bulk-note">Dashes, spaces, dots are automatically removed</p>
                    </div>
                </div>
            </div>
            
            <div class="bulk-section">
                <div class="bulk-dropzone" id="wells-dropzone" 
                     ondrop="handleWellsFileDrop(event)" 
                     ondragover="handleWellsDragOver(event)"
                     ondragleave="handleWellsDragLeave(event)"
                     onclick="document.getElementById('wellsFileInput').click()">
                    <div class="dropzone-icon">🛢️</div>
                    <div class="dropzone-text">Drop your file here or click to browse</div>
                    <div class="dropzone-subtext">CSV or Excel files accepted</div>
                </div>
                
                <input type="file" id="wellsFileInput" accept=".csv,.xlsx,.xls,.txt,.tsv" style="display:none;" onchange="handleWellsFileSelect(event)">
                
                <div id="wells-file-info" class="bulk-file-info" style="display: none;">
                    <span class="file-name" id="wells-filename"></span>
                    <span class="file-size" id="wells-filesize"></span>
                </div>
                
                <div id="wells-parse-error" class="bulk-error" style="display: none;">
                    <strong>Error parsing file:</strong> <span id="wells-error-message"></span>
                </div>
            </div>
            
            <div class="bulk-footer">
                <button class="btn-secondary" onclick="closeBulkUploadWellsModal()">Cancel</button>
            </div>
        </div>
        
        <!-- Step 2: Preview -->
        <div id="wells-preview-step" style="display:none;">
            <div class="bulk-section">
                <h3 style="margin-bottom: 8px; font-family: 'Merriweather', serif;">Preview & Validate</h3>
                <p class="bulk-text">Review the API numbers before importing:</p>
            </div>
            
            <div class="bulk-section">
                <div id="wells-validation-summary" class="bulk-badges"></div>
                <div id="wells-plan-check"></div>
                
                <div class="bulk-table-container">
                    <table class="bulk-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>API Number</th>
                                <th>Well Name</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="wells-preview-table-body"></tbody>
                    </table>
                </div>
            </div>
            
            <div class="bulk-footer">
                <button class="btn-secondary" onclick="resetBulkUploadWells()">Start Over</button>
                <button id="wells-import-btn" class="btn-primary" onclick="startWellsImport()">Import Wells</button>
            </div>
        </div>
        
        <!-- Step 3: Importing -->
        <div id="wells-import-step" style="display:none;">
            <div class="bulk-progress">
                <div class="progress-icon">⚡</div>
                <h3>Importing Wells...</h3>
                <p class="bulk-text">Please wait while we add your wells.</p>
                <div class="progress-bar-track">
                    <div class="progress-bar-fill indeterminate" id="wells-progress-bar"></div>
                </div>
                <div class="progress-count" id="wells-import-progress">Processing...</div>
            </div>
        </div>
        
        <!-- Step 4: Results -->
        <div id="wells-results-step" style="display:none;">
            <div class="bulk-results">
                <div class="results-icon" id="wells-results-icon">✅</div>
                <h3 class="results-title" id="wells-results-title">Import Complete!</h3>
                <div class="results-stats">
                    <div class="stat-box">
                        <div class="stat-number stat-success" id="wells-result-created">0</div>
                        <div class="stat-label">Created</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number stat-warning" id="wells-result-skipped">0</div>
                        <div class="stat-label">Skipped</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number stat-error" id="wells-result-failed">0</div>
                        <div class="stat-label">Failed</div>
                    </div>
                </div>
                <p class="bulk-text" id="wells-results-details">Your wells are now being monitored for OCC activity.</p>
                <button class="btn-primary" onclick="finishBulkUploadWells()">Done</button>
            </div>
        </div>
    </div>
</div>

<style>
/* Bulk Upload Modal - Redesigned Styles */

/* Modal specific overrides */
#bulk-upload-modal .modal.bulk-modal,
#bulk-upload-wells-modal .modal.bulk-modal {
    padding: 0;
    max-width: 900px;
    max-height: 90vh;
    overflow-y: auto;
}

/* Header */
.bulk-header {
    background: linear-gradient(135deg, var(--oil-navy) 0%, var(--slate-blue) 100%);
    color: white;
    padding: 24px 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 100;
}

.bulk-header h2 {
    font-size: 22px;
    font-weight: 700;
    margin: 0;
    font-family: 'Merriweather', serif;
}

.bulk-close {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    width: 36px;
    height: 36px;
    border-radius: 4px;
    font-size: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.bulk-close:hover {
    background: rgba(255, 255, 255, 0.2);
}

/* Sections */
.bulk-section {
    padding: 24px 30px;
    border-bottom: 1px solid var(--border);
}

.bulk-section:last-child {
    border-bottom: none;
}

.bulk-section-gray {
    background: var(--paper);
}

.bulk-label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--slate-blue);
    margin-bottom: 10px;
}

.bulk-intro {
    color: var(--slate-blue);
    font-size: 15px;
    line-height: 1.6;
    margin: 0;
}

.bulk-text {
    color: var(--oil-navy);
    font-size: 14px;
    line-height: 1.6;
}

.bulk-note {
    font-size: 12px;
    color: var(--slate-blue);
    margin-top: 12px;
}

/* Two Column Layout */
.bulk-two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
}

@media (max-width: 600px) {
    .bulk-two-col {
        grid-template-columns: 1fr;
    }
}

/* Column Names */
.bulk-columns {
    font-size: 13px;
    line-height: 2;
}

.bulk-columns code {
    background: var(--paper);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
    margin-right: 4px;
}

/* Format Examples */
.bulk-formats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
}

.bulk-format {
    font-size: 13px;
    color: var(--slate-blue);
    display: flex;
    align-items: center;
    gap: 6px;
}

.bulk-format code {
    background: white;
    border: 1px solid var(--border);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
}

.bulk-format .arrow {
    color: var(--success);
    font-weight: 600;
}

/* Dropzone */
.bulk-dropzone {
    border: 2px dashed var(--border);
    border-radius: 8px;
    padding: 50px 30px;
    text-align: center;
    background: var(--paper);
    cursor: pointer;
    transition: all 0.3s;
}

.bulk-dropzone:hover, .bulk-dropzone.drag-over {
    border-color: var(--red-dirt);
    background: #FFF5F0;
}

.dropzone-icon {
    font-size: 40px;
    margin-bottom: 12px;
}

.dropzone-text {
    font-size: 15px;
    color: var(--oil-navy);
    font-weight: 500;
    margin-bottom: 6px;
}

.dropzone-subtext {
    font-size: 13px;
    color: var(--slate-blue);
}

/* File Info */
.bulk-file-info {
    background: var(--success-bg);
    border: 1px solid rgba(3, 84, 63, 0.2);
    border-radius: 6px;
    padding: 14px 18px;
    margin-top: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.bulk-file-info .file-name {
    font-weight: 600;
    color: var(--success);
    font-size: 14px;
}

.bulk-file-info .file-size {
    color: var(--success);
    font-size: 13px;
}

/* Error */
.bulk-error {
    background: #FEE2E2;
    border: 1px solid rgba(220, 38, 38, 0.2);
    border-radius: 6px;
    padding: 14px 18px;
    margin-top: 16px;
    color: #DC2626;
    font-size: 14px;
}

/* Footer */
.bulk-footer {
    padding: 20px 30px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    background: white;
}

/* Badges */
.bulk-badges {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 20px;
}

.validation-badge {
    padding: 10px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.badge-valid { background: var(--success-bg); color: var(--success); }
.badge-invalid { background: #FEE2E2; color: #DC2626; }
.badge-warning { background: #FEF3C7; color: #92400E; }
.badge-duplicate { background: #E0E7FF; color: #3730A3; }

/* Plan Check */
.plan-check-box {
    padding: 16px 20px;
    border-radius: 8px;
    margin-bottom: 20px;
}

.plan-check-box.ok {
    background: var(--success-bg);
    border-left: 4px solid var(--success);
}

.plan-check-box.exceeded {
    background: #FEE2E2;
    border-left: 4px solid #DC2626;
}

.plan-check-header {
    font-weight: 600;
    font-size: 15px;
    margin-bottom: 4px;
}

.plan-check-box.ok .plan-check-header { color: var(--success); }
.plan-check-box.exceeded .plan-check-header { color: #DC2626; }

.plan-check-details {
    font-size: 13px;
    color: var(--slate-blue);
}

/* Preview Table */
.bulk-table-container {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    max-height: 350px;
    overflow-y: auto;
}

.bulk-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.bulk-table thead {
    position: sticky;
    top: 0;
    z-index: 10;
}

.bulk-table th {
    background: var(--oil-navy);
    color: white;
    padding: 12px 14px;
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.bulk-table td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
}

.bulk-table tbody tr:hover {
    background: var(--paper);
}

.preview-row-valid { background: white; }
.preview-row-warning { background: #FEF3C7; }
.preview-row-error { background: #FEE2E2; }
.preview-row-duplicate { background: #E0E7FF; opacity: 0.7; }

.status-cell-valid { color: var(--success); }
.status-cell-warning { color: #92400E; }
.status-cell-error { color: #DC2626; }
.status-cell-duplicate { color: #3730A3; }

/* Progress */
.bulk-progress {
    text-align: center;
    padding: 50px 30px;
}

.bulk-progress .progress-icon {
    font-size: 48px;
    margin-bottom: 20px;
    animation: pulse 1.5s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.progress-bar-track {
    width: 100%;
    max-width: 400px;
    height: 8px;
    background: var(--border);
    border-radius: 4px;
    margin: 20px auto;
    overflow: hidden;
}

.progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--red-dirt), var(--red-dirt-dark));
    border-radius: 4px;
    transition: width 0.3s ease;
    width: 0%;
}

.progress-bar-fill.indeterminate {
    width: 100%;
    animation: indeterminate 1.5s infinite;
    background: linear-gradient(90deg, var(--red-dirt) 0%, var(--red-dirt-dark) 50%, var(--red-dirt) 100%);
    background-size: 200% 100%;
}

@keyframes indeterminate {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

.progress-percent {
    font-size: 24px;
    font-weight: 700;
    color: var(--red-dirt);
    margin-top: 15px;
}

.progress-count {
    font-size: 14px;
    color: var(--slate-blue);
    margin-top: 8px;
}

/* Results */
.bulk-results {
    text-align: center;
    padding: 40px 30px;
}

.bulk-results .results-icon {
    font-size: 64px;
    margin-bottom: 20px;
}

.bulk-results .results-title {
    font-size: 24px;
    margin-bottom: 25px;
    font-family: 'Merriweather', serif;
}

.results-stats {
    display: flex;
    justify-content: center;
    gap: 40px;
    margin-bottom: 30px;
}

.stat-box {
    text-align: center;
}

.stat-number {
    font-size: 36px;
    font-weight: 700;
    font-family: 'Merriweather', serif;
}

.stat-success { color: var(--success); }
.stat-warning { color: #92400E; }
.stat-error { color: #DC2626; }

.stat-label {
    font-size: 13px;
    color: var(--slate-blue);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
}
</style>

<script>
// Global state for bulk upload
let parsedData = [];
let validationResults = null;

// Open bulk upload modal
function openBulkUploadModal() {
    document.getElementById('bulk-upload-modal').style.display = 'flex';
    resetBulkUpload();
}

// Make function available globally
window.openBulkUploadModal = openBulkUploadModal;

// Open bulk upload wells modal
function openBulkUploadWellsModal() {
    document.getElementById('bulk-upload-wells-modal').style.display = 'flex';
    resetBulkUploadWells();
}

// Make function available globally  
window.openBulkUploadWellsModal = openBulkUploadWellsModal;

// Close bulk upload modal
function closeBulkUploadModal() {
    document.getElementById('bulk-upload-modal').style.display = 'none';
    resetBulkUpload();
}

// Reset to initial state
function resetBulkUpload() {
    document.getElementById('upload-step').style.display = 'block';
    document.getElementById('preview-step').style.display = 'none';
    document.getElementById('import-step').style.display = 'none';
    document.getElementById('results-step').style.display = 'none';
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('parse-error').style.display = 'none';
    document.getElementById('fileInput').value = '';
    parsedData = [];
    validationResults = null;
}

// Handle file drop
function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

// Handle drag over
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.add('drag-over');
}

// Handle drag leave
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.remove('drag-over');
}

// Handle file select
function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

// Process uploaded file
async function processFile(file) {
    document.getElementById('filename').textContent = file.name;
    document.getElementById('filesize').textContent = \`\${(file.size / 1024).toFixed(1)} KB\`;
    document.getElementById('file-info').style.display = 'block';
    document.getElementById('parse-error').style.display = 'none';
    
    try {
        // Detect file type
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
            // Parse CSV/TSV
            await parseCSV(file);
        } else if (extension === 'xlsx' || extension === 'xls') {
            // Parse Excel
            await parseExcel(file);
        } else {
            throw new Error('Unsupported file type. Please upload CSV or Excel file.');
        }
        
        // If we got here, parsing succeeded
        if (parsedData.length === 0) {
            throw new Error('No data found in file');
        }
        
        // Validate and show preview
        await validateAndPreview();
        
    } catch (error) {
        console.error('File processing error:', error);
        document.getElementById('error-message').textContent = error.message;
        document.getElementById('parse-error').style.display = 'block';
    }
}

// Parse CSV file
async function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length > 0) {
                    reject(new Error(\`CSV parsing error: \${results.errors[0].message}\`));
                    return;
                }
                parsedData = results.data;
                resolve();
            },
            error: (error) => {
                reject(new Error(\`CSV parsing failed: \${error.message}\`));
            }
        });
    });
}

// Parse Excel file
async function parseExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Get first sheet
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                
                if (jsonData.length === 0) {
                    reject(new Error('Excel file contains no data'));
                    return;
                }
                
                parsedData = jsonData;
                resolve();
            } catch (error) {
                reject(new Error(\`Excel parsing failed: \${error.message}\`));
            }
        };
        
        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };
        
        reader.readAsArrayBuffer(file);
    });
}

// Validate and show preview
async function validateAndPreview() {
    try {
        const response = await fetch('/api/bulk-validate-properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: parsedData })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Validation failed');
        }
        
        validationResults = await response.json();
        
        // Show preview step
        document.getElementById('upload-step').style.display = 'none';
        document.getElementById('preview-step').style.display = 'block';
        
        // Render summary badges
        renderSummary();
        
        // Render plan check
        renderPlanCheck();
        
        // Render preview table
        renderPreviewTable();
        
    } catch (error) {
        console.error('Validation error:', error);
        document.getElementById('error-message').textContent = error.message;
        document.getElementById('parse-error').style.display = 'block';
    }
}

// Render summary badges
function renderSummary() {
    const summary = validationResults.summary;
    const html = \`
        <div class="validation-badge badge-valid">
            ✓ \${summary.valid} Valid
        </div>
        \${summary.invalid > 0 ? \`
        <div class="validation-badge badge-invalid">
            ❌ \${summary.invalid} Invalid
        </div>
        \` : ''}
        \${summary.warnings > 0 ? \`
        <div class="validation-badge badge-warning">
            ⚠️ \${summary.warnings} Warnings
        </div>
        \` : ''}
        \${summary.duplicates > 0 ? \`
        <div class="validation-badge badge-duplicate">
            🔄 \${summary.duplicates} Duplicates
        </div>
        \` : ''}
    \`;
    document.getElementById('validation-summary').innerHTML = html;
}

// Render plan check
function renderPlanCheck() {
    const plan = validationResults.planCheck;
    const wouldExceed = plan.wouldExceedLimit;
    
    const html = \`
        <div class="plan-check-box \${wouldExceed ? 'exceeded' : 'ok'}">
            <div class="plan-check-header">
                \${wouldExceed ? '❌ Would Exceed Plan Limit' : '✓ Within Plan Limit'}
            </div>
            <div class="plan-check-details">
                Current: \${plan.current} properties · 
                Adding: \${validationResults.summary.willImport} · 
                Total: \${plan.afterUpload} of \${plan.limit} (\${plan.plan} plan)
            </div>
        </div>
    \`;
    document.getElementById('plan-check').innerHTML = html;
    
    // Disable import button if would exceed
    document.getElementById('import-btn').disabled = wouldExceed;
}

// Render preview table
function renderPreviewTable() {
    const tbody = document.getElementById('preview-table-body');
    let html = '';
    
    validationResults.results.forEach((result, index) => {
        const prop = result.normalized;
        const rowClass = result.isDuplicate ? 'preview-row-duplicate' : 
                        (result.errors.length > 0 ? 'preview-row-error' :
                        (result.warnings.length > 0 ? 'preview-row-warning' : 'preview-row-valid'));
        
        const statusClass = result.isDuplicate ? 'status-cell-duplicate' :
                           (result.errors.length > 0 ? 'status-cell-error' :
                           (result.warnings.length > 0 ? 'status-cell-warning' : 'status-cell-valid'));
        
        const statusText = result.isDuplicate ? '🔄 Duplicate' :
                          (result.errors.length > 0 ? \`❌ \${result.errors[0]}\` :
                          (result.warnings.length > 0 ? \`⚠️ \${result.warnings[0]}\` : '✓ Valid'));
        
        html += \`
            <tr class="\${rowClass}">
                <td>\${index + 1}</td>
                <td>\${prop.SEC || '-'}</td>
                <td>\${prop.TWN || '-'}</td>
                <td>\${prop.RNG || '-'}</td>
                <td>\${prop.MERIDIAN || '-'}</td>
                <td>\${prop.COUNTY || '-'}</td>
                <td class="status-cell \${statusClass}">
                    \${statusText}
                </td>
            </tr>
        \`;
    });
    
    tbody.innerHTML = html;
}

// Start import
async function startImport() {
    // Show import step
    document.getElementById('preview-step').style.display = 'none';
    document.getElementById('import-step').style.display = 'block';
    
    // Start indeterminate progress animation
    const progressBar = document.getElementById('progress-bar');
    progressBar.classList.add('indeterminate');
    document.getElementById('progress-percent').textContent = '';
    
    // Prepare valid properties for upload
    const toImport = validationResults.results
        .filter(r => r.isValid && !r.isDuplicate)
        .map(r => r.normalized);
    
    document.getElementById('import-progress').textContent = \`Importing \${toImport.length} properties...\`;
    
    try {
        const response = await fetch('/api/bulk-upload-properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: toImport })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
        
        const results = await response.json();
        
        // Show completion briefly
        progressBar.classList.remove('indeterminate');
        progressBar.style.width = '100%';
        document.getElementById('progress-percent').textContent = '100%';
        document.getElementById('import-progress').textContent = \`\${results.results.successful} of \${toImport.length} properties created\`;
        
        // Brief delay to show completion
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Show results
        showResults(results);
        
    } catch (error) {
        console.error('Upload error:', error);
        showError(error.message);
    }
}

// Show results
function showResults(results) {
    document.getElementById('import-step').style.display = 'none';
    document.getElementById('results-step').style.display = 'block';
    
    const success = results.results.successful;
    const failed = results.results.failed;
    const skipped = results.results.skipped;
    
    // Update stat boxes
    document.getElementById('result-created').textContent = success;
    document.getElementById('result-skipped').textContent = skipped;
    document.getElementById('result-failed').textContent = failed;
    
    if (failed === 0) {
        document.getElementById('results-icon').textContent = '✅';
        document.getElementById('results-title').textContent = 'Import Complete!';
        document.getElementById('results-details').textContent = 'Your properties are now being monitored for OCC activity.';
    } else {
        document.getElementById('results-icon').textContent = '⚠️';
        document.getElementById('results-title').textContent = 'Import Completed with Errors';
        document.getElementById('results-details').textContent = 'Some properties could not be imported. Check your file and try again.';
    }
}

// Show error
function showError(message) {
    document.getElementById('import-step').style.display = 'none';
    document.getElementById('results-step').style.display = 'block';
    document.getElementById('results-icon').textContent = '❌';
    document.getElementById('results-title').textContent = 'Import Failed';
    
    // Clear stat boxes
    document.getElementById('result-created').textContent = '0';
    document.getElementById('result-skipped').textContent = '0';
    document.getElementById('result-failed').textContent = '–';
    
    document.getElementById('results-details').textContent = message;
}

// Finish and close
function finishBulkUpload() {
    closeBulkUploadModal();
    // Reload properties
    loadProperties();
}

// ==========================================
// WELLS BULK UPLOAD FUNCTIONS
// ==========================================

let wellsParsedData = [];
let wellsValidationResults = null;

// Close wells modal
function closeBulkUploadWellsModal() {
    document.getElementById('bulk-upload-wells-modal').style.display = 'none';
    resetBulkUploadWells();
}

// Reset wells modal
function resetBulkUploadWells() {
    document.getElementById('wells-upload-step').style.display = 'block';
    document.getElementById('wells-preview-step').style.display = 'none';
    document.getElementById('wells-import-step').style.display = 'none';
    document.getElementById('wells-results-step').style.display = 'none';
    document.getElementById('wells-file-info').style.display = 'none';
    document.getElementById('wells-parse-error').style.display = 'none';
    document.getElementById('wellsFileInput').value = '';
    wellsParsedData = [];
    wellsValidationResults = null;
}

// Handle wells file drop
function handleWellsFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('wells-dropzone').classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processWellsFile(files[0]);
    }
}

function handleWellsDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('wells-dropzone').classList.add('drag-over');
}

function handleWellsDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('wells-dropzone').classList.remove('drag-over');
}

function handleWellsFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        processWellsFile(files[0]);
    }
}

// Process wells file
async function processWellsFile(file) {
    document.getElementById('wells-filename').textContent = file.name;
    document.getElementById('wells-filesize').textContent = \`\${(file.size / 1024).toFixed(1)} KB\`;
    document.getElementById('wells-file-info').style.display = 'flex';
    document.getElementById('wells-parse-error').style.display = 'none';
    
    try {
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
            await parseWellsCSV(file);
        } else if (extension === 'xlsx' || extension === 'xls') {
            await parseWellsExcel(file);
        } else {
            throw new Error('Unsupported file type');
        }
        
        if (wellsParsedData.length === 0) {
            throw new Error('No data found in file');
        }
        
        await validateAndPreviewWells();
        
    } catch (error) {
        console.error('Wells file processing error:', error);
        document.getElementById('wells-error-message').textContent = error.message;
        document.getElementById('wells-parse-error').style.display = 'block';
    }
}

// Parse CSV for wells
async function parseWellsCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                wellsParsedData = results.data;
                resolve();
            },
            error: (error) => reject(error)
        });
    });
}

// Parse Excel for wells
async function parseWellsExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                wellsParsedData = XLSX.utils.sheet_to_json(firstSheet);
                resolve();
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

// Validate and preview wells
async function validateAndPreviewWells() {
    try {
        const response = await fetch('/api/bulk-validate-wells', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wells: wellsParsedData })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Validation failed');
        }
        
        wellsValidationResults = await response.json();
        
        document.getElementById('wells-upload-step').style.display = 'none';
        document.getElementById('wells-preview-step').style.display = 'block';
        
        renderWellsSummary();
        renderWellsPlanCheck();
        renderWellsPreviewTable();
        
    } catch (error) {
        console.error('Wells validation error:', error);
        document.getElementById('wells-error-message').textContent = error.message;
        document.getElementById('wells-parse-error').style.display = 'block';
    }
}

// Render wells summary badges
function renderWellsSummary() {
    const summary = wellsValidationResults.summary;
    const html = \`
        <div class="validation-badge badge-valid">✓ \${summary.valid} Valid</div>
        \${summary.invalid > 0 ? \`<div class="validation-badge badge-invalid">❌ \${summary.invalid} Invalid</div>\` : ''}
        \${summary.duplicates > 0 ? \`<div class="validation-badge badge-duplicate">↺ \${summary.duplicates} Duplicates</div>\` : ''}
    \`;
    document.getElementById('wells-validation-summary').innerHTML = html;
}

// Render wells plan check
function renderWellsPlanCheck() {
    const plan = wellsValidationResults.planCheck;
    const wouldExceed = plan.wouldExceedLimit;
    
    const html = \`
        <div class="plan-check-box \${wouldExceed ? 'exceeded' : 'ok'}">
            <div class="plan-check-header">
                \${wouldExceed ? '❌ Would Exceed Plan Limit' : '✓ Within Plan Limit'}
            </div>
            <div class="plan-check-details">
                Current: \${plan.current} wells · 
                Adding: \${wellsValidationResults.summary.willImport} · 
                Total: \${plan.afterUpload} of \${plan.limit} (\${plan.plan} plan)
            </div>
        </div>
    \`;
    document.getElementById('wells-plan-check').innerHTML = html;
    document.getElementById('wells-import-btn').disabled = wouldExceed;
}

// Render wells preview table
function renderWellsPreviewTable() {
    const tbody = document.getElementById('wells-preview-table-body');
    let html = '';
    
    wellsValidationResults.results.forEach((result, index) => {
        const rowClass = result.isDuplicate ? 'preview-row-duplicate' :
                        (result.errors.length > 0 ? 'preview-row-error' :
                        (result.warnings.length > 0 ? 'preview-row-warning' : 'preview-row-valid'));
        
        const statusClass = result.isDuplicate ? 'status-cell-duplicate' :
                           (result.errors.length > 0 ? 'status-cell-error' :
                           (result.warnings.length > 0 ? 'status-cell-warning' : 'status-cell-valid'));
        
        const statusText = result.isDuplicate ? '↺ Duplicate' :
                          (result.errors.length > 0 ? \`❌ \${result.errors[0]}\` :
                          (result.warnings.length > 0 ? \`⚠️ \${result.warnings[0]}\` : '✓ Valid'));
        
        html += \`
            <tr class="\${rowClass}">
                <td>\${index + 1}</td>
                <td>\${result.normalized.apiNumber || '-'}</td>
                <td>\${result.normalized.wellName || '-'}</td>
                <td class="status-cell \${statusClass}">\${statusText}</td>
            </tr>
        \`;
    });
    
    tbody.innerHTML = html;
}

// Start wells import
async function startWellsImport() {
    document.getElementById('wells-preview-step').style.display = 'none';
    document.getElementById('wells-import-step').style.display = 'block';
    
    const toImport = wellsValidationResults.results
        .filter(r => r.isValid && !r.isDuplicate)
        .map(r => r.normalized);
    
    document.getElementById('wells-import-progress').textContent = \`Importing \${toImport.length} wells...\`;
    
    try {
        const response = await fetch('/api/bulk-upload-wells', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wells: toImport })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }
        
        const results = await response.json();
        
        // Brief delay to show progress
        await new Promise(resolve => setTimeout(resolve, 500));
        
        showWellsResults(results);
        
    } catch (error) {
        console.error('Wells upload error:', error);
        showWellsError(error.message);
    }
}

// Show wells results
function showWellsResults(results) {
    document.getElementById('wells-import-step').style.display = 'none';
    document.getElementById('wells-results-step').style.display = 'block';
    
    const success = results.results.successful;
    const failed = results.results.failed;
    const skipped = results.results.skipped;
    
    document.getElementById('wells-result-created').textContent = success;
    document.getElementById('wells-result-skipped').textContent = skipped;
    document.getElementById('wells-result-failed').textContent = failed;
    
    if (failed === 0) {
        document.getElementById('wells-results-icon').textContent = '✅';
        document.getElementById('wells-results-title').textContent = 'Import Complete!';
        document.getElementById('wells-results-details').textContent = 'Your wells are now being monitored for OCC activity.';
    } else {
        document.getElementById('wells-results-icon').textContent = '⚠️';
        document.getElementById('wells-results-title').textContent = 'Import Completed with Errors';
        document.getElementById('wells-results-details').textContent = 'Some wells could not be imported.';
    }
}

// Show wells error
function showWellsError(message) {
    document.getElementById('wells-import-step').style.display = 'none';
    document.getElementById('wells-results-step').style.display = 'block';
    document.getElementById('wells-results-icon').textContent = '❌';
    document.getElementById('wells-results-title').textContent = 'Import Failed';
    document.getElementById('wells-result-created').textContent = '0';
    document.getElementById('wells-result-skipped').textContent = '0';
    document.getElementById('wells-result-failed').textContent = '–';
    document.getElementById('wells-results-details').textContent = message;
}

// Finish wells upload
function finishBulkUploadWells() {
    closeBulkUploadWellsModal();
    loadWells();
}
</script>

<!-- Add Papa Parse library (CSV parsing) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js"></script>

<!-- Add SheetJS library (Excel parsing) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>

    </body>
</html>`;

// Account page remains the same - would need minor updates for wells display
var ACCOUNT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account - Mineral Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        :root { --oil-navy: #1C2B36; --slate-blue: #334E68; --red-dirt: #C05621; --red-dirt-dark: #9C4215; --paper: #F8F9FA; --border: #E2E8F0; --success: #03543F; --success-bg: #DEF7EC; --error: #DC2626; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background: #F7FAFC; min-height: 100vh; }
        h1, h2, .logo { font-family: 'Merriweather', serif; }
        header { background: var(--oil-navy); padding: 15px 0; color: white; }
        .container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
        .header-inner { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 20px; font-weight: 900; color: white; text-decoration: none; }
        .nav-links { display: flex; gap: 25px; }
        .nav-links a { color: rgba(255,255,255,0.8); text-decoration: none; font-weight: 500; font-size: 14px; }
        .nav-links a:hover, .nav-links a.active { color: white; }
        .user-menu { display: flex; align-items: center; gap: 15px; }
        .user-name { font-size: 14px; color: rgba(255,255,255,0.8); }
        .btn-logout { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 8px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; }
        main { padding: 40px 0; }
        .page-header h1 { font-size: 28px; margin-bottom: 30px; }
        .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; }
        .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 25px; }
        .card.full { grid-column: span 2; }
        .card h2 { font-size: 18px; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border); }
        .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border); }
        .info-row:last-of-type { border-bottom: none; }
        .info-label { font-size: 14px; color: var(--slate-blue); }
        .info-value { font-size: 14px; font-weight: 600; }
        .plan-badge { background: var(--success-bg); color: var(--success); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .plan-badge.free { background: #E2E8F0; color: var(--slate-blue); }
        .btn { display: inline-block; padding: 12px 20px; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; border: none; margin-top: 20px; }
        .btn-secondary { background: white; color: var(--oil-navy); border: 1px solid var(--border); }
        .btn-primary { background: var(--red-dirt); color: white; }
        .features { margin: 20px 0; list-style: none; }
        .features li { padding: 8px 0 8px 25px; position: relative; font-size: 14px; color: var(--slate-blue); }
        .features li::before { content: '✓'; position: absolute; left: 0; color: var(--success); font-weight: bold; }
        .upgrade-box { background: var(--paper); border-radius: 6px; padding: 20px; margin-top: 20px; }
        .upgrade-box p { font-size: 14px; color: var(--slate-blue); margin-bottom: 15px; }
        footer { background: var(--oil-navy); color: #A0AEC0; padding: 20px 0; font-size: 13px; text-align: center; }
        @media (max-width: 768px) { .cards { grid-template-columns: 1fr; } .card.full { grid-column: span 1; } .user-name { display: none; } }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <div class="header-inner">
                <a href="/" class="logo">Mineral Watch</a>
                <nav class="nav-links">
                    <a href="/portal">Dashboard</a>
                    <a href="/portal/account" class="active">Account</a>
                </nav>
                <div class="user-menu">
                    <span class="user-name" id="userName">Loading...</span>
                    <button class="btn-logout" id="logoutBtn">Log Out</button>
                </div>
            </div>
        </div>
    </header>
    <main>
        <div class="container">
            <div class="page-header"><h1>Account Settings</h1></div>
            <div class="cards">
                <div class="card">
                    <h2>Profile</h2>
                    <div class="info-row"><span class="info-label">Name</span><span class="info-value" id="profileName">—</span></div>
                    <div class="info-row"><span class="info-label">Email</span><span class="info-value" id="profileEmail">—</span></div>
                </div>
                <div class="card">
                    <h2>Subscription</h2>
                    <div class="info-row"><span class="info-label">Plan</span><span class="plan-badge" id="currentPlan">Loading...</span></div>
                    <div class="info-row"><span class="info-label">Properties</span><span class="info-value"><span id="propItems">0</span> / <span id="propLimit">1</span></span></div>
                    <div class="info-row"><span class="info-label">Wells</span><span class="info-value"><span id="wellItems">0</span> / <span id="wellLimit">0</span></span></div>
                    <div class="info-row"><span class="info-label">Status</span><span class="info-value" id="status">—</span></div>
                    <button class="btn btn-secondary" id="manageBtn">Manage Subscription</button>
                </div>
                <div class="card full">
                    <h2>Your Plan Features</h2>
                    <ul class="features" id="features"><li>Loading...</li></ul>
                    <div class="upgrade-box" id="upgradeBox">
                        <p>Need to monitor more properties or wells? Upgrade your plan.</p>
                        <a href="/portal/upgrade" class="btn btn-primary">View Plans</a>
                    </div>
                </div>
            </div>
        </div>
    </main>
    <footer><div class="container">&copy; 2025 Mineral Watch</div></footer>
    <script>
        const planConfigs = {
            'Free': { properties: 1, wells: 0, features: ['1 property', 'Adjacent monitoring', 'Daily scans', 'Email alerts'] },
            'Starter': { properties: 10, wells: 10, features: ['10 properties', '10 wells', 'Adjacent monitoring', 'Daily scans', 'Email alerts', 'Email support'] },
            'Standard': { properties: 50, wells: 50, features: ['50 properties', '50 wells', 'Adjacent monitoring', 'Daily scans', 'Priority support'] },
            'Professional': { properties: 500, wells: 500, features: ['500 properties', '500 wells', 'Adjacent monitoring', 'Daily scans', 'Priority support', 'Bulk upload'] },
            'Enterprise': { properties: Infinity, wells: Infinity, features: ['Unlimited properties', 'Unlimited wells', 'All features', 'Dedicated support'] }
        };
        
        let currentUser = null;
        
        document.addEventListener('DOMContentLoaded', async () => {
            try {
                const res = await fetch('/api/auth/me');
                if (!res.ok) { window.location.href = '/portal/login'; return; }
                currentUser = await res.json();
                const plan = currentUser.plan || 'Free';
                const config = planConfigs[plan] || planConfigs['Free'];
                
                document.getElementById('userName').textContent = currentUser.name || currentUser.email;
                document.getElementById('profileName').textContent = currentUser.name || '—';
                document.getElementById('profileEmail').textContent = currentUser.email;
                document.getElementById('currentPlan').textContent = plan;
                document.getElementById('currentPlan').classList.toggle('free', plan === 'Free');
                document.getElementById('propLimit').textContent = config.properties === Infinity ? '∞' : config.properties;
                document.getElementById('wellLimit').textContent = config.wells === Infinity ? '∞' : config.wells;
                document.getElementById('status').textContent = currentUser.status || 'Active';
                document.getElementById('features').innerHTML = config.features.map(f => '<li>' + f + '</li>').join('');
                
                // Hide upgrade box for Enterprise
                if (plan === 'Enterprise') document.getElementById('upgradeBox').style.display = 'none';
                
                // Hide manage button if no Stripe Customer ID (Free user without billing history)
                if (!currentUser.stripeCustomerId) {
                    document.getElementById('manageBtn').style.display = 'none';
                }
                
                // Get counts
                const [propsRes, wellsRes] = await Promise.all([
                    fetch('/api/properties'),
                    fetch('/api/wells')
                ]);
                if (propsRes.ok && wellsRes.ok) {
                    const props = await propsRes.json();
                    const wells = await wellsRes.json();
                    document.getElementById('propItems').textContent = props.length;
                    document.getElementById('wellItems').textContent = wells.length;
                }
            } catch { window.location.href = '/portal/login'; }
        });
        
        document.getElementById('manageBtn').addEventListener('click', async () => {
            try {
                const res = await fetch('/api/billing/portal', { method: 'POST' });
                if (res.ok) {
                    const { url } = await res.json();
                    window.location.href = url;
                } else { alert('Unable to open billing portal.'); }
            } catch { alert('Error connecting to billing.'); }
        });
        
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/portal/login';
        });
    </script>
</body>
</html>`;

var UPGRADE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upgrade - Mineral Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        :root { 
            --oil-navy: #1C2B36; --slate-blue: #334E68; --red-dirt: #C05621; 
            --red-dirt-dark: #9C4215; --paper: #F8F9FA; --border: #E2E8F0; 
            --success: #03543F; --success-bg: #DEF7EC; 
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: var(--oil-navy); background: #F7FAFC; min-height: 100vh; }
        h1, h2, .logo { font-family: 'Merriweather', serif; }
        
        header { background: var(--oil-navy); }
        .header-inner { max-width: 1200px; margin: 0 auto; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 20px; font-weight: 900; color: white; text-decoration: none; }
        .nav-links a { color: #CBD5E0; text-decoration: none; margin-left: 24px; font-size: 14px; }
        .nav-links a:hover, .nav-links a.active { color: white; }
        
        main { max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
        .page-header { text-align: center; margin-bottom: 40px; }
        .page-header h1 { font-size: 32px; margin-bottom: 12px; }
        .page-header p { color: var(--slate-blue); font-size: 18px; }
        
        .current-plan-banner { 
            background: var(--success-bg); 
            border: 1px solid var(--success); 
            border-radius: 8px; 
            padding: 16px 24px; 
            margin-bottom: 32px; 
            text-align: center;
            color: var(--success);
            font-weight: 500;
        }
        
        .interval-toggle {
            display: flex;
            justify-content: center;
            margin-bottom: 32px;
            gap: 8px;
        }
        .interval-btn {
            padding: 10px 24px;
            border: 2px solid var(--border);
            background: white;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .interval-btn.active {
            border-color: var(--oil-navy);
            background: var(--oil-navy);
            color: white;
        }
        .save-badge {
            background: var(--success);
            color: white;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            margin-left: 8px;
        }
        
        .pricing-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
        }
        @media (max-width: 900px) {
            .pricing-grid { grid-template-columns: 1fr; max-width: 400px; margin: 0 auto; }
        }
        
        .plan-card {
            background: white;
            border: 2px solid var(--border);
            border-radius: 12px;
            padding: 32px 24px;
            text-align: center;
            transition: all 0.2s;
            position: relative;
        }
        .plan-card.current {
            border-color: var(--oil-navy);
            box-shadow: 0 4px 20px rgba(28, 43, 54, 0.15);
        }
        .plan-card.popular {
            border-color: var(--red-dirt);
        }
        .popular-badge {
            position: absolute;
            top: -12px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--red-dirt);
            color: white;
            padding: 4px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .current-badge {
            position: absolute;
            top: -12px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--oil-navy);
            color: white;
            padding: 4px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .plan-name { font-size: 24px; font-weight: 700; margin-bottom: 8px; font-family: 'Merriweather', serif; }
        .plan-price { font-size: 48px; font-weight: 700; color: var(--oil-navy); }
        .plan-price span { font-size: 16px; font-weight: 400; color: var(--slate-blue); }
        .plan-interval { color: var(--slate-blue); font-size: 14px; margin-bottom: 24px; }
        
        .plan-features { list-style: none; text-align: left; margin-bottom: 24px; }
        .plan-features li { padding: 8px 0; font-size: 14px; color: var(--slate-blue); display: flex; align-items: center; gap: 10px; }
        .plan-features li::before { content: "✓"; color: var(--success); font-weight: bold; }
        
        .plan-btn {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .plan-btn.primary {
            background: var(--red-dirt);
            color: white;
        }
        .plan-btn.primary:hover { background: var(--red-dirt-dark); }
        .plan-btn.secondary {
            background: var(--paper);
            color: var(--slate-blue);
            border: 1px solid var(--border);
        }
        .plan-btn.secondary:hover { background: var(--border); }
        .plan-btn.current-btn {
            background: var(--oil-navy);
            color: white;
            cursor: default;
        }
        .plan-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        
        .back-link {
            display: block;
            text-align: center;
            margin-top: 32px;
            color: var(--slate-blue);
            text-decoration: none;
            font-size: 14px;
        }
        .back-link:hover { color: var(--oil-navy); }
        
        footer { background: var(--oil-navy); color: #A0AEC0; padding: 20px; text-align: center; font-size: 13px; margin-top: 60px; }
        
        .loading-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(255,255,255,0.9);
            z-index: 1000;
            justify-content: center;
            align-items: center;
            flex-direction: column;
        }
        .loading-overlay.show { display: flex; }
        .spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--red-dirt); border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <header>
        <div class="header-inner">
            <a href="/" class="logo">Mineral Watch</a>
            <nav class="nav-links">
                <a href="/portal">Dashboard</a>
                <a href="/portal/account">Account</a>
            </nav>
        </div>
    </header>
    
    <main>
        <div class="page-header">
            <h1>Choose Your Plan</h1>
            <p>Monitor more properties and wells with an upgraded plan</p>
        </div>
        
        <div class="current-plan-banner" id="currentPlanBanner">
            You're currently on the <strong id="currentPlanName">Free</strong> plan
        </div>
        
        <div class="interval-toggle">
            <button class="interval-btn active" data-interval="monthly">Monthly</button>
            <button class="interval-btn" data-interval="annual">Annual <span class="save-badge">Save 20%</span></button>
        </div>
        
        <div class="pricing-grid">
            <!-- Starter -->
            <div class="plan-card" id="starterCard">
                <h3 class="plan-name">Starter</h3>
                <div class="plan-price" id="starterPrice">$9<span>/mo</span></div>
                <div class="plan-interval" id="starterInterval">billed monthly</div>
                <ul class="plan-features">
                    <li>10 properties</li>
                    <li>10 wells</li>
                    <li>Adjacent section monitoring</li>
                    <li>Daily OCC scans</li>
                    <li>Email alerts</li>
                </ul>
                <button class="plan-btn primary" id="starterBtn" data-plan="starter">Select Starter</button>
            </div>
            
            <!-- Standard -->
            <div class="plan-card popular" id="standardCard">
                <div class="popular-badge">Most Popular</div>
                <h3 class="plan-name">Standard</h3>
                <div class="plan-price" id="standardPrice">$29<span>/mo</span></div>
                <div class="plan-interval" id="standardInterval">billed monthly</div>
                <ul class="plan-features">
                    <li>50 properties</li>
                    <li>50 wells</li>
                    <li>Adjacent section monitoring</li>
                    <li>Daily OCC scans</li>
                    <li>Priority support</li>
                </ul>
                <button class="plan-btn primary" id="standardBtn" data-plan="standard">Select Standard</button>
            </div>
            
            <!-- Professional -->
            <div class="plan-card" id="professionalCard">
                <h3 class="plan-name">Professional</h3>
                <div class="plan-price" id="professionalPrice">$99<span>/mo</span></div>
                <div class="plan-interval" id="professionalInterval">billed monthly</div>
                <ul class="plan-features">
                    <li>500 properties</li>
                    <li>500 wells</li>
                    <li>Adjacent section monitoring</li>
                    <li>Daily OCC scans</li>
                    <li>Priority support</li>
                    <li>Bulk upload</li>
                </ul>
                <button class="plan-btn primary" id="professionalBtn" data-plan="professional">Select Professional</button>
            </div>
        </div>
        
        <a href="/portal" class="back-link">← Back to Dashboard</a>
    </main>
    
    <footer>&copy; 2025 Mineral Watch</footer>
    
    <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <p style="margin-top: 16px; color: var(--slate-blue);">Processing...</p>
    </div>
    
    <script>
        const pricing = {
            starter: { monthly: 9, annual: 86 },
            standard: { monthly: 29, annual: 278 },
            professional: { monthly: 99, annual: 950 }
        };
        
        const planHierarchy = ['Free', 'Starter', 'Standard', 'Professional', 'Enterprise'];
        
        let currentInterval = 'monthly';
        let currentUser = null;
        
        document.addEventListener('DOMContentLoaded', async () => {
            // Check for success/error params
            const params = new URLSearchParams(window.location.search);
            if (params.get('error')) {
                alert('Something went wrong. Please try again.');
            }
            
            // Load user data
            try {
                const res = await fetch('/api/auth/me');
                if (!res.ok) { window.location.href = '/portal/login'; return; }
                currentUser = await res.json();
                
                document.getElementById('currentPlanName').textContent = currentUser.plan || 'Free';
                
                // If Enterprise, redirect - they can't change
                if (currentUser.plan === 'Enterprise') {
                    window.location.href = '/portal';
                    return;
                }
                
                updateUI();
            } catch { 
                window.location.href = '/portal/login'; 
            }
            
            // Interval toggle
            document.querySelectorAll('.interval-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentInterval = btn.dataset.interval;
                    updatePrices();
                });
            });
            
            // Plan buttons
            document.querySelectorAll('.plan-btn').forEach(btn => {
                btn.addEventListener('click', () => selectPlan(btn.dataset.plan));
            });
        });
        
        function updateUI() {
            updatePrices();
            updateButtons();
        }
        
        function updatePrices() {
            const isAnnual = currentInterval === 'annual';
            
            ['starter', 'standard', 'professional'].forEach(plan => {
                const price = pricing[plan][currentInterval];
                const perMonth = isAnnual ? Math.round(price / 12) : price;
                
                document.getElementById(plan + 'Price').innerHTML = 
                    '$' + perMonth + '<span>/mo</span>';
                document.getElementById(plan + 'Interval').textContent = 
                    isAnnual ? 'billed annually ($' + price + '/yr)' : 'billed monthly';
            });
        }
        
        function updateButtons() {
            const userPlan = currentUser?.plan || 'Free';
            const userIndex = planHierarchy.indexOf(userPlan);
            
            ['starter', 'standard', 'professional'].forEach(plan => {
                const card = document.getElementById(plan + 'Card');
                const btn = document.getElementById(plan + 'Btn');
                const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
                const planIndex = planHierarchy.indexOf(planName);
                
                // Remove existing badges
                card.classList.remove('current');
                const existingBadge = card.querySelector('.current-badge');
                if (existingBadge) existingBadge.remove();
                
                if (planName === userPlan) {
                    // Current plan
                    card.classList.add('current');
                    const badge = document.createElement('div');
                    badge.className = 'current-badge';
                    badge.textContent = 'Current Plan';
                    card.insertBefore(badge, card.firstChild);
                    btn.textContent = 'Current Plan';
                    btn.className = 'plan-btn current-btn';
                    btn.disabled = true;
                } else if (planIndex > userIndex) {
                    // Upgrade
                    btn.textContent = 'Upgrade to ' + planName;
                    btn.className = 'plan-btn primary';
                    btn.disabled = false;
                } else {
                    // Downgrade
                    btn.textContent = 'Downgrade to ' + planName;
                    btn.className = 'plan-btn secondary';
                    btn.disabled = false;
                }
            });
        }
        
        async function selectPlan(plan) {
            document.getElementById('loadingOverlay').classList.add('show');
            
            try {
                const res = await fetch('/api/upgrade', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plan, interval: currentInterval })
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || 'Upgrade failed');
                }
                
                if (data.url) {
                    // Redirect to Stripe Checkout
                    window.location.href = data.url;
                } else if (data.success) {
                    // Direct update succeeded
                    alert(data.message);
                    window.location.href = '/portal';
                }
            } catch (err) {
                document.getElementById('loadingOverlay').classList.remove('show');
                alert(err.message || 'Something went wrong. Please try again.');
            }
        }
    </script>
</body>
</html>`;

export {
  index_default as default
};
