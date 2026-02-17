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

  // D1 has a lower bind variable limit than standard SQLite (~100).
  // Each location uses 4 variables, so chunk at 20 locations (80 variables).
  const CHUNK_SIZE = 20;
  const allResults = [];

  for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
    const chunk = locations.slice(i, i + CHUNK_SIZE);

    const conditions = chunk.map(() =>
      '(p.section = ? AND p.township = ? AND p.range = ? AND p.meridian = ?)'
    ).join(' OR ');

    const bindings = chunk.flatMap(loc => [
      loc.section, loc.township, loc.range, loc.meridian
    ]);

    const results = await env.WELLS_DB.prepare(`
      SELECT p.*, u.email as user_email, u.name as user_name, u.airtable_record_id as user_airtable_id
      FROM properties p
      LEFT JOIN users u ON u.airtable_record_id = p.user_id
      WHERE (${conditions})
      AND p.status = 'Active'
    `).bind(...bindings).all();

    allResults.push(...results.results);
  }

  console.log(`[D1] Batch loaded ${allResults.length} properties for ${locations.length} locations (${Math.ceil(locations.length / CHUNK_SIZE)} chunks)`);
  return allResults.map(transformPropertyToAirtableFormat);
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

  // Each section uses 3 variables + 1 for meridian per chunk.
  // D1 has a ~100 bind variable limit. Chunk at 30 sections (90 + 1 meridian = 91).
  const CHUNK_SIZE = 30;
  const allResults = [];

  for (let i = 0; i < adjacentSections.length; i += CHUNK_SIZE) {
    const chunk = adjacentSections.slice(i, i + CHUNK_SIZE);

    const conditions = chunk.map(() =>
      '(p.section = ? AND p.township = ? AND p.range = ?)'
    ).join(' OR ');

    const bindings = chunk.flatMap(s => [s.section, s.township, s.range]);

    const results = await env.WELLS_DB.prepare(`
      SELECT p.*, u.email as user_email, u.name as user_name, u.airtable_record_id as user_airtable_id
      FROM properties p
      LEFT JOIN users u ON u.airtable_record_id = p.user_id
      WHERE (${conditions})
      AND p.meridian = ?
      AND p.monitor_adjacent = 1
      AND p.status = 'Active'
    `).bind(...bindings, meridian).all();

    allResults.push(...results.results);
  }

  return allResults.map(transformPropertyToAirtableFormat);
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
      email_sent, detected_at, case_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    detectedAt,
    data.caseNumber || null
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

// ============================================================================
// Enhanced Weekly Digest Query Functions
// ============================================================================

/**
 * Get all active users with their org notification settings.
 * Caller filters in JS using getEffectiveNotificationMode().
 * @param {Object} env - Worker environment
 * @returns {Array} - Raw user+org rows
 */
export async function getAllActiveUsersWithOrg(env) {
  const results = await env.WELLS_DB.prepare(`
    SELECT u.*, o.default_notification_mode as org_notification_mode,
           o.allow_user_override as org_allow_override
    FROM users u
    LEFT JOIN organizations o ON o.airtable_record_id = u.organization_id
    WHERE u.status = 'Active'
  `).all();

  return results.results || [];
}

/**
 * Get all active properties for a specific user
 * @param {Object} env - Worker environment
 * @param {string} userId - User's Airtable record ID
 * @returns {Array} - Property rows with section/township/range/county
 */
export async function getPropertiesForUser(env, userId) {
  if (!userId) return [];

  const results = await env.WELLS_DB.prepare(`
    SELECT section, township, range, meridian, county
    FROM properties
    WHERE user_id = ? AND status = 'Active'
  `).bind(userId).all();

  return results.results || [];
}

/**
 * Get recent statewide activity in specified townships from last N days
 * @param {Object} env - Worker environment
 * @param {Array} townships - Array of {township, range} pairs
 * @param {number} days - Number of days to look back (default 7)
 * @returns {Array} - Statewide activity records
 */
export async function getNearbyActivity(env, townships, days = 7) {
  if (!townships || townships.length === 0) return [];

  const allResults = [];
  // Each township pair uses 2 bind variables, plus 1 for the date.
  // Chunk at 45 pairs (90 variables + 1 date = 91).
  const CHUNK_SIZE = 45;

  for (let i = 0; i < townships.length; i += CHUNK_SIZE) {
    const chunk = townships.slice(i, i + CHUNK_SIZE);
    const conditions = chunk.map(() =>
      '(surface_township = ? AND surface_range = ?)'
    ).join(' OR ');
    const bindings = chunk.flatMap(t => [t.township, t.range]);

    const results = await env.WELLS_DB.prepare(`
      SELECT api_number, well_name, operator, county,
             surface_section, surface_township, surface_range,
             has_permit, has_completion, is_horizontal,
             permit_date, completion_date, formation,
             created_at
      FROM statewide_activity
      WHERE (${conditions})
      AND created_at > datetime('now', '-${days} days')
      ORDER BY created_at DESC
    `).bind(...bindings).all();

    allResults.push(...(results.results || []));
  }

  return allResults;
}

/**
 * Get all distinct operators who have historically had wells in specified townships.
 * Used to detect "new operators" entering an area.
 * @param {Object} env - Worker environment
 * @param {Array} townships - Array of {township, range} pairs
 * @returns {Map<string, Set<string>>} - Map of "township|range" -> Set of uppercase operator names
 */
export async function getHistoricalOperators(env, townships) {
  const operatorMap = new Map();
  if (!townships || townships.length === 0) return operatorMap;

  // Each pair uses 2 bind variables. Chunk at 45 pairs (90 variables).
  const CHUNK_SIZE = 45;

  for (let i = 0; i < townships.length; i += CHUNK_SIZE) {
    const chunk = townships.slice(i, i + CHUNK_SIZE);
    const conditions = chunk.map(() =>
      '(township = ? AND range = ?)'
    ).join(' OR ');
    const bindings = chunk.flatMap(t => [t.township, t.range]);

    const results = await env.WELLS_DB.prepare(`
      SELECT DISTINCT operator, township, range
      FROM wells
      WHERE (${conditions})
      AND operator IS NOT NULL AND operator != ''
    `).bind(...bindings).all();

    for (const row of (results.results || [])) {
      const key = `${row.township}|${row.range}`;
      if (!operatorMap.has(key)) {
        operatorMap.set(key, new Set());
      }
      operatorMap.get(key).add(row.operator.trim().toUpperCase());
    }
  }

  return operatorMap;
}

/**
 * Get activity counts by county for last N days from statewide_activity
 * @param {Object} env - Worker environment
 * @param {Array} counties - Array of county name strings
 * @param {number} days - Number of days to look back (default 7)
 * @returns {Map<string, Object>} - Map of county -> {permitCount, completionCount}
 */
export async function getCountyActivityStats(env, counties, days = 7) {
  const statsMap = new Map();
  if (!counties || counties.length === 0) return statsMap;

  // 1 bind variable per county. Chunk at 90.
  const CHUNK_SIZE = 90;

  for (let i = 0; i < counties.length; i += CHUNK_SIZE) {
    const chunk = counties.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');

    const results = await env.WELLS_DB.prepare(`
      SELECT county,
        SUM(CASE WHEN has_permit = 1 THEN 1 ELSE 0 END) as permit_count,
        SUM(CASE WHEN has_completion = 1 THEN 1 ELSE 0 END) as completion_count
      FROM statewide_activity
      WHERE UPPER(county) IN (${placeholders})
      AND created_at > datetime('now', '-${days} days')
      GROUP BY county
    `).bind(...chunk.map(c => c.toUpperCase())).all();

    for (const row of (results.results || [])) {
      statsMap.set(row.county.toUpperCase(), {
        permitCount: row.permit_count || 0,
        completionCount: row.completion_count || 0
      });
    }
  }

  return statsMap;
}

/**
 * Get docket filing counts by county for last N days
 * @param {Object} env - Worker environment
 * @param {Array} counties - Array of county name strings
 * @param {number} days - Number of days to look back (default 7)
 * @returns {Map<string, number>} - Map of county -> docket count
 */
export async function getDocketCountByCounty(env, counties, days = 7) {
  const docketMap = new Map();
  if (!counties || counties.length === 0) return docketMap;

  const CHUNK_SIZE = 90;

  for (let i = 0; i < counties.length; i += CHUNK_SIZE) {
    const chunk = counties.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');

    try {
      const results = await env.WELLS_DB.prepare(`
        SELECT county, COUNT(*) as docket_count
        FROM occ_docket_entries
        WHERE UPPER(county) IN (${placeholders})
        AND docket_date > datetime('now', '-${days} days')
        GROUP BY county
      `).bind(...chunk.map(c => c.toUpperCase())).all();

      for (const row of (results.results || [])) {
        docketMap.set(row.county.toUpperCase(), row.docket_count || 0);
      }
    } catch (err) {
      // occ_docket_entries table may not exist or have different schema
      console.warn(`[D1] Docket count query failed: ${err.message}`);
    }
  }

  return docketMap;
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

// Plan limits for visibility gating (mirrors portal-worker/src/constants.ts)
const PLAN_LIMITS = {
  Free: { properties: 1, wells: 1 },
  Starter: { properties: 10, wells: 10 },
  Standard: { properties: 50, wells: 50 },
  Professional: { properties: 250, wells: 250 },
  Business: { properties: 500, wells: 500 },
  'Enterprise 1K': { properties: 1000, wells: 1000 }
};

/**
 * Check if a user exceeds their plan's property or well limit.
 * Used to gate alert/digest delivery for downgraded users.
 * @param {Object} env - Worker environment with WELLS_DB
 * @param {string} userId - Airtable record ID (rec...)
 * @param {string} plan - Plan name (e.g. 'Free', 'Starter')
 * @returns {Promise<boolean>} - true if user exceeds their plan limit
 */
export async function isUserOverPlanLimit(env, userId, plan) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.Free;

  const propCount = await env.WELLS_DB.prepare(`
    SELECT COUNT(*) as cnt FROM properties
    WHERE user_id = ? OR organization_id = (
      SELECT organization_id FROM users WHERE airtable_record_id = ? AND organization_id IS NOT NULL
    )
  `).bind(userId, userId).first();

  if (propCount.cnt > limits.properties) return true;

  const wellCount = await env.WELLS_DB.prepare(`
    SELECT COUNT(*) as cnt FROM client_wells
    WHERE user_id = ? OR organization_id = (
      SELECT organization_id FROM users WHERE airtable_record_id = ? AND organization_id IS NOT NULL
    )
  `).bind(userId, userId).first();

  return wellCount.cnt > limits.wells;
}
