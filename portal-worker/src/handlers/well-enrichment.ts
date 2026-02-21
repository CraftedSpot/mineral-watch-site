/**
 * Well Enrichment Handler
 * 
 * Provides D1 database enrichment data for individual wells
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

/**
 * Get enrichment data for a specific well from D1
 * GET /api/well-enrichment/:apiNumber
 */
export async function handleWellEnrichment(request: Request, env: Env, apiNumber: string): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[WellEnrichment] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Wells database not configured',
        message: 'The well enrichment feature is not available at this time'
      }, 503);
    }

    // Validate API number
    if (!apiNumber || apiNumber.length < 10) {
      return jsonResponse({ 
        error: 'Invalid API number',
        message: 'Please provide a valid API number'
      }, 400);
    }

    console.log(`[WellEnrichment] Fetching enrichment data for API: ${apiNumber}`);

    // Query D1 for enrichment data
    const query = `
      SELECT
        formation_name,
        formation_canonical,
        formation_group,
        measured_total_depth,
        true_vertical_depth,
        completion_date,
        first_production_date,
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
        well_status,
        operator,
        county,
        section,
        township,
        range
      FROM wells
      WHERE api_number = ?
      LIMIT 1
    `;

    const result = await env.WELLS_DB.prepare(query)
      .bind(apiNumber)
      .first();

    if (!result) {
      console.log(`[WellEnrichment] No well found for API: ${apiNumber}`);
      return jsonResponse({
        success: true,
        data: {}  // Return empty object if well not found
      });
    }

    // Calculate lateral length if we have both surface and bottom hole coordinates
    let calculatedLateralLength = null;
    if (result.latitude && result.longitude && result.bh_latitude && result.bh_longitude &&
        result.bh_latitude !== result.latitude && result.bh_longitude !== result.longitude) {
      // Simple distance calculation (this is approximate, not geodesic)
      const latDiff = result.bh_latitude - result.latitude;
      const lngDiff = result.bh_longitude - result.longitude;
      const distanceDegrees = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
      // Convert to feet (very approximate at Oklahoma's latitude)
      calculatedLateralLength = Math.round(distanceDegrees * 69 * 5280); // 69 miles per degree * 5280 feet per mile
    }

    // Build response with enrichment data
    const enrichmentData: any = {
      success: true,
      data: {
        // Formation and depth data
        formation_name: result.formation_name || null,
        formation_canonical: result.formation_canonical || null,
        formation_group: result.formation_group || null,
        measured_total_depth: result.measured_total_depth || null,
        true_vertical_depth: result.true_vertical_depth || null,
        lateral_length: result.lateral_length || calculatedLateralLength || null,
        
        // Date data
        completion_date: result.completion_date || null,
        first_production_date: result.first_production_date || null,
        spud_date: result.spud_date || null,
        
        // Initial production data
        ip_oil_bbl: result.ip_oil_bbl || null,
        ip_gas_mcf: result.ip_gas_mcf || null,
        ip_water_bbl: result.ip_water_bbl || null,
        
        // Location data for laterals
        has_lateral: !!(result.bh_latitude && result.bh_longitude && 
                       (result.bh_latitude !== result.latitude || result.bh_longitude !== result.longitude)),
        surface_location: {
          latitude: result.latitude || null,
          longitude: result.longitude || null
        },
        bottom_hole_location: {
          latitude: result.bh_latitude || null,
          longitude: result.bh_longitude || null
        },
        
        // Additional context
        well_name: result.well_name || null,
        well_type: result.well_type || null,
        well_status: result.well_status || null,
        operator: result.operator || null,
        county: result.county || null,
        section: result.section || null,
        township: result.township || null,
        range: result.range || null
      }
    };

    console.log(`[WellEnrichment] Found enrichment data for ${apiNumber}:`, {
      hasFormation: !!result.formation_name,
      hasDepth: !!(result.measured_total_depth || result.true_vertical_depth),
      hasProduction: !!(result.ip_oil_bbl || result.ip_gas_mcf),
      hasLateral: enrichmentData.data.has_lateral
    });

    return jsonResponse(enrichmentData);

  } catch (error) {
    console.error('[WellEnrichment] Error:', error);
    return jsonResponse({ 
      error: 'Failed to fetch enrichment data',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}