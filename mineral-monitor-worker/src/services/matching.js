/**
 * Matching Service - Finds users with properties/wells that match OCC records
 * MIGRATED: Now uses D1 instead of Airtable for reads
 */

import {
  getUserById,
  getPropertiesByLocation,
  getAdjacentProperties,
  getWellsByApiNumber,
  getOrganizationById,
  getOrganizationMembers
} from './d1.js';
import { normalizeSection } from '../utils/normalize.js';
import { getAdjacentSections, getExtendedAdjacentSections } from '../utils/plss.js';

/**
 * Find all properties that match a given S-T-R location
 * @param {Object} location - Section, Township, Range, Meridian, County
 * @param {Object} env - Worker environment
 * @param {Object} options - Optional settings
 * @param {boolean} options.useExtendedGrid - Use 5x5 grid (24 sections) instead of 3x3 (8 sections)
 * @returns {Array} - Matching properties with user info and alert level
 */
export async function findMatchingProperties(location, env, options = {}) {
  const { section, township, range, meridian, county } = location;
  const normalizedSec = normalizeSection(section);

  // Default meridian to IM if not specified (Oklahoma convention)
  // Exception: Panhandle counties (Cimarron, Texas, Beaver) default to CM
  const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
  const effectiveMeridian = meridian ||
    (panhandleCounties.includes(county?.toUpperCase()) ? 'CM' : 'IM');

  const matches = [];
  const seenUsers = new Set(); // Prevent duplicate alerts

  // Query D1 for exact property matches
  const properties = await getPropertiesByLocation(env, {
    section: normalizedSec,
    township,
    range,
    meridian: effectiveMeridian
  });

  for (const prop of properties) {
    // Case 1: Individual user linked to property (via JOIN)
    if (prop._user && prop._user.id) {
      const userId = prop._user.id;
      if (!seenUsers.has(userId)) {
        // Verify user is active by fetching full record
        const user = await getUserById(env, userId);
        if (user && user.fields.Status === 'Active') {
          seenUsers.add(userId);
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
    }

    // Case 2: Organization linked to property - get all users in the org
    const orgIds = prop.fields.Organization;
    if (orgIds && orgIds.length > 0) {
      const orgId = orgIds[0];
      console.log(`[Matching] Property in ${normalizedSec}-${township}-${range} belongs to organization ID: ${orgId}`);

      try {
        const org = await getOrganizationById(env, orgId);
        if (org) {
          const orgName = org.fields.Name;
          const orgMembers = await getOrganizationMembers(env, orgId);

          console.log(`[Matching] Organization "${orgName}" has ${orgMembers.length} active members`);

          for (const orgUser of orgMembers) {
            if (!seenUsers.has(orgUser.id)) {
              seenUsers.add(orgUser.id);
              matches.push({
                property: prop,
                user: {
                  id: orgUser.id,
                  email: orgUser.fields.Email,
                  name: orgUser.fields.Name
                },
                alertLevel: 'YOUR PROPERTY',
                matchedSection: `${normalizedSec}-${township}-${range}`,
                organizationId: orgId,
                viaOrganization: orgName
              });
            }
          }
        }
      } catch (error) {
        console.error(`[Matching] Error fetching organization ${orgId}:`, error);
      }
    }
  }

  // ALWAYS check for adjacent section matches (users who own sections adjacent to this permit)
  const adjacentMatches = await findUsersMonitoringAdjacentTo(location, env, options);

  // Filter out users who already have a direct match to avoid duplicates
  const uniqueAdjacentMatches = adjacentMatches.filter(adjMatch =>
    !matches.some(m => m.user.id === adjMatch.user.id)
  );

  matches.push(...uniqueAdjacentMatches);

  return matches;
}

/**
 * Find users who are monitoring sections adjacent to the given location
 * @param {Object} location - S-T-R of the permit
 * @param {Object} env - Worker environment
 * @param {Object} options - Optional settings
 * @param {boolean} options.useExtendedGrid - Use 5x5 grid (24 sections) for horizontal wells
 * @returns {Array} - Users who should get ADJACENT SECTION alerts
 */
async function findUsersMonitoringAdjacentTo(location, env, options = {}) {
  const { section, township, range, meridian, county } = location;
  const normalizedSec = parseInt(normalizeSection(section), 10);

  // Default meridian to IM if not specified (Oklahoma convention)
  const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
  const effectiveMeridian = meridian ||
    (panhandleCounties.includes(county?.toUpperCase()) ? 'CM' : 'IM');

  // Get adjacent sections - use extended grid for horizontal wells
  const adjacentSections = options.useExtendedGrid
    ? getExtendedAdjacentSections(normalizedSec, township, range)
    : getAdjacentSections(normalizedSec, township, range);

  // Normalize section numbers for query
  const normalizedAdjacentSections = adjacentSections.map(adj => ({
    section: normalizeSection(adj.section),
    township: adj.township,
    range: adj.range
  }));

  // Query D1 for properties in adjacent sections with monitor_adjacent enabled
  const properties = await getAdjacentProperties(env, normalizedAdjacentSections, effectiveMeridian);

  const matches = [];
  const seenUsers = new Set();

  for (const prop of properties) {
    // Case 1: Individual user linked to property
    if (prop._user && prop._user.id) {
      const userId = prop._user.id;
      if (!seenUsers.has(userId)) {
        const user = await getUserById(env, userId);
        if (user && user.fields.Status === 'Active') {
          seenUsers.add(userId);

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

    // Case 2: Organization linked to property
    const orgIds = prop.fields.Organization;
    if (orgIds && orgIds.length > 0) {
      const orgId = orgIds[0];

      try {
        const org = await getOrganizationById(env, orgId);
        if (org) {
          const orgName = org.fields.Name;
          const orgMembers = await getOrganizationMembers(env, orgId);

          const propSection = `${normalizeSection(prop.fields.SEC)}-${prop.fields.TWN}-${prop.fields.RNG}`;

          for (const orgUser of orgMembers) {
            if (!seenUsers.has(orgUser.id)) {
              seenUsers.add(orgUser.id);
              matches.push({
                property: prop,
                user: {
                  id: orgUser.id,
                  email: orgUser.fields.Email,
                  name: orgUser.fields.Name
                },
                alertLevel: 'ADJACENT SECTION',
                matchedSection: propSection,
                organizationId: orgId,
                permitSection: `${normalizeSection(section)}-${township}-${range}`,
                viaOrganization: orgName
              });
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
  const wells = await getWellsByApiNumber(env, api10);
  const matches = [];
  const seenUsers = new Set();

  for (const well of wells) {
    // Case 1: Individual user directly linked to well (via JOIN)
    if (well._user && well._user.id) {
      const userId = well._user.id;
      if (!seenUsers.has(userId)) {
        const user = await getUserById(env, userId);
        if (user && user.fields.Status === 'Active') {
          seenUsers.add(userId);
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
    }

    // Case 2: Organization linked to well - get all users in the org
    const orgIds = well.fields.Organization;
    if (orgIds && orgIds.length > 0) {
      const orgId = orgIds[0];
      console.log(`[Matching] Well ${api10} belongs to organization ID: ${orgId}`);

      try {
        const org = await getOrganizationById(env, orgId);
        if (org) {
          const orgName = org.fields.Name;
          const orgMembers = await getOrganizationMembers(env, orgId);

          console.log(`[Matching] Organization "${orgName}" has ${orgMembers.length} active members`);

          for (const orgUser of orgMembers) {
            if (!seenUsers.has(orgUser.id)) {
              seenUsers.add(orgUser.id);
              matches.push({
                well: well,
                user: {
                  id: orgUser.id,
                  email: orgUser.fields.Email,
                  name: orgUser.fields.Name
                },
                alertLevel: 'TRACKED WELL',
                viaOrganization: orgName,
                organizationId: orgId
              });
            }
          }
        }
      } catch (error) {
        console.error(`[Matching] Error fetching organization ${orgId}:`, error);
      }
    }
  }

  console.log(`[Matching] Well ${api10}: found ${matches.length} users to notify`);
  return matches;
}
