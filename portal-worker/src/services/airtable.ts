/**
 * Airtable Service
 * 
 * Handles all Airtable API interactions for the Portal Worker
 * Provides functions for user management, property tracking, and well monitoring
 */

import {
  BASE_ID,
  USERS_TABLE,
  PROPERTIES_TABLE,
  WELLS_TABLE,
  ORGANIZATION_TABLE
} from '../constants.js';

import { escapeAirtableValue } from '../utils/airtable-escape.js';
import type { Env } from '../types/env.js';

/**
 * Enhanced type definitions for Airtable records
 */
export interface AirtableUser {
  id: string;
  fields: {
    Email: string;
    Name?: string;
    Plan?: string;
    Organization?: string[];
    Role?: string;
    'Stripe Customer ID'?: string;
    Status?: string;
    'Created Time'?: string;
  };
}

export interface AirtableProperty {
  id: string;
  fields: {
    SEC: string;
    TWN: string;
    RNG: string;
    MERIDIAN?: string;
    COUNTY?: string;
    User?: string[];
    'User Email'?: string;
  };
}

export interface AirtableWell {
  id: string;
  fields: {
    'API Number': string;
    'Well Name'?: string;
    User?: string[];
  };
}

export interface SimplifiedProperty {
  SEC: string;
  TWN: string;
  RNG: string;
  MERIDIAN: string;
  GROUP: string;
}

export interface SimplifiedWell {
  id: string;
  apiNumber: string;
  wellName: string;
}

/**
 * Find a user by their email address
 * @param env Worker environment
 * @param email User's email address
 * @returns User record or null if not found
 */
export async function findUserByEmail(env: Env, email: string): Promise<AirtableUser | null> {
  const formula = `LOWER({Email}) = '${escapeAirtableValue(email.toLowerCase())}'`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) throw new Error(`Airtable error: ${response.status}`);
  const data = await response.json();
  return data.records?.[0] || null;
}

/**
 * Get a user by their Airtable record ID
 * @param env Worker environment
 * @param userId Airtable user record ID
 * @returns User object or null if not found
 */
export async function getUserById(env: Env, userId: string): Promise<AirtableUser | null> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return null;
  return await response.json();
}

/**
 * Get user from session data or fallback to Airtable API
 * This helper reduces redundant API calls by using the airtableUser from session when available
 * @param env Worker environment
 * @param sessionUser Session user data from authenticateRequest
 * @returns Full Airtable user record
 */
export async function getUserFromSession(env: Env, sessionUser: any): Promise<AirtableUser | null> {
  // If session includes the full airtableUser, use it
  if (sessionUser.airtableUser) {
    return sessionUser.airtableUser;
  }
  
  // Otherwise, fall back to API call (for backwards compatibility)
  return getUserById(env, sessionUser.id);
}

/**
 * Count the number of properties for a user (including organization properties)
 * @param env Worker environment
 * @param userEmail User's email address
 * @returns Number of properties
 */
export async function countUserProperties(env: Env, userEmail: string): Promise<number> {
  // First get the user to check for organization
  const user = await findUserByEmail(env, userEmail);
  if (!user) return 0;
  
  const userOrganizations = user.fields.Organization || [];
  
  let formula: string;
  if (userOrganizations.length > 0) {
    // User is part of an organization - count both personal and org properties
    const orgId = userOrganizations[0];
    formula = `OR(FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0, FIND('${escapeAirtableValue(orgId)}', ARRAYJOIN({Organization})) > 0)`;
  } else {
    // No organization - count only personal properties
    formula = `FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0`;
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=SEC`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return 0;
  const data = await response.json();
  return data.records?.length || 0;
}

/**
 * Count the number of wells for a user (including organization wells)
 * @param env Worker environment
 * @param userEmail User's email address
 * @returns Number of wells
 */
export async function countUserWells(env: Env, userEmail: string): Promise<number> {
  // First get the user to check for organization
  const user = await findUserByEmail(env, userEmail);
  if (!user) return 0;
  
  const userOrganizations = user.fields.Organization || [];
  
  let formula: string;
  if (userOrganizations.length > 0) {
    // User is part of an organization - count both personal and org wells
    const orgId = userOrganizations[0];
    formula = `OR(FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0, FIND('${escapeAirtableValue(orgId)}', ARRAYJOIN({Organization})) > 0)`;
  } else {
    // No organization - count only personal wells
    formula = `FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0`;
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=API Number`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return 0;
  const data = await response.json();
  return data.records?.length || 0;
}

/**
 * Count properties for a user or their organization
 * @param env Worker environment
 * @param userRecord Full user record with organization info
 * @returns Number of properties
 */
export async function countPropertiesForUserOrOrg(env: Env, userRecord: AirtableUser): Promise<number> {
  let formula: string;
  const organizationId = userRecord.fields.Organization?.[0];
  
  if (organizationId) {
    // Fetch organization name
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (orgResponse.ok) {
      const org = await orgResponse.json() as any;
      formula = `{Organization} = '${escapeAirtableValue(org.fields.Name)}'`;
    } else {
      // Fallback to email
      formula = `{User Email} = '${escapeAirtableValue(userRecord.fields.Email)}'`;
    }
  } else {
    formula = `{User Email} = '${escapeAirtableValue(userRecord.fields.Email)}'`;
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=SEC`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return 0;
  const data = await response.json();
  return data.records?.length || 0;
}

/**
 * Count wells for a user or their organization
 * @param env Worker environment
 * @param userRecord Full user record with organization info
 * @returns Number of wells
 */
export async function countWellsForUserOrOrg(env: Env, userRecord: AirtableUser): Promise<number> {
  let formula: string;
  const organizationId = userRecord.fields.Organization?.[0];
  
  if (organizationId) {
    // Fetch organization name
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (orgResponse.ok) {
      const org = await orgResponse.json() as any;
      formula = `{Organization} = '${escapeAirtableValue(org.fields.Name)}'`;
    } else {
      // Fallback to email
      formula = `FIND('${escapeAirtableValue(userRecord.fields.Email)}', ARRAYJOIN({User})) > 0`;
    }
  } else {
    formula = `FIND('${escapeAirtableValue(userRecord.fields.Email)}', ARRAYJOIN({User})) > 0`;
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=API Number`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return 0;
  const data = await response.json();
  return data.records?.length || 0;
}

/**
 * Check if a property is already tracked by a user (duplicate detection)
 * @param env Worker environment
 * @param userEmail User's email address
 * @param county County name
 * @param section Section number
 * @param township Township
 * @param range Range
 * @returns True if duplicate exists, false otherwise
 */
export async function checkDuplicateProperty(env: Env, userEmail: string, county: string, section: string, township: string, range: string): Promise<boolean> {
  const formula = `AND(FIND('${escapeAirtableValue(userEmail)}', ARRAYJOIN({User})) > 0, {COUNTY} = '${escapeAirtableValue(county)}', {SEC} = '${escapeAirtableValue(section)}', {TWN} = '${escapeAirtableValue(township)}', {RNG} = '${escapeAirtableValue(range)}')`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.records?.length > 0;
}

/**
 * Check if a well is already tracked by a user (duplicate detection)
 * @param env Worker environment
 * @param userEmail User's email address
 * @param apiNumber Well API number
 * @returns True if duplicate exists, false otherwise
 */
export async function checkDuplicateWell(env: Env, userEmail: string, apiNumber: string): Promise<boolean> {
  const formula = `AND(FIND('${escapeAirtableValue(userEmail)}', ARRAYJOIN({User})) > 0, {API Number} = '${escapeAirtableValue(apiNumber)}')`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.records?.length > 0;
}

// ============================================================================
// D1 Query Functions — indexed, <10ms replacements for Airtable round trips
// All callers pass user.id + organizationId directly (no findUserByEmail needed)
// ============================================================================

/** Count properties via D1 (indexed, <10ms) */
export async function countUserPropertiesD1(env: Env, userId: string, organizationId?: string): Promise<number> {
  if (!env.WELLS_DB) return 0;
  const q = organizationId
    ? `SELECT COUNT(*) as cnt FROM properties WHERE user_id = ? OR organization_id = ?`
    : `SELECT COUNT(*) as cnt FROM properties WHERE user_id = ?`;
  const params = organizationId ? [userId, organizationId] : [userId];
  const result = await env.WELLS_DB.prepare(q).bind(...params).first();
  return (result as any)?.cnt || 0;
}

/** Count wells via D1 (indexed, <10ms) */
export async function countUserWellsD1(env: Env, userId: string, organizationId?: string): Promise<number> {
  if (!env.WELLS_DB) return 0;
  const q = organizationId
    ? `SELECT COUNT(*) as cnt FROM client_wells WHERE user_id = ? OR organization_id = ?`
    : `SELECT COUNT(*) as cnt FROM client_wells WHERE user_id = ?`;
  const params = organizationId ? [userId, organizationId] : [userId];
  const result = await env.WELLS_DB.prepare(q).bind(...params).first();
  return (result as any)?.cnt || 0;
}

/** Check duplicate property via D1 (indexed, <10ms) */
export async function checkDuplicatePropertyD1(
  env: Env, userId: string, organizationId: string | undefined,
  county: string, section: string, township: string, range: string
): Promise<boolean> {
  if (!env.WELLS_DB) return false;
  const ownerClause = organizationId
    ? `(user_id = ? OR organization_id = ?)`
    : `user_id = ?`;
  const ownerParams = organizationId ? [userId, organizationId] : [userId];
  const result = await env.WELLS_DB.prepare(
    `SELECT 1 FROM properties WHERE ${ownerClause} AND county = ? AND section = ? AND township = ? AND range = ? LIMIT 1`
  ).bind(...ownerParams, county, section, township, range).first();
  return !!result;
}

/** Check duplicate well via D1 (indexed, <10ms) */
export async function checkDuplicateWellD1(
  env: Env, userId: string, organizationId: string | undefined, apiNumber: string
): Promise<boolean> {
  if (!env.WELLS_DB) return false;
  const ownerClause = organizationId
    ? `(user_id = ? OR organization_id = ?)`
    : `user_id = ?`;
  const ownerParams = organizationId ? [userId, organizationId] : [userId];
  const result = await env.WELLS_DB.prepare(
    `SELECT 1 FROM client_wells WHERE ${ownerClause} AND api_number = ? LIMIT 1`
  ).bind(...ownerParams, apiNumber).first();
  return !!result;
}

/** Fetch user wells for duplicate checking via D1 (single query, <50ms) */
export async function fetchUserWellsD1(
  env: Env, userId: string, organizationId?: string
): Promise<SimplifiedWell[]> {
  if (!env.WELLS_DB) return [];
  const q = organizationId
    ? `SELECT airtable_id, api_number, well_name FROM client_wells WHERE user_id = ? OR organization_id = ?`
    : `SELECT airtable_id, api_number, well_name FROM client_wells WHERE user_id = ?`;
  const params = organizationId ? [userId, organizationId] : [userId];
  const result = await env.WELLS_DB.prepare(q).bind(...params).all();
  return (result.results || []).map((r: any) => ({
    id: r.airtable_id || '',
    apiNumber: r.api_number || '',
    wellName: r.well_name || ''
  }));
}

/**
 * Fetch all records from an Airtable table with pagination support
 * @param env Worker environment
 * @param table Table name
 * @param formula Filter formula
 * @returns Array of all matching records
 */
export async function fetchAllAirtableRecords(env: Env, table: string, formula: string): Promise<any[]> {
  let allRecords: any[] = [];
  let offset: string | null = null;
  
  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}`;
    if (offset) {
      url += `&offset=${offset}`;
    }
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Airtable fetch error for ${table}:`, errText);
      throw new Error(`Airtable error: ${response.status}`);
    }
    
    const data = await response.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset; // Will be undefined when no more pages
    
  } while (offset);
  
  return allRecords;
}

/**
 * Fetch all properties for a user (including organization properties)
 * @param env Worker environment
 * @param userEmail User's email address
 * @returns Array of simplified property objects
 */
export async function fetchUserProperties(env: Env, userEmail: string): Promise<SimplifiedProperty[]> {
  const user = await findUserByEmail(env, userEmail);
  if (!user) return [];

  const userOrganizations = user.fields.Organization || [];

  let formula: string;
  if (userOrganizations.length > 0) {
    const orgId = userOrganizations[0];
    formula = `OR(FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0, FIND('${escapeAirtableValue(orgId)}', ARRAYJOIN({Organization})) > 0)`;
  } else {
    formula = `FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0`;
  }

  const allRecords: SimplifiedProperty[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ filterByFormula: formula });
    if (offset) params.set('offset', offset);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    });

    if (!response.ok) break;

    const data: any = await response.json();
    for (const r of data.records) {
      allRecords.push({
        SEC: r.fields.SEC,
        TWN: r.fields.TWN,
        RNG: r.fields.RNG,
        MERIDIAN: r.fields.MERIDIAN || 'IM',
        GROUP: r.fields.Group || ''
      });
    }
    offset = data.offset;
  } while (offset);

  return allRecords;
}

/**
 * Fetch all wells for a user (including organization wells)
 * Returns minimal data for duplicate checking during bulk upload.
 *
 * Note: For full well data with D1 metadata, use /api/wells/v2 endpoint instead.
 *
 * @param env Worker environment
 * @param userEmail User's email address
 * @returns Array of simplified well objects (id, apiNumber, wellName)
 */
export async function fetchUserWells(env: Env, userEmail: string): Promise<SimplifiedWell[]> {
  const user = await findUserByEmail(env, userEmail);
  if (!user) return [];

  const userOrganizations = user.fields.Organization || [];

  let formula: string;
  if (userOrganizations.length > 0) {
    const orgId = userOrganizations[0];
    formula = `OR(FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0, FIND('${escapeAirtableValue(orgId)}', ARRAYJOIN({Organization})) > 0)`;
  } else {
    formula = `FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0`;
  }

  const allRecords: SimplifiedWell[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ filterByFormula: formula });
    if (offset) params.set('offset', offset);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    });

    if (!response.ok) break;

    const data: any = await response.json();
    for (const r of data.records) {
      allRecords.push({
        id: r.id,
        apiNumber: r.fields["API Number"] || '',
        wellName: r.fields["Well Name"] || ''
      });
    }
    offset = data.offset;
  } while (offset);

  return allRecords;
}