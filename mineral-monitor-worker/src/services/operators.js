/**
 * Operator Lookup Service
 * 
 * Provides comprehensive operator information including phone numbers
 * from the OCC operator list Excel file
 */

// Operator lookup service - simplified to use JSON instead of XLSX

let operatorCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load operator data from JSON file and create a map of operators
 * @returns {Map} Map of normalized operator name to operator info
 */
async function loadOperatorData() {
  const operatorMap = new Map();

  try {
    // Fetch the pre-processed JSON file from assets
    // In production, this is served from the worker's assets
    const url = new URL('/operators.json', 'https://mineral-watch-monitor.photog12.workers.dev');
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch operators data: ${response.status}`);
    }
    
    const operatorData = await response.json();
    
    console.log(`[Operators] Loading ${Object.keys(operatorData).length} operators from JSON`);
    
    // Convert object to Map
    for (const [normalizedName, operatorInfo] of Object.entries(operatorData)) {
      operatorMap.set(normalizedName, operatorInfo);
    }
    
    console.log(`[Operators] Successfully loaded ${operatorMap.size} operators from JSON file`);
    
  } catch (error) {
    console.error('[Operators] Failed to load operator data:', error);
    console.error('[Operators] Stack trace:', error.stack);
    // Return empty map if parsing fails - this allows wells to still be added
  }
  
  return operatorMap;
}

/**
 * Load and parse the operator list from cache or Excel file
 * @param {Object} env - Worker environment
 * @returns {Map} Map of operator name to operator info
 */
async function loadOperatorList(env) {
  // Check if we have a valid cache
  if (operatorCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return operatorCache;
  }

  // Try to load from KV cache first
  const cached = await env.MINERAL_CACHE?.get('operator-list', { type: 'json' });
  if (cached && cached.timestamp && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[Operators] Loaded from KV cache');
    operatorCache = new Map(cached.operators);
    cacheTimestamp = cached.timestamp;
    return operatorCache;
  }

  // Load fresh data from JSON file
  console.log('[Operators] Loading fresh data from operators.json');
  try {
    operatorCache = await loadOperatorData();
    cacheTimestamp = Date.now();

    // Save to KV cache for future requests only if we got data
    if (operatorCache.size > 0) {
      try {
        await env.MINERAL_CACHE?.put('operator-list', JSON.stringify({
          operators: Array.from(operatorCache.entries()),
          timestamp: cacheTimestamp
        }), {
          expirationTtl: CACHE_TTL / 1000 // Convert to seconds
        });
        console.log(`[Operators] Cached ${operatorCache.size} operators to KV storage`);
      } catch (error) {
        console.warn('[Operators] Failed to save initial cache to KV:', error);
      }
    }
  } catch (error) {
    console.error('[Operators] Failed to load operator data:', error);
    operatorCache = new Map(); // Empty map to prevent future failures
    cacheTimestamp = Date.now();
  }
  
  return operatorCache;
}

/**
 * Find operator information by name (fuzzy matching)
 * @param {string} operatorName - The operator name to search for
 * @param {Object} env - Worker environment
 * @returns {Object|null} OperatorInfo or null if not found
 */
export async function findOperatorByName(operatorName, env) {
  if (!operatorName) return null;

  const operators = await loadOperatorList(env);
  
  // Normalize the search name
  const searchName = operatorName.trim().toLowerCase();
  
  // Try exact match first
  let operator = operators.get(searchName);
  if (operator) return operator;

  // Try fuzzy matching
  for (const [name, info] of operators) {
    if (name.toLowerCase().includes(searchName) || searchName.includes(name.toLowerCase())) {
      return info;
    }
  }

  // Try without common suffixes/prefixes
  const cleanedName = searchName
    .replace(/\b(inc|llc|corp|ltd|company|co|petroleum|oil|gas|energy|resources|exploration|production|operating|operators?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanedName !== searchName) {
    for (const [name, info] of operators) {
      const cleanedOperatorName = name.toLowerCase()
        .replace(/\b(inc|llc|corp|ltd|company|co|petroleum|oil|gas|energy|resources|exploration|production|operating|operators?)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (cleanedOperatorName.includes(cleanedName) || cleanedName.includes(cleanedOperatorName)) {
        return info;
      }
    }
  }

  return null;
}

/**
 * Update operator information (for when permit has newer phone data)
 * @param {string} operatorName - Operator name
 * @param {Object} updates - Partial operator info to update
 * @param {Object} env - Worker environment
 */
export async function updateOperatorInfo(operatorName, updates, env) {
  if (!operatorName) return;

  const operators = await loadOperatorList(env);
  const searchName = operatorName.trim().toLowerCase();
  
  let existing = operators.get(searchName);
  if (!existing) {
    existing = { name: operatorName };
  }

  const updated = {
    ...existing,
    ...updates,
    lastUpdated: new Date().toISOString()
  };

  operators.set(searchName, updated);
  
  // Update cache
  operatorCache = operators;
  cacheTimestamp = Date.now();

  // Save to KV cache
  try {
    await env.MINERAL_CACHE?.put('operator-list', JSON.stringify({
      operators: Array.from(operators.entries()),
      timestamp: cacheTimestamp
    }), {
      expirationTtl: CACHE_TTL / 1000 // Convert to seconds
    });
    console.log(`[Operators] Updated operator: ${operatorName}`);
  } catch (error) {
    console.warn('[Operators] Failed to save to KV cache:', error);
  }
}

/**
 * Get operator phone number for display/linking
 * @param {string} operatorName - Operator name
 * @param {Object} env - Worker environment
 * @returns {string|null} Formatted phone number or null
 */
export async function getOperatorPhone(operatorName, env) {
  const operator = await findOperatorByName(operatorName, env);
  return operator?.phone || null;
}