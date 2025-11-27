// UPDATED well-watch-weekly - Status changes + Client Wells API monitoring

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

// --- HELPER: BUILD SECTION LIST ---
function buildSectionList(properties) {
  const sections = [];
  const seen = new Set();
  
  properties.forEach(f => {
    if (!f.SEC || !f.TWN || !f.RNG) return;

    const sec = parseInt(f.SEC);
    const twn = f.TWN;
    const rng = f.RNG;
    const mer = f.MERIDIAN || 'IM';
    
    const originalKey = `${String(sec).padStart(2, '0')}-${twn}-${rng}-${mer}`;
    
    // Add actual property
    if (!seen.has(originalKey)) {
      sections.push({
        section: String(sec).padStart(2, '0'),
        township: twn,
        range: rng,
        meridian: mer,
        isAdjacent: false,
        originalSection: originalKey
      });
      seen.add(originalKey);
    }
    
    // Add 8 adjacent sections
    const offsets = [-1, +1, -6, +6, -7, -5, +5, +7];
    offsets.forEach(offset => {
      const adjSec = sec + offset;
      if (adjSec >= 1 && adjSec <= 36) {
        const adjKey = `${String(adjSec).padStart(2, '0')}-${twn}-${rng}-${mer}`;
        if (!seen.has(adjKey)) {
          sections.push({
            section: String(adjSec).padStart(2, '0'),
            township: twn,
            range: rng,
            meridian: mer,
            isAdjacent: true,
            originalSection: originalKey
          });
          seen.add(adjKey);
        }
      }
    });
  });
  
  return sections;
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
  
  const formula = `FIND('${userId}', ARRAYJOIN({User}))`;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}&fields[]=API Number&fields[]=Well Name&fields[]=Status`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    console.error(`Airtable Wells Fetch Failed: ${response.status} - ${errText}`);
    return [];
  }

  const json = await response.json();
  return json.records
    .map(r => r.fields)
    .filter(f => f['API Number'] && f.Status === 'Active'); // Only active wells
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
  const rows = matches.map(m => {
    const imagingLink = "https://imaging.occ.ok.gov/imaging/oap.aspx";
    const moeaLink = "https://ogims.public.occ.ok.gov/external/moea-search";

    return `
    <div style="border: 1px solid #e2e8f0; padding: 20px; margin-bottom: 20px; border-radius: 8px; background-color: #fef3c7; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      
      <div style="border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 10px;">
        <h3 style="margin: 0; color: #d97706; font-size: 18px;">
          ${m.matchType}
        </h3>
        <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">${m.location}</p>
        <p style="margin: 8px 0 0 0; font-size: 16px; font-weight: bold; color: #d97706;">
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
      <h2 style="color: #1e293b;">📊 Weekly Status Update</h2>
      <p style="color: #475569;">Hi ${user.name}, during our weekly review we found ${matches.length + remaining} change${matches.length + remaining > 1 ? 's' : ''} on your monitored properties:</p>
      
      <div style="background: #fef3c7; padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; font-size: 14px;">
          ${(() => {
            const operatorChanges = matches.filter(m => m.isOperatorChange).length;
            const statusChanges = matches.filter(m => m.isStatusChange && !m.isOperatorChange).length;
            const parts = [];
            if (operatorChanges > 0) parts.push(`<strong>🔄 ${operatorChanges} Operator Transfer${operatorChanges > 1 ? 's' : ''}</strong>`);
            if (statusChanges > 0) parts.push(`<strong>📊 ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''}</strong>`);
            return parts.join(' • ');
          })()}<br>
          <span style="color: #78350f; font-size: 13px;">These wells changed since last week's review.</span>
        </p>
      </div>
      
      ${rows}
      
      ${remaining > 0 ? `
      <div style="background: #fef3c7; padding: 15px; border-radius: 6px; margin-top: 20px; border-left: 4px solid #f59e0b;">
        <strong>⚠️ ${remaining} more changes found</strong><br>
        <span style="font-size: 14px; color: #78350f;">Only showing the first 20 matches to keep this email manageable.</span>
      </div>
      ` : ''}
      
      <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin-top: 30px; font-size: 12px; color: #64748b;">
        <strong>📅 Review Schedule:</strong><br>
        • Daily scans check for NEW drill permits and wells<br>
        • Weekly reviews (like this one) check for status and operator changes on existing wells
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
      "From": "support@craftedspot.com",
      "To": user.email,
      "Subject": (() => {
        const operatorChanges = matches.filter(m => m.isOperatorChange).length;
        const statusChanges = matches.filter(m => m.isStatusChange && !m.isOperatorChange).length;
        
        if (operatorChanges > 0 && statusChanges > 0) {
          return `📊 Weekly: ${operatorChanges} Operator Transfer${operatorChanges > 1 ? 's' : ''} + ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''}`;
        } else if (operatorChanges > 0) {
          return `🔄 Weekly: ${operatorChanges} Operator Transfer${operatorChanges > 1 ? 's' : ''}`;
        } else {
          return `📊 Weekly: ${statusChanges} Status Change${statusChanges > 1 ? 's' : ''}`;
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