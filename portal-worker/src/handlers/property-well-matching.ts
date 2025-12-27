/**
 * Property-Well Auto-Matching Handler
 * 
 * Automatically creates links between properties and wells based on location matching
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById, fetchAllAirtableRecords } from '../services/airtable.js';
import type { Env } from '../types/env.js';

// Panhandle counties that use Cimarron Meridian (CM)
const CM_COUNTIES = ['BEAVER', 'TEXAS', 'CIMARRON'];

// Table IDs
const PROPERTIES_TABLE = '📍 Client Properties';
const WELLS_TABLE = '🛢️ Client Wells';
const LINKS_TABLE = '🔗 Property-Well Links';

// Use human-readable field names (Airtable API returns these, not field IDs)
const PROPERTY_FIELDS = {
  SEC: 'SEC',
  TWN: 'TWN',
  RNG: 'RNG',
  MERIDIAN: 'MERIDIAN',
  USER: 'User',
  ORGANIZATION: 'Organization',
  COUNTY: 'County'
};

// Field names for wells
const WELL_FIELDS = {
  SECTION: 'Section',
  TOWNSHIP: 'Township',
  RANGE: 'Range',
  BH_SECTION: 'BH Section',
  BH_TOWNSHIP: 'BH Township',
  BH_RANGE: 'BH Range',
  SECTIONS_AFFECTED: 'Sections Affected',
  WELL_NAME: 'Well Name',
  USER: 'User',
  ORGANIZATION: 'Organization',
  COUNTY: 'County'
};

// Field names for links
const LINK_FIELDS = {
  LINK_NAME: 'Link Name',
  PROPERTY: 'Property',
  WELL: 'Well',
  LINK_TYPE: 'Link Type',
  MATCH_REASON: 'Match Reason',
  STATUS: 'Status',
  USER: 'User',
  ORGANIZATION: 'Organization'
};

interface LocationKey {
  section: number;
  township: string;
  range: string;
  meridian: string;
}

interface PropertyRecord {
  id: string;
  fields: any;
  location: LocationKey | null;
}

interface WellRecord {
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
function normalizeSection(section: string | number | undefined): number | null {
  if (!section) return null;
  const parsed = parseInt(String(section), 10);
  return isNaN(parsed) || parsed < 1 || parsed > 36 ? null : parsed;
}

/**
 * Get meridian with smart defaults based on county
 */
function getMeridian(record: any): string {
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
function parseSectionsAffected(sectionsStr: string): number[] {
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
function createLocationKey(section: number | null, township: string, range: string, meridian: string): LocationKey | null {
  if (!section || !township || !range) return null;
  return { section, township, range, meridian };
}

/**
 * Process properties into indexed structure
 */
function processProperties(properties: any[]): PropertyRecord[] {
  return properties.map(prop => {
    const section = normalizeSection(prop.fields[PROPERTY_FIELDS.SEC]);
    const township = prop.fields[PROPERTY_FIELDS.TWN];
    const range = prop.fields[PROPERTY_FIELDS.RNG];
    const meridian = getMeridian(prop.fields);
    
    return {
      id: prop.id,
      fields: prop.fields,
      location: createLocationKey(section, township, range, meridian)
    };
  });
}

/**
 * Process wells into indexed structure
 */
function processWells(wells: any[]): WellRecord[] {
  return wells.map(well => {
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
  });
}

/**
 * Check if locations match
 */
function locationsMatch(loc1: LocationKey | null, loc2: LocationKey | null): boolean {
  if (!loc1 || !loc2) return false;
  return loc1.section === loc2.section &&
         loc1.township === loc2.township &&
         loc1.range === loc2.range &&
         loc1.meridian === loc2.meridian;
}

/**
 * Find the best match between a property and well
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

/**
 * Main handler for property-well matching
 */
export async function handleMatchPropertyWells(request: Request, env: Env) {
  const startTime = Date.now();
  
  try {
    // Authenticate user
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);
    
    // Get full user record
    const userRecord = await getUserById(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);
    
    const userId = authUser.id;
    const organizationId = userRecord.fields.Organization?.[0];
    
    console.log(`[PropertyWellMatch] Starting for user ${authUser.email}`);
    
    // Build filter formulas based on org/user
    let propertiesFilter: string;
    let wellsFilter: string;
    let linksFilter: string;
    
    console.log(`[PropertyWellMatch] User ID: ${userId}, Org ID: ${organizationId || 'none'}`);
    
    if (organizationId) {
      // Organization user - filter by org (organization is also a linked field)
      propertiesFilter = `FIND('${organizationId}', ARRAYJOIN({Organization})) > 0`;
      wellsFilter = `FIND('${organizationId}', ARRAYJOIN({Organization})) > 0`;
      linksFilter = `FIND('${organizationId}', ARRAYJOIN({Organization})) > 0`;
    } else {
      // Solo user - filter by user record ID (not email)
      propertiesFilter = `FIND('${userId}', ARRAYJOIN({User})) > 0`;
      wellsFilter = `FIND('${userId}', ARRAYJOIN({User})) > 0`;
      linksFilter = `FIND('${userId}', ARRAYJOIN({User})) > 0`;
    }
    
    console.log(`[PropertyWellMatch] Filters - Properties: ${propertiesFilter}`);
    console.log(`[PropertyWellMatch] Filters - Wells: ${wellsFilter}`);
    console.log(`[PropertyWellMatch] Filters - Links: ${linksFilter}`);
    
    // Fetch all data in parallel
    console.log('[PropertyWellMatch] Fetching data...');
    const [properties, wells, existingLinks] = await Promise.all([
      fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter),
      fetchAllAirtableRecords(env, WELLS_TABLE, wellsFilter),
      fetchAllAirtableRecords(env, LINKS_TABLE, linksFilter)
    ]);
    
    console.log(`[PropertyWellMatch] Fetched ${properties.length} properties, ${wells.length} wells, ${existingLinks.length} existing links`);
    
    // Debug: Log sample property and well to check field structure
    if (properties.length > 0) {
      console.log('[PropertyWellMatch] Sample property:', JSON.stringify(properties[0], null, 2));
    }
    if (wells.length > 0) {
      console.log('[PropertyWellMatch] Sample well:', JSON.stringify(wells[0], null, 2));
    }
    
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
    let matchesFound = 0;
    let skippedExisting = 0;
    
    for (const property of processedProperties) {
      for (const well of processedWells) {
        const linkKey = `${property.id}-${well.id}`;
        
        // Skip if link already exists
        if (existingLinkKeys.has(linkKey)) {
          skippedExisting++;
          continue;
        }
        
        // Check for match
        const { matched, reason } = findBestMatch(property, well);
        if (matched) {
          matchesFound++;
          
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
    
    console.log(`[PropertyWellMatch] Found ${matchesFound} matches, ${skippedExisting} already linked`);
    
    // Create links in batches
    let created = 0;
    let failed = 0;
    const batchSize = 10;
    
    for (let i = 0; i < linksToCreate.length; i += batchSize) {
      const batch = linksToCreate.slice(i, i + batchSize);
      
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
          created += batch.length;
        } else {
          const error = await response.text();
          console.error(`[PropertyWellMatch] Batch create failed:`, error);
          failed += batch.length;
        }
        
        // Rate limit protection
        if (i + batchSize < linksToCreate.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`[PropertyWellMatch] Batch create error:`, error);
        failed += batch.length;
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    const stats = {
      propertiesProcessed: properties.length,
      wellsProcessed: wells.length,
      linksCreated: created,
      linksSkipped: skippedExisting,
      existingLinks: existingLinks.length,
      errors: failed
    };
    
    console.log(`[PropertyWellMatch] Completed in ${duration}s:`, stats);
    
    return jsonResponse({
      success: true,
      stats,
      duration: `${duration}s`
    });
    
  } catch (error) {
    console.error('[PropertyWellMatch] Error:', error);
    return jsonResponse({ 
      error: 'Failed to match properties and wells',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}