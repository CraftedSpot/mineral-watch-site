/**
 * Statewide Activity Handler
 * 
 * Provides statewide activity data for heatmap visualization
 * Combines data from both Activity (user-related) and Statewide Activity tables
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

// Statewide Activity table ID
const STATEWIDE_ACTIVITY_TABLE = 'tblbM8kwkRyFS9eaj';

/**
 * Handle statewide activity data for heatmap
 * Returns all statewide activities with coordinates
 */
export async function handleStatewideActivity(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Get query parameters
  const url = new URL(request.url);
  const days = url.searchParams.get('days') || '30';
  
  try {
    // Fetch all statewide activities
    const statewideActivities = await fetchStatewideActivities(env, parseInt(days));
    
    // Format results (all activities marked as non-user for now)
    const allActivities = formatStatewideActivities(statewideActivities);
    
    console.log(`[Statewide] Loaded ${statewideActivities.length} statewide activities`);
    
    return jsonResponse(allActivities);
  } catch (error) {
    console.error('[Statewide] Error:', error);
    return jsonResponse({ error: 'Failed to load statewide data' }, 500);
  }
}

/**
 * Fetch statewide activities from Statewide Activity table
 */
async function fetchStatewideActivities(env: Env, daysAgo: number) {
  // Use Airtable formula with exact field name "Created Time"
  const formula = `IS_AFTER({Created Time}, DATEADD(TODAY(), -${daysAgo}, 'days'))`;
  const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(STATEWIDE_ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1000`;
  
  const response = await fetch(airtableUrl, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Statewide] Airtable error:', errorText);
    throw new Error(`Failed to fetch statewide activities: ${response.status}`);
  }
  
  const data = await response.json();
  return data.records || [];
}

/**
 * Format statewide activities to match expected structure
 */
function formatStatewideActivities(records: any[]): any[] {
  return records.map(record => ({
    ...record,
    fields: {
      ...record.fields,
      isUserActivity: false,
      // Map activity type based on Has Permit and Has Completion checkboxes
      'Activity Type': record.fields['Has Permit'] ? 'New Permit' : 
                      record.fields['Has Completion'] ? 'Well Completed' : 
                      (record.fields['Activity Type'] === 'Permit' ? 'New Permit' : 'Well Completed'),
      // Ensure we have the required fields
      'API Number': record.fields['API Number'],
      'Well Name': record.fields['Well Name'],
      'Operator': record.fields['Operator'],
      'County': record.fields['County'],
      'Section': record.fields['Section'],
      'Township': record.fields['Township'],
      'Range': record.fields['Range'],
      'Detected At': record.fields['Created Time'], // Map Created Time to Detected At
      Latitude: record.fields['Latitude'],
      Longitude: record.fields['Longitude']
    }
  }));
}