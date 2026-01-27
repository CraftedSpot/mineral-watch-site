/**
 * D1 Query Service - Handles all D1 database interactions
 * Replaces Airtable queries for users, properties, wells, and activity log
 *
 * Key: user_id fields store Airtable record IDs (rec...) for compatibility
 */

/**
 * Get a user by their Airtable record ID
 * @param {Object} env - Worker environment with WELLS_DB
 * @param {string} airtableId - Airtable record ID (rec...)
 * @returns {Object|null} - User record or null
 */
export async function getUserById(env, airtableId) {
  if (!airtableId) return null;

  const result = await env.WELLS_DB.prepare(`
    SELECT * FROM users WHERE airtable_record_id = ?
  `).bind(airtableId).first();

  return result ? transformUserToAirtableFormat(result) : null;
}

/**
 * Get a user by email address
 * @param {Object} env - Worker environment
 * @param {string} email - User email
 * @returns {Object|null} - User record or null
 */
export async function getUserByEmail(env, email) {
  if (!email) return null;

  const result = await env.WELLS_DB.prepare(`
    SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND status = 'Active'
  `).bind(email).first();

  return result ? transformUserToAirtableFormat(result) : null;
}

/**
 * Batch get users by their Airtable record IDs
 * @param {Object} env - Worker environment
 * @param {string[]} airtableIds - Array of Airtable record IDs
 * @returns {Map<string, Object>} - Map of airtableId to user record
 */
export async function batchGetUsers(env, airtableIds) {
  const uniqueIds = [...new Set(airtableIds.filter(id => id))];
  const userMap = new Map();

  if (uniqueIds.length === 0) return userMap;

  // D1 supports up to 100 parameters, chunk if needed
  const CHUNK_SIZE = 100;

  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');

    const results = await env.WELLS_DB.prepare(`
      SELECT * FROM users
      WHERE airtable_record_id IN (${placeholders})
      AND status = 'Active'
    `).bind(...chunk).all();

    for (const user of results.results) {
      userMap.set(user.airtable_record_id, transformUserToAirtableFormat(user));
    }
  }

  console.log(`[D1] Batch loaded ${userMap.size} users from ${uniqueIds.length} IDs`);
  return userMap;
}

/**
 * Find properties by exact S-T-R-M location
 * @param {Object} env - Worker environment
 * @param {Object} location - Section, Township, Range, Meridian
 * @returns {Array} - Properties with user info
 */
export async function getPropertiesByLocation(env, location) {
  const { section, township, range, meridian } = location;

  const results = await env.WELLS_DB.prepare(`
    SELECT p.*, u.email as user_email, u.name as user_name, u.airtable_record_id as user_airtable_id
    FROM properties p
    LEFT JOIN users u ON u.airtable_record_id = p.user_id
    WHERE p.section = ? AND p.township = ? AND p.range = ? AND p.meridian = ?
    AND p.status = 'Active'
  `).bind(section, township, range, meridian).all();

  return results.results.map(transformPropertyToAirtableFormat);
}

/**
 * Batch load properties for multiple locations
 * @param {Object} env - Worker environment
 * @param {Array} locations - Array of {section, township, range, meridian}
 * @returns {Array} - All matching properties
 */
export async function batchGetPropertiesByLocations(env, locations) {
  if (!locations || locations.length === 0) return [];

  // Build OR conditions for all locations
  const conditions = locations.map(() =>
    '(p.section = ? AND p.township = ? AND p.range = ? AND p.meridian = ?)'
  ).join(' OR ');

  const bindings = locations.flatMap(loc => [
    loc.section, loc.township, loc.range, loc.meridian
  ]);

  const results = await env.WELLS_DB.prepare(`
    SELECT p.*, u.email as user_email, u.name as user_name, u.airtable_record_id as user_airtable_id
    FROM properties p
    LEFT JOIN users u ON u.airtable_record_id = p.user_id
    WHERE (${conditions})
    AND p.status = 'Active'
  `).bind(...bindings).all();

  console.log(`[D1] Batch loaded ${results.results.length} properties for ${locations.length} locations`);
  return results.results.map(transformPropertyToAirtableFormat);
}

/**
 * Find properties in adjacent sections with monitor_adjacent enabled
 * @param {Object} env - Worker environment
 * @param {Array} adjacentSections - Array of {section, township, range}
 * @param {string} meridian - Meridian (IM or CM)
 * @returns {Array} - Properties with monitor_adjacent enabled
 */
export async function getAdjacentProperties(env, adjacentSections, meridian) {
  if (!adjacentSections || adjacentSections.length === 0) return [];

  const conditions = adjacentSections.map(() =>
    '(p.section = ? AND p.township = ? AND p.range = ?)'
  ).join(' OR ');

  const bindings = adjacentSections.flatMap(s => [s.section, s.township, s.range]);

  const results = await env.WELLS_DB.prepare(`
    SELECT p.*, u.email as user_email, u.name as user_name, u.airtable_record_id as user_airtable_id
    FROM properties p
    LEFT JOIN users u ON u.airtable_record_id = p.user_id
    WHERE (${conditions})
    AND p.meridian = ?
    AND p.monitor_adjacent = 1
    AND p.status = 'Active'
  `).bind(...bindings, meridian).all();

  return results.results.map(transformPropertyToAirtableFormat);
}

/**
 * Find tracked wells by API number
 * @param {Object} env - Worker environment
 * @param {string} apiNumber - 10-digit API number
 * @returns {Array} - Client wells with user info
 */
export async function getWellsByApiNumber(env, apiNumber) {
  if (!apiNumber) return [];

  const results = await env.WELLS_DB.prepare(`
    SELECT cw.*, u.email as user_email, u.name as user_name, u.airtable_record_id as user_airtable_id
    FROM client_wells cw
    LEFT JOIN users u ON u.airtable_record_id = cw.user_id
    WHERE cw.api_number = ? AND cw.status = 'Active'
  `).bind(apiNumber).all();

  return results.results.map(transformWellToAirtableFormat);
}

/**
 * Get organization by Airtable record ID
 * @param {Object} env - Worker environment
 * @param {string} airtableId - Airtable record ID
 * @returns {Object|null} - Organization record
 */
export async function getOrganizationById(env, airtableId) {
  if (!airtableId) return null;

  const result = await env.WELLS_DB.prepare(`
    SELECT * FROM organizations WHERE airtable_record_id = ?
  `).bind(airtableId).first();

  return result ? transformOrgToAirtableFormat(result) : null;
}

/**
 * Get all active members of an organization
 * @param {Object} env - Worker environment
 * @param {string} orgAirtableId - Organization's Airtable record ID
 * @returns {Array} - User records
 */
export async function getOrganizationMembers(env, orgAirtableId) {
  if (!orgAirtableId) return [];

  const results = await env.WELLS_DB.prepare(`
    SELECT * FROM users
    WHERE organization_id = ? AND status = 'Active'
  `).bind(orgAirtableId).all();

  return results.results.map(transformUserToAirtableFormat);
}

/**
 * Preload recent alerts from the last N days for deduplication
 * @param {Object} env - Worker environment
 * @param {number} days - Number of days to look back (default 7)
 * @returns {Set<string>} - Set of "apiNumber|activityType|userId" keys
 */
export async function preloadRecentAlerts(env, days = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const isoDate = cutoffDate.toISOString();

  console.log(`[D1] Preloading alerts since ${isoDate}`);

  const results = await env.WELLS_DB.prepare(`
    SELECT api_number, activity_type, user_id
    FROM activity_log
    WHERE detected_at > ?
  `).bind(isoDate).all();

  const alertSet = new Set();

  for (const activity of results.results) {
    // Key format: "apiNumber|activityType|userId"
    const key = `${activity.api_number}|${activity.activity_type}|${activity.user_id}`;
    alertSet.add(key);
  }

  console.log(`[D1] Preloaded ${alertSet.size} recent alert keys from ${results.results.length} activity records`);
  return alertSet;
}

/**
 * Check if alert exists using preloaded Set
 * @param {Set<string>} alertSet - Preloaded alert set
 * @param {string} apiNumber - Well API number
 * @param {string} activityType - Type of activity
 * @param {string} userId - User's Airtable record ID
 * @returns {boolean} - Whether a recent alert exists
 */
export function hasRecentAlertInSet(alertSet, apiNumber, activityType, userId) {
  const key = `${apiNumber}|${activityType}|${userId}`;
  return alertSet.has(key);
}

/**
 * Create a new activity log entry in D1
 * @param {Object} env - Worker environment
 * @param {Object} data - Activity data
 * @returns {Object} - Created record info
 */
export async function createActivityLog(env, data) {
  const detectedAt = data.detectedAt || new Date().toISOString();

  const result = await env.WELLS_DB.prepare(`
    INSERT INTO activity_log (
      user_id, organization_id, api_number, well_name, operator,
      previous_operator, activity_type, alert_level, previous_value, new_value,
      county, str_location, formation, occ_link, occ_map_link, map_link,
      email_sent, detected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.userId,
    data.organizationId || null,
    data.apiNumber,
    data.wellName,
    data.operator,
    data.previousOperator || null,
    data.activityType,
    data.alertLevel,
    data.previousValue || null,
    data.newValue || null,
    data.county || null,
    data.sectionTownshipRange || null,
    data.formation || null,
    data.occLink || null,
    data.mapLink || null,
    data.apiNumber ? `https://portal.mymineralwatch.com/map?well=${data.apiNumber}` : null,
    data.emailSent ? 1 : 0,
    detectedAt
  ).run();

  console.log(`[D1] Created activity log for ${data.apiNumber} - ${data.activityType} - user ${data.userId}`);

  return {
    id: result.meta.last_row_id,
    success: result.success
  };
}

/**
 * Update activity log entry (e.g., mark email as sent)
 * @param {Object} env - Worker environment
 * @param {number} recordId - Activity log record ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - Update result
 */
export async function updateActivityLog(env, recordId, updates) {
  if (updates.emailSent !== undefined) {
    const result = await env.WELLS_DB.prepare(`
      UPDATE activity_log SET email_sent = ? WHERE id = ?
    `).bind(updates.emailSent ? 1 : 0, recordId).run();

    return { success: result.success };
  }

  return { success: false, error: 'No valid updates provided' };
}

// ============================================================================
// Transform functions - Convert D1 rows to Airtable-like format for compatibility
// ============================================================================

/**
 * Transform D1 user row to Airtable-like format
 */
function transformUserToAirtableFormat(row) {
  return {
    id: row.airtable_record_id, // Use Airtable ID as the primary ID for compatibility
    fields: {
      Email: row.email,
      Name: row.name,
      Plan: row.plan,
      Status: row.status,
      Organization: row.organization_id ? [row.organization_id] : [],
      'Alert Permits': row.alert_permits === 1,
      'Alert Completions': row.alert_completions === 1,
      'Alert Status Changes': row.alert_status_changes === 1,
      'Alert Expirations': row.alert_expirations === 1,
      'Alert Operator Transfers': row.alert_operator_transfers === 1,
      'Expiration Warning Days': row.expiration_warning_days || 30,
      'Stripe Customer ID': row.stripe_customer_id,
      'Stripe Subscription ID': row.stripe_subscription_id
    },
    // Include raw D1 data for direct access
    _d1: row
  };
}

/**
 * Transform D1 property row to Airtable-like format
 */
function transformPropertyToAirtableFormat(row) {
  return {
    id: row.airtable_record_id,
    fields: {
      SEC: row.section,
      TWN: row.township,
      RNG: row.range,
      MERIDIAN: row.meridian,
      COUNTY: row.county,
      Acres: row.acres,
      'Net Acres': row.net_acres,
      'RI Acres': row.ri_acres,
      'WI Acres': row.wi_acres,
      Notes: row.notes,
      Owner: row.owner,
      Group: row.group_name,
      Status: row.status,
      'Monitor Adjacent': row.monitor_adjacent === 1,
      'OCC Map Link': row.occ_map_link,
      User: row.user_id ? [row.user_id] : [],
      Organization: row.organization_id ? [row.organization_id] : []
    },
    // Include joined user data
    _user: row.user_email ? {
      id: row.user_airtable_id,
      email: row.user_email,
      name: row.user_name
    } : null,
    _d1: row
  };
}

/**
 * Transform D1 client_well row to Airtable-like format
 */
function transformWellToAirtableFormat(row) {
  return {
    id: row.airtable_id,
    fields: {
      'API Number': row.api_number,
      'Well Name': row.well_name,
      Operator: row.operator,
      County: row.county,
      SEC: row.section,
      TWN: row.township,
      RNG: row.range_val,
      'Well Type': row.well_type,
      'Well Status': row.well_status,
      Status: row.status,
      Formation: row.formation_name,
      'Spud Date': row.spud_date,
      'Completion Date': row.completion_date,
      User: row.user_id ? [row.user_id] : [],
      Organization: row.organization_id ? [row.organization_id] : []
    },
    _user: row.user_email ? {
      id: row.user_airtable_id,
      email: row.user_email,
      name: row.user_name
    } : null,
    _d1: row
  };
}

/**
 * Transform D1 organization row to Airtable-like format
 */
function transformOrgToAirtableFormat(row) {
  return {
    id: row.airtable_record_id,
    fields: {
      Name: row.name,
      Plan: row.plan,
      'Max Users': row.max_users,
      'Default Notification Mode': row.default_notification_mode,
      'Allow User Override': row.allow_user_override === 1
    },
    _d1: row
  };
}
