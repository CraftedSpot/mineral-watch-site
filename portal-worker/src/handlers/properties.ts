/**
 * Properties Handlers
 * 
 * Handles CRUD operations for user property monitoring
 */

import { 
  PROPERTIES_TABLE,
  BASE_ID,
  PLAN_LIMITS 
} from '../constants.js';

import { 
  jsonResponse 
} from '../utils/responses.js';

import {
  getUserById,
  getUserFromSession,
  countUserProperties,
  checkDuplicateProperty,
  fetchAllAirtableRecords
} from '../services/airtable.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import { matchSingleProperty } from '../utils/property-well-matching.js';
import { getOccFilingsForProperty } from '../utils/docket-matching.js';

import type { Env } from '../types/env.js';

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
  
  const userEmail = user.email.replace(/'/g, "\\'");

  if (organizationId) {
    // User has organization - need to get org name for the filter
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );

    if (orgResponse.ok) {
      const org = await orgResponse.json() as any;
      const orgName = (org.fields.Name || '').replace(/'/g, "\\'");
      // Filter by org name OR user email — properties uploaded via Airtable
      // may have User field set but Organization field empty
      const orgFind = `FIND('${orgName}', ARRAYJOIN({Organization}))`;
      const userFind = `FIND('${userEmail}', ARRAYJOIN({User}))`;
      formula = `OR(${orgFind} > 0, ${userFind} > 0)`;
    } else {
      formula = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
    }
  } else {
    formula = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
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
  
  // Count properties for user or organization
  const { countPropertiesForUserOrOrg } = await import('../services/airtable.js');
  const propertiesCount = await countPropertiesForUserOrOrg(env, userRecord);
  
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
  const isDuplicate = await checkDuplicateProperty(env, user.email, body.COUNTY, section, township, range);
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