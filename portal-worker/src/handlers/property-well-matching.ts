/**
 * Property-Well Auto-Matching Handler
 *
 * D1-first: Reads properties and wells directly from D1.
 * No Airtable dependency. Matching runs in milliseconds instead of 5-10s.
 *
 * Flow:
 * 1. Query properties from D1 (org ownership filter)
 * 2. Query wells from D1 with JOIN to statewide wells (BH + sections_affected)
 * 3. Query existing links from D1
 * 4. Compute lateral sections for horizontal wells
 * 5. Run N×M matching (same priority logic as before)
 * 6. Create new links in D1 via batch insert
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First, countUserWellsD1 } from '../services/airtable.js';
import { getPlanLimits } from '../constants.js';
import {
  normalizeSection,
  createLocationKey,
  CM_COUNTIES,
  computeLateralSections,
  getAdjacentLocations,
  locationsMatch,
  LINK_FIELDS,
  WELL_FIELDS,
  createLinksInBatches,
} from '../utils/property-well-matching.js';
import type { PropertyRecord, WellRecord, LateralLocation, LocationKey } from '../utils/property-well-matching.js';
import type { Env } from '../types/env.js';

/** Well types to exclude from matching (disposal, injection, dry holes, etc.) */
export const EXCLUDED_WELL_TYPES = new Set([
  'DRY','TM','2RIn','2DNC','INJ','SWD','WSW','STFD','2DCm','GSW','P&A','SW','TA','2D','2R','2RSI'
]);

/**
 * Get meridian based on county (panhandle = CM, everything else = IM)
 */
function getMeridianFromCounty(county: string | null, explicitMeridian: string | null): string {
  if (explicitMeridian) return explicitMeridian;
  const upper = (county || '').toUpperCase().replace(/^\d+-/, '');
  return CM_COUNTIES.includes(upper) ? 'CM' : 'IM';
}

/**
 * Main handler for property-well matching (D1-first)
 */
export async function handleMatchPropertyWells(request: Request, env: Env) {
  const startTime = Date.now();

  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: "Unauthorized" }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: "User not found" }, 404);

    const userId = authUser.id;
    const organizationId = userRecord.fields.Organization?.[0];

    console.log(`[PropertyWellMatch] Starting D1-first match for user ${authUser.email}, org=${organizationId || 'none'}`);

    // --- Step 1: Query properties from D1 ---
    const propWhereClause = organizationId
      ? `WHERE (p.organization_id = ? OR p.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `WHERE p.user_id = ?`;
    const propBindParams = organizationId ? [organizationId, organizationId] : [userId];

    const propResult = await env.WELLS_DB!.prepare(`
      SELECT p.airtable_record_id, p.section, p.township, p.range, p.county, p.meridian
      FROM properties p
      ${propWhereClause}
    `).bind(...propBindParams).all();

    const tPropsFetch = Date.now();

    // --- Step 2: Query wells from D1 (JOIN statewide wells for BH + sections_affected) ---
    const wellWhereClause = organizationId
      ? `WHERE (cw.organization_id = ? OR cw.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `WHERE cw.user_id = ?`;
    const wellBindParams = organizationId ? [organizationId, organizationId] : [userId];

    const wellResult = await env.WELLS_DB!.prepare(`
      SELECT
        cw.airtable_id,
        cw.well_name AS cw_well_name,
        cw.section AS cw_section,
        cw.township AS cw_township,
        cw.range_val AS cw_range,
        cw.county AS cw_county,
        w.section AS occ_section,
        w.township AS occ_township,
        w.range AS occ_range,
        w.bh_section,
        w.bh_township,
        w.bh_range,
        w.well_name AS occ_well_name,
        w.well_number,
        w.well_type AS occ_well_type,
        cw.well_type AS cw_well_type
      FROM client_wells cw
      LEFT JOIN wells w ON w.api_number = cw.api_number
      ${wellWhereClause}
    `).bind(...wellBindParams).all();

    const tWellsFetch = Date.now();
    const propRows = propResult.results || [];
    const wellRows = wellResult.results || [];

    console.log(`[PropertyWellMatch] D1 fetch: ${propRows.length} properties (${tPropsFetch - startTime}ms), ${wellRows.length} wells (${tWellsFetch - tPropsFetch}ms)`);

    if (propRows.length === 0 || wellRows.length === 0) {
      return jsonResponse({
        success: true,
        stats: {
          propertiesProcessed: propRows.length,
          wellsProcessed: wellRows.length,
          linksCreated: 0,
          linksSkipped: 0,
          existingLinks: 0,
          d1Synced: 0,
          errors: 0
        },
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`
      });
    }

    // --- Step 3: Build PropertyRecord[] from D1 rows ---
    const processedProperties: PropertyRecord[] = [];
    let propertiesWithNoLocation = 0;

    for (const row of propRows as any[]) {
      if (!row.airtable_record_id) continue;
      const section = normalizeSection(row.section);
      const township = row.township;
      const range = row.range;
      const meridian = getMeridianFromCounty(row.county, row.meridian);
      const location = createLocationKey(section, township, range, meridian);

      if (!location) propertiesWithNoLocation++;

      processedProperties.push({
        id: row.airtable_record_id,
        fields: row,
        location
      });
    }

    // --- Step 4: Build WellRecord[] from D1 rows + compute laterals ---
    const processedWells: WellRecord[] = [];
    let wellsWithNoSurface = 0;
    let wellsWithBH = 0;
    let lateralComputed = 0;
    let lateralSameTwn = 0;
    let lateralCrossTwn = 0;

    for (const row of wellRows as any[]) {
      if (!row.airtable_id) continue;

      // Filter out disposal wells, injection wells, dry holes, etc.
      const wellType = row.occ_well_type || row.cw_well_type || '';
      if (EXCLUDED_WELL_TYPES.has(wellType)) continue;

      // Prefer OCC statewide data, fall back to client_wells
      const section = row.occ_section || row.cw_section;
      const township = row.occ_township || row.cw_township;
      const range = row.occ_range || row.cw_range;
      const county = row.cw_county || '';
      const meridian = getMeridianFromCounty(county, null);

      const surfaceSection = normalizeSection(section);
      const surfaceLocation = createLocationKey(surfaceSection, township, range, meridian);
      if (!surfaceLocation) wellsWithNoSurface++;

      // Bottom hole
      const bhSection = normalizeSection(row.bh_section);
      const bhTownship = row.bh_township || township;
      const bhRange = row.bh_range || range;
      const bottomHoleLocation = createLocationKey(bhSection, bhTownship, bhRange, meridian);
      if (bottomHoleLocation) wellsWithBH++;

      // Lateral sections: compute from surface→BH locations
      let sectionsAffected: LateralLocation[] = [];

      if (surfaceSection && bhSection && surfaceSection !== bhSection) {
        // Auto-compute lateral path
        if (township === bhTownship && range === bhRange) {
          // Same township — Bresenham trace
          lateralSameTwn++;
          const lateralSections = computeLateralSections(surfaceSection, bhSection);
          sectionsAffected = lateralSections.map((s: number) => ({
            section: s, township: township || '', range: range || ''
          }));
        } else {
          // Cross-township — just include surface + BH
          lateralCrossTwn++;
          sectionsAffected = [
            { section: surfaceSection, township: township || '', range: range || '' },
            { section: bhSection, township: bhTownship || '', range: bhRange || '' }
          ];
        }
        if (sectionsAffected.length > 0) lateralComputed++;
      }

      // Build well name (prefer OCC name, fall back to client_wells)
      let wellName: string;
      if (row.occ_well_name) {
        wellName = row.well_number
          ? `${row.occ_well_name} #${row.well_number}`
          : row.occ_well_name;
      } else {
        wellName = row.cw_well_name || 'Unknown Well';
      }

      processedWells.push({
        id: row.airtable_id,
        fields: { [WELL_FIELDS.WELL_NAME]: wellName },
        surfaceLocation,
        bottomHoleLocation,
        sectionsAffected,
        township: township || '',
        range: range || '',
        meridian
      });
    }

    const tProcess = Date.now();

    // --- Step 5: Get existing links from D1 ---
    const propertyIds = processedProperties.map(p => p.id);
    let existingLinks: Array<{
      property_airtable_id: string;
      well_airtable_id: string;
      match_reason: string;
      status: string;
    }> = [];

    const LINK_BATCH = 90;
    for (let i = 0; i < propertyIds.length; i += LINK_BATCH) {
      const batch = propertyIds.slice(i, i + LINK_BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB!.prepare(
        `SELECT property_airtable_id, well_airtable_id, match_reason, status
         FROM property_well_links
         WHERE property_airtable_id IN (${placeholders})`
      ).bind(...batch).all();
      existingLinks.push(...((result.results || []) as any[]));
    }

    const existingLinkKeys = new Set<string>();
    for (const link of existingLinks) {
      if (link.property_airtable_id && link.well_airtable_id) {
        existingLinkKeys.add(`${link.property_airtable_id}-${link.well_airtable_id}`);
      }
    }

    const tLinks = Date.now();

    // --- Step 6: N×M matching ---
    const linksToCreate: any[] = [];
    let matchesFound = 0;
    let skippedExisting = 0;
    const matchesByType: Record<string, number> = {};

    for (const property of processedProperties) {
      for (const well of processedWells) {
        const linkKey = `${property.id}-${well.id}`;

        if (existingLinkKeys.has(linkKey)) {
          skippedExisting++;
          continue;
        }

        const reason = findBestMatch(property, well);
        if (reason) {
          matchesFound++;
          matchesByType[reason] = (matchesByType[reason] || 0) + 1;

          const wellName = well.fields[WELL_FIELDS.WELL_NAME] || 'Unknown Well';
          const propLocation = property.location
            ? `S${property.location.section}-T${property.location.township}-R${property.location.range}`
            : 'Unknown Location';

          const linkRecord: any = {
            fields: {
              [LINK_FIELDS.LINK_NAME]: `${wellName} → ${propLocation}`,
              [LINK_FIELDS.PROPERTY]: [property.id],
              [LINK_FIELDS.WELL]: [well.id],
              [LINK_FIELDS.LINK_TYPE]: 'Auto',
              [LINK_FIELDS.MATCH_REASON]: reason,
              [LINK_FIELDS.STATUS]: 'Linked',
              [LINK_FIELDS.USER]: [userId]
            }
          };
          if (organizationId) {
            linkRecord.fields[LINK_FIELDS.ORGANIZATION] = [organizationId];
          }
          linksToCreate.push(linkRecord);
        }
      }
    }

    const tMatch = Date.now();

    // --- Step 7: Create links in D1 ---
    const { created, failed } = await createLinksInBatches(env, linksToCreate);

    const tCreate = Date.now();

    // --- Diagnostics ---
    const existingByReason: Record<string, number> = {};
    const existingByStatus: Record<string, number> = {};
    for (const link of existingLinks) {
      existingByReason[link.match_reason || 'Unknown'] = (existingByReason[link.match_reason || 'Unknown'] || 0) + 1;
      existingByStatus[link.status || 'No Status'] = (existingByStatus[link.status || 'No Status'] || 0) + 1;
    }

    // Find unlinked wells
    const linkedWellIds = new Set<string>();
    for (const link of existingLinks) {
      if (link.well_airtable_id) linkedWellIds.add(link.well_airtable_id);
    }
    for (const l of linksToCreate) {
      const wellId = l.fields[LINK_FIELDS.WELL]?.[0];
      if (wellId) linkedWellIds.add(wellId);
    }
    const unlinkedWells = processedWells.filter(w => !linkedWellIds.has(w.id)).map(w => ({
      name: w.fields[WELL_FIELDS.WELL_NAME] || 'Unknown',
      location: w.surfaceLocation
        ? `S${w.surfaceLocation.section}-T${w.surfaceLocation.township}-R${w.surfaceLocation.range}`
        : 'no surface',
      bhLocation: w.bottomHoleLocation
        ? `S${w.bottomHoleLocation.section}-T${w.bottomHoleLocation.township}-R${w.bottomHoleLocation.range}`
        : 'no BH',
      lateralSections: w.sectionsAffected.length > 0
        ? w.sectionsAffected.map(s => `S${s.section}-T${s.township}-R${s.range}`).join(',')
        : 'none'
    }));

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    const stats = {
      propertiesProcessed: processedProperties.length,
      wellsProcessed: processedWells.length,
      linksCreated: created,
      linksSkipped: skippedExisting,
      existingLinks: existingLinks.length,
      d1Synced: created,
      errors: failed,
      newMatchesByType: matchesByType,
      existingLinksByType: existingByReason,
      existingLinksByStatus: existingByStatus,
      dataQuality: {
        propertiesWithNoLocation,
        wellsWithNoSurface,
        wellsWithBH
      },
      lateral: {
        computed: lateralComputed,
        sameTownship: lateralSameTwn,
        crossTownship: lateralCrossTwn
      },
      unlinkedWellCount: unlinkedWells.length,
      unlinkedWellSamples: unlinkedWells.slice(0, 10),
      timing: {
        propsFetch: tPropsFetch - startTime,
        wellsFetch: tWellsFetch - tPropsFetch,
        process: tProcess - tWellsFetch,
        existingLinks: tLinks - tProcess,
        matching: tMatch - tLinks,
        createLinks: tCreate - tMatch,
        total: Date.now() - startTime
      }
    };

    console.log(`[PropertyWellMatch] D1-first completed in ${duration}s:`, JSON.stringify(stats));

    return jsonResponse({ success: true, stats, duration: `${duration}s` });

  } catch (error) {
    console.error('[PropertyWellMatch] Error:', error);
    return jsonResponse({
      error: 'Failed to match properties and wells',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Find best match between property and well (same priority as before)
 * Returns match reason string or null
 */
function findBestMatch(property: PropertyRecord, well: WellRecord): string | null {
  if (!property.location) return null;

  // Priority 1: Surface location match
  if (locationsMatch(property.location, well.surfaceLocation)) {
    return 'Surface Location';
  }

  // Priority 2: Lateral path match (sections affected — full STR tuples)
  if (well.sectionsAffected.some(s =>
      s.section === property.location!.section &&
      s.township === property.location!.township &&
      s.range === property.location!.range
  ) && property.location.meridian === well.meridian) {
    return 'Lateral Path';
  }

  // Priority 3: Bottom hole match
  if (locationsMatch(property.location, well.bottomHoleLocation)) {
    return 'Bottom Hole';
  }

  // Priority 4: Adjacent BH section match
  if (well.bottomHoleLocation) {
    const adjLocs = getAdjacentLocations(
      property.location.section, property.location.township, property.location.range
    );
    if (adjLocs.some(a =>
      a.section === well.bottomHoleLocation!.section &&
      a.township === well.bottomHoleLocation!.township &&
      a.range === well.bottomHoleLocation!.range
    )) {
      return 'Adjacent Section';
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
      return 'Adjacent Section';
    }
  }

  return null;
}

/**
 * Discover & Track Wells
 *
 * Scans the OCC statewide wells table for producing wells at the user's
 * property locations, auto-creates client_wells records in D1, and links
 * them to the matching properties.
 */
export async function handleDiscoverAndTrackWells(request: Request, env: Env) {
  const startTime = Date.now();

  try {
    // --- Auth + plan limits ---
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userId = authUser.id;
    const organizationId = userRecord.fields.Organization?.[0];
    const plan = userRecord.fields.Plan || 'Free';
    const limits = getPlanLimits(plan);

    if ((limits.wells as number) === 0) {
      return jsonResponse({
        error: `Your ${plan} plan does not include well monitoring. Please upgrade to add wells.`
      }, 403);
    }

    const wellsCount = await countUserWellsD1(env, userId, organizationId);
    const remaining = limits.wells - wellsCount;

    if (remaining <= 0) {
      return jsonResponse({
        error: `Well limit reached (${limits.wells} wells on ${plan} plan). You have ${wellsCount} wells.`
      }, 403);
    }

    console.log(`[DiscoverWells] Starting for user ${authUser.email}, org=${organizationId || 'none'}, plan=${plan}, remaining=${remaining}`);

    // --- Step 1: Get user properties with STR data ---
    const propWhereClause = organizationId
      ? `WHERE (p.organization_id = ? OR p.user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `WHERE p.user_id = ?`;
    const propBindParams = organizationId ? [organizationId, organizationId] : [userId];

    const propResult = await env.WELLS_DB!.prepare(`
      SELECT p.airtable_record_id, p.section, p.township, p.range, p.county, p.meridian
      FROM properties p
      ${propWhereClause}
    `).bind(...propBindParams).all();

    const propRows = propResult.results || [];
    if (propRows.length === 0) {
      return jsonResponse({
        success: true,
        stats: { wellsDiscovered: 0, wellsTracked: 0, wellsSkipped: 0, wellsOverLimit: 0, linksCreated: 0 },
        message: 'No properties found. Add properties first.'
      });
    }

    // --- Step 2: Deduplicate STR combos across properties ---
    const strCombos = new Map<string, { section: string; township: string; range: string }>();
    // Also build property lookup by STR for link creation
    const strToProperties = new Map<string, string[]>(); // strKey → [propertyId, ...]

    for (const row of propRows as any[]) {
      if (!row.section || !row.township || !row.range) continue;
      const sec = String(row.section);
      const twn = String(row.township);
      const rng = String(row.range);
      const key = `${sec}-${twn}-${rng}`;
      if (!strCombos.has(key)) {
        strCombos.set(key, { section: sec, township: twn, range: rng });
      }
      const propIds = strToProperties.get(key) || [];
      propIds.push(row.airtable_record_id);
      strToProperties.set(key, propIds);
    }

    console.log(`[DiscoverWells] ${propRows.length} properties → ${strCombos.size} unique STR combos`);

    // --- Step 3: Query OCC wells at property locations ---
    const allDiscoveredWells: any[] = [];
    const strEntries = Array.from(strCombos.values());
    const STR_BATCH = 33; // 3 params each, max 100 per query

    for (let i = 0; i < strEntries.length; i += STR_BATCH) {
      const batch = strEntries.slice(i, i + STR_BATCH);
      const conditions = batch.map(() => `(section = ? AND township = ? AND range = ?)`).join(' OR ');
      const params: string[] = [];
      for (const combo of batch) {
        params.push(combo.section, combo.township, combo.range);
      }

      const result = await env.WELLS_DB!.prepare(`
        SELECT api_number, well_name, well_number, operator, county,
               section, township, range, well_type, well_status,
               bh_section, bh_township, bh_range
        FROM wells
        WHERE (${conditions})
          AND well_type IN ('OIL', 'GAS', 'OG', 'NT')
          AND well_status NOT IN ('PA', 'RET')
      `).bind(...params).all();

      allDiscoveredWells.push(...(result.results || []));
    }

    console.log(`[DiscoverWells] Found ${allDiscoveredWells.length} OCC wells at property locations`);

    if (allDiscoveredWells.length === 0) {
      return jsonResponse({
        success: true,
        stats: { wellsDiscovered: 0, wellsTracked: 0, wellsSkipped: 0, wellsOverLimit: 0, linksCreated: 0 },
        message: 'No producing wells found at your property locations.'
      });
    }

    // --- Step 4: Deduplicate — remove wells already tracked by user/org ---
    const ownerClause = organizationId
      ? `(organization_id = ? OR user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?))`
      : `user_id = ?`;
    const ownerParams = organizationId ? [organizationId, organizationId] : [userId];

    // Get all api_numbers already tracked
    const trackedResult = await env.WELLS_DB!.prepare(
      `SELECT api_number FROM client_wells WHERE ${ownerClause}`
    ).bind(...ownerParams).all();

    const trackedApis = new Set<string>();
    for (const row of (trackedResult.results || []) as any[]) {
      if (row.api_number) trackedApis.add(row.api_number);
    }

    // Dedupe by api_number (wells table can have dupes across batches)
    const seenApis = new Set<string>();
    const newWells: any[] = [];
    let skippedAlreadyTracked = 0;

    for (const well of allDiscoveredWells) {
      if (!well.api_number) continue;
      if (seenApis.has(well.api_number)) continue;
      seenApis.add(well.api_number);

      if (trackedApis.has(well.api_number)) {
        skippedAlreadyTracked++;
        continue;
      }
      newWells.push(well);
    }

    console.log(`[DiscoverWells] ${newWells.length} new wells (${skippedAlreadyTracked} already tracked)`);

    // --- Step 5: Plan limit check —- truncate if needed ---
    let wellsOverLimit = 0;
    let wellsToTrack = newWells;
    if (newWells.length > remaining) {
      wellsOverLimit = newWells.length - remaining;
      wellsToTrack = newWells.slice(0, remaining);
      console.log(`[DiscoverWells] Truncating to ${remaining} (${wellsOverLimit} over limit)`);
    }

    if (wellsToTrack.length === 0) {
      return jsonResponse({
        success: true,
        stats: {
          wellsDiscovered: allDiscoveredWells.length,
          wellsTracked: 0,
          wellsSkipped: skippedAlreadyTracked,
          wellsOverLimit,
          linksCreated: 0
        },
        message: wellsOverLimit > 0
          ? `Found ${newWells.length} new wells but no slots remaining on your ${plan} plan.`
          : 'All discovered wells are already tracked.'
      });
    }

    // --- Step 6: Insert client_wells into D1 ---
    const INSERT_BATCH = 10; // 10 fields per well → 100 params max
    let totalInserted = 0;
    const newAirtableIds: string[] = []; // collect generated IDs for matching

    for (let i = 0; i < wellsToTrack.length; i += INSERT_BATCH) {
      const batch = wellsToTrack.slice(i, i + INSERT_BATCH);
      const statements = batch.map(well => {
        const cwId = `cwell_disc_${crypto.randomUUID().slice(0, 8)}`;
        const airtableId = `disc_${well.api_number}`;
        newAirtableIds.push(airtableId);

        return env.WELLS_DB!.prepare(`
          INSERT INTO client_wells (
            id, airtable_id, api_number, user_id, organization_id,
            well_name, operator, county, section, township, range_val,
            well_type, well_status, tracking_source, status, synced_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', 'Active', CURRENT_TIMESTAMP)
          ON CONFLICT(airtable_id) DO NOTHING
        `).bind(
          cwId,
          airtableId,
          well.api_number,
          userId,
          organizationId || null,
          well.well_number ? `${well.well_name} #${well.well_number}` : (well.well_name || null),
          well.operator || null,
          well.county || null,
          well.section ? String(well.section) : null,
          well.township || null,
          well.range || null,
          well.well_type || null,
          well.well_status || null
        );
      });

      await env.WELLS_DB!.batch(statements);
      totalInserted += batch.length;
    }

    console.log(`[DiscoverWells] Inserted ${totalInserted} client_wells`);

    // --- Step 7: Run matching to create property_well_links ---
    // Build link records for discovered wells ↔ properties at same STR
    const linksToCreate: any[] = [];
    for (const well of wellsToTrack) {
      const sec = String(well.section);
      const twn = String(well.township);
      const rng = String(well.range);
      const strKey = `${sec}-${twn}-${rng}`;
      const matchingPropertyIds = strToProperties.get(strKey) || [];
      const wellAirtableId = `disc_${well.api_number}`;
      const wellName = well.well_number ? `${well.well_name} #${well.well_number}` : (well.well_name || 'Unknown');

      for (const propId of matchingPropertyIds) {
        const propLocation = `S${sec}-T${twn}-R${rng}`;
        const linkRecord: any = {
          fields: {
            [LINK_FIELDS.LINK_NAME]: `${wellName} → ${propLocation}`,
            [LINK_FIELDS.PROPERTY]: [propId],
            [LINK_FIELDS.WELL]: [wellAirtableId],
            [LINK_FIELDS.LINK_TYPE]: 'Auto',
            [LINK_FIELDS.MATCH_REASON]: 'Surface Location',
            [LINK_FIELDS.STATUS]: 'Linked',
            [LINK_FIELDS.USER]: [userId]
          }
        };
        if (organizationId) {
          linkRecord.fields[LINK_FIELDS.ORGANIZATION] = [organizationId];
        }
        linksToCreate.push(linkRecord);
      }
    }

    const { created: linksCreated } = await createLinksInBatches(env, linksToCreate);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = {
      wellsDiscovered: allDiscoveredWells.length,
      wellsTracked: totalInserted,
      wellsSkipped: skippedAlreadyTracked,
      wellsOverLimit,
      linksCreated
    };

    console.log(`[DiscoverWells] Completed in ${duration}s:`, JSON.stringify(stats));

    return jsonResponse({ success: true, stats, duration: `${duration}s` });

  } catch (error) {
    console.error('[DiscoverWells] Error:', error);
    return jsonResponse({
      error: 'Failed to discover and track wells',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
