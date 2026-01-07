/**
 * Bulk Well Enrichment Handler
 * 
 * Provides D1 database enrichment data for multiple wells in a single query
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

/**
 * Get enrichment data for multiple wells from D1 in a single query
 * POST /api/well-enrichment/bulk
 * Body: { apiNumbers: string[] }
 */
export async function handleBulkWellEnrichment(request: Request, env: Env): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[BulkWellEnrichment] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Wells database not configured',
        message: 'The well enrichment feature is not available at this time'
      }, 503);
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ 
        error: 'Invalid JSON',
        message: 'Request body must be valid JSON with apiNumbers array'
      }, 400);
    }

    const apiNumbers = body.apiNumbers || [];
    
    if (!Array.isArray(apiNumbers) || apiNumbers.length === 0) {
      return jsonResponse({ 
        error: 'Invalid request',
        message: 'Please provide an array of API numbers'
      }, 400);
    }

    // D1 can handle up to 999 parameters in an IN clause, but let's be conservative
    if (apiNumbers.length > 500) {
      return jsonResponse({ 
        error: 'Too many API numbers',
        message: 'Please request enrichment for 500 or fewer wells at a time'
      }, 400);
    }

    console.log(`[BulkWellEnrichment] Fetching enrichment data for ${apiNumbers.length} wells`);

    // Build the IN clause with placeholders
    const placeholders = apiNumbers.map((_, index) => `?${index + 1}`).join(', ');
    
    // Query D1 for enrichment data for all wells at once
    const query = `
      SELECT 
        api_number,
        formation_name,
        measured_total_depth,
        true_vertical_depth,
        completion_date,
        spud_date,
        ip_oil_bbl,
        ip_gas_mcf,
        ip_water_bbl,
        bh_latitude,
        bh_longitude,
        lateral_length,
        -- Also include surface coords for lateral calculation
        latitude,
        longitude,
        well_name,
        well_type,
        operator
      FROM wells 
      WHERE api_number IN (${placeholders})
    `;

    const startTime = Date.now();
    const result = await env.WELLS_DB.prepare(query)
      .bind(...apiNumbers)
      .all();
    const queryTime = Date.now() - startTime;

    console.log(`[BulkWellEnrichment] Query completed in ${queryTime}ms, found ${result.results.length} wells`);

    // Build response map indexed by API number
    const enrichmentMap: { [apiNumber: string]: any } = {};

    for (const row of result.results) {
      // Calculate lateral length if we have both surface and bottom hole coordinates
      let calculatedLateralLength = null;
      if (row.latitude && row.longitude && row.bh_latitude && row.bh_longitude &&
          row.bh_latitude !== row.latitude && row.bh_longitude !== row.longitude) {
        // Simple distance calculation (this is approximate, not geodesic)
        const latDiff = row.bh_latitude - row.latitude;
        const lngDiff = row.bh_longitude - row.longitude;
        const distanceDegrees = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
        // Convert to feet (very approximate at Oklahoma's latitude)
        calculatedLateralLength = Math.round(distanceDegrees * 69 * 5280); // 69 miles per degree * 5280 feet per mile
      }

      enrichmentMap[row.api_number] = {
        // Formation and depth data
        formation_name: row.formation_name || null,
        measured_total_depth: row.measured_total_depth || null,
        true_vertical_depth: row.true_vertical_depth || null,
        lateral_length: row.lateral_length || calculatedLateralLength || null,
        
        // Date data
        completion_date: row.completion_date || null,
        spud_date: row.spud_date || null,
        
        // Initial production data
        ip_oil_bbl: row.ip_oil_bbl || null,
        ip_gas_mcf: row.ip_gas_mcf || null,
        ip_water_bbl: row.ip_water_bbl || null,
        
        // Location data for laterals
        has_lateral: !!(row.bh_latitude && row.bh_longitude && 
                       (row.bh_latitude !== row.latitude || row.bh_longitude !== row.longitude)),
        surface_location: {
          latitude: row.latitude || null,
          longitude: row.longitude || null
        },
        bottom_hole_location: {
          latitude: row.bh_latitude || null,
          longitude: row.bh_longitude || null
        },
        
        // Additional context
        well_name: row.well_name || null,
        well_type: row.well_type || null,
        operator: row.operator || null
      };
    }

    // Add empty objects for any API numbers not found in D1
    for (const apiNumber of apiNumbers) {
      if (!enrichmentMap[apiNumber]) {
        enrichmentMap[apiNumber] = {};
      }
    }

    const response = {
      success: true,
      data: enrichmentMap,
      stats: {
        requested: apiNumbers.length,
        found: result.results.length,
        queryTime: queryTime
      }
    };

    return jsonResponse(response);

  } catch (error) {
    console.error('[BulkWellEnrichment] Error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch enrichment data',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}