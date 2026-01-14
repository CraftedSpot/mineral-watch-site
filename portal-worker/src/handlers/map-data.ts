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
          COUNTY_NAME: county.name, // Map expects COUNTY_NAME
          fips_code: county.fips_code,
          COUNTY_FIPS_NO: county.fips_code, // Also add original format
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
          // Map expects TWNSHPLAB format like "26N 20W"
          TWNSHPLAB: `${township.township} ${township.range}`,
          // Map expects PRINMER for meridian display
          PRINMER: township.meridian === 'CM' ? 'Cimarron Meridian' : 'Indian Meridian',
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

/**
 * Get county production data for choropleth heatmap
 * GET /api/map/county-production?product=oil|gas
 * Returns trailing 12-month production aggregates by county
 */
export async function handleGetCountyProduction(request: Request, env: Env): Promise<Response> {
  try {
    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[MapData] WELLS_DB not configured');
      return jsonResponse({
        error: 'Database not configured',
        message: 'The map data feature is not available at this time'
      }, 503);
    }

    const url = new URL(request.url);
    const product = url.searchParams.get('product') || 'oil';

    // Product code: 1 = Oil, 5 = Gas
    const productCode = product === 'gas' ? 5 : 1;
    const productLabel = product === 'gas' ? 'Gas (MCF)' : 'Oil (BBL)';

    console.log(`[MapData] Fetching county production for ${product} (code ${productCode})`);

    // Calculate trailing 12 months from current date
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const minYearMonth = `${twelveMonthsAgo.getFullYear()}${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

    // Query production aggregates
    const query = `
      SELECT
        county_number,
        SUM(gross_volume) as total_volume,
        SUM(gross_value) as total_value,
        SUM(record_count) as total_records,
        COUNT(*) as months_reported
      FROM county_production_monthly
      WHERE product_code = ?
        AND year_month >= ?
      GROUP BY county_number
      ORDER BY total_volume DESC
    `;

    const result = await env.WELLS_DB.prepare(query)
      .bind(productCode, minYearMonth)
      .all();

    if (!result.results || result.results.length === 0) {
      console.warn('[MapData] No production data found');
      return jsonResponse({
        success: true,
        product: productLabel,
        productCode,
        minYearMonth,
        data: {}
      });
    }

    // Find max value for scale calculation
    const maxVolume = Math.max(...result.results.map((r: any) => r.total_volume || 0));

    // Convert to map for easy lookup by county number
    const productionMap: { [countyNo: string]: any } = {};
    result.results.forEach((row: any) => {
      productionMap[row.county_number] = {
        volume: row.total_volume,
        value: row.total_value,
        records: row.total_records,
        monthsReported: row.months_reported
      };
    });

    console.log(`[MapData] Returning production for ${Object.keys(productionMap).length} counties, max volume: ${maxVolume}`);

    return jsonResponse({
      success: true,
      product: productLabel,
      productCode,
      minYearMonth,
      maxVolume,
      data: productionMap
    });

  } catch (error) {
    console.error('[MapData] Error fetching county production:', error);
    return jsonResponse({
      error: 'Failed to fetch county production',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}