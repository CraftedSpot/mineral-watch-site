/**
 * Activity Handlers
 * 
 * Handles activity log listing and statistics for user accounts
 */

import { BASE_ID, ACTIVITY_TABLE, PLAN_LIMITS } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById } from '../services/airtable.js';
import type { Env } from '../types/env.js';

/**
 * Handle activity log listing with plan-based record count limits
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with activity records
 */
export async function handleListActivity(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get user record to access plan information
  const userRecord = await getUserById(env, user.id);
  const plan = userRecord?.fields.Plan || "Free";
  const userOrganizations = userRecord?.fields.Organization || [];
  
  // Get plan-based record limit
  const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS["Free"];
  const recordLimit = planLimits.activityRecords;
  
  // Add debug logging
  console.log(`Activity handler - User: ${user.email}, Plan: ${plan}, Record Limit: ${recordLimit}, Organizations: ${userOrganizations.join(', ')}`);
  
  // Get query parameters
  const url = new URL(request.url);
  const days = url.searchParams.get('days');
  
  // Build formula: user's records OR organization's records
  let formula: string;
  if (userOrganizations.length > 0) {
    // User is part of an organization - show both personal and org activities
    const orgId = userOrganizations[0]; // User typically belongs to one org
    formula = `OR(FIND('${user.id}', ARRAYJOIN({User})) > 0, FIND('${orgId}', ARRAYJOIN({Organization})) > 0)`;
  } else {
    // No organization - show only personal activities
    formula = `FIND('${user.id}', ARRAYJOIN({User})) > 0`;
  }
  
  // If days parameter provided, add date filter
  if (days) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parseInt(days));
    formula = `AND(${formula}, {Detected At} >= "${sinceDate.toISOString()}")`;  
  }
  
  const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Detected At&sort[0][direction]=desc&maxRecords=${recordLimit}`;
  
  const response = await fetch(airtableUrl, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    console.error("Airtable list activity error:", errText);
    throw new Error(`Airtable error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Add Track This Well URL for activities with API numbers
  const enhancedRecords = data.records.map((record: any) => {
    const apiNumber = record.fields['API Number'];
    const activityType = record.fields['Activity Type'];
    
    // Add track URL for both New Permit and Well Completed
    if (apiNumber && (activityType === 'New Permit' || activityType === 'Well Completed')) {
      record.fields.trackWellUrl = `https://portal.mymineralwatch.com/add-well?api=${apiNumber}`;
    }
    
    return record;
  });
  
  // If this is for the map (days parameter provided), return simplified format
  if (days) {
    return jsonResponse(enhancedRecords);
  }
  
  // Include the limit info for the UI
  return jsonResponse({
    records: enhancedRecords,
    recordLimit: recordLimit,
    plan: plan
  });
}

/**
 * Handle activity statistics calculation
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with activity statistics
 */
export async function handleActivityStats(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get user record to check for organization
  const userRecord = await getUserById(env, user.id);
  const userOrganizations = userRecord?.fields.Organization || [];
  
  // Build formula: user's records OR organization's records
  let formula: string;
  if (userOrganizations.length > 0) {
    // User is part of an organization - count both personal and org activities
    const orgId = userOrganizations[0];
    formula = `OR(FIND('${user.id}', ARRAYJOIN({User})) > 0, FIND('${orgId}', ARRAYJOIN({Organization})) > 0)`;
  } else {
    // No organization - count only personal activities
    formula = `FIND('${user.id}', ARRAYJOIN({User})) > 0`;
  }
  
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Detected At&sort[0][direction]=desc`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    return jsonResponse({ lastAlert: null, thisMonth: 0, thisYear: 0, total: 0 });
  }
  
  const data = await response.json();
  const records = data.records || [];
  
  if (records.length === 0) {
    return jsonResponse({ lastAlert: null, thisMonth: 0, thisYear: 0, total: 0 });
  }
  
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  
  let thisMonth = 0;
  let thisYear = 0;
  
  records.forEach(r => {
    const detectedAt = new Date(r.fields['Detected At']);
    if (detectedAt >= startOfMonth) thisMonth++;
    if (detectedAt >= startOfYear) thisYear++;
  });
  
  // Last alert date
  const lastAlertDate = records[0]?.fields['Detected At'] || null;
  
  return jsonResponse({
    lastAlert: lastAlertDate,
    thisMonth: thisMonth,
    thisYear: thisYear,
    total: records.length
  });
}

/**
 * Delete an activity log entry for the authenticated user
 * @param activityId The activity record ID to delete
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with success status
 */
export async function handleDeleteActivity(activityId: string, request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Verify ownership by checking if record exists and belongs to user
  const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}/${activityId}`;
  const getResponse = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!getResponse.ok) {
    return jsonResponse({ error: "Activity record not found" }, 404);
  }
  
  const activity = await getResponse.json();
  
  // Check ownership - Activity Log uses linked User field like properties/wells
  // Users can only delete their own activities, not organization-wide activities
  const activityUserIds = activity.fields.User || [];
  if (!activityUserIds.includes(user.id)) {
    return jsonResponse({ error: "Not authorized to delete this activity" }, 403);
  }
  
  // Delete the record
  const deleteUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}/${activityId}`;
  await fetch(deleteUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  console.log(`Activity deleted: ${activityId} by ${user.email}`);
  return jsonResponse({ success: true });
}