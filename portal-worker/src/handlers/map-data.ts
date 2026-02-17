/**
 * Map Data Handlers
 * 
 * Provides geographic data (counties, townships) from D1 for map visualization
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

// Escapes HTML entities in tooltip strings
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
        'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com'
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
        'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com'
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

/**
 * Get pooling rates by township for choropleth map layer
 * GET /api/map/pooling-rates?months=18
 * Returns GeoJSON FeatureCollection with township geometry + pooling rate stats
 */
export async function handleGetPoolingRates(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const url = new URL(request.url);
    const months = Math.min(Math.max(parseInt(url.searchParams.get('months') || '18') || 18, 6), 60);
    const refresh = url.searchParams.get('refresh') === '1';

    // Check KV cache (4-hour TTL)
    const cacheKey = `pooling-rates:${months}`;
    if (!refresh && env.OCC_CACHE) {
      try {
        const cached = await env.OCC_CACHE.get(cacheKey);
        if (cached) {
          return new Response(cached, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com',
              'X-Cache': 'HIT'
            }
          });
        }
      } catch (e) {
        console.error('[MapData] KV cache read error:', e);
      }
    }

    console.log(`[MapData] Fetching pooling rates (${months} months)`);

    // CTE: normalize to max bonus per order, then aggregate by township
    const query = `
      WITH order_max_bonus AS (
        SELECT po.id, po.township, po.range, po.county, po.operator,
          po.order_date,
          MAX(peo.bonus_per_acre) as max_bonus
        FROM pooling_orders po
        JOIN pooling_election_options peo ON peo.pooling_order_id = po.id
        WHERE peo.bonus_per_acre > 0
          AND po.order_date >= date('now', '-${months} months')
        GROUP BY po.id
      ),
      township_rates AS (
        SELECT township, range,
          ROUND(AVG(max_bonus)) as avg_bonus,
          ROUND(MIN(max_bonus)) as min_bonus,
          ROUND(MAX(max_bonus)) as max_bonus,
          COUNT(*) as order_count,
          GROUP_CONCAT(DISTINCT county) as counties,
          GROUP_CONCAT(DISTINCT operator) as operators,
          MAX(order_date) as latest_order
        FROM order_max_bonus
        GROUP BY township, range
      )
      SELECT tr.*, t.geometry, t.center_lat, t.center_lng, t.meridian
      FROM township_rates tr
      JOIN townships t ON t.township = tr.township AND t.range = tr.range
      WHERE t.geometry IS NOT NULL
    `;

    const result = await env.WELLS_DB.prepare(query).all();

    if (!result.results || result.results.length === 0) {
      const empty = JSON.stringify({ type: "FeatureCollection", features: [] });
      return new Response(empty, {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com' }
      });
    }

    // Build GeoJSON FeatureCollection
    const featureCollection = {
      type: "FeatureCollection",
      features: (result.results as any[]).map(row => {
        // Limit operators list to top 5 for tooltip readability
        const operators = (row.operators || '').split(',').slice(0, 5).join(', ');

        return {
          type: "Feature",
          properties: {
            township: row.township,
            range: row.range,
            meridian: row.meridian,
            avg_bonus: row.avg_bonus,
            min_bonus: row.min_bonus,
            max_bonus: row.max_bonus,
            order_count: row.order_count,
            counties: row.counties,
            operators,
            latest_order: row.latest_order,
            TWNSHPLAB: `${row.township} ${row.range}`
          },
          geometry: JSON.parse(row.geometry)
        };
      })
    };

    console.log(`[MapData] Returning pooling rates for ${featureCollection.features.length} townships`);

    const body = JSON.stringify(featureCollection);

    // Cache in KV (4 hours)
    if (env.OCC_CACHE) {
      try {
        await env.OCC_CACHE.put(cacheKey, body, { expirationTtl: 14400 });
      } catch (e) {
        console.error('[MapData] KV cache write error:', e);
      }
    }

    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com',
        'X-Cache': 'MISS'
      }
    });

  } catch (error) {
    console.error('[MapData] Error fetching pooling rates:', error);
    return jsonResponse({
      error: 'Failed to fetch pooling rates',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}