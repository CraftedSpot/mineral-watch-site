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
  MAX_NOTES_LENGTH,
  getPlanLimits
} from '../constants.js';

import { 
  jsonResponse 
} from '../utils/responses.js';

import {
  authenticateRequest,
  isSuperAdmin
} from '../utils/auth.js';

import {
  getUserByIdD1First,
  countUserProperties,
  countUserPropertiesD1,
  countUserWells,
  countUserWellsD1,
  fetchUserWells,
  fetchUserWellsD1
} from '../services/airtable.js';

// fetchWellDetailsFromOCC still needed for validation (checking well exists)
// lookupCompletionData and findOperatorByName no longer needed - D1 is source for metadata
import {
  fetchWellDetailsFromOCC
} from './wells.js';

import { runFullPropertyWellMatching } from '../utils/property-well-matching.js';

import type { Env } from '../types/env.js';

// ============================================================================
// Super Admin: Upload on behalf of another user/org
// ============================================================================

interface UploadContext {
  /** Airtable user record ID to attribute ownership to */
  targetUserId: string;
  /** Airtable org record ID (if any) */
  targetOrgId: string | undefined;
  /** Email for duplicate checking / logging */
  targetEmail: string;
  /** Plan name for limit checks */
  plan: string;
  /** Plan limits */
  planLimits: { properties: number; wells: number };
  /** True if admin is acting on behalf of another user */
  isAdminOverride: boolean;
}

/**
 * Resolve the upload context — either the session user's own, or a target user
 * if the caller is a super admin with ?target_user_id=recXXX
 */
async function resolveUploadContext(
  request: Request,
  sessionUser: any,
  env: Env
): Promise<UploadContext | Response> {
  const url = new URL(request.url);
  const targetUserId = url.searchParams.get('target_user_id');

  // If already impersonating via ?act_as=, treat as admin override
  if (sessionUser.impersonating) {
    const userRecord = await getUserByIdD1First(env, sessionUser.id);
    const plan = userRecord?.fields.Plan || 'Free';
    console.log(`[AdminOverride] Impersonation mode: ${sessionUser.impersonating.adminEmail} acting as ${sessionUser.email} (${sessionUser.id})`);
    return {
      targetUserId: sessionUser.id,
      targetOrgId: userRecord?.fields.Organization?.[0],
      targetEmail: sessionUser.email,
      plan,
      planLimits: getPlanLimits(plan),
      isAdminOverride: true
    };
  }

  // No override requested — use session user's context
  if (!targetUserId) {
    const userRecord = await getUserByIdD1First(env, sessionUser.id);
    const plan = userRecord?.fields.Plan || 'Free';
    return {
      targetUserId: sessionUser.id,
      targetOrgId: userRecord?.fields.Organization?.[0],
      targetEmail: sessionUser.email,
      plan,
      planLimits: getPlanLimits(plan),
      isAdminOverride: false
    };
  }

  // Override requested — verify super admin
  if (!isSuperAdmin(sessionUser.email)) {
    return jsonResponse({ error: 'Admin access required for target_user_id' }, 403);
  }

  // Look up the target user
  const targetRecord = await getUserByIdD1First(env, targetUserId);
  if (!targetRecord) {
    return jsonResponse({ error: `Target user ${targetUserId} not found` }, 404);
  }

  const plan = targetRecord.fields.Plan || 'Free';
  console.log(`[AdminOverride] ${sessionUser.email} acting as user ${targetRecord.fields.Email} (${targetUserId}), org: ${targetRecord.fields.Organization?.[0] || 'none'}`);

  return {
    targetUserId,
    targetOrgId: targetRecord.fields.Organization?.[0],
    targetEmail: targetRecord.fields.Email,
    plan,
    planLimits: getPlanLimits(plan),
    isAdminOverride: true
  };
}

// ============================================================================
// Flexible Column Mapping
// Handles messy enterprise CSV headers (typos, inconsistent naming, etc.)
// ============================================================================

const PROPERTY_CODE_ALIASES = [
  'property_code', 'Prperty_code', 'prop_code', 'PropertyCode', 'Prop Code',
  'Code', 'Property Code', 'PROPERTY_CODE', 'Prop_Code'
];
const INTEREST_ALIASES = [
  'Interest', 'interest', 'RI_Decimal', 'ri_decimal', 'NRI', 'Decimal',
  'RI Decimal', 'Net Revenue Interest', 'NRI Decimal'
];
const TOTAL_ACRES_ALIASES = [
  'Total Acres', 'Total_Acres', 'TotalAcres', 'Total', 'total_acres'
];

// Well-specific enterprise column aliases
const WELL_CODE_ALIASES = [
  'well_code', 'Well #', 'Well Number', 'WellCode', 'Well_Number',
  'WELL_CODE', 'Well Code', 'Well#'
];
const WI_NRI_ALIASES = [
  'wi_nri', 'WI NRI', 'WI_NRI', 'WINRI', 'WI', 'Working Interest NRI',
  'WI Decimal', 'wi nri'
];
const RI_NRI_ALIASES = [
  'ri_nri', 'RI NRI', 'RI_NRI', 'RINRI', 'RI', 'Royalty Interest NRI',
  'RI Decimal', 'ri nri'
];
const ORRI_NRI_ALIASES = [
  'orri_nri', 'ORRI NRI', 'ORRI_NRI', 'ORRINRI', 'ORRI', 'ORRI  NRI',
  'Override NRI', 'Overriding Royalty NRI', 'orri nri'
];
const PUN_ALIASES = [
  'PUN', 'pun', 'Prod Unit', 'Production Unit', 'Production Unit Number',
  'PROD_UNIT', 'ProdUnit', 'prod_unit_no', 'OTC PUN', 'Unit Number',
  'Prod Unit No', 'PUN Number', 'PUN#', 'PUN #'
];

// API number column aliases — used by findField() for flexible detection
const API_ALIASES = [
  'API', 'api', 'API Number', 'API #', 'apiNumber', 'API_Number', 'Api Number',
  'Api', 'Matched API', 'API_NUMBER', 'API_NO', 'Api #', 'API No',
  'api_number', 'Api_Number', 'OCC API', 'Well API'
];

// Well name column aliases
const WELL_NAME_ALIASES = [
  'Well Name', 'WELL_NAME', 'Well_Name', 'well_name', 'WellName', 'wellName',
  'Name', 'name', 'WELL Name & Number', 'Well Name & Number',
  'HHD Well Name', 'Well_name', 'WELLNAME'
];

// Well number column aliases (separate from well name)
const WELL_NUMBER_ALIASES = [
  'WELL_NUM', 'Well_Num', 'WELL_NUMBER', 'Well Number', 'well_number',
  'WellNumber', 'wellNumber', 'well_num', 'HHD Well #', 'Well #', 'Well#',
  'WELL_NO', 'Well No'
];

/**
 * Find a field value from a row using a list of possible column name aliases.
 * Tries exact match, case-insensitive match, then fuzzy match (collapsed spaces/underscores).
 */
function findField(row: any, aliases: string[]): any {
  for (const alias of aliases) {
    // Exact match
    if (row[alias] !== undefined) return row[alias];
    // Case-insensitive match
    const key = Object.keys(row).find(k => k.trim().toLowerCase() === alias.toLowerCase());
    if (key) return row[key];
    // Fuzzy match: collapse spaces/underscores
    const normalized = alias.replace(/[\s_]+/g, '').toLowerCase();
    const fuzzyKey = Object.keys(row).find(k =>
      k.trim().replace(/[\s_]+/g, '').toLowerCase() === normalized
    );
    if (fuzzyKey) return row[fuzzyKey];
  }
  return undefined;
}

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

// Oklahoma county abbreviations used by enterprise systems (e.g., HHD)
const COUNTY_ABBREVIATIONS: Record<string, string> = {
  'ALFA': 'Alfalfa',
  'ATOKA': 'Atoka',
  'BEAV': 'Beaver',
  'BECK': 'Beckham',
  'BLAI': 'Blaine',
  'BRYA': 'Bryan',
  'CADD': 'Caddo',
  'CANA': 'Canadian',
  'CART': 'Carter',
  'CHER': 'Cherokee',
  'CHOC': 'Choctaw',
  'CIMA': 'Cimarron',
  'CLEV': 'Cleveland',
  'COAL': 'Coal',
  'COMA': 'Comanche',
  'COTT': 'Cotton',
  'CRAI': 'Craig',
  'CREE': 'Creek',
  'CUST': 'Custer',
  'DELA': 'Delaware',
  'DEWE': 'Dewey',
  'ELLI': 'Ellis',
  'GARF': 'Garfield',
  'GARV': 'Garvin',
  'GRAD': 'Grady',
  'GRAN': 'Grant',
  'GREE': 'Greer',
  'HARM': 'Harmon',
  'HARP': 'Harper',
  'HASK': 'Haskell',
  'HUGH': 'Hughes',
  'JACK': 'Jackson',
  'JEFF': 'Jefferson',
  'JOHN': 'Johnston',
  'KAY': 'Kay',
  'KING': 'Kingfisher',
  'KIOW': 'Kiowa',
  'LATI': 'Latimer',
  'LEFL': 'LeFlore',
  'LINC': 'Lincoln',
  'LOGA': 'Logan',
  'LOVE': 'Love',
  'MAJO': 'Major',
  'MARS': 'Marshall',
  'MAYES': 'Mayes',
  'MCCL': 'McClain',
  'MCCU': 'McCurtain',
  'MCIN': 'McIntosh',
  'MURR': 'Murray',
  'MUSK': 'Muskogee',
  'NOBL': 'Noble',
  'NOWA': 'Nowata',
  'OKFU': 'Okfuskee',
  'OKLA': 'Oklahoma',
  'OKMU': 'Okmulgee',
  'OSAG': 'Osage',
  'OTTA': 'Ottawa',
  'PAWN': 'Pawnee',
  'PAYN': 'Payne',
  'PITT': 'Pittsburg',
  'PONT': 'Pontotoc',
  'POTT': 'Pottawatomie',
  'PUSH': 'Pushmataha',
  'ROGM': 'Roger Mills',
  'ROGE': 'Rogers',
  'SEMI': 'Seminole',
  'SEQU': 'Sequoyah',
  'STEP': 'Stephens',
  'TEXA': 'Texas',
  'TILL': 'Tillman',
  'TULS': 'Tulsa',
  'WAGO': 'Wagoner',
  'WASH': 'Washita',
  'WASHI': 'Washington',
  'WOOD': 'Woodward',
  'WOODS': 'Woods',
  'WODW': 'Woodward',
  // Additional HHD abbreviation variants
  'ATOK': 'Atoka',
  'WAST': 'Washita',
  'WOOW': 'Woodward',
  // Out-of-state abbreviations (for multi-state operators)
  'MCKE': 'McKenzie',    // North Dakota
  'REEV': 'Reeves',      // Texas
};

function normalizeCounty(value: any): string {
  if (!value) return "";

  const str = String(value).trim();
  const upper = str.toUpperCase();

  // Check abbreviation map first
  if (COUNTY_ABBREVIATIONS[upper]) {
    return COUNTY_ABBREVIATIONS[upper];
  }

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
  
  // Enterprise fields via flexible column mapping
  const propertyCode = findField(prop, PROPERTY_CODE_ALIASES) || null;
  const riDecimalRaw = findField(prop, INTEREST_ALIASES);
  const riDecimal = riDecimalRaw !== undefined ? parseFloat(riDecimalRaw) || null : null;
  const totalAcresField = findField(prop, TOTAL_ACRES_ALIASES);
  const totalAcres = totalAcresField !== undefined ? parseFloat(totalAcresField) || null : null;

  return {
    SEC: normalizeSectionNumber(prop.SEC || prop.Section || prop.Sec || prop.S),
    TWN: normalizeTownship(prop.TWN || prop.Township || prop.Town || prop.T),
    RNG: normalizeRange(prop.RNG || prop.Range || prop.R),
    MERIDIAN: normalizeMeridian(prop.MERIDIAN || prop.Meridian || prop.MER || prop.Mer || prop.M, county),
    COUNTY: county,
    GROUP: group,
    NOTES: notes,
    'RI Acres': riAcres,
    'WI Acres': wiAcres,
    // Enterprise fields
    property_code: propertyCode ? String(propertyCode).trim() : null,
    ri_decimal: riDecimal,
    total_acres: totalAcres
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
  
  // Get user's plan limits (impersonation-aware: authenticateRequest already resolved target user)
  const userRecord = await getUserByIdD1First(env, user.id);
  const organizationId = userRecord?.fields.Organization?.[0];

  // Get user's current properties for duplicate checking (from D1, includes property_code)
  let existingRows: any[];
  if (organizationId) {
    const stmt = env.WELLS_DB.prepare(
      `SELECT section, township, range, meridian, group_name, property_code FROM properties WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
    );
    existingRows = (await stmt.bind(organizationId, organizationId).all()).results || [];
  } else {
    const stmt = env.WELLS_DB.prepare(
      `SELECT section, township, range, meridian, group_name, property_code FROM properties WHERE user_id = ?`
    );
    existingRows = (await stmt.bind(user.id).all()).results || [];
  }
  // D1 stores section as zero-padded string ("01"), normalized SEC is a number (1)
  // Parse section to int so keys match the validation output
  const existingSet = new Set(
    existingRows.map((p: any) =>
      `${parseInt(p.section, 10) || p.section}-${p.township}-${p.range}-${p.meridian || 'IM'}-${p.group_name || ''}-${p.property_code || ''}`
    )
  );
  const rawPlan = userRecord?.fields.Plan || "Free";
  const plan = rawPlan;
  const planLimits = getPlanLimits(rawPlan);
  const isAdminOverride = !!(user as any).impersonating;

  const propertiesCount = await countUserPropertiesD1(env, user.id, organizationId);
  const currentPropertyCount = propertiesCount;

  // Track keys seen within this batch for intra-batch duplicate detection
  const seenInBatch = new Map<string, number>(); // key → first row index

  // Validate each property
  const results = properties.map((prop: any, index: number) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Skip completely empty rows (no property_code, no section, no county)
    const rawCode = findField(prop, PROPERTY_CODE_ALIASES);
    const rawSec = prop.SEC || prop.Section || prop.Sec || prop.S || '';
    const rawCounty = prop.COUNTY || prop.County || prop.Co || prop.C || '';
    if (!String(rawCode || '').trim() && !String(rawSec).trim() && !String(rawCounty).trim()) {
      return {
        index,
        original: prop,
        normalized: null,
        errors: [],
        warnings: [],
        isDuplicate: false,
        isValid: false,
        isEmpty: true
      };
    }

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

    // Check for duplicates (existing properties + within this batch)
    // Include property_code so same section with different interests is NOT a duplicate
    const key = `${normalized.SEC}-${normalized.TWN}-${normalized.RNG}-${normalized.MERIDIAN}-${normalized.GROUP || ''}-${normalized.property_code || ''}`;
    const existsDuplicate = existingSet.has(key);
    const batchDupeRow = seenInBatch.get(key);
    const batchDuplicate = batchDupeRow !== undefined;
    const isDuplicate = existsDuplicate || batchDuplicate;

    if (!isDuplicate) {
      seenInBatch.set(key, index);
    }

    // Note: Meridian defaults intelligently based on county (CM for Panhandle, IM for others)
    // No warning needed since the smart default is correct

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
  
  // Filter out empty rows from results
  const nonEmptyResults = results.filter((r: any) => !r.isEmpty);
  const emptyCount = results.length - nonEmptyResults.length;
  if (emptyCount > 0) {
    console.log(`[BulkValidate] Skipped ${emptyCount} empty rows`);
  }

  // Count valid non-duplicates
  const validCount = nonEmptyResults.filter((r: any) => r.isValid && !r.isDuplicate).length;
  const newPropertyCount = currentPropertyCount + validCount;
  const wouldExceedLimit = isAdminOverride ? false : newPropertyCount > planLimits.properties;

  return jsonResponse({
    results: nonEmptyResults,
    summary: {
      total: nonEmptyResults.length,
      valid: nonEmptyResults.filter((r: any) => r.isValid).length,
      invalid: nonEmptyResults.filter((r: any) => !r.isValid).length,
      duplicates: nonEmptyResults.filter((r: any) => r.isDuplicate).length,
      warnings: nonEmptyResults.filter((r: any) => r.warnings.length > 0).length,
      willImport: validCount,
      emptyRowsSkipped: emptyCount
    },
    planCheck: {
      current: currentPropertyCount,
      limit: isAdminOverride ? 999999 : planLimits.properties,
      plan: isAdminOverride ? plan + ' (Admin Override)' : plan,
      afterUpload: newPropertyCount,
      wouldExceedLimit
    }
  });
}

/**
 * Upload validated properties in bulk — D1-First
 *
 * Flow: CSV → D1 (all fields, immediate) → Airtable (ownership only) → Link → Auto-match
 * D1 is the source of truth for all detail fields.
 * Airtable stores only ownership (User, Organization, minimal TRS).
 *
 * @param request The incoming request with validated properties
 * @param env Worker environment
 * @returns JSON response with upload results
 */
export async function handleBulkUploadProperties(request: Request, env: Env, ctx?: ExecutionContext) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await request.json();
  const { properties } = body; // Array of validated, normalized property objects

  if (!properties || !Array.isArray(properties)) {
    return jsonResponse({ error: "Invalid data format" }, 400);
  }

  // Resolve upload context (supports admin override via ?target_user_id=recXXX)
  const ctxResult = await resolveUploadContext(request, user, env);
  if (ctxResult instanceof Response) return ctxResult;
  const { targetUserId, targetOrgId: userOrganization, targetEmail, plan, planLimits, isAdminOverride } = ctxResult;

  const propertiesCount = await countUserPropertiesD1(env, targetUserId, userOrganization);

  // Skip plan limits for admin override
  if (!isAdminOverride && propertiesCount + properties.length > planLimits.properties) {
    return jsonResponse({
      error: `Would exceed property limit (${planLimits.properties} properties on ${plan} plan)`
    }, 403);
  }

  // Get existing properties for duplicate check (from D1, includes property_code)
  const existingOrgId = userOrganization;
  let existingRows: any[];
  if (existingOrgId) {
    const stmt = env.WELLS_DB.prepare(
      `SELECT section, township, range, meridian, group_name, property_code FROM properties WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
    );
    existingRows = (await stmt.bind(existingOrgId, existingOrgId).all()).results || [];
  } else {
    const stmt = env.WELLS_DB.prepare(
      `SELECT section, township, range, meridian, group_name, property_code FROM properties WHERE user_id = ?`
    );
    existingRows = (await stmt.bind(targetUserId).all()).results || [];
  }
  // D1 stores section as zero-padded string ("01"), normalized SEC is a number (1)
  const existingSet = new Set(
    existingRows.map((p: any) =>
      `${parseInt(p.section, 10) || p.section}-${p.township}-${p.range}-${p.meridian || 'IM'}-${p.group_name || ''}-${p.property_code || ''}`
    )
  );

  // Filter out duplicates (existing + intra-batch) and invalid
  // Include property_code so same section with different interests is NOT a duplicate
  const seenInUpload = new Set<string>();
  const toCreate = properties.filter((prop: any) => {
    const key = `${prop.SEC}-${prop.TWN}-${prop.RNG}-${prop.MERIDIAN}-${prop.GROUP || ''}-${prop.property_code || ''}`;
    if (existingSet.has(key) || seenInUpload.has(key)) return false;
    if (prop.SEC < 1 || prop.SEC > 36 || !validateTownship(prop.TWN) || !validateRange(prop.RNG)) return false;
    seenInUpload.add(key);
    return true;
  });

  console.log(`[BulkPropertyUpload] D1-first: Creating ${toCreate.length} properties for ${targetEmail}${isAdminOverride ? ` (admin: ${user.email})` : ''}`);

  const results = {
    successful: 0,
    failed: 0,
    skipped: properties.length - toCreate.length,
    errors: [] as string[]
  };

  // ====================================================================
  // STEP 1: Write ALL fields to D1 (source of truth, immediate)
  // ====================================================================
  const d1Batch = 500; // D1 batch limit
  const d1Records: Array<{ d1Id: string; prop: any }> = [];

  for (const prop of toCreate) {
    const d1Id = `prop_${crypto.randomUUID().replace(/-/g, '').substring(0, 17)}`;
    d1Records.push({ d1Id, prop });
  }

  // Insert into D1 in batches
  for (let i = 0; i < d1Records.length; i += d1Batch) {
    const chunk = d1Records.slice(i, i + d1Batch);
    try {
      const stmts = chunk.map(({ d1Id, prop }) => {
        const section = String(prop.SEC).padStart(2, '0');
        return env.WELLS_DB.prepare(`
          INSERT INTO properties (
            id, county, section, township, range, meridian,
            ri_acres, wi_acres, ri_decimal, total_acres,
            notes, group_name, property_code,
            user_id, organization_id, monitor_adjacent, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active', datetime('now'), datetime('now'))
        `).bind(
          d1Id,
          prop.COUNTY || null,
          section,
          prop.TWN,
          prop.RNG,
          prop.MERIDIAN,
          prop['RI Acres'] || 0,
          prop['WI Acres'] || 0,
          prop.ri_decimal || null,
          prop.total_acres || null,
          prop.NOTES || null,
          prop.GROUP || null,
          prop.property_code || null,
          targetUserId,
          userOrganization || null
        );
      });
      await env.WELLS_DB.batch(stmts);
      results.successful += chunk.length;
    } catch (err: any) {
      console.error(`[BulkPropertyUpload] D1 batch ${Math.floor(i / d1Batch) + 1} failed:`, err.message);
      results.failed += chunk.length;
      results.errors.push(`D1 batch ${Math.floor(i / d1Batch) + 1} failed`);
    }
  }

  console.log(`[BulkPropertyUpload] D1 writes complete: ${results.successful} created, ${results.failed} failed`);

  // ====================================================================
  // STEP 2: Create minimal Airtable records (ownership only)
  // ====================================================================
  const airtableBatchSize = 10;
  const successfulD1 = d1Records.filter((_, idx) => idx < results.successful);

  for (let i = 0; i < successfulD1.length; i += airtableBatchSize) {
    const batch = successfulD1.slice(i, i + airtableBatchSize);

    const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}`;
    try {
      const response = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          records: batch.map(({ prop }) => {
            const fields: any = {
              User: [targetUserId],
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
            if (userOrganization) {
              fields.Organization = [userOrganization];
            }
            return { fields };
          })
        })
      });

      if (response.ok) {
        const data = await response.json() as any;
        // Link D1 records to Airtable records
        const linkStmts = data.records.map((rec: any, j: number) => {
          const d1Id = batch[j].d1Id;
          return env.WELLS_DB.prepare(
            `UPDATE properties SET airtable_record_id = ? WHERE id = ?`
          ).bind(rec.id, d1Id);
        });
        if (linkStmts.length > 0) {
          await env.WELLS_DB.batch(linkStmts);
        }
      } else {
        const err = await response.text();
        console.error(`[BulkPropertyUpload] Airtable batch ${Math.floor(i / airtableBatchSize) + 1} failed:`, err);
        // D1 records still exist — they'll get linked on next sync
        results.errors.push(`Airtable batch failed (D1 records OK, will link on sync)`);
      }
    } catch (err: any) {
      console.error(`[BulkPropertyUpload] Airtable batch error:`, err.message);
      results.errors.push(`Airtable batch error`);
    }

    // Small delay between batches to avoid Airtable rate limits
    if (i + airtableBatchSize < successfulD1.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[BulkPropertyUpload] Complete: ${results.successful} D1, Airtable ownership records created`);

  // Trigger full property-well matching if any properties were created
  if (results.successful > 0 && ctx) {
    console.log('[BulkPropertyUpload] Triggering full property-well matching');

    const organizationId = userOrganization || undefined;
    const matchPromise = runFullPropertyWellMatching(targetUserId, targetEmail, organizationId, env)
      .then(result => {
        if (result.linksCreated > 0) {
          console.log(`[BulkPropertyUpload] Auto-matched: ${result.linksCreated} links`);
        }
      })
      .catch(err => {
        console.error('[BulkPropertyUpload] Background matching failed:', err.message);
      });

    ctx.waitUntil(matchPromise);
  }

  return jsonResponse({
    success: true,
    results,
    ...(isAdminOverride && { adminOverride: { targetUserId, targetEmail, actingAs: user.email } })
  });
}

/**
 * Search wells in D1 database using cascading logic with scoring
 * @param rowData CSV row data with well information
 * @param env Worker environment
 * @returns Search results with match scores and details
 */
async function searchWellsByCSVData(rowData: any, env: Env): Promise<{
  matches: any[];
  total: number;
  truncated: boolean;
}> {
  if (!env.WELLS_DB) {
    return { matches: [], total: 0, truncated: false };
  }

  // Extract search criteria using flexible column matching
  const wellName = String(findField(rowData, WELL_NAME_ALIASES) || '').trim();
  const wellNumber = String(findField(rowData, WELL_NUMBER_ALIASES) || '').trim();

  // Priority logic for well name:
  // 1. If we have separate name and number, combine them
  // 2. Otherwise use name alone
  let fullWellName = '';
  if (wellName && wellNumber) {
    fullWellName = `${wellName} ${wellNumber}`;
  } else {
    fullWellName = wellName;
  }
  
  // Clean well name: remove quotes that prevent matching
  // CSV has: FEIKES "A" UNIT, ADAMS "Q", RICHARDSON "B"
  // D1 has: FEIKES A UNIT, ADAMS Q, RICHARDSON B
  const cleanedWellName = fullWellName.replace(/["""'']/g, '').trim();

  // For fuzzy matching, extract the base well name (before well number)
  // Examples: "MCCARTHY 1506 3H-30X" -> "MCCARTHY 1506"
  // This helps match variations like "3H-30X" vs "#1H-30X"
  const wellNameParts = cleanedWellName.match(/^(.*?)\s+(\d+[A-Z]?-\d+[A-Z]?X?|\#\d+[A-Z]?-\d+[A-Z]?X?)$/i);
  let baseWellName = wellNameParts ? wellNameParts[1].trim() : cleanedWellName;
  
  // Extract other fields
  const operator = rowData.Operator || rowData.operator || rowData.OPERATOR || '';
  let section = rowData.Section || rowData.section || rowData.SECTION || rowData.SEC || rowData.sec || '';
  let township = rowData.Township || rowData.township || rowData.TOWNSHIP || rowData.TWN || rowData.twn || '';
  let range = rowData.Range || rowData.range || rowData.RANGE || rowData.RNG || rowData.rng || '';
  const county = rowData.County || rowData.county || rowData.COUNTY || '';

  // Parse combined Location field if separate TRS fields are empty
  // Handles formats like "32 12N 3E LINC OK" or "1 2 12 9N 4E POTT OK"
  if (!section && !township && !range) {
    const locationField = rowData.Location || rowData.location || rowData.LOCATION || '';
    if (locationField) {
      // Match: section(s) then township(N/S) then range(E/W)
      const locMatch = String(locationField).match(/(\d+)\s+(\d+[NS])\s+(\d+[EW])/i);
      if (locMatch) {
        section = locMatch[1];
        township = locMatch[2];
        range = locMatch[3];
      } else {
      }
    }
  }

  // Convert section to number early (needed for name variant generation and search strategies)
  const sectionNum = section ? parseInt(section, 10) : null;

  // ---- Smart name variant generation ----
  // HHD pattern: "MCNALLY 1 15" = lease name + well# + section
  // OCC pattern: "MCNALLY #1" = lease name + #well_number
  // Problem: LIKE '%MCNALLY 1 15%' won't match 'MCNALLY #1'
  // Fix: strip the section from the name, and try #-prefixed well number

  // If we parsed a section, strip it from the search name
  if (sectionNum !== null && sectionNum >= 1 && sectionNum <= 36) {
    // Strip trailing section number: "MCNALLY 1 15" → "MCNALLY 1"
    const sectionStr = String(sectionNum);
    const trailingSecPattern = new RegExp(`\\s+${sectionStr}\\s*$`);
    const stripped = cleanedWellName.replace(trailingSecPattern, '').trim();
    if (stripped !== cleanedWellName && stripped.length > 2) {
      baseWellName = stripped;
    }
  }

  // Generate #-prefixed variants: "MCNALLY 1" → "MCNALLY #1"
  // Adds # before the first standalone number that looks like a well number
  const hashVariant = baseWellName.replace(/^([A-Z\s]+?)\s+(\d+)/, '$1 #$2');
  const hasHashVariant = hashVariant !== baseWellName;

  // Normalize spaces/hyphens for LIKE matching
  // CSV has "HURST BOUGHAN" but D1 has "HURST-BOUGHAN"
  // Replace spaces and hyphens with % wildcard so LIKE matches either format
  const normalizedNamePattern = cleanedWellName.replace(/[\s-]+/g, '%');
  const finalBasePattern = baseWellName.replace(/[\s-]+/g, '%');
  const finalHashPattern = hashVariant.replace(/[\s-]+/g, '%');

  // Normalize location data — expand county abbreviation for panhandle detection
  const normalizedCounty = normalizeCounty(county);
  const panhandleCounties = ['Cimarron', 'Texas', 'Beaver'];
  const meridian = normalizedCounty && panhandleCounties.includes(normalizedCounty) ? 'CM' : 'IM';
  
  // Normalize township/range with proper padding
  let normalizedTownship = township.toUpperCase();
  let normalizedRange = range.toUpperCase();
  if (normalizedTownship && normalizedTownship.match(/^\d+$/)) {
    normalizedTownship = `${normalizedTownship}N`;
  }
  if (normalizedRange && normalizedRange.match(/^\d+$/)) {
    normalizedRange = `${normalizedRange}W`;
  }
  if (normalizedTownship) {
    normalizedTownship = normalizedTownship.replace(/^(\d)([NS])$/i, '0$1$2');
  }
  if (normalizedRange) {
    normalizedRange = normalizedRange.replace(/^(\d)([EW])$/i, '0$1$2');
  }
  
  // Check minimum search criteria
  if (!cleanedWellName && (!normalizedTownship || !normalizedRange)) {
    return { matches: [], total: 0, truncated: false };
  }

  // Try multiple search strategies in order
  let results: any = { results: [] };
  let searchStrategy = '';
  
  // Strategy 1: Name + Section + T-R (most specific)
  // Tries full name, section-stripped name, and #-prefixed variant
  if (cleanedWellName && normalizedTownship && normalizedRange && sectionNum !== null) {
    const query1 = operator ? `
      SELECT w.*,
        CASE
          WHEN UPPER(operator) LIKE UPPER(?1) THEN 100
          ELSE 90
        END as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?3)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?4)
        OR UPPER(well_name) LIKE UPPER(?5)
      )
        AND section = ?6 AND township = ?7 AND range = ?8 AND meridian = ?9
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    ` : `
      SELECT w.*, 90 as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?1)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?3)
        OR UPPER(well_name) LIKE UPPER(?4)
      )
        AND section = ?5 AND township = ?6 AND range = ?7 AND meridian = ?8
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    `;
    const params1 = operator ?
      [`%${operator}%`, `%${normalizedNamePattern}%`, `%${finalBasePattern}%`, `%${finalHashPattern}%`, `%${finalBasePattern}%`, sectionNum, normalizedTownship, normalizedRange, meridian] :
      [`%${normalizedNamePattern}%`, `%${finalBasePattern}%`, `%${finalHashPattern}%`, `%${finalBasePattern}%`, sectionNum, normalizedTownship, normalizedRange, meridian];
    
    results = await env.WELLS_DB.prepare(query1).bind(...params1).all();
    searchStrategy = 'name+section+T-R';
  }
  
  // Strategy 1.5: Exact name match statewide (for very specific well names)
  if (results.results.length === 0 && cleanedWellName && cleanedWellName.length > 10) {
    // Try to match with # added if not present
    // "MCCARTHY 1506 3H-30X" should also match "MCCARTHY 1506 #3H-30X"
    const nameWithHash = cleanedWellName.replace(/\s+(\d+[A-Z]?-\d+[A-Z]?X?)$/i, ' #$1');
    const nameWithoutHash = cleanedWellName.replace(/\s+#(\d+[A-Z]?-\d+[A-Z]?X?)$/i, ' $1');
    
    const query15 = operator ? `
      SELECT w.*, 
        CASE 
          WHEN UPPER(operator) LIKE UPPER(?1) THEN 95
          WHEN township = ?2 AND range = ?3 THEN 85
          ELSE 80
        END as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) = UPPER(?4)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) = UPPER(?5)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) = UPPER(?6)
      )
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    ` : `
      SELECT w.*, 
        CASE 
          WHEN township = ?1 AND range = ?2 THEN 85
          ELSE 80
        END as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) = UPPER(?3)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) = UPPER(?4)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) = UPPER(?5)
      )
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    `;
    
    const params15 = operator ? 
      [`%${operator}%`, normalizedTownship, normalizedRange, cleanedWellName, nameWithHash, nameWithoutHash] :
      [normalizedTownship, normalizedRange, cleanedWellName, nameWithHash, nameWithoutHash];
    
    results = await env.WELLS_DB.prepare(query15).bind(...params15).all();
    searchStrategy = 'exact-name-statewide';
  }
  
  // Strategy 1.7: Horizontal well expanded search
  // Triggers when TRS match fails AND well name has horizontal indicators
  // Searches: alternative sections from name, bottom-hole TRS, county-wide by lease name
  // Results returned as lower confidence for user review
  if (results.results.length === 0 && cleanedWellName && normalizedCounty) {
    // Detect horizontal indicators at end of name (after a digit)
    const horizMatch = cleanedWellName.match(/\d+\s*(WH|XH|MXH|CH|H)\s*$/i);
    if (horizMatch) {
      // Parse multi-section numbers from name
      // "JASMINE 1 28 33WH" → sections [28, 33]
      // "LDC 3 24/25H" → sections [24, 25]
      // "KANE #1 1/12H" → sections [1, 12]
      const altSections: number[] = [];

      // Pattern 1: "name # sec1 sec2WH" (space-separated sections)
      const spaceSections = cleanedWellName.match(/(\d+)\s+(\d+)\s*(?:WH|XH|MXH|CH|H)\s*$/i);
      if (spaceSections) {
        const s1 = parseInt(spaceSections[1], 10);
        const s2 = parseInt(spaceSections[2], 10);
        if (s1 >= 1 && s1 <= 36) altSections.push(s1);
        if (s2 >= 1 && s2 <= 36) altSections.push(s2);
      }

      // Pattern 2: "name # sec1/sec2H" (slash-separated sections)
      const slashSections = cleanedWellName.match(/(\d+)\/(\d+)\s*(?:WH|XH|MXH|CH|H)\s*$/i);
      if (slashSections) {
        const s1 = parseInt(slashSections[1], 10);
        const s2 = parseInt(slashSections[2], 10);
        if (s1 >= 1 && s1 <= 36) altSections.push(s1);
        if (s2 >= 1 && s2 <= 36) altSections.push(s2);
      }

      // Remove duplicates and exclude the section we already tried
      const uniqueAltSections = [...new Set(altSections)].filter(s => s !== sectionNum);

      // Extract lease name (everything before the well number + section pattern)
      // "JASMINE 1 28 33WH" → "JASMINE"
      // "LDC 3 24/25H" → "LDC"
      // "KANE #1 1/12H" → "KANE"
      // "HURST BOUGHAN 8 1H" → "HURST BOUGHAN" (strip trailing section number too)
      let leaseName = cleanedWellName
        .replace(/\s*#?\d+\s+\d+\s+\d+\s*(?:WH|XH|MXH|CH|H)\s*$/i, '')  // name # sec1 sec2WH
        .replace(/\s*#?\d+\s+\d+\/\d+\s*(?:WH|XH|MXH|CH|H)\s*$/i, '')   // name # sec1/sec2H
        .replace(/\s*#?\d+\s*(?:WH|XH|MXH|CH|H)\s*$/i, '')              // name #H (simple)
        .replace(/\s+\d{1,2}\s*$/, '')                                     // strip trailing section number (1-36)
        .trim();
      // Normalize spaces/hyphens in lease name for LIKE matching
      // D1 has "HURST-BOUGHAN" but CSV may have "HURST BOUGHAN"
      const leaseNamePattern = leaseName.replace(/[\s-]+/g, '%');

      const allHorizResults: any[] = [];
      const seenApis = new Set<string>();

      // 1.7a: Try TRS match with each alternative section
      if (normalizedTownship && normalizedRange) {
        for (const altSec of uniqueAltSections) {
          const q17a = `
            SELECT w.*, 75 as match_score
            FROM wells w
            WHERE (
              UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?1)
              OR UPPER(well_name) LIKE UPPER(?2)
            )
            AND section = ?3 AND township = ?4 AND range = ?5 AND meridian = ?6
            ORDER BY well_status = 'AC' DESC
            LIMIT 10
          `;
          const r17a = await env.WELLS_DB.prepare(q17a)
            .bind(`%${leaseNamePattern}%`, `%${leaseNamePattern}%`, altSec, normalizedTownship, normalizedRange, meridian).all();
          for (const row of r17a.results as any[]) {
            if (!seenApis.has(row.api_number)) {
              seenApis.add(row.api_number);
              allHorizResults.push(row);
            }
          }
        }
      }

      // 1.7b: Search by bottom-hole location matching CSV's TRS
      if (normalizedTownship && normalizedRange && sectionNum !== null) {
        const q17b = `
          SELECT w.*, 70 as match_score
          FROM wells w
          WHERE (
            UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?1)
            OR UPPER(well_name) LIKE UPPER(?2)
          )
          AND bh_section = ?3 AND bh_township = ?4 AND bh_range = ?5
          AND is_horizontal = 1
          ORDER BY well_status = 'AC' DESC
          LIMIT 10
        `;
        const r17b = await env.WELLS_DB.prepare(q17b)
          .bind(`%${leaseNamePattern}%`, `%${leaseNamePattern}%`, sectionNum, normalizedTownship, normalizedRange).all();
        for (const row of r17b.results as any[]) {
          if (!seenApis.has(row.api_number)) {
            seenApis.add(row.api_number);
            allHorizResults.push(row);
          }
        }
      }

      // 1.7c: County-wide lease name search (broadest, lowest confidence)
      if (allHorizResults.length < 5) {
        const q17c = `
          SELECT w.*,
            CASE
              WHEN section = ?1 THEN 65
              WHEN bh_section = ?1 THEN 60
              WHEN township = ?2 AND range = ?3 THEN 55
              ELSE 45
            END as match_score
          FROM wells w
          WHERE UPPER(well_name) LIKE UPPER(?4)
            AND UPPER(county) = UPPER(?5)
          ORDER BY match_score DESC, well_status = 'AC' DESC
          LIMIT 15
        `;
        const secParam = sectionNum !== null ? sectionNum : -1;
        const r17c = await env.WELLS_DB.prepare(q17c)
          .bind(secParam, normalizedTownship || '', normalizedRange || '', `%${leaseNamePattern}%`, normalizedCounty).all();
        for (const row of r17c.results as any[]) {
          if (!seenApis.has(row.api_number)) {
            seenApis.add(row.api_number);
            allHorizResults.push(row);
          }
        }
      }

      if (allHorizResults.length > 0) {
        // Sort by match_score descending, then active wells first
        allHorizResults.sort((a, b) => {
          if (b.match_score !== a.match_score) return b.match_score - a.match_score;
          if (a.well_status === 'AC' && b.well_status !== 'AC') return -1;
          if (b.well_status === 'AC' && a.well_status !== 'AC') return 1;
          return 0;
        });
        results = { results: allHorizResults.slice(0, 15) };
        searchStrategy = 'horizontal-expanded';
      }
    }
  }

  // Strategy 2: Name + T-R (no section - handles horizontal wells)
  if (results.results.length === 0 && cleanedWellName && normalizedTownship && normalizedRange) {
    // Build the query dynamically based on what we have
    let scoreConditions: string[] = [];
    let caseParams: any[] = [];
    
    if (operator && sectionNum !== null) {
      scoreConditions.push(`WHEN UPPER(operator) LIKE UPPER(?1) AND section = ?2 THEN 90`);
      scoreConditions.push(`WHEN UPPER(operator) LIKE UPPER(?1) THEN 85`);
      scoreConditions.push(`WHEN section = ?2 THEN 80`);
      caseParams = [`%${operator}%`, sectionNum];
    } else if (operator) {
      scoreConditions.push(`WHEN UPPER(operator) LIKE UPPER(?1) THEN 85`);
      caseParams = [`%${operator}%`];
    } else if (sectionNum !== null) {
      scoreConditions.push(`WHEN section = ?1 THEN 80`);
      caseParams = [sectionNum];
    }
    
    const query2 = `
      SELECT w.*, 
        CASE 
          ${scoreConditions.length > 0 ? scoreConditions.join('\n          ') : ''}
          ${scoreConditions.length > 0 ? '' : 'WHEN 1=1 THEN 70'}
          ELSE 70
        END as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?${caseParams.length + 1})
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?${caseParams.length + 2})
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?${caseParams.length + 3})
        OR UPPER(well_name) LIKE UPPER(?${caseParams.length + 4})
      )
        AND township = ?${caseParams.length + 5}
        AND range = ?${caseParams.length + 6}
        AND meridian = ?${caseParams.length + 7}
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    `;

    const params2 = [...caseParams, `%${normalizedNamePattern}%`, `%${finalBasePattern}%`, `%${finalHashPattern}%`, `%${finalBasePattern}%`, normalizedTownship, normalizedRange, meridian];
    
    results = await env.WELLS_DB.prepare(query2).bind(...params2).all();
    searchStrategy = 'name+T-R';
  }
  
  // Strategy 2b: Location + Section (when name doesn't match but we have location)
  if (results.results.length === 0 && normalizedTownship && normalizedRange && sectionNum !== null) {
    // Strategy 2b: Location + Section only (name not found)
    const query2b = `
      SELECT w.*, 
        CASE 
          WHEN ${operator ? `UPPER(operator) LIKE UPPER(?1)` : 'FALSE'} THEN 75
          ELSE 65
        END as match_score
      FROM wells w
      WHERE section = ?${operator ? 2 : 1} 
        AND township = ?${operator ? 3 : 2} 
        AND range = ?${operator ? 4 : 3} 
        AND meridian = ?${operator ? 5 : 4}
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    `;
    const params2b = operator ? 
      [`%${operator}%`, sectionNum, normalizedTownship, normalizedRange, meridian] :
      [sectionNum, normalizedTownship, normalizedRange, meridian];
    
    results = await env.WELLS_DB.prepare(query2b).bind(...params2b).all();
    searchStrategy = 'location+section-only';
  }
  
  // Strategy 3a: Name + County (narrow search when we have county but no TRS)
  if (results.results.length === 0 && cleanedWellName && normalizedCounty) {
    // Strategy 3a: Name + County
    const query3a = operator ? `
      SELECT w.*,
        CASE
          WHEN UPPER(operator) LIKE UPPER(?1) THEN 65
          ELSE 55
        END as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?3)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?4)
        OR UPPER(well_name) LIKE UPPER(?5)
      )
        AND UPPER(county) = UPPER(?6)
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    ` : `
      SELECT w.*, 55 as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?1)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?3)
        OR UPPER(well_name) LIKE UPPER(?4)
      )
        AND UPPER(county) = UPPER(?5)
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    `;
    const params3a = operator ?
      [`%${operator}%`, `%${normalizedNamePattern}%`, `%${finalBasePattern}%`, `%${finalHashPattern}%`, `%${finalBasePattern}%`, normalizedCounty] :
      [`%${normalizedNamePattern}%`, `%${finalBasePattern}%`, `%${finalHashPattern}%`, `%${finalBasePattern}%`, normalizedCounty];

    results = await env.WELLS_DB.prepare(query3a).bind(...params3a).all();
    searchStrategy = 'name+county';
  }

  // Strategy 3b: Name only (broader fallback — no county filter)
  if (results.results.length === 0 && cleanedWellName) {
    // Strategy 3b: Name only (statewide)
    const query3 = operator ? `
      SELECT w.*,
        CASE
          WHEN UPPER(operator) LIKE UPPER(?1) THEN 60
          ELSE 50
        END as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?3)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?4)
        OR UPPER(well_name) LIKE UPPER(?5)
      )
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    ` : `
      SELECT w.*, 50 as match_score
      FROM wells w
      WHERE (
        UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?1)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
        OR UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?3)
        OR UPPER(well_name) LIKE UPPER(?4)
      )
      ORDER BY match_score DESC, well_status = 'AC' DESC
      LIMIT 15
    `;
    const params3 = operator ?
      [`%${operator}%`, `%${normalizedNamePattern}%`, `%${finalBasePattern}%`, `%${finalHashPattern}%`, `%${finalBasePattern}%`] :
      [`%${normalizedNamePattern}%`, `%${finalBasePattern}%`, `%${finalHashPattern}%`, `%${finalBasePattern}%`];

    results = await env.WELLS_DB.prepare(query3).bind(...params3).all();
    searchStrategy = 'name-only';
  }
  
  // Strategy 4: Location only (LAST RESORT - only if name search failed)
  if (results.results.length === 0 && normalizedTownship && normalizedRange && !cleanedWellName) {
    // Strategy 4: Location only (no name provided)
    const query4 = `
      SELECT w.*, 30 as match_score
      FROM wells w
      WHERE township = ? AND range = ? AND meridian = ?
        ${sectionNum !== null ? 'AND section = ?' : ''}
      ORDER BY well_status = 'AC' DESC
      LIMIT 15
    `;
    const params4 = [normalizedTownship, normalizedRange, meridian];
    if (sectionNum !== null) params4.push(sectionNum);
    
    results = await env.WELLS_DB.prepare(query4).bind(...params4).all();
    searchStrategy = 'location-only';
  }
  
  // Post-process: If operator provided and multiple results, filter/prioritize operator matches
  if (operator && results.results.length > 1) {
    const operatorMatches = results.results.filter((r: any) => 
      r.operator && (
        r.operator.toUpperCase().includes(operator.toUpperCase()) ||
        operator.toUpperCase().includes(r.operator.toUpperCase())
      )
    );
    
    // If operator narrows it down to exactly 1, use only that
    if (operatorMatches.length === 1) {
      results.results = operatorMatches;
      results.results[0].match_score = 100;
    } else if (operatorMatches.length > 1) {
      // Multiple operator matches - show only those
      results.results = operatorMatches;
    } else if (operatorMatches.length === 0 && operator) {
      // No operator matches - this might indicate the well doesn't exist with this operator
    }
  }
  
  return {
    matches: results.results,
    total: results.results.length,
    truncated: results.results.length >= 15
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

  // Limit to 2000 rows for safety
  if (wells.length > 2000) {
    return jsonResponse({ 
      error: "Too many rows. Please limit to 2000 wells per import." 
    }, 400);
  }
  
  // Check plan allows wells
  const userRecord = await getUserByIdD1First(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = getPlanLimits(plan);
  const isAdminOverride = !!(user as any).impersonating;
  const validateOrgId = userRecord?.fields.Organization?.[0];

  if (planLimits.wells === 0) {
    return jsonResponse({
      error: `Your ${plan} plan does not include well monitoring. Please upgrade to add wells.`
    }, 403);
  }

  // Get user's existing wells for duplicate checking (D1 indexed query)
  const existingWells = await fetchUserWellsD1(env, user.id, validateOrgId);
  const existingSet = new Set(existingWells.map(w => w.apiNumber));

  const wellsCount = existingWells.length;
  
  // Process each well - either validate API or search by fields
  const results = await Promise.all(wells.map(async (well: any, index: number) => {
    try {
    const errors: string[] = [];
    const warnings: string[] = [];
    let searchResults: any = null;
    let matchStatus: 'exact' | 'ambiguous' | 'not_found' | 'has_api' = 'has_api';
    
    // Check if we have a direct API number (flexible column matching)
    const rawApi = findField(well, API_ALIASES) || '';
    const cleanApi = String(rawApi).replace(/\D/g, '');
    
    if (cleanApi && cleanApi.length === 10 && cleanApi.startsWith('35')) {
      // Valid API provided - use it directly
      const existsDuplicate = existingSet.has(cleanApi);
      if (existsDuplicate) {
        warnings.push("Already tracking this well");
      }

      // Check for duplicate in this batch
      const batchDuplicates = wells.slice(0, index).filter((w: any) => {
        const api = String(w.API || w.api || w['API Number'] || w['API #'] || w.apiNumber || '').replace(/\D/g, '');
        return api === cleanApi;
      });
      const batchDuplicate = batchDuplicates.length > 0;
      if (batchDuplicate) {
        warnings.push("Duplicate in this file");
      }

      const isDuplicate = existsDuplicate || batchDuplicate;

      // Combine well name and number for preview (flexible column matching)
      const wellNameField = findField(well, WELL_NAME_ALIASES) || '';
      const wellNumberField = findField(well, WELL_NUMBER_ALIASES) || '';
      const combinedWellName = wellNameField && wellNumberField
        ? `${String(wellNameField).trim()} ${String(wellNumberField).trim()}`
        : String(wellNameField || '').trim();

      return {
        row: index + 1,
        original: well,
        normalized: {
          apiNumber: cleanApi,
          wellName: combinedWellName,
          csvWellName: combinedWellName,
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
      // No valid API — check if we have a PUN to look up
      const rawPun = findField(well, PUN_ALIASES);
      const cleanPun = rawPun ? String(rawPun).trim() : '';

      if (cleanPun && env.WELLS_DB) {
        try {
          // Look up API(s) from well_pun_links table
          const punResults = await env.WELLS_DB.prepare(`
            SELECT DISTINCT wpl.api_number, w.well_name, w.well_number, w.operator, w.county, w.section, w.township, w.range, w.well_status
            FROM well_pun_links wpl
            JOIN wells w ON w.api_number = wpl.api_number
            WHERE wpl.pun = ? OR wpl.base_pun = ?
            ORDER BY w.well_status = 'AC' DESC
            LIMIT 10
          `).bind(cleanPun, cleanPun).all();

          if (punResults.results.length === 1) {
            // Single match — treat like a direct API
            const match = punResults.results[0] as any;
            const punApi = match.api_number;

            const existsDuplicate = existingSet.has(punApi);
            if (existsDuplicate) warnings.push("Already tracking this well");

            const wellNameField = findField(well, WELL_NAME_ALIASES) || '';

            return {
              row: index + 1,
              original: well,
              normalized: {
                apiNumber: punApi,
                wellName: String(wellNameField).trim() || `${match.well_name || ''} ${match.well_number || ''}`.trim(),
                csvWellName: String(wellNameField).trim(),
                notes: well.Notes || well.notes || '',
                punResolved: cleanPun
              },
              matchStatus: 'has_api' as const,
              searchResults: null,
              errors,
              warnings: [...warnings, `API resolved from PUN ${cleanPun}`],
              isDuplicate: existsDuplicate,
              isValid: errors.length === 0,
              needsSelection: false
            };
          } else if (punResults.results.length > 1) {
            const punMatches = punResults.results.map((r: any) => ({
              ...r,
              match_score: 85,
              pun_resolved: true
            }));

            return {
              row: index + 1,
              original: well,
              normalized: {
                wellName: String(findField(well, WELL_NAME_ALIASES) || '').trim(),
                csvWellName: String(findField(well, WELL_NAME_ALIASES) || '').trim(),
                notes: well.Notes || well.notes || '',
                punResolved: cleanPun
              },
              matchStatus: 'ambiguous' as const,
              searchResults: { matches: punMatches, total: punMatches.length, truncated: false },
              errors,
              warnings: [`Multiple APIs found for PUN ${cleanPun}`],
              isDuplicate: false,
              isValid: true,
              needsSelection: true
            };
          } else {
            warnings.push(`PUN ${cleanPun} not in our database yet`);
          }
        } catch (punError) {
          console.error(`[BulkValidateWells] PUN lookup error:`, punError);
        }
      }

      // No valid API and no PUN match - search by other fields
      const hasSearchableFields =
        findField(well, WELL_NAME_ALIASES) ||
        well.Operator || well.operator || well.OPERATOR ||
        (well.Section || well.section || well.SECTION) && (well.Township || well.township || well.TOWNSHIP) && (well.Range || well.range || well.RANGE) ||
        well.Location || well.location || well.LOCATION ||
        well.County || well.county || well.COUNTY;
      
      // Extract section for mismatch warnings
      const section = well.Section || well.section || well.SECTION || well.SEC || well.sec || '';
      
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
            // Single match - always exact
            matchStatus = 'exact';
            const match = searchResults.matches[0];
            
            // Check if already tracking
            const matchedApi = match.api_number;
            if (existingSet.has(matchedApi)) {
              warnings.push("Already tracking this well");
            }
          } else {
            // Multiple matches - check if operator makes it unambiguous
            const highScoreMatches = searchResults.matches.filter((m: any) => m.match_score >= 90);
            
            const csvOperator = well.Operator || well.operator || well.OPERATOR || '';
            if (highScoreMatches.length === 1 && csvOperator) {
              // Only one well matches with operator - treat as exact match
              matchStatus = 'exact';
              searchResults.matches = [highScoreMatches[0]]; // Keep only the best match
              searchResults.total = 1;
              
              const match = highScoreMatches[0];
              if (existingSet.has(match.api_number)) {
                warnings.push("Already tracking this well");
              }
            } else if (searchResults.total <= 10) {
              // Multiple matches without clear winner - needs review
              matchStatus = 'ambiguous';
              warnings.push(`${searchResults.total} matches found - please select the correct well`);
              
              // Check for section mismatches
              if (searchResults.hasSectionMismatches) {
                const mismatchedSections = searchResults.matches
                  .filter((m: any) => m.sectionMismatch)
                  .map((m: any) => m.section)
                  .filter((v: number, i: number, a: number[]) => a.indexOf(v) === i); // unique sections
                warnings.push(`Section mismatches found - Wells are in sections: ${mismatchedSections.join(', ')} (your CSV shows section ${section})`);
              }
              
              // If we only found location matches, add a note
              if (searchResults.matches.length > 0) {
                // Extract well name and operator from the original CSV data for comparison
                const csvWellName = well['Well Name'] || well['well_name'] || well.WellName || 
                                   well.wellName || well.WELL_NAME || well.Well_Name || well.Name || well.name || '';
                const csvOperator = well.Operator || well.operator || well.OPERATOR || '';
                
                if (!searchResults.matches.some((m: any) => 
                  m.well_name.toUpperCase().includes(csvWellName.toUpperCase()) || 
                  (csvOperator && m.operator.toUpperCase().includes(csvOperator.toUpperCase()))
                )) {
                  warnings.push('Note: Matches found by location only - well name/operator may differ');
                }
              }
            } else {
              matchStatus = 'ambiguous';
              const displayCount = searchResults.total > 1000 ? `${Math.floor(searchResults.total / 1000)}k+` : searchResults.total.toString();
              warnings.push(`Too many matches (${displayCount}) - showing first 10. Add more specific details to narrow results`);
            }
          }
        } catch (searchError) {
          console.error(`[BulkValidateWells] D1 search error for well ${index + 1}:`, searchError);
          matchStatus = 'not_found';
          errors.push("Search failed - please try again");
        }
      }
      
      // Always include CSV well name in normalized so the preview can display it
      const csvWellName = String(findField(well, WELL_NAME_ALIASES) || '').trim();
      const csvWellNumber = String(findField(well, WELL_NUMBER_ALIASES) || '').trim();
      const csvDisplayName = csvWellName && csvWellNumber
        ? `${csvWellName} ${csvWellNumber}` : csvWellName;

      return {
        row: index + 1,
        original: well,
        normalized: matchStatus === 'exact' ? {
          apiNumber: searchResults.matches[0].api_number,
          wellName: searchResults.matches[0].well_name,
          csvWellName: csvDisplayName,
          notes: well.Notes || well.notes || ''
        } : {
          wellName: csvDisplayName,
          csvWellName: csvDisplayName,
          notes: well.Notes || well.notes || ''
        },
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
        errors: ['Processing error'],
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
  const wouldExceedLimit = isAdminOverride ? false : newWellCount > planLimits.wells;

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
      limit: isAdminOverride ? 999999 : planLimits.wells,
      plan: isAdminOverride ? plan + ' (Admin Override)' : plan,
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
export async function handleBulkUploadWells(request: Request, env: Env, ctx?: ExecutionContext) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  const body = await request.json();
  const { wells, selections } = body; // Array of validated wells + optional selections for ambiguous matches

  if (!wells || !Array.isArray(wells)) {
    return jsonResponse({ error: "Invalid data format" }, 400);
  }

  // Resolve upload context (supports admin override via ?target_user_id=recXXX)
  const ctxResult = await resolveUploadContext(request, user, env);
  if (ctxResult instanceof Response) return ctxResult;
  const { targetUserId, targetOrgId: userOrganization, targetEmail, plan, planLimits, isAdminOverride } = ctxResult;

  // Skip plan limits for admin override
  if (!isAdminOverride) {
    if (planLimits.wells === 0) {
      return jsonResponse({
        error: `Your ${plan} plan does not include well monitoring.`
      }, 403);
    }

    const wellsCount = await countUserWellsD1(env, targetUserId, userOrganization);

    if (wellsCount + wells.length > planLimits.wells) {
      return jsonResponse({
        error: `Would exceed well limit (${planLimits.wells} wells on ${plan} plan)`
      }, 403);
    }
  }

  // Get existing wells for duplicate check - CRITICAL for preventing partial import duplicates
  const existingWells = await fetchUserWellsD1(env, targetUserId, userOrganization);
  const existingSet = new Set(existingWells.map(w => w.apiNumber));

  console.log(`[BulkUpload] User has ${existingWells.length} existing wells${isAdminOverride ? ` (admin: ${user.email} acting as ${targetEmail})` : ''}`);
  
  // Process wells based on their match status and selections
  const toCreate: any[] = [];
  const seenInUpload = new Set<string>(); // Intra-batch dedup safety net

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
      if (selectedApi === 'SKIP') {
        return;
      }
      const selectedMatch = well.searchResults?.matches?.find((m: any) => m.api_number === selectedApi);
      if (selectedMatch) {
        apiNumber = selectedMatch.api_number;
        wellName = selectedMatch.well_name;
      }
    }

    if (apiNumber) {
      if (existingSet.has(apiNumber) || seenInUpload.has(apiNumber)) {
        // Skip duplicate
      } else {
        seenInUpload.add(apiNumber);
        // Extract enterprise interest fields from original CSV row
        const orig = well.original || {};
        const userWellCode = findField(orig, WELL_CODE_ALIASES);
        const wiNriRaw = findField(orig, WI_NRI_ALIASES);
        const riNriRaw = findField(orig, RI_NRI_ALIASES);
        const orriNriRaw = findField(orig, ORRI_NRI_ALIASES);
        const punRaw = findField(orig, PUN_ALIASES);
        const punResolved = well.normalized?.punResolved || null;
        toCreate.push({
          apiNumber,
          wellName,
          notes: well.original.Notes || well.original.notes || '',
          // Enterprise fields
          user_well_code: userWellCode ? String(userWellCode).trim() : null,
          wi_nri: wiNriRaw !== undefined ? parseFloat(wiNriRaw) || null : null,
          ri_nri: riNriRaw !== undefined ? parseFloat(riNriRaw) || null : null,
          orri_nri: orriNriRaw !== undefined ? parseFloat(orriNriRaw) || null : null,
          // PUN for enrichment
          pun: punRaw ? String(punRaw).trim() : (punResolved || null)
        });
      }
    }
  });
  
  const results = {
    successful: 0,
    failed: 0,
    skipped: wells.length - toCreate.length,
    duplicatesSkipped: 0,
    errors: []
  };
  
  // Count how many were skipped due to duplicates vs other reasons
  wells.forEach((well: any) => {
    if (well.isDuplicate) results.duplicatesSkipped++;
  });
  
  console.log(`[BulkUpload] Processing ${toCreate.length} new wells (${results.skipped} skipped: ${results.duplicatesSkipped} duplicates, ${results.skipped - results.duplicatesSkipped} other reasons)`);
  
  // Create minimal Airtable records + write enterprise fields to D1
  // Airtable stores: User relationship, tracking status, and user notes
  // D1 stores: Enterprise interest decimals (wi_nri, ri_nri, orri_nri, user_well_code)
  const batchSize = 10;
  for (let i = 0; i < toCreate.length; i += batchSize) {
    const batch = toCreate.slice(i, i + batchSize);


    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: batch.map((well: any) => {
          const fields: any = {
            User: [targetUserId],
            "API Number": well.apiNumber,
            Notes: well.notes || "",
            Status: "Active"
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
      const data = await response.json() as any;
      results.successful += data.records.length;

      // Write to D1 client_wells with TRS data from OCC wells table
      // This ensures OCC filings can be matched via TRS location
      if (env.WELLS_DB) {
        try {
          // Fetch TRS data from OCC wells table for all APIs in this batch
          const apiNumbers = batch.map((w: any) => w.apiNumber);
          const placeholders = apiNumbers.map(() => '?').join(', ');
          const occWells = await env.WELLS_DB.prepare(`
            SELECT api_number, well_name, operator, county, section, township, range
            FROM wells WHERE api_number IN (${placeholders})
          `).bind(...apiNumbers).all();

          const occDataMap = new Map<string, any>();
          for (const row of occWells.results || []) {
            occDataMap.set(row.api_number as string, row);
          }

          const d1Stmts = data.records.map((rec: any, j: number) => {
            const well = batch[j];
            const occData = occDataMap.get(well.apiNumber);
            const d1Id = `cwell_${rec.id}`;
            return env.WELLS_DB.prepare(`
              INSERT INTO client_wells (
                id, airtable_id, api_number, user_id, organization_id,
                well_name, operator, county, section, township, range_val,
                user_well_code, wi_nri, ri_nri, orri_nri, status, synced_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', CURRENT_TIMESTAMP)
              ON CONFLICT(airtable_id) DO UPDATE SET
                well_name = COALESCE(excluded.well_name, client_wells.well_name),
                operator = COALESCE(excluded.operator, client_wells.operator),
                county = COALESCE(excluded.county, client_wells.county),
                section = COALESCE(excluded.section, client_wells.section),
                township = COALESCE(excluded.township, client_wells.township),
                range_val = COALESCE(excluded.range_val, client_wells.range_val),
                user_well_code = COALESCE(excluded.user_well_code, client_wells.user_well_code),
                wi_nri = COALESCE(excluded.wi_nri, client_wells.wi_nri),
                ri_nri = COALESCE(excluded.ri_nri, client_wells.ri_nri),
                orri_nri = COALESCE(excluded.orri_nri, client_wells.orri_nri),
                updated_at = datetime('now')
            `).bind(
              d1Id,
              rec.id,
              well.apiNumber,
              targetUserId,
              userOrganization || null,
              occData?.well_name || well.wellName || null,
              occData?.operator || null,
              occData?.county || null,
              occData?.section ? String(occData.section) : null,
              occData?.township || null,
              occData?.range || null,
              well.user_well_code || null,
              well.wi_nri || null,
              well.ri_nri || null,
              well.orri_nri || null
            );
          });
          await env.WELLS_DB.batch(d1Stmts);
          console.log(`[BulkUpload] D1 client_wells written for ${d1Stmts.length} wells (with TRS data)`);
        } catch (d1Err: any) {
          console.error(`[BulkUpload] D1 write failed (non-fatal):`, d1Err.message);
          // Non-fatal — the fields will be populated on next sync
        }
      }
    } else {
      const err = await response.text();
      console.error(`[BulkUpload] Batch create wells failed:`, err.message);
      results.failed += batch.length;
      results.errors.push(`Batch ${Math.floor(i/batchSize) + 1} failed`);
    }

    // Small delay between batches
    if (i + batchSize < toCreate.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`Bulk wells upload complete: ${results.successful} created, ${results.failed} failed, ${results.skipped} skipped`);

  // Enrich well_pun_links with any new PUN→API mappings from user's data
  if (env.WELLS_DB) {
    const punMappings = toCreate.filter((w: any) => w.pun && w.apiNumber);
    if (punMappings.length > 0) {
      try {
        const punStmts = punMappings.map((w: any) =>
          env.WELLS_DB.prepare(`
            INSERT INTO well_pun_links (api_number, pun, match_method, match_source, confidence, link_status)
            VALUES (?, ?, 'user_upload', 'bulk_import', 'high', 'confirmed')
            ON CONFLICT(api_number, pun) DO NOTHING
          `).bind(w.apiNumber, w.pun)
        );
        // Batch in groups of 500 (D1 batch limit)
        for (let i = 0; i < punStmts.length; i += 500) {
          await env.WELLS_DB.batch(punStmts.slice(i, i + 500));
        }
        console.log(`[BulkUpload] Enriched well_pun_links with ${punMappings.length} user-provided PUN mappings`);
      } catch (punErr: any) {
        console.error(`[BulkUpload] PUN enrichment failed (non-fatal):`, punErr.message);
      }
    }
  }

  // Trigger full property-well matching if any wells were created
  if (results.successful > 0 && ctx) {
    console.log('[BulkWellUpload] Triggering full property-well matching');
    
    const organizationId = userOrganization || undefined;
    const matchPromise = runFullPropertyWellMatching(targetUserId, targetEmail, organizationId, env)
      .then(result => {
        if (result.linksCreated > 0) {
          console.log(`[BulkWellUpload] Auto-matched: ${result.linksCreated} links`);
        }
      })
      .catch(err => {
        console.error('[BulkWellUpload] Background matching failed:', err.message);
      });
    
    // Keep the worker alive until the match completes
    ctx.waitUntil(matchPromise);
  }
  
  return jsonResponse({
    success: true,
    results,
    ...(isAdminOverride && { adminOverride: { targetUserId, targetEmail, actingAs: user.email } })
  });
}