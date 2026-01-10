import type { D1Database } from '@cloudflare/workers-types';

/**
 * Migrate existing document property_id and well_id from D1 integer IDs to Airtable record IDs
 */
export async function migrateDocumentIds(db: D1Database): Promise<void> {
  console.log('[MigrateDocumentIds] Starting migration of document IDs to Airtable format');
  
  try {
    // First, get all documents with property_id or well_id that are numeric (old format)
    const documentsToMigrate = await db.prepare(`
      SELECT id, property_id, well_id 
      FROM documents 
      WHERE (property_id IS NOT NULL AND property_id NOT LIKE 'rec%')
         OR (well_id IS NOT NULL AND well_id NOT LIKE 'rec%')
    `).all();
    
    console.log(`[MigrateDocumentIds] Found ${documentsToMigrate.results.length} documents to migrate`);
    
    let migratedCount = 0;
    let errorCount = 0;
    
    // Process each document
    for (const doc of documentsToMigrate.results) {
      try {
        let newPropertyId = null;
        let newWellId = null;
        
        // Convert property_id from integer to airtable_record_id
        if (doc.property_id && !doc.property_id.startsWith('rec')) {
          const property = await db.prepare(`
            SELECT airtable_record_id 
            FROM properties 
            WHERE id = ?
          `).bind(doc.property_id).first();
          
          if (property?.airtable_record_id) {
            newPropertyId = property.airtable_record_id;
            console.log(`[MigrateDocumentIds] Document ${doc.id}: property_id ${doc.property_id} -> ${newPropertyId}`);
          } else {
            console.warn(`[MigrateDocumentIds] Document ${doc.id}: No property found with id ${doc.property_id}`);
            // Clear the invalid property_id so it won't be attempted again
            newPropertyId = '';
          }
        }
        
        // Convert well_id from integer to airtable_record_id
        if (doc.well_id && !doc.well_id.startsWith('rec')) {
          const well = await db.prepare(`
            SELECT airtable_record_id 
            FROM wells 
            WHERE id = ? OR id = CAST(? AS INTEGER)
          `).bind(doc.well_id, doc.well_id.replace('.0', '')).first();
          
          if (well?.airtable_record_id) {
            newWellId = well.airtable_record_id;
            console.log(`[MigrateDocumentIds] Document ${doc.id}: well_id ${doc.well_id} -> ${newWellId}`);
          } else {
            console.warn(`[MigrateDocumentIds] Document ${doc.id}: No well found with id ${doc.well_id}`);
            // Clear the invalid well_id so it won't be attempted again
            newWellId = '';
          }
        }
        
        // Update document if we found new IDs
        if (newPropertyId !== null || newWellId !== null) {
          await db.prepare(`
            UPDATE documents 
            SET property_id = COALESCE(?, property_id),
                well_id = COALESCE(?, well_id)
            WHERE id = ?
          `).bind(newPropertyId, newWellId, doc.id).run();
          
          migratedCount++;
          console.log(`[MigrateDocumentIds] Updated document ${doc.id}`);
        }
      } catch (error) {
        console.error(`[MigrateDocumentIds] Error migrating document ${doc.id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`[MigrateDocumentIds] Migration complete. Migrated: ${migratedCount}, Errors: ${errorCount}`);
    
    // Log some statistics
    const stats = await db.prepare(`
      SELECT 
        COUNT(CASE WHEN property_id LIKE 'rec%' THEN 1 END) as properties_with_airtable_id,
        COUNT(CASE WHEN property_id IS NOT NULL AND property_id NOT LIKE 'rec%' THEN 1 END) as properties_with_old_id,
        COUNT(CASE WHEN well_id LIKE 'rec%' THEN 1 END) as wells_with_airtable_id,
        COUNT(CASE WHEN well_id IS NOT NULL AND well_id NOT LIKE 'rec%' THEN 1 END) as wells_with_old_id
      FROM documents
    `).first();
    
    console.log('[MigrateDocumentIds] Final statistics:', stats);
  } catch (error) {
    console.error('[MigrateDocumentIds] Migration failed:', error);
    throw error;
  }
}