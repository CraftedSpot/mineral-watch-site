/**
 * RBDMS Bulk Status Monitoring Service
 * Downloads complete RBDMS well dataset and checks for status changes
 * in user-tracked wells only
 */

import { createActivityLog, userWantsAlert, getUserById } from './airtable.js';
import { sendAlertEmail } from './email.js';
import { getStatusDescription } from './statusChange.js';
import { normalizeAPI } from '../utils/normalize.js';
import { getCoordinatesWithFallback } from '../utils/coordinates.js';
import { getMapLinkFromWellData } from '../utils/mapLink.js';
import { getOCCWellRecordsLink } from '../utils/occLink.js';
import { findMatchingWells } from './matching.js';

const RBDMS_CSV_URL = 'https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/rbdms-wells.csv';
const CACHE_KEY = 'rbdms-last-modified';

/**
 * Download and parse RBDMS CSV file
 * @param {Object} env - Worker environment
 * @returns {Map} - Map of API number to well data
 */
async function downloadRBDMSData(env) {
  console.log('[RBDMS] Downloading complete well dataset...');
  const startTime = Date.now();
  
  try {
    // Check if file was modified since last download
    const lastModified = await env.MINERAL_CACHE.get(CACHE_KEY);
    console.log(`[RBDMS] Last-Modified cache: ${lastModified || 'not set'}`);
    
    const headers = {
      'User-Agent': 'MineralWatch/2.0',
      ...(lastModified && { 'If-Modified-Since': lastModified })
    };
    console.log(`[RBDMS] Fetching from ${RBDMS_CSV_URL}`);
    
    const response = await fetch(RBDMS_CSV_URL, { headers });
    console.log(`[RBDMS] Response status: ${response.status}`);
    
    // If not modified, return null to skip processing
    if (response.status === 304 && lastModified) {
      console.log('[RBDMS] File not modified since last check (304 status)');
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to download RBDMS data: ${response.status}`);
    }
    
    // Store last-modified header
    const newLastModified = response.headers.get('Last-Modified');
    if (newLastModified) {
      await env.MINERAL_CACHE.put(CACHE_KEY, newLastModified, {
        expirationTtl: 7 * 24 * 60 * 60 // 7 days
      });
    }
    
    // Parse CSV
    const text = await response.text();
    const downloadTime = Date.now() - startTime;
    console.log(`[RBDMS] Downloaded ${(text.length / 1024 / 1024).toFixed(1)}MB in ${downloadTime}ms`);
    
    // Parse CSV into Map for fast lookups
    const wellMap = new Map();
    const lines = text.split('\n');
    const csvHeaders = lines[0].split(',').map(h => h.trim());
    
    // Log all available CSV headers
    console.log(`[RBDMS] CSV Headers (${csvHeaders.length} columns):`);
    csvHeaders.forEach((header, index) => {
      console.log(`[RBDMS]   Column ${index}: "${header}"`);
    });
    
    // Check for pooling unit related columns
    const punRelatedHeaders = csvHeaders.filter(h => 
      h.toLowerCase().includes('pun') || 
      h.toLowerCase().includes('pool') || 
      h.toLowerCase().includes('unit') ||
      h.toLowerCase().includes('spacing')
    );
    if (punRelatedHeaders.length > 0) {
      console.log(`[RBDMS] Found potential pooling unit related columns: ${punRelatedHeaders.join(', ')}`);
    } else {
      console.log(`[RBDMS] No pooling unit related columns found`);
    }
    
    // Find important column indices
    const apiIndex = csvHeaders.findIndex(h => h.toLowerCase().includes('api'));
    const statusIndex = csvHeaders.findIndex(h => h.toLowerCase().includes('wellstatus') || h.toLowerCase() === 'status');
    const operatorIndex = csvHeaders.findIndex(h => h.toLowerCase().includes('operator'));
    
    console.log(`[RBDMS] Key column indices: API=${apiIndex}, Status=${statusIndex}, Operator=${operatorIndex}`);
    console.log(`[RBDMS] Parsing ${lines.length - 1} wells...`);
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = parseCSVLine(lines[i]);
      if (values.length < csvHeaders.length) continue;
      
      const api = normalizeAPI(values[apiIndex]);
      if (!api) continue;
      
      wellMap.set(api, {
        wellstatus: values[statusIndex]?.trim() || '',
        operator: values[operatorIndex]?.trim() || '',
        // Add other fields as needed
      });
    }
    
    console.log(`[RBDMS] Parsed ${wellMap.size} wells in ${Date.now() - startTime}ms total`);
    return wellMap;
    
  } catch (error) {
    console.error('[RBDMS] Download failed:', error);
    throw error;
  }
}

/**
 * Parse CSV line handling quoted values
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Check all user-tracked wells for status changes
 * @param {Object} env - Worker environment
 * @param {Object} options - Options for test mode
 * @returns {Object} - Results of status check
 */
export async function checkAllWellStatuses(env, options = {}) {
  const results = {
    wellsChecked: 0,
    statusChanges: 0,
    alertsSent: 0,
    errors: []
  };
  
  try {
    // Test mode: simulate a status change for a specific API
    if (options.testStatusChangeApi) {
      console.log(`[RBDMS] TEST MODE: Simulating status change for API ${options.testStatusChangeApi}`);
      const testResults = await simulateStatusChange(env, options.testStatusChangeApi, options.testNewStatus || 'IA');
      return testResults;
    }
    
    // Download RBDMS data
    console.log('[RBDMS] Starting RBDMS data download...');
    let rbdmsData;
    try {
      rbdmsData = await downloadRBDMSData(env);
    } catch (downloadError) {
      console.error('[RBDMS] Download failed:', downloadError.message);
      results.errors.push(`RBDMS download failed: ${downloadError.message}`);
      return results;
    }
    
    // If no new data, skip processing
    if (!rbdmsData) {
      console.log('[RBDMS] Skipping - no new data (file not modified since last check)');
      results.errors.push('RBDMS file not modified since last download');
      return results;
    }
    
    console.log(`[RBDMS] RBDMS data loaded with ${rbdmsData.size} wells`);
    
    // Get all tracked wells from D1
    let allTrackedWells = [];

    try {
      if (!env.WELLS_DB) throw new Error('D1 not available');
      const { results: rows } = await env.WELLS_DB.prepare(`
        SELECT airtable_id, api_number, well_name, well_status, user_id, operator, organization_id, status
        FROM client_wells WHERE status = 'Active'
      `).all();
      // Transform D1 rows to Airtable record shape for compatibility
      allTrackedWells = (rows || []).map(r => ({
        id: r.airtable_id,
        fields: {
          'API Number': r.api_number,
          'Well Name': r.well_name,
          'Well Status': r.well_status,
          'User': r.user_id ? [r.user_id] : [],
          'Operator': r.operator,
          'Organization': r.organization_id ? [r.organization_id] : []
        }
      }));
    } catch (error) {
      console.error('[RBDMS] Failed to query tracked wells from D1:', error.message);
      results.errors.push(`D1 query failed: ${error.message}`);
      return results;
    }

    console.log(`[RBDMS] Found ${allTrackedWells.length} total wells in D1`);

    if (allTrackedWells.length === 0) {
      console.log('[RBDMS] No tracked wells found');
      return results;
    }
    
    console.log(`[RBDMS] Checking ${allTrackedWells.length} tracked wells...`);
    
    // Check each tracked well
    for (const well of allTrackedWells) {
      const api = normalizeAPI(well.fields['API Number']);
      if (!api) continue;
      
      results.wellsChecked++;
      
      // Look up current data in RBDMS
      const currentData = rbdmsData.get(api);
      if (!currentData) {
        console.log(`[RBDMS] Well ${api} not found in RBDMS data`);
        continue;
      }
      
      // Debug: Log first few wells to see the comparison
      if (results.wellsChecked <= 5 || well.fields['Well Status'] !== currentData.wellstatus) {
        console.log(`[RBDMS] Well ${api}: Airtable='${well.fields['Well Status']}', RBDMS='${currentData.wellstatus}'`);
      }
      
      // Direct comparison - Airtable vs RBDMS
      const airtableStatus = well.fields['Well Status'];
      const rbdmsStatus = currentData.wellstatus;
      
      if (airtableStatus && rbdmsStatus && airtableStatus !== rbdmsStatus) {
        results.statusChanges++;
        console.log(`[RBDMS] Status mismatch for ${api}: Airtable='${airtableStatus}' but RBDMS='${rbdmsStatus}'`);
        
        // Get user information
        const userIds = well.fields.User;
        if (!userIds || userIds.length === 0) {
          console.log(`[RBDMS] No users linked to well ${api}, skipping alert`);
          continue;
        }
        
        // Process status change alert
        try {
          // Get user details from D1
          const user = await getUserById(env, userIds[0]);

          if (!user) {
            console.error(`[RBDMS] Could not find user ${userIds[0]}`);
            continue;
          }
          const userName = user.fields.Name || user.fields.Email;
          const userOrganizations = user.fields.Organization || [];
          
          // Try to get coordinates and map link
          let mapLink = null;
          let coordinateSource = null;
          
          // Build a well record-like object for coordinate fallback
          const wellRecord = {
            API_Number: api,
            Section: currentData.section || well.fields.Section,
            Township: currentData.township || well.fields.Township,
            Range: currentData.range || well.fields.Range,
            PM: currentData.pm || well.fields.PM || 'IM',
            County: currentData.county || well.fields.County
          };
          
          try {
            const coordResult = await getCoordinatesWithFallback(api, wellRecord, env);
            if (coordResult.coordinates) {
              coordinateSource = coordResult.source;
              const mapWellData = coordResult.wellData || {
                sh_lat: coordResult.coordinates.latitude,
                sh_lon: coordResult.coordinates.longitude,
                well_name: well.fields['Well Name'] || `API ${api}`,
                api: api
              };
              
              if (!mapWellData.sh_lat || !mapWellData.sh_lon) {
                mapWellData.sh_lat = coordResult.coordinates.latitude;
                mapWellData.sh_lon = coordResult.coordinates.longitude;
              }
              
              mapLink = getMapLinkFromWellData(mapWellData);
              console.log(`[RBDMS] Using ${coordinateSource} coordinates for status mismatch alert ${api}`);
            }
          } catch (coordError) {
            console.error(`[RBDMS] Failed to get coordinates: ${coordError.message}`);
          }
          
          // Check user preferences before sending status change alert
          if (!userWantsAlert(user, 'Status Change')) {
            console.log(`[RBDMS] Skipped status change alert for ${user.fields.Email} - user disabled status change alerts`);
            // Still update the Airtable record but don't create activity or send email
            const updateUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_WELLS_TABLE)}/${well.id}`;
            await fetch(updateUrl, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ fields: { 'Status': rbdmsStatus } })
            });
            // D1 dual-write (non-fatal)
            try {
              if (env.WELLS_DB) {
                await env.WELLS_DB.prepare(`
                  UPDATE client_wells SET well_status = ?, last_status_check = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                  WHERE airtable_id = ?
                `).bind(rbdmsStatus, well.id).run();
              }
            } catch (d1Err) {
              console.error(`[RBDMS D1-WRITE-FAIL] ${well.id}: ${d1Err.message}`);
              await incrementD1WriteFailureCounter(env);
            }
            results.alertsSkipped = (results.alertsSkipped || 0) + 1;
            continue;
          }

          // Create activity log
          const activityData = {
            userId: userIds[0],  // Use the user record ID, not email
            apiNumber: api,
            activityType: 'Status Change',
            alertLevel: 'TRACKED WELL',
            changeType: `${airtableStatus} → ${rbdmsStatus}`,
            previousValue: airtableStatus,
            newValue: rbdmsStatus,
            wellName: well.fields['Well Name'] || `API ${api}`,
            operator: well.fields.Operator || currentData.operator || 'Unknown',
            sectionTownshipRange: `S${wellRecord.Section} T${wellRecord.Township} R${wellRecord.Range}`,
            county: currentData.county || wellRecord.County || 'Unknown',
            notes: `RBDMS status mismatch detected. Airtable showed ${getStatusDescription(airtableStatus)}, but RBDMS (source of truth) shows ${getStatusDescription(rbdmsStatus)}. Updating Airtable to match RBDMS.`,
            mapLink: mapLink || ""
          };
          
          // Add organization if user belongs to one
          if (userOrganizations.length > 0) {
            activityData.organizationId = userOrganizations[0];
          }
          
          const activityResult = await createActivityLog(env, activityData);
          
          if (!activityResult.success) {
            console.error(`[RBDMS] Failed to create activity log: ${activityResult.error}`);
            results.errors.push(`Activity log failed: ${activityResult.error}`);
          }
          
          // Send alert email
          if (!env.DRY_RUN || env.DRY_RUN === 'false') {
            try {
              await sendAlertEmail(env, {
                to: user.fields.Email,
                subject: `Well Status Update - ${well.fields['Well Name'] || api}`,
                userName: userName,
                wellName: well.fields['Well Name'] || `API ${api}`,
                apiNumber: api,
                activityType: 'Status Change',
                alertLevel: 'TRACKED WELL',
                operator: well.fields.Operator || currentData.operator || 'Unknown',
                county: currentData.county || wellRecord.County || 'Unknown',
                location: `S${wellRecord.Section} T${wellRecord.Township} R${wellRecord.Range}`,
                section: wellRecord.Section || '',
                township: wellRecord.Township || '',
                range: wellRecord.Range || '',
                statusChange: {
                  previous: getStatusDescription(airtableStatus),
                  current: getStatusDescription(rbdmsStatus)
                },
                mapLink: mapLink,
                occLink: getOCCWellRecordsLink(api),
                userId: userIds[0]
              });
              
              results.alertsSent++;
              console.log(`[RBDMS] Alert sent to ${user.fields.Email} for well ${api}`);
            } catch (emailErr) {
              console.error(`[RBDMS] Failed to send email: ${emailErr.message}`);
              results.errors.push(`Email failed: ${emailErr.message}`);
            }
          }
          
          // Update well record with RBDMS status (source of truth)
          const updateUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_WELLS_TABLE)}/${well.id}`;
          const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fields: {
                'Well Status': rbdmsStatus,
                'Last Status Check': new Date().toISOString(),
                'Status Last Changed': new Date().toISOString(),
                'Last RBDMS Sync': new Date().toISOString()
              }
            })
          });

          if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error(`[RBDMS] Failed to update well status in Airtable: ${errorText}`);
            results.errors.push('Failed to update well record');
          } else {
            console.log(`[RBDMS] Updated Airtable status for ${api} from ${airtableStatus} to ${rbdmsStatus}`);
          }

          // D1 dual-write (non-fatal)
          try {
            if (env.WELLS_DB) {
              await env.WELLS_DB.prepare(`
                UPDATE client_wells SET well_status = ?, last_status_check = CURRENT_TIMESTAMP,
                  status_last_changed = CURRENT_TIMESTAMP, last_rbdms_sync = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
                WHERE airtable_id = ?
              `).bind(rbdmsStatus, well.id).run();
            }
          } catch (d1Err) {
            console.error(`[RBDMS D1-WRITE-FAIL] ${well.id}: ${d1Err.message}`);
            await incrementD1WriteFailureCounter(env);
          }
          
        } catch (err) {
          console.error(`[RBDMS] Error processing status mismatch for ${api}:`, err);
          results.errors.push(`Processing error for ${api}: ${err.message}`);
        }
      }
    }
    
    console.log(`[RBDMS] Complete: ${results.wellsChecked} wells checked, ${results.statusChanges} changes found`);
    
  } catch (error) {
    console.error('[RBDMS] Status check failed:', error);
    results.errors.push(error.message);
  }
  
  return results;
}

/**
 * Simulate a status change for testing
 * @param {Object} env - Worker environment
 * @param {string} testApi - API number to test
 * @param {string} newStatus - New status to simulate (default: 'IA')
 * @returns {Object} - Test results
 */
async function simulateStatusChange(env, testApi, newStatus = 'IA') {
  const results = {
    testMode: true,
    wellsChecked: 1,
    statusChanges: 0,
    alertsSent: 0,
    errors: [],
    testDetails: {
      api: testApi,
      wellFound: false,
      currentStatus: null,
      simulatedStatus: newStatus,
      usersNotified: [],
      usersSkipped: []
    }
  };
  
  const approvedTestEmails = ['photog12@gmail.com', 'mrsprice518@gmail.com'];
  
  try {
    // Find the well in D1
    if (!env.WELLS_DB) throw new Error('D1 not available');
    const wellRow = await env.WELLS_DB.prepare(`
      SELECT airtable_id, api_number, well_name, well_status, operator, county, section, township, range_val, user_id, organization_id
      FROM client_wells WHERE api_number = ? AND status = 'Active' LIMIT 1
    `).bind(testApi).first();

    if (!wellRow) {
      console.log(`[RBDMS Test] Well ${testApi} not found in D1`);
      results.errors.push('Well not found');
      return results;
    }

    // Transform to Airtable record shape for compatibility
    const well = {
      id: wellRow.airtable_id,
      fields: {
        'API Number': wellRow.api_number,
        'Well Name': wellRow.well_name,
        'Well Status': wellRow.well_status,
        'Operator': wellRow.operator,
        'County': wellRow.county,
        'Section': wellRow.section,
        'Township': wellRow.township,
        'Range': wellRow.range_val,
        'User': wellRow.user_id ? [wellRow.user_id] : [],
        'Organization': wellRow.organization_id ? [wellRow.organization_id] : []
      }
    };
    const currentStatus = well.fields['Well Status'];
    results.testDetails.wellFound = true;
    results.testDetails.currentStatus = currentStatus;

    console.log(`[RBDMS Test] Found well ${testApi} with current status: ${currentStatus}`);
    console.log(`[RBDMS Test] Simulating status change to: ${newStatus}`);
    
    if (currentStatus === newStatus) {
      console.log(`[RBDMS Test] Well already has status ${newStatus}, simulating different status`);
      results.testDetails.simulatedStatus = currentStatus === 'AC' ? 'IA' : 'AC';
      newStatus = results.testDetails.simulatedStatus;
    }
    
    // Find all users to notify
    const wellMatches = await findMatchingWells(testApi, env);
    
    if (wellMatches.length === 0) {
      console.log(`[RBDMS Test] No users tracking well ${testApi}`);
      results.errors.push('No users tracking this well');
      return results;
    }
    
    console.log(`[RBDMS Test] Would notify ${wellMatches.length} users, filtering to test emails only`);
    
    // Log all users and filter to approved test emails
    const filteredMatches = [];
    for (const match of wellMatches) {
      if (!approvedTestEmails.includes(match.user.email)) {
        console.log(`[Test Mode] Skipping: ${match.user.email}${match.viaOrganization ? ` (via ${match.viaOrganization})` : ''}`);
        results.testDetails.usersSkipped.push({
          email: match.user.email,
          name: match.user.name,
          viaOrganization: match.viaOrganization || null
        });
      } else {
        console.log(`[Test Mode] Sending to: ${match.user.email}${match.viaOrganization ? ` (via ${match.viaOrganization})` : ''}`);
        filteredMatches.push(match);
      }
    }
    
    if (filteredMatches.length === 0) {
      console.log('[RBDMS Test] No approved test emails found in notification list');
      return results;
    }
    
    results.statusChanges = 1;
    
    // Simulate coordinates for map link
    const wellRecord = {
      API_Number: testApi,
      Section: well.fields.Section || '1',
      Township: well.fields.Township || '1N',
      Range: well.fields.Range || '1W',
      PM: well.fields.PM || 'IM',
      County: well.fields.County || 'TEST'
    };
    
    let mapLink = null;
    try {
      const coordResult = await getCoordinatesWithFallback(testApi, wellRecord, env);
      if (coordResult.coordinates) {
        const mapWellData = {
          sh_lat: coordResult.coordinates.latitude,
          sh_lon: coordResult.coordinates.longitude,
          well_name: well.fields['Well Name'] || `API ${testApi}`,
          api: testApi
        };
        mapLink = getMapLinkFromWellData(mapWellData);
      }
    } catch (err) {
      console.error(`[RBDMS Test] Failed to get coordinates: ${err.message}`);
    }
    
    // Process alerts for approved test emails only
    for (const match of filteredMatches) {
      try {
        const user = match.user;
        
        // Create activity log
        const activityData = {
          userId: user.id,
          apiNumber: testApi,
          activityType: 'Status Change',
          alertLevel: match.alertLevel || 'TRACKED WELL',
          previousValue: currentStatus,
          newValue: newStatus,
          wellName: well.fields['Well Name'] || `API ${testApi}`,
          operator: well.fields.Operator || 'Unknown',
          sectionTownshipRange: `S${wellRecord.Section} T${wellRecord.Township} R${wellRecord.Range}`,
          county: wellRecord.County,
          notes: `TEST MODE: Simulated status change from ${getStatusDescription(currentStatus)} to ${getStatusDescription(newStatus)}`,
          mapLink: mapLink || ""
        };
        
        await createActivityLog(env, activityData);
        
        // Send email
        await sendAlertEmail(env, {
          to: user.email,
          subject: `[TEST] Well Status Update - ${well.fields['Well Name'] || testApi}`,
          userName: user.name,
          wellName: well.fields['Well Name'] || `API ${testApi}`,
          apiNumber: testApi,
          activityType: 'Status Change',
          alertLevel: match.alertLevel || 'TRACKED WELL',
          operator: well.fields.Operator || 'Unknown',
          county: wellRecord.County,
          location: `S${wellRecord.Section} T${wellRecord.Township} R${wellRecord.Range}`,
          section: wellRecord.Section,
          township: wellRecord.Township,
          range: wellRecord.Range,
          statusChange: {
            previous: getStatusDescription(currentStatus),
            current: getStatusDescription(newStatus)
          },
          mapLink: mapLink,
          occLink: getOCCWellRecordsLink(testApi),
          userId: user.id
        });
        
        results.alertsSent++;
        results.testDetails.usersNotified.push({
          email: user.email,
          name: user.name,
          viaOrganization: match.viaOrganization || null
        });
        
        console.log(`[RBDMS Test] Alert sent to ${user.email}`);
      } catch (err) {
        console.error(`[RBDMS Test] Error sending alert to ${match.user.email}:`, err);
        results.errors.push(`Alert error for ${match.user.email}: ${err.message}`);
      }
    }
    
    console.log(`[RBDMS Test] Complete: Sent ${results.alertsSent} alerts`);
    
  } catch (error) {
    console.error('[RBDMS Test] Fatal error:', error);
    results.errors.push(error.message);
  }
  
  return results;
}

/**
 * Increment the daily D1 write failure counter in KV
 * Used to detect silent D1 write failures during RBDMS status updates
 */
async function incrementD1WriteFailureCounter(env) {
  try {
    if (!env.MINERAL_CACHE) return;
    const date = new Date().toISOString().split('T')[0];
    const key = `rbdms-d1-write-failures:${date}`;
    const current = parseInt(await env.MINERAL_CACHE.get(key) || '0', 10);
    await env.MINERAL_CACHE.put(key, String(current + 1), { expirationTtl: 7 * 24 * 60 * 60 });
  } catch (e) {
    console.error(`[RBDMS] Failed to increment D1 write failure counter: ${e.message}`);
  }
}

/**
 * Reconcile Airtable well statuses against D1 client_wells.well_status
 * Run in daily cron to detect drift between Airtable and D1
 * @param {Object} env - Worker environment
 * @returns {Object} - Reconciliation results
 */
export async function reconcileWellStatuses(env) {
  if (!env.WELLS_DB) return { checked: 0, mismatches: 0 };

  try {
    // Check D1 failure counter for today
    const date = new Date().toISOString().split('T')[0];
    const failureCount = parseInt(await env.MINERAL_CACHE?.get(`rbdms-d1-write-failures:${date}`) || '0', 10);
    if (failureCount > 0) {
      console.error(`[RBDMS STATUS-DRIFT] ${failureCount} D1 write failures today — investigate immediately`);
    }

    // Count wells with NULL well_status in D1 (should be 0 after RBDMS runs)
    const { results: nullRows } = await env.WELLS_DB.prepare(`
      SELECT COUNT(*) as cnt FROM client_wells WHERE status = 'Active' AND well_status IS NULL
    `).all();
    const nullCount = nullRows?.[0]?.cnt || 0;
    if (nullCount > 0) {
      console.warn(`[RBDMS STATUS-DRIFT] ${nullCount} active wells have NULL well_status in D1`);
    }

    return { checked: true, d1WriteFailuresToday: failureCount, nullStatusCount: nullCount };
  } catch (err) {
    console.error(`[RBDMS] Reconciliation failed: ${err.message}`);
    return { checked: false, error: err.message };
  }
}

/**
 * Optional: Store snapshot in R2 for historical analysis
 */
export async function storeRBDMSSnapshot(env, csvText) {
  if (!env.RBDMS_BUCKET) {
    console.log('[RBDMS] No R2 bucket configured for snapshots');
    return;
  }
  
  const date = new Date().toISOString().split('T')[0];
  const key = `snapshots/rbdms-wells-${date}.csv`;
  
  try {
    await env.RBDMS_BUCKET.put(key, csvText, {
      httpMetadata: {
        contentType: 'text/csv',
        contentEncoding: 'gzip'
      },
      customMetadata: {
        source: 'occ',
        recordCount: csvText.split('\n').length - 1
      }
    });
    console.log(`[RBDMS] Snapshot stored: ${key}`);
  } catch (error) {
    console.error('[RBDMS] Failed to store snapshot:', error);
  }
}