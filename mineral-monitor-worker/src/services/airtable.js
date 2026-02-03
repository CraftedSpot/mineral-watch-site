/**
 * Airtable Service - Handles Airtable API interactions
 * MIGRATED: Activity log now writes to D1 instead of Airtable
 * MIGRATED: Alert preloading now reads from D1 instead of Airtable
 *
 * Remaining Airtable usage:
 * - User lookups (for backward compatibility with other services)
 * - User preferences
 */

import {
  getUserById as d1GetUserById,
  getUserByEmail as d1GetUserByEmail,
  batchGetUsers as d1BatchGetUsers,
  preloadRecentAlerts as d1PreloadRecentAlerts,
  hasRecentAlertInSet as d1HasRecentAlertInSet,
  createActivityLog as d1CreateActivityLog,
  updateActivityLog as d1UpdateActivityLog
} from './d1.js';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

/**
 * Query Airtable with a filter formula
 * @param {Object} env - Worker environment
 * @param {string} tableId - Airtable table ID
 * @param {string} formula - Airtable filter formula
 * @returns {Array} - Matching records
 */
export async function queryAirtable(env, tableId, formula) {
  const url = new URL(`${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${tableId}`);
  url.searchParams.set('filterByFormula', formula);
  
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airtable query failed: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return data.records || [];
}

/**
 * Get a user by their Airtable record ID
 * MIGRATED: Now uses D1 instead of Airtable
 * @param {Object} env - Worker environment
 * @param {string} userId - Airtable record ID
 * @returns {Object|null} - User record or null
 */
export async function getUserById(env, userId) {
  return d1GetUserById(env, userId);
}

/**
 * Batch get multiple users by their Airtable record IDs
 * MIGRATED: Now uses D1 instead of Airtable
 * @param {Object} env - Worker environment
 * @param {string[]} userIds - Array of Airtable record IDs
 * @returns {Map<string, Object>} - Map of userId to user record
 */
export async function batchGetUsers(env, userIds) {
  return d1BatchGetUsers(env, userIds);
}

/**
 * Find a user by their email address
 * MIGRATED: Now uses D1 instead of Airtable
 * @param {Object} env - Worker environment
 * @param {string} email - User email
 * @returns {Object|null} - User record or null
 */
export async function findUserByEmail(env, email) {
  return d1GetUserByEmail(env, email);
}

/**
 * Preload all recent alerts from the last 7 days
 * Returns a Set for O(1) lookup instead of querying per-alert
 * MIGRATED: Now uses D1 instead of Airtable
 * @param {Object} env - Worker environment
 * @returns {Set<string>} - Set of "apiNumber|activityType|userId" keys
 */
export async function preloadRecentAlerts(env) {
  return d1PreloadRecentAlerts(env, 7);
}

/**
 * Check if alert exists using preloaded Set
 * (Pure function - no migration needed)
 * @param {Set<string>} alertSet - Preloaded alert set
 * @param {string} apiNumber - Well API number
 * @param {string} activityType - Type of activity
 * @param {string} userId - User's Airtable record ID
 * @returns {boolean} - Whether a recent alert exists
 */
export function hasRecentAlertInSet(alertSet, apiNumber, activityType, userId) {
  return d1HasRecentAlertInSet(alertSet, apiNumber, activityType, userId);
}

/**
 * Check if a user has been alerted about this API + activity type recently
 * DEPRECATED: Use preloadRecentAlerts() + hasRecentAlertInSet() for batch processing
 * Kept for backwards compatibility with weekly.js
 * @param {Object} env - Worker environment
 * @param {string} userEmail - User's email address
 * @param {string} apiNumber - Well API number
 * @param {string} activityType - Type of activity
 * @returns {boolean} - Whether a recent alert exists
 */
export async function hasRecentAlert(env, userEmail, apiNumber, activityType) {
  // First find the user by email to get their record ID
  const user = await findUserByEmail(env, userEmail);
  if (!user) return false;
  
  // Calculate 7 days ago
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const isoDate = sevenDaysAgo.toISOString().split('T')[0];
  
  // Query activity log for matching records
  const formula = `AND(
    {API Number} = "${apiNumber}",
    {Activity Type} = "${activityType}",
    IS_AFTER({Detected At}, "${isoDate}")
  )`;
  
  const activities = await queryAirtable(env, env.AIRTABLE_ACTIVITY_TABLE, formula);
  
  // Check if any of these activities are linked to this user
  return activities.some(activity => {
    const linkedUsers = activity.fields.User || [];
    return linkedUsers.includes(user.id);
  });
}

/**
 * Create a new activity log entry
 * MIGRATED: Now writes to D1 instead of Airtable
 * @param {Object} env - Worker environment
 * @param {Object} data - Activity data
 * @returns {Object} - Created record info
 */
export async function createActivityLog(env, data) {
  console.log(`[D1] Creating activity log for ${data.apiNumber} - ${data.activityType}`);

  const result = await d1CreateActivityLog(env, {
    userId: data.userId,
    organizationId: data.organizationId || null,
    apiNumber: data.apiNumber,
    wellName: data.wellName,
    operator: data.operator,
    previousOperator: data.previousOperator,
    activityType: data.activityType,
    alertLevel: data.alertLevel,
    previousValue: data.previousValue,
    newValue: data.newValue,
    county: data.county,
    sectionTownshipRange: data.sectionTownshipRange,
    formation: data.formation,
    occLink: data.occLink,
    mapLink: data.mapLink,
    emailSent: false,
    detectedAt: new Date().toISOString()
  });

  // Return in Airtable-like format for compatibility
  return {
    id: result.id,
    fields: {
      'Well Name': data.wellName,
      'API Number': data.apiNumber,
      'Activity Type': data.activityType,
      'Email Sent': false
    }
  };
}

/**
 * Update an activity log entry (e.g., mark email as sent)
 * MIGRATED: Now updates D1 instead of Airtable
 * @param {Object} env - Worker environment
 * @param {string|number} recordId - Activity log record ID
 * @param {Object} fields - Fields to update
 * @returns {Object} - Update result
 */
export async function updateActivityLog(env, recordId, fields) {
  // Map Airtable field names to D1 updates
  const updates = {};
  if (fields['Email Sent'] !== undefined) {
    updates.emailSent = fields['Email Sent'];
  }

  return d1UpdateActivityLog(env, recordId, updates);
}

/**
 * Extract user alert preferences from a user record
 * All preferences default to true if not set
 * @param {Object} user - Airtable user record
 * @returns {Object} - Normalized preferences object
 */
export function getUserPreferences(user) {
  const fields = user?.fields || {};
  return {
    alertPermits: fields['Alert Permits'] !== false,
    alertCompletions: fields['Alert Completions'] !== false,
    alertStatusChanges: fields['Alert Status Changes'] !== false,
    alertExpirations: fields['Alert Expirations'] !== false,
    alertOperatorTransfers: fields['Alert Operator Transfers'] !== false,
    expirationWarningDays: fields['Expiration Warning Days'] || 30
  };
}

/**
 * Check if a user wants to receive a specific type of alert
 * @param {Object} user - Airtable user record
 * @param {string} activityType - Type of activity: 'New Permit', 'Well Completed', 'Status Change', 'Permit Expiring', 'Permit Expired', 'Operator Transfer'
 * @returns {boolean} - Whether to send the alert
 */
export function userWantsAlert(user, activityType) {
  const prefs = getUserPreferences(user);

  switch (activityType) {
    case 'New Permit':
      return prefs.alertPermits;
    case 'Well Completed':
      return prefs.alertCompletions;
    case 'Status Change':
      return prefs.alertStatusChanges;
    case 'Permit Expiring':
    case 'Permit Expired':
      return prefs.alertExpirations;
    case 'Operator Transfer':
      return prefs.alertOperatorTransfers;
    default:
      // Unknown types default to sending
      return true;
  }
}

/**
 * Get notification overrides for all active users from Airtable.
 * D1's notification_override column may be stale, so we query Airtable
 * directly for the source-of-truth preference.
 *
 * @param {Object} env - Worker environment
 * @returns {Map<string, string>} - Map of Airtable record ID -> notification override value
 */
export async function getUserNotificationOverrides(env) {
  const overrides = new Map();
  let offset = null;

  do {
    let url = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_USERS_TABLE}`;
    url += `?fields[]=Notification Override`;
    url += `&filterByFormula={Status}='Active'`;
    url += `&pageSize=100`;
    if (offset) {
      url += `&offset=${encodeURIComponent(offset)}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Airtable] Failed to fetch notification overrides: ${response.status} - ${error}`);
      break;
    }

    const data = await response.json();
    for (const record of (data.records || [])) {
      const override = record.fields?.['Notification Override'];
      if (override) {
        overrides.set(record.id, override);
      }
    }

    offset = data.offset || null;
  } while (offset);

  console.log(`[Airtable] Fetched notification overrides: ${overrides.size} users with overrides`);
  return overrides;
}
