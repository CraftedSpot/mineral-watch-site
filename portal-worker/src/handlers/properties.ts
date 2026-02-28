/**
 * Properties Handlers
 * 
 * Handles CRUD operations for user property monitoring
 */

import {
  PROPERTIES_TABLE,
  BASE_ID,
  PLAN_LIMITS,
  getPlanLimits,
  ORGANIZATION_TABLE
} from '../constants.js';

import {
  jsonResponse
} from '../utils/responses.js';

import {
  getUserFromSession,
  checkDuplicatePropertyD1,
  countUserPropertiesD1,
  fetchAllAirtableRecords
} from '../services/airtable.js';

import { generateRecordId } from '../utils/id-gen.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import { matchSingleProperty } from '../utils/property-well-matching.js';
import { getOccFilingsForProperty } from '../utils/docket-matching.js';

import { escapeAirtableValue } from '../utils/airtable-escape.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import type { Env } from '../types/env.js';

/**
 * List all properties for the authenticated user — D1-first (V2)
 * Queries D1 directly instead of Airtable. Returns data in the same
 * format the dashboard frontend expects (id, createdTime, fields).
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with user properties
 */
export async function handleListPropertiesV2(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  // Get full user record to check for organization
  const userRecord = await getUserFromSession(env, user);
  if (!userRecord) return jsonResponse({ error: "User not found" }, 404);

  const organizationId = userRecord.fields.Organization?.[0];

  // Determine plan limit for visibility
  const plan = (userRecord.fields as any).Plan || 'Free';
  const planLimits = getPlanLimits(plan);
  const limit = planLimits.properties;
  // Super admins impersonating bypass limits to see full data
  const isSuperAdmin = !!(user as any).impersonating;

  // Build WHERE clause — org members see all properties belonging to any user in the org
  const memberIds = await getOrgMemberIds(env.WELLS_DB, organizationId);
  const { where: ownerWhere, params: bindParams } = buildOwnershipFilter('p', organizationId, user.id, memberIds);
  const whereClause = `WHERE ${ownerWhere}`;

  // Run COUNT and SELECT in parallel via batch
  const countStmt = env.WELLS_DB.prepare(
    `SELECT COUNT(*) as total FROM properties p ${whereClause}`
  ).bind(...bindParams);

  const selectQuery = `
    SELECT p.*
    FROM properties p
    ${whereClause}
    ORDER BY p.county, p.township, p.range, p.section
    ${isSuperAdmin ? '' : 'LIMIT ?'}
  `;
  const selectParams = isSuperAdmin ? bindParams : [...bindParams, limit];
  const selectStmt = env.WELLS_DB.prepare(selectQuery).bind(...selectParams);

  const [countResult, selectResult] = await env.WELLS_DB.batch([countStmt, selectStmt]);
  const total = (countResult.results as any[])[0]?.total || 0;
  const rows = selectResult.results || [];

  // Transform D1 rows to match Airtable response format for frontend compatibility
  const records = (rows as any[]).map((row: any) => ({
    // Use airtable_record_id as the record ID (frontend uses this for updates/deletes)
    id: row.airtable_record_id || row.id,
    createdTime: row.created_at || new Date().toISOString(),
    fields: {
      COUNTY: row.county || '',
      SEC: row.section || '',
      TWN: row.township || '',
      RNG: row.range || '',
      MERIDIAN: row.meridian || 'IM',
      'RI Acres': row.ri_acres || 0,
      'WI Acres': row.wi_acres || 0,
      Notes: row.notes || '',
      Group: row.group_name || '',
      Status: row.status || 'Active',
      'Monitor Adjacent': row.monitor_adjacent === 1,
      // Enterprise fields (new — ignored by current frontend, ready for use)
      property_code: row.property_code || null,
      total_acres: row.total_acres || null,
      ri_decimal: row.ri_decimal || null,
      wi_decimal: row.wi_decimal || null,
      orri_acres: row.orri_acres || null,
      orri_decimal: row.orri_decimal || null,
      mi_acres: row.mi_acres || null,
      mi_decimal: row.mi_decimal || null,
    },
    // Extra metadata (not in Airtable format but useful)
    _d1Id: row.id,
    _linkedWells: row.well_count || 0,
    _linkCounts: {
      wells: row.well_count || 0,
      documents: row.document_count || 0,
      filings: row.filing_count || 0,
    },
  }));

  return jsonResponse({
    records,
    _meta: { total, visible: records.length, plan, limit }
  });
}

/**
 * List all properties for the authenticated user
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with user properties
 */
export async function handleListProperties(request: Request, env: Env) {
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
      // User has organization - need to get org name for the filter
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );

      if (orgResponse.ok) {
        const org = await orgResponse.json() as any;
        const orgName = escapeAirtableValue(org.fields.Name || '');
        // Filter by org name OR user email — properties uploaded via Airtable
        // may have User field set but Organization field empty
        const orgFind = `FIND('${orgName}', ARRAYJOIN({Organization}))`;
        const userFind = `FIND('${safeEmail}', ARRAYJOIN({User}))`;
        formula = `OR(${orgFind} > 0, ${userFind} > 0)`;
      } else {
        formula = `FIND('${safeEmail}', ARRAYJOIN({User})) > 0`;
      }
    } else {
      formula = `FIND('${safeEmail}', ARRAYJOIN({User})) > 0`;
    }

    const records = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, formula);

    return jsonResponse(records);
  } catch (error) {
    console.error('[Properties] Legacy list failed:', error);
    return jsonResponse({ error: 'Properties temporarily unavailable. Please refresh.' }, 503);
  }
}

/**
 * Add a new property for the authenticated user
 * @param request The incoming request with property data
 * @param env Worker environment
 * @returns JSON response with created property
 */
export async function handleAddProperty(request: Request, env: Env, ctx?: ExecutionContext) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const body: any = await request.json();
  const required = ["COUNTY", "SEC", "TWN", "RNG"];
  for (const field of required) {
    if (!body[field]) {
      return jsonResponse({ error: `${field} is required` }, 400);
    }
  }
  const userRecord = await getUserFromSession(env, user);
  
  // Check permissions - only Admin and Editor can add properties
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot add properties" }, 403);
  }
  const plan = userRecord?.fields.Plan || "Free";
  const planLimits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || { properties: 1, wells: 0 };
  const userOrganization = userRecord?.fields.Organization?.[0]; // Get user's organization if they have one

  // Count properties for user or organization (D1 indexed query)
  const propertiesCount = await countUserPropertiesD1(env, user.id, userOrganization);
  
  if (propertiesCount >= planLimits.properties) {
    return jsonResponse({ 
      error: `Property limit reached (${planLimits.properties} properties on ${plan} plan). You have ${propertiesCount} properties.` 
    }, 403);
  }
  
  // Normalize Section: strip prefixes, extract number, validate 1-36, zero-pad
  let secStr = String(body.SEC).trim().replace(/^(s|sec|section)\s*/i, '');
  const secMatch = secStr.match(/(\d+)/);
  if (!secMatch) {
    return jsonResponse({ error: "Invalid section number" }, 400);
  }
  const secNum = parseInt(secMatch[1], 10);
  if (secNum < 1 || secNum > 36) {
    return jsonResponse({ error: "Section must be between 1 and 36" }, 400);
  }
  const section = String(secNum).padStart(2, "0");

  // Normalize Township: strip prefixes, uppercase, default direction N
  let twnStr = String(body.TWN).trim().toUpperCase().replace(/^(T|TWN|TOWN|TOWNSHIP)\s*/i, '').replace(/\s+/g, '');
  if (/^\d+$/.test(twnStr)) {
    twnStr = twnStr + 'N'; // Default to North if no direction
  }
  if (!/^\d{1,2}[NS]$/.test(twnStr)) {
    return jsonResponse({ error: "Invalid township (e.g., 12N or 4S)" }, 400);
  }
  const township = twnStr.toUpperCase();

  // Normalize Range: strip prefixes, uppercase, default direction W
  let rngStr = String(body.RNG).trim().toUpperCase().replace(/^(R|RNG|RANGE)\s*/i, '').replace(/\s+/g, '');
  if (/^\d+$/.test(rngStr)) {
    rngStr = rngStr + 'W'; // Default to West if no direction
  }
  if (!/^\d{1,2}[EW]$/.test(rngStr)) {
    return jsonResponse({ error: "Invalid range (e.g., 4W or 8E)" }, 400);
  }
  const range = rngStr.toUpperCase();

  // Smart meridian detection based on county
  const panhandleCounties = ['Cimarron', 'Texas', 'Beaver'];
  let meridian = body.MERIDIAN;
  if (!meridian) {
    meridian = panhandleCounties.includes(body.COUNTY) ? "CM" : "IM";
  }
  const isDuplicate = await checkDuplicatePropertyD1(env, user.id, userOrganization, body.COUNTY, section, township, range);
  if (isDuplicate) {
    return jsonResponse({ error: "You are already monitoring this property." }, 409);
  }

  // D1-first: Create property in D1 with generated record ID
  const recordId = generateRecordId();
  const propId = `prop_${recordId}`;

  await env.WELLS_DB.prepare(`
    INSERT INTO properties (id, airtable_record_id, county, section, township, range, meridian,
      ri_acres, wi_acres, notes, owner, group_name, user_id, organization_id, monitor_adjacent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active')
  `).bind(
    propId, recordId, body.COUNTY, section, township, range, meridian,
    body['RI Acres'] || 0, body['WI Acres'] || 0, body.Notes || '',
    user.id, body.Group || '', user.id, userOrganization || null
  ).run();

  console.log(`[PropertyCreate] D1 created: ${body.COUNTY} S${section} T${township} R${range} (${recordId})`);

  // Return Airtable-compatible shape for frontend
  const newRecord = {
    id: recordId,
    createdTime: new Date().toISOString(),
    fields: {
      COUNTY: body.COUNTY,
      SEC: section,
      TWN: township,
      RNG: range,
      MERIDIAN: meridian,
      Group: body.Group || '',
      Notes: body.Notes || '',
      'RI Acres': body['RI Acres'] || 0,
      'WI Acres': body['WI Acres'] || 0,
      'Monitor Adjacent': true,
      Status: 'Active'
    }
  };

  // Trigger auto-matching in background
  if (ctx) {
    const organizationId = userOrganization || undefined;
    ctx.waitUntil(
      matchSingleProperty(recordId, user.id, organizationId, env)
        .then(result => {
          if (result.linksCreated > 0) {
            console.log(`[PropertyCreate] Auto-match: ${result.linksCreated} links from ${result.wellsChecked} wells`);
          }
        })
        .catch(err => console.error('[PropertyCreate] Auto-match failed:', err.message))
    );

  }

  return jsonResponse(newRecord, 201);
}

/**
 * Update a property for the authenticated user
 * @param propertyId The property ID to update
 * @param request The incoming request with update data
 * @param env Worker environment
 * @returns JSON response with success status
 */
export async function handleUpdateProperty(propertyId: string, request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Check permissions - only Admin and Editor can update properties
  const userRecord = await getUserFromSession(env, user);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot update properties" }, 403);
  }
  
  const body: any = await request.json();

  // Build fields object with allowed editable fields
  const updateFields: Record<string, any> = {};
  const d1Updates: string[] = [];
  const d1Binds: any[] = [];

  if (body.notes !== undefined) {
    let notes = body.notes || "";
    // Limit notes length to prevent abuse
    if (notes.length > 1000) {
      notes = notes.substring(0, 1000);
    }
    updateFields['Notes'] = notes;
    d1Updates.push('notes = ?');
    d1Binds.push(notes);
  }
  if (body.meridian !== undefined) {
    // Validate meridian value
    if (!['IM', 'CM'].includes(body.meridian)) {
      return jsonResponse({ error: 'Invalid meridian value' }, 400);
    }
    updateFields['MERIDIAN'] = body.meridian;
    d1Updates.push('meridian = ?');
    d1Binds.push(body.meridian);
  }
  if (body.riAcres !== undefined) {
    const riAcres = parseFloat(body.riAcres) || 0;
    updateFields['RI Acres'] = riAcres;
    d1Updates.push('ri_acres = ?');
    d1Binds.push(riAcres);
  }
  if (body.wiAcres !== undefined) {
    const wiAcres = parseFloat(body.wiAcres) || 0;
    updateFields['WI Acres'] = wiAcres;
    d1Updates.push('wi_acres = ?');
    d1Binds.push(wiAcres);
  }

  // Enterprise fields (D1-only — NOT written to Airtable)
  if (body.propertyCode !== undefined) {
    d1Updates.push('property_code = ?');
    d1Binds.push(body.propertyCode || null);
  }
  if (body.riDecimal !== undefined) {
    d1Updates.push('ri_decimal = ?');
    d1Binds.push(body.riDecimal !== null && body.riDecimal !== '' ? parseFloat(body.riDecimal) || null : null);
  }
  if (body.wiDecimal !== undefined) {
    d1Updates.push('wi_decimal = ?');
    d1Binds.push(body.wiDecimal !== null && body.wiDecimal !== '' ? parseFloat(body.wiDecimal) || null : null);
  }
  if (body.orriAcres !== undefined) {
    d1Updates.push('orri_acres = ?');
    d1Binds.push(body.orriAcres !== null && body.orriAcres !== '' ? parseFloat(body.orriAcres) || null : null);
  }
  if (body.orriDecimal !== undefined) {
    d1Updates.push('orri_decimal = ?');
    d1Binds.push(body.orriDecimal !== null && body.orriDecimal !== '' ? parseFloat(body.orriDecimal) || null : null);
  }
  if (body.miAcres !== undefined) {
    d1Updates.push('mi_acres = ?');
    d1Binds.push(body.miAcres !== null && body.miAcres !== '' ? parseFloat(body.miAcres) || null : null);
  }
  if (body.miDecimal !== undefined) {
    d1Updates.push('mi_decimal = ?');
    d1Binds.push(body.miDecimal !== null && body.miDecimal !== '' ? parseFloat(body.miDecimal) || null : null);
  }

  // D1-first: Verify ownership via D1
  if (!env.WELLS_DB) {
    return jsonResponse({ error: "Database not available" }, 503);
  }

  const orgId = userRecord?.fields.Organization?.[0];
  const memberIds = await getOrgMemberIds(env.WELLS_DB, orgId);
  const { where: ownerWhere, params: ownerParams } = buildOwnershipFilter('p', orgId, user.id, memberIds);

  const prop = await env.WELLS_DB.prepare(
    `SELECT p.airtable_record_id FROM properties p WHERE p.airtable_record_id = ? AND ${ownerWhere}`
  ).bind(propertyId, ...ownerParams).first();

  if (!prop) {
    return jsonResponse({ error: "Property not found or not authorized" }, 404);
  }

  // D1-first: Update D1 (source of truth)
  if (d1Updates.length > 0) {
    d1Updates.push('updated_at = CURRENT_TIMESTAMP');
    const sql = `UPDATE properties SET ${d1Updates.join(', ')} WHERE airtable_record_id = ?`;
    d1Binds.push(propertyId);
    await env.WELLS_DB.prepare(sql).bind(...d1Binds).run();
  }

  return jsonResponse({ success: true });
}

/**
 * Delete a property for the authenticated user
 * @param propertyId The property ID to delete
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with success status
 */
export async function handleDeleteProperty(propertyId: string, request: Request, env: Env, ctx?: ExecutionContext) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  // Check permissions - only Admin and Editor can delete properties
  const userRecord = await getUserFromSession(env, user);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot delete properties" }, 403);
  }

  // D1-first: Check ownership via D1
  const userOrg = userRecord?.fields.Organization?.[0];
  const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrg);
  const { where: ownerWhere, params: ownerParams } = buildOwnershipFilter('p', userOrg, user.id, memberIds);

  const prop = await env.WELLS_DB.prepare(
    `SELECT p.airtable_record_id FROM properties p WHERE p.airtable_record_id = ? AND ${ownerWhere}`
  ).bind(propertyId, ...ownerParams).first() as any;

  if (!prop) {
    return jsonResponse({ error: "Property not found or not authorized" }, 404);
  }

  // D1: Delete property + cascade property_well_links
  await env.WELLS_DB.batch([
    env.WELLS_DB.prepare(`DELETE FROM property_well_links WHERE property_airtable_id = ?`).bind(propertyId),
    env.WELLS_DB.prepare(`DELETE FROM properties WHERE airtable_record_id = ?`).bind(propertyId)
  ]);

  console.log(`[PropertyDelete] D1 deleted: ${propertyId} by ${user.email}`);

  return jsonResponse({ success: true });
}