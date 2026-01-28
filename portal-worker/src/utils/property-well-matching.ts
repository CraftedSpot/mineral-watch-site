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

/**
 * Location tuple for lateral path sections (section + township + range).
 * Unlike LocationKey, does not include meridian since that's a per-well property.
 */
export interface LateralLocation {
  section: number;
  township: string;
  range: string;
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
  sectionsAffected: LateralLocation[];
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
  // Match patterns like "S19", "S 19", "19", "Sec 19", "Sec19", etc.
  // Uses a regex that handles digits preceded by letters (e.g., "S34")
  const matches = sectionsStr.match(/(?:^|[^0-9])(\d{1,2})(?=[^0-9]|$)/g);

  if (matches) {
    for (const match of matches) {
      // Extract just the digits from each match (match may include leading non-digit)
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
 * PLSS section grid layout (serpentine numbering):
 *   6  5  4  3  2  1
 *   7  8  9 10 11 12
 *  18 17 16 15 14 13
 *  19 20 21 22 23 24
 *  30 29 28 27 26 25
 *  31 32 33 34 35 36
 */
const SECTION_GRID: number[][] = [
  [ 6,  5,  4,  3,  2,  1],
  [ 7,  8,  9, 10, 11, 12],
  [18, 17, 16, 15, 14, 13],
  [19, 20, 21, 22, 23, 24],
  [30, 29, 28, 27, 26, 25],
  [31, 32, 33, 34, 35, 36],
];

// Precompute section → (row, col) lookup
const SECTION_POS = new Map<number, [number, number]>();
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 6; c++) {
    SECTION_POS.set(SECTION_GRID[r][c], [r, c]);
  }
}

/**
 * Get adjacent sections within the same township (8 neighbors, including diagonals)
 */
export function getAdjacentSectionsInTownship(section: number): number[] {
  const pos = SECTION_POS.get(section);
  if (!pos) return [];
  const [row, col] = pos;
  const adjacent: number[] = [];
  const directions: [number, number][] = [
    [-1, -1], [-1, 0], [-1, 1],
    [ 0, -1],          [ 0, 1],
    [ 1, -1], [ 1, 0], [ 1, 1]
  ];
  for (const [dr, dc] of directions) {
    const newRow = row + dr;
    const newCol = col + dc;
    if (newRow >= 0 && newRow < 6 && newCol >= 0 && newCol < 6) {
      adjacent.push(SECTION_GRID[newRow][newCol]);
    }
  }
  return adjacent;
}

/**
 * Parse township string to get number and direction (e.g., "17N" -> {num: 17, dir: "N"})
 */
export function parseTownship(township: string): { num: number; dir: string } | null {
  const match = township.match(/^(\d+)([NS])$/i);
  if (!match) return null;
  return { num: parseInt(match[1]), dir: match[2].toUpperCase() };
}

/**
 * Parse range string to get number and direction (e.g., "18W" -> {num: 18, dir: "W"})
 */
export function parseRange(range: string): { num: number; dir: string } | null {
  const match = range.match(/^(\d+)([EW])$/i);
  if (!match) return null;
  return { num: parseInt(match[1]), dir: match[2].toUpperCase() };
}

/**
 * Get which edges of the township grid a section borders
 */
export function getEdgeSections(section: number): { north: boolean; south: boolean; east: boolean; west: boolean } {
  const pos = SECTION_POS.get(section);
  if (!pos) return { north: false, south: false, east: false, west: false };
  const [row, col] = pos;
  return {
    north: row === 0,
    south: row === 5,
    east: col === 5,
    west: col === 0
  };
}

/**
 * Get adjacent locations including cross-township/range boundaries.
 * Returns {section, township, range} tuples for all 8-connected neighbors.
 * For edge/corner sections, includes neighbors in adjacent townships/ranges.
 */
export function getAdjacentLocations(
  section: number,
  township: string,
  range: string
): Array<{ section: number; township: string; range: string }> {
  const locations: Array<{ section: number; township: string; range: string }> = [];

  // Adjacent within same township
  const adjacentInTownship = getAdjacentSectionsInTownship(section);
  for (const adjSection of adjacentInTownship) {
    locations.push({ section: adjSection, township, range });
  }

  // Cross-township adjacency for edge sections
  const edges = getEdgeSections(section);
  const pos = SECTION_POS.get(section);
  if (!pos) return locations;

  const [row, col] = pos;
  const twp = parseTownship(township);
  const rng = parseRange(range);

  if (!twp || !rng) return locations;

  // North edge
  if (edges.north) {
    const northTwp = twp.dir === 'N' ? `${twp.num + 1}N` : (twp.num > 1 ? `${twp.num - 1}S` : '1N');
    const southRowSections = [31, 32, 33, 34, 35, 36];
    for (let dc = -1; dc <= 1; dc++) {
      const newCol = col + dc;
      if (newCol >= 0 && newCol < 6) {
        locations.push({ section: southRowSections[newCol], township: northTwp, range });
      }
    }
  }

  // South edge
  if (edges.south) {
    const southTwp = twp.dir === 'S' ? `${twp.num + 1}S` : (twp.num > 1 ? `${twp.num - 1}N` : '1S');
    const northRowSections = [6, 5, 4, 3, 2, 1];
    for (let dc = -1; dc <= 1; dc++) {
      const newCol = col + dc;
      if (newCol >= 0 && newCol < 6) {
        locations.push({ section: northRowSections[newCol], township: southTwp, range });
      }
    }
  }

  // East edge
  if (edges.east) {
    const eastRng = rng.dir === 'E' ? `${rng.num + 1}E` : (rng.num > 1 ? `${rng.num - 1}W` : '1E');
    const westColSections = [6, 7, 18, 19, 30, 31];
    for (let dr = -1; dr <= 1; dr++) {
      const newRow = row + dr;
      if (newRow >= 0 && newRow < 6) {
        locations.push({ section: westColSections[newRow], township, range: eastRng });
      }
    }
  }

  // West edge
  if (edges.west) {
    const westRng = rng.dir === 'W' ? `${rng.num + 1}W` : (rng.num > 1 ? `${rng.num - 1}E` : '1W');
    const eastColSections = [1, 12, 13, 24, 25, 36];
    for (let dr = -1; dr <= 1; dr++) {
      const newRow = row + dr;
      if (newRow >= 0 && newRow < 6) {
        locations.push({ section: eastColSections[newRow], township, range: westRng });
      }
    }
  }

  return locations;
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
 * Compute sections crossed by a lateral well path using Bresenham's line
 * algorithm on the PLSS section grid. Given a surface section and bottom hole
 * section (within the same township), returns all sections the lateral passes through.
 */
export function computeLateralSections(surfaceSection: number, bhSection: number): number[] {
  if (surfaceSection === bhSection) return [];

  const surfacePos = SECTION_POS.get(surfaceSection);
  const bhPos = SECTION_POS.get(bhSection);
  if (!surfacePos || !bhPos) return [];

  const [r0, c0] = surfacePos;
  const [r1, c1] = bhPos;

  // Bresenham's line algorithm to trace grid cells between surface and BH
  const sections = new Set<number>();
  const dx = Math.abs(c1 - c0);
  const dy = Math.abs(r1 - r0);
  const sx = c0 < c1 ? 1 : -1;
  const sy = r0 < r1 ? 1 : -1;
  let err = dx - dy;
  let x = c0, y = r0;

  while (true) {
    sections.add(SECTION_GRID[y][x]);
    if (x === c1 && y === r1) break;
    const e2 = 2 * err;
    // For diagonal moves, include both intermediate sections for broader coverage
    if (e2 > -dy && e2 < dx) {
      // Diagonal step — also include the two cells on either side of the diagonal
      sections.add(SECTION_GRID[y][x + sx]);
      sections.add(SECTION_GRID[y + sy][x]);
      err -= dy;
      err += dx;
      x += sx;
      y += sy;
    } else if (e2 > -dy) {
      err -= dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
  }

  return Array.from(sections);
}

/**
 * Enrich Airtable well records with BH location data from D1 wells table.
 * The matching reads wells from Airtable, but BH Section/Township/Range are
 * often only in the statewide wells table. This fills in the gaps so
 * Bottom Hole matching (Priority 3) works for lateral wells.
 *
 * Also auto-computes "Sections Affected" for horizontal wells by tracing the
 * lateral path between surface and BH sections on the PLSS grid.
 */
export interface EnrichmentDiagnostics {
  bhEnriched: number;
  lateralComputed: number;
  lateralSkipNoBH: number;
  lateralSkipSameSection: number;
  lateralSameTwn: number;
  lateralCrossTwn: number;
}

export async function enrichWellsWithD1Data(wells: any[], env: Env): Promise<EnrichmentDiagnostics> {
  // Collect API numbers for wells missing BH data
  const apiNumbers: string[] = [];
  const apiToWells = new Map<string, any[]>();

  for (const well of wells) {
    const api = well.fields['API Number'];
    if (!api) continue;
    const clean = String(api).replace(/\D/g, '');
    if (!clean) continue;

    // Only enrich if Airtable is missing BH section
    if (!well.fields[WELL_FIELDS.BH_SECTION]) {
      apiNumbers.push(clean);
      const existing = apiToWells.get(clean) || [];
      existing.push(well);
      apiToWells.set(clean, existing);
    }
  }

  if (apiNumbers.length > 0) {
    // Query D1 in batches of 50
    const BATCH = 50;
    for (let i = 0; i < apiNumbers.length; i += BATCH) {
      const batch = apiNumbers.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(
        `SELECT api_number, bh_section, bh_township, bh_range
         FROM wells
         WHERE api_number IN (${placeholders})
         AND bh_section IS NOT NULL`
      ).bind(...batch).all();

      for (const row of (result.results || []) as any[]) {
        const targets = apiToWells.get(row.api_number);
        if (!targets) continue;
        for (const well of targets) {
          well.fields[WELL_FIELDS.BH_SECTION] = String(row.bh_section);
          well.fields[WELL_FIELDS.BH_TOWNSHIP] = row.bh_township || well.fields[WELL_FIELDS.TOWNSHIP];
          well.fields[WELL_FIELDS.BH_RANGE] = row.bh_range || well.fields[WELL_FIELDS.RANGE];
        }
      }
    }

    console.log(`[PropertyWellMatch] Enriched ${apiNumbers.length} wells with D1 BH data`);
  }

  // Auto-compute Sections Affected for wells with BH data but no Sections Affected
  let computedCount = 0;
  let skipAlreadyHas = 0;
  let skipNoSurface = 0;
  let skipNoBH = 0;
  let skipSameSection = 0;
  let skipOutOfRange = 0;
  let sameTwn = 0;
  let crossTwn = 0;

  for (const well of wells) {
    // Skip wells that already have Sections Affected populated
    if (well.fields[WELL_FIELDS.SECTIONS_AFFECTED]) {
      skipAlreadyHas++;
      continue;
    }

    const surfaceRaw = well.fields[WELL_FIELDS.SECTION];
    const bhRaw = well.fields[WELL_FIELDS.BH_SECTION];
    const surfaceSection = parseInt(String(surfaceRaw || ''), 10);
    const bhSection = parseInt(String(bhRaw || ''), 10);

    if (!surfaceSection || isNaN(surfaceSection)) { skipNoSurface++; continue; }
    if (!bhSection || isNaN(bhSection)) { skipNoBH++; continue; }
    if (surfaceSection === bhSection) { skipSameSection++; continue; }
    if (surfaceSection < 1 || surfaceSection > 36 || bhSection < 1 || bhSection > 36) { skipOutOfRange++; continue; }

    // Only compute for same-township wells (surface and BH in same township)
    const surfaceTwn = well.fields[WELL_FIELDS.TOWNSHIP];
    const bhTwn = well.fields[WELL_FIELDS.BH_TOWNSHIP] || surfaceTwn;
    const surfaceRng = well.fields[WELL_FIELDS.RANGE];
    const bhRng = well.fields[WELL_FIELDS.BH_RANGE] || surfaceRng;

    if (surfaceTwn === bhTwn && surfaceRng === bhRng) {
      sameTwn++;
      // Same township — compute lateral path through grid
      const lateralSections = computeLateralSections(surfaceSection, bhSection);
      if (lateralSections.length > 0) {
        // Store full STR tuples for cross-township-aware matching
        well._lateralLocations = lateralSections.map(s => ({
          section: s,
          township: surfaceTwn,
          range: surfaceRng
        }));
        // Also set display string for diagnostics
        well.fields[WELL_FIELDS.SECTIONS_AFFECTED] = lateralSections.map(s => `S${s}`).join(', ');
        computedCount++;
      }
    } else {
      crossTwn++;
      // Cross-township lateral: each section gets its own township/range
      well._lateralLocations = [
        { section: surfaceSection, township: surfaceTwn, range: surfaceRng },
        { section: bhSection, township: bhTwn, range: bhRng }
      ];
      well.fields[WELL_FIELDS.SECTIONS_AFFECTED] = `S${surfaceSection}-T${surfaceTwn}-R${surfaceRng}, S${bhSection}-T${bhTwn}-R${bhRng}`;
      computedCount++;
    }
  }

  console.log(`[PropertyWellMatch] Lateral computation: computed=${computedCount}, alreadyHas=${skipAlreadyHas}, noSurface=${skipNoSurface}, noBH=${skipNoBH}, sameSection=${skipSameSection}, outOfRange=${skipOutOfRange}, sameTwn=${sameTwn}, crossTwn=${crossTwn}`);

  return {
    bhEnriched: apiNumbers.length,
    lateralComputed: computedCount,
    lateralSkipNoBH: skipNoBH,
    lateralSkipSameSection: skipSameSection,
    lateralSameTwn: sameTwn,
    lateralCrossTwn: crossTwn
  };
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
  
  // Sections affected as full location tuples
  let sectionsAffected: LateralLocation[];
  if (well._lateralLocations) {
    // Use pre-computed full tuples from enrichment pipeline
    sectionsAffected = well._lateralLocations;
  } else {
    // Fallback: parse section numbers from string, use surface township/range
    const sectionNumbers = parseSectionsAffected(well.fields[WELL_FIELDS.SECTIONS_AFFECTED] || '');
    sectionsAffected = sectionNumbers.map(s => ({
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
    
    if (['Active', 'Linked'].includes(link.fields[LINK_FIELDS.STATUS])) {
      active.add(wellId);
    } else if (['Rejected', 'Unlinked'].includes(link.fields[LINK_FIELDS.STATUS])) {
      rejected.add(wellId);
    }
  }

  return { active, rejected };
}

/**
 * Get existing links for a well (both linked and unlinked)
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

    if (['Active', 'Linked'].includes(link.fields[LINK_FIELDS.STATUS])) {
      active.add(propertyId);
    } else if (['Rejected', 'Unlinked'].includes(link.fields[LINK_FIELDS.STATUS])) {
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

  // Enrich wells with BH data and compute lateral sections
  await enrichWellsWithD1Data(wells, env);

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
          [LINK_FIELDS.STATUS]: 'Linked',
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

  // Enrich the well with BH data and compute lateral sections
  await enrichWellsWithD1Data([wellData], env);

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
          [LINK_FIELDS.STATUS]: 'Linked',
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
  
  const email = userEmail.replace(/'/g, "\\'");

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

    // Filter by organization name OR user email - properties may have Organization
    // field empty but User field set (e.g., after bulk re-upload via Airtable)
    const orgFind = `FIND('${orgName.replace(/'/g, "\\'")}', ARRAYJOIN({Organization}))`;
    const userFind = `FIND('${email}', ARRAYJOIN({User}))`;
    propertiesFilter = `OR(${orgFind} > 0, ${userFind} > 0)`;
    wellsFilter = `OR(${orgFind} > 0, ${userFind} > 0)`;
    linksFilter = `OR(${orgFind} > 0, ${userFind} > 0)`;
  } else {
    // Solo user - filter by user email
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

  // Enrich wells with BH data from D1 (Airtable often lacks BH fields)
  await enrichWellsWithD1Data(wells, env);

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