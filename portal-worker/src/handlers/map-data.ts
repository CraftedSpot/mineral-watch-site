/**
 * Map Data Handlers
 * 
 * Provides geographic data (counties, townships) from D1 for map visualization
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

/**
 * Get all Oklahoma counties with boundaries
 * GET /api/map/counties
 */
export async function handleGetCounties(request: Request, env: Env): Promise<Response> {
  try {
    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[MapData] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Database not configured',
        message: 'The map data feature is not available at this time'
      }, 503);
    }

    console.log('[MapData] Fetching all counties');

    // Query all counties
    const query = `
      SELECT 
        id,
        name,
        fips_code,
        geometry,
        center_lat,
        center_lng,
        area_sq_miles
      FROM counties
      ORDER BY name
    `;

    const result = await env.WELLS_DB.prepare(query).all();
    
    if (!result.results || result.results.length === 0) {
      console.warn('[MapData] No counties found in database');
      // Return empty GeoJSON FeatureCollection
      return jsonResponse({
        type: "FeatureCollection",
        features: []
      });
    }

    // Convert to GeoJSON FeatureCollection
    const featureCollection = {
      type: "FeatureCollection",
      features: result.results.map(county => ({
        type: "Feature",
        properties: {
          id: county.id,
          name: county.name,
          fips_code: county.fips_code,
          center_lat: county.center_lat,
          center_lng: county.center_lng,
          area_sq_miles: county.area_sq_miles
        },
        geometry: JSON.parse(county.geometry)
      }))
    };

    console.log(`[MapData] Returning ${result.results.length} counties`);

    // Add cache headers for client-side caching (1 day)
    return new Response(JSON.stringify(featureCollection), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('[MapData] Error fetching counties:', error);
    return jsonResponse({ 
      error: 'Failed to fetch counties',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}

/**
 * Get all Oklahoma townships with boundaries
 * GET /api/map/townships
 */
export async function handleGetTownships(request: Request, env: Env): Promise<Response> {
  try {
    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[MapData] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Database not configured',
        message: 'The map data feature is not available at this time'
      }, 503);
    }

    console.log('[MapData] Fetching all townships');

    // Query all townships
    const query = `
      SELECT 
        id,
        plss_id,
        township,
        range,
        meridian,
        county_name,
        geometry,
        center_lat,
        center_lng,
        area_sq_miles
      FROM townships
      ORDER BY township, range
    `;

    const result = await env.WELLS_DB.prepare(query).all();
    
    if (!result.results || result.results.length === 0) {
      console.warn('[MapData] No townships found in database');
      // Return empty GeoJSON FeatureCollection
      return jsonResponse({
        type: "FeatureCollection",
        features: []
      });
    }

    // Convert to GeoJSON FeatureCollection
    const featureCollection = {
      type: "FeatureCollection",
      features: result.results.map(township => ({
        type: "Feature",
        properties: {
          id: township.id,
          plss_id: township.plss_id,
          township: township.township,
          range: township.range,
          meridian: township.meridian,
          county_name: township.county_name,
          center_lat: township.center_lat,
          center_lng: township.center_lng,
          area_sq_miles: township.area_sq_miles
        },
        geometry: JSON.parse(township.geometry)
      }))
    };

    console.log(`[MapData] Returning ${result.results.length} townships`);

    // Add cache headers for client-side caching (1 day)
    return new Response(JSON.stringify(featureCollection), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('[MapData] Error fetching townships:', error);
    return jsonResponse({ 
      error: 'Failed to fetch townships',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}

/**
 * Get county statistics (well counts, recent activity)
 * GET /api/map/county-stats
 */
export async function handleGetCountyStats(request: Request, env: Env): Promise<Response> {
  try {
    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[MapData] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Database not configured',
        message: 'The map data feature is not available at this time'
      }, 503);
    }

    console.log('[MapData] Fetching county statistics');

    // Query county stats
    const query = `
      SELECT 
        county_name,
        well_count,
        active_well_count,
        permit_count_30d,
        completion_count_30d,
        last_updated
      FROM county_stats
      ORDER BY county_name
    `;

    const result = await env.WELLS_DB.prepare(query).all();
    
    // Convert to map for easy lookup
    const statsMap: { [county: string]: any } = {};
    if (result.results) {
      result.results.forEach(stat => {
        statsMap[stat.county_name] = {
          wellCount: stat.well_count,
          activeWellCount: stat.active_well_count,
          permitCount30d: stat.permit_count_30d,
          completionCount30d: stat.completion_count_30d,
          lastUpdated: stat.last_updated
        };
      });
    }

    console.log(`[MapData] Returning stats for ${Object.keys(statsMap).length} counties`);

    return jsonResponse({
      success: true,
      data: statsMap
    });

  } catch (error) {
    console.error('[MapData] Error fetching county stats:', error);
    return jsonResponse({ 
      error: 'Failed to fetch county statistics',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}