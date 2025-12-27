/**
 * Shared utilities for property-well matching
 */

import { BASE_ID } from '../constants.js';
import { fetchAllAirtableRecords } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Panhandle counties that use Cimarron Meridian (CM)
export const CM_COUNTIES = ['BEAVER', 'TEXAS', 'CIMARRON'];

// Table names
export const PROPERTIES_TABLE = '📍 Client Properties';
export const WELLS_TABLE = '🛢️ Client Wells';
export const LINKS_TABLE = '🔗 Property-Well Links';

// Field names
export const PROPERTY_FIELDS = {
  SEC: 'SEC',
  TWN: 'TWN',
  RNG: 'RNG',
  MERIDIAN: 'MERIDIAN',
  USER: 'User',
  ORGANIZATION: 'Organization',
  COUNTY: 'County'
};

export const WELL_FIELDS = {
  SECTION: 'Section',
  TOWNSHIP: 'Township',
  RANGE: 'Range',
  BH_SECTION: 'BH Section',
  BH_TOWNSHIP: 'BH Township',
  BH_RANGE: 'BH Range',
  SECTIONS_AFFECTED: 'Sections Affected',
  WELL_NAME: 'Well Name',
  WELL_NUMBER: 'Well Number',
  USER: 'User',
  ORGANIZATION: 'Organization',
  COUNTY: 'County',
  OCC_MAP_LINK: 'OCC Map Link'
};

export const LINK_FIELDS = {
  LINK_NAME: 'Link Name',
  PROPERTY: 'Property',
  WELL: 'Well',
  LINK_TYPE: 'Link Type',
  MATCH_REASON: 'Match Reason',
  STATUS: 'Status',
  USER: 'User',
  ORGANIZATION: 'Organization'
};

export interface LocationKey {
  section: number;
  township: string;
  range: string;
  meridian: string;
}

export interface PropertyRecord {
  id: string;
  fields: any;
  location: LocationKey | null;
}

export interface WellRecord {
  id: string;
  fields: any;
  surfaceLocation: LocationKey | null;
  bottomHoleLocation: LocationKey | null;
  sectionsAffected: number[];
  township: string;
  range: string;
  meridian: string;
}

/**
 * Normalize section value (remove leading zeros, convert to number)
 */
export function normalizeSection(section: string | number | undefined): number | null {
  if (!section) return null;
  const parsed = parseInt(String(section), 10);
  return isNaN(parsed) || parsed < 1 || parsed > 36 ? null : parsed;
}

/**
 * Get meridian with smart defaults based on county
 */
export function getMeridian(record: any): string {
  // Use explicit meridian if set
  if (record[PROPERTY_FIELDS.MERIDIAN] || record.MERIDIAN || record.Meridian) {
    return record[PROPERTY_FIELDS.MERIDIAN] || record.MERIDIAN || record.Meridian;
  }
  
  // Default based on county
  const county = (record[PROPERTY_FIELDS.COUNTY] || record.County || record.county || '').toUpperCase();
  return CM_COUNTIES.includes(county) ? 'CM' : 'IM';
}

/**
 * Parse sections affected field (e.g., "S19, S30, S31" → [19, 30, 31])
 */
export function parseSectionsAffected(sectionsStr: string): number[] {
  if (!sectionsStr) return [];
  
  const sections: number[] = [];
  // Match patterns like "S19", "19", "Sec 19", etc.
  const matches = sectionsStr.match(/\b(\d{1,2})\b/g);
  
  if (matches) {
    for (const match of matches) {
      const section = parseInt(match, 10);
      if (section >= 1 && section <= 36) {
        sections.push(section);
      }
    }
  }
  
  return [...new Set(sections)]; // Remove duplicates
}

/**
 * Create a location key for comparison
 */
export function createLocationKey(section: number | null, township: string, range: string, meridian: string): LocationKey | null {
  if (!section || !township || !range) return null;
  return { section, township, range, meridian };
}

/**
 * Check if locations match
 */
export function locationsMatch(loc1: LocationKey | null, loc2: LocationKey | null): boolean {
  if (!loc1 || !loc2) return false;
  return loc1.section === loc2.section &&
         loc1.township === loc2.township &&
         loc1.range === loc2.range &&
         loc1.meridian === loc2.meridian;
}

/**
 * Extract full well name from OCC Map Link or use Well Name + Well Number
 */
export function extractFullWellName(well: any): string {
  const wellName = well.fields[WELL_FIELDS.WELL_NAME] || 'Unknown Well';
  const wellNumber = well.fields[WELL_FIELDS.WELL_NUMBER] || '';
  const occMapLink = well.fields[WELL_FIELDS.OCC_MAP_LINK] || '';
  
  let displayName = wellName;
  
  if (occMapLink) {
    try {
      // First decode the URL to handle encoded characters
      const decoded = decodeURIComponent(occMapLink);
      // Look for the title in the JSON structure
      const titleMatch = decoded.match(/"title":"([^"]+)"/);
      if (titleMatch && titleMatch[1]) {
        displayName = titleMatch[1];
      } else if (wellNumber && !wellName.includes(wellNumber)) {
        displayName += ` ${wellNumber}`;
      }
    } catch (e) {
      // If decoding fails, try the old method
      const titleMatch = occMapLink.match(/title%22%3A%22([^%]+)/);
      if (titleMatch) {
        displayName = decodeURIComponent(titleMatch[1].replace(/%20/g, ' '));
      } else if (wellNumber && !wellName.includes(wellNumber)) {
        displayName += ` ${wellNumber}`;
      }
    }
  } else if (wellNumber && !wellName.includes(wellNumber)) {
    displayName += ` ${wellNumber}`;
  }
  
  return displayName;
}

/**
 * Check match between property and well, return match reason or null
 */
export function checkMatch(
  property: PropertyRecord,
  well: WellRecord
): string | null {
  if (!property.location) return null;
  
  // Priority 1: Surface location match
  if (locationsMatch(property.location, well.surfaceLocation)) {
    return 'Surface Location';
  }
  
  // Priority 2: Lateral path match (sections affected)
  if (well.sectionsAffected.includes(property.location.section) &&
      property.location.township === well.township &&
      property.location.range === well.range &&
      property.location.meridian === well.meridian) {
    return 'Lateral Path';
  }
  
  // Priority 3: Bottom hole match
  if (locationsMatch(property.location, well.bottomHoleLocation)) {
    return 'Bottom Hole';
  }
  
  return null;
}

/**
 * Process a single property into indexed structure
 */
export function processProperty(prop: any): PropertyRecord {
  const section = normalizeSection(prop.fields[PROPERTY_FIELDS.SEC]);
  const township = prop.fields[PROPERTY_FIELDS.TWN];
  const range = prop.fields[PROPERTY_FIELDS.RNG];
  const meridian = getMeridian(prop.fields);
  
  return {
    id: prop.id,
    fields: prop.fields,
    location: createLocationKey(section, township, range, meridian)
  };
}

/**
 * Process a single well into indexed structure
 */
export function processWell(well: any): WellRecord {
  const township = well.fields[WELL_FIELDS.TOWNSHIP];
  const range = well.fields[WELL_FIELDS.RANGE];
  const meridian = getMeridian(well.fields);
  
  // Surface location
  const surfaceSection = normalizeSection(well.fields[WELL_FIELDS.SECTION]);
  const surfaceLocation = createLocationKey(surfaceSection, township, range, meridian);
  
  // Bottom hole location
  const bhSection = normalizeSection(well.fields[WELL_FIELDS.BH_SECTION]);
  const bhTownship = well.fields[WELL_FIELDS.BH_TOWNSHIP] || township;
  const bhRange = well.fields[WELL_FIELDS.BH_RANGE] || range;
  const bottomHoleLocation = createLocationKey(bhSection, bhTownship, bhRange, meridian);
  
  // Sections affected
  const sectionsAffected = parseSectionsAffected(well.fields[WELL_FIELDS.SECTIONS_AFFECTED] || '');
  
  return {
    id: well.id,
    fields: well.fields,
    surfaceLocation,
    bottomHoleLocation,
    sectionsAffected,
    township,
    range,
    meridian
  };
}

/**
 * Get existing links for a property (both active and rejected)
 */
export async function getLinksForProperty(
  env: Env,
  propertyId: string
): Promise<{ active: Set<string>; rejected: Set<string> }> {
  const filter = `OR({Property} = '${propertyId}', FIND('${propertyId}', ARRAYJOIN({Property})) > 0)`;
  const links = await fetchAllAirtableRecords(env, LINKS_TABLE, filter);
  
  const active = new Set<string>();
  const rejected = new Set<string>();
  
  for (const link of links) {
    const wellId = link.fields[LINK_FIELDS.WELL]?.[0];
    if (!wellId) continue;
    
    if (link.fields[LINK_FIELDS.STATUS] === 'Active') {
      active.add(wellId);
    } else if (link.fields[LINK_FIELDS.STATUS] === 'Rejected') {
      rejected.add(wellId);
    }
  }
  
  return { active, rejected };
}

/**
 * Get existing links for a well (both active and rejected)
 */
export async function getLinksForWell(
  env: Env,
  wellId: string
): Promise<{ active: Set<string>; rejected: Set<string> }> {
  const filter = `OR({Well} = '${wellId}', FIND('${wellId}', ARRAYJOIN({Well})) > 0)`;
  const links = await fetchAllAirtableRecords(env, LINKS_TABLE, filter);
  
  const active = new Set<string>();
  const rejected = new Set<string>();
  
  for (const link of links) {
    const propertyId = link.fields[LINK_FIELDS.PROPERTY]?.[0];
    if (!propertyId) continue;
    
    if (link.fields[LINK_FIELDS.STATUS] === 'Active') {
      active.add(propertyId);
    } else if (link.fields[LINK_FIELDS.STATUS] === 'Rejected') {
      rejected.add(propertyId);
    }
  }
  
  return { active, rejected };
}

/**
 * Create links in batches
 */
export async function createLinksInBatches(
  env: Env,
  links: any[]
): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed = 0;
  const batchSize = 10;
  
  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    
    // Debug log the batch
    console.log(`[CreateLinks] Sending batch ${i/batchSize + 1}:`, JSON.stringify(batch, null, 2));
    
    try {
      const response = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(LINKS_TABLE)}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ records: batch })
        }
      );
      
      if (response.ok) {
        const result = await response.json();
        created += batch.length;
        console.log(`[CreateLinks] Batch created successfully:`, result.records?.map(r => ({
          id: r.id,
          property: r.fields.Property,
          well: r.fields.Well
        })));
      } else {
        const error = await response.text();
        console.error(`[CreateLinks] Batch create failed:`, error);
        console.error(`[CreateLinks] Failed batch data:`, JSON.stringify(batch, null, 2));
        failed += batch.length;
      }
      
      // Rate limit protection
      if (i + batchSize < links.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(`[CreateLinks] Batch create error:`, error);
      failed += batch.length;
    }
  }
  
  return { created, failed };
}

/**
 * Match a single property against all user's wells
 */
export async function matchSingleProperty(
  propertyId: string,
  userId: string,
  organizationId: string | undefined,
  env: Env
): Promise<{ linksCreated: number; wellsChecked: number }> {
  console.log(`[MatchSingleProperty] Starting for property ${propertyId}`);
  
  // Fetch the property
  const propertyResponse = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROPERTIES_TABLE)}/${propertyId}`,
    {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    }
  );
  
  if (!propertyResponse.ok) {
    throw new Error(`Failed to fetch property: ${propertyResponse.status}`);
  }
  
  const propertyData = await propertyResponse.json();
  
  // Verify ownership
  const propertyUserId = propertyData.fields.User?.[0];
  const propertyOrgId = propertyData.fields.Organization?.[0];
  
  if (propertyUserId !== userId && (!organizationId || propertyOrgId !== organizationId)) {
    throw new Error('Unauthorized');
  }
  
  // Get existing links
  const { active: linkedWellIds, rejected: rejectedWellIds } = await getLinksForProperty(env, propertyId);
  
  // Build well filter
  let wellsFilter: string;
  
  if (organizationId) {
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    const orgData = await orgResponse.json();
    const orgName = orgData.fields?.Name || '';
    wellsFilter = `FIND('${orgName.replace(/'/g, "\\\'")}', ARRAYJOIN({Organization})) > 0`;
  } else {
    // Need user email for filter
    const userResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🙋 Users')}/${userId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    const userData = await userResponse.json();
    const userEmail = userData.fields.Email;
    wellsFilter = `FIND('${userEmail.replace(/'/g, "\\\'")}', ARRAYJOIN({User})) > 0`;
  }
  
  // Fetch all user's wells
  const wells = await fetchAllAirtableRecords(env, WELLS_TABLE, wellsFilter);
  
  // Process the property
  const processedProperty = processProperty(propertyData);
  
  // Check matches
  const newLinks = [];
  
  for (const wellData of wells) {
    if (linkedWellIds.has(wellData.id) || rejectedWellIds.has(wellData.id)) {
      continue;
    }
    
    const processedWell = processWell(wellData);
    const matchReason = checkMatch(processedProperty, processedWell);
    
    if (matchReason) {
      const wellName = extractFullWellName(wellData);
      const propLocation = processedProperty.location 
        ? `S${processedProperty.location.section}-T${processedProperty.location.township}-R${processedProperty.location.range}`
        : 'Unknown Location';
      const linkName = `${wellName} → ${propLocation}`;
      
      const linkRecord = {
        fields: {
          [LINK_FIELDS.LINK_NAME]: linkName,
          [LINK_FIELDS.PROPERTY]: [propertyId],
          [LINK_FIELDS.WELL]: [wellData.id],
          [LINK_FIELDS.LINK_TYPE]: 'Auto',
          [LINK_FIELDS.MATCH_REASON]: matchReason,
          [LINK_FIELDS.STATUS]: 'Active',
          [LINK_FIELDS.USER]: [userId]
        }
      };
      
      if (organizationId) {
        linkRecord.fields[LINK_FIELDS.ORGANIZATION] = [organizationId];
      }
      
      newLinks.push(linkRecord);
    }
  }
  
  // Create links
  const { created } = await createLinksInBatches(env, newLinks);
  
  return { linksCreated: created, wellsChecked: wells.length };
}

/**
 * Match a single well against all user's properties
 */
export async function matchSingleWell(
  wellId: string,
  userId: string,
  organizationId: string | undefined,
  env: Env
): Promise<{ linksCreated: number; propertiesChecked: number }> {
  console.log(`[MatchSingleWell] Starting for well ${wellId}`);
  
  // Fetch the well
  const wellResponse = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELLS_TABLE)}/${wellId}`,
    {
      headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    }
  );
  
  if (!wellResponse.ok) {
    throw new Error(`Failed to fetch well: ${wellResponse.status}`);
  }
  
  const wellData = await wellResponse.json();
  
  // Verify ownership
  const wellUserId = wellData.fields.User?.[0];
  const wellOrgId = wellData.fields.Organization?.[0];
  
  if (wellUserId !== userId && (!organizationId || wellOrgId !== organizationId)) {
    throw new Error('Unauthorized');
  }
  
  // Get existing links
  const { active: linkedPropertyIds, rejected: rejectedPropertyIds } = await getLinksForWell(env, wellId);
  
  // Build property filter
  let propertiesFilter: string;
  
  if (organizationId) {
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    const orgData = await orgResponse.json();
    const orgName = orgData.fields?.Name || '';
    propertiesFilter = `FIND('${orgName.replace(/'/g, "\\\'")}', ARRAYJOIN({Organization})) > 0`;
  } else {
    // Need user email for filter
    const userResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🙋 Users')}/${userId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    const userData = await userResponse.json();
    const userEmail = userData.fields.Email;
    propertiesFilter = `FIND('${userEmail.replace(/'/g, "\\\'")}', ARRAYJOIN({User})) > 0`;
  }
  
  // Fetch all user's properties
  const properties = await fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter);
  
  // Process the well
  const processedWell = processWell(wellData);
  
  // Check matches
  const newLinks = [];
  
  for (const propertyData of properties) {
    if (linkedPropertyIds.has(propertyData.id) || rejectedPropertyIds.has(propertyData.id)) {
      continue;
    }
    
    const processedProperty = processProperty(propertyData);
    const matchReason = checkMatch(processedProperty, processedWell);
    
    if (matchReason) {
      const wellName = extractFullWellName(wellData);
      const propLocation = processedProperty.location 
        ? `S${processedProperty.location.section}-T${processedProperty.location.township}-R${processedProperty.location.range}`
        : 'Unknown Location';
      const linkName = `${wellName} → ${propLocation}`;
      
      const linkRecord = {
        fields: {
          [LINK_FIELDS.LINK_NAME]: linkName,
          [LINK_FIELDS.PROPERTY]: [propertyData.id],
          [LINK_FIELDS.WELL]: [wellId],
          [LINK_FIELDS.LINK_TYPE]: 'Auto',
          [LINK_FIELDS.MATCH_REASON]: matchReason,
          [LINK_FIELDS.STATUS]: 'Active',
          [LINK_FIELDS.USER]: [userId]
        }
      };
      
      if (organizationId) {
        linkRecord.fields[LINK_FIELDS.ORGANIZATION] = [organizationId];
      }
      
      newLinks.push(linkRecord);
    }
  }
  
  // Create links
  const { created } = await createLinksInBatches(env, newLinks);
  
  return { linksCreated: created, propertiesChecked: properties.length };
}

/**
 * Process properties and wells arrays into indexed structures
 */
export function processProperties(properties: any[]): PropertyRecord[] {
  return properties.map(prop => processProperty(prop));
}

export function processWells(wells: any[]): WellRecord[] {
  return wells.map(well => processWell(well));
}

/**
 * Run full property-well matching for a user/organization
 */
export async function runFullPropertyWellMatching(
  userId: string,
  userEmail: string,
  organizationId: string | undefined,
  env: Env
): Promise<{ linksCreated: number; propertiesProcessed: number; wellsProcessed: number }> {
  console.log(`[PropertyWellMatch] Starting for user ${userEmail}`);
  
  // Build filter formulas based on org/user
  let propertiesFilter: string;
  let wellsFilter: string;
  let linksFilter: string;
  
  if (organizationId) {
    // Organization user - get org name for filtering
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    const orgData = await orgResponse.json();
    const orgName = orgData.fields?.Name || '';
    
    propertiesFilter = `FIND('${orgName.replace(/'/g, "\\\'")}', ARRAYJOIN({Organization})) > 0`;
    wellsFilter = `FIND('${orgName.replace(/'/g, "\\\'")}', ARRAYJOIN({Organization})) > 0`;
    linksFilter = `FIND('${orgName.replace(/'/g, "\\\'")}', ARRAYJOIN({Organization})) > 0`;
  } else {
    // Solo user - filter by user email
    const email = userEmail.replace(/'/g, "\\'");
    propertiesFilter = `FIND('${email}', ARRAYJOIN({User})) > 0`;
    wellsFilter = `FIND('${email}', ARRAYJOIN({User})) > 0`;
    linksFilter = `FIND('${email}', ARRAYJOIN({User})) > 0`;
  }
  
  // Fetch all data in parallel
  const [properties, wells, existingLinks] = await Promise.all([
    fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter),
    fetchAllAirtableRecords(env, WELLS_TABLE, wellsFilter),
    fetchAllAirtableRecords(env, LINKS_TABLE, linksFilter)
  ]);
  
  console.log(`[PropertyWellMatch] Fetched ${properties.length} properties, ${wells.length} wells, ${existingLinks.length} existing links`);
  
  // Build set of existing links to avoid duplicates
  const existingLinkKeys = new Set<string>();
  for (const link of existingLinks) {
    const propertyId = link.fields[LINK_FIELDS.PROPERTY]?.[0];
    const wellId = link.fields[LINK_FIELDS.WELL]?.[0];
    if (propertyId && wellId) {
      existingLinkKeys.add(`${propertyId}-${wellId}`);
    }
  }
  
  // Process properties and wells
  const processedProperties = processProperties(properties);
  const processedWells = processWells(wells);
  
  // Find matches
  const linksToCreate: any[] = [];
  
  for (const property of processedProperties) {
    for (const well of processedWells) {
      const linkKey = `${property.id}-${well.id}`;
      
      // Skip if link already exists
      if (existingLinkKeys.has(linkKey)) {
        continue;
      }
      
      // Check for match
      const { matched, reason } = findBestMatch(property, well);
      if (matched) {
        // Create link name
        const wellName = well.fields[WELL_FIELDS.WELL_NAME] || 'Unknown Well';
        const propLocation = property.location 
          ? `S${property.location.section}-T${property.location.township}-R${property.location.range}`
          : 'Unknown Location';
        const linkName = `${wellName} → ${propLocation}`;
        
        const linkRecord = {
          fields: {
            [LINK_FIELDS.LINK_NAME]: linkName,
            [LINK_FIELDS.PROPERTY]: [property.id],
            [LINK_FIELDS.WELL]: [well.id],
            [LINK_FIELDS.LINK_TYPE]: 'Auto',
            [LINK_FIELDS.MATCH_REASON]: reason,
            [LINK_FIELDS.STATUS]: 'Active',
            [LINK_FIELDS.USER]: [userId]
          }
        };
        
        // Add organization if exists
        if (organizationId) {
          linkRecord.fields[LINK_FIELDS.ORGANIZATION] = [organizationId];
        }
        
        linksToCreate.push(linkRecord);
      }
    }
  }
  
  // Create links in batches
  const { created } = await createLinksInBatches(env, linksToCreate);
  
  return { 
    linksCreated: created, 
    propertiesProcessed: properties.length, 
    wellsProcessed: wells.length 
  };
}

/**
 * Find the best match between a property and well (internal helper)
 */
function findBestMatch(property: PropertyRecord, well: WellRecord): { matched: boolean; reason: string } {
  if (!property.location) return { matched: false, reason: '' };
  
  // Priority 1: Surface location match
  if (locationsMatch(property.location, well.surfaceLocation)) {
    return { matched: true, reason: 'Surface Location' };
  }
  
  // Priority 2: Lateral path match (sections affected)
  if (well.sectionsAffected.includes(property.location.section) &&
      property.location.township === well.township &&
      property.location.range === well.range &&
      property.location.meridian === well.meridian) {
    return { matched: true, reason: 'Lateral Path' };
  }
  
  // Priority 3: Bottom hole match
  if (locationsMatch(property.location, well.bottomHoleLocation)) {
    return { matched: true, reason: 'Bottom Hole' };
  }
  
  return { matched: false, reason: '' };
}