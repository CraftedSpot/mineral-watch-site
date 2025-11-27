// UPDATED ok-well-watch - Daily new wells + Client Wells API monitoring
// CHANGES: New email design, removed generic buttons, updated From address

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
            
            // 📋 LOG TO ACTIVITY HISTORY
            await logActivity(env, {
              userId: user.id,
              api: attr.api,
              wellName: fullWellName,
              activityType: activityType,
              previousValue: isOperatorChange ? previousOperator : previousStatus,
              newValue: isOperatorChange ? attr.operator : attr.wellstatus,
              operator: attr.operator,
              previousOperator: previousOperator,
              alertLevel: matchType.includes("Adjacent") ? "ADJACENT SECTION" : 
                          matchType.includes("API") ? "TRACKED WELL" : "YOUR PROPERTY",
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
        
      } catch (userErr) {
        console.error(`Error processing user ${user.email}:`, userErr);
      }
    }
    
    // ✅ UPDATE CHECKPOINT after processing ALL users
    await env.MINERAL_DB.put("checkpoint:last_objectid", String(highestObjectId));
    console.log(`Updated checkpoint to: ${highestObjectId}`);
    
    return new Response(`✅ Done! Sent alerts to ${totalAlertsSent} users. New checkpoint: ${highestObjectId}`, { status: 200 });
    
  } catch (err) {
    console.error("Worker error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
}

// --- HELPER: FETCH USERS ---
async function fetchActiveUsers(env) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Users?filterByFormula=AND({Status}='Active', {Email}!='')`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });
  
  if (!res.ok) throw new Error("Failed to fetch users");
  const data = await res.json();
  
  return data.records.map(r => ({
    id: r.id,
    email: r.fields.Email,
    name: r.fields.Name || r.fields.Email.split('@')[0]
  }));
}

// --- HELPER: FETCH USER PROPERTIES ---
async function fetchUserProperties(env, userId) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Properties?filterByFormula=FIND("${userId}", ARRAYJOIN({User}))`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });
  
  if (!res.ok) throw new Error("Failed to fetch properties");
  const data = await res.json();
  
  return data.records.map(r => ({
    section: r.fields.Section,
    township: r.fields.Township,
    range: r.fields.Range,
    meridian: r.fields.Meridian || 'IM'
  }));
}

// --- HELPER: FETCH USER WELLS ---
async function fetchUserWells(env, userId) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Wells?filterByFormula=FIND("${userId}", ARRAYJOIN({User}))`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });
  
  if (!res.ok) throw new Error("Failed to fetch wells");
  const data = await res.json();
  
  return data.records.map(r => ({
    api: r.fields.API_Number
  }));
}

// --- HELPER: BUILD LOCATION WATCH LIST (with adjacent sections) ---
function buildLocationWatchList(properties) {
  const watchList = new Map();
  
  for (const prop of properties) {
    const sec = parseInt(prop.section);
    const twn = prop.township;
    const rng = prop.range;
    const mer = prop.meridian || 'IM';
    
    // Add the property's own section
    const mainKey = `${String(sec).padStart(2, '0')}-${twn}-${rng}-${mer}`;
    watchList.set(mainKey, { isAdjacent: false, originalSection: sec });
    
    // Add adjacent sections (simplified - same township/range)
    const adjacentSections = getAdjacentSections(sec);
    for (const adjSec of adjacentSections) {
      const adjKey = `${String(adjSec).padStart(2, '0')}-${twn}-${rng}-${mer}`;
      if (!watchList.has(adjKey)) {
        watchList.set(adjKey, { isAdjacent: true, originalSection: sec });
      }
    }
  }
  
  return watchList;
}

// --- HELPER: GET ADJACENT SECTIONS ---
function getAdjacentSections(section) {
  // Standard township grid - sections 1-36
  // Returns adjacent sections (simplified, doesn't handle edge cases perfectly)
  const adjacent = [];
  const sec = parseInt(section);
  
  // This is simplified - real adjacent logic would need to handle
  // township boundaries and the serpentine numbering pattern
  const offsets = [-7, -6, -5, -1, 1, 5, 6, 7];
  
  for (const offset of offsets) {
    const adj = sec + offset;
    if (adj >= 1 && adj <= 36) {
      adjacent.push(adj);
    }
  }
  
  return adjacent;
}

// --- HELPER: BUILD API WATCH LIST ---
function buildAPIWatchList(wells) {
  const watchList = new Set();
  for (const well of wells) {
    if (well.api) {
      watchList.add(String(well.api));
    }
  }
  return watchList;
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
  
  // Build individual alert cards
  const rows = matches.map(m => {
    // Determine alert category styling
    let categoryBadge, categoryColor, cardBorderColor, cardBgColor;
    
    if (m.matchType.includes('API Watch')) {
      // Specific well monitoring - teal/green
      categoryBadge = 'TRACKED WELL';
      categoryColor = '#0D9488';
      cardBorderColor = '#0D9488';
      cardBgColor = '#F0FDFA';
    } else if (m.matchType.includes('Adjacent')) {
      // Adjacent section - amber/yellow
      categoryBadge = 'ADJACENT SECTION';
      categoryColor = '#D97706';
      cardBorderColor = '#D97706';
      cardBgColor = '#FFFBEB';
    } else {
      // Direct hit - red (highest priority)
      categoryBadge = 'YOUR PROPERTY';
      categoryColor = '#DC2626';
      cardBorderColor = '#DC2626';
      cardBgColor = '#FEF2F2';
    }

    // Activity type badge color
    let activityBadgeColor = '#1E40AF';
    let activityBadgeBg = '#DBEAFE';
    if (m.isOperatorChange) {
      activityBadgeColor = '#6D28D9';
      activityBadgeBg = '#EDE9FE';
    } else if (m.isStatusChange) {
      activityBadgeColor = '#92400E';
      activityBadgeBg = '#FEF3C7';
    } else if (m.status === 'AC') {
      activityBadgeColor = '#047857';
      activityBadgeBg = '#D1FAE5';
    }

    return `
    <div style="border: 1px solid #E2E8F0; border-left: 4px solid ${cardBorderColor}; border-radius: 0 8px 8px 0; margin-bottom: 20px; overflow: hidden;">
      
      <!-- Card Header -->
      <div style="background: ${cardBgColor}; padding: 16px 20px; border-bottom: 1px solid #E2E8F0;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
          <span style="display: inline-block; background: ${categoryColor}; color: white; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${categoryBadge}
          </span>
          <span style="display: inline-block; background: ${activityBadgeBg}; color: ${activityBadgeColor}; font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${m.activityType.replace(/[🔄🔨💰🔴⏸️✅❌📋📊📄]/g, '').trim()}
          </span>
        </div>
        <p style="margin: 12px 0 0 0; font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px;">
          ${m.location}${m.matchType.includes('Adjacent') ? ` · Adjacent to Section ${m.matchType.split('Adjacent to ')[1]}` : ''}
        </p>
      </div>
      
      <!-- Card Body -->
      <div style="background: #ffffff; padding: 20px;">
        
        <!-- Change indicator for operator/status changes -->
        ${m.isOperatorChange ? `
        <div style="background: #FEF3C7; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 13px; color: #92400E;">
            <strong>Operator changed:</strong> ${m.previousOperator} → ${m.operator}
          </p>
        </div>
        ` : ''}
        ${m.isStatusChange && !m.isOperatorChange ? `
        <div style="background: #FEF3C7; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 13px; color: #92400E;">
            <strong>Status changed:</strong> ${m.previousStatus} → ${m.status}
          </p>
        </div>
        ` : ''}
        
        <!-- Well Details -->
        <table style="width: 100%; font-size: 14px; margin-bottom: 16px;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 90px;">Well</td>
            <td style="padding: 6px 0; color: #1C2B36; font-weight: 500;">
              <a href="${m.mapLink}" style="color: #1C2B36; text-decoration: none;">${m.well}</a>
              <a href="${m.mapLink}" style="color: #2563EB; font-size: 12px; margin-left: 6px;">📍 Map</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Operator</td>
            <td style="padding: 6px 0; color: #1C2B36; font-weight: 500;">${m.operator}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Status</td>
            <td style="padding: 6px 0;">
              <span style="background: #E0F2FE; color: #0369A1; padding: 2px 8px; border-radius: 4px; font-size: 13px; font-weight: 500;">${m.status}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">API</td>
            <td style="padding: 6px 0; color: #1C2B36;">${m.api || 'Pending'}</td>
          </tr>
        </table>
        
        <!-- What This Means -->
        <div style="background: #F8FAFC; border-radius: 6px; padding: 14px 16px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 13px; color: #334E68; line-height: 1.6;">
            <strong style="color: #1C2B36;">What this means:</strong> ${m.explanation}
          </p>
        </div>
        
        <!-- Action Needed -->
        ${m.actionNeeded ? `
        <div style="background: ${m.actionNeeded.includes('⚠️') ? '#FEF2F2' : '#F0FDF4'}; border-radius: 6px; padding: 14px 16px; margin-bottom: 16px; border-left: 3px solid ${m.actionNeeded.includes('⚠️') ? '#EF4444' : '#22C55E'};">
          <p style="margin: 0; font-size: 13px; color: ${m.actionNeeded.includes('⚠️') ? '#991B1B' : '#166534'}; line-height: 1.6;">
            ${m.actionNeeded}
          </p>
        </div>
        ` : ''}
        
        <!-- CTA Button -->
        <div style="text-align: center; padding-top: 8px;">
          <a href="${m.link}" style="display: inline-block; background: #C05621; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
            View OCC Filing →
          </a>
        </div>
        
      </div>
    </div>
  `}).join("");

  // Build full email HTML
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #F7FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; border: 1px solid #E2E8F0;">
      
      <!-- Header -->
      <div style="background: #1C2B36; padding: 24px 30px;">
        <span style="color: #ffffff; font-size: 22px; font-weight: 700; font-family: Georgia, serif;">Mineral Watch</span>
      </div>
      
      <!-- Content -->
      <div style="padding: 32px 30px;">
        <h1 style="font-size: 22px; color: #1C2B36; margin: 0 0 8px; font-family: Georgia, serif;">
          Activity Alert
        </h1>
        <p style="font-size: 16px; color: #334E68; margin: 0 0 24px;">
          Hi ${user.name}, we found ${matches.length + remaining} update${matches.length + remaining > 1 ? 's' : ''} on your monitored properties.
        </p>
        
        <!-- Summary -->
        ${(() => {
          const operatorChanges = matches.filter(m => m.isOperatorChange).length;
          const statusChanges = matches.filter(m => m.isStatusChange && !m.isOperatorChange).length;
          const newWells = matches.filter(m => !m.isStatusChange && !m.isOperatorChange).length;
          const directHits = matches.filter(m => !m.matchType.includes('Adjacent') && !m.matchType.includes('API Watch')).length;
          const adjacentHits = matches.filter(m => m.matchType.includes('Adjacent')).length;
          const apiHits = matches.filter(m => m.matchType.includes('API Watch')).length;
          
          let summaryItems = [];
          if (directHits > 0) summaryItems.push(`<span style="color: #DC2626; font-weight: 600;">${directHits} on your property</span>`);
          if (adjacentHits > 0) summaryItems.push(`<span style="color: #D97706; font-weight: 600;">${adjacentHits} adjacent</span>`);
          if (apiHits > 0) summaryItems.push(`<span style="color: #0D9488; font-weight: 600;">${apiHits} tracked well${apiHits > 1 ? 's' : ''}</span>`);
          
          if (summaryItems.length > 0) {
            return `<div style="background: #F8FAFC; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px; border-left: 4px solid #1C2B36;">
              <p style="margin: 0; font-size: 14px; color: #334E68;">
                ${summaryItems.join(' · ')}
              </p>
            </div>`;
          }
          return '';
        })()}
        
        <!-- Alert Cards -->
        ${rows}
        
        <!-- More Alerts Notice -->
        ${remaining > 0 ? `
        <div style="background: #FEF3C7; padding: 16px 20px; border-radius: 6px; margin-top: 8px; border-left: 4px solid #F59E0B;">
          <p style="margin: 0; font-size: 14px; color: #92400E;">
            <strong>+ ${remaining} more alerts</strong><br>
            <span style="font-size: 13px;">Showing first 20 to keep this email manageable.</span>
          </p>
        </div>
        ` : ''}
        
        <!-- Status Code Reference -->
        <div style="background: #F8FAFC; padding: 16px 20px; border-radius: 6px; margin-top: 32px;">
          <p style="font-size: 12px; font-weight: 600; color: #64748B; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Status Codes</p>
          <p style="font-size: 13px; color: #64748B; margin: 0; line-height: 1.8;">
            <strong>ND</strong> = Permit Filed · 
            <strong>SP</strong> = Drilling · 
            <strong>AC</strong> = Producing · 
            <strong>SI</strong> = Shut-In · 
            <strong>PA</strong> = Plugged
          </p>
        </div>
        
      </div>
      
      <!-- Footer -->
      <div style="background: #F8F9FA; padding: 20px 30px; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 12px; color: #718096; margin: 0; line-height: 1.6;">
          Mineral Watch · Oklahoma City, Oklahoma<br>
          <a href="https://mymineralwatch.com/portal" style="color: #718096;">View Dashboard</a> · 
          <a href="https://mymineralwatch.com/contact" style="color: #718096;">Contact Support</a>
        </p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;

  // Build subject line
  const subject = (() => {
    const operatorChanges = matches.filter(m => m.isOperatorChange).length;
    const statusChanges = matches.filter(m => m.isStatusChange && !m.isOperatorChange).length;
    const newWells = matches.filter(m => !m.isStatusChange && !m.isOperatorChange).length;
    const directHits = matches.filter(m => !m.matchType.includes('Adjacent') && !m.matchType.includes('API Watch')).length;
    
    // Prioritize direct hits in subject
    if (directHits > 0) {
      return `🚨 ${directHits} alert${directHits > 1 ? 's' : ''} on your property`;
    } else if (operatorChanges > 0) {
      return `🔄 ${operatorChanges} Operator Transfer${operatorChanges > 1 ? 's' : ''}${statusChanges > 0 ? ` + ${statusChanges} more` : ''}`;
    } else if (statusChanges > 0) {
      return `📊 ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''}${newWells > 0 ? ` + ${newWells} new` : ''}`;
    } else {
      return `📋 ${newWells} New Well Record${newWells > 1 ? 's' : ''} nearby`;
    }
  })();

  // Send via Postmark
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      "From": "Mineral Watch <alerts@mymineralwatch.com>",
      "To": user.email,
      "Subject": subject,
      "HtmlBody": htmlBody,
      "MessageStream": "outbound"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Postmark Failed: ${errorText}`);
  }
}

// --- ACTIVITY LOGGING ---
async function logActivity(env, data) {
  const AIRTABLE_BASE_ID = "app3j3X29Uvp5stza";
  const ACTIVITY_TABLE_ID = "tblhBZNR5pDr620NY";
  
  const fields = {
    "Well Name": data.wellName || "",
    "Detected At": new Date().toISOString(),
    "API Number": data.api || "",
    "Activity Type": mapActivityType(data.activityType),
    "Previous Value": data.previousValue || "",
    "New Value": data.newValue || "",
    "Operator": data.operator || "",
    "Previous Operator": data.previousOperator || "",
    "Alert Level": data.alertLevel,
    "User": [data.userId],
    "Section-Township-Range": data.location || "",
    "County": data.county || "",
    "OCC Link": data.occLink || "",
    "Map Link": data.mapLink || "",
    "Email Sent": true
  };
  
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${ACTIVITY_TABLE_ID}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields })
      }
    );
    
    if (!response.ok) {
      console.error("Activity log failed:", await response.text());
    } else {
      console.log(`  - Logged activity: ${data.wellName} - ${data.activityType}`);
    }
  } catch (err) {
    console.error("Activity log error:", err);
    // Don't throw - logging failure should NOT stop alerts
  }
}

function mapActivityType(activityType) {
  // Map emoji descriptions to clean single-select values
  if (activityType.includes("Operator") || activityType.includes("Transfer")) return "Operator Transfer";
  if (activityType.includes("Permit") || activityType.includes("ND")) return "New Permit";
  if (activityType.includes("Drilling") || activityType.includes("Spud") || activityType.includes("SP")) return "Drilling Started";
  if (activityType.includes("Completed") || activityType.includes("Active") || activityType.includes("AC")) return "Well Completed";
  if (activityType.includes("Plugged") || activityType.includes("Abandoned") || activityType.includes("PA")) return "Plugged & Abandoned";
  if (activityType.includes("Shut In") || activityType.includes("SI")) return "Shut In";
  if (activityType.includes("TA")) return "Temporarily Abandoned";
  if (activityType.includes("New Well")) return "New Well Record";
  return "Status Change";
}
