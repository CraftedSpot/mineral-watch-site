/**
 * Activity Handlers
 * 
 * Handles activity log listing and statistics for user accounts
 */

import { BASE_ID, ACTIVITY_TABLE, ACTIVITY_LIMITS } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

/**
 * Handle activity log listing with plan-based date limits
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with activity records
 */
export async function handleListActivity(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get plan-based date limit
  const daysLimit = ACTIVITY_LIMITS[user.plan] || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);
  const cutoffISO = cutoffDate.toISOString();
  
  // Build formula: user's records, after cutoff date, sorted by date desc
  const formula = `AND({Email} = '${user.email}', {Detected At} >= '${cutoffISO}')`;
  
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Detected At&sort[0][direction]=desc&maxRecords=100`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    console.error("Airtable list activity error:", errText);
    throw new Error(`Airtable error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Include the limit info for the UI
  return jsonResponse({
    records: data.records,
    daysLimit: daysLimit,
    plan: user.plan
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
  
  // Get all activity for this user (for stats, we count everything)
  const formula = `{Email} = '${user.email}'`;
  
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