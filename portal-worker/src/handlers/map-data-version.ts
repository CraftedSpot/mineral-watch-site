/**
 * Map Data Version Handler
 * 
 * Provides version information for cached map data
 */

import { jsonResponse } from '../utils/responses.js';
import type { Env } from '../types/env.js';

// Version string - update this when map data changes
const MAP_DATA_VERSION = '2025-01-07b';

/**
 * Get current map data version
 * GET /api/map-data/version
 */
export async function handleGetMapDataVersion(request: Request, env: Env): Promise<Response> {
  return jsonResponse({
    version: MAP_DATA_VERSION,
    counties_version: MAP_DATA_VERSION,
    townships_version: MAP_DATA_VERSION
  });
}