/**
 * Bulk Upload Handlers
 * 
 * Handles bulk validation and upload of properties and wells with normalization
 */

import { 
  BASE_ID,
  PROPERTIES_TABLE,
  WELLS_TABLE,
  PLAN_LIMITS,
  MAX_NOTES_LENGTH
} from '../constants.js';

import { 
  jsonResponse 
} from '../utils/responses.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import {
  getUserById,
  countUserProperties,
  countUserWells,
  fetchUserProperties,
  fetchUserWells
} from '../services/airtable.js';

import {
  fetchWellDetailsFromOCC,
  lookupCompletionData
} from './wells.js';

import { findOperatorByName } from '../services/operators.js';

import type { Env } from '../types/env.js';

// Normalization Helper Functions

function normalizeSectionNumber(value: any): number | null {
  if (!value) return null;
  
  // Convert to string and clean
  let str = String(value).trim().toUpperCase();
  
  // Remove common prefixes
  str = str.replace(/^(S|SEC|SECTION)\s*/i, '');
  
  // Extract just the number
  const match = str.match(/(\d+)/);
  if (!match) return null;
  
  const num = parseInt(match[1], 10);
  
  // Validate range (1-36 for sections)
  if (num >= 1 && num <= 36) {
    return num;
  }
  
  return null;
}

function normalizeTownship(value: any): string | null {
  if (!value) return null;
  
  let str = String(value).trim().toUpperCase();
  
  // Remove prefixes
  str = str.replace(/^(T|TOWN|TOWNSHIP)\s*/i, '');
  
  // Remove spaces
  str = str.replace(/\s+/g, '');
  
  // Must be digits followed by N or S
  if (!/^\d+[NS]$/i.test(str)) {
    return null;
  }
  
  // Normalize to uppercase
  return str.toUpperCase();
}

function normalizeRange(value: any): string | null {
  if (!value) return null;
  
  let str = String(value).trim().toUpperCase();
  
  // Remove prefixes
  str = str.replace(/^(R|RANGE)\s*/i, '');
  
  // Remove spaces
  str = str.replace(/\s+/g, '');
  
  // Must be digits followed by E or W
  if (!/^\d+[EW]$/i.test(str)) {
    return null;
  }
  
  // Normalize to uppercase
  return str.toUpperCase();
}

function normalizeMeridian(value: any, county?: string): string {
  // If value is provided and valid, use it
  if (value) {
    const str = String(value).trim().toUpperCase();
    
    // Indian Meridian
    if (str.match(/^(IM|I|INDIAN)/i)) {
      return "IM";
    }
    
    // Cimarron Meridian
    if (str.match(/^(CM|C|CIMARRON)/i)) {
      return "CM";
    }
  }
  
  // Smart default based on county
  const panhandleCounties = ['Cimarron', 'Texas', 'Beaver'];
  if (county && panhandleCounties.includes(county)) {
    return "CM";
  }
  
  // Default to Indian Meridian
  return "IM";
}

function normalizeCounty(value: any): string {
  if (!value) return "";
  
  const str = String(value).trim();
  
  // Capitalize first letter of each word
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function normalizePropertyData(prop: any) {
  let notes = prop.NOTES || prop.Notes || prop.Note || prop.Comments || prop.Comment || "";
  // Truncate notes to prevent abuse
  if (notes.length > MAX_NOTES_LENGTH) {
    notes = notes.substring(0, MAX_NOTES_LENGTH);
  }
  
  // Handle acreage - if no RI/WI specified but Total Acres exists, default to RI
  let riAcres = parseFloat(
    prop['RI Acres'] || prop.RI_Acres || prop.RIAcres || 
    prop['RI'] || prop.RI || prop.ri ||
    prop['PROD RI'] || prop.PROD_RI || prop['Prod RI'] || '0'
  ) || 0;
  let wiAcres = parseFloat(
    prop['WI Acres'] || prop.WI_Acres || prop.WIAcres || 
    prop['WI'] || prop.WI || prop.wi ||
    prop['PROD WI'] || prop.PROD_WI || prop['Prod WI'] || '0'
  ) || 0;
  
  // If neither RI nor WI specified, but Total Acres exists, assume it's all RI
  if (riAcres === 0 && wiAcres === 0) {
    const totalAcres = parseFloat(
      prop['Total Acres'] || prop.Total_Acres || prop.TotalAcres || 
      prop.Acres || prop.acres || '0'
    ) || 0;
    if (totalAcres > 0) {
      riAcres = totalAcres; // Default to RI interest
    }
  }

  // Handle Group/Entity field
  const group = prop.Group || prop.GROUP || prop.Entity || prop.ENTITY || 
               prop.group || prop.entity || "";

  // Normalize county first so we can use it for meridian detection
  const county = normalizeCounty(prop.COUNTY || prop.County || prop.Co || prop.C);
  
  return {
    SEC: normalizeSectionNumber(prop.SEC || prop.Section || prop.Sec || prop.S),
    TWN: normalizeTownship(prop.TWN || prop.Township || prop.Town || prop.T),
    RNG: normalizeRange(prop.RNG || prop.Range || prop.R),
    MERIDIAN: normalizeMeridian(prop.MERIDIAN || prop.Meridian || prop.MER || prop.Mer || prop.M, county),
    COUNTY: county,
    GROUP: group,
    NOTES: notes,
    'RI Acres': riAcres,
    'WI Acres': wiAcres
  };
}

// Validation Helper Functions

function validateTownship(value: string): boolean {
  if (!value) return false;
  return /^\d+[NS]$/i.test(value);
}

function validateRange(value: string): boolean {
  if (!value) return false;
  return /^\d+[EW]$/i.test(value);
}

/**
 * Validate properties from bulk upload
 * @param request The incoming request with properties array
 * @param env Worker environment
 * @returns JSON response with validation results
 */
export async function handleBulkValidateProperties(request: Request, env: Env) {
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
  const results = properties.map((prop: any, index: number) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    
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

/**
 * Upload validated properties in bulk
 * @param request The incoming request with validated properties
 * @param env Worker environment
 * @returns JSON response with upload results
 */
export async function handleBulkUploadProperties(request: Request, env: Env) {
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
  const userOrganization = userRecord?.fields.Organization?.[0]; // Get user's organization if they have one
  
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
  const toCreate = properties.filter((prop: any) => {
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
        records: batch.map((prop: any) => {
          const fields: any = {
            User: [user.id],
            SEC: String(prop.SEC).padStart(2, '0'),
            TWN: prop.TWN,
            RNG: prop.RNG,
            MERIDIAN: prop.MERIDIAN,
            COUNTY: prop.COUNTY || "",
            Group: prop.GROUP || "",
            "Monitor Adjacent": true,
            Status: "Active",
            Notes: prop.NOTES || "",
            "RI Acres": prop['RI Acres'] || 0,
            "WI Acres": prop['WI Acres'] || 0
          };
          
          // Add organization if user has one
          if (userOrganization) {
            fields.Organization = [userOrganization];
          }
          
          return { fields };
        })
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
    // Increased delay for larger imports to avoid rate limits
    if (i + batchSize < toCreate.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`Bulk upload complete: ${results.successful} created, ${results.failed} failed, ${results.skipped} skipped`);
  
  return jsonResponse({
    success: true,
    results
  });
}

/**
 * Search wells in D1 database using CSV row data
 * @param rowData CSV row data with well information
 * @param env Worker environment
 * @returns Search results with match count and details
 */
async function searchWellsByCSVData(rowData: any, env: Env): Promise<{
  matches: any[];
  total: number;
  truncated: boolean;
}> {
  if (!env.WELLS_DB) {
    return { matches: [], total: 0, truncated: false };
  }

  // Extract search criteria from various possible column names
  const wellName = rowData['Well Name'] || rowData['well_name'] || rowData.WellName || 
                   rowData.wellName || rowData.WELL_NAME || rowData.Well_Name || rowData.Name || rowData.name || '';
  const wellNumber = rowData['Well Number'] || rowData['well_number'] || rowData.WellNumber || 
                     rowData.wellNumber || rowData.WELL_NUM || rowData['Well Num'] || rowData.Well_Num || rowData.well_num || '';
  const operator = rowData.Operator || rowData.operator || rowData.OPERATOR || '';
  const section = rowData.Section || rowData.section || rowData.SECTION || rowData.SEC || rowData.sec || '';
  const township = rowData.Township || rowData.township || rowData.TOWNSHIP || rowData.TWN || rowData.twn || '';
  const range = rowData.Range || rowData.range || rowData.RANGE || rowData.RNG || rowData.rng || '';
  const county = rowData.County || rowData.county || rowData.COUNTY || '';
  
  // Combine well name and number if both exist
  const fullWellName = wellNumber ? `${wellName} ${wellNumber}`.trim() : wellName;
  
  // Debug logging
  console.log('[SearchWells] Extracted fields:', { wellName, wellNumber, fullWellName, operator, section, township, range, county });
  console.log('[SearchWells] Raw row data keys:', Object.keys(rowData));
  console.log('[SearchWells] Well name construction:', `"${wellName}" + "${wellNumber}" = "${fullWellName}"`);
  console.log('[SearchWells] Sample raw data:', JSON.stringify(rowData).substring(0, 200));

  // Build search conditions
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (fullWellName) {
    // Search for well name - D1 has separate well_name and well_number columns
    // Try multiple strategies:
    // 1. Concatenated columns match full name
    // 2. Just well_name matches (for cases where well_number might be different)
    // 3. Well name and number as separate conditions
    if (wellNumber) {
      // We have both name and number - search more precisely
      // Also handle cases where section number is part of well name (e.g., "RIBEYE 33")
      const wellNameWithoutSection = wellName.replace(/\s+\d{1,2}$/, '').trim(); // Remove trailing section number
      conditions.push(`(
        UPPER(well_name || ' ' || well_number) LIKE UPPER(?) OR
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?) OR
        (UPPER(well_name) LIKE UPPER(?) AND UPPER(well_number) LIKE UPPER(?)) OR
        (UPPER(well_name) LIKE UPPER(?) AND UPPER(well_number) LIKE UPPER(?))
      )`);
      params.push(
        `%${fullWellName}%`, 
        `%${fullWellName}%`, 
        `%${wellName}%`, 
        `%${wellNumber}%`,
        `%${wellNameWithoutSection}%`,  // Try without section number
        `%${wellNumber}%`
      );
    } else {
      // Just well name, no number
      conditions.push(`UPPER(well_name) LIKE UPPER(?)`);
      params.push(`%${wellName}%`);
    }
  }
  
  if (operator) {
    conditions.push(`(UPPER(w.operator) LIKE UPPER(?))`);
    params.push(`%${operator}%`);
  }

  if (section && township && range) {
    // Normalize township/range with proper padding for D1 format
    // D1 stores as '05N', '09W' with leading zeros
    let normalizedTownship = township.toUpperCase();
    let normalizedRange = range.toUpperCase();
    
    // Add direction if missing (default N for township, W for range)
    if (normalizedTownship.match(/^\d+$/)) {
      normalizedTownship = `${normalizedTownship}N`;
    }
    if (normalizedRange.match(/^\d+$/)) {
      normalizedRange = `${normalizedRange}W`;
    }
    
    // Pad single digits with leading zero: '5N' → '05N', '24N' → '24N'
    normalizedTownship = normalizedTownship.replace(/^(\d)([NS])$/i, '0$1$2');
    normalizedRange = normalizedRange.replace(/^(\d)([EW])$/i, '0$1$2');
    
    // Determine meridian based on county
    const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
    const meridian = county && panhandleCounties.includes(county.toUpperCase()) ? 'CM' : 'IM';
    
    // Try multiple section formats: numeric, string, and padded
    const sectionNum = parseInt(section);
    const sectionPadded = section.toString().padStart(2, '0');
    conditions.push(`((section = ? OR section = ? OR section = ?) AND township = ? AND range = ? AND meridian = ?)`);
    params.push(sectionNum, section.toString(), sectionPadded, normalizedTownship, normalizedRange, meridian);
  }

  if (county) {
    conditions.push(`UPPER(county) LIKE UPPER(?)`);
    params.push(`%${county}%`);
  }

  if (conditions.length === 0) {
    return { matches: [], total: 0, truncated: false };
  }

  // Use OR logic if only name/operator provided, AND logic if location provided
  const hasLocation = section && township && range;
  const hasNameOrOperator = fullWellName || operator;
  
  // For CSV import, we want to be more restrictive to avoid too many matches
  // If we have well name AND location, require BOTH
  // If we have well name AND operator, require BOTH
  let whereClause: string;
  
  // Count what types of criteria we have
  const hasWellNameSearch = fullWellName ? 1 : 0;
  const hasOperatorSearch = operator ? 1 : 0;
  const hasLocationSearch = (section && township && range) ? 1 : 0;
  const hasCountySearch = county ? 1 : 0;
  
  const totalCriteria = hasWellNameSearch + hasOperatorSearch + hasLocationSearch + hasCountySearch;
  
  // If we have multiple types of criteria, use AND between them
  if (totalCriteria > 1) {
    // Multiple criteria types - require all to match
    whereClause = conditions.join(' AND ');
  } else {
    // Single criterion type - just use that condition
    // Note: Each condition already has its own OR logic internally if needed
    whereClause = conditions.join(' AND ');
  }
  
  console.log('[SearchWells] Has location:', hasLocation, 'Has name/operator:', hasNameOrOperator);
  console.log('[SearchWells] Query conditions:', conditions);
  console.log('[SearchWells] Query params:', params);
  console.log('[SearchWells] Where clause:', whereClause);
  console.log('[SearchWells] Total criteria types:', totalCriteria);
  
  // Debug: Try to find any well with the name
  if (wellName && !operator && !section) {
    try {
      const debugQuery = `SELECT api_number, well_name, well_number, well_name || ' ' || COALESCE(well_number, '') as combined_name FROM wells WHERE UPPER(well_name) LIKE UPPER(?) OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?) LIMIT 3`;
      const debugResults = await env.WELLS_DB.prepare(debugQuery)
        .bind(`%${wellName}%`, `%${fullWellName}%`)
        .all();
      console.log(`[SearchWells] Debug query for "${wellName}" (full: "${fullWellName}") found:`, debugResults.results);
    } catch (e) {
      console.error('[SearchWells] Debug query failed:', e);
    }
  }
  
  // First get count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM wells w
    WHERE ${whereClause}
  `;
  
  const countResult = await env.WELLS_DB.prepare(countQuery)
    .bind(...params)
    .first<{ total: number }>();
  
  const total = countResult?.total || 0;
  
  // Get results (limit to 10 for CSV matching)
  const query = `
    SELECT 
      w.api_number,
      w.well_name,
      w.well_number,
      w.operator,
      w.operator as operator_display,
      w.section,
      w.township,
      w.range as range,
      w.meridian,
      w.county,
      w.well_status,
      w.well_type,
      w.formation_name,
      w.measured_total_depth,
      w.true_vertical_depth
    FROM wells w
    WHERE ${whereClause}
    ORDER BY w.well_status = 'AC' DESC, w.api_number DESC
    LIMIT 10
  `;

  let results = await env.WELLS_DB.prepare(query)
    .bind(...params)
    .all();

  // If no results and we had multiple criteria, try a fallback search with just location
  if (results.results.length === 0 && totalCriteria > 1 && hasLocationSearch) {
    console.log('[SearchWells] No results with full criteria, trying location-only fallback');
    
    // Build location-only query
    const fallbackConditions: string[] = [];
    const fallbackParams: (string | number)[] = [];
    
    if (section && township && range) {
      const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
      const meridian = county && panhandleCounties.includes(county.toUpperCase()) ? 'CM' : 'IM';
      const sectionNum = parseInt(section);
      const sectionPadded = section.toString().padStart(2, '0');
      
      // Get normalized township/range from above
      let normalizedTownship = township.toUpperCase();
      let normalizedRange = range.toUpperCase();
      if (normalizedTownship.match(/^\d+$/)) normalizedTownship = `${normalizedTownship}N`;
      if (normalizedRange.match(/^\d+$/)) normalizedRange = `${normalizedRange}W`;
      normalizedTownship = normalizedTownship.replace(/^(\d)([NS])$/i, '0$1$2');
      normalizedRange = normalizedRange.replace(/^(\d)([EW])$/i, '0$1$2');
      
      fallbackConditions.push(`((section = ? OR section = ? OR section = ?) AND township = ? AND range = ? AND meridian = ?)`);
      fallbackParams.push(sectionNum, section.toString(), sectionPadded, normalizedTownship, normalizedRange, meridian);
    }
    
    if (county) {
      fallbackConditions.push(`UPPER(county) LIKE UPPER(?)`);
      fallbackParams.push(`%${county}%`);
    }
    
    if (fallbackConditions.length > 0) {
      const fallbackWhereClause = fallbackConditions.join(' AND ');
      const fallbackQuery = `
        SELECT 
          w.api_number,
          w.well_name,
          w.well_number,
          w.operator,
          w.operator as operator_display,
          w.section,
          w.township,
          w.range as range,
          w.meridian,
          w.county,
          w.well_status,
          w.well_type,
          w.formation_name,
          w.measured_total_depth,
          w.true_vertical_depth
        FROM wells w
        WHERE ${fallbackWhereClause}
        ORDER BY w.well_status = 'AC' DESC, w.api_number DESC
        LIMIT 10
      `;
      
      const fallbackResults = await env.WELLS_DB.prepare(fallbackQuery)
        .bind(...fallbackParams)
        .all();
      
      if (fallbackResults.results.length > 0) {
        console.log(`[SearchWells] Fallback search found ${fallbackResults.results.length} wells by location`);
        results = fallbackResults;
        // Recount with location-only query
        const fallbackCountQuery = `SELECT COUNT(*) as total FROM wells w WHERE ${fallbackWhereClause}`;
        const fallbackCountResult = await env.WELLS_DB.prepare(fallbackCountQuery)
          .bind(...fallbackParams)
          .first<{ total: number }>();
        total = fallbackCountResult?.total || 0;
      }
    }
  }

  return {
    matches: results.results || [],
    total,
    truncated: total > 10
  };
}

/**
 * Validate wells from bulk upload with CSV search support
 * @param request The incoming request with wells array
 * @param env Worker environment
 * @returns JSON response with validation results
 */
export async function handleBulkValidateWells(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    console.error('[BulkValidateWells] Failed to parse request body:', error);
    return jsonResponse({ error: "Invalid request body" }, 400);
  }
  
  const { wells } = body; // Array of well data from CSV
  
  if (!wells || !Array.isArray(wells) || wells.length === 0) {
    return jsonResponse({ error: "No wells data provided" }, 400);
  }
  
  console.log(`[BulkValidateWells] Processing ${wells.length} wells for user ${user.email}`);
  if (wells.length > 0) {
    console.log('[BulkValidateWells] First well sample:', JSON.stringify(wells[0], null, 2).substring(0, 500));
  }

  // Limit to 2000 rows for safety
  if (wells.length > 2000) {
    return jsonResponse({ 
      error: "Too many rows. Please limit to 2000 wells per import." 
    }, 400);
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
  
  // Process each well - either validate API or search by fields
  const results = await Promise.all(wells.map(async (well: any, index: number) => {
    try {
    const errors: string[] = [];
    const warnings: string[] = [];
    let searchResults: any = null;
    let matchStatus: 'exact' | 'ambiguous' | 'not_found' | 'has_api' = 'has_api';
    
    // Check if we have a direct API number
    const rawApi = well.API || well.api || well['API Number'] || well.apiNumber || '';
    const cleanApi = String(rawApi).replace(/\D/g, '');
    
    if (cleanApi && cleanApi.length === 10 && cleanApi.startsWith('35')) {
      // Valid API provided - use it directly
      const isDuplicate = existingSet.has(cleanApi);
      if (isDuplicate) {
        warnings.push("Already tracking this well");
      }
      
      // Check for duplicate in this batch
      const batchDuplicates = wells.slice(0, index).filter((w: any) => {
        const api = String(w.API || w.api || w['API Number'] || w.apiNumber || '').replace(/\D/g, '');
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
          wellName: well['Well Name'] || well.well_name || well.WELL_NAME || well.WellName || well.wellName || well.Name || well.name || '',
          notes: well.Notes || well.notes || ''
        },
        matchStatus,
        searchResults: null,
        errors,
        warnings,
        isDuplicate,
        isValid: errors.length === 0,
        needsSelection: false
      };
    } else {
      // No valid API - search by other fields
      const hasSearchableFields = 
        well['Well Name'] || well.well_name || well.WELL_NAME || well.WellName || well.wellName || well.Name || well.name ||
        well.Operator || well.operator || well.OPERATOR ||
        (well.Section || well.section || well.SECTION) && (well.Township || well.township || well.TOWNSHIP) && (well.Range || well.range || well.RANGE) ||
        well.County || well.county || well.COUNTY;
      
      if (!hasSearchableFields) {
        errors.push("No searchable data found (need API, Well Name, Operator, or Location)");
        matchStatus = 'not_found';
      } else {
        // Search D1 database
        try {
          searchResults = await searchWellsByCSVData(well, env);
          
          if (searchResults.total === 0) {
            matchStatus = 'not_found';
            errors.push("No wells found matching the provided criteria");
          } else if (searchResults.total === 1) {
            matchStatus = 'exact';
            // Check if already tracking
            const matchedApi = searchResults.matches[0].api_number;
            if (existingSet.has(matchedApi)) {
              warnings.push("Already tracking this well");
            }
          } else if (searchResults.total <= 10) {
            matchStatus = 'ambiguous';
            warnings.push(`${searchResults.total} matches found - please select the correct well`);
            // If we only found location matches, add a note
            if (searchResults.matches.length > 0 && !searchResults.matches.some((m: any) => 
              m.well_name.toUpperCase().includes(wellName.toUpperCase()) || 
              m.operator.toUpperCase().includes(operator.toUpperCase())
            )) {
              warnings.push('Note: Matches found by location only - well name/operator may differ');
            }
          } else {
            matchStatus = 'ambiguous';
            const displayCount = searchResults.total > 1000 ? `${Math.floor(searchResults.total / 1000)}k+` : searchResults.total.toString();
            warnings.push(`Too many matches (${displayCount}) - showing first 10. Add more specific details to narrow results`);
          }
        } catch (searchError) {
          console.error(`[BulkValidateWells] D1 search error for well ${index + 1}:`, searchError);
          matchStatus = 'not_found';
          errors.push("Search failed - please try again");
        }
      }
      
      return {
        row: index + 1,
        original: well,
        normalized: matchStatus === 'exact' ? {
          apiNumber: searchResults.matches[0].api_number,
          wellName: searchResults.matches[0].well_name,
          notes: well.Notes || well.notes || ''
        } : null,
        matchStatus,
        searchResults,
        errors,
        warnings,
        isDuplicate: matchStatus === 'exact' && existingSet.has(searchResults.matches[0].api_number),
        isValid: errors.length === 0 && (matchStatus === 'exact' || matchStatus === 'ambiguous'),
        needsSelection: matchStatus === 'ambiguous'
      };
    }
    } catch (error) {
      console.error(`[BulkValidateWells] Error processing well ${index + 1}:`, error);
      return {
        row: index + 1,
        original: well,
        normalized: null,
        matchStatus: 'not_found' as const,
        searchResults: null,
        errors: [`Processing error: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: [],
        isDuplicate: false,
        isValid: false,
        needsSelection: false
      };
    }
  }));
  
  // Count matches by status
  const exactMatches = results.filter(r => r.matchStatus === 'exact' && !r.isDuplicate).length;
  const needsReview = results.filter(r => r.needsSelection).length;
  const notFound = results.filter(r => r.matchStatus === 'not_found').length;
  const hasApi = results.filter(r => r.matchStatus === 'has_api' && !r.isDuplicate).length;
  
  // Count valid non-duplicates
  const validCount = exactMatches + hasApi;
  const newWellCount = wellsCount + validCount;
  const wouldExceedLimit = newWellCount > planLimits.wells;
  
  return jsonResponse({
    results,
    summary: {
      total: wells.length,
      exactMatches,
      needsReview,
      notFound,
      hasApi,
      duplicates: results.filter(r => r.isDuplicate).length,
      willImport: validCount,
      canImport: validCount > 0 && !wouldExceedLimit
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

/**
 * Upload validated wells in bulk with OCC data enrichment
 * @param request The incoming request with validated wells
 * @param env Worker environment
 * @returns JSON response with upload results
 */
export async function handleBulkUploadWells(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  const { wells, selections } = body; // Array of validated wells + optional selections for ambiguous matches
  
  if (!wells || !Array.isArray(wells)) {
    return jsonResponse({ error: "Invalid data format" }, 400);
  }
  
  // Final validation check
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
  const userOrganization = userRecord?.fields.Organization?.[0]; // Get user's organization if they have one
  
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
  
  // Process wells based on their match status and selections
  const toCreate: any[] = [];
  
  wells.forEach((well: any, index: number) => {
    // Skip invalid or duplicate wells
    if (!well.isValid || well.isDuplicate) return;
    
    let apiNumber = '';
    let wellName = '';
    
    if (well.matchStatus === 'has_api' && well.normalized) {
      // Direct API provided
      apiNumber = well.normalized.apiNumber;
      wellName = well.normalized.wellName;
    } else if (well.matchStatus === 'exact' && well.normalized) {
      // Exact match found
      apiNumber = well.normalized.apiNumber;
      wellName = well.normalized.wellName;
    } else if (well.matchStatus === 'ambiguous' && selections && selections[index]) {
      // User selected from multiple matches
      const selectedApi = selections[index];
      const selectedMatch = well.searchResults?.matches?.find((m: any) => m.api_number === selectedApi);
      if (selectedMatch) {
        apiNumber = selectedMatch.api_number;
        wellName = selectedMatch.well_name;
      }
    }
    
    if (apiNumber && !existingSet.has(apiNumber)) {
      toCreate.push({
        apiNumber,
        wellName,
        notes: well.original.Notes || well.original.notes || ''
      });
    }
  });
  
  const results = {
    successful: 0,
    failed: 0,
    skipped: wells.length - toCreate.length,
    errors: []
  };
  
  // Fetch OCC data for each well (in parallel batches to speed up)
  const wellsWithData: any[] = [];
  const occBatchSize = 5; // Fetch 5 at a time from OCC
  
  for (let i = 0; i < toCreate.length; i += occBatchSize) {
    const occBatch = toCreate.slice(i, i + occBatchSize);
    const occPromises = occBatch.map(async (well: any) => {
      const occData = await fetchWellDetailsFromOCC(well.apiNumber, env);
      
      // Look up completion data from KV cache
      const completionData = await lookupCompletionData(well.apiNumber, env);
      
      // Look up operator information if we have an operator
      let operatorInfo = null;
      const operator = completionData?.operator || occData?.operator;
      if (operator) {
        try {
          operatorInfo = await findOperatorByName(operator, env);
        } catch (error) {
          console.warn(`[Bulk] Failed to lookup operator info for ${operator}:`, error);
        }
      }
      
      return { ...well, occData, completionData, operatorInfo };
    });
    const batchResults = await Promise.all(occPromises);
    wellsWithData.push(...batchResults);
    
    // Small delay between OCC batches
    if (i + occBatchSize < toCreate.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Helper function to generate map link - simplified version from wells.ts
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
        records: batch.map((well: any) => {
          const occ = well.occData || {};
          const completion = well.completionData || {};
          const operatorInfo = well.operatorInfo || {};
          const mapLink = occ.lat && occ.lon ? generateMapLink(occ.lat, occ.lon, occ.wellName) : '#';
          
          // Merge data with completion taking precedence
          const wellName = (well.wellName && well.wellName.includes('#')) 
            ? well.wellName 
            : (completion.wellName || occ.wellName || well.wellName || "");
          const operator = completion.operator || occ.operator || "";
          const county = completion.county || occ.county || "";
          const section = completion.surfaceSection || (occ.section ? String(occ.section) : "");
          const township = completion.surfaceTownship || occ.township || "";
          const range = completion.surfaceRange || occ.range || "";
          
          const fields: any = {
            User: [user.id],
            "API Number": well.apiNumber,
            "Well Name": wellName,
            Status: "Active",
            "OCC Map Link": mapLink,
            Operator: operator,
            County: county,
            Section: section,
            Township: township,
            Range: range,
            "Well Type": occ.wellType || "",
            "Well Status": occ.wellStatus || "",
            ...(operatorInfo.phone && { "Operator Phone": operatorInfo.phone }),
            ...(operatorInfo.contactName && { "Contact Name": operatorInfo.contactName }),
            Notes: well.notes || "",
              
              // Enhanced fields from completion data
              ...(completion.formationName && { "Formation Name": completion.formationName }),
              ...(completion.formationDepth && { "Formation Depth": completion.formationDepth }),
              ...(completion.ipGas && { "IP Gas (MCF/day)": completion.ipGas }),
              ...(completion.ipOil && { "IP Oil (BBL/day)": completion.ipOil }),
              ...(completion.ipWater && { "IP Water (BBL/day)": completion.ipWater }),
              ...(completion.pumpingFlowing && { "Pumping Flowing": completion.pumpingFlowing }),
              ...(completion.spudDate && { "Spud Date": completion.spudDate }),
              ...(completion.completionDate && { "Completion Date": completion.completionDate }),
              ...(completion.firstProdDate && { "First Production Date": completion.firstProdDate }),
              ...(completion.drillType && { "Drill Type": completion.drillType }),
              ...(completion.lateralLength && { "Lateral Length": completion.lateralLength }),
              ...(completion.totalDepth && { "Total Depth": completion.totalDepth }),
              ...(completion.bhSection && { "BH Section": completion.bhSection }),
              ...(completion.bhTownship && { "BH Township": completion.bhTownship }),
              ...(completion.bhRange && { "BH Range": completion.bhRange }),
              ...(completion && { "Data Last Updated": new Date().toISOString() })
          };
          
          // Add organization if user has one
          if (userOrganization) {
            fields.Organization = [userOrganization];
          }
          
          return { fields };
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
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`Bulk wells upload complete: ${results.successful} created, ${results.failed} failed, ${results.skipped} skipped`);
  
  return jsonResponse({
    success: true,
    results
  });
}