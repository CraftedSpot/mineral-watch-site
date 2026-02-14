import type { D1Database } from '@cloudflare/workers-types';

// Normalize API number: strip separators and ensure 35 prefix (Oklahoma)
const normalizeApiNumber = (api: string): string | null => {
  if (!api) return null;
  const digits = api.replace(/[\s\-\.]/g, '').replace(/[^0-9]/g, '');
  if (digits.length === 10 && digits.startsWith('35')) return digits;
  if (digits.length === 14 && digits.startsWith('35')) return digits;
  if (digits.length === 8) return '35' + digits;
  if (digits.length === 12) return '35' + digits;
  return digits.length >= 8 ? digits : null;
};

// Normalize section (strip leading zeros)
const normalizeSection = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const parsed = parseInt(s, 10);
  return isNaN(parsed) ? null : String(parsed);
};

// Normalize township/range (ensure suffix, handle missing, no padding)
const normalizeTownship = (t: string | null | undefined): string | null => {
  if (!t) return null;
  // Remove all non-digits to get the number part
  const num = t.replace(/[^\d]/g, '');
  if (!num) return null;
  
  // Convert to integer to remove leading zeros, then back to string
  const cleanNum = String(parseInt(num, 10));
  
  // Look for direction (N/S), default to N if missing
  const dir = t.match(/[NSns]/)?.[0]?.toUpperCase() || 'N';
  return `${cleanNum}${dir}`;
};

const normalizeRange = (r: string | null | undefined): string | null => {
  if (!r) return null;
  // Remove all non-digits to get the number part
  const num = r.replace(/[^\d]/g, '');
  if (!num) return null;

  // Convert to integer to remove leading zeros, then back to string
  const cleanNum = String(parseInt(num, 10));

  // Look for direction (E/W), default to W if missing
  const dir = r.match(/[EWew]/)?.[0]?.toUpperCase() || 'W';
  return `${cleanNum}${dir}`;
};

// Normalize county name (strip "County" suffix, trim whitespace)
const normalizeCounty = (c: string | null | undefined): string | null => {
  if (!c) return null;
  // Remove "County" suffix (case-insensitive) and trim
  return c.replace(/\s+county$/i, '').trim();
};

// Well name normalization functions
const normalizeWellName = (wellName: string | null | undefined): string | null => {
  if (!wellName) return null;
  // Remove quotes and extra whitespace
  // Handles: FEIKES "A" UNIT → FEIKES A UNIT
  return wellName.replace(/["""'']/g, '').trim();
};

// Extract base well name for fuzzy matching
const extractBaseName = (wellName: string): string => {
  if (!wellName) return '';
  
  // Extract base name before well number patterns
  // Examples: "MCCARTHY 1506 3H-30X" -> "MCCARTHY 1506"
  const wellNameParts = wellName.match(/^(.*?)\s+(\d+[A-Z]?-\d+[A-Z]?X?|\#\d+[A-Z]?-\d+[A-Z]?X?)$/i);
  return wellNameParts ? wellNameParts[1].trim() : wellName;
};

// Extract well name and number components
const extractWellComponents = (fullName: string): { name: string; number: string | null } => {
  if (!fullName) return { name: '', number: null };
  
  // Try to match patterns like "PENN MUTUAL LIFE #1" or "SMITH 1" or "JONES #2-H"
  const patterns = [
    /^(.+?)\s+#(\d+(?:-?\w+)?)$/,  // "PENN MUTUAL LIFE #1" or "SMITH #2-H"
    /^(.+?)\s+(\d+(?:-?\w+)?)$/,    // "SMITH 1" or "JONES 2-H"
  ];
  
  for (const pattern of patterns) {
    const match = fullName.match(pattern);
    if (match) {
      return { 
        name: match[1].trim(), 
        number: match[2].includes('#') ? match[2] : `#${match[2]}`
      };
    }
  }
  
  // No number found, return full name
  return { name: fullName, number: null };
};

// Create name variations for matching
const createNameVariations = (wellName: string): string[] => {
  if (!wellName) return [];
  
  const variations: string[] = [wellName];
  
  // If name has a number without #, also try with #
  const numberMatch = wellName.match(/^(.*?)(\d+)(.*)$/);
  if (numberMatch && !wellName.includes('#')) {
    variations.push(`${numberMatch[1]}#${numberMatch[2]}${numberMatch[3]}`);
  }
  
  // If name has # followed by number, also try without #
  const hashMatch = wellName.match(/^(.*?)#(\d+)(.*)$/);
  if (hashMatch) {
    variations.push(`${hashMatch[1]}${hashMatch[2]}${hashMatch[3]}`);
  }
  
  return variations;
};

/**
 * Match offset wells by API number against wells and client_wells tables.
 * Returns array of matched airtable_record_id / airtable_id values.
 */
async function matchOffsetWells(
  db: D1Database,
  offsetWells: Array<{ well_name?: string; api_number?: string }>,
  documentUserId: string | null,
  documentOrgId: string | null
): Promise<string[]> {
  const matchedIds: string[] = [];

  for (const offsetWell of offsetWells) {
    const api = offsetWell.api_number;
    if (!api) continue;

    try {
      // Try statewide wells table first (exact API match)
      const well = await db.prepare(
        `SELECT airtable_record_id as id FROM wells WHERE api_number = ? LIMIT 1`
      ).bind(api).first();

      if (well?.id) {
        matchedIds.push(well.id as string);
        console.log(`[LinkDocuments] Offset well matched (wells): API ${api} -> ${well.id}`);
        continue;
      }

      // Fallback: try client_wells table (user/org scoped)
      if (documentUserId || documentOrgId) {
        const clientWell = await db.prepare(`
          SELECT airtable_id as id FROM client_wells
          WHERE api_number = ?
            AND (user_id = ? OR organization_id = ?)
          LIMIT 1
        `).bind(api, documentUserId || '', documentOrgId || '').first();

        if (clientWell?.id) {
          matchedIds.push(clientWell.id as string);
          console.log(`[LinkDocuments] Offset well matched (client_wells): API ${api} -> ${clientWell.id}`);
          continue;
        }
      }

      console.log(`[LinkDocuments] Offset well not found: API ${api} (${offsetWell.well_name || 'unnamed'})`);
    } catch (error) {
      console.error(`[LinkDocuments] Error matching offset well API ${api}:`, error);
    }
  }

  return matchedIds;
}

const MAX_UNIT_NAME_MATCHES = 10;

/**
 * Match wells by unit_name, constrained by township/range.
 * Uses LIKE '%unit_name%' on well_name with T/R cross-check to prevent overmatching.
 */
async function matchUnitNameWells(
  db: D1Database,
  unitName: string,
  township: string | null,
  range: string | null,
  documentUserId: string | null,
  documentOrgId: string | null
): Promise<string[]> {
  const matchedIds: string[] = [];

  // Require township AND range to prevent overmatching
  if (!township || !range) {
    console.log(`[LinkDocuments] Unit name matching skipped: missing T/R (T: ${township}, R: ${range})`);
    return matchedIds;
  }

  // Require unit_name to be at least 3 characters
  if (unitName.length < 3) {
    console.log(`[LinkDocuments] Unit name matching skipped: name too short ("${unitName}")`);
    return matchedIds;
  }

  try {
    // Search statewide wells table
    const wellsResult = await db.prepare(`
      SELECT airtable_record_id as id, well_name, api_number
      FROM wells
      WHERE UPPER(well_name) LIKE UPPER(?)
        AND UPPER(township) = UPPER(?)
        AND UPPER(range) = UPPER(?)
      ORDER BY well_status = 'AC' DESC
      LIMIT ?
    `).bind(`%${unitName}%`, township, range, MAX_UNIT_NAME_MATCHES).all();

    if (wellsResult.results) {
      for (const well of wellsResult.results) {
        if (well.id) {
          matchedIds.push(well.id as string);
          console.log(`[LinkDocuments] Unit name matched (wells): "${unitName}" -> ${well.well_name} (${well.id})`);
        }
      }
    }

    // Also search client_wells table (note: uses range_val not range)
    if (documentUserId || documentOrgId) {
      const remaining = MAX_UNIT_NAME_MATCHES - matchedIds.length;
      if (remaining > 0) {
        const clientResult = await db.prepare(`
          SELECT airtable_id as id, well_name, api_number
          FROM client_wells
          WHERE (user_id = ? OR organization_id = ?)
            AND UPPER(well_name) LIKE UPPER(?)
            AND UPPER(township) = UPPER(?)
            AND UPPER(range_val) = UPPER(?)
          ORDER BY well_status = 'AC' DESC
          LIMIT ?
        `).bind(
          documentUserId || '', documentOrgId || '',
          `%${unitName}%`, township, range, remaining
        ).all();

        if (clientResult.results) {
          for (const well of clientResult.results) {
            if (well.id && !matchedIds.includes(well.id as string)) {
              matchedIds.push(well.id as string);
              console.log(`[LinkDocuments] Unit name matched (client_wells): "${unitName}" -> ${well.well_name} (${well.id})`);
            }
          }
        }
      }
    }

    console.log(`[LinkDocuments] Unit name "${unitName}" in T${township}-R${range}: matched ${matchedIds.length} wells`);
  } catch (error) {
    console.error(`[LinkDocuments] Error matching unit name "${unitName}":`, error);
  }

  return matchedIds;
}

// Function to link documents to properties and wells
export async function linkDocumentToEntities(
  db: D1Database,
  documentId: string,
  extractedFields: Record<string, any>
): Promise<{ propertyId: string | null; wellId: string | null }> {
  let propertyId: string | null = null;
  let wellId: string | null = null;

  // Get the document's user_id and organization_id to filter properties by ownership
  let documentUserId: string | null = null;
  let documentOrgId: string | null = null;
  try {
    const docResult = await db.prepare(`
      SELECT user_id, organization_id FROM documents WHERE id = ?
    `).bind(documentId).first();
    documentUserId = docResult?.user_id as string | null;
    documentOrgId = docResult?.organization_id as string | null;
    console.log(`[LinkDocuments] Document belongs to user: ${documentUserId}, org: ${documentOrgId}`);
  } catch (error) {
    console.error(`[LinkDocuments] Error fetching document user_id/organization_id:`, error);
  }

  // Extract legal description from document
  // Handle both nested (with .value) and flat structures
  const getValue = (field: any): any => {
    return field?.value !== undefined ? field.value : field;
  };

  // Check if legal description is nested in an object
  const legalDescObj = getValue(extractedFields.legal_description);

  // Check for tracts array (mineral deed schema) - get first tract's legal info
  const tractsArray = getValue(extractedFields.tracts);
  const firstTractLegal = Array.isArray(tractsArray) && tractsArray.length > 0
    ? getValue(tractsArray[0]?.legal)
    : null;

  // Extract from: tracts[0].legal (deeds), legal_description object, or top-level fields
  const rawSection = getValue(firstTractLegal?.section) ||
                     getValue(legalDescObj?.section) ||
                     getValue(extractedFields.section) ||
                     getValue(extractedFields.legal_section) ||
                     getValue(extractedFields.Section) ||
                     getValue(extractedFields.SEC) ||
                     getValue(extractedFields.sec);

  const rawTownship = getValue(firstTractLegal?.township) ||
                      getValue(legalDescObj?.township) ||
                      getValue(extractedFields.township) ||
                      getValue(extractedFields.legal_township) ||
                      getValue(extractedFields.Township) ||
                      getValue(extractedFields.TWN) ||
                      getValue(extractedFields.twn) ||
                      getValue(extractedFields.TWP);

  const rawRange = getValue(firstTractLegal?.range) ||
                   getValue(legalDescObj?.range) ||
                   getValue(extractedFields.range) ||
                   getValue(extractedFields.legal_range) ||
                   getValue(extractedFields.Range) ||
                   getValue(extractedFields.RNG) ||
                   getValue(extractedFields.rng);

  // Check location object for county (used by location_exception_order schema)
  const locationObjForCounty = getValue(extractedFields.location);

  const rawCounty = getValue(firstTractLegal?.county) ||
                    getValue(legalDescObj?.county) ||
                    getValue(locationObjForCounty?.county) ||
                    getValue(extractedFields.county) ||
                    getValue(extractedFields.County) ||
                    getValue(extractedFields.COUNTY) ||
                    getValue(extractedFields.recording_county) ||
                    getValue(extractedFields.recording?.county);  // Recording info fallback

  const meridian = getValue(firstTractLegal?.meridian) ||
                   getValue(legalDescObj?.meridian) ||
                   getValue(extractedFields.meridian) ||
                   getValue(extractedFields.Meridian) ||
                   getValue(extractedFields.MERIDIAN) ||
                   getValue(extractedFields.MER) ||
                   null;

  // Normalize the values
  const section = normalizeSection(rawSection);
  const township = normalizeTownship(rawTownship);
  const range = normalizeRange(rawRange);
  const county = normalizeCounty(rawCounty);  // Strip "County" suffix

  console.log(`[LinkDocuments] Attempting to link document ${documentId}`);
  if (legalDescObj && typeof legalDescObj === 'object') {
    console.log(`[LinkDocuments] Legal description object found:`, JSON.stringify(legalDescObj));
  }
  console.log(`[LinkDocuments] Raw values: Section '${rawSection}', Township '${rawTownship}', Range '${rawRange}', County '${rawCounty}'`);
  console.log(`[LinkDocuments] Normalized: Section '${section}', Township '${township}', Range '${range}', County '${county}', Meridian '${meridian}'`);
  
  // Build list of all sections to check (primary + unit_sections)
  const sectionsToCheck: Array<{section: string, township: string, range: string}> = [];

  // Add primary section if available
  if (section && township && range) {
    sectionsToCheck.push({ section, township, range });
  }

  // Add sections from tracts array (mineral deed schema - multi-tract deeds)
  if (Array.isArray(tractsArray) && tractsArray.length > 0) {
    console.log(`[LinkDocuments] Found ${tractsArray.length} tracts to check for property linking`);
    for (const tract of tractsArray) {
      const tractLegal = getValue(tract?.legal);
      if (!tractLegal) continue;

      const tractSection = normalizeSection(getValue(tractLegal.section));
      const tractTownship = normalizeTownship(getValue(tractLegal.township));
      const tractRange = normalizeRange(getValue(tractLegal.range));

      if (tractSection && tractTownship && tractRange) {
        // Avoid duplicates
        const isDuplicate = sectionsToCheck.some(
          s => s.section === tractSection && s.township === tractTownship && s.range === tractRange
        );
        if (!isDuplicate) {
          sectionsToCheck.push({ section: tractSection, township: tractTownship, range: tractRange });
          console.log(`[LinkDocuments] Added tract: ${tractSection}-${tractTownship}-${tractRange}`);
        }
      }
    }
  }

  // Add sections from unit_sections array (for multi-section horizontal wells / Division Orders)
  const unitSections = getValue(extractedFields.unit_sections);
  if (Array.isArray(unitSections)) {
    console.log(`[LinkDocuments] Found ${unitSections.length} unit_sections to check`);
    for (const unit of unitSections) {
      const unitSection = normalizeSection(getValue(unit.section));
      let unitTownship = normalizeTownship(getValue(unit.township));
      let unitRange = normalizeRange(getValue(unit.range));

      // FALLBACK: If unit section has no township/range, inherit from primary
      if (unitSection && (!unitTownship || !unitRange)) {
        if (!unitTownship && township) {
          unitTownship = township;
          console.log(`[LinkDocuments] Unit section ${unitSection} missing township, inheriting: ${township}`);
        }
        if (!unitRange && range) {
          unitRange = range;
          console.log(`[LinkDocuments] Unit section ${unitSection} missing range, inheriting: ${range}`);
        }
      }

      if (unitSection && unitTownship && unitRange) {
        // Avoid duplicates
        const isDuplicate = sectionsToCheck.some(
          s => s.section === unitSection && s.township === unitTownship && s.range === unitRange
        );
        if (!isDuplicate) {
          sectionsToCheck.push({ section: unitSection, township: unitTownship, range: unitRange });
        }
      }
    }
  }

  // Add sections from location.sections array (for location exception orders, especially horizontals)
  // For horizontal wells, only use sections where is_target_section is true (not surface location)
  const locationObj = getValue(extractedFields.location);
  const locationSections = locationObj?.sections;
  if (Array.isArray(locationSections)) {
    console.log(`[LinkDocuments] Found ${locationSections.length} location.sections to check`);
    for (const locSection of locationSections) {
      // Skip surface-only locations for horizontal wells - we want target sections for property matching
      const isTargetSection = locSection.is_target_section;
      const isSurfaceLocation = locSection.is_surface_location;

      // Include section if: it's a target section, OR if is_target_section is not specified (backwards compat)
      if (isTargetSection === false && isSurfaceLocation === true) {
        console.log(`[LinkDocuments] Skipping surface-only section ${locSection.section} (not a target section)`);
        continue;
      }

      const locSectionNum = normalizeSection(getValue(locSection.section));
      let locTownship = normalizeTownship(getValue(locSection.township));
      let locRange = normalizeRange(getValue(locSection.range));

      // FALLBACK: If section has no township/range, inherit from primary
      if (locSectionNum && (!locTownship || !locRange)) {
        if (!locTownship && township) {
          locTownship = township;
          console.log(`[LinkDocuments] Location section ${locSectionNum} missing township, inheriting: ${township}`);
        }
        if (!locRange && range) {
          locRange = range;
          console.log(`[LinkDocuments] Location section ${locSectionNum} missing range, inheriting: ${range}`);
        }
      }

      if (locSectionNum && locTownship && locRange) {
        // Avoid duplicates
        const isDuplicate = sectionsToCheck.some(
          s => s.section === locSectionNum && s.township === locTownship && s.range === locRange
        );
        if (!isDuplicate) {
          sectionsToCheck.push({ section: locSectionNum, township: locTownship, range: locRange });
          console.log(`[LinkDocuments] Added location section: ${locSectionNum}-${locTownship}-${locRange} (target: ${isTargetSection})`);
        }
      }
    }
  }

  console.log(`[LinkDocuments] Total sections to check for property matching: ${sectionsToCheck.length}`);

  // Match properties by legal description - find ALL matching properties across ALL sections
  const matchedPropertyIds: string[] = [];

  // Use organization_id if available, otherwise user_id for property ownership matching
  const ownerFilter = documentOrgId || documentUserId;
  console.log(`[LinkDocuments] Using owner filter: ${ownerFilter} (org: ${documentOrgId}, user: ${documentUserId})`);

  if (sectionsToCheck.length > 0 && county && ownerFilter) {
    for (const sectionData of sectionsToCheck) {
      try {
        // Query for ALL properties matching this section (not LIMIT 1)
        // Strip "County" suffix from property county for comparison (handles "Blaine" vs "Blaine County")
        // Check owner against both user_id and organization_id (properties table uses 'owner' for both)
        const propertyQuery = `
          SELECT airtable_record_id as id FROM properties
          WHERE CAST(section AS INTEGER) = CAST(? AS INTEGER)
            AND CAST(REPLACE(REPLACE(UPPER(township), 'N', ''), 'S', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'N', ''), 'S', '') AS INTEGER)
            AND SUBSTR(UPPER(township), -1) = SUBSTR(UPPER(?), -1)
            AND CAST(REPLACE(REPLACE(UPPER(range), 'E', ''), 'W', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'E', ''), 'W', '') AS INTEGER)
            AND SUBSTR(UPPER(range), -1) = SUBSTR(UPPER(?), -1)
            AND LOWER(REPLACE(county, ' County', '')) = LOWER(?)
            AND (meridian = ? OR meridian IS NULL OR ? IS NULL)
            AND owner IN (?, ?)
        `;
        const propertyParams = [
          sectionData.section,
          sectionData.township, sectionData.township,
          sectionData.range, sectionData.range,
          county, meridian, meridian,
          documentUserId || '', documentOrgId || ''
        ];

        console.log(`[LinkDocuments] Checking section ${sectionData.section}-${sectionData.township}-${sectionData.range} for owner ${ownerFilter}`);

        const properties = await db.prepare(propertyQuery).bind(...propertyParams).all();

        if (properties.results && properties.results.length > 0) {
          for (const prop of properties.results) {
            const propId = prop.id as string;
            if (!matchedPropertyIds.includes(propId)) {
              matchedPropertyIds.push(propId);
              console.log(`[LinkDocuments] Found matching property: ${propId} for section ${sectionData.section}`);
            }
          }
        }
      } catch (error) {
        console.error(`[LinkDocuments] Error matching property for section ${sectionData.section}:`, error);
      }
    }

    if (matchedPropertyIds.length > 0) {
      // Store all property IDs as comma-separated string
      propertyId = matchedPropertyIds.join(',');
      console.log(`[LinkDocuments] Total matched properties: ${matchedPropertyIds.length} - IDs: ${propertyId}`);
    } else {
      console.log(`[LinkDocuments] No property matches found for any section`);
    }
  } else if (sectionsToCheck.length > 0 && county && !ownerFilter) {
    console.log(`[LinkDocuments] Skipping property matching - could not determine document owner`);
  }
  
  // Check for nested well information objects or arrays
  const wellInfoObj = getValue(extractedFields.well_information) || 
                      getValue(extractedFields.well_info) ||
                      getValue(extractedFields.well_details) ||
                      getValue(extractedFields.well);
  
  // Handle if wells are in an array (for documents with multiple wells)
  const wellsList = getValue(extractedFields.wells) || 
                    getValue(extractedFields.well_list);
  const firstWell = Array.isArray(wellsList) ? wellsList[0] : null;
  
  // Match well by API number or name using cascading search strategy
  // Prefer normalized API (with 35 prefix) over raw extracted API
  const rawApiNumber = getValue(firstWell?.api_number) ||
                    getValue(firstWell?.api) ||
                    getValue(wellInfoObj?.api_number) ||
                    getValue(wellInfoObj?.api) ||
                    getValue(extractedFields.api_number) ||
                    getValue(extractedFields.api) ||
                    getValue(extractedFields.API) ||
                    getValue(extractedFields['API Number']) ||
                    getValue(extractedFields.api_no);
  // Use normalized version (always has 35 prefix) if available, fall back to raw
  const apiNumber = getValue(extractedFields.api_number_normalized) ||
                    getValue(firstWell?.api_number_normalized) ||
                    getValue(wellInfoObj?.api_number_normalized) ||
                    (rawApiNumber ? normalizeApiNumber(rawApiNumber) : null);
                    
  const rawWellName = getValue(firstWell?.well_name) ||
                      getValue(firstWell?.name) ||
                      getValue(wellInfoObj?.well_name) ||
                      getValue(wellInfoObj?.name) ||
                      getValue(extractedFields.well_name) ||
                      getValue(extractedFields.well) ||
                      getValue(extractedFields['Well Name']) ||
                      getValue(extractedFields.WELL) ||
                      getValue(extractedFields.well_number) ||
                      getValue(extractedFields.property_name);  // Division orders use property_name for well/lease name
  
  // Extract operator for better matching
  const operator = getValue(firstWell?.operator) ||
                   getValue(wellInfoObj?.operator) ||
                   getValue(extractedFields.operator) ||
                   getValue(extractedFields.Operator) ||
                   getValue(extractedFields.OPERATOR) ||
                   getValue(extractedFields.applicant) || // Sometimes operator is listed as applicant
                   null;
  
  // Extract offset wells and unit name for additional matching
  const offsetWells = extractedFields.offset_wells;
  const unitName = getValue(extractedFields.unit_name);

  if (Array.isArray(offsetWells) && offsetWells.length > 0) {
    console.log(`[LinkDocuments] Found ${offsetWells.length} offset wells in extracted data`);
  }
  if (unitName) {
    console.log(`[LinkDocuments] Found unit name: "${unitName}"`);
  }

  // Log well information for debugging
  if (wellsList && Array.isArray(wellsList)) {
    console.log(`[LinkDocuments] Wells array found with ${wellsList.length} wells`);
    if (firstWell) {
      console.log(`[LinkDocuments] First well in array:`, JSON.stringify(firstWell));
    }
  }
  if (wellInfoObj && typeof wellInfoObj === 'object' && !Array.isArray(wellInfoObj)) {
    console.log(`[LinkDocuments] Well information object found:`, JSON.stringify(wellInfoObj));
  }
  if (rawWellName || apiNumber || operator) {
    console.log(`[LinkDocuments] Well data - Name: '${rawWellName}', API: '${apiNumber}', Operator: '${operator}'`);
  }
  
  // Priority 1: API Number (exact match)
  if (apiNumber) {
    try {
      console.log(`[LinkDocuments] Searching for well by API: ${apiNumber}`);
      const well = await db.prepare(`
        SELECT airtable_record_id as id FROM wells WHERE api_number = ? LIMIT 1
      `).bind(apiNumber).first();
      
      if (well) {
        wellId = well.id as string;
        console.log(`[LinkDocuments] Found matching well by API: ${wellId}`);
      } else {
        console.log(`[LinkDocuments] No well found with API: ${apiNumber}`);
      }
    } catch (error) {
      console.error(`[LinkDocuments] Error matching well by API:`, error);
    }
  }
  
  // Priority 2: Smart matching (name + location)
  if (!wellId && rawWellName) {
    try {
      // Normalize well name
      const wellName = normalizeWellName(rawWellName);
      const baseName = wellName ? extractBaseName(wellName) : null;
      const nameVariations = wellName ? createNameVariations(wellName) : [];
      
      console.log(`[LinkDocuments] Smart well matching for: "${wellName}"`);
      console.log(`[LinkDocuments] Base name: "${baseName}", Variations:`, nameVariations);
      
      // Strategy 1: Name + Full Location (most specific)
      // Operator matching removed - well name + location is sufficient for confident match
      if (section && township && range) {
        console.log(`[LinkDocuments] Strategy 1: Name + Section + T-R (operator-agnostic)`);
        
        // Build query with name variations
        const placeholders = nameVariations.map((_, i) => `?`).join(',');
        const query1 = `
          SELECT airtable_record_id as id, well_name, operator, section, township, range
          FROM wells 
          WHERE (
            UPPER(well_name) IN (${nameVariations.map(() => 'UPPER(?)').join(',')})
            OR UPPER(well_name) LIKE UPPER(?)
            OR (well_name || ' ' || COALESCE(well_number, '')) LIKE ?
          )
          AND CAST(section AS INTEGER) = CAST(? AS INTEGER)
          AND CAST(REPLACE(REPLACE(UPPER(township), 'N', ''), 'S', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'N', ''), 'S', '') AS INTEGER)
          AND SUBSTR(UPPER(township), -1) = SUBSTR(UPPER(?), -1)
          AND CAST(REPLACE(REPLACE(UPPER(range), 'E', ''), 'W', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'E', ''), 'W', '') AS INTEGER)
          AND SUBSTR(UPPER(range), -1) = SUBSTR(UPPER(?), -1)
          ${meridian ? 'AND (meridian = ? OR meridian IS NULL)' : ''}
          ORDER BY well_status = 'AC' DESC
          LIMIT 1
        `;
        
        const params1 = [
          ...nameVariations,
          `%${baseName || wellName}%`,
          `%${wellName}%`,
          section,
          township,
          township,
          range,
          range
        ];
        if (meridian) params1.push(meridian);
        
        console.log(`[LinkDocuments] Well Strategy 1 SQL query:\n${query1}`);
        console.log(`[LinkDocuments] Well Strategy 1 parameters:`, params1);
        
        const well = await db.prepare(query1).bind(...params1).first();
        if (well) {
          wellId = well.id as string;
          console.log(`[LinkDocuments] Found well by Strategy 1: ${well.well_name} (${wellId})`);
        }
      }
      
      // Strategy 2: Name + T-R (no section - handles horizontal wells)
      if (!wellId && township && range) {
        console.log(`[LinkDocuments] Strategy 2: Name + T-R (no section)`);
        
        const query2 = `
          SELECT airtable_record_id as id, well_name, operator, section, township, range
          FROM wells 
          WHERE (
            UPPER(well_name) IN (${nameVariations.map(() => 'UPPER(?)').join(',')})
            OR UPPER(well_name) LIKE UPPER(?)
            OR (well_name || ' ' || COALESCE(well_number, '')) LIKE ?
          )
          AND CAST(REPLACE(REPLACE(UPPER(township), 'N', ''), 'S', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'N', ''), 'S', '') AS INTEGER)
          AND SUBSTR(UPPER(township), -1) = SUBSTR(UPPER(?), -1)
          AND CAST(REPLACE(REPLACE(UPPER(range), 'E', ''), 'W', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'E', ''), 'W', '') AS INTEGER)
          AND SUBSTR(UPPER(range), -1) = SUBSTR(UPPER(?), -1)
          ${meridian ? 'AND (meridian = ? OR meridian IS NULL)' : ''}
          ${operator ? 'AND UPPER(operator) LIKE UPPER(?)' : ''}
          ORDER BY ${section ? 'CAST(section AS INTEGER) = CAST(? AS INTEGER) DESC,' : ''} well_status = 'AC' DESC
          LIMIT 1
        `;
        
        const params2 = [
          ...nameVariations,
          `%${baseName || wellName}%`,
          `%${wellName}%`,
          township,
          township,
          range,
          range
        ];
        if (meridian) params2.push(meridian);
        if (operator) params2.push(`%${operator}%`);
        if (section) params2.push(section);
        
        console.log(`[LinkDocuments] Well Strategy 2 SQL query:\n${query2}`);
        console.log(`[LinkDocuments] Well Strategy 2 parameters:`, params2);
        
        const well = await db.prepare(query2).bind(...params2).first();
        if (well) {
          wellId = well.id as string;
          console.log(`[LinkDocuments] Found well by Strategy 2: ${well.well_name} (${wellId})`);
        }
      }
      
      // Strategy 3: Name only (broadest search)
      if (!wellId) {
        console.log(`[LinkDocuments] Strategy 3: Name only`);
        
        const query3 = `
          SELECT airtable_record_id as id, well_name, operator, section, township, range
          FROM wells 
          WHERE (
            UPPER(well_name) IN (${nameVariations.map(() => 'UPPER(?)').join(',')})
            OR UPPER(well_name) LIKE UPPER(?)
            OR UPPER(well_name) LIKE UPPER(?)
          )
          ${operator ? 'AND UPPER(operator) LIKE UPPER(?)' : ''}
          ORDER BY well_status = 'AC' DESC
          LIMIT 1
        `;
        
        const params3 = [
          ...nameVariations,
          `%${baseName || wellName}%`,
          `%${wellName}%`
        ];
        if (operator) params3.push(`%${operator}%`);
        
        console.log(`[LinkDocuments] Well Strategy 3 SQL query:\n${query3}`);
        console.log(`[LinkDocuments] Well Strategy 3 parameters:`, params3);
        
        const well = await db.prepare(query3).bind(...params3).first();
        if (well) {
          wellId = well.id as string;
          console.log(`[LinkDocuments] Found well by Strategy 3: ${well.well_name} (${wellId})`);
          console.log(`[LinkDocuments] Location: S${well.section}-T${well.township}-R${well.range}`);
        }
      }

      // Strategy 4: Check user's Client Wells table (Airtable-synced)
      // This handles cases where the well exists in the user's tracked wells but not in statewide data
      if (!wellId && (documentUserId || documentOrgId)) {
        console.log(`[LinkDocuments] Strategy 4: Checking client_wells for user ${documentUserId} / org ${documentOrgId}`);

        const query4 = `
          SELECT airtable_id as id, well_name, operator, section, township, range_val as range
          FROM client_wells
          WHERE (user_id = ? OR organization_id = ?)
          AND (
            UPPER(well_name) IN (${nameVariations.map(() => 'UPPER(?)').join(',')})
            OR UPPER(well_name) LIKE UPPER(?)
            OR UPPER(well_name) LIKE UPPER(?)
          )
          ${section && township && range ? `
            AND (
              section IS NULL OR section = '' OR
              (CAST(section AS INTEGER) = CAST(? AS INTEGER)
               AND UPPER(township) LIKE UPPER(?))
            )
          ` : ''}
          ORDER BY well_status = 'AC' DESC
          LIMIT 1
        `;

        const params4 = [
          documentUserId || '',
          documentOrgId || '',
          ...nameVariations,
          `%${baseName || wellName}%`,
          `%${wellName}%`
        ];
        if (section && township && range) {
          params4.push(section);
          params4.push(`%${township}%`);
        }

        console.log(`[LinkDocuments] Client wells query for user/org:`, documentUserId, documentOrgId);
        console.log(`[LinkDocuments] Name variations:`, nameVariations);

        const clientWell = await db.prepare(query4).bind(...params4).first();
        if (clientWell) {
          wellId = clientWell.id as string;
          console.log(`[LinkDocuments] Found CLIENT WELL by Strategy 4: ${clientWell.well_name} (${wellId})`);
          console.log(`[LinkDocuments] Location: S${clientWell.section}-T${clientWell.township}-R${clientWell.range}`);
        } else {
          console.log(`[LinkDocuments] No well match found in client_wells`);
        }
      }

      if (!wellId) {
        console.log(`[LinkDocuments] No well match found after all strategies (including client_wells)`);
      }
    } catch (error) {
      console.error(`[LinkDocuments] Error in smart well matching:`, error);
    }
  }
  
  // Multi-well matching for check stubs: iterate ALL wells in the array, not just wells[0]
  const docType = getValue(extractedFields.doc_type);
  if (docType === 'check_stub' && Array.isArray(wellsList) && wellsList.length > 1) {
    console.log(`[LinkDocuments] Check stub multi-well matching: ${wellsList.length} wells`);
    // wells[0] was already matched above as the primary well. Now match wells[1..N].
    for (let i = 1; i < wellsList.length; i++) {
      const w = wellsList[i];
      if (!w || typeof w !== 'object') continue;

      // Try API match first
      const wApi = getValue(w.api_number) || getValue(w.api);
      const wApiNorm = wApi ? normalizeApiNumber(wApi) : null;
      if (wApiNorm) {
        try {
          const found = await db.prepare(
            `SELECT airtable_record_id as id FROM wells WHERE api_number = ? LIMIT 1`
          ).bind(wApiNorm).first();
          if (found) {
            const extraId = found.id as string;
            if (extraId !== wellId) {
              console.log(`[LinkDocuments] Check stub well[${i}] matched by API: ${extraId}`);
              // Store for aggregation below
              if (!wellId) { wellId = extraId; } // promote if primary was null
              else { (wellsList as any).__extraWellIds = (wellsList as any).__extraWellIds || []; (wellsList as any).__extraWellIds.push(extraId); }
            }
            continue;
          }
        } catch (err) {
          console.error(`[LinkDocuments] Error matching check stub well[${i}] by API:`, err);
        }
      }

      // Fall back to name match (simple — name + user ownership)
      const wName = getValue(w.well_name) || getValue(w.name);
      if (wName && (documentUserId || documentOrgId)) {
        try {
          const normName = normalizeWellName(wName);
          const baseName = normName ? extractBaseName(normName) : null;
          const found = await db.prepare(`
            SELECT airtable_id as id FROM client_wells
            WHERE (user_id = ? OR organization_id = ?)
            AND (UPPER(well_name) = UPPER(?) OR UPPER(well_name) LIKE UPPER(?))
            LIMIT 1
          `).bind(
            documentUserId || '', documentOrgId || '',
            normName || wName, `%${baseName || normName || wName}%`
          ).first();
          if (found) {
            const extraId = found.id as string;
            if (extraId !== wellId) {
              console.log(`[LinkDocuments] Check stub well[${i}] matched by name in client_wells: ${extraId}`);
              if (!wellId) { wellId = extraId; }
              else { (wellsList as any).__extraWellIds = (wellsList as any).__extraWellIds || []; (wellsList as any).__extraWellIds.push(extraId); }
            }
          }
        } catch (err) {
          console.error(`[LinkDocuments] Error matching check stub well[${i}] by name:`, err);
        }
      }
    }
  }

  // Build combined well ID list: primary + check stub extra wells + offset wells + unit name matches
  const allWellIds: string[] = [];

  // Primary well first (highest confidence — from existing cascade)
  if (wellId) {
    allWellIds.push(wellId);
  }

  // Additional wells from check stub multi-well matching
  if (Array.isArray((wellsList as any)?.__extraWellIds)) {
    for (const id of (wellsList as any).__extraWellIds) {
      if (!allWellIds.includes(id)) {
        allWellIds.push(id);
      }
    }
  }

  // Offset wells matching (API-based, high confidence)
  if (Array.isArray(offsetWells) && offsetWells.length > 0) {
    try {
      const offsetIds = await matchOffsetWells(db, offsetWells, documentUserId, documentOrgId);
      for (const id of offsetIds) {
        if (!allWellIds.includes(id)) {
          allWellIds.push(id);
        }
      }
    } catch (error) {
      console.error(`[LinkDocuments] Error in offset wells matching:`, error);
    }
  }

  // Unit name matching (name + T/R cross-check, lower confidence)
  if (unitName && typeof unitName === 'string' && unitName.trim().length >= 3) {
    try {
      const unitIds = await matchUnitNameWells(
        db, unitName.trim(), township, range, documentUserId, documentOrgId
      );
      for (const id of unitIds) {
        if (!allWellIds.includes(id)) {
          allWellIds.push(id);
        }
      }
    } catch (error) {
      console.error(`[LinkDocuments] Error in unit name matching:`, error);
    }
  }

  const finalWellId = allWellIds.length > 0 ? allWellIds.join(',') : null;

  console.log(`[LinkDocuments] Final well IDs: ${allWellIds.length} total (primary: ${wellId ? 1 : 0}, offset input: ${Array.isArray(offsetWells) ? offsetWells.length : 0}, unit: ${unitName || 'none'})`);

  // Update document with links
  if (propertyId || finalWellId) {
    try {
      await db.prepare(`
        UPDATE documents
        SET property_id = ?,
            well_id = ?
        WHERE id = ?
      `).bind(propertyId, finalWellId, documentId).run();

      console.log(`[LinkDocuments] Updated document ${documentId} with property_id: ${propertyId}, well_id: ${finalWellId}`);
    } catch (error) {
      console.error(`[LinkDocuments] Error updating document links:`, error);
    }
  } else {
    console.log(`[LinkDocuments] No matches found for document ${documentId}`);
  }

  return { propertyId, wellId: finalWellId };
}

// Function to ensure link columns exist in documents table
export async function ensureLinkColumns(db: D1Database): Promise<void> {
  const columnsToAdd = [
    { name: 'property_id', type: 'TEXT' },
    { name: 'well_id', type: 'TEXT' }
  ];

  for (const column of columnsToAdd) {
    try {
      // Try to query the column
      await db.prepare(
        `SELECT ${column.name} FROM documents LIMIT 1`
      ).first();
      console.log(`[LinkDocuments] Column ${column.name} already exists`);
    } catch (error) {
      // Column doesn't exist, add it
      try {
        await db.prepare(
          `ALTER TABLE documents ADD COLUMN ${column.name} ${column.type}`
        ).run();
        console.log(`[LinkDocuments] Added column ${column.name}`);
      } catch (addError) {
        console.error(`[LinkDocuments] Error adding column ${column.name}:`, addError);
      }
    }
  }
  
  // Create indexes for better query performance
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_documents_well ON documents(well_id)`).run();
    console.log(`[LinkDocuments] Created indexes on property_id and well_id`);
  } catch (indexError) {
    console.error(`[LinkDocuments] Error creating indexes:`, indexError);
  }
}