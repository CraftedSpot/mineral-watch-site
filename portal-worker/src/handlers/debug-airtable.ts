/**
 * Debug handler to inspect Airtable table structure
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { escapeAirtableValue } from '../utils/airtable-escape.js';
import type { Env } from '../types/env.js';

export async function handleDebugAirtable(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  // Only allow for specific test user
  if (user.email !== 'photog12@gmail.com') {
    return jsonResponse({ error: "Not authorized for debug" }, 403);
  }
  
  // Check for debug type parameter
  const url = new URL(request.url);
  const debugType = url.searchParams.get('type');
  
  try {
    // Debug links table
    if (debugType === 'links') {
      const propertyId = url.searchParams.get('propertyId');
      
      // Fetch some sample links
      const linksResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🔗 Property-Well Links')}?maxRecords=10${propertyId ? `&filterByFormula=${encodeURIComponent(`FIND('${escapeAirtableValue(propertyId)}', ARRAYJOIN({Property})) > 0`)}` : ''}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );
      
      const linksData = await linksResponse.json();
      
      return jsonResponse({
        success: true,
        propertyId,
        linksFound: linksData.records?.length || 0,
        sampleLinks: linksData.records?.slice(0, 5).map((r: any) => ({
          id: r.id,
          fields: r.fields,
          propertyInfo: {
            propertyField: r.fields.Property,
            isArray: Array.isArray(r.fields.Property),
            firstValue: r.fields.Property?.[0]
          }
        }))
      });
    }
    
    // Original debug code
    const testFilters = [
      `FIND('${escapeAirtableValue(user.id)}', ARRAYJOIN({User})) > 0`,
      `FIND('${escapeAirtableValue(user.email)}', ARRAYJOIN({User})) > 0`,
      `NOT({User} = BLANK())`
    ];
    
    const results: any = {};
    
    for (const filter of testFilters) {
      const propertyResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('📍 Client Properties')}?maxRecords=3&filterByFormula=${encodeURIComponent(filter)}`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );
      
      const data = await propertyResponse.json();
      results[filter] = {
        status: propertyResponse.status,
        count: data.records?.length || 0,
        sample: data.records?.[0] || null,
        error: data.error || null
      };
    }
    
    // Also test without filter
    const noFilterResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('📍 Client Properties')}?maxRecords=1`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    const noFilterData = await noFilterResponse.json();
    
    return jsonResponse({
      success: true,
      debug: {
        filterTests: results,
        noFilterSample: noFilterData.records?.[0] || null,
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