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
    // Alert preferences (populated from D1, may be absent from Airtable responses)
    'Alert Permits'?: boolean;
    'Alert Completions'?: boolean;
    'Alert Status Changes'?: boolean;
    'Alert Expirations'?: boolean;
    'Alert Operator Transfers'?: boolean;
    'Expiration Warning Days'?: number;
    'Notification Override'?: string;
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
  const data: any = await response.json();
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

  // Otherwise, fall back to D1-first lookup
  return getUserByIdD1First(env, sessionUser.id);
}

/**
 * Convert a D1 users row to AirtableUser shape.
 * Allows all existing handlers to work unchanged — they expect { id, fields: { ... } }.
 */
function d1RowToAirtableUser(row: any): AirtableUser {
  return {
    id: row.airtable_record_id,
    fields: {
      Email: row.email,
      Name: row.name,
      Plan: row.plan || 'Free',
      Status: row.status || 'Active',
      Organization: row.organization_id ? [row.organization_id] : [],
      Role: row.role || 'Viewer',
      'Stripe Customer ID': row.stripe_customer_id || undefined,
      // Alert preferences — D1 stores as INTEGER (0/1), convert to boolean
      'Alert Permits': row.alert_permits !== 0,
      'Alert Completions': row.alert_completions !== 0,
      'Alert Status Changes': row.alert_status_changes !== 0,
      'Alert Expirations': row.alert_expirations !== 0,
      'Alert Operator Transfers': row.alert_operator_transfers !== 0,
      'Expiration Warning Days': row.expiration_warning_days || 30,
      'Notification Override': row.notification_override || undefined
    }
  };
}

/**
 * D1-first organization lookup with Airtable fallback.
 * Returns org notification settings needed by handleGetCurrentUser.
 */
export async function getOrganizationD1First(env: Env, orgId: string): Promise<{
  name: string | null;
  defaultNotificationMode: string;
  allowUserOverride: boolean;
} | null> {
  // Try D1 first
  if (env.WELLS_DB) {
    try {
      const row = await env.WELLS_DB.prepare(
        `SELECT name, default_notification_mode, allow_user_override
         FROM organizations WHERE airtable_record_id = ? LIMIT 1`
      ).bind(orgId).first();

      if (row) {
        return {
          name: row.name as string | null,
          defaultNotificationMode: (row.default_notification_mode as string) || 'Daily + Weekly',
          allowUserOverride: (row.allow_user_override as number) !== 0
        };
      }
    } catch (e) {
      console.warn('[Auth] D1 org lookup failed, trying Airtable:', (e as Error).message);
    }
  }

  // Airtable fallback
  try {
    const resp = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${orgId}`,
      { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
    );
    if (resp.ok) {
      const org: any = await resp.json();
      return {
        name: org.fields['Name'] || null,
        defaultNotificationMode: org.fields['Default Notification Mode'] || 'Daily + Weekly',
        allowUserOverride: org.fields['Allow User Override'] !== false
      };
    }
    return null;
  } catch (e) {
    console.error('[Auth] Airtable org fallback also failed:', (e as Error).message);
    return null;
  }
}

/**
 * D1-first user lookup by email with Airtable fallback.
 * Survives Airtable outages for existing users. Falls back to Airtable
 * for brand-new users before JIT sync (shouldn't happen in practice).
 */
export async function findUserByEmailD1First(env: Env, email: string): Promise<AirtableUser | null> {
  // 1. Try D1
  if (env.WELLS_DB) {
    try {
      const row = await env.WELLS_DB.prepare(
        `SELECT airtable_record_id, email, name, plan, status,
                organization_id, role, stripe_customer_id,
                alert_permits, alert_completions, alert_status_changes,
                alert_expirations, alert_operator_transfers,
                expiration_warning_days, notification_override
         FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`
      ).bind(email).first();
      if (row) return d1RowToAirtableUser(row);
    } catch (e) {
      console.warn('[Auth] D1 user lookup failed, trying Airtable:', (e as Error).message);
    }
  }
  // 2. Fallback to Airtable (handles brand-new users before JIT sync)
  try {
    return await findUserByEmail(env, email);
  } catch (e) {
    console.error('[Auth] Airtable fallback also failed:', (e as Error).message);
    return null;
  }
}

/**
 * D1-first user lookup by Airtable record ID with Airtable fallback.
 * Used by authenticateRequest() on every API call — this is the critical path.
 */
export async function getUserByIdD1First(env: Env, userId: string): Promise<AirtableUser | null> {
  // 1. Try D1
  if (env.WELLS_DB) {
    try {
      const row = await env.WELLS_DB.prepare(
        `SELECT airtable_record_id, email, name, plan, status,
                organization_id, role, stripe_customer_id,
                alert_permits, alert_completions, alert_status_changes,
                alert_expirations, alert_operator_transfers,
                expiration_warning_days, notification_override
         FROM users WHERE airtable_record_id = ? LIMIT 1`
      ).bind(userId).first();
      if (row) return d1RowToAirtableUser(row);
    } catch (e) {
      console.warn('[Auth] D1 user lookup failed, trying Airtable:', (e as Error).message);
    }
  }
  // 2. Fallback to Airtable
  return getUserById(env, userId);
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
  const data: any = await response.json();
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
  const data: any = await response.json();
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
  const data: any = await response.json();
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
  const data: any = await response.json();
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
  const data: any = await response.json();
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
  const data: any = await response.json();
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
    ? `SELECT COUNT(*) as cnt FROM properties WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
    : `SELECT COUNT(*) as cnt FROM properties WHERE user_id = ?`;
  const params = organizationId ? [organizationId, organizationId] : [userId];
  const result = await env.WELLS_DB.prepare(q).bind(...params).first();
  return (result as any)?.cnt || 0;
}

/** Count wells via D1 (indexed, <10ms) */
export async function countUserWellsD1(env: Env, userId: string, organizationId?: string): Promise<number> {
  if (!env.WELLS_DB) return 0;
  const q = organizationId
    ? `SELECT COUNT(*) as cnt FROM client_wells WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
    : `SELECT COUNT(*) as cnt FROM client_wells WHERE user_id = ?`;
  const params = organizationId ? [organizationId, organizationId] : [userId];
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
    ? `(organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
    : `user_id = ?`;
  const ownerParams = organizationId ? [organizationId, organizationId] : [userId];
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
    ? `(organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
    : `user_id = ?`;
  const ownerParams = organizationId ? [organizationId, organizationId] : [userId];
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
    ? `SELECT airtable_id, api_number, well_name FROM client_wells WHERE (organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
    : `SELECT airtable_id, api_number, well_name FROM client_wells WHERE user_id = ?`;
  const params = organizationId ? [organizationId, organizationId] : [userId];
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
    
    const data: any = await response.json();
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