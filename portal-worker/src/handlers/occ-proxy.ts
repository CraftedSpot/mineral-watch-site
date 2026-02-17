/**
 * OCC API Proxy Handler
 * 
 * Proxies requests to the Oklahoma Corporation Commission GIS API
 * with caching and rate limiting support
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

// Cache TTL for geometry data (24 hours)
const GEOMETRY_CACHE_TTL = 86400;

/**
 * Handle proxied requests to the OCC API
 * @param request The incoming request
 * @param env Worker environment
 * @returns Proxied response or cached data
 */
export async function handleOccProxy(request: Request, env: Env) {
  const url = new URL(request.url);
  
  // Get the target URL from query parameter
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing url parameter' }, 400);
  }
  
  // Validate it's an OCC GIS URL
  if (!targetUrl.startsWith('https://gis.occ.ok.gov/')) {
    return jsonResponse({ error: 'Invalid URL - must be OCC GIS endpoint' }, 400);
  }
  
  try {
    // Generate cache key from the full URL
    const cacheKey = `occ_proxy:${targetUrl}`;
    
    // Try to get from KV cache first
    if (env.OCC_CACHE) {
      const cached = await env.OCC_CACHE.get(cacheKey, 'text');
      if (cached) {
        console.log(`OCC Proxy cache hit: ${cacheKey}`);
        return new Response(cached, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
            'X-Cache': 'HIT',
            'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com'
          }
        });
      }
    }
    
    // Make the actual request to OCC
    console.log(`OCC Proxy fetching: ${targetUrl}`);
    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MineralWatch/1.0'
      }
    });
    
    if (!response.ok) {
      console.error(`OCC API error: ${response.status} ${response.statusText}`);
      return jsonResponse(
        { error: `OCC API error: ${response.status}` }, 
        response.status
      );
    }
    
    const data = await response.text();
    
    // Cache successful responses
    if (env.OCC_CACHE && response.status === 200) {
      // Don't await - fire and forget for performance
      env.OCC_CACHE.put(cacheKey, data, {
        expirationTtl: GEOMETRY_CACHE_TTL
      });
    }
    
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'MISS',
        'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com'
      }
    });
    
  } catch (error) {
    console.error('OCC Proxy error:', error);
    console.error('Target URL was:', targetUrl);
    return jsonResponse(
      { error: 'Failed to fetch from OCC API' },
      500
    );
  }
}

/**
 * Handle OPTIONS requests for CORS
 */
export function handleOccProxyOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://portal.mymineralwatch.com',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}