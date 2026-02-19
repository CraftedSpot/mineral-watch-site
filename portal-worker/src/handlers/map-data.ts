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

/**
 * GET /api/map/pooling-orders?township=09N&range=05W
 * Returns all pooling orders for a specific township with election options.
 */
export async function handleGetPoolingOrders(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const url = new URL(request.url);
    const township = url.searchParams.get('township');
    const range = url.searchParams.get('range');

    if (!township || !range) {
      return jsonResponse({ error: 'township and range parameters required' }, 400);
    }

    const result = await env.WELLS_DB.prepare(`
      SELECT po.id, po.case_number, po.order_number, po.order_date, po.operator,
             po.applicant, po.proposed_well_name, po.section, po.township, po.range, po.county,
             po.well_type, po.formations, po.unit_size_acres, po.response_deadline,
             peo.option_number, peo.option_type, peo.bonus_per_acre,
             peo.royalty_fraction, peo.royalty_decimal
      FROM pooling_orders po
      LEFT JOIN pooling_election_options peo ON peo.pooling_order_id = po.id
      WHERE po.township = ? AND po.range = ?
      ORDER BY po.order_date DESC, peo.option_number ASC
    `).bind(township, range).all();

    // Group rows by order ID → orders with nested electionOptions
    const ordersMap = new Map<string, any>();
    for (const row of (result.results as any[])) {
      if (!ordersMap.has(row.id)) {
        let formations: any[] = [];
        try { formations = row.formations ? JSON.parse(row.formations) : []; } catch {}
        ordersMap.set(row.id, {
          id: row.id,
          caseNumber: row.case_number,
          orderNumber: row.order_number,
          orderDate: row.order_date,
          operator: row.operator,
          applicant: row.applicant,
          wellName: row.proposed_well_name,
          section: row.section,
          township: row.township,
          range: row.range,
          county: row.county,
          wellType: row.well_type,
          formations,
          unitSizeAcres: row.unit_size_acres,
          responseDeadline: row.response_deadline,
          electionOptions: []
        });
      }
      if (row.option_number != null) {
        ordersMap.get(row.id)!.electionOptions.push({
          optionNumber: row.option_number,
          optionType: row.option_type,
          bonusPerAcre: row.bonus_per_acre,
          royaltyFraction: row.royalty_fraction,
          royaltyDecimal: row.royalty_decimal
        });
      }
    }

    const orders = Array.from(ordersMap.values());

    // Compute summary stats
    const bonuses = orders.map(o => {
      const maxOpt = o.electionOptions.reduce((max: any, opt: any) =>
        (opt.bonusPerAcre || 0) > (max.bonusPerAcre || 0) ? opt : max, { bonusPerAcre: 0 });
      return maxOpt.bonusPerAcre || 0;
    }).filter((b: number) => b > 0);

    const avgBonus = bonuses.length > 0 ? Math.round(bonuses.reduce((a: number, b: number) => a + b, 0) / bonuses.length) : 0;
    const minBonus = bonuses.length > 0 ? Math.round(Math.min(...bonuses)) : 0;
    const maxBonus = bonuses.length > 0 ? Math.round(Math.max(...bonuses)) : 0;

    const operatorCounts = new Map<string, number>();
    for (const o of orders) {
      if (o.operator) operatorCounts.set(o.operator, (operatorCounts.get(o.operator) || 0) + 1);
    }
    const topOperators = Array.from(operatorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    return jsonResponse({
      success: true,
      township,
      range,
      orderCount: orders.length,
      avgBonus,
      minBonus,
      maxBonus,
      topOperators,
      orders
    });

  } catch (error) {
    console.error('[MapData] Error fetching pooling orders:', error);
    return jsonResponse({
      error: 'Failed to fetch pooling orders',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}

/**
 * Get OCC activity for a specific operator
 * GET /api/map/operator-activity?operator=DEVON ENERGY
 */
export async function handleGetOperatorActivity(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.WELLS_DB) {
      return jsonResponse({ error: 'Database not configured' }, 503);
    }

    const url = new URL(request.url);
    const operator = url.searchParams.get('operator');
    if (!operator) {
      return jsonResponse({ error: 'operator parameter required' }, 400);
    }

    // Simple LIKE pattern on raw operator name (avoid REPLACE in WHERE for perf)
    const opUpper = operator.toUpperCase().trim();
    const opPattern = `%${opUpper}%`;

    // Query occ_docket_entries by applicant
    const docketResult = await env.WELLS_DB.prepare(`
      SELECT case_number, relief_type, applicant, county,
             section, township, range, meridian,
             hearing_date, status, docket_date
      FROM occ_docket_entries
      WHERE UPPER(applicant) LIKE ?
      ORDER BY docket_date DESC
      LIMIT 100
    `).bind(opPattern).all();

    // Query pooling_orders by operator (with GROUP BY for MAX aggregate)
    const poolingResult = await env.WELLS_DB.prepare(`
      SELECT po.id, po.case_number, po.order_number, po.order_date, po.operator,
             po.proposed_well_name, po.section, po.township, po.range, po.county,
             po.formations, po.unit_size_acres,
             MAX(peo.bonus_per_acre) as max_bonus
      FROM pooling_orders po
      LEFT JOIN pooling_election_options peo ON peo.pooling_order_id = po.id
      WHERE UPPER(po.operator) LIKE ?
         OR UPPER(po.applicant) LIKE ?
      GROUP BY po.id
      ORDER BY po.order_date DESC
      LIMIT 50
    `).bind(opPattern, opPattern).all();

    // Group docket entries by relief_type
    const byType: Record<string, any[]> = {};
    for (const row of (docketResult.results as any[])) {
      const type = row.relief_type || 'OTHER';
      if (!byType[type]) byType[type] = [];
      byType[type].push({
        caseNumber: row.case_number,
        reliefType: row.relief_type,
        applicant: row.applicant,
        county: row.county,
        section: row.section,
        township: row.township,
        range: row.range,
        hearingDate: row.hearing_date,
        status: row.status,
        docketDate: row.docket_date
      });
    }

    // Build type summary with counts
    const typeSummary = Object.entries(byType).map(([type, entries]) => ({
      type,
      count: entries.length,
      mostRecent: entries[0]?.docketDate || entries[0]?.hearingDate || null
    })).sort((a, b) => b.count - a.count);

    // Build pooling orders list
    const poolingOrders = (poolingResult.results as any[]).map(row => {
      let formations: string[] = [];
      try { formations = row.formations ? JSON.parse(row.formations) : []; } catch {}
      return {
        caseNumber: row.case_number,
        orderNumber: row.order_number,
        orderDate: row.order_date,
        wellName: row.proposed_well_name,
        section: row.section,
        township: row.township,
        range: row.range,
        county: row.county,
        formations,
        unitSizeAcres: row.unit_size_acres,
        maxBonus: row.max_bonus
      };
    });

    // Recent filings (most recent 20 across all types)
    const recentFilings = (docketResult.results as any[]).slice(0, 20).map(row => ({
      caseNumber: row.case_number,
      reliefType: row.relief_type,
      applicant: row.applicant,
      county: row.county,
      section: row.section,
      township: row.township,
      range: row.range,
      hearingDate: row.hearing_date,
      status: row.status,
      docketDate: row.docket_date
    }));

    return jsonResponse({
      success: true,
      operator,
      typeSummary,
      totalFilings: docketResult.results.length,
      recentFilings,
      poolingOrders,
      poolingCount: poolingOrders.length
    });

  } catch (error) {
    console.error('[MapData] Error fetching operator activity:', error);
    return jsonResponse({
      error: 'Failed to fetch operator activity',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}