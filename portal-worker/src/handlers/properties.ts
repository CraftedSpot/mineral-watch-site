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
  getUserById,
  getUserFromSession,
  countUserProperties,
  checkDuplicateProperty,
  checkDuplicatePropertyD1,
  countUserPropertiesD1,
  fetchAllAirtableRecords
} from '../services/airtable.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import { matchSingleProperty } from '../utils/property-well-matching.js';
import { getOccFilingsForProperty } from '../utils/docket-matching.js';

import { escapeAirtableValue } from '../utils/airtable-escape.js';
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

  // Build WHERE clause
  const whereClause = organizationId
    ? `WHERE p.organization_id = ? OR p.user_id = ?`
    : `WHERE p.user_id = ?`;
  const bindParams = organizationId ? [organizationId, user.id] : [user.id];

  // Run COUNT and SELECT in parallel via batch
  const countStmt = env.WELLS_DB.prepare(
    `SELECT COUNT(*) as total FROM properties p ${whereClause}`
  ).bind(...bindParams);

  const selectQuery = `
    SELECT p.*,
      (SELECT COUNT(*) FROM property_well_links pwl
       WHERE pwl.property_airtable_id = p.airtable_record_id
       AND pwl.status IN ('Active', 'Linked')) as linked_wells
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
    _linkedWells: row.linked_wells || 0,
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
  const body = await request.json();
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
  const planLimits = PLAN_LIMITS[plan] || { properties: 1, wells: 0 };
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
  
  // No OCC Map Link needed for properties
  
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
        Group: body.Group || "",
        Notes: body.Notes || "",
        "RI Acres": body['RI Acres'] || 0,
        "WI Acres": body['WI Acres'] || 0,
        "Monitor Adjacent": true,
        Status: "Active",
        ...(userOrganization && { Organization: [userOrganization] })
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
  console.log(`[PropertyCreate] New property record:`, JSON.stringify(newRecord, null, 2));
  
  // Trigger auto-matching in background
  if (newRecord.id && ctx) {
    console.log(`[PropertyCreate] Triggering auto-match for property: ${newRecord.id}`);
    
    const organizationId = userOrganization || undefined;
    const matchPromise = matchSingleProperty(newRecord.id, user.id, organizationId, env)
      .then(result => {
        console.log(`[PropertyCreate] Auto-match complete:`, result);
        if (result.linksCreated > 0) {
          console.log(`[PropertyCreate] Created ${result.linksCreated} links out of ${result.wellsChecked} wells checked`);
        }
      })
      .catch(err => {
        console.error('[PropertyCreate] Auto-match failed:', err);
        console.error('[PropertyCreate] Error details:', err.message, err.stack);
      });
    
    // Keep the worker alive until the match completes
    ctx.waitUntil(matchPromise);
  } else if (!newRecord.id) {
    console.error('[PropertyCreate] No ID in new record:', newRecord);
  } else if (!ctx) {
    console.error('[PropertyCreate] No ExecutionContext available for background matching');
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
  
  const body = await request.json();

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

  // Update Airtable (skip if only enterprise/D1-only fields changed)
  if (Object.keys(updateFields).length > 0) {
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
  }

  // Also write to D1 immediately so v2 endpoint reflects changes instantly
  if (d1Updates.length > 0 && env.WELLS_DB) {
    try {
      d1Updates.push('updated_at = datetime(\'now\')');
      const sql = `UPDATE properties SET ${d1Updates.join(', ')} WHERE airtable_record_id = ?`;
      d1Binds.push(propertyId);
      await env.WELLS_DB.prepare(sql).bind(...d1Binds).run();
    } catch (d1Err) {
      // Non-fatal — Airtable was updated, D1 will catch up on next sync
      console.error('[UpdateProperty] D1 write failed (non-fatal):', d1Err);
    }
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
export async function handleDeleteProperty(propertyId: string, request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Check permissions - only Admin and Editor can delete properties
  const userRecord = await getUserFromSession(env, user);
  if (userRecord?.fields.Organization?.[0] && userRecord.fields.Role === 'Viewer') {
    return jsonResponse({ error: "Viewers cannot delete properties" }, 403);
  }
  
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
  const deleteResponse = await fetch(deleteUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!deleteResponse.ok) {
    const error = await deleteResponse.text();
    console.error(`Failed to delete property ${propertyId}:`, error);
    return jsonResponse({ error: "Failed to delete property" }, 500);
  }
  
  console.log(`Property deleted: ${propertyId} by ${user.email}`);
  return jsonResponse({ success: true });
}