import type { D1Database } from '@cloudflare/workers-types';

// Function to link documents to properties and wells
export async function linkDocumentToEntities(
  db: D1Database,
  documentId: string,
  extractedFields: Record<string, any>
): Promise<{ propertyId: string | null; wellId: string | null }> {
  let propertyId: string | null = null;
  let wellId: string | null = null;
  
  // Extract legal description from document
  // Handle various field naming conventions
  const section = extractedFields.section?.value || 
                  extractedFields.legal_section?.value || 
                  extractedFields.Section?.value ||
                  extractedFields.SEC?.value;
                  
  const township = extractedFields.township?.value || 
                   extractedFields.legal_township?.value || 
                   extractedFields.Township?.value ||
                   extractedFields.TWN?.value ||
                   extractedFields.TWP?.value;
                   
  const range = extractedFields.range?.value || 
                extractedFields.legal_range?.value || 
                extractedFields.Range?.value ||
                extractedFields.RNG?.value;
                
  const county = extractedFields.county?.value || 
                 extractedFields.County?.value ||
                 extractedFields.COUNTY?.value;
  
  console.log(`[LinkDocuments] Attempting to link document ${documentId}`);
  console.log(`[LinkDocuments] Legal description: Section ${section}, Township ${township}, Range ${range}, County ${county}`);
  
  // Match property by legal description
  if (section && township && range && county) {
    try {
      const property = await db.prepare(`
        SELECT id FROM properties 
        WHERE section = ? 
          AND township = ? 
          AND range = ? 
          AND LOWER(county) = LOWER(?)
        LIMIT 1
      `).bind(section, township, range, county).first();
      
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
  
  // Match well by API number or name (for well-related documents)
  const apiNumber = extractedFields.api_number?.value || 
                    extractedFields.api?.value ||
                    extractedFields.API?.value ||
                    extractedFields['API Number']?.value ||
                    extractedFields.api_no?.value;
                    
  const wellName = extractedFields.well_name?.value || 
                   extractedFields.well?.value ||
                   extractedFields['Well Name']?.value ||
                   extractedFields.WELL?.value ||
                   extractedFields.well_number?.value;
  
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
  } else if (wellName && !wellId) {
    try {
      // Fuzzy match on well name - try exact match first
      console.log(`[LinkDocuments] Searching for well by name: ${wellName}`);
      let well = await db.prepare(`
        SELECT id FROM wells WHERE well_name = ? LIMIT 1
      `).bind(wellName).first();
      
      // If no exact match, try partial match
      if (!well) {
        well = await db.prepare(`
          SELECT id FROM wells WHERE well_name LIKE ? LIMIT 1
        `).bind(`%${wellName}%`).first();
      }
      
      if (well) {
        wellId = well.id as string;
        console.log(`[LinkDocuments] Found matching well by name: ${wellId}`);
      } else {
        console.log(`[LinkDocuments] No well found with name like: ${wellName}`);
      }
    } catch (error) {
      console.error(`[LinkDocuments] Error matching well by name:`, error);
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