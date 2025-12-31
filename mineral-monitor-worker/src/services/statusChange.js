/**
 * Status Change Detection Service
 * Detects and alerts on well status changes during daily monitoring
 */

import { queryAirtable, createActivityLog } from './airtable.js';
import { sendAlertEmail } from './email.js';
import { normalizeAPI } from '../utils/normalize.js';
import { getCoordinatesWithFallback } from '../utils/coordinates.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';

/**
 * Check if a well's status has changed and alert users
 * @param {string} api10 - 10-digit API number
 * @param {Object} currentData - Current well data from OCC with wellstatus field
 * @param {Object} env - Worker environment
 * @returns {Object} - Result of status check
 */
export async function checkWellStatusChange(api10, currentData, env) {
  const result = {
    hasChange: false,
    previousStatus: null,
    currentStatus: null,
    alertsSent: 0,
    errors: []
  };

  try {
    // Get current status from OCC data
    const currentStatus = currentData?.wellstatus || null;
    if (!currentStatus) {
      return result; // No status to compare
    }
    
    result.currentStatus = currentStatus;

    // Find all users tracking this well (handles both individual users and organizations)
    const wellMatches = await findMatchingWells(api10, env);
    
    if (wellMatches.length === 0) {
      return result; // No users tracking this well
    }
    
    // Get the well data from the first match
    const well = wellMatches[0].well;
    const previousStatus = well.fields['Well Status'];
    
    if (!previousStatus) {
      return result; // No previous status to compare
    }
    
    result.previousStatus = previousStatus;
    
    // Check if status changed
    if (previousStatus !== currentStatus) {
      result.hasChange = true;
      console.log(`[Status Change] Well ${api10} changed from ${previousStatus} to ${currentStatus}`);
      console.log(`[Status Change] Found ${wellMatches.length} users to notify`);
      
      // Process status change alert for each user
      for (const match of wellMatches) {
        try {
          const user = match.user;
          const userName = user.name || user.email;
          
          // Try to get coordinates and map link with fallback system
          let mapLink = null;
          let coordinateSource = null;
          
          // Build a well record-like object for coordinate fallback
          const wellRecord = {
            API_Number: api10,
            Section: currentData.section || well.fields.Section,
            Township: currentData.township || well.fields.Township,
            Range: currentData.range || well.fields.Range,
            PM: currentData.pm || well.fields.PM || 'IM',
            County: currentData.county || well.fields.County
          };
          
          // Use coordinate fallback to ensure we have location data for alerts
          const coordResult = await getCoordinatesWithFallback(api10, wellRecord, env);
          if (coordResult.coordinates) {
            coordinateSource = coordResult.source;
            const mapWellData = coordResult.wellData || {
              sh_lat: coordResult.coordinates.latitude,
              sh_lon: coordResult.coordinates.longitude,
              well_name: well.fields['Well Name'] || `API ${api10}`,
              api: api10
            };
            
            // Ensure coordinates are in the wellData
            if (!mapWellData.sh_lat || !mapWellData.sh_lon) {
              mapWellData.sh_lat = coordResult.coordinates.latitude;
              mapWellData.sh_lon = coordResult.coordinates.longitude;
            }
            
            mapLink = getMapLinkFromWellData(mapWellData);
            console.log(`[Status Change] Using ${coordinateSource} coordinates for status change alert ${api10}`);
          } else {
            console.log(`[Status Change] WARNING: No coordinates available for ${api10} - using fallback OCC link`);
          }
          
          // Create activity log
          const activityData = {
            userId: user.id,
            apiNumber: api10,
            activityType: 'Status Change',
            alertLevel: match.alertLevel || 'STATUS CHANGE',
            previousValue: previousStatus,
            newValue: currentStatus,
            wellName: well.fields['Well Name'] || `API ${api10}`,
            operator: well.fields.Operator || currentData.operator || 'Unknown',
            notes: `Well status changed from ${getStatusDescription(previousStatus)} to ${getStatusDescription(currentStatus)}`,
            mapLink: mapLink || "",
            coordinateSource: coordinateSource
          };
          
          const activityResult = await createActivityLog(env, activityData);
          
          if (!activityResult.success) {
            console.error(`[Status Change] Failed to create activity log: ${activityResult.error}`);
            result.errors.push(`Activity log failed: ${activityResult.error}`);
          }
          
          // Send alert email
          if (!env.DRY_RUN || env.DRY_RUN === 'false') {
            try {
              await sendAlertEmail(env, {
                to: user.fields.Email,
                subject: `Well Status Change Alert - ${well.fields['Well Name'] || api10}`,
                userName: userName,
                wellName: well.fields['Well Name'] || `API ${api10}`,
                apiNumber: api10,
                activityType: 'Status Change',
                alertLevel: 'STATUS CHANGE',
                operator: well.fields.Operator || 'Unknown',
                county: currentData.county || 'Unknown',
                section: currentData.section || '',
                township: currentData.township || '',
                range: currentData.range || '',
                statusChange: {
                  previous: getStatusDescription(previousStatus),
                  current: getStatusDescription(currentStatus)
                },
                mapLink: mapLink,
                occLink: `https://imaging.occ.ok.gov/OG/Well/${api10.substring(2)}.pdf`
              });
              
              result.alertsSent++;
              console.log(`[Status Change] Alert sent to ${user.fields.Email} for well ${api10}`);
            } catch (emailErr) {
              console.error(`[Status Change] Failed to send email: ${emailErr.message}`);
              result.errors.push(`Email failed: ${emailErr.message}`);
            }
          }
        }
        
        // Update well record with new status
        const updateUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_WELLS_TABLE)}/${well.id}`;
        const updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              'Well Status': currentStatus,
              'Last Status Check': new Date().toISOString(),
              'Status Last Changed': new Date().toISOString()
            }
          })
        });
        
        if (!updateResponse.ok) {
          console.error(`[Status Change] Failed to update well status in Airtable`);
          result.errors.push('Failed to update well record');
        }
      }
    }
    
  } catch (err) {
    console.error(`[Status Change] Error checking status for ${api10}:`, err);
    result.errors.push(err.message);
  }
  
  return result;
}

/**
 * Get human-readable status description
 */
export function getStatusDescription(status) {
  const statusDescriptions = {
    'AC': 'Active',
    'SI': 'Shut In',
    'PA': 'Plugged & Abandoned',
    'TA': 'Temporarily Abandoned',
    'DG': 'Drilling',
    'WO': 'Waiting on Completion',
    'ND': 'Never Drilled',
    'LA': 'Location Abandoned',
    'UC': 'Under Construction',
    'CM': 'Completed',
    'PR': 'Producing'
  };
  
  return statusDescriptions[status] || status;
}