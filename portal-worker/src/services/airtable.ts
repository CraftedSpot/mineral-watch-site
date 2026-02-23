/**
 * Airtable Service
 * 
 * Handles all Airtable API interactions for the Portal Worker
 * Provides functions for user management, property tracking, and well monitoring
 */

import { BASE_ID } from '../constants.js';
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

export interface SimplifiedWell {
  id: string;
  apiNumber: string;
  wellName: string;
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
      Role: row.role || null,
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
 * D1-only organization lookup.
 * Returns org notification settings needed by handleGetCurrentUser.
 */
export async function getOrganizationD1First(env: Env, orgId: string): Promise<{
  name: string | null;
  defaultNotificationMode: string;
  allowUserOverride: boolean;
} | null> {
  if (!env.WELLS_DB) return null;
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
    return null;
  } catch (e) {
    console.error('[Auth] D1 org lookup failed:', (e as Error).message);
    return null;
  }
}

/**
 * D1-only user lookup by email.
 */
export async function findUserByEmailD1First(env: Env, email: string): Promise<AirtableUser | null> {
  if (!env.WELLS_DB) return null;
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
    return null;
  } catch (e) {
    console.error('[Auth] D1 user lookup by email failed:', (e as Error).message);
    return null;
  }
}

/**
 * D1-only user lookup by Airtable record ID.
 * Used by authenticateRequest() on every API call — this is the critical path.
 */
export async function getUserByIdD1First(env: Env, userId: string): Promise<AirtableUser | null> {
  if (!env.WELLS_DB) return null;
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
    return null;
  } catch (e) {
    console.error('[Auth] D1 user lookup by id failed:', (e as Error).message);
    return null;
  }
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

