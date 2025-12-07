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
  countUserProperties,
  checkDuplicateProperty,
  fetchAllAirtableRecords
} from '../services/airtable.js';

import {
  authenticateRequest
} from '../utils/auth.js';

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
  
  const formula = `FIND('${user.email}', ARRAYJOIN({User})) > 0`;
  const records = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, formula);
  
  return jsonResponse(records);
}

/**
 * Add a new property for the authenticated user
 * @param request The incoming request with property data
 * @param env Worker environment
 * @returns JSON response with created property
 */
export async function handleAddProperty(request: Request, env: Env) {
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
        "OCC Map Link": occMapLink,
        "Monitor Adjacent": true,
        Status: "Active"
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