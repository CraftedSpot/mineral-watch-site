/**
 * Wells Handlers
 * 
 * Handles CRUD operations for user well monitoring with OCC API integration
 */

import {
  WELLS_TABLE,
  BASE_ID,
  PLAN_LIMITS,
  getPlanLimits,
  OCC_CACHE_TTL,
  ORGANIZATION_TABLE
} from '../constants.js';

import { 
  jsonResponse 
} from '../utils/responses.js';

import {
  getUserFromSession,
  countUserWellsD1,
  checkDuplicateWellD1,
  fetchAllAirtableRecords
} from '../services/airtable.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import { escapeAirtableValue } from '../utils/airtable-escape.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';

// Operator lookup no longer needed - data comes from D1 via /api/wells/v2
// import { getOperatorPhone, findOperatorByName } from '../services/operators.js';

// matchSingleWell removed — using D1-based matchSingleWellD1 below

import type { Env, CompletionData } from '../types/env.js';

// Helper functions no longer needed - D1 is now the source for well metadata
// formatDateForAirtable and extractWellNumber were used when storing data in Airtable

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
  // Check D1 database first (fastest)
  if (env?.WELLS_DB) {
    try {
      const d1Result = await env.WELLS_DB.prepare(`
        SELECT 
          api_number,
          well_name,
          well_number,
          operator,
          county,
          section,
          township,
          range,
          meridian,
          latitude,
          longitude,
          well_type,
          well_status,
          spud_date,
          completion_date,
          -- Bottom hole and lateral data
          bh_latitude,
          bh_longitude,
          lateral_length,
          formation_name,
          formation_canonical,
          formation_group,
          formation_depth,
          true_vertical_depth,
          measured_total_depth,
          ip_oil_bbl,
          ip_gas_mcf,
          ip_water_bbl
        FROM wells
        WHERE api_number = ?
      `).bind(apiNumber).first() as any;
      
      if (d1Result) {
        console.log(`D1 hit: ${apiNumber} - checking data completeness`);
        
        // Check if D1 has incomplete well_number data
        if (!d1Result.well_number || d1Result.well_number === '') {
          console.log(`D1 has incomplete data for ${apiNumber} (missing well_number) - falling back to OCC API`);
          // Don't return here - fall through to OCC API below
        } else {
          // D1 has complete data, use it
          console.log(`D1 has complete data for ${apiNumber} - using local database`);
          
          // Format the response similar to OCC API format
          const wellName = d1Result.well_number 
            ? `${d1Result.well_name} ${d1Result.well_number.startsWith('#') ? d1Result.well_number : '#' + d1Result.well_number}`
            : d1Result.well_name;
            
          const wellDetails = {
            api: d1Result.api_number,
            wellName: wellName,
            operator: d1Result.operator,
            county: d1Result.county,
            section: d1Result.section,
            township: d1Result.township,
            range: d1Result.range,
            meridian: d1Result.meridian,
            lat: d1Result.latitude,
            lon: d1Result.longitude,
            wellType: d1Result.well_type,
            wellStatus: d1Result.well_status,
            spudDate: d1Result.spud_date,
            completionDate: d1Result.completion_date,
            // Bottom hole data for lateral drawing
            bhLat: d1Result.bh_latitude,
            bhLon: d1Result.bh_longitude,
            lateralLength: d1Result.lateral_length,
            // Additional completion data
            formationName: d1Result.formation_name,
            formationCanonical: d1Result.formation_canonical,
            formationGroup: d1Result.formation_group,
            formationDepth: d1Result.formation_depth,
            tvd: d1Result.true_vertical_depth,
            md: d1Result.measured_total_depth,
            ipOil: d1Result.ip_oil_bbl,
            ipGas: d1Result.ip_gas_mcf,
            ipWater: d1Result.ip_water_bbl,
            cachedAt: Date.now()
          };
          
          // Cache the D1 result in KV for consistency with other systems
          if (env?.OCC_CACHE) {
            try {
              await env.OCC_CACHE.put(
                `well_${apiNumber}`, 
                JSON.stringify(wellDetails), 
                { expirationTtl: OCC_CACHE_TTL }
              );
              console.log(`D1 result cached in KV: ${apiNumber}`);
            } catch (e) {
              console.warn('KV cache write error for D1 result:', e);
            }
          }
          
          return wellDetails;
        }
      }
    } catch (e) {
      console.warn('D1 query error:', e);
      // Fall through to OCC API
    }
  }
  
  // Check cache if D1 miss
  if (env?.OCC_CACHE) {
    const cacheKey = `well_${apiNumber}`;
    try {
      const cached: any = await env.OCC_CACHE.get(cacheKey, 'json');
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
      headers: { "User-Agent": "MineralWatch-Portal/1.0" },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      console.error(`OCC API Error: ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    
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
 * Lookup completion data from KV cache (COMPLETIONS_CACHE)
 *
 * Note: For well list display, D1 is now the primary source via /api/wells/v2.
 * This function is still used by:
 * - backfill-formations.ts (background jobs)
 * - track-well.ts (track this well feature)
 *
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
 * @deprecated Use handleListWellsV2 instead - this returns raw Airtable data
 *
 * List all wells for the authenticated user (legacy endpoint)
 * Still used by: oklahoma_map.html, account.html
 *
 * V2 endpoint joins Airtable tracking data with D1 well metadata for better performance.
 * This v1 endpoint returns the raw Airtable records with all fields.
 *
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with user wells (Airtable format)
 */
export async function handleListWells(request: Request, env: Env) {
  try {
    const user = await authenticateRequest(request, env);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    // Get full user record to check for organization
    const userRecord = await getUserFromSession(env, user);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);

    let formula: string;
    const organizationId = userRecord.fields.Organization?.[0];

    const safeEmail = escapeAirtableValue(user.email);

    if (organizationId) {
      // User has organization - fetch org name and filter by it
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` },
          signal: AbortSignal.timeout(10_000)
        }
      );

      if (orgResponse.ok) {
        const org = await orgResponse.json() as any;
        const orgName = escapeAirtableValue(org.fields.Name || '');
        const orgFind = `FIND('${orgName}', ARRAYJOIN({Organization}))`;
        const userFind = `FIND('${safeEmail}', ARRAYJOIN({User}))`;
        formula = `OR(${orgFind} > 0, ${userFind} > 0)`;
      } else {
        formula = `FIND('${safeEmail}', ARRAYJOIN({User})) > 0`;
      }
    } else {
      formula = `FIND('${safeEmail}', ARRAYJOIN({User})) > 0`;
    }

    const records = await fetchAllAirtableRecords(env, WELLS_TABLE, formula);

    return jsonResponse(records);
  } catch (error) {
    console.error('[Wells] Legacy list failed:', error);
    return jsonResponse({ error: 'Wells temporarily unavailable. Please refresh.' }, 503);
  }
}

/**
 * Batch query D1 wells by API numbers with operator contact info
 * @param apiNumbers Array of API numbers to query
 * @param env Worker environment
 * @returns Map of API number to well data
 */
async function batchQueryD1Wells(apiNumbers: string[], env: Env): Promise<Record<string, any>> {
  if (!env.WELLS_DB || apiNumbers.length === 0) {
    return {};
  }

  const results: Record<string, any> = {};
  const BATCH_SIZE = 100;

  for (let i = 0; i < apiNumbers.length; i += BATCH_SIZE) {
    const batch = apiNumbers.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');

    // Aggregate production by base_pun (first 10 chars) to capture all PUN variants
    // e.g., 153-076554-0-0000 and 153-076554-1-0000 share base_pun 153-076554
    // Take MAX(last_prod_month) across all variants - if ANY variant has recent production, well is active
    const query = `
      SELECT
        w.api_number, w.well_name, w.well_number, w.operator, w.county,
        w.section, w.township, w.range, w.meridian,
        w.well_type, w.well_status, w.latitude, w.longitude,
        w.formation_name, w.formation_canonical, w.formation_group, w.formation_depth, w.measured_total_depth, w.true_vertical_depth, w.lateral_length,
        w.spud_date, w.completion_date, w.first_production_date,
        w.ip_oil_bbl, w.ip_gas_mcf, w.ip_water_bbl,
        w.bh_latitude, w.bh_longitude, w.bh_section, w.bh_township, w.bh_range,
        o.phone as operator_phone,
        o.contact_name as operator_contact,
        prod.otc_total_oil,
        prod.otc_total_gas,
        prod.otc_last_prod_month,
        prod.otc_is_stale
      FROM wells w
      LEFT JOIN operators o
        ON UPPER(TRIM(REPLACE(REPLACE(w.operator, '.', ''), ',', ''))) = o.operator_name_normalized
      LEFT JOIN well_pun_links wpl ON w.api_number = wpl.api_number
      LEFT JOIN (
        -- Aggregate production by base_pun to capture all PUN variants
        SELECT
          p.base_pun,
          SUM(p.total_oil_bbl) as otc_total_oil,
          SUM(p.total_gas_mcf) as otc_total_gas,
          MAX(p.last_prod_month) as otc_last_prod_month,
          MIN(p.is_stale) as otc_is_stale  -- 0 if ANY variant is active
        FROM puns p
        GROUP BY p.base_pun
      ) prod ON wpl.base_pun = prod.base_pun
      WHERE w.api_number IN (${placeholders})
      GROUP BY w.api_number
    `;

    try {
      const result = await env.WELLS_DB.prepare(query).bind(...batch).all();
      for (const row of result.results) {
        const api = row.api_number as string;
        const existing = results[api];

        // If we already have data for this API, keep the one with better OTC data
        // Prefer: most recent last_prod_month, then non-null over null
        if (existing) {
          const existingMonth = existing.otc_last_prod_month || '000000';
          const newMonth = row.otc_last_prod_month || '000000';
          if (newMonth > existingMonth) {
            results[api] = row;
          }
        } else {
          results[api] = row;
        }
      }
    } catch (err) {
      console.error('[batchQueryD1Wells] Error querying batch:', err);
    }
  }

  return results;
}

/**
 * Find a client well by ID in D1 and verify ownership.
 * Handles all ID formats: recXXX (Airtable synced), disc_XXX (discovered), cwell_XXX (D1-first)
 */
async function findClientWellD1(
  wellId: string,
  userId: string,
  organizationId: string | undefined,
  env: Env
): Promise<any | null> {
  const memberIds = await getOrgMemberIds(env.WELLS_DB, organizationId);
  const { where: ownerWhere, params: ownerParams } = buildOwnershipFilter('cw', organizationId, userId, memberIds);

  return env.WELLS_DB.prepare(`
    SELECT cw.* FROM client_wells cw
    WHERE (cw.airtable_id = ? OR cw.id = ?)
    AND ${ownerWhere}
  `).bind(wellId, wellId, ...ownerParams).first();
}

/**
 * D1-based single-well auto-matcher.
 * After adding a well, links it to matching properties by surface/BH location.
 */
async function matchSingleWellD1(
  wellAirtableId: string,
  apiNumber: string,
  userId: string,
  organizationId: string | undefined,
  env: Env
): Promise<{ linksCreated: number; propertiesChecked: number }> {
  const well = await env.WELLS_DB.prepare(
    'SELECT section, township, range, meridian, bh_section, bh_township, bh_range FROM wells WHERE api_number = ?'
  ).bind(apiNumber).first() as any;

  if (!well || !well.section) return { linksCreated: 0, propertiesChecked: 0 };

  const memberIds = await getOrgMemberIds(env.WELLS_DB, organizationId);
  const { where: ownerWhere, params: ownerParams } = buildOwnershipFilter('p', organizationId, userId, memberIds);

  const matchConditions = [`(p.section = ? AND p.township = ? AND p.range = ?)`];
  const matchParams: string[] = [String(well.section), well.township, well.range];

  if (well.bh_section && well.bh_township && well.bh_range) {
    matchConditions.push(`(p.section = ? AND p.township = ? AND p.range = ?)`);
    matchParams.push(String(well.bh_section), well.bh_township, well.bh_range);
  }

  const properties = await env.WELLS_DB.prepare(`
    SELECT p.id, p.airtable_record_id, p.section, p.township, p.range
    FROM properties p
    WHERE ${ownerWhere} AND (${matchConditions.join(' OR ')})
  `).bind(...ownerParams, ...matchParams).all();

  const matched = properties.results || [];
  if (!matched.length) return { linksCreated: 0, propertiesChecked: matched.length };

  let linksCreated = 0;
  const stmts: any[] = [];

  for (const prop of matched as any[]) {
    const propId = prop.airtable_record_id || prop.id;

    const exists = await env.WELLS_DB.prepare(
      'SELECT 1 FROM property_well_links WHERE property_airtable_id = ? AND well_airtable_id = ?'
    ).bind(propId, wellAirtableId).first();

    if (!exists) {
      const linkId = `pwl_${crypto.randomUUID()}`;
      stmts.push(
        env.WELLS_DB.prepare(`
          INSERT INTO property_well_links (id, property_airtable_id, well_airtable_id, match_reason, status, user_id, organization_id, link_type, created_at)
          VALUES (?, ?, ?, 'TRS Match (auto)', 'Active', ?, ?, 'Auto', CURRENT_TIMESTAMP)
        `).bind(linkId, propId, wellAirtableId, userId, organizationId || null)
      );
      stmts.push(
        env.WELLS_DB.prepare(
          'UPDATE properties SET well_count = COALESCE(well_count, 0) + 1 WHERE airtable_record_id = ? OR id = ?'
        ).bind(propId, prop.id)
      );
      linksCreated++;
    }
  }

  if (stmts.length > 0) {
    await env.WELLS_DB.batch(stmts);
  }

  return { linksCreated, propertiesChecked: matched.length };
}

/**
 * List wells for authenticated user - V2 (D1-first)
 * Queries D1 directly instead of Airtable. Single query joins:
 *   client_wells → wells → operators → production
 * Returns data in the flat format the dashboard frontend expects.
 *
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with well data
 */
export async function handleListWellsV2(request: Request, env: Env) {
  const t0 = Date.now();
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const tAuth = Date.now();

  const userRecord = await getUserFromSession(env, user);
  if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
  const tSession = Date.now();

  const organizationId = userRecord.fields.Organization?.[0];

  // Plan-based visibility limit
  const plan = (userRecord.fields as any).Plan || 'Free';
  const planLimits = getPlanLimits(plan);
  const wellLimit = planLimits.wells;
  const isSuperAdmin = !!(user as any).impersonating;

  // Build WHERE clause — org members see all wells belonging to any user in the org
  const memberIds = await getOrgMemberIds(env.WELLS_DB, organizationId);
  const { where: ownerWhere, params: bindParams } = buildOwnershipFilter('cw', organizationId, user.id, memberIds);
  const whereClause = `WHERE ${ownerWhere}`;

  // COUNT (no LIMIT — total records owned) + SELECT (with LIMIT) in parallel
  const countStmt = env.WELLS_DB.prepare(
    `SELECT COUNT(*) as total FROM client_wells cw ${whereClause}`
  ).bind(...bindParams);

  // Base query: client_wells + wells + operators (NO production — that's a separate batch)
  const selectQuery = `
    SELECT cw.*,
      w.well_name AS occ_well_name, w.well_number,
      w.operator AS occ_operator, w.county AS occ_county,
      w.section AS occ_section, w.township AS occ_township,
      w.range AS occ_range, w.meridian,
      w.latitude, w.longitude,
      w.well_type AS occ_well_type, w.well_status AS occ_well_status,
      w.formation_name, w.formation_depth,
      w.measured_total_depth, w.true_vertical_depth, w.lateral_length,
      w.spud_date AS occ_spud_date, w.completion_date AS occ_completion_date,
      w.first_production_date AS occ_first_production_date,
      w.ip_oil_bbl, w.ip_gas_mcf, w.ip_water_bbl,
      w.bh_latitude, w.bh_longitude,
      w.bh_section AS occ_bh_section, w.bh_township AS occ_bh_township,
      w.bh_range AS occ_bh_range,
      o.phone AS operator_phone, o.contact_name AS operator_contact,
      wrp.name AS risk_profile_name, wrp.half_cycle_breakeven, wrp.is_gas_flag
    FROM client_wells cw
    LEFT JOIN wells w ON w.api_number = cw.api_number
    LEFT JOIN well_risk_profiles wrp ON wrp.id = w.risk_profile_id
    LEFT JOIN operators o
      ON UPPER(TRIM(REPLACE(REPLACE(COALESCE(w.operator, cw.operator), '.', ''), ',', '')))
         = o.operator_name_normalized
    ${whereClause}
    GROUP BY cw.id
    ORDER BY cw.county, cw.township, cw.range_val, cw.section
    ${isSuperAdmin ? '' : 'LIMIT ?'}
  `;
  const selectParams = isSuperAdmin ? bindParams : [...bindParams, wellLimit];
  const selectStmt = env.WELLS_DB.prepare(selectQuery).bind(...selectParams);

  const [countResult, selectResult] = await env.WELLS_DB.batch([countStmt, selectStmt]);
  const total = (countResult.results as any[])[0]?.total || 0;
  const rows = selectResult.results || [];
  const tD1Query = Date.now();

  // Batch-query production data for visible wells only (avoids full puns table scan)
  // Uses D1 batch() to send all queries in ONE round trip (not sequential awaits)
  const prodMap: Record<string, any> = {};
  const apiNumbers = (rows as any[]).map((r: any) => r.api_number).filter(Boolean);
  if (apiNumbers.length > 0) {
    const PROD_BATCH = 50; // well under D1's 100-param limit
    const prodStmts: any[] = [];
    for (let i = 0; i < apiNumbers.length; i += PROD_BATCH) {
      const batch = apiNumbers.slice(i, i + PROD_BATCH);
      const ph = batch.map(() => '?').join(',');
      prodStmts.push(
        env.WELLS_DB.prepare(`
          SELECT wpl.api_number,
            SUM(p.total_oil_bbl) AS otc_total_oil,
            SUM(p.total_gas_mcf) AS otc_total_gas,
            MAX(p.last_prod_month) AS otc_last_prod_month,
            MIN(p.is_stale) AS otc_is_stale
          FROM well_pun_links wpl
          JOIN puns p ON wpl.base_pun = p.base_pun
          WHERE wpl.api_number IN (${ph})
          GROUP BY wpl.api_number
        `).bind(...batch)
      );
    }
    try {
      const batchResults = await env.WELLS_DB.batch(prodStmts);
      for (const result of batchResults) {
        for (const r of (result.results || [])) {
          prodMap[(r as any).api_number] = r;
        }
      }
    } catch (err) {
      console.error('[wells-v2] Production batch error:', err);
    }
  }
  const tProd = Date.now();

  console.log(`[wells-v2 timing] auth=${tAuth-t0}ms session=${tSession-tAuth}ms d1Query=${tD1Query-tSession}ms prod=${tProd-tD1Query}ms (${apiNumbers.length} wells, ${Math.ceil(apiNumbers.length/50)} batches) total=${tProd-t0}ms`);

  // Transform D1 rows to match the flat response format the frontend expects
  const records = (rows as any[]).map((row: any) => {
    // Combine OCC well_name + well_number for full display name
    const fullWellName = row.occ_well_name && row.well_number
      ? `${row.occ_well_name} ${row.well_number}`.trim()
      : row.occ_well_name || row.well_name || '';

    const occMapLink = row.latitude && row.longitude
      ? generateMapLink(row.latitude, row.longitude, fullWellName || 'Well Location')
      : '#';

    // Production data from separate batch query
    const prod = prodMap[row.api_number] || {};

    return {
      // Record identity (airtable_id for updates/deletes)
      id: row.airtable_id || row.id,
      createdTime: row.created_at || new Date().toISOString(),

      // User data from client_wells
      apiNumber: row.api_number || '',
      notes: row.notes || '',
      userStatus: row.status || 'Active',
      occFilingLink: null,

      // Well metadata — prefer OCC data, fallback to client_wells
      well_name: fullWellName,
      well_number: row.well_number || '',
      operator: row.occ_operator || row.operator || '',
      county: row.occ_county || row.county || '',
      section: row.occ_section || row.section || '',
      township: row.occ_township || row.township || '',
      range: row.occ_range || row.range_val || '',
      meridian: row.meridian || '',
      well_type: row.occ_well_type || row.well_type || '',
      well_status: row.occ_well_status || row.well_status || '',
      latitude: row.latitude || null,
      longitude: row.longitude || null,

      // Enrichment data from OCC wells table
      formation_name: row.formation_name || null,
      formation_canonical: row.formation_canonical || null,
      formation_group: row.formation_group || null,
      measured_total_depth: row.measured_total_depth || null,
      true_vertical_depth: row.true_vertical_depth || null,
      lateral_length: row.lateral_length || null,
      spud_date: row.occ_spud_date || row.spud_date || null,
      completion_date: row.occ_completion_date || row.completion_date || null,
      first_production_date: row.occ_first_production_date || row.first_production_date || null,
      ip_oil_bbl: row.ip_oil_bbl || null,
      ip_gas_mcf: row.ip_gas_mcf || null,
      ip_water_bbl: row.ip_water_bbl || null,

      // Bottom hole location (horizontal wells)
      bh_latitude: row.bh_latitude || null,
      bh_longitude: row.bh_longitude || null,
      bh_section: row.occ_bh_section || row.bh_section || null,
      bh_township: row.occ_bh_township || row.bh_township || null,
      bh_range: row.occ_bh_range || row.bh_range || null,

      // Formation depth
      formation_depth: row.formation_depth || null,

      // Operator contact from operators table
      operator_phone: row.operator_phone || null,
      operator_contact: row.operator_contact || null,

      // OTC production data (from separate batch query)
      otc_total_oil: prod.otc_total_oil || null,
      otc_total_gas: prod.otc_total_gas || null,
      otc_last_prod_month: prod.otc_last_prod_month || null,
      otc_is_stale: prod.otc_is_stale,  // 0 is valid

      // Generated links
      occMapLink,

      // Enterprise interest fields from client_wells
      user_well_code: row.user_well_code || null,
      wi_nri: row.wi_nri || null,
      ri_nri: row.ri_nri || null,
      orri_nri: row.orri_nri || null,
      ri_nri_source: row.interest_source || null,
      ri_nri_source_doc_id: row.interest_source_doc_id || null,
      ri_nri_source_date: row.interest_source_date || null,
      wi_nri_source: row.wi_nri_source || null,
      wi_nri_source_doc_id: row.wi_nri_source_doc_id || null,
      wi_nri_source_date: row.wi_nri_source_date || null,
      orri_nri_source: row.orri_nri_source || null,
      orri_nri_source_doc_id: row.orri_nri_source_doc_id || null,
      orri_nri_source_date: row.orri_nri_source_date || null,

      // Risk profile data from well_risk_profiles
      risk_profile_name: row.risk_profile_name || null,
      half_cycle_breakeven: row.half_cycle_breakeven != null ? row.half_cycle_breakeven : null,
      is_gas_flag: row.is_gas_flag ? 1 : 0,

      // Tracking source (manual vs discovered)
      tracking_source: row.tracking_source || 'manual',

      // Flag indicating if OCC wells table had data
      hasD1Data: !!row.occ_well_name
    };
  });

  return jsonResponse({
    records,
    _meta: { total, visible: records.length, plan, limit: wellLimit }
  });
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
    const userRecord = await getUserFromSession(env, user);
    if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
      return jsonResponse({ error: "Viewers cannot add wells" }, 403);
    }
    
    const body: any = await request.json();
    
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
  const planLimits: { properties: number; wells: number } = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || { properties: 1, wells: 0 };
  
  // Check if plan allows wells
  if (planLimits.wells === 0) {
    return jsonResponse({ 
      error: `Your ${plan} plan does not include well monitoring. Please upgrade to add wells.` 
    }, 403);
  }
  
  // Count wells for user or organization (D1 indexed query)
  const organizationId = userRecord?.fields.Organization?.[0];
  const wellsCount = await countUserWellsD1(env, user.id, organizationId);
  
  if (wellsCount >= planLimits.wells) {
    return jsonResponse({ 
      error: `Well limit reached (${planLimits.wells} wells on ${plan} plan). You have ${wellsCount} wells.` 
    }, 403);
  }
  
  // Check for duplicate well API for this user (D1 indexed query)
  const isDuplicate = await checkDuplicateWellD1(env, user.id, organizationId, cleanApi);
  if (isDuplicate) {
    return jsonResponse({ error: "You are already monitoring this well API." }, 409);
  }
  
  // Validate well exists in D1 or OCC before allowing tracking
  // This ensures we have metadata for the well
  console.log(`[AddWell] Validating well API: ${cleanApi}`);
  const wellDetails = await fetchWellDetailsFromOCC(cleanApi, env);

  if (wellDetails) {
    console.log(`[AddWell] Well validated: ${wellDetails.wellName} - ${wellDetails.operator} - ${wellDetails.county} County`);
  } else {
    console.warn(`[AddWell] Well API ${cleanApi} not found in D1/OCC - may be pending or invalid`);
    // Still allow adding for very new permits not yet in database
  }
  
  // Insert directly into D1 client_wells (D1-first, no Airtable)
  const wellId = `cwell_${crypto.randomUUID()}`;

  console.log(`[AddWell] Creating well in D1: ${cleanApi} (${wellId})`);

  await env.WELLS_DB.prepare(`
    INSERT INTO client_wells (
      id, airtable_id, user_id, organization_id, api_number,
      well_name, operator, county, section, township, range_val,
      well_type, well_status, notes, status, tracking_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'manual', datetime('now'))
  `).bind(
    wellId,
    wellId,
    user.id,
    organizationId || null,
    cleanApi,
    wellDetails?.wellName || '',
    wellDetails?.operator || '',
    wellDetails?.county || '',
    wellDetails?.section ? String(wellDetails.section) : '',
    wellDetails?.township || '',
    wellDetails?.range || '',
    wellDetails?.wellType || '',
    wellDetails?.wellStatus || '',
    body.notes || ''
  ).run();

  console.log(`[AddWell] Well created in D1: ${cleanApi} for ${user.email}`);

    // Trigger auto-matching in background (D1-based)
    if (ctx) {
      const matchPromise = matchSingleWellD1(wellId, cleanApi, user.id, organizationId || undefined, env)
        .then(result => {
          console.log(`[AddWell] Auto-match complete:`, result);
          if (result.linksCreated > 0) {
            console.log(`[AddWell] Created ${result.linksCreated} links out of ${result.propertiesChecked} properties checked`);
          }
        })
        .catch(err => {
          console.error('[AddWell] Auto-match failed:', err.message);
        });
      ctx.waitUntil(matchPromise);
    }

    return jsonResponse({ id: wellId, success: true }, 201);
  } catch (error) {
    console.error("Error in handleAddWell:", error);
    return jsonResponse({
      error: "Internal server error"
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
  const userRecord = await getUserFromSession(env, user);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot delete wells" }, 403);
  }

  const organizationId = userRecord?.fields.Organization?.[0];

  // Find well in D1 and verify ownership
  const well = await findClientWellD1(wellId, user.id, organizationId, env);
  if (!well) {
    return jsonResponse({ error: "Well not found" }, 404);
  }

  const wellAirtableId = well.airtable_id || well.id;

  // Find linked properties before deletion (for well_count updates)
  const linkedProps = await env.WELLS_DB.prepare(
    'SELECT DISTINCT property_airtable_id FROM property_well_links WHERE well_airtable_id = ?'
  ).bind(wellAirtableId).all();

  // Build batch: delete well, delete links, decrement well_count
  const stmts: any[] = [
    env.WELLS_DB.prepare('DELETE FROM client_wells WHERE id = ?').bind(well.id),
    env.WELLS_DB.prepare('DELETE FROM property_well_links WHERE well_airtable_id = ?').bind(wellAirtableId),
  ];

  for (const row of (linkedProps.results || []) as any[]) {
    stmts.push(
      env.WELLS_DB.prepare(
        'UPDATE properties SET well_count = MAX(COALESCE(well_count, 1) - 1, 0) WHERE airtable_record_id = ?'
      ).bind(row.property_airtable_id)
    );
  }

  await env.WELLS_DB.batch(stmts);

  console.log(`[DeleteWell] Deleted: ${wellId} (${well.api_number}) by ${user.email}`);
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
  const userRecord = await getUserFromSession(env, user);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot update wells" }, 403);
  }
  
  const body: any = await request.json();
  let notes = body.notes || "";
  
  // Limit notes length to prevent abuse
  if (notes.length > 1000) {
    notes = notes.substring(0, 1000);
  }
  
  const organizationId = userRecord?.fields.Organization?.[0];

  // Verify ownership in D1
  const well = await findClientWellD1(wellId, user.id, organizationId, env);
  if (!well) {
    return jsonResponse({ error: "Well not found" }, 404);
  }

  // Update notes in D1
  await env.WELLS_DB.prepare(
    "UPDATE client_wells SET notes = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(notes, well.id).run();

  return jsonResponse({ success: true });
}

/**
 * Update well interest decimals (ri_nri, wi_nri, orri_nri) in D1
 * Sets per-field source tracking (interest_source, wi_nri_source, orri_nri_source)
 */
export async function handleUpdateWellInterests(wellId: string, request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  // Check permissions - only Admin and Editor can update wells
  const userRecord = await getUserFromSession(env, user);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot update wells" }, 403);
  }

  const organizationId = userRecord?.fields.Organization?.[0];

  // Verify ownership in D1
  const well = await findClientWellD1(wellId, user.id, organizationId, env);
  if (!well) {
    return jsonResponse({ error: "Well not found" }, 404);
  }

  const body: any = await request.json();
  const updates: string[] = [];
  const binds: any[] = [];

  // Per-field source tracking
  if (body.ri_nri !== undefined) {
    const val = body.ri_nri !== null && body.ri_nri !== '' ? parseFloat(body.ri_nri) : null;
    updates.push('ri_nri = ?', 'interest_source = ?', 'interest_source_doc_id = ?', 'interest_source_date = ?');
    binds.push(val, val !== null ? 'manual_entry' : null, null, val !== null ? new Date().toISOString() : null);
  }
  if (body.wi_nri !== undefined) {
    const val = body.wi_nri !== null && body.wi_nri !== '' ? parseFloat(body.wi_nri) : null;
    updates.push('wi_nri = ?', 'wi_nri_source = ?', 'wi_nri_source_doc_id = ?', 'wi_nri_source_date = ?');
    binds.push(val, val !== null ? 'manual_entry' : null, null, val !== null ? new Date().toISOString() : null);
  }
  if (body.orri_nri !== undefined) {
    const val = body.orri_nri !== null && body.orri_nri !== '' ? parseFloat(body.orri_nri) : null;
    updates.push('orri_nri = ?', 'orri_nri_source = ?', 'orri_nri_source_doc_id = ?', 'orri_nri_source_date = ?');
    binds.push(val, val !== null ? 'manual_entry' : null, null, val !== null ? new Date().toISOString() : null);
  }

  if (updates.length > 0 && env.WELLS_DB) {
    try {
      // Try full update with source tracking columns
      await env.WELLS_DB.prepare(
        `UPDATE client_wells SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...binds, well.id).run();
    } catch (e) {
      // Source columns may not exist on fresh accounts (created dynamically by documents-worker).
      // Fallback: update only the interest values without source tracking.
      console.warn('[UpdateWellInterests] Source columns not available, falling back:', e);
      const valUpdates: string[] = [];
      const valBinds: any[] = [];
      if (body.ri_nri !== undefined) {
        valUpdates.push('ri_nri = ?');
        valBinds.push(body.ri_nri !== null && body.ri_nri !== '' ? parseFloat(body.ri_nri) : null);
      }
      if (body.wi_nri !== undefined) {
        valUpdates.push('wi_nri = ?');
        valBinds.push(body.wi_nri !== null && body.wi_nri !== '' ? parseFloat(body.wi_nri) : null);
      }
      if (body.orri_nri !== undefined) {
        valUpdates.push('orri_nri = ?');
        valBinds.push(body.orri_nri !== null && body.orri_nri !== '' ? parseFloat(body.orri_nri) : null);
      }
      if (valUpdates.length > 0) {
        await env.WELLS_DB.prepare(
          `UPDATE client_wells SET ${valUpdates.join(', ')} WHERE id = ?`
        ).bind(...valBinds, well.id).run();
      }
    }
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
      GROUP BY w.api_number
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
      error: 'Failed to search wells'
    }, 500);
  }
}