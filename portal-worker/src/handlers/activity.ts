/**
 * Activity Handlers
 *
 * Handles activity log listing and statistics for user accounts.
 * Reads from D1 activity_log table (migrated from Airtable).
 */

import { PLAN_LIMITS } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserFromSession } from '../services/airtable.js';
import type { Env } from '../types/env.js';

/**
 * Map a D1 activity_log row to the Airtable-compatible record format
 * the frontend expects: { id, fields: { "Well Name": ..., ... } }
 */
function mapRowToRecord(row: any) {
  const fields: Record<string, any> = {};

  if (row.well_name) fields['Well Name'] = row.well_name;
  if (row.api_number) fields['API Number'] = row.api_number;
  if (row.activity_type) fields['Activity Type'] = row.activity_type;
  if (row.alert_level) fields['Alert Level'] = row.alert_level;
  if (row.operator) fields['Operator'] = row.operator;
  if (row.previous_operator) fields['Previous Operator'] = row.previous_operator;
  if (row.county) fields['County'] = row.county;
  if (row.str_location) fields['Section-Township-Range'] = row.str_location;
  if (row.formation) fields['Formation'] = row.formation;
  if (row.occ_link) fields['OCC Link'] = row.occ_link;
  // Only include map links that have actual coordinates (contain marker=), not bare homepage URLs
  if (row.occ_map_link && row.occ_map_link.includes('marker=')) fields['OCC Map Link'] = row.occ_map_link;
  if (row.map_link && row.map_link.includes('marker=')) fields['Map Link'] = row.map_link;
  if (row.previous_value) fields['Previous Value'] = row.previous_value;
  if (row.new_value) fields['New Value'] = row.new_value;
  if (row.detected_at) fields['Detected At'] = row.detected_at;
  if (row.notes) fields['Notes'] = row.notes;
  if (row.case_number) fields['Case Number'] = row.case_number;

  // Add track URL for permits and completions with API numbers
  if (row.api_number && (row.activity_type === 'New Permit' || row.activity_type === 'Well Completed')) {
    fields.trackWellUrl = `https://portal.mymineralwatch.com/add-well?api=${row.api_number}`;
  }

  return {
    id: row.id,
    fields
  };
}

/**
 * Handle activity log listing with plan-based record count limits
 */
export async function handleListActivity(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  if (!env.WELLS_DB) {
    return jsonResponse({ error: "Database not available" }, 500);
  }

  // Get user record to access plan information
  const userRecord = await getUserFromSession(env, user);
  const plan = userRecord?.fields.Plan || "Free";
  const userOrganizations = userRecord?.fields.Organization || [];

  // Get plan-based record limit
  const planLimits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS["Free"];
  const recordLimit = planLimits.activityRecords;

  console.log(`Activity handler (D1) - User: ${user.email}, Plan: ${plan}, Record Limit: ${recordLimit}`);

  // Get query parameters
  const url = new URL(request.url);
  const days = url.searchParams.get('days');

  // Build D1 query
  let query: string;
  const params: any[] = [];

  if (userOrganizations.length > 0) {
    const orgId = userOrganizations[0];
    if (days) {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - parseInt(days));
      query = `SELECT * FROM activity_log WHERE (user_id = ? OR organization_id = ?) AND detected_at >= ? ORDER BY detected_at DESC LIMIT ?`;
      params.push(user.id, orgId, sinceDate.toISOString(), recordLimit);
    } else {
      query = `SELECT * FROM activity_log WHERE (user_id = ? OR organization_id = ?) ORDER BY detected_at DESC LIMIT ?`;
      params.push(user.id, orgId, recordLimit);
    }
  } else {
    if (days) {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - parseInt(days));
      query = `SELECT * FROM activity_log WHERE user_id = ? AND detected_at >= ? ORDER BY detected_at DESC LIMIT ?`;
      params.push(user.id, sinceDate.toISOString(), recordLimit);
    } else {
      query = `SELECT * FROM activity_log WHERE user_id = ? ORDER BY detected_at DESC LIMIT ?`;
      params.push(user.id, recordLimit);
    }
  }

  try {
    const result = await env.WELLS_DB.prepare(query).bind(...params).all();
    const records = result.results.map(mapRowToRecord);

    // If this is for the map (days parameter provided), return simplified format
    if (days) {
      return jsonResponse(records);
    }

    return jsonResponse({
      records,
      recordLimit,
      plan
    });
  } catch (error) {
    console.error("D1 activity query error:", error);
    return jsonResponse({ error: "Failed to load activity" }, 500);
  }
}

/**
 * Handle activity statistics calculation
 */
export async function handleActivityStats(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  if (!env.WELLS_DB) {
    return jsonResponse({ lastAlert: null, thisMonth: 0, thisYear: 0, total: 0 });
  }

  // Get user record to check for organization
  const userRecord = await getUserFromSession(env, user);
  const userOrganizations = userRecord?.fields.Organization || [];

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

  try {
    let whereClause: string;
    const baseParams: any[] = [];

    if (userOrganizations.length > 0) {
      const orgId = userOrganizations[0];
      whereClause = '(user_id = ? OR organization_id = ?)';
      baseParams.push(user.id, orgId);
    } else {
      whereClause = 'user_id = ?';
      baseParams.push(user.id);
    }

    // Run all three queries in parallel
    const [lastAlertResult, monthResult, yearResult, totalResult] = await Promise.all([
      env.WELLS_DB.prepare(
        `SELECT detected_at FROM activity_log WHERE ${whereClause} ORDER BY detected_at DESC LIMIT 1`
      ).bind(...baseParams).first(),
      env.WELLS_DB.prepare(
        `SELECT COUNT(*) as count FROM activity_log WHERE ${whereClause} AND detected_at >= ?`
      ).bind(...baseParams, startOfMonth).first(),
      env.WELLS_DB.prepare(
        `SELECT COUNT(*) as count FROM activity_log WHERE ${whereClause} AND detected_at >= ?`
      ).bind(...baseParams, startOfYear).first(),
      env.WELLS_DB.prepare(
        `SELECT COUNT(*) as count FROM activity_log WHERE ${whereClause}`
      ).bind(...baseParams).first()
    ]);

    return jsonResponse({
      lastAlert: (lastAlertResult as any)?.detected_at || null,
      thisMonth: (monthResult as any)?.count || 0,
      thisYear: (yearResult as any)?.count || 0,
      total: (totalResult as any)?.count || 0
    });
  } catch (error) {
    console.error("D1 activity stats error:", error);
    return jsonResponse({ lastAlert: null, thisMonth: 0, thisYear: 0, total: 0 });
  }
}

/**
 * Delete an activity log entry for the authenticated user
 */
export async function handleDeleteActivity(activityId: string, request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  if (!env.WELLS_DB) {
    return jsonResponse({ error: "Database not available" }, 500);
  }

  try {
    // Delete only if user owns the record (ownership check built into WHERE)
    const result = await env.WELLS_DB.prepare(
      `DELETE FROM activity_log WHERE id = ? AND user_id = ?`
    ).bind(parseInt(activityId), user.id).run();

    if ((result.meta?.changes || 0) === 0) {
      return jsonResponse({ error: "Activity record not found or not authorized" }, 404);
    }

    console.log(`Activity deleted: ${activityId} by ${user.email}`);
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("D1 delete activity error:", error);
    return jsonResponse({ error: "Failed to delete activity" }, 500);
  }
}
