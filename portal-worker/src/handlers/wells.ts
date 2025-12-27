/**
 * Wells Handlers
 * 
 * Handles CRUD operations for user well monitoring with OCC API integration
 */

import { 
  WELLS_TABLE,
  BASE_ID,
  PLAN_LIMITS,
  OCC_CACHE_TTL
} from '../constants.js';

import { 
  jsonResponse 
} from '../utils/responses.js';

import {
  getUserById,
  countUserWells,
  checkDuplicateWell,
  fetchAllAirtableRecords
} from '../services/airtable.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import { getOperatorPhone, findOperatorByName } from '../services/operators.js';

import { matchSingleWell } from '../utils/property-well-matching.js';

import type { Env, CompletionData } from '../types/env.js';

/**
 * Convert ISO date to US format for Airtable (YYYY-MM-DD -> M/D/YY)
 * @param isoDate ISO date string like "1965-12-20" 
 * @returns US formatted date like "12/20/65" or null if invalid
 */
function formatDateForAirtable(isoDate: string): string | null {
  if (!isoDate) return null;
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return null;
    
    const month = date.getMonth() + 1; // 0-based to 1-based
    const day = date.getDate();
    const year = date.getFullYear() % 100; // Get last 2 digits of year
    
    return `${month}/${day}/${year.toString().padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/**
 * Extract well number from well name (e.g., "2" from "MYRTLE COLLINS ##2")
 * @param wellName The well name string
 * @returns Well number or null if not found
 */
function extractWellNumber(wellName: string): string | null {
  if (!wellName) return null;
  
  // Match patterns like "#2", "##2", "No. 2", "No.2", " 2" (at end)
  const patterns = [
    /##+(\d+)/i,           // ##2, ###2
    /#(\d+)/i,             // #2
    /no\.?\s*(\d+)/i,      // No. 2, No.2, no 2
    /\s+(\d+)$/i,          // ending with space and number
    /-(\d+)$/i             // ending with dash and number
  ];
  
  for (const pattern of patterns) {
    const match = wellName.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
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
 * Fetch well details from Oklahoma Corporation Commission API
 * @param apiNumber 10-digit API number
 * @param env Worker environment
 * @returns Well details or null if not found
 */
export async function fetchWellDetailsFromOCC(apiNumber: string, env: Env) {
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
    outFields: "*", // Get ALL fields to see what's available
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
      
      // LOG ALL AVAILABLE FIELDS for analysis
      console.log(`=== FULL OCC API RESPONSE FOR API ${apiNumber} ===`);
      console.log(JSON.stringify(attr, null, 2));
      console.log(`=== END OCC RESPONSE ===`);
      
      const wellDetails = {
        api: attr.api,
        wellName: attr.well_name && attr.well_num && !attr.well_name.includes('#') 
          ? `${attr.well_name} ${attr.well_num.startsWith('#') ? attr.well_num : '#' + attr.well_num}` 
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
        cachedAt: Date.now(),
        
        // Raw attributes for analysis
        _rawAttributes: attr
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

/**
 * Lookup completion data from KV cache
 * @param apiNumber 10-digit API number
 * @param env Worker environment
 * @returns Completion data or null if not found
 */
export async function lookupCompletionData(apiNumber: string, env: Env): Promise<CompletionData | null> {
  try {
    const cacheKey = `well:${apiNumber}`;
    const cached = await env.COMPLETIONS_CACHE.get(cacheKey, 'json') as CompletionData | null;
    
    if (cached) {
      console.log(`✅ Completion data found for API ${apiNumber}: ${cached.wellName || 'Unknown'} (${cached.source})`);
      return cached;
    } else {
      console.log(`ℹ️ No completion data found for API ${apiNumber}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Failed to lookup completion data for API ${apiNumber}:`, error);
    return null;
  }
}

/**
 * List all wells for the authenticated user
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with user wells
 */
export async function handleListWells(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get full user record to check for organization
  const userRecord = await getUserById(env, user.id);
  if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
  
  let formula: string;
  const organizationId = userRecord.fields.Organization?.[0];
  
  if (organizationId) {
    // User has organization - fetch org name and filter by it
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (orgResponse.ok) {
      const org = await orgResponse.json() as any;
      const orgName = org.fields.Name;
      // Filter by organization name
      formula = `{Organization} = '${orgName}'`;
    } else {
      // Fallback to email if org fetch fails
      formula = `FIND('${user.email}', ARRAYJOIN({User})) > 0`;
    }
  } else {
    // Solo user - filter by email
    formula = `FIND('${user.email}', ARRAYJOIN({User})) > 0`;
  }
  
  const records = await fetchAllAirtableRecords(env, WELLS_TABLE, formula);
  
  return jsonResponse(records);
}

/**
 * Add a new well for the authenticated user with OCC validation
 * @param request The incoming request with well data
 * @param env Worker environment
 * @returns JSON response with created well
 */
export async function handleAddWell(request: Request, env: Env, ctx?: ExecutionContext) {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get user record and check permissions
    const userRecord = await getUserById(env, user.id);
    if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
      return jsonResponse({ error: "Viewers cannot add wells" }, 403);
    }
    
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
  
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  
  // Check if plan allows wells
  if (planLimits.wells === 0) {
    return jsonResponse({ 
      error: `Your ${plan} plan does not include well monitoring. Please upgrade to add wells.` 
    }, 403);
  }
  
  // Count wells for user or organization
  const { countWellsForUserOrOrg } = await import('../services/airtable.js');
  const wellsCount = await countWellsForUserOrOrg(env, userRecord);
  
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
    } else if (suggestedWellName && suggestedWellName.includes('#')) {
      // User provided a well name with # - use it as-is to avoid double hashtags
      // Don't override with OCC well name
    } else if (!suggestedWellName || !suggestedWellName.includes('#')) {
      // User provided no name or name without #, prefer OCC well name if available
      suggestedWellName = wellDetails.wellName || suggestedWellName;
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
    console.log(`[DEBUG] Raw OCC operator: "${operator}"`);
  } else {
    console.warn(`Well API ${cleanApi} not found in OCC database - may be pending or invalid`);
    // Still allow adding, but with placeholder link and empty fields
  }
  
  // Look up operator information from comprehensive operator database
  let operatorPhone: string | null = null;
  let contactName: string | null = null;
  if (operator) {
    try {
      const operatorInfo = await findOperatorByName(operator, env);
      console.log(`[DEBUG] Operator lookup for "${operator}" returned:`, operatorInfo);
      if (operatorInfo) {
        operatorPhone = operatorInfo.phone || null;
        contactName = operatorInfo.contactName || null;
        console.log(`Found operator info for ${operator}: phone=${operatorPhone}, contact=${contactName}`);
      } else {
        console.log(`No operator info found for: ${operator}`);
        console.log(`[DEBUG] Normalized search name would be: "${operator.trim().toLowerCase()}"`);
      }
    } catch (error) {
      console.warn(`Failed to lookup operator info for ${operator}:`, error);
      console.warn(`Error details:`, error.message);
      // Continue without operator info - don't let this block well creation
    }
  }
  
  // Look up historical completion data from KV cache
  console.log(`🔍 Looking up completion data for API ${cleanApi}...`);
  const completionData = await lookupCompletionData(cleanApi, env);
  
  // Merge completion data with existing well data (completion data takes precedence)
  if (completionData) {
    console.log(`📊 Enriching well with completion data: ${completionData.formationName || 'Unknown formation'}`);
    console.log(`📊 DEBUG - Completion data details:`, JSON.stringify({
      formationName: completionData.formationName,
      ipGas: completionData.ipGas,
      ipOil: completionData.ipOil,
      completionDate: completionData.completionDate,
      spudDate: completionData.spudDate
    }, null, 2));
    
    // Use completion data for better accuracy, fall back to GIS data
    if (completionData.wellName && !suggestedWellName) {
      suggestedWellName = completionData.wellName;
    }
    if (completionData.operator && !operator) {
      operator = completionData.operator;
    }
    if (completionData.county && !county) {
      county = completionData.county;
    }
    if (completionData.surfaceSection && !section) {
      section = completionData.surfaceSection;
    }
    if (completionData.surfaceTownship && !township) {
      township = completionData.surfaceTownship;
    }
    if (completionData.surfaceRange && !range) {
      range = completionData.surfaceRange;
    }
  } else {
    console.log(`ℹ️ No completion data found for API ${cleanApi} - well will be created with OCC data only`);
  }
  
  const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}`;
  
  // Extract well number as fallback if not in completion data
  const wellNumber = completionData?.wellNumber || extractWellNumber(suggestedWellName);

  // Build the fields object for Airtable (using record ID for linked field)
  const airtableFields = {
    User: [user.id],
    "API Number": cleanApi,
    "Well Name": suggestedWellName,
    Status: "Active",
    "OCC Map Link": occMapLink,
    ...(body.occLink && { "OCC Filing Link": body.occLink }), // Save the permit PDF URL if provided
    Operator: operator || "",
    County: county,
    Section: section,
    Township: township,
    Range: range,
    "Well Type": wellType,
    "Well Status": wellStatus,
    ...(operatorPhone && { "Operator Phone": operatorPhone }),
    ...(contactName && { "Contact Name": contactName }),
    Notes: body.notes || "",
    
    // Enhanced fields from completion data (using exact Airtable field names)
    ...(completionData?.formationName && { "Formation Name": completionData.formationName }),
    ...(completionData?.formationDepth && { "Formation Depth": completionData.formationDepth }),
    ...(completionData?.ipGas && { "IP Gas (MCF/day)": completionData.ipGas }),
    ...(completionData?.ipOil && { "IP Oil (BBL/day)": completionData.ipOil }),
    ...(completionData?.ipWater && { "IP Water (BBL/day)": completionData.ipWater }),
    ...(completionData?.spudDate && { "Spud Date": formatDateForAirtable(completionData.spudDate) }),
    ...(completionData?.completionDate && { "Completion Date": formatDateForAirtable(completionData.completionDate) }),
    ...(completionData?.lateralLength && { "Lateral Length": completionData.lateralLength })
    // Note: BH Location field exists but would need proper formatting for BH coordinates  
    // Note: Is Multi-Section field exists but would need logic to determine multi-section wells
    // Note: Removed "Last Updated" field as it doesn't exist in Airtable table
  };
  
  console.log(`📤 DEBUG - Sending to Airtable:`, JSON.stringify(airtableFields, null, 2));
  
  console.log(`📤 Creating well in Airtable...`);
  
  const response = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: airtableFields })
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.error("❌ Airtable create well error:", {
      status: response.status,
      statusText: response.statusText,
      error: err,
      sentFields: Object.keys(airtableFields)
    });
    return jsonResponse({ 
      error: "Failed to create well", 
      details: err,
      status: response.status 
    }, 500);
  }
  
    const newRecord = await response.json();
    console.log(`Well added: API ${cleanApi} for ${user.email}`);
    console.log(`[WellCreate] New well record:`, JSON.stringify(newRecord, null, 2));
    
    // Trigger auto-matching in background
    if (newRecord.id && ctx) {
      console.log(`[WellCreate] Triggering auto-match for well: ${newRecord.id}`);
      
      const organizationId = userOrganization || undefined;
      const matchPromise = matchSingleWell(newRecord.id, user.id, organizationId, env)
        .then(result => {
          console.log(`[WellCreate] Auto-match complete:`, result);
          if (result.linksCreated > 0) {
            console.log(`[WellCreate] Created ${result.linksCreated} links out of ${result.propertiesChecked} properties checked`);
          }
        })
        .catch(err => {
          console.error('[WellCreate] Auto-match failed:', err);
          console.error('[WellCreate] Error details:', err.message, err.stack);
        });
      
      // Keep the worker alive until the match completes
      ctx.waitUntil(matchPromise);
    } else if (!newRecord.id) {
      console.error('[WellCreate] No ID in new record:', newRecord);
    } else if (!ctx) {
      console.error('[WellCreate] No ExecutionContext available for background matching');
    }
    
    return jsonResponse(newRecord, 201);
  } catch (error) {
    console.error("Error in handleAddWell:", error);
    return jsonResponse({ 
      error: "Internal server error", 
      message: error.message 
    }, 500);
  }
}

/**
 * Delete a well for the authenticated user
 * @param wellId The well ID to delete
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with success status
 */
export async function handleDeleteWell(wellId: string, request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Check permissions - only Admin and Editor can delete wells
  const userRecord = await getUserById(env, user.id);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot delete wells" }, 403);
  }
  
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
  const deleteResponse = await fetch(deleteUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!deleteResponse.ok) {
    const error = await deleteResponse.text();
    console.error(`Failed to delete well ${wellId}:`, error);
    return jsonResponse({ error: "Failed to delete well" }, 500);
  }
  
  console.log(`Well deleted: ${wellId} by ${user.email}`);
  return jsonResponse({ success: true });
}

/**
 * Update well notes for the authenticated user
 * @param wellId The well ID to update
 * @param request The incoming request with notes data
 * @param env Worker environment
 * @returns JSON response with success status
 */
export async function handleUpdateWellNotes(wellId: string, request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Check permissions - only Admin and Editor can update wells
  const userRecord = await getUserById(env, user.id);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot update wells" }, 403);
  }
  
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

/**
 * Normalize township/range input to handle both '12N' and '12' formats
 * @param value Township or range value (e.g., '12N', '12', '5W')
 * @param isRange Whether this is a range (W/E) or township (N/S) value
 * @returns Normalized value (e.g., '12N', '05W')
 */
function normalizeTownshipRange(value: string, isRange: boolean = false): string {
  if (!value) return '';
  
  // Remove whitespace and convert to uppercase
  const cleaned = value.trim().toUpperCase();
  
  // If already has direction, just normalize padding
  const match = cleaned.match(/^(\d+)([NSEW])$/);
  if (match) {
    const [, num, direction] = match;
    const numericPart = parseInt(num);
    const paddedNum = numericPart < 10 ? `0${numericPart}` : numericPart.toString();
    return `${paddedNum}${direction}`;
  }
  
  // If just a number, add appropriate direction
  const numMatch = cleaned.match(/^(\d+)$/);
  if (numMatch) {
    const numericPart = parseInt(numMatch[1]);
    const paddedNum = numericPart < 10 ? `0${numericPart}` : numericPart.toString();
    // Default to North for township, West for range (most common in Oklahoma)
    const direction = isRange ? 'W' : 'N';
    return `${paddedNum}${direction}`;
  }
  
  // Return as-is if we can't parse it
  return cleaned;
}

/**
 * Search wells in D1 database with flexible matching
 * @param request The incoming request with search parameters
 * @param env Worker environment
 * @returns JSON response with search results
 */
export async function handleSearchWells(request: Request, env: Env) {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[SearchWells] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Wells database not configured',
        message: 'The wells search feature is not available at this time'
      }, 503);
    }
    
    const url = new URL(request.url);
    
    // Get search parameters
    const generalQuery = url.searchParams.get('q')?.trim() || '';
    const wellName = url.searchParams.get('well_name')?.trim() || '';
    const operator = url.searchParams.get('operator')?.trim() || '';
    const section = url.searchParams.get('section')?.trim() || '';
    const township = url.searchParams.get('township')?.trim() || '';
    const range = url.searchParams.get('range')?.trim() || '';
    const county = url.searchParams.get('county')?.trim() || '';
    
    // Build WHERE conditions
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;
    
    // General search across multiple fields (if 'q' parameter provided)
    if (generalQuery) {
      const searchTerm = `%${generalQuery}%`;
      conditions.push(`(
        well_name LIKE ?${paramIndex} OR 
        api_number LIKE ?${paramIndex + 1} OR 
        operator LIKE ?${paramIndex + 2} OR 
        county LIKE ?${paramIndex + 3}
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      paramIndex += 4;
    }
    
    // Specific field searches
    if (wellName) {
      conditions.push(`well_name LIKE ?${paramIndex}`);
      params.push(`%${wellName}%`);
      paramIndex++;
    }
    
    if (operator) {
      conditions.push(`operator LIKE ?${paramIndex}`);
      params.push(`%${operator}%`);
      paramIndex++;
    }
    
    if (section) {
      const sectionNum = parseInt(section);
      if (!isNaN(sectionNum) && sectionNum >= 1 && sectionNum <= 36) {
        conditions.push(`section = ?${paramIndex}`);
        params.push(sectionNum);
        paramIndex++;
      } else {
        return jsonResponse({
          error: 'Invalid section',
          message: 'Section must be a number between 1 and 36'
        }, 400);
      }
    }
    
    if (township) {
      const normalizedTownship = normalizeTownshipRange(township, false);
      conditions.push(`township = ?${paramIndex}`);
      params.push(normalizedTownship);
      paramIndex++;
    }
    
    if (range) {
      const normalizedRange = normalizeTownshipRange(range, true);
      conditions.push(`range = ?${paramIndex}`);
      params.push(normalizedRange);
      paramIndex++;
    }
    
    if (county) {
      conditions.push(`county LIKE ?${paramIndex}`);
      params.push(`%${county}%`);
      paramIndex++;
    }
    
    // If no search criteria provided, return empty results
    if (conditions.length === 0) {
      return jsonResponse({
        success: true,
        data: {
          wells: [],
          total: 0,
          truncated: false,
          message: 'Please provide search criteria'
        }
      });
    }
    
    // Combine conditions with AND
    const whereClause = conditions.join(' AND ');
    
    // Build the query with limit of 25 + 1 to check for truncation
    const query = `
      SELECT 
        w.api_number,
        w.well_name,
        w.well_number,
        w.section,
        w.township,
        w.range,
        w.meridian,
        w.county,
        w.latitude,
        w.longitude,
        w.operator,
        w.well_type,
        w.well_status,
        w.spud_date,
        w.completion_date,
        w.formation_name,
        w.ip_oil_bbl,
        w.ip_gas_mcf,
        -- Operator info from operators table
        o.phone as operator_phone,
        o.contact_name as operator_contact
      FROM wells w
      LEFT JOIN operators o ON UPPER(TRIM(REPLACE(REPLACE(w.operator, '.', ''), ',', ''))) = o.operator_name_normalized
      WHERE ${whereClause}
      ORDER BY 
        CASE 
          WHEN w.well_status = 'AC' THEN 1 
          WHEN w.well_status = 'TA' THEN 2
          ELSE 3 
        END,
        w.well_name,
        w.api_number
      LIMIT 26
    `;
    
    console.log(`[SearchWells] Executing search with ${conditions.length} conditions`);
    console.log(`[SearchWells] Query parameters:`, params);
    
    const startTime = Date.now();
    const result = await env.WELLS_DB.prepare(query)
      .bind(...params)
      .all();
    
    const queryTime = Date.now() - startTime;
    
    // Check if results were truncated
    const wells = result.results.slice(0, 25); // Take only first 25
    const truncated = result.results.length > 25;
    
    console.log(`[SearchWells] Found ${result.results.length} wells in ${queryTime}ms, truncated: ${truncated}`);
    
    // Format the response
    const formattedWells = wells.map((well: any) => ({
      api_number: well.api_number,
      well_name: well.well_name,
      well_number: well.well_number,
      location: {
        section: well.section,
        township: well.township,
        range: well.range,
        meridian: well.meridian,
        county: well.county,
        latitude: well.latitude,
        longitude: well.longitude
      },
      operator: well.operator,
      operator_phone: well.operator_phone,
      operator_contact: well.operator_contact,
      well_type: well.well_type,
      well_status: well.well_status,
      dates: {
        spud_date: well.spud_date,
        completion_date: well.completion_date
      },
      production: {
        formation_name: well.formation_name,
        ip_oil_bbl: well.ip_oil_bbl,
        ip_gas_mcf: well.ip_gas_mcf
      }
    }));
    
    return jsonResponse({
      success: true,
      data: {
        wells: formattedWells,
        total: wells.length,
        truncated,
        query_time_ms: queryTime,
        search_criteria: {
          general_query: generalQuery || null,
          well_name: wellName || null,
          operator: operator || null,
          section: section ? parseInt(section) : null,
          township: township ? normalizeTownshipRange(township, false) : null,
          range: range ? normalizeTownshipRange(range, true) : null,
          county: county || null
        }
      }
    });
    
  } catch (error) {
    console.error('[SearchWells] Error:', error);
    return jsonResponse({ 
      error: 'Failed to search wells',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}