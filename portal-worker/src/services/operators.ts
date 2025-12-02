/**
 * Operator Lookup Service
 * 
 * Provides comprehensive operator information including phone numbers
 * from the OCC operator list Excel file
 */

import type { Env } from '../types/env.js';
import { OPERATOR_DATA } from '../data/operators.js';

export interface OperatorInfo {
  name: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  email?: string;
  contactName?: string;
  status?: string;
  lastUpdated?: string;
}

let operatorCache: Map<string, OperatorInfo> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load operator data from embedded data
 * @returns Map of normalized operator name to operator info
 */
function loadOperatorData(): Map<string, OperatorInfo> {
  const operatorMap = new Map<string, OperatorInfo>();

  try {
    console.log(`[Operators] Loading ${Object.keys(OPERATOR_DATA).length} operators from embedded data`);
    
    // Convert object to Map
    for (const [normalizedName, operatorInfo] of Object.entries(OPERATOR_DATA)) {
      operatorMap.set(normalizedName, operatorInfo as OperatorInfo);
    }
    
    console.log(`[Operators] Successfully loaded ${operatorMap.size} operators from embedded data`);
    
  } catch (error) {
    console.error('[Operators] Failed to load operator data:', error);
    console.error('[Operators] Stack trace:', error.stack);
  }
  
  return operatorMap;
}

/**
 * Load and parse the operator list Excel file
 * @param env Worker environment
 * @returns Map of operator name to operator info
 */
async function loadOperatorList(env: Env): Promise<Map<string, OperatorInfo>> {
  // Check if we have a valid cache
  if (operatorCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return operatorCache;
  }

  // Try to load from KV cache first
  const cached = await env.OCC_CACHE?.get('operator-list', { type: 'json' });
  // Force refresh for now to get new data with status field
  const forceRefresh = true; // TODO: Remove after confirming status field is working
  if (cached && cached.timestamp && Date.now() - cached.timestamp < CACHE_TTL && !forceRefresh) {
    console.log('[Operators] Loaded from KV cache');
    operatorCache = new Map(cached.operators);
    cacheTimestamp = cached.timestamp;
    return operatorCache;
  }

  // Load fresh data from embedded data
  console.log('[Operators] Loading fresh data from embedded operators');
  try {
    operatorCache = loadOperatorData();
    cacheTimestamp = Date.now();

    // Save to KV cache for future requests only if we got data
    if (operatorCache.size > 0) {
      try {
        await env.OCC_CACHE?.put('operator-list', JSON.stringify({
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
 * Clean operator name for better matching
 */
function cleanOperatorName(name: string): string {
  return name.toLowerCase()
    .trim()
    // Remove common business suffixes/prefixes
    .replace(/\b(inc|llc|corp|corporation|ltd|limited|company|co|lp|lc|pllc)\b/g, '')
    // Remove common oil/gas terms that vary
    .replace(/\b(petroleum|oil|gas|energy|resources|exploration|production|operating|operators?|development|drilling)\b/g, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get individual words from cleaned name
 */
function getNameWords(name: string): string[] {
  return cleanOperatorName(name)
    .split(/\s+/)
    .filter(word => word.length > 2); // Ignore very short words
}

/**
 * Calculate match score between two operator names
 */
function calculateMatchScore(searchName: string, candidateName: string): number {
  const searchWords = getNameWords(searchName);
  const candidateWords = getNameWords(candidateName);
  
  if (searchWords.length === 0 || candidateWords.length === 0) {
    return 0;
  }
  
  let matchedWords = 0;
  let exactMatches = 0;
  
  for (const searchWord of searchWords) {
    for (const candidateWord of candidateWords) {
      // Exact word match
      if (searchWord === candidateWord) {
        exactMatches++;
        matchedWords++;
        break;
      }
      // Partial match (either word contains the other)
      else if (searchWord.includes(candidateWord) || candidateWord.includes(searchWord)) {
        matchedWords++;
        break;
      }
    }
  }
  
  // Score: exact matches worth more + partial matches + completeness bonus
  const exactScore = exactMatches * 2;
  const partialScore = (matchedWords - exactMatches);
  const completenessBonus = matchedWords / Math.max(searchWords.length, candidateWords.length);
  
  return exactScore + partialScore + completenessBonus;
}

/**
 * Find operator information by name (exact match preferred, conservative fuzzy matching)
 * @param operatorName The operator name to search for
 * @param env Worker environment
 * @returns OperatorInfo or null if not found
 */
export async function findOperatorByName(operatorName: string, env: Env): Promise<OperatorInfo | null> {
  if (!operatorName) return null;

  const operators = await loadOperatorList(env);
  
  // Normalize the search name
  const searchName = operatorName.trim().toLowerCase();
  
  // 1. Try exact match first - this is the safest
  let operator = operators.get(searchName);
  if (operator) {
    console.log(`[Operators] Exact match found for "${operatorName}" - Status: ${operator.status}`);
    return operator;
  }
  
  // Debug: Log some info about what we have
  console.log(`[DEBUG] Operators cache size: ${operators.size}`);
  console.log(`[DEBUG] Looking for exact key: "${searchName}"`);
  console.log(`[DEBUG] Key exists in cache: ${operators.has(searchName)}`);
  
  // Check if we have any diversified operators
  const diversifiedKeys = Array.from(operators.keys()).filter(k => k.includes('diversified'));
  console.log(`[DEBUG] Diversified operators in cache: ${diversifiedKeys.length > 0 ? diversifiedKeys.slice(0, 3) : 'none'}`);
  

  // 2. Try exact match with different case/spacing
  for (const [name, info] of operators) {
    if (name === searchName || name.replace(/\s+/g, ' ') === searchName.replace(/\s+/g, ' ')) {
      console.log(`[Operators] Normalized exact match found for "${operatorName}" - Status: ${info.status}`);
      return info;
    }
  }

  // 3. Conservative fuzzy matching - only for high-confidence matches
  let bestOpenMatch: OperatorInfo | null = null;
  let bestClosedMatch: OperatorInfo | null = null;
  let bestOpenScore = 0;
  let bestClosedScore = 0;
  
  for (const [name, info] of operators) {
    // Calculate similarity score
    const score = calculateMatchScore(searchName, name);
    
    // Only consider high-confidence matches (score >= 3) to avoid confusion
    if (score >= 3) {
      if (info.status === 'OPEN') {
        if (score > bestOpenScore) {
          bestOpenScore = score;
          bestOpenMatch = info;
        }
      } else {
        if (score > bestClosedScore) {
          bestClosedScore = score;
          bestClosedMatch = info;
        }
      }
    }
  }
  
  // Prefer OPEN operators over CLOSED ones
  if (bestOpenMatch) {
    console.log(`[Operators] Found OPEN fuzzy match for "${operatorName}": ${bestOpenMatch.name} (score: ${bestOpenScore})`);
    return bestOpenMatch;
  }
  
  if (bestClosedMatch) {
    console.log(`[Operators] Found CLOSED fuzzy match for "${operatorName}": ${bestClosedMatch.name} (score: ${bestClosedScore})`);
    return bestClosedMatch;
  }

  console.log(`[Operators] No match found for "${operatorName}"`);
  return null;
}

/**
 * Update operator information (for when permit has newer phone data)
 * @param operatorName Operator name
 * @param updates Partial operator info to update
 * @param env Worker environment
 */
export async function updateOperatorInfo(operatorName: string, updates: Partial<OperatorInfo>, env: Env): Promise<void> {
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
    await env.OCC_CACHE?.put('operator-list', JSON.stringify({
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
 * @param operatorName Operator name
 * @param env Worker environment
 * @returns Formatted phone number or null
 */
export async function getOperatorPhone(operatorName: string, env: Env): Promise<string | null> {
  try {
    const operator = await findOperatorByName(operatorName, env);
    return operator?.phone || null;
  } catch (error) {
    console.warn(`[Operators] Error in getOperatorPhone for ${operatorName}:`, error);
    return null;
  }
}

/**
 * Refresh the operator cache (force reload from Excel)
 * @param env Worker environment
 */
export async function refreshOperatorCache(env: Env): Promise<void> {
  operatorCache = null;
  cacheTimestamp = 0;
  await env.OCC_CACHE?.delete('operator-list');
  console.log('[Operators] Cache cleared - will reload on next request');
}