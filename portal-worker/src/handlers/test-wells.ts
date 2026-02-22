/**
 * Test endpoint for debugging TRS parsing
 * GET /api/test-wells
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

/**
 * Normalize township/range values to match D1 database format
 * Examples: '9N' → '09N', '5W' → '05W', '15N' stays '15N'
 */
function normalizeTownshipRange(value: string): string {
  // Extract numeric part and direction
  const match = value.match(/^(\d+)([NSEW])$/);
  if (!match) return value;
  
  const [, num, direction] = match;
  const numericPart = parseInt(num);
  
  // Pad single digits with leading zero
  const paddedNum = numericPart < 10 ? `0${numericPart}` : numericPart.toString();
  
  return `${paddedNum}${direction}`;
}

export async function handleTestWells(request: Request, env: Env): Promise<Response> {
  try {
    // Authenticate request
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Check if WELLS_DB is configured
    if (!env.WELLS_DB) {
      console.error('[TestWells] WELLS_DB not configured');
      return jsonResponse({ 
        error: 'Wells database not configured',
        message: 'The test wells feature is not available at this time'
      }, 503);
    }

    // Hardcoded test TRS values from different counties
    const testTRS = [
      '18-18N-17W-IM',  // Dewey County
      '15-22N-15W-IM',  // Blaine County
      '10-11N-03W-IM'   // Logan County
    ];

    console.log('[TestWells] Starting test with hardcoded TRS values:', testTRS);

    const results = [];

    for (const trsParam of testTRS) {
      console.log(`\n[TestWells] Processing TRS: "${trsParam}"`);
      
      // Parse using regex (same as nearby-wells handler)
      const match = trsParam.match(/^(\d+)-(\d+[NS])-(\d+[EW])-([IC]M)$/i);
      if (!match) {
        console.error(`[TestWells] Failed to parse TRS: "${trsParam}"`);
        results.push({
          trs: trsParam,
          error: 'Failed to parse TRS format'
        });
        continue;
      }

      const [_, section, township, range, meridian] = match;
      console.log(`[TestWells] Regex parsed: section="${section}", township="${township}", range="${range}", meridian="${meridian}"`);
      
      // Normalize township and range
      const normalizedTownship = normalizeTownshipRange(township.toUpperCase());
      const normalizedRange = normalizeTownshipRange(range.toUpperCase());
      const normalizedMeridian = meridian.toUpperCase();
      
      console.log(`[TestWells] Normalized: section=${section}, township=${normalizedTownship}, range=${normalizedRange}, meridian=${normalizedMeridian}`);
      
      // Run exact SQL query
      const query = `
        SELECT * FROM wells 
        WHERE section=? AND township=? AND range=? AND meridian=? AND well_status='AC'
        LIMIT 3
      `;
      
      const countQuery = `
        SELECT COUNT(*) as count FROM wells 
        WHERE section=? AND township=? AND range=? AND meridian=? AND well_status='AC'
      `;
      
      try {
        // Get count first
        const countResult = await env.WELLS_DB.prepare(countQuery)
          .bind(parseInt(section), normalizedTownship, normalizedRange, normalizedMeridian)
          .first();
        
        console.log(`[TestWells] Count query result:`, countResult);
        
        // Get first 3 wells
        const wellsResult = await env.WELLS_DB.prepare(query)
          .bind(parseInt(section), normalizedTownship, normalizedRange, normalizedMeridian)
          .all();
        
        console.log(`[TestWells] Wells query found ${wellsResult.results.length} wells`);
        
        results.push({
          trs: trsParam,
          parsed: {
            section: parseInt(section),
            township: normalizedTownship,
            range: normalizedRange,
            meridian: normalizedMeridian
          },
          count: countResult?.count || 0,
          wells: wellsResult.results
        });
        
      } catch (error) {
        console.error(`[TestWells] SQL error for ${trsParam}:`, error);
        results.push({
          trs: trsParam,
          error: `SQL error: ${(error as any).message}`
        });
      }
    }

    // Also run a test query to see what townships we have active wells in
    const townshipQuery = `
      SELECT DISTINCT township, range, COUNT(*) as count 
      FROM wells 
      WHERE well_status='AC' 
      GROUP BY township, range 
      ORDER BY count DESC 
      LIMIT 10
    `;
    
    const townshipResult = await env.WELLS_DB.prepare(townshipQuery).all();
    console.log(`[TestWells] Top townships with active wells:`, townshipResult.results);

    return jsonResponse({
      success: true,
      testResults: results,
      topTownships: townshipResult.results,
      message: 'Test endpoint executed successfully. Check logs for detailed parsing info.'
    });

  } catch (error) {
    console.error('[TestWells] Error:', error);
    return jsonResponse({ 
      error: 'Failed to execute test',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
}