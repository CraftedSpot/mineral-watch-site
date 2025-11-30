/**
 * OCC GIS Service - Fetches well details from OCC GIS REST API
 * Used for generating accurate map links with GPS coordinates
 */

const OCC_WELLS_API = 'https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query';

// Cache TTL: 30 days (well coordinates don't change)
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Fetch well details from OCC GIS API with KV caching
 * @param {string} api10 - 10-digit API number (e.g., "3501122526")
 * @param {Object} env - Worker environment with MINERAL_CACHE binding
 * @param {boolean} forceRefresh - Skip cache and force fresh lookup
 * @returns {Object|null} - Well details or null if not found
 */
export async function fetchWellCoordinates(api10, env, forceRefresh = false) {
  if (!api10 || api10.length !== 10) {
    console.log(`[OCC GIS] Invalid API format: ${api10}`);
    return null;
  }

  const cacheKey = `well-coords:${api10}`;

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    try {
      const cached = await env.MINERAL_CACHE.get(cacheKey, { type: 'json' });
      if (cached) {
        console.log(`[OCC GIS] Cache hit for ${api10}`);
        return cached;
      }
    } catch (err) {
      console.warn(`[OCC GIS] Cache read error for ${api10}:`, err.message);
    }
  } else {
    console.log(`[OCC GIS] Force refresh requested for ${api10}, skipping cache`);
  }

  // Fetch from OCC GIS API
  console.log(`[OCC GIS] Fetching coordinates for API ${api10}`);
  
  try {
    // DEBUG: Try multiple API formats to see which one works
    const apiFormats = [
      api10,                                    // Full format: 3500900005
      api10.substring(2),                      // Without state code: 00900005
      api10.substring(2).replace(/^0+/, ''),   // Without leading zeros: 900005
      parseInt(api10, 10)                      // As number: 3500900005
    ];
    
    console.log(`[OCC GIS] Testing API formats for ${api10}:`);
    apiFormats.forEach((format, i) => {
      console.log(`  Format ${i}: ${format} (type: ${typeof format})`);
    });
    
    // Try each format until we find a match
    for (let i = 0; i < apiFormats.length; i++) {
      const testApi = apiFormats[i];
      console.log(`[OCC GIS] Trying format ${i}: ${testApi}`);
      
      const url = new URL(OCC_WELLS_API);
      const whereClause = `api=${testApi}`;
      url.searchParams.set('where', whereClause);
      url.searchParams.set('outFields', 'api,well_name,well_num,operator,wellstatus,welltype,sh_lat,sh_lon,county,section,township,range,pm');
      url.searchParams.set('f', 'json');
      
      console.log(`[OCC GIS] Query URL: ${url.toString()}`);

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'MineralWatch/2.0 (mineral rights monitoring service)'
        }
      });

      if (!response.ok) {
        console.error(`[OCC GIS] API request failed for format ${i}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      console.log(`[OCC GIS] Format ${i} returned ${data.features?.length || 0} results`);

      // Check if we got a result
      if (data.features && data.features.length > 0) {
        console.log(`[OCC GIS] SUCCESS! Found well with API format ${i}: ${testApi}`);
        
        // Extract well attributes
        const attrs = data.features[0].attributes;
        console.log(`[OCC GIS] Well data:`, attrs);
        
        const wellData = {
          api: String(attrs.api),
          well_name: attrs.well_name || null,
          well_num: attrs.well_num || null,
          operator: attrs.operator || null,
          wellstatus: attrs.wellstatus || null,
          welltype: attrs.welltype || null,
          sh_lat: attrs.sh_lat || null,
          sh_lon: attrs.sh_lon || null,
          county: attrs.county || null,
          section: attrs.section || null,
          township: attrs.township || null,
          range: attrs.range || null,
          pm: attrs.pm || null,
          fetchedAt: new Date().toISOString(),
          workingFormat: `Format ${i}: ${testApi}`  // Debug info
        };

        // Validate we have coordinates
        if (!wellData.sh_lat || !wellData.sh_lon) {
          console.log(`[OCC GIS] Well ${api10} found but missing coordinates`);
          wellData.missingCoordinates = true;
        }

        // Cache the result
        await cacheWellData(env, cacheKey, wellData);

        console.log(`[OCC GIS] Successfully fetched ${api10}: ${wellData.well_name} (${wellData.sh_lat}, ${wellData.sh_lon})`);
        return wellData;
      }
    }
    
    // If none of the formats worked
    console.log(`[OCC GIS] No well found for any API format of ${api10}`);
    await cacheWellData(env, cacheKey, { notFound: true });
    return null;

    // This code block is now handled above in the loop

  } catch (err) {
    console.error(`[OCC GIS] Error fetching ${api10}:`, err.message);
    return null;
  }
}

/**
 * Cache well data in KV
 * @param {Object} env - Worker environment
 * @param {string} cacheKey - Cache key
 * @param {Object} data - Data to cache
 */
async function cacheWellData(env, cacheKey, data) {
  try {
    await env.MINERAL_CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL_SECONDS
    });
  } catch (err) {
    console.warn(`[OCC GIS] Cache write error:`, err.message);
  }
}

/**
 * Batch fetch well coordinates for multiple APIs
 * Useful for processing many permits efficiently
 * @param {string[]} apiNumbers - Array of 10-digit API numbers
 * @param {Object} env - Worker environment
 * @returns {Map<string, Object>} - Map of API number to well data
 */
export async function batchFetchWellCoordinates(apiNumbers, env) {
  const results = new Map();
  
  // Process in parallel but with reasonable concurrency
  const batchSize = 10;
  for (let i = 0; i < apiNumbers.length; i += batchSize) {
    const batch = apiNumbers.slice(i, i + batchSize);
    const promises = batch.map(api => fetchWellCoordinates(api, env));
    const batchResults = await Promise.all(promises);
    
    batch.forEach((api, idx) => {
      if (batchResults[idx]) {
        results.set(api, batchResults[idx]);
      }
    });
  }
  
  return results;
}
