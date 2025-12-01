/**
 * Airtable Service - Handles all Airtable API interactions
 */

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
 * @param {Object} env - Worker environment
 * @param {string} userId - Airtable record ID
 * @returns {Object|null} - User record or null
 */
export async function getUserById(env, userId) {
  const url = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_USERS_TABLE}/${userId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    if (response.status === 404) return null;
    const error = await response.text();
    throw new Error(`Airtable get user failed: ${response.status} - ${error}`);
  }
  
  return await response.json();
}

/**
 * Find a user by their email address
 * @param {Object} env - Worker environment
 * @param {string} email - User email
 * @returns {Object|null} - User record or null
 */
export async function findUserByEmail(env, email) {
  const formula = `{Email} = "${email}"`;
  const users = await queryAirtable(env, env.AIRTABLE_USERS_TABLE, formula);
  return users.length > 0 ? users[0] : null;
}

/**
 * Check if a user has been alerted about this API + activity type recently
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
 * @param {Object} env - Worker environment
 * @param {Object} data - Activity data
 * @returns {Object} - Created record
 */
export async function createActivityLog(env, data) {
  const url = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}`;
  
  const fields = {
    'Well Name': data.wellName,
    'Detected At': new Date().toISOString(),
    'API Number': data.apiNumber,
    'Activity Type': data.activityType,
    'Operator': data.operator,
    'Alert Level': data.alertLevel,
    'Section-Township-Range': data.sectionTownshipRange,
    'County': data.county,
    'Email Sent': false,
    'User': [data.userId]  // Linked record array - Email lookup auto-populates
  };
  
  // Optional fields
  if (data.previousOperator) fields['Previous Operator'] = data.previousOperator;
  if (data.previousValue) fields['Previous Value'] = data.previousValue;
  if (data.newValue) fields['New Value'] = data.newValue;
  if (data.occLink) fields['OCC Link'] = data.occLink;
  if (data.operatorPhone) fields['Operator Phone'] = data.operatorPhone;
  // Always include Map Link field (empty string if no link) - matches old worker behavior
  fields['Map Link'] = data.mapLink || "";
  console.log(`[Airtable] Map Link field set to: ${fields['Map Link']}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airtable create activity failed: ${response.status} - ${error}`);
  }
  
  return await response.json();
}

/**
 * Update an activity log entry (e.g., mark email as sent)
 * @param {Object} env - Worker environment
 * @param {string} recordId - Activity log record ID
 * @param {Object} fields - Fields to update
 * @returns {Object} - Updated record
 */
export async function updateActivityLog(env, recordId, fields) {
  const url = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}/${recordId}`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airtable update activity failed: ${response.status} - ${error}`);
  }
  
  return await response.json();
}
