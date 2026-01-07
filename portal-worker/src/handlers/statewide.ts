/**
 * Statewide Activity Handler
 * 
 * Provides statewide activity data for heatmap visualization from D1
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

/**
 * Handle statewide activity data for heatmap
 * Returns all statewide activities with coordinates from D1
 */
export async function handleStatewideActivity(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get query parameters
  const url = new URL(request.url);
  const days = url.searchParams.get('days') || '30';
  const county = url.searchParams.get('county');
  const activityType = url.searchParams.get('type'); // 'permit' or 'completion'
  
  // Check if we have D1 binding
  if (!env.WELLS_DB) {
    console.error('[Statewide] D1 database binding (WELLS_DB) not found');
    return jsonResponse({ error: 'Database not configured' }, 500);
  }
  
  try {
    // Fetch all statewide activities from D1
    const statewideActivities = await fetchStatewideActivitiesFromD1(env, parseInt(days), county, activityType);
    
    // Format results to match frontend expectations
    const allActivities = formatStatewideActivities(statewideActivities);
    
    console.log(`[Statewide] Loaded ${statewideActivities.length} statewide activities from D1`);
    
    return jsonResponse(allActivities);
  } catch (error) {
    console.error('[Statewide] Error:', error);
    return jsonResponse({ error: 'Failed to load statewide data' }, 500);
  }
}

/**
 * Fetch statewide activities from D1 database
 */
async function fetchStatewideActivitiesFromD1(env: Env, daysAgo: number, county?: string | null, activityType?: string | null) {
  // Build the WHERE clause
  const conditions = [`created_at >= datetime('now', '-${daysAgo} days')`];
  const bindings = [];
  
  if (county) {
    conditions.push(`county = ?`);
    bindings.push(county);
  }
  
  if (activityType === 'permit') {
    conditions.push(`has_permit = 1`);
  } else if (activityType === 'completion') {
    conditions.push(`has_completion = 1`);
  }
  
  // Only get records with valid coordinates
  conditions.push(`latitude IS NOT NULL AND longitude IS NOT NULL`);
  
  const whereClause = conditions.join(' AND ');
  
  const query = `
    SELECT 
      id,
      api_number,
      well_name,
      operator,
      county,
      surface_section,
      surface_township,
      surface_range,
      surface_pm,
      latitude,
      longitude,
      bh_latitude,
      bh_longitude,
      permit_date,
      completion_date,
      formation,
      is_horizontal,
      has_permit,
      has_completion,
      occ_map_link,
      created_at
    FROM statewide_activity 
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT 5000
  `;
  
  // Prepare statement and bind parameters
  let stmt = env.WELLS_DB.prepare(query);
  
  // Bind parameters if any
  if (bindings.length > 0) {
    stmt = stmt.bind(...bindings);
  }
  
  const result = await stmt.all();
  return result.results || [];
}

/**
 * Format statewide activities to match expected structure
 * Converts D1 results to Airtable-like format expected by frontend
 */
function formatStatewideActivities(records: any[]): any[] {
  return records.map(record => ({
    id: record.id,
    fields: {
      isUserActivity: false,
      // Map activity type based on has_permit and has_completion
      'Activity Type': record.has_permit ? 'New Permit' : 'Well Completed',
      'API Number': record.api_number,
      'Well Name': record.well_name || '',
      'Operator': record.operator || '',
      'County': record.county || '',
      'Section': record.surface_section || '',
      'Township': record.surface_township || '',
      'Range': record.surface_range || '',
      'PM': record.surface_pm || 'IM',
      'Detected At': record.created_at,
      'Permit Date': record.permit_date,
      'Completion Date': record.completion_date,
      'Formation': record.formation || '',
      'Is Horizontal': record.is_horizontal === 1,
      'Has Permit': record.has_permit === 1,
      'Has Completion': record.has_completion === 1,
      'Latitude': record.latitude,
      'Longitude': record.longitude,
      'BH Latitude': record.bh_latitude,
      'BH Longitude': record.bh_longitude,
      'OCC Map Link': record.occ_map_link || ''
    }
  }));
}