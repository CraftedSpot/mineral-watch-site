/**
 * Debug handler to inspect Airtable table structure
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

export async function handleDebugAirtable(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Only allow for specific test user
  if (user.email !== 'photog12@gmail.com') {
    return jsonResponse({ error: "Not authorized for debug" }, 403);
  }
  
  try {
    // Fetch one property to see field structure
    const propertyResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('📍 Client Properties')}?maxRecords=1&filterByFormula=NOT({User} = BLANK())`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    // Fetch one well to see field structure  
    const wellResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🛢️ Client Wells')}?maxRecords=1&filterByFormula=NOT({User} = BLANK())`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    const propertyData = await propertyResponse.json();
    const wellData = await wellResponse.json();
    
    return jsonResponse({
      success: true,
      debug: {
        property: {
          sample: propertyData.records[0],
          fieldNames: propertyData.records[0] ? Object.keys(propertyData.records[0].fields) : []
        },
        well: {
          sample: wellData.records[0],
          fieldNames: wellData.records[0] ? Object.keys(wellData.records[0].fields) : []
        },
        userId: user.id,
        userEmail: user.email
      }
    });
    
  } catch (error) {
    return jsonResponse({ 
      error: 'Debug failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}