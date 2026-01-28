/**
 * Property-Well Auto-Matching Handler
 * 
 * Automatically creates links between properties and wells based on location matching
 */

import { BASE_ID } from '../constants.js';
import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserById, fetchAllAirtableRecords } from '../services/airtable.js';
import { enrichWellsWithD1Data, getAdjacentLocations, parseSectionsAffected as sharedParseSectionsAffected } from '../utils/property-well-matching.js';
import type { LateralLocation } from '../utils/property-well-matching.js';
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
  sectionsAffected: LateralLocation[];
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
  // Match patterns like "S19", "S 19", "19", "Sec 19", "Sec19", etc.
  const matches = sectionsStr.match(/(?:^|[^0-9])(\d{1,2})(?=[^0-9]|$)/g);

  if (matches) {
    for (const match of matches) {
      const digitMatch = match.match(/(\d{1,2})/);
      if (digitMatch) {
        const section = parseInt(digitMatch[1], 10);
        if (section >= 1 && section <= 36) {
          sections.push(section);
        }
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
    
    // Sections affected as full location tuples
    let sectionsAffected: LateralLocation[];
    if (well._lateralLocations) {
      // Use pre-computed full tuples from enrichment pipeline
      sectionsAffected = well._lateralLocations;
    } else {
      // Fallback: parse section numbers from string, use surface township/range
      const sectionNumbers = parseSectionsAffected(well.fields[WELL_FIELDS.SECTIONS_AFFECTED] || '');
      sectionsAffected = sectionNumbers.map((s: number) => ({
        section: s,
        township: township,
        range: range
      }));
    }

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
  
  // Priority 2: Lateral path match (sections affected — full STR tuples)
  if (well.sectionsAffected.some(s =>
      s.section === property.location!.section &&
      s.township === property.location!.township &&
      s.range === property.location!.range
  ) && property.location.meridian === well.meridian) {
    return { matched: true, reason: 'Lateral Path' };
  }
  
  // Priority 3: Bottom hole match
  if (locationsMatch(property.location, well.bottomHoleLocation)) {
    return { matched: true, reason: 'Bottom Hole' };
  }

  // Priority 4: Adjacent BH section match (horizontal wells - stronger signal)
  if (well.bottomHoleLocation) {
    const adjLocs = getAdjacentLocations(
      property.location.section, property.location.township, property.location.range
    );
    if (adjLocs.some(a =>
      a.section === well.bottomHoleLocation!.section &&
      a.township === well.bottomHoleLocation!.township &&
      a.range === well.bottomHoleLocation!.range
    )) {
      return { matched: true, reason: 'Adjacent Section' };
    }
  }

  // Priority 5: Adjacent surface section match
  if (well.surfaceLocation) {
    const adjLocs = getAdjacentLocations(
      property.location.section, property.location.township, property.location.range
    );
    if (adjLocs.some(a =>
      a.section === well.surfaceLocation!.section &&
      a.township === well.surfaceLocation!.township &&
      a.range === well.surfaceLocation!.range
    )) {
      return { matched: true, reason: 'Adjacent Section' };
    }
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
    
    // Build filter formulas based on org/user (Airtable only for tracked properties/wells)
    let propertiesFilter: string;
    let wellsFilter: string;

    console.log(`[PropertyWellMatch] User ID: ${userId}, Org ID: ${organizationId || 'none'}`);

    const userEmail = authUser.email.replace(/'/g, "\\'");

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

      console.log(`[PropertyWellMatch] Organization name: ${orgName}`);

      // Filter by organization name OR user email - properties may have Organization
      // field empty but User field set (e.g., after bulk re-upload via Airtable)
      const orgFind = `FIND('${orgName.replace(/'/g, "\\'")}', ARRAYJOIN({Organization}))`;
      const userFind = `FIND('${userEmail}', ARRAYJOIN({User}))`;
      propertiesFilter = `OR(${orgFind} > 0, ${userFind} > 0)`;
      wellsFilter = `OR(${orgFind} > 0, ${userFind} > 0)`;
    } else {
      // Solo user - filter by user email (as displayed in linked field)
      propertiesFilter = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
      wellsFilter = `FIND('${userEmail}', ARRAYJOIN({User})) > 0`;
    }

    console.log(`[PropertyWellMatch] Filters - Properties: ${propertiesFilter}`);
    console.log(`[PropertyWellMatch] Filters - Wells: ${wellsFilter}`);

    // Fetch tracked properties/wells from Airtable
    console.log('[PropertyWellMatch] Fetching data...');

    const [properties, wells] = await Promise.all([
      fetchAllAirtableRecords(env, PROPERTIES_TABLE, propertiesFilter),
      fetchAllAirtableRecords(env, WELLS_TABLE, wellsFilter)
    ]);

    console.log(`[PropertyWellMatch] Fetched ${properties.length} properties, ${wells.length} wells`);

    // Get existing links from D1 using the actual property IDs (not user_id which may be NULL)
    const propertyIds = properties.map((p: any) => p.id);
    let existingLinks: Array<{
      property_airtable_id: string;
      well_airtable_id: string;
      match_reason: string;
      status: string;
    }> = [];

    const LINK_BATCH = 90; // D1 limit is 100 bind params per query
    for (let i = 0; i < propertyIds.length; i += LINK_BATCH) {
      const batch = propertyIds.slice(i, i + LINK_BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(
        `SELECT property_airtable_id, well_airtable_id, match_reason, status
         FROM property_well_links
         WHERE property_airtable_id IN (${placeholders})`
      ).bind(...batch).all();
      existingLinks.push(...((result.results || []) as any[]));
    }

    console.log(`[PropertyWellMatch] Found ${existingLinks.length} existing links in D1 for ${propertyIds.length} properties`);
    
    // Debug: Log sample property and well to check field structure
    if (properties.length > 0) {
      console.log('[PropertyWellMatch] Sample property:', JSON.stringify(properties[0], null, 2));
    }
    if (wells.length > 0) {
      console.log('[PropertyWellMatch] Sample well:', JSON.stringify(wells[0], null, 2));
    }
    
    // Enrich wells with surface location, well name, county, and BH data from D1
    const enrichDiag = await enrichWellsWithD1Data(wells, env);

    // Build set of existing links to avoid duplicates (from D1)
    const existingLinkKeys = new Set<string>();
    for (const link of existingLinks) {
      if (link.property_airtable_id && link.well_airtable_id) {
        existingLinkKeys.add(`${link.property_airtable_id}-${link.well_airtable_id}`);
      }
    }

    // Process properties and wells
    const processedProperties = processProperties(properties);
    const processedWells = processWells(wells);

    // Find matches with detailed diagnostics
    const linksToCreate: any[] = [];
    let matchesFound = 0;
    let skippedExisting = 0;
    const matchesByType: Record<string, number> = {};
    let propertiesWithNoLocation = 0;
    let wellsWithNoSurface = 0;
    let wellsWithBH = 0;
    let wellsWithSectionsAffected = 0;

    // Count property/well data quality
    for (const p of processedProperties) {
      if (!p.location) propertiesWithNoLocation++;
    }
    for (const w of processedWells) {
      if (!w.surfaceLocation) wellsWithNoSurface++;
      if (w.bottomHoleLocation) wellsWithBH++;
      if (w.sectionsAffected.length > 0) wellsWithSectionsAffected++;
    }

    // Count existing links by match reason AND by status (from D1)
    const existingByReason: Record<string, number> = {};
    const existingByStatus: Record<string, number> = {};
    for (const link of existingLinks) {
      const reason = link.match_reason || 'Unknown';
      existingByReason[reason] = (existingByReason[reason] || 0) + 1;
      const status = link.status || 'No Status';
      existingByStatus[status] = (existingByStatus[status] || 0) + 1;
    }

    console.log(`[PropertyWellMatch] Data quality: ${propertiesWithNoLocation} props without location, ${wellsWithNoSurface} wells without surface, ${wellsWithBH} wells with BH, ${wellsWithSectionsAffected} wells with sections affected`);
    console.log(`[PropertyWellMatch] Existing links by reason:`, existingByReason);

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
          matchesByType[reason] = (matchesByType[reason] || 0) + 1;
          
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
              [LINK_FIELDS.STATUS]: 'Linked',
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
    
    // Find wells with no links at all (from D1 existing links)
    const linkedWellIds = new Set<string>();
    for (const link of existingLinks) {
      if (link.well_airtable_id) linkedWellIds.add(link.well_airtable_id);
    }
    // Also count wells that would be linked by new matches
    for (const l of linksToCreate) {
      const wellId = l.fields[LINK_FIELDS.WELL]?.[0];
      if (wellId) linkedWellIds.add(wellId);
    }

    const unlinkedWells: Array<{name: string; location: string; bhLocation: string; lateralSections: string}> = [];
    for (const well of processedWells) {
      if (!linkedWellIds.has(well.id)) {
        const loc = well.surfaceLocation
          ? `S${well.surfaceLocation.section}-T${well.surfaceLocation.township}-R${well.surfaceLocation.range}`
          : 'no surface';
        const bhLoc = well.bottomHoleLocation
          ? `S${well.bottomHoleLocation.section}-T${well.bottomHoleLocation.township}-R${well.bottomHoleLocation.range}`
          : 'no BH';
        const lat = well.sectionsAffected.length > 0
          ? well.sectionsAffected.map(s => `S${s.section}-T${s.township}-R${s.range}`).join(',')
          : 'none';
        unlinkedWells.push({
          name: well.fields[WELL_FIELDS.WELL_NAME] || 'Unknown',
          location: loc,
          bhLocation: bhLoc,
          lateralSections: lat
        });
      }
    }

    console.log(`[PropertyWellMatch] Found ${matchesFound} matches, ${skippedExisting} already linked, ${unlinkedWells.length} wells with no link`);
    if (unlinkedWells.length > 0) {
      console.log('[PropertyWellMatch] Unlinked wells (first 10):', JSON.stringify(unlinkedWells.slice(0, 10)));
    }
    
    // Create links in batches
    let created = 0;
    let failed = 0;
    const batchSize = 10;
    const createdRecords: any[] = [];

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
          const data = await response.json() as any;
          created += batch.length;
          if (data.records) {
            createdRecords.push(...data.records);
          }
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

    // Sync newly created links to D1 for immediate dashboard visibility
    let d1Synced = 0;
    if (createdRecords.length > 0) {
      try {
        console.log(`[PropertyWellMatch] Syncing ${createdRecords.length} new links to D1...`);

        const statements = createdRecords.map(record => {
          const fields = record.fields || {};
          const propertyId = fields['Property']?.[0] || null;
          const wellId = fields['Well']?.[0] || null;
          const linkUserId = fields['User']?.[0] || null;
          const orgId = fields['Organization']?.[0] || null;

          if (!propertyId || !wellId) return null;

          return env.WELLS_DB.prepare(`
            INSERT OR REPLACE INTO property_well_links (
              id, airtable_record_id, property_airtable_id, well_airtable_id,
              match_reason, status, confidence_score,
              user_id, organization_id,
              link_name, link_type,
              created_at, rejected_date, synced_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(
            `link_${record.id}`,
            record.id,
            propertyId,
            wellId,
            fields['Match Reason'] || 'Manual',
            fields['Status'] || 'Linked',
            null,
            linkUserId,
            orgId,
            fields['Link Name'] || null,
            fields['Link Type'] || 'Auto',
            record.createdTime ? new Date(record.createdTime).toISOString().split('T')[0] : null,
            null
          );
        }).filter((stmt): stmt is NonNullable<typeof stmt> => stmt !== null);

        // Execute in D1 batches of 500
        for (let i = 0; i < statements.length; i += 500) {
          const chunk = statements.slice(i, i + 500);
          await env.WELLS_DB.batch(chunk);
        }

        d1Synced = statements.length;
        console.log(`[PropertyWellMatch] Synced ${d1Synced} links to D1`);
      } catch (d1Error) {
        console.error('[PropertyWellMatch] D1 sync failed (links in Airtable, will sync on next cron):', d1Error);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    const stats = {
      propertiesProcessed: properties.length,
      wellsProcessed: wells.length,
      linksCreated: created,
      linksSkipped: skippedExisting,
      existingLinks: existingLinks.length,
      d1Synced,
      errors: failed,
      newMatchesByType: matchesByType,
      existingLinksByType: existingByReason,
      existingLinksByStatus: existingByStatus,
      dataQuality: {
        propertiesWithNoLocation,
        wellsWithNoSurface,
        wellsWithBH,
        wellsWithSectionsAffected
      },
      enrichment: enrichDiag,
      unlinkedWellCount: unlinkedWells.length,
      unlinkedWellSamples: unlinkedWells.slice(0, 10)
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