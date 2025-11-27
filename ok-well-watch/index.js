// UPDATED ok-well-watch - Daily new wells + Client Wells API monitoring

export default {
  async fetch(request, env, ctx) {
    return await runWellWatch(env, ctx);
  },
  
  async scheduled(event, env, ctx) {
    await runWellWatch(env, ctx);
  },
};

// --- MAIN LOGIC ---
async function runWellWatch(env, ctx) {
  try {
    const baseUrl = "https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query";
    
    // 📍 Get checkpoint (shared by all users - we only scan OCC once)
    const checkpoint = await env.MINERAL_DB.get("checkpoint:last_objectid");
    const lastObjectId = checkpoint ? parseInt(checkpoint) : 0;
    
    console.log(`Checkpoint: ${lastObjectId} (fetching newer wells only)`);
    
    // 🔍 FETCH ONLY NEW WELLS from OCC (since last checkpoint)
    const params = new URLSearchParams({
      where: `objectid > ${lastObjectId}`,
      outFields: "api,well_name,well_num,operator,section,township,range,county,wellstatus,objectid,well_records_docs,pm,sh_lat,sh_lon",
      returnGeometry: "false",
      f: "json",
      resultRecordCount: "5000",
      orderByFields: "objectid ASC"
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { "User-Agent": "MineralWatch-MVP/1.0" }
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    
    console.log(`OCC returned ${data.features?.length || 0} new wells since checkpoint`);
    
    if (!data.features || data.features.length === 0) {
      return new Response("✅ No new wells since last check.", { status: 200 });
    }
    
    // Track highest objectid for checkpoint update
    let highestObjectId = lastObjectId;
    for (const feature of data.features) {
      if (feature.attributes.objectid > highestObjectId) {
        highestObjectId = feature.attributes.objectid;
      }
    }
    
    // 👥 GET ALL ACTIVE USERS
    const users = await fetchActiveUsers(env);
    console.log(`Processing ${users.length} active users`);
    
    let totalAlertsSent = 0;
    
    // 🔄 PROCESS EACH USER SEPARATELY
    for (const user of users) {
      try {
        console.log(`Processing user: ${user.name} (${user.email})`);
        
        // Get THIS user's properties AND wells
        const userProperties = await fetchUserProperties(env, user.id);
        const userWells = await fetchUserWells(env, user.id);
        
        console.log(`  - ${userProperties.length} properties + ${userWells.length} wells for this user`);
        
        if (userProperties.length === 0 && userWells.length === 0) {
          console.log(`  - Skipping user with no properties or wells`);
          continue;
        }
        
        // Build watch lists for THIS user
        const LOCATION_WATCH_LIST = buildLocationWatchList(userProperties);
        const API_WATCH_LIST = buildAPIWatchList(userWells);
        
        console.log(`  - Monitoring ${LOCATION_WATCH_LIST.size} sections + ${API_WATCH_LIST.size} well APIs for this user`);
        
        // 🎯 MATCH NEW WELLS AGAINST THIS USER'S SECTIONS + APIs
        const matches = [];
        
        for (const feature of data.features) {
          const attr = feature.attributes;
          const fullWellName = attr.well_num ? `${attr.well_name} ${attr.well_num}` : attr.well_name;
          const mapLink = generateMapLink(attr.sh_lat, attr.sh_lon, fullWellName);

          // Build location key
          const sec = String(attr.section).padStart(2, '0'); 
          const twn = attr.township;
          const rng = attr.range;
          const mer = attr.pm || 'IM';
          const locationKey = `${sec}-${twn}-${rng}-${mer}`;

          let isMatch = false;
          let matchType = "";

          // Check API Match (specific well)
          if (attr.api && API_WATCH_LIST.has(String(attr.api))) {
            isMatch = true;
            matchType = "🎯 Specific Well (API Watch)";
          }
          // Check Location Match (section)
          else if (attr.section && attr.township && attr.range) {
            const locMatch = LOCATION_WATCH_LIST.get(locationKey);
            if (locMatch) {
              isMatch = true;
              matchType = locMatch.isAdjacent ? `Adjacent to ${locMatch.originalSection}` : "Your Property";
            }
          }

          if (isMatch) {
            // Check THIS USER's tracking for this well
            const wellStatusKey = `well-status:${attr.api || attr.objectid}:${user.id}`;
            const wellOperatorKey = `well-operator:${attr.api || attr.objectid}:${user.id}`;
            
            const lastKnownStatus = await env.MINERAL_DB.get(wellStatusKey);
            const lastKnownOperator = await env.MINERAL_DB.get(wellOperatorKey);
            
            let isStatusChange = false;
            let isOperatorChange = false;
            let previousStatus = null;
            let previousOperator = null;
            
            if (lastKnownStatus && lastKnownStatus !== attr.wellstatus) {
              isStatusChange = true;
              previousStatus = lastKnownStatus;
            }
            
            if (lastKnownOperator && lastKnownOperator !== attr.operator) {
              isOperatorChange = true;
              previousOperator = lastKnownOperator;
            }
            
            // Store current status and operator for THIS USER
            await env.MINERAL_DB.put(wellStatusKey, attr.wellstatus || "UNKNOWN");
            await env.MINERAL_DB.put(wellOperatorKey, attr.operator || "UNKNOWN");
            
            // Determine activity type and explanation
            let activityType = "Well Record";
            let explanation = "";
            let actionNeeded = "";
            
            if (isOperatorChange) {
              // OPERATOR CHANGE (takes priority in display)
              activityType = "🔄 Operator Transfer";
              explanation = getOperatorChangeExplanation(previousOperator, attr.operator);
              actionNeeded = getOperatorChangeAction(previousOperator, attr.operator);
            } else if (isStatusChange) {
              // STATUS CHANGE
              activityType = getStatusChangeDescription(previousStatus, attr.wellstatus);
              explanation = getStatusChangeExplanation(previousStatus, attr.wellstatus);
              actionNeeded = getStatusChangeAction(previousStatus, attr.wellstatus);
            } else if (!lastKnownStatus) {
              // NEW WELL RECORD (for this user)
              activityType = getNewWellDescription(attr.wellstatus);
              explanation = getNewWellExplanation(attr.wellstatus);
              actionNeeded = getNewWellAction(attr.wellstatus);
            } else {
              // No change - skip
              continue;
            }
            
            matches.push({
              well: fullWellName,
              operator: attr.operator,
              previousOperator: previousOperator,
              location: locationKey,
              api: attr.api,
              status: attr.wellstatus,
              previousStatus: previousStatus,
              isStatusChange: isStatusChange,
              isOperatorChange: isOperatorChange,
              activityType: activityType,
              explanation: explanation,
              actionNeeded: actionNeeded,
              matchType: matchType,
              link: attr.well_records_docs || `https://public.occ.ok.gov/OGCDWellRecords/Search.aspx?api=${attr.api}`,
              mapLink: mapLink,
              objectid: attr.objectid,
              county: attr.county
            });
            
            // 📋 Log to Activity Log
            await logActivity(env, {
              wellName: fullWellName,
              apiNumber: attr.api,
              activityType: activityType,
              previousValue: isOperatorChange ? previousOperator : previousStatus,
              newValue: isOperatorChange ? attr.operator : attr.wellstatus,
              operator: attr.operator,
              previousOperator: previousOperator,
              alertLevel: matchType,
              userId: user.id,
              location: locationKey,
              county: attr.county,
              occLink: attr.well_records_docs || `https://public.occ.ok.gov/OGCDWellRecords/Search.aspx?api=${attr.api}`,
              mapLink: mapLink
            });
          }
        }

        // 📧 SEND EMAIL TO THIS USER if matches found
        if (matches.length > 0) {
          const matchesToSend = matches.slice(0, 20);
          const remaining = matches.length - matchesToSend.length;
          
          await sendPostmarkEmail(env, user, matchesToSend, remaining);
          totalAlertsSent++;
          
          console.log(`  - Sent ${matches.length} alerts to ${user.email}`);
        } else {
          console.log(`  - No new activity for this user`);
        }
        
      } catch (userError) {
        console.error(`Error processing user ${user.email}:`, userError);
        // Continue to next user even if one fails
      }
    }
    
    // 💾 Update global checkpoint for next run
    await env.MINERAL_DB.put("checkpoint:last_objectid", String(highestObjectId));
    console.log(`Updated checkpoint to objectid: ${highestObjectId}`);
    
    return new Response(
      `✅ Processed ${data.features.length} new wells for ${users.length} users. Sent ${totalAlertsSent} alert emails.`, 
      { status: 200 }
    );

  } catch (err) {
    console.error(err);
    return new Response(`Critical Error: ${err.message}`, { status: 500 });
  }
}

// --- HELPER: FETCH ACTIVE USERS ---
async function fetchActiveUsers(env) {
  const baseId = "app3j3X29Uvp5stza";
  const tableName = "👤 Users";
  
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=Status='Active'`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Airtable Users Fetch Failed: ${response.status} - ${errText}`);
  }

  const json = await response.json();
  return json.records.map(r => ({
    id: r.id,
    email: r.fields.Email,
    name: r.fields.Name || r.fields.Email,
    plan: r.fields.Plan
  }));
}

// --- HELPER: FETCH USER'S PROPERTIES ---
async function fetchUserProperties(env, userId) {
  const baseId = "app3j3X29Uvp5stza";
  const tableName = "📍 Client Properties"; // UPDATED TABLE NAME
  
  // Filter for properties owned by this user
  const formula = `FIND('${userId}', ARRAYJOIN({User}))`;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=SEC&fields[]=TWN&fields[]=RNG&fields[]=MERIDIAN`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Airtable Properties Fetch Failed: ${response.status} - ${errText}`);
  }

  const json = await response.json();
  return json.records.map(r => r.fields);
}

// --- HELPER: FETCH USER'S WELLS (NEW FUNCTION) ---
async function fetchUserWells(env, userId) {
  const baseId = "app3j3X29Uvp5stza";
  const tableName = "🛢️ Client Wells";
  
  // Filter for wells owned by this user
  const formula = `FIND('${userId}', ARRAYJOIN({User}))`;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=API Number&fields[]=Well Name&fields[]=Status`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    console.error(`Airtable Wells Fetch Failed: ${response.status} - ${errText}`);
    // Don't fail completely - just return empty array
    return [];
  }

  const json = await response.json();
  return json.records.map(r => r.fields);
}

// --- HELPER: BUILD LOCATION WATCH LIST ---
function buildLocationWatchList(properties) {
  const locationMap = new Map();
  
  properties.forEach(f => {
    if (!f.SEC || !f.TWN || !f.RNG) return;

    const sec = parseInt(f.SEC);
    const twn = f.TWN;
    const rng = f.RNG;
    const mer = f.MERIDIAN || 'IM';
    
    const originalKey = `${String(sec).padStart(2, '0')}-${twn}-${rng}-${mer}`;
    
    // Add actual property
    locationMap.set(originalKey, { isAdjacent: false, originalSection: originalKey });
    
    // Add 8 adjacent sections
    const adjacentSections = getAdjacentSections(sec, twn, rng, mer);
    adjacentSections.forEach(adjKey => {
      if (!locationMap.has(adjKey)) {
        locationMap.set(adjKey, { isAdjacent: true, originalSection: originalKey });
      }
    });
  });
  
  return locationMap;
}

// --- HELPER: BUILD API WATCH LIST (NEW FUNCTION) ---
function buildAPIWatchList(wells) {
  const apiSet = new Set();
  
  wells.forEach(w => {
    if (w['API Number'] && w.Status === 'Active') {
      apiSet.add(String(w['API Number']));
    }
  });
  
  return apiSet;
}

// --- HELPER: CALCULATE ADJACENT SECTIONS ---
function getAdjacentSections(section, township, range, meridian) {
  const adjacent = [];
  const sec = parseInt(section);
  const offsets = [-1, +1, -6, +6, -7, -5, +5, +7];
  
  offsets.forEach(offset => {
    const adjSec = sec + offset;
    if (adjSec >= 1 && adjSec <= 36) {
      const adjKey = `${String(adjSec).padStart(2, '0')}-${township}-${range}-${meridian}`;
      adjacent.push(adjKey);
    }
  });
  return adjacent;
}

// --- HELPER: OPERATOR CHANGE DESCRIPTIONS ---
function getOperatorChangeExplanation(oldOperator, newOperator) {
  return `Operational control of this well has transferred from ${oldOperator || 'Unknown'} to ${newOperator}. The new operator is now responsible for all operations, regulatory compliance, and royalty payments.`;
}

function getOperatorChangeAction(oldOperator, newOperator) {
  return `⚠️ UPDATE YOUR RECORDS: The operator has changed to ${newOperator}. If you receive royalty payments, expect new division orders and payment information from the new operator within 60-90 days. Contact the new operator's division order department to verify they have your correct mailing address and payment information.`;
}

// --- HELPER: STATUS CHANGE DESCRIPTIONS ---
function getStatusChangeDescription(oldStatus, newStatus) {
  const changes = {
    'ND-SP': '🔨 Drilling Has Started',
    'ND-AC': '💰 Well Now Producing',
    'SP-AC': '💰 Well Completed & Producing',
    'AC-PA': '🔴 Well Has Been Plugged',
    'AC-SI': '⏸️ Well Shut In (Temporarily)',
    'SI-AC': '✅ Well Reactivated',
    'ND-PA': '❌ Permit Abandoned',
    'SP-PA': '❌ Drilling Stopped & Plugged'
  };
  
  const key = `${oldStatus}-${newStatus}`;
  return changes[key] || `Status Changed: ${oldStatus} → ${newStatus}`;
}

function getStatusChangeExplanation(oldStatus, newStatus) {
  const explanations = {
    'ND-SP': 'The operator has begun drilling operations. A drilling rig is now on location.',
    'ND-AC': 'The well has been drilled, completed, and is now producing oil or gas.',
    'SP-AC': 'Drilling is complete and the well is now producing. You should start receiving royalty statements if you own mineral rights.',
    'AC-PA': 'The well has been permanently plugged and abandoned. Production has ceased and no further royalties will be generated from this well.',
    'AC-SI': 'The well has been temporarily shut in (not producing). This could be due to low prices, maintenance, or other operational reasons.',
    'SI-AC': 'The well has been brought back online and is producing again after being shut in.',
    'ND-PA': 'The drilling permit was abandoned before drilling began. No well will be drilled.',
    'SP-PA': 'Drilling was stopped and the well was plugged without entering production.'
  };
  
  const key = `${oldStatus}-${newStatus}`;
  return explanations[key] || 'The well status has been updated in OCC records.';
}

function getStatusChangeAction(oldStatus, newStatus) {
  const actions = {
    'ND-SP': 'No immediate action required. Drilling typically takes 2-4 weeks.',
    'ND-AC': 'Update your records. Expect royalty statements to begin within 60-90 days if you own producing mineral rights.',
    'SP-AC': 'Update your records. Contact the operator or division order analyst if you don\'t receive royalty statements within 90 days.',
    'AC-PA': '⚠️ Update your records immediately. Stop expecting royalty payments from this well. Check for any final settlement statements.',
    'AC-SI': 'Update your records. Royalty payments may pause temporarily. Monitor for reactivation.',
    'SI-AC': 'Update your records. Royalty payments should resume.',
    'ND-PA': 'Update your records. This location is no longer being developed.',
    'SP-PA': 'Update your records. No production will occur from this well.'
  };
  
  const key = `${oldStatus}-${newStatus}`;
  return actions[key] || 'Review the well record for details.';
}

// --- HELPER: NEW WELL DESCRIPTIONS ---
function getNewWellDescription(status) {
  const descriptions = {
    'ND': '📋 New Drill Permit Filed',
    'SP': '🔨 New Well - Drilling In Progress',
    'AC': '💰 New Producing Well Discovered',
    'PA': '📊 Plugged Well Record Added',
    'SI': '⏸️ Shut-In Well Record Added',
    'NE': '📄 Well Record Added (No Evidence)'
  };
  
  return descriptions[status] || '📄 New Well Record';
}

function getNewWellExplanation(status) {
  const explanations = {
    'ND': 'An operator has filed a permit to drill a new well on or near your property. This is the first step in the drilling process.',
    'SP': 'This well is currently being drilled. A rig is on location and operations are underway.',
    'AC': 'This producing well was added to the system. It may be a newly completed well or a historical record being updated.',
    'PA': 'This plugged well record was added to the system. It may be a recently plugged well or a historical record being updated.',
    'SI': 'This shut-in well record was added to the system. The well exists but is not currently producing.',
    'NE': 'This well permit expired or was never drilled. It exists in records only.'
  };
  
  return explanations[status] || 'A new well record has appeared in OCC records for your monitored area.';
}

function getNewWellAction(status) {
  const actions = {
    'ND': 'Watch for pooling notices or lease offers in the coming weeks. No immediate action required unless you receive a certified letter.',
    'SP': 'No action required. Monitor for completion (typically 2-4 weeks of drilling).',
    'AC': 'Verify if you own mineral rights. If yes, expect royalty statements within 60-90 days or contact the operator.',
    'PA': 'For reference only. No action required for plugged wells.',
    'SI': 'For reference only. Monitor if you expect this well to produce in the future.',
    'NE': 'For reference only. No well will be drilled.'
  };
  
  return actions[status] || 'Review the well record for details.';
}

// --- HELPER: GENERATE DEEP LINK TO OCC MAP ---
function generateMapLink(lat, lon, title) {
  if (!lat || !lon) return "#"; 
  const appId = "ba9b8612132f4106be6e3553dc0b827b";
  const markerTemplate = JSON.stringify({
    title: title,
    longitude: lon,
    latitude: lat,
    isIncludeShareUrl: true
  });
  return `https://gis.occ.ok.gov/portal/apps/webappviewer/index.html?id=${appId}&marker=${lon},${lat},,,,&markertemplate=${encodeURIComponent(markerTemplate)}&level=19`;
}

// --- HELPER: SEND EMAIL ---
async function sendPostmarkEmail(env, user, matches, remaining = 0) {
  const rows = matches.map(m => {
    const imagingLink = "https://imaging.occ.ok.gov/imaging/oap.aspx";
    const moeaLink = "https://ogims.public.occ.ok.gov/external/moea-search";
    
    // Choose background color based on change type
    const bgColor = m.isOperatorChange ? '#fef3c7' : 
                    (m.isStatusChange ? '#fef3c7' : 
                    (m.matchType.includes('Adjacent') ? '#fffbeb' : '#ffffff'));

    return `
    <div style="border: 1px solid #e2e8f0; padding: 20px; margin-bottom: 20px; border-radius: 8px; background-color: ${bgColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      
      <div style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 10px;">
        <h3 style="margin: 0; color: ${m.isOperatorChange || m.isStatusChange ? '#d97706' : (m.matchType.includes('API Watch') ? '#059669' : (m.matchType.includes('Adjacent') ? '#d97706' : '#dc2626'))}; font-size: 18px;">
          ${m.matchType.includes('API Watch') ? '🎯 Specific Well Monitor' : (m.matchType.includes('Adjacent') ? '⚠️ Adjacent Activity' : '🚨 Direct Hit: Your Property')}
        </h3>
        <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">${m.location}${m.matchType.includes('API Watch') ? ' (API: ' + m.api + ')' : ''}</p>
        <p style="margin: 8px 0 0 0; font-size: 16px; font-weight: bold; color: ${m.isOperatorChange || m.isStatusChange ? '#d97706' : '#059669'};">
          ${m.activityType}
        </p>
        ${m.isOperatorChange ? `<p style="margin: 5px 0 0 0; font-size: 13px; color: #78350f; background: #fef3c7; padding: 4px 8px; border-radius: 4px; display: inline-block;">Changed from: ${m.previousOperator}</p>` : ''}
        ${m.isStatusChange ? `<p style="margin: 5px 0 0 0; font-size: 13px; color: #78350f; background: #fef3c7; padding: 4px 8px; border-radius: 4px; display: inline-block;">Changed from: ${m.previousStatus}</p>` : ''}
      </div>

      <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
        <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #475569;">
          <strong>What this means:</strong> ${m.explanation}
        </p>
      </div>

      ${m.actionNeeded ? `
      <div style="background: ${m.actionNeeded.includes('⚠️') ? '#fef2f2' : '#f0fdf4'}; padding: 12px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid ${m.actionNeeded.includes('⚠️') ? '#ef4444' : '#22c55e'};">
        <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #1e293b;">
          <strong>${m.actionNeeded.includes('⚠️') ? '⚠️ Action Required:' : '💡 Recommended Action:'}</strong> ${m.actionNeeded}
        </p>
      </div>
      ` : ''}

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 15px; margin-bottom: 12px;">
        <p style="margin: 5px 0;"><strong>Well:</strong> 
           <a href="${m.mapLink}" style="color: #2563eb; text-decoration: underline; font-weight: bold;">${m.well} 📍</a>
        </p>
        <p style="margin: 5px 0;"><strong>Operator:</strong> ${m.operator}${m.isOperatorChange ? ' 🔄' : ''}</p>
        <p style="margin: 5px 0;"><strong>Current Status:</strong> <span style="background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px;">${m.status}</span></p>
        <p style="margin: 5px 0;"><strong>API:</strong> ${m.api || 'Pending'}</p>
      </div>

      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed #cbd5e1;">
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 8px; font-weight: bold; text-transform: uppercase;">Investigate this Section:</p>
        
        <a href="${m.link}" style="background-color: #2563eb; color: white; padding: 8px 12px; text-decoration: none; border-radius: 4px; font-size: 13px; display: inline-block; margin-right: 5px;">
          📄 View Permit / Docs
        </a>

        <a href="${imagingLink}" target="_blank" style="background-color: #475569; color: white; padding: 8px 12px; text-decoration: none; border-radius: 4px; font-size: 13px; display: inline-block; margin-right: 5px;">
          ⚖️ Search Legal Filings
        </a>

        <a href="${moeaLink}" target="_blank" style="background-color: #059669; color: white; padding: 8px 12px; text-decoration: none; border-radius: 4px; font-size: 13px; display: inline-block;">
          💰 Check Escrow
        </a>
      </div>
    </div>
  `}).join("");

  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1e293b;">Mineral Watch Alert</h2>
      <p style="color: #475569;">Hi ${user.name}, we detected ${matches.length + remaining} update${matches.length + remaining > 1 ? 's' : ''} on your monitored properties:</p>
      
      ${(() => {
        const operatorChanges = matches.filter(m => m.isOperatorChange).length;
        const statusChanges = matches.filter(m => m.isStatusChange && !m.isOperatorChange).length;
        const newWells = matches.filter(m => !m.isStatusChange && !m.isOperatorChange).length;
        const parts = [];
        if (operatorChanges > 0) parts.push(`<strong>🔄 ${operatorChanges} Operator Transfer${operatorChanges > 1 ? 's' : ''}</strong>`);
        if (statusChanges > 0) parts.push(`<strong>📊 ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''}</strong>`);
        if (newWells > 0) parts.push(`<strong>📋 ${newWells} New Well Record${newWells > 1 ? 's' : ''}</strong>`);
        
        if (parts.length > 0) {
          return `<div style="background: #f0f9ff; padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #0284c7;">
            <p style="margin: 0; font-size: 14px;">
              ${parts.join(' • ')}
            </p>
          </div>`;
        }
        return '';
      })()}
      
      ${rows}
      
      ${remaining > 0 ? `
      <div style="background: #fef3c7; padding: 15px; border-radius: 6px; margin-top: 20px; border-left: 4px solid #f59e0b;">
        <strong>⚠️ ${remaining} more wells found</strong><br>
        <span style="font-size: 14px; color: #78350f;">Only showing the first 20 matches to keep this email manageable. Check your dashboard for the complete list.</span>
      </div>
      ` : ''}
      
      <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin-top: 30px; font-size: 12px; color: #64748b;">
        <strong>Understanding Status Codes:</strong><br>
        ND = New Drill (Permit Filed)<br>
        SP = Spud (Drilling Started)<br>
        AC = Active (Producing)<br>
        PA = Plugged
      </div>
    </div>
  `;

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      "From": "alerts@mymineralwatch.com",
      "To": user.email,
      "Subject": (() => {
        const operatorChanges = matches.filter(m => m.isOperatorChange).length;
        const statusChanges = matches.filter(m => m.isStatusChange && !m.isOperatorChange).length;
        const newWells = matches.filter(m => !m.isStatusChange && !m.isOperatorChange).length;
        
        if (operatorChanges > 0) {
          return `🔔 ${operatorChanges} Operator Transfer${operatorChanges > 1 ? 's' : ''}${statusChanges > 0 ? ` + ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''}` : ''}${newWells > 0 ? ` + ${newWells} New Well${newWells > 1 ? 's' : ''}` : ''}`;
        } else if (statusChanges > 0 && newWells > 0) {
          return `🔔 ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''} + ${newWells} New Well${newWells > 1 ? 's' : ''}`;
        } else if (statusChanges > 0) {
          return `🔔 ${statusChanges} Well Status Change${statusChanges > 1 ? 's' : ''}`;
        } else {
          return `📋 ${newWells} New Well Record${newWells > 1 ? 's' : ''}`;
        }
      })(),
      "HtmlBody": htmlBody,
      "MessageStream": "outbound"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Postmark Failed: ${errorText}`);
  }
}

// --- HELPER: LOG ACTIVITY TO AIRTABLE ---
async function logActivity(env, data) {
  const baseId = "app3j3X29Uvp5stza";
  const tableId = "tblhBZNR5pDr620NY"; // 📋 Activity Log table
  
  try {
    const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          "Well Name": data.wellName,
          "Detected At": new Date().toISOString(),
          "API Number": data.apiNumber,
          "Activity Type": mapActivityType(data.activityType),
          "Previous Value": data.previousValue || "",
          "New Value": data.newValue || "",
          "Operator": data.operator || "",
          "Previous Operator": data.previousOperator || "",
          "Alert Level": mapAlertLevel(data.alertLevel),
          "User": [data.userId],
          "Section-Township-Range": data.location,
          "County": data.county || "",
          "OCC Link": data.occLink || "",
          "Map Link": data.mapLink || "",
          "Email Sent": true
        }
      })
    });
    
    if (response.ok) {
      console.log(`Logged activity: ${data.wellName} - ${data.activityType}`);
    } else {
      const err = await response.text();
      console.error(`Failed to log activity: ${err}`);
    }
  } catch (error) {
    console.error(`Activity logging error: ${error.message}`);
    // Don't throw - logging failure shouldn't stop alerts
  }
}

// --- HELPER: MAP ACTIVITY TYPE TO AIRTABLE SELECT OPTIONS ---
function mapActivityType(description) {
  if (!description) return "Status Change";
  const d = description.toLowerCase();
  if (d.includes('operator') || d.includes('transfer')) return "Operator Transfer";
  if (d.includes('permit') || d.includes('nd')) return "New Permit";
  if (d.includes('drilling') || d.includes('spud') || d.includes('sp')) return "Drilling Started";
  if (d.includes('completed') || d.includes('active') || d.includes('ac')) return "Well Completed";
  if (d.includes('plugged') || d.includes('abandoned') || d.includes('pa')) return "Plugged & Abandoned";
  if (d.includes('shut in') || d.includes('si')) return "Shut In";
  if (d.includes('ta')) return "Temporarily Abandoned";
  if (d.includes('new well')) return "New Well Record";
  return "Status Change";
}

// --- HELPER: MAP ALERT LEVEL TO AIRTABLE SELECT OPTIONS ---
function mapAlertLevel(matchType) {
  if (!matchType) return "YOUR PROPERTY";
  const m = matchType.toLowerCase();
  if (m.includes('api') || m.includes('tracked') || m.includes('specific well')) return "TRACKED WELL";
  if (m.includes('adjacent')) return "ADJACENT SECTION";
  return "YOUR PROPERTY";
}
