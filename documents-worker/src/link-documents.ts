import type { D1Database } from '@cloudflare/workers-types';

// Normalize section (strip leading zeros)
const normalizeSection = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const parsed = parseInt(s, 10);
  return isNaN(parsed) ? null : String(parsed);
};

// Normalize township/range (ensure suffix, handle missing, pad with zeros)
const normalizeTownship = (t: string | null | undefined): string | null => {
  if (!t) return null;
  // Remove all non-digits to get the number part
  const num = t.replace(/[^\d]/g, '');
  if (!num) return null;
  
  // Pad number to 2 digits with leading zero
  const paddedNum = num.padStart(2, '0');
  
  // Look for direction (N/S), default to N if missing
  const dir = t.match(/[NSns]/)?.[0]?.toUpperCase() || 'N';
  return `${paddedNum}${dir}`;
};

const normalizeRange = (r: string | null | undefined): string | null => {
  if (!r) return null;
  // Remove all non-digits to get the number part
  const num = r.replace(/[^\d]/g, '');
  if (!num) return null;
  
  // Pad number to 2 digits with leading zero
  const paddedNum = num.padStart(2, '0');
  
  // Look for direction (E/W), default to W if missing
  const dir = r.match(/[EWew]/)?.[0]?.toUpperCase() || 'W';
  return `${paddedNum}${dir}`;
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

// Function to link documents to properties and wells
export async function linkDocumentToEntities(
  db: D1Database,
  documentId: string,
  extractedFields: Record<string, any>
): Promise<{ propertyId: string | null; wellId: string | null }> {
  let propertyId: string | null = null;
  let wellId: string | null = null;
  
  // Extract legal description from document
  // Handle both nested (with .value) and flat structures
  const getValue = (field: any): any => {
    return field?.value !== undefined ? field.value : field;
  };
  
  // Check if legal description is nested in an object
  const legalDescObj = getValue(extractedFields.legal_description);
  
  // Extract from nested legal_description object first, then fallback to top-level fields
  const rawSection = getValue(legalDescObj?.section) ||
                     getValue(extractedFields.section) || 
                     getValue(extractedFields.legal_section) || 
                     getValue(extractedFields.Section) ||
                     getValue(extractedFields.SEC) ||
                     getValue(extractedFields.sec);
                  
  const rawTownship = getValue(legalDescObj?.township) ||
                      getValue(extractedFields.township) || 
                      getValue(extractedFields.legal_township) || 
                      getValue(extractedFields.Township) ||
                      getValue(extractedFields.TWN) ||
                      getValue(extractedFields.twn) ||
                      getValue(extractedFields.TWP);
                   
  const rawRange = getValue(legalDescObj?.range) ||
                   getValue(extractedFields.range) || 
                   getValue(extractedFields.legal_range) || 
                   getValue(extractedFields.Range) ||
                   getValue(extractedFields.RNG) ||
                   getValue(extractedFields.rng);
                
  const county = getValue(legalDescObj?.county) ||
                 getValue(extractedFields.county) || 
                 getValue(extractedFields.County) ||
                 getValue(extractedFields.COUNTY) ||
                 getValue(extractedFields.recording_county);
                 
  const meridian = getValue(legalDescObj?.meridian) ||
                   getValue(extractedFields.meridian) || 
                   getValue(extractedFields.Meridian) ||
                   getValue(extractedFields.MERIDIAN) ||
                   getValue(extractedFields.MER);
  
  // Normalize the values
  const section = normalizeSection(rawSection);
  const township = normalizeTownship(rawTownship);
  const range = normalizeRange(rawRange);
  
  console.log(`[LinkDocuments] Attempting to link document ${documentId}`);
  if (legalDescObj && typeof legalDescObj === 'object') {
    console.log(`[LinkDocuments] Legal description object found:`, JSON.stringify(legalDescObj));
  }
  console.log(`[LinkDocuments] Raw values: Section '${rawSection}', Township '${rawTownship}', Range '${rawRange}', County '${county}'`);
  console.log(`[LinkDocuments] Normalized: Section '${section}', Township '${township}', Range '${range}', County '${county}', Meridian '${meridian}'`);
  
  // Match property by legal description
  if (section && township && range && county) {
    try {
      const property = await db.prepare(`
        SELECT id FROM properties 
        WHERE CAST(section AS INTEGER) = CAST(? AS INTEGER) 
          AND CAST(REPLACE(REPLACE(UPPER(township), 'N', ''), 'S', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'N', ''), 'S', '') AS INTEGER)
          AND SUBSTR(UPPER(township), -1) = SUBSTR(UPPER(?), -1)
          AND CAST(REPLACE(REPLACE(UPPER(range), 'E', ''), 'W', '') AS INTEGER) = CAST(REPLACE(REPLACE(UPPER(?), 'E', ''), 'W', '') AS INTEGER)
          AND SUBSTR(UPPER(range), -1) = SUBSTR(UPPER(?), -1)
          AND LOWER(county) = LOWER(?)
          AND (meridian = ? OR meridian IS NULL OR ? IS NULL)
        LIMIT 1
      `).bind(section, township, township, range, range, county, meridian, meridian).first();
      
      if (property) {
        propertyId = property.id as string;
        console.log(`[LinkDocuments] Found matching property: ${propertyId}`);
      } else {
        console.log(`[LinkDocuments] No property match found for legal description`);
      }
    } catch (error) {
      console.error(`[LinkDocuments] Error matching property:`, error);
    }
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
  const apiNumber = getValue(firstWell?.api_number) ||
                    getValue(firstWell?.api) ||
                    getValue(wellInfoObj?.api_number) ||
                    getValue(wellInfoObj?.api) ||
                    getValue(extractedFields.api_number) || 
                    getValue(extractedFields.api) ||
                    getValue(extractedFields.API) ||
                    getValue(extractedFields['API Number']) ||
                    getValue(extractedFields.api_no);
                    
  const rawWellName = getValue(firstWell?.well_name) ||
                      getValue(firstWell?.name) ||
                      getValue(wellInfoObj?.well_name) ||
                      getValue(wellInfoObj?.name) ||
                      getValue(extractedFields.well_name) || 
                      getValue(extractedFields.well) ||
                      getValue(extractedFields['Well Name']) ||
                      getValue(extractedFields.WELL) ||
                      getValue(extractedFields.well_number);
  
  // Extract operator for better matching
  const operator = getValue(firstWell?.operator) ||
                   getValue(wellInfoObj?.operator) ||
                   getValue(extractedFields.operator) ||
                   getValue(extractedFields.Operator) ||
                   getValue(extractedFields.OPERATOR) ||
                   getValue(extractedFields.applicant); // Sometimes operator is listed as applicant
  
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
        SELECT id FROM wells WHERE api_number = ? LIMIT 1
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
      if (section && township && range) {
        console.log(`[LinkDocuments] Strategy 1: Name + Section + T-R`);
        
        // Build query with name variations
        const placeholders = nameVariations.map((_, i) => `?`).join(',');
        const query1 = `
          SELECT id, well_name, operator, section, township, range
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
          ${operator ? 'AND UPPER(operator) LIKE UPPER(?)' : ''}
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
        if (operator) params1.push(`%${operator}%`);
        
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
          SELECT id, well_name, operator, section, township, range
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
          SELECT id, well_name, operator, section, township, range
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
        
        const well = await db.prepare(query3).bind(...params3).first();
        if (well) {
          wellId = well.id as string;
          console.log(`[LinkDocuments] Found well by Strategy 3: ${well.well_name} (${wellId})`);
          console.log(`[LinkDocuments] Location: S${well.section}-T${well.township}-R${well.range}`);
        } else {
          console.log(`[LinkDocuments] No well match found after all strategies`);
        }
      }
    } catch (error) {
      console.error(`[LinkDocuments] Error in smart well matching:`, error);
    }
  }
  
  // Update document with links
  if (propertyId || wellId) {
    try {
      await db.prepare(`
        UPDATE documents 
        SET property_id = ?, 
            well_id = ? 
        WHERE id = ?
      `).bind(propertyId, wellId, documentId).run();
      
      console.log(`[LinkDocuments] Updated document ${documentId} with property_id: ${propertyId}, well_id: ${wellId}`);
    } catch (error) {
      console.error(`[LinkDocuments] Error updating document links:`, error);
    }
  } else {
    console.log(`[LinkDocuments] No matches found for document ${documentId}`);
  }
  
  return { propertyId, wellId };
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