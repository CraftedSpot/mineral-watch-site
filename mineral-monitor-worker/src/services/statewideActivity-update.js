// Temporary file to hold the update function that needs to be added to statewideActivity.js

/**
 * Update an existing statewide activity record with new data
 * @param {Object} env - Worker environment
 * @param {string} recordId - Airtable record ID
 * @param {Object} activityData - New activity data
 * @returns {Object} - Result of the update
 */
export async function updateStatewideActivity(env, recordId, activityData) {
  const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
  
  // Build update fields - only include non-empty values
  const updateFields = {};
  
  // Update basic fields if provided
  if (activityData.wellName) updateFields['Well Name'] = activityData.wellName;
  if (activityData.operator) updateFields['Operator'] = activityData.operator;
  if (activityData.formation) updateFields['Formation'] = activityData.formation;
  
  // Update coordinates if provided
  if (activityData.latitude !== undefined) updateFields['Latitude'] = activityData.latitude;
  if (activityData.longitude !== undefined) updateFields['Longitude'] = activityData.longitude;
  if (activityData.bhLatitude !== undefined) updateFields['BH Latitude'] = activityData.bhLatitude;
  if (activityData.bhLongitude !== undefined) updateFields['BH Longitude'] = activityData.bhLongitude;
  
  // Update BH location if provided
  if (activityData.bhSection) updateFields['BH Section'] = normalizeSection(activityData.bhSection);
  if (activityData.bhTownship) updateFields['BH Township'] = activityData.bhTownship;
  if (activityData.bhRange) updateFields['BH Range'] = activityData.bhRange;
  if (activityData.bhPM) updateFields['BH PM'] = activityData.bhPM;
  
  // Update activity flags
  if (activityData.activityType === 'Completion') {
    updateFields['Has Completion'] = true;
    if (activityData.completionDate) updateFields['Completion Date'] = activityData.completionDate;
  }
  
  // Update other fields
  if (activityData.isHorizontal !== undefined) updateFields['Is Horizontal'] = activityData.isHorizontal;
  if (activityData.mapLink) updateFields['OCC Map Link'] = activityData.mapLink;
  
  try {
    const updateUrl = `${AIRTABLE_API_BASE}/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_STATEWIDE_ACTIVITY_TABLE}/${recordId}`;
    
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: updateFields })
    });
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`[Statewide] Update failed for ${recordId}:`, errorText);
      return { success: false, error: errorText };
    }
    
    const result = await updateResponse.json();
    return { success: true, action: 'updated', id: result.id };
  } catch (err) {
    console.error(`[Statewide] Update error for ${recordId}:`, err);
    return { success: false, error: err.message };
  }
}

// Helper function - copy from main file
function normalizeSection(section) {
  if (!section) return null;
  return String(section).padStart(2, '0');
}