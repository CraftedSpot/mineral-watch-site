/**
 * Track Well Handlers
 * 
 * Handles signed token-based well tracking from email alerts
 */

import { 
  BASE_ID,
  WELLS_TABLE,
  BASE_URL,
  PLAN_LIMITS
} from '../constants.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import {
  getUserByIdD1First,
  countUserWellsD1,
  checkDuplicateWellD1
} from '../services/airtable.js';

import {
  fetchWellDetailsFromOCC,
  lookupCompletionData
} from './wells.js';

import { generateRecordId } from '../utils/id-gen.js';

import type { Env } from '../types/env.js';

// --- Airtable Kill Switch ---
let _airtableKilled: boolean | null = null;
let _airtableKillCheckedAt = 0;
const KILL_SWITCH_CACHE_TTL = 60_000;

async function isAirtableKilled(kv: KVNamespace): Promise<boolean> {
  const now = Date.now();
  if (_airtableKilled !== null && now - _airtableKillCheckedAt < KILL_SWITCH_CACHE_TTL) {
    return _airtableKilled;
  }
  try {
    const val = await kv.get('airtable:kill-switch');
    _airtableKilled = val === 'true';
  } catch {
    _airtableKilled = false;
  }
  _airtableKillCheckedAt = now;
  return _airtableKilled;
}


/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate OCC map link with coordinates and title
 * @param lat Latitude
 * @param lon Longitude  
 * @param title Map marker title
 * @returns OCC map URL with marker
 */
function generateMapLink(lat: number, lon: number, title: string): string {
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

/**
 * Validate a signed tracking token
 * @param userId User ID for tracking
 * @param apiNumber Well API number
 * @param expiration Token expiration timestamp
 * @param token Signed token to validate
 * @param secret Secret key for validation
 * @returns Validation result object
 */
export async function validateTrackToken(
  userId: string, 
  apiNumber: string, 
  expiration: number, 
  token: string, 
  secret: string
): Promise<{ valid: boolean; error?: string }> {
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

/**
 * Generate success page for successful well tracking
 * @param apiNumber Well API number
 * @param alreadyTracking Whether user was already tracking this well
 * @param wellName Optional well name
 * @returns HTML success page
 */
export function generateTrackWellSuccessPage(apiNumber: string, alreadyTracking: boolean, wellName?: string): string {
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
                    <span class="value">${escapeHtml(apiNumber)}</span>
                </div>
                ${wellName ? `
                <div class="well-detail">
                    <span class="label">Well Name:</span>
                    <span class="value">${escapeHtml(wellName)}</span>
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

/**
 * Generate error page for failed well tracking
 * @param message Error message to display
 * @param showUpgrade Whether to show upgrade button
 * @returns HTML error page
 */
export function generateTrackWellErrorPage(message: string, showUpgrade: boolean = false): string {
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
            <p class="message">${escapeHtml(message)}</p>
            
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

/**
 * Handle track-this-well requests with signed token authentication
 * @param request The incoming request
 * @param env Worker environment
 * @param url URL object with tracking parameters
 * @returns HTML response with tracking result
 */
export async function handleTrackThisWell(request: Request, env: Env, url: URL): Promise<Response> {
  // Normal track-well flow
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
    // Use original apiNumber for token validation (not cleaned)
    const tokenValidation = await validateTrackToken(userId, apiNumber, expiration, token, env.TRACK_WELL_SECRET);
    
    if (!tokenValidation.valid) {
      console.log(`[Track Well] Token validation failed: ${tokenValidation.error}`);
      return new Response(generateTrackWellErrorPage(`Tracking link is ${tokenValidation.error}. Please request a new alert email.`), {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }
    
    try {
      // Get user record
      console.log(`[Track Well] Getting user record for ID: ${userId}`);
      const userRecord = await getUserByIdD1First(env, userId);
      if (!userRecord) {
        console.log(`[Track Well] User not found: ${userId}`);
        return new Response(generateTrackWellErrorPage('User not found. Please contact support.'), {
          headers: { 'Content-Type': 'text/html' },
          status: 404
        });
      }
      console.log(`[Track Well] Found user: ${userRecord.fields.Email}`);
      
      const userEmail = userRecord.fields.Email;
      const userOrganization = userRecord.fields.Organization?.[0]; // Get user's organization if they have one

      // Check for duplicate well API for this user (D1 indexed query)
      console.log(`[Track Well] Checking for duplicate well: ${cleanApi} for ${userEmail}`);
      const isDuplicate = await checkDuplicateWellD1(env, userId, userOrganization, cleanApi);
      if (isDuplicate) {
        console.log(`[Track Well] Well already tracked: ${cleanApi}`);
        return new Response(generateTrackWellSuccessPage(cleanApi, true), {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      // Check plan limits
      const plan = userRecord?.fields.Plan || "Free";
      const planLimits: { properties: number; wells: number } = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || { properties: 1, wells: 0 };

      if (planLimits.wells === 0) {
        return new Response(generateTrackWellErrorPage(`Your ${plan} plan does not include well monitoring. Please upgrade to add wells.`, true), {
          headers: { 'Content-Type': 'text/html' },
          status: 403
        });
      }
      
      const wellsCount = await countUserWellsD1(env, userId, userOrganization);
      if (wellsCount >= planLimits.wells) {
        return new Response(generateTrackWellErrorPage(`Well limit reached (${planLimits.wells} wells on ${plan} plan). You have ${wellsCount} wells.`, true), {
          headers: { 'Content-Type': 'text/html' },
          status: 403
        });
      }
      
      // Query OCC API to get well details
      console.log(`[Track Well] Fetching well details from OCC for API: ${cleanApi}`);
      const wellDetails = await fetchWellDetailsFromOCC(cleanApi, env);
      console.log(`[Track Well] OCC details fetched: ${wellDetails ? 'Found' : 'Not found'}`);
      
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
        const wd = wellDetails as any;
        occMapLink = generateMapLink(wd.lat, wd.lon, wd.wellName);
        wellName = wd.wellName || "";
        operator = wd.operator || "";
        county = wd.county || "";
        section = wd.section ? String(wd.section) : "";
        township = wd.township || "";
        range = wd.range || "";
        wellType = wd.wellType || "";
        wellStatus = wd.wellStatus || "";
      }
      
      // Look up completion data to enrich the well record
      console.log(`🔍 Looking up completion data for tracked API ${cleanApi}...`);
      const completionData = await lookupCompletionData(cleanApi, env);
      
      // Merge completion data (takes precedence)
      if (completionData) {
        console.log(`📊 Enriching tracked well with completion data: ${completionData.formationName || 'Unknown formation'}`);
        
        // IMPORTANT: Prefer OCC wellName as it includes well numbers
        // Only use completion data wellName if OCC didn't provide one
        if (!wellName && completionData.wellName) wellName = completionData.wellName;
        if (completionData.operator && !operator) operator = completionData.operator;
        
        // Always prefer completion data county but clean it
        if (completionData.county) {
          // Clean county format "017-CANADIAN" -> "CANADIAN" 
          // But keep the full value for data consistency
          county = completionData.county;
        }
        if (completionData.surfaceSection && !section) section = completionData.surfaceSection;
        if (completionData.surfaceTownship && !township) township = completionData.surfaceTownship;
        if (completionData.surfaceRange && !range) range = completionData.surfaceRange;
      }
      
      // Log final data before creating well
      console.log(`Creating well with data:`, {
        api: cleanApi,
        wellName,
        operator,
        county,
        section,
        township,
        range,
        wellType,
        wellStatus
      });
      
      // D1-first: Create well in D1 with generated record ID
      const recordId = generateRecordId();
      const wellId = `cwell_${recordId}`;

      try {
        await env.WELLS_DB.prepare(`
          INSERT INTO client_wells (id, airtable_id, api_number, user_id, organization_id,
            well_name, operator, county, section, township, range_val, status, notes,
            well_type, well_status, occ_map_link)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'Added via signed email tracking link', ?, ?, ?)
        `).bind(
          wellId, recordId, cleanApi, userId, userOrganization || null,
          wellName || null, operator || null, county || null,
          section || null, township || null, range || null,
          wellType || null, wellStatus || null, occMapLink || null
        ).run();
      } catch (dbErr: any) {
        console.error('[Track Well] D1 insert failed:', dbErr.message);
        return new Response(generateTrackWellErrorPage('Failed to add well. Please try again later.'), {
          headers: { 'Content-Type': 'text/html' },
          status: 500
        });
      }

      console.log(`[Track Well] D1 created: API ${cleanApi} for ${userEmail} (${recordId})`);

      // Fire-and-forget Airtable mirror (transition period — remove in Phase 4)
      if (await isAirtableKilled(env.MINERAL_CACHE)) {
        console.log(`[AirtableKillSwitch] Airtable write skipped: mirror tracked well ${cleanApi}`);
      } else {
      (async () => {
        try {
          const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}`;
          const resp = await fetch(createUrl, {
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
                Notes: "Added via signed email tracking link",
                ...(completionData?.formationName && { "Formation Name": completionData.formationName }),
                ...(completionData?.formationDepth && { "Formation Depth": completionData.formationDepth }),
                ...(completionData?.ipGas && { "IP Gas (MCF/day)": completionData.ipGas }),
                ...(completionData?.ipOil && { "IP Oil (BBL/day)": completionData.ipOil }),
                ...(completionData?.ipWater && { "IP Water (BBL/day)": completionData.ipWater }),
                ...(completionData?.spudDate && { "Spud Date": completionData.spudDate }),
                ...(completionData?.completionDate && { "Completion Date": completionData.completionDate }),
                ...(completionData?.firstProdDate && { "First Production Date": completionData.firstProdDate }),
                ...(completionData?.lateralLength && { "Lateral Length": completionData.lateralLength }),
                ...(completionData?.totalDepth && { "Total Depth": completionData.totalDepth }),
                ...(completionData && { "Data Last Updated": new Date().toISOString() }),
                ...(completionData?.pumpingFlowing && { "Pumping Flowing": completionData.pumpingFlowing }),
                ...(completionData?.drillType && { "Drill Type": completionData.drillType }),
                ...(completionData?.bhSection && { "BH Section": completionData.bhSection }),
                ...(completionData?.bhTownship && { "BH Township": completionData.bhTownship }),
                ...(completionData?.bhRange && { "BH Range": completionData.bhRange }),
                ...(userOrganization && { Organization: [userOrganization] })
              }
            }),
            signal: AbortSignal.timeout(10_000)
          });
          if (!resp.ok) console.error('[Track Well] Airtable mirror failed:', resp.status);
        } catch (e) {
          console.error('[Track Well] Airtable mirror error:', e);
        }
      })();
      }

      return new Response(generateTrackWellSuccessPage(cleanApi, false, wellName), {
        headers: { 'Content-Type': 'text/html' }
      });
      
    } catch (error) {
      const err = error as any;
      console.error("Track well error:", err);
      console.error("Error stack:", err.stack);
      
      // More specific error messages
      let errorMessage = 'An error occurred. Please try again later.';
      if (err.message?.includes('INVALID_REQUEST_UNKNOWN')) {
        errorMessage = 'Invalid user ID. Please request a new tracking link.';
      } else if (err.message?.includes('fetch failed')) {
        errorMessage = 'Unable to connect to services. Please try again.';
      } else if (err.message?.includes('AUTHENTICATION_FAILED')) {
        errorMessage = 'Authentication error. Please contact support.';
      }
      
      return new Response(generateTrackWellErrorPage(errorMessage), {
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