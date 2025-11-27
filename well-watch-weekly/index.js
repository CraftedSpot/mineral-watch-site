// UPDATED well-watch-weekly - Status changes + Client Wells API monitoring
// CHANGES: New email design, removed generic buttons, updated From address

export default {
  async fetch(request, env, ctx) {
    return await runWeeklyRescan(env, ctx);
  },
  
  async scheduled(event, env, ctx) {
    await runWeeklyRescan(env, ctx);
  },
};

// --- MAIN LOGIC ---
async function runWeeklyRescan(env, ctx) {
  try {
    console.log("🔍 Starting Weekly Status Rescan");
    
    const baseUrl = "https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query";
    
    // 👥 GET ALL ACTIVE USERS
    const users = await fetchActiveUsers(env);
    console.log(`Processing ${users.length} active users for weekly rescan`);
    
    let totalAlertsSent = 0;
    let totalStatusChanges = 0;
    let totalOperatorChanges = 0;
    
    // 🔄 PROCESS EACH USER SEPARATELY
    for (const user of users) {
      try {
        console.log(`\nProcessing user: ${user.name} (${user.email})`);
        
        // Get THIS user's properties AND wells
        const userProperties = await fetchUserProperties(env, user.id);
        const userWells = await fetchUserWells(env, user.id);
        
        console.log(`  - ${userProperties.length} properties + ${userWells.length} wells for this user`);
        
        if (userProperties.length === 0 && userWells.length === 0) {
          console.log(`  - Skipping user with no properties or wells`);
          continue;
        }
        
        const matches = [];
        
        // 🎯 PART 1: CHECK LOCATION-BASED WELLS (from properties)
        if (userProperties.length > 0) {
          const sectionsToQuery = buildSectionList(userProperties);
          console.log(`  - Querying ${sectionsToQuery.length} unique sections (including adjacents)`);
          
          // Batch sections to avoid too many API calls
          const batchSize = 10;
          for (let i = 0; i < sectionsToQuery.length; i += batchSize) {
            const batch = sectionsToQuery.slice(i, i + batchSize);
            
            // Build WHERE clause for this batch
            const whereConditions = batch.map(s => 
              `(section='${s.section}' AND township='${s.township}' AND range='${s.range}' AND pm='${s.meridian}')`
            ).join(' OR ');
            
            const params = new URLSearchParams({
              where: whereConditions,
              outFields: "api,well_name,well_num,operator,section,township,range,county,wellstatus,objectid,well_records_docs,pm,sh_lat,sh_lon",
              returnGeometry: "false",
              f: "json",
              resultRecordCount: "5000"
            });

            const response = await fetch(`${baseUrl}?${params.toString()}`, {
              headers: { "User-Agent": "MineralWatch-Weekly/1.0" }
            });

            if (!response.ok) {
              console.error(`  - API Error for batch ${i}: ${response.status}`);
              continue;
            }
            
            const data = await response.json();
            console.log(`  - Section batch ${Math.floor(i/batchSize) + 1}: Found ${data.features?.length || 0} wells`);
            
            if (data.features && data.features.length > 0) {
              await processWellFeatures(env, user, data.features, batch, matches, totalStatusChanges, totalOperatorChanges);
            }
            
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // 🎯 PART 2: CHECK API-SPECIFIC WELLS (from Client Wells table)
        if (userWells.length > 0) {
          console.log(`  - Querying ${userWells.length} specific well APIs`);
          
          // Query OCC for specific API numbers
          const batchSize = 50; // Can batch more APIs at once
          for (let i = 0; i < userWells.length; i += batchSize) {
            const batch = userWells.slice(i, i + batchSize);
            const apiNumbers = batch.map(w => `'${w['API Number']}'`).join(',');
            
            const params = new URLSearchParams({
              where: `api IN (${apiNumbers})`,
              outFields: "api,well_name,well_num,operator,section,township,range,county,wellstatus,objectid,well_records_docs,pm,sh_lat,sh_lon",
              returnGeometry: "false",
              f: "json",
              resultRecordCount: "5000"
            });

            const response = await fetch(`${baseUrl}?${params.toString()}`, {
              headers: { "User-Agent": "MineralWatch-Weekly/1.0" }
            });

            if (!response.ok) {
              console.error(`  - API Error for well API batch ${i}: ${response.status}`);
              continue;
            }
            
            const data = await response.json();
            console.log(`  - Well API batch ${Math.floor(i/batchSize) + 1}: Found ${data.features?.length || 0} wells`);
            
            if (data.features && data.features.length > 0) {
              await processWellFeatures(env, user, data.features, null, matches, totalStatusChanges, totalOperatorChanges, true);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // 📧 SEND EMAIL TO THIS USER if changes found
        if (matches.length > 0) {
          const matchesToSend = matches.slice(0, 20);
          const remaining = matches.length - matchesToSend.length;
          
          await sendPostmarkEmail(env, user, matchesToSend, remaining);
          totalAlertsSent++;
          
          console.log(`  - Sent ${matches.length} change alerts to ${user.email}`);
        } else {
          console.log(`  - No changes detected for this user`);
        }
        
      } catch (userError) {
        console.error(`Error processing user ${user.email}:`, userError);
        // Continue to next user even if one fails
      }
    }
    
    return new Response(
      `✅ Weekly Rescan Complete: Found ${totalStatusChanges} status changes + ${totalOperatorChanges} operator changes across ${users.length} users. Sent ${totalAlertsSent} alert emails.`, 
      { status: 200 }
    );

  } catch (err) {
    console.error(err);
    return new Response(`Critical Error: ${err.message}`, { status: 500 });
  }
}

// --- HELPER: PROCESS WELL FEATURES ---
async function processWellFeatures(env, user, features, sectionBatch, matches, totalStatusChanges, totalOperatorChanges, isAPIBased = false) {
  for (const feature of features) {
    const attr = feature.attributes;
    const fullWellName = attr.well_num ? `${attr.well_name} ${attr.well_num}` : attr.well_name;
    const mapLink = generateMapLink(attr.sh_lat, attr.sh_lon, fullWellName);

    // Build location key
    const sec = String(attr.section).padStart(2, '0'); 
    const twn = attr.township;
    const rng = attr.range;
    const mer = attr.pm || 'IM';
    const locationKey = `${sec}-${twn}-${rng}-${mer}`;

    // Check THIS USER's tracking for this well
    const wellStatusKey = `well-status:${attr.api || attr.objectid}:${user.id}`;
    const wellOperatorKey = `well-operator:${attr.api || attr.objectid}:${user.id}`;
    
    const lastKnownStatus = await env.MINERAL_DB.get(wellStatusKey);
    const lastKnownOperator = await env.MINERAL_DB.get(wellOperatorKey);
    
    let hasChange = false;
    let isStatusChange = false;
    let isOperatorChange = false;
    let previousStatus = null;
    let previousOperator = null;
    
    // Check for status change
    if (lastKnownStatus && lastKnownStatus !== attr.wellstatus) {
      isStatusChange = true;
      previousStatus = lastKnownStatus;
      hasChange = true;
      totalStatusChanges++;
    }
    
    // Check for operator change
    if (lastKnownOperator && lastKnownOperator !== attr.operator) {
      isOperatorChange = true;
      previousOperator = lastKnownOperator;
      hasChange = true;
      totalOperatorChanges++;
    }
    
    // Only alert on changes (not new wells - daily worker handles those)
    if (hasChange) {
      // Update KV with new status and operator
      await env.MINERAL_DB.put(wellStatusKey, attr.wellstatus || "UNKNOWN");
      await env.MINERAL_DB.put(wellOperatorKey, attr.operator || "UNKNOWN");
      
      // Determine match type
      let matchType;
      if (isAPIBased) {
        matchType = "🎯 Specific Well (API Watch)";
      } else if (sectionBatch) {
        const sectionInfo = sectionBatch.find(s => 
          s.section === attr.section && 
          s.township === attr.township && 
          s.range === attr.range && 
          s.meridian === mer
        );
        matchType = sectionInfo?.isAdjacent ? 
          `Adjacent to ${sectionInfo.originalSection}` : 
          "Your Property";
      } else {
        matchType = "Your Property";
      }
      
      // Determine activity type and explanation (operator change takes priority)
      let activityType, explanation, actionNeeded;
      
      if (isOperatorChange) {
        activityType = "🔄 Operator Transfer";
        explanation = getOperatorChangeExplanation(previousOperator, attr.operator);
        actionNeeded = getOperatorChangeAction(previousOperator, attr.operator);
      } else {
        activityType = getStatusChangeDescription(previousStatus, attr.wellstatus);
        explanation = getStatusChangeExplanation(previousStatus, attr.wellstatus);
        actionNeeded = getStatusChangeAction(previousStatus, attr.wellstatus);
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
        objectid: attr.objectid
      });
    } else if (!lastKnownStatus || !lastKnownOperator) {
      // First time seeing this well for this user - just store, don't alert
      // (Daily worker should have caught it if it's truly new)
      if (!lastKnownStatus) {
        await env.MINERAL_DB.put(wellStatusKey, attr.wellstatus || "UNKNOWN");
      }
      if (!lastKnownOperator) {
        await env.MINERAL_DB.put(wellOperatorKey, attr.operator || "UNKNOWN");
      }
    }
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
  
  return data.records.map(r => r.fields);
}

// --- HELPER: BUILD SECTION LIST (with adjacents) ---
function buildSectionList(properties) {
  const sections = [];
  const seen = new Set();
  
  for (const prop of properties) {
    const sec = parseInt(prop.section);
    const twn = prop.township;
    const rng = prop.range;
    const mer = prop.meridian || 'IM';
    
    // Add the property's own section
    const mainKey = `${sec}-${twn}-${rng}-${mer}`;
    if (!seen.has(mainKey)) {
      seen.add(mainKey);
      sections.push({
        section: String(sec),
        township: twn,
        range: rng,
        meridian: mer,
        isAdjacent: false,
        originalSection: sec
      });
    }
    
    // Add adjacent sections
    const adjacentSections = getAdjacentSections(sec);
    for (const adjSec of adjacentSections) {
      const adjKey = `${adjSec}-${twn}-${rng}-${mer}`;
      if (!seen.has(adjKey)) {
        seen.add(adjKey);
        sections.push({
          section: String(adjSec),
          township: twn,
          range: rng,
          meridian: mer,
          isAdjacent: true,
          originalSection: sec
        });
      }
    }
  }
  
  return sections;
}

// --- HELPER: GET ADJACENT SECTIONS ---
function getAdjacentSections(section) {
  const adjacent = [];
  const sec = parseInt(section);
  
  // Simplified adjacent logic - same township/range
  const offsets = [-7, -6, -5, -1, 1, 5, 6, 7];
  
  for (const offset of offsets) {
    const adj = sec + offset;
    if (adj >= 1 && adj <= 36) {
      adjacent.push(adj);
    }
  }
  
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
    let activityBadgeColor = '#6D28D9';
    let activityBadgeBg = '#EDE9FE';
    if (m.isOperatorChange) {
      activityBadgeColor = '#6D28D9';
      activityBadgeBg = '#EDE9FE';
    } else if (m.activityType.includes('Plugged') || m.activityType.includes('Abandoned')) {
      activityBadgeColor = '#DC2626';
      activityBadgeBg = '#FEE2E2';
    } else if (m.activityType.includes('Producing') || m.activityType.includes('Reactivated')) {
      activityBadgeColor = '#047857';
      activityBadgeBg = '#D1FAE5';
    } else if (m.activityType.includes('Shut In')) {
      activityBadgeColor = '#92400E';
      activityBadgeBg = '#FEF3C7';
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
        
        <!-- Change indicator -->
        ${m.isOperatorChange ? `
        <div style="background: #EDE9FE; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 13px; color: #6D28D9;">
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
        <p style="font-size: 11px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px;">Weekly Review</p>
        <h1 style="font-size: 22px; color: #1C2B36; margin: 0 0 8px; font-family: Georgia, serif;">
          Status Changes Detected
        </h1>
        <p style="font-size: 16px; color: #334E68; margin: 0 0 24px;">
          Hi ${user.name}, our weekly scan found ${matches.length + remaining} change${matches.length + remaining > 1 ? 's' : ''} on your monitored wells.
        </p>
        
        <!-- Summary -->
        <div style="background: #F8FAFC; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px; border-left: 4px solid #1C2B36;">
          <p style="margin: 0; font-size: 14px; color: #334E68;">
            ${(() => {
              const operatorChanges = matches.filter(m => m.isOperatorChange).length;
              const statusChanges = matches.filter(m => m.isStatusChange && !m.isOperatorChange).length;
              const directHits = matches.filter(m => !m.matchType.includes('Adjacent') && !m.matchType.includes('API Watch')).length;
              const adjacentHits = matches.filter(m => m.matchType.includes('Adjacent')).length;
              const apiHits = matches.filter(m => m.matchType.includes('API Watch')).length;
              
              let parts = [];
              if (operatorChanges > 0) parts.push(`<strong style="color: #6D28D9;">${operatorChanges} operator transfer${operatorChanges > 1 ? 's' : ''}</strong>`);
              if (statusChanges > 0) parts.push(`<strong style="color: #92400E;">${statusChanges} status change${statusChanges > 1 ? 's' : ''}</strong>`);
              
              let locationParts = [];
              if (directHits > 0) locationParts.push(`${directHits} on your property`);
              if (adjacentHits > 0) locationParts.push(`${adjacentHits} adjacent`);
              if (apiHits > 0) locationParts.push(`${apiHits} tracked well${apiHits > 1 ? 's' : ''}`);
              
              return parts.join(' · ') + (locationParts.length > 0 ? '<br><span style="font-size: 13px; color: #64748B;">' + locationParts.join(' · ') + '</span>' : '');
            })()}
          </p>
        </div>
        
        <!-- Alert Cards -->
        ${rows}
        
        <!-- More Alerts Notice -->
        ${remaining > 0 ? `
        <div style="background: #FEF3C7; padding: 16px 20px; border-radius: 6px; margin-top: 8px; border-left: 4px solid #F59E0B;">
          <p style="margin: 0; font-size: 14px; color: #92400E;">
            <strong>+ ${remaining} more changes</strong><br>
            <span style="font-size: 13px;">Showing first 20 to keep this email manageable.</span>
          </p>
        </div>
        ` : ''}
        
        <!-- Schedule Explanation -->
        <div style="background: #F8FAFC; padding: 16px 20px; border-radius: 6px; margin-top: 32px;">
          <p style="font-size: 12px; font-weight: 600; color: #64748B; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">How Monitoring Works</p>
          <p style="font-size: 13px; color: #64748B; margin: 0; line-height: 1.7;">
            <strong>Daily alerts</strong> catch new permits and wells as they're filed.<br>
            <strong>Weekly reviews</strong> (like this one) catch status and operator changes on existing wells.
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
    const directHits = matches.filter(m => !m.matchType.includes('Adjacent') && !m.matchType.includes('API Watch')).length;
    
    // Prioritize direct hits and operator changes
    if (directHits > 0 && operatorChanges > 0) {
      return `📊 Weekly: ${operatorChanges} operator change${operatorChanges > 1 ? 's' : ''} on your property`;
    } else if (operatorChanges > 0 && statusChanges > 0) {
      return `📊 Weekly: ${operatorChanges} operator + ${statusChanges} status change${statusChanges > 1 ? 's' : ''}`;
    } else if (operatorChanges > 0) {
      return `🔄 Weekly: ${operatorChanges} Operator Transfer${operatorChanges > 1 ? 's' : ''}`;
    } else if (directHits > 0) {
      return `📊 Weekly: ${statusChanges} status change${statusChanges > 1 ? 's' : ''} on your property`;
    } else {
      return `📊 Weekly: ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''}`;
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
