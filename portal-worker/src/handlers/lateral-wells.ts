/**
 * Handler for searching wells by bottom hole location
 * This catches wells that may start outside the 3x3 grid but have laterals
 * extending into user properties
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

/**
 * Normalize township/range values to match D1 format
 */
function normalizeTownshipRange(value: string): string {
  const match = value.match(/^(\d+)([NSEW])$/);
  if (!match) return value;
  
  const [, num, direction] = match;
  const numericPart = parseInt(num);
  const paddedNum = numericPart < 10 ? `0${numericPart}` : numericPart.toString();
  
  return `${paddedNum}${direction}`;
}

/**
 * Search for wells with bottom holes in specified sections
 * POST /api/wells/lateral-search
 * Body: { trs: string[], status: 'ac' | 'pa' | 'all', limit?: number }
 */
export async function handleLateralWellSearch(request: Request, env: Env): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[LateralWells] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Service unavailable',
        message: 'Wells database is not configured'
      }, 503);
    }

    // Parse request body
    const body = await request.json();
    const { trs: trsParams = [], status = 'ac', limit = 5000 } = body;

    if (trsParams.length === 0) {
      return jsonResponse({ 
        error: 'Missing required parameter',
        message: 'Please provide TRS values in the request body'
      }, 400);
    }

    console.log(`[LateralWells] Searching for wells with bottom holes in ${trsParams.length} sections`);

    // Parse and validate TRS values
    const trsValues = [];
    
    for (const trsParam of trsParams) {
      const match = trsParam.match(/^(\d+)-(\d+[NS])-(\d+[EW])-([IC]M)$/i);
      if (!match) {
        return jsonResponse({ 
          error: 'Invalid TRS format',
          message: `Invalid TRS value: "${trsParam}". Expected format: "section-township-range-meridian"`
        }, 400);
      }

      const [_, section, township, range, meridian] = match;
      
      trsValues.push({
        section: parseInt(section),
        township: normalizeTownshipRange(township.toUpperCase()),
        range: normalizeTownshipRange(range.toUpperCase()),
        meridian: meridian.toUpperCase()
      });
    }

    const startTime = Date.now();
    const allWells: any[] = [];
    const statusUpper = status.toUpperCase();
    
    // Process in batches for parallel execution
    const PARALLEL_BATCH = 10;
    
    for (let i = 0; i < trsValues.length; i += PARALLEL_BATCH) {
      const batch = trsValues.slice(i, Math.min(i + PARALLEL_BATCH, trsValues.length));
      
      console.log(`[LateralWells] Processing batch ${Math.floor(i / PARALLEL_BATCH) + 1} (${batch.length} sections)`);
      
      const batchPromises = batch.map(async (trs) => {
        // Build query to find wells where bottom hole is in this section
        // We'll need to calculate section from lat/lon or use stored section data
        const statusFilter = statusUpper === 'ALL' ? '' : ' AND well_status = ?';
        
        // First, try a direct query if we have bh_section/township/range fields
        // If not, we'll need to use lat/lon calculations
        const query = `
          SELECT 
            w.api_number,
            w.well_name,
            w.well_number,
            w.section,
            w.township,
            w.range,
            w.meridian,
            w.county,
            w.latitude,
            w.longitude,
            w.operator,
            w.well_type,
            w.well_status,
            w.spud_date,
            w.completion_date,
            w.bh_latitude,
            w.bh_longitude,
            w.formation_name,
            w.lateral_length,
            o.phone,
            o.contact_name
          FROM wells w
          LEFT JOIN operators o ON UPPER(TRIM(REPLACE(REPLACE(w.operator, '.', ''), ',', ''))) = o.operator_name_normalized
          WHERE 
            -- Exclude wells already in this surface section (avoid duplicates from 3x3 search)
            NOT (section = ? AND township = ? AND range = ? AND meridian = ?)
            -- Has bottom hole coordinates
            AND bh_latitude IS NOT NULL 
            AND bh_longitude IS NOT NULL
            -- Has significant lateral (more than 0.5 miles = ~2640 ft)
            AND lateral_length > 2640
            -- Bottom hole is different from surface (indicates lateral)
            AND (ABS(bh_latitude - latitude) > 0.01 OR ABS(bh_longitude - longitude) > 0.01)
            ${statusFilter}
          ORDER BY well_name
          LIMIT 500
        `;
        
        // For now, we'll get wells with significant laterals and filter client-side
        // In future, we could add bh_section/township/range columns to D1 for direct querying
        const params = statusUpper === 'ALL' 
          ? [trs.section, trs.township, trs.range, trs.meridian]
          : [trs.section, trs.township, trs.range, trs.meridian, statusUpper];
        
        try {
          const stmt = env.WELLS_DB.prepare(query).bind(...params);
          const result = await stmt.all();
          
          if (result.results && result.results.length > 0) {
            console.log(`[LateralWells] Found ${result.results.length} potential lateral wells for section ${trs.section}-${trs.township}-${trs.range}-${trs.meridian}`);
            
            // Filter to wells whose bottom hole is likely in this section
            // This is a rough approximation - proper implementation would need section boundary calculations
            const sectionWells = result.results.filter((well: any) => {
              // Very rough check - in reality we'd need proper section boundary calculations
              // For now, include all wells with significant laterals that aren't in the surface section
              return true;
            });
            
            return sectionWells;
          }
          
          return [];
        } catch (error) {
          console.error(`[LateralWells] Query error for ${trs.section}-${trs.township}-${trs.range}:`, error);
          return [];
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(wells => allWells.push(...wells));
    }
    
    // Remove duplicates
    const uniqueWells = Array.from(
      new Map(allWells.map(w => [w.api_number, w])).values()
    ).slice(0, limit);
    
    const queryTime = Date.now() - startTime;
    console.log(`[LateralWells] Found ${uniqueWells.length} wells with laterals in ${queryTime}ms`);
    
    return jsonResponse({
      success: true,
      data: {
        wells: uniqueWells,
        total: uniqueWells.length,
        query_time_ms: queryTime,
        search_type: 'lateral_bottom_hole'
      }
    });
    
  } catch (error) {
    console.error('[LateralWells] Error:', error);
    return jsonResponse({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}