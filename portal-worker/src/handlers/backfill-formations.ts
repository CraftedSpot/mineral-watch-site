/**
 * Backfill Formation Data for Completion Activities
 * 
 * This handler updates existing completion activities in the Activity Log
 * with formation data from the completion cache
 */

import {
  BASE_ID,
  ACTIVITY_TABLE
} from '../constants.js';

import {
  jsonResponse
} from '../utils/responses.js';

import {
  authenticateRequest,
  isSuperAdmin
} from '../utils/auth.js';

import {
  lookupCompletionData
} from './wells.js';

import type { Env } from '../types/env.js';

/**
 * Backfill formation data for completion activities
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with update results
 */
export async function handleBackfillFormations(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Check if user is admin (you might want to restrict this)
  if (!isSuperAdmin(user.email)) {
    return jsonResponse({ error: "Admin access required" }, 403);
  }
  
  try {
    // Get all completion activities that don't have formation data
    const formula = `AND({Activity Type} = 'Well Completed', {Formation} = '')`;
    const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=100`;
    
    const response = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch activities: ${response.status}`);
    }
    
    const data = await response.json();
    const activities = data.records || [];
    
    console.log(`Found ${activities.length} completion activities without formation data`);
    
    // Process each activity
    const results = {
      total: activities.length,
      updated: 0,
      failed: 0,
      errors: []
    };
    
    // Process in batches of 10
    const batchSize = 10;
    for (let i = 0; i < activities.length; i += batchSize) {
      const batch = activities.slice(i, i + batchSize);
      const updates = [];
      
      for (const activity of batch) {
        const apiNumber = activity.fields['API Number'];
        if (!apiNumber) continue;
        
        // Look up completion data
        const completionData = await lookupCompletionData(apiNumber, env);
        
        if (completionData && completionData.formationName) {
          updates.push({
            id: activity.id,
            fields: {
              Formation: completionData.formationName
            }
          });
        }
      }
      
      // Update the batch
      if (updates.length > 0) {
        const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}`;
        const updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ records: updates })
        });
        
        if (updateResponse.ok) {
          results.updated += updates.length;
        } else {
          const err = await updateResponse.text();
          results.failed += updates.length;
          results.errors.push(`Batch ${Math.floor(i/batchSize) + 1}: ${err}`);
        }
      }
      
      // Small delay between batches
      if (i + batchSize < activities.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return jsonResponse({
      success: true,
      results
    });
    
  } catch (error) {
    console.error('Backfill formations error:', error);
    return jsonResponse({ 
      error: 'Failed to backfill formations',
      details: error.message 
    }, 500);
  }
}

/**
 * Get formation data for a specific activity
 * @param request The incoming request with activityId
 * @param env Worker environment
 * @returns JSON response with formation data
 */
export async function handleGetFormationForActivity(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const url = new URL(request.url);
  const activityId = url.searchParams.get('id');
  const apiNumber = url.searchParams.get('api');
  
  if (!apiNumber) {
    return jsonResponse({ error: "API number required" }, 400);
  }
  
  try {
    // Look up completion data
    const completionData = await lookupCompletionData(apiNumber, env);
    
    if (completionData && completionData.formationName) {
      // If we have an activity ID, update it
      if (activityId) {
        const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ACTIVITY_TABLE)}/${activityId}`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              Formation: completionData.formationName
            }
          })
        });
      }
      
      return jsonResponse({
        formation: completionData.formationName,
        updated: !!activityId
      });
    }
    
    return jsonResponse({
      formation: null,
      message: "No formation data available"
    });
    
  } catch (error) {
    console.error('Get formation error:', error);
    return jsonResponse({ error: 'Failed to get formation data' }, 500);
  }
}