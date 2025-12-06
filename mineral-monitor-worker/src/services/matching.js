/**
 * Matching Service - Finds users with properties/wells that match OCC records
 */

import { queryAirtable, getUserById } from './airtable.js';
import { normalizeSection } from '../utils/normalize.js';
import { getAdjacentSections } from '../utils/plss.js';

/**
 * Find all properties that match a given S-T-R location
 * @param {Object} location - Section, Township, Range, Meridian, County
 * @param {Object} env - Worker environment
 * @returns {Array} - Matching properties with user info and alert level
 */
export async function findMatchingProperties(location, env) {
  const { section, township, range, meridian, county } = location;
  const normalizedSec = normalizeSection(section);
  
  // Default meridian to IM if not specified (Oklahoma convention)
  // Exception: Panhandle counties (Cimarron, Texas, Beaver) default to CM
  const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
  const effectiveMeridian = meridian || 
    (panhandleCounties.includes(county?.toUpperCase()) ? 'CM' : 'IM');
  
  const matches = [];
  
  // Query for exact property matches
  const formula = `AND(
    {SEC} = "${normalizedSec}",
    {TWN} = "${township}",
    {RNG} = "${range}",
    {MERIDIAN} = "${effectiveMeridian}",
    {Status} = "Active"
  )`;
  
  const properties = await queryAirtable(env, env.AIRTABLE_PROPERTIES_TABLE, formula);
  
  for (const prop of properties) {
    // Get the linked user
    const userIds = prop.fields.User;
    if (!userIds || userIds.length === 0) continue;
    
    const user = await getUserById(env, userIds[0]);
    if (!user || user.fields.Status !== 'Active') continue;
    
    matches.push({
      property: prop,
      user: {
        id: user.id,
        email: user.fields.Email,
        name: user.fields.Name
      },
      alertLevel: 'YOUR PROPERTY',
      matchedSection: `${normalizedSec}-${township}-${range}`
    });
  }
  
  // ALWAYS check for adjacent section matches (users who own sections adjacent to this permit)
  // This runs independently of direct matches
  const adjacentMatches = await findUsersMonitoringAdjacentTo(location, env);
  matches.push(...adjacentMatches);
  
  return matches;
}

/**
 * Find users who are monitoring sections adjacent to the given location
 * OPTIMIZED: Single batched query instead of 8 separate queries
 * @param {Object} location - S-T-R of the permit
 * @param {Object} env - Worker environment
 * @returns {Array} - Users who should get ADJACENT SECTION alerts
 */
async function findUsersMonitoringAdjacentTo(location, env) {
  const { section, township, range, meridian } = location;
  const normalizedSec = parseInt(normalizeSection(section), 10);
  
  // Get the 8 sections adjacent to the permit location
  const adjacentSections = getAdjacentSections(normalizedSec, township, range);
  
  // OPTIMIZATION: Build single OR query for all 8 adjacent sections
  const sectionConditions = adjacentSections.map(adj => 
    `AND({SEC} = "${normalizeSection(adj.section)}", {TWN} = "${adj.township}", {RNG} = "${adj.range}")`
  ).join(', ');
  
  const formula = `AND(
    OR(${sectionConditions}),
    {Monitor Adjacent} = TRUE(),
    {Status} = "Active"
  )`;
  
  const properties = await queryAirtable(env, env.AIRTABLE_PROPERTIES_TABLE, formula);
  
  const matches = [];
  const seenUsers = new Set();
  
  for (const prop of properties) {
    const userIds = prop.fields.User;
    if (!userIds || userIds.length === 0) continue;
    
    const userId = userIds[0];
    if (seenUsers.has(userId)) continue;
    seenUsers.add(userId);
    
    const user = await getUserById(env, userId);
    if (!user || user.fields.Status !== 'Active') continue;
    
    // Determine which adjacent section this property is in
    const propSection = `${normalizeSection(prop.fields.SEC)}-${prop.fields.TWN}-${prop.fields.RNG}`;
    
    matches.push({
      property: prop,
      user: {
        id: user.id,
        email: user.fields.Email,
        name: user.fields.Name
      },
      alertLevel: 'ADJACENT SECTION',
      matchedSection: propSection,
      permitSection: `${normalizeSection(section)}-${township}-${range}`
    });
  }
  
  return matches;
}

/**
 * Find users who are tracking a specific well API
 * @param {string} api10 - 10-digit API number
 * @param {Object} env - Worker environment
 * @returns {Array} - Users tracking this well
 */
export async function findMatchingWells(api10, env) {
  const formula = `AND(
    {API Number} = "${api10}",
    {Status} = "Active"
  )`;
  
  const wells = await queryAirtable(env, env.AIRTABLE_WELLS_TABLE, formula);
  const matches = [];
  
  for (const well of wells) {
    const userIds = well.fields.User;
    if (!userIds || userIds.length === 0) continue;
    
    const user = await getUserById(env, userIds[0]);
    if (!user || user.fields.Status !== 'Active') continue;
    
    matches.push({
      well: well,
      user: {
        id: user.id,
        email: user.fields.Email,
        name: user.fields.Name
      },
      alertLevel: 'TRACKED WELL'
    });
  }
  
  return matches;
}
