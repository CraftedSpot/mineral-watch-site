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
                   rowData.wellName || rowData.Name || rowData.name || '';
  const operator = rowData.Operator || rowData.operator || rowData.OPERATOR || '';
  const section = rowData.Section || rowData.section || rowData.SEC || rowData.sec || '';
  const township = rowData.Township || rowData.township || rowData.TWN || rowData.twn || '';
  const range = rowData.Range || rowData.range || rowData.RNG || rowData.rng || '';
  const county = rowData.County || rowData.county || rowData.COUNTY || '';

  // Build search conditions
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (wellName) {
    conditions.push(`UPPER(well_name) LIKE UPPER(?)`);
    params.push(`%${wellName}%`);
  }
  
  if (operator) {
    conditions.push(`(UPPER(o.operator_name) LIKE UPPER(?) OR UPPER(o.operator_alias) LIKE UPPER(?))`);
    params.push(`%${operator}%`, `%${operator}%`);
  }

  if (section && township && range) {
    // Normalize township/range
    const normalizedTownship = township.match(/^\d+$/) ? `${township}N` : township.toUpperCase();
    const normalizedRange = range.match(/^\d+$/) ? `${range}W` : range.toUpperCase();
    
    conditions.push(`(section = ? AND township = ? AND range_ = ?)`);
    params.push(parseInt(section), normalizedTownship, normalizedRange);
  }

  if (county) {
    conditions.push(`UPPER(county) LIKE UPPER(?)`);
    params.push(`%${county}%`);
  }

  if (conditions.length === 0) {
    return { matches: [], total: 0, truncated: false };
  }

  const whereClause = conditions.join(' AND ');
  
  // First get count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM wells w
    LEFT JOIN operators o ON UPPER(REPLACE(TRIM(o.operator_name), '.', '')) = UPPER(REPLACE(TRIM(w.operator), '.', ''))
    WHERE ${whereClause}
  `;
  
  const countResult = await env.WELLS_DB.prepare(countQuery)
    .bind(...params)
    .first<{ total: number }>();
  
  const total = countResult?.total || 0;
  
  // Get results (limit to 5 for CSV matching)
  const query = `
    SELECT 
      w.api_number,
      w.well_name,
      w.well_number,
      w.operator,
      COALESCE(o.operator_name, w.operator) as operator_display,
      w.section,
      w.township,
      w.range_ as range,
      w.meridian,
      w.county,
      w.well_status,
      w.well_type,
      w.formation_name,
      w.measured_total_depth,
      w.true_vertical_depth
    FROM wells w
    LEFT JOIN operators o ON UPPER(REPLACE(TRIM(o.operator_name), '.', '')) = UPPER(REPLACE(TRIM(w.operator), '.', ''))
    WHERE ${whereClause}
    ORDER BY w.well_status = 'AC' DESC, w.api_number DESC
    LIMIT 5
  `;

  const results = await env.WELLS_DB.prepare(query)
    .bind(...params)
    .all();

  return {
    matches: results.results || [],
    total,
    truncated: total > 5
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
  
  const body = await request.json();
  const { wells } = body; // Array of well data from CSV
  
  if (!wells || !Array.isArray(wells) || wells.length === 0) {
    return jsonResponse({ error: "No wells data provided" }, 400);
  }

  // Limit to 200 rows for performance
  if (wells.length > 200) {
    return jsonResponse({ 
      error: "Too many rows. Please limit to 200 wells per import." 
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
          wellName: well['Well Name'] || well.well_name || well.WellName || well.wellName || well.Name || well.name || '',
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
        well['Well Name'] || well.well_name || well.WellName || well.wellName || well.Name || well.name ||
        well.Operator || well.operator ||
        (well.Section || well.section) && (well.Township || well.township) && (well.Range || well.range) ||
        well.County || well.county;
      
      if (!hasSearchableFields) {
        errors.push("No searchable data found (need API, Well Name, Operator, or Location)");
        matchStatus = 'not_found';
      } else {
        // Search D1 database
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
        } else if (searchResults.total <= 5) {
          matchStatus = 'ambiguous';
          warnings.push(`${searchResults.total} matches found - please select the correct well`);
        } else {
          matchStatus = 'ambiguous';
          warnings.push(`Too many matches (${searchResults.total}) - add more details to narrow results`);
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
  
  // Filter out duplicates and invalid
  const toCreate = wells.filter((well: any) => {
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