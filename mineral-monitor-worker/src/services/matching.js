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
  const seenUsers = new Set(); // Prevent duplicate alerts
  
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
    // Case 1: Individual user linked to property
    const userIds = prop.fields.User;
    if (userIds && userIds.length > 0) {
      const user = await getUserById(env, userIds[0]);
      if (user && user.fields.Status === 'Active' && !seenUsers.has(user.id)) {
        seenUsers.add(user.id);
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
    }
    
    // Case 2: Organization linked to property - get all users in the org
    const orgIds = prop.fields.Organization;
    if (orgIds && orgIds.length > 0) {
      const orgId = orgIds[0]; // Get first org ID (properties typically belong to one org)
      console.log(`[Matching] Property in ${normalizedSec}-${township}-${range} belongs to organization ID: ${orgId}`);
      
      // Fetch the Organization record directly by ID
      try {
        const orgUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('🏢 Organization')}/${orgId}`;
        const orgResponse = await fetch(orgUrl, {
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (orgResponse.ok) {
          const org = await orgResponse.json();
          const orgName = org.fields.Name;
          const orgUserIds = org.fields['👤 Users'] || [];
          
          console.log(`[Matching] Organization "${orgName}" has ${orgUserIds.length} users`);
          
          // Get all active users in the organization
          for (const orgUserId of orgUserIds) {
            if (!seenUsers.has(orgUserId)) {
              const orgUser = await getUserById(env, orgUserId);
              if (orgUser && orgUser.fields.Status === 'Active') {
                seenUsers.add(orgUserId);
                matches.push({
                  property: prop,
                  user: {
                    id: orgUser.id,
                    email: orgUser.fields.Email,
                    name: orgUser.fields.Name
                  },
                  alertLevel: 'YOUR PROPERTY',
                  matchedSection: `${normalizedSec}-${township}-${range}`,
                  viaOrganization: orgName
                });
              }
            }
          }
        } else {
          console.error(`[Matching] Failed to fetch organization ${orgId}: ${orgResponse.status}`);
        }
      } catch (error) {
        console.error(`[Matching] Error fetching organization ${orgId}:`, error);
      }
    }
  }
  
  // ALWAYS check for adjacent section matches (users who own sections adjacent to this permit)
  // This runs independently of direct matches
  const adjacentMatches = await findUsersMonitoringAdjacentTo(location, env);
  
  // Filter out users who already have a direct match to avoid duplicates
  const uniqueAdjacentMatches = adjacentMatches.filter(adjMatch => 
    !matches.some(m => m.user.id === adjMatch.user.id)
  );
  
  matches.push(...uniqueAdjacentMatches);
  
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
    // Case 1: Individual user linked to property
    const userIds = prop.fields.User;
    if (userIds && userIds.length > 0) {
      const userId = userIds[0];
      if (!seenUsers.has(userId)) {
        seenUsers.add(userId);
        
        const user = await getUserById(env, userId);
        if (user && user.fields.Status === 'Active') {
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
      }
    }
    
    // Case 2: Organization linked to property - get all users in the org
    const orgIds = prop.fields.Organization;
    if (orgIds && orgIds.length > 0) {
      const orgId = orgIds[0];
      
      try {
        const orgUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('🏢 Organization')}/${orgId}`;
        const orgResponse = await fetch(orgUrl, {
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (orgResponse.ok) {
          const org = await orgResponse.json();
          const orgName = org.fields.Name;
          const orgUserIds = org.fields['👤 Users'] || [];
          
          // Determine which adjacent section this property is in
          const propSection = `${normalizeSection(prop.fields.SEC)}-${prop.fields.TWN}-${prop.fields.RNG}`;
          
          // Get all active users in the organization
          for (const orgUserId of orgUserIds) {
            if (!seenUsers.has(orgUserId)) {
              const orgUser = await getUserById(env, orgUserId);
              if (orgUser && orgUser.fields.Status === 'Active') {
                seenUsers.add(orgUserId);
                matches.push({
                  property: prop,
                  user: {
                    id: orgUser.id,
                    email: orgUser.fields.Email,
                    name: orgUser.fields.Name
                  },
                  alertLevel: 'ADJACENT SECTION',
                  matchedSection: propSection,
                  permitSection: `${normalizeSection(section)}-${township}-${range}`,
                  viaOrganization: orgName
                });
              }
            }
          }
        }
      } catch (error) {
        console.error(`[Matching] Error fetching organization ${orgId}:`, error);
      }
    }
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
  const seenUsers = new Set(); // Prevent duplicate alerts
  
  for (const well of wells) {
    // Case 1: Individual user directly linked to well
    const userIds = well.fields.User;
    if (userIds && userIds.length > 0) {
      const user = await getUserById(env, userIds[0]);
      if (user && user.fields.Status === 'Active' && !seenUsers.has(user.id)) {
        seenUsers.add(user.id);
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
    }
    
    // Case 2: Organization linked to well - get all users in the org
    const orgIds = well.fields.Organization;
    if (orgIds && orgIds.length > 0) {
      const orgId = orgIds[0]; // Get first org ID (wells typically belong to one org)
      console.log(`[Matching] Well ${api10} belongs to organization ID: ${orgId}`);
      
      // Fetch the Organization record directly by ID
      try {
        const orgUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('🏢 Organization')}/${orgId}`;
        const orgResponse = await fetch(orgUrl, {
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (orgResponse.ok) {
          const org = await orgResponse.json();
          const orgName = org.fields.Name;
          const orgUserIds = org.fields['👤 Users'] || [];
          
          console.log(`[Matching] Organization "${orgName}" has ${orgUserIds.length} users`);
          
          // Get all active users in the organization
          for (const orgUserId of orgUserIds) {
            if (!seenUsers.has(orgUserId)) {
              const orgUser = await getUserById(env, orgUserId);
              if (orgUser && orgUser.fields.Status === 'Active') {
                seenUsers.add(orgUserId);
                matches.push({
                  well: well,
                  user: {
                    id: orgUser.id,
                    email: orgUser.fields.Email,
                    name: orgUser.fields.Name
                  },
                  alertLevel: 'TRACKED WELL',
                  viaOrganization: orgName
                });
              }
            }
          }
        } else {
          console.error(`[Matching] Failed to fetch organization ${orgId}: ${orgResponse.status}`);
        }
      } catch (error) {
        console.error(`[Matching] Error fetching organization ${orgId}:`, error);
      }
    }
  }
  
  console.log(`[Matching] Well ${api10}: found ${matches.length} users to notify`);
  return matches;
}
