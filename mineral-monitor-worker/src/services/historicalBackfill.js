/**
 * Historical Backfill Service
 *
 * When a user adds a new property, this service checks Statewide Activity
 * for recent OCC filings in that section (and adjacent sections) and creates
 * Historical Activity Log entries so users can see past activity.
 *
 * Key differences from real-time alerts:
 * - No emails sent
 * - Marked with Historical = true
 * - Shows activity from before the property was added
 */

import { getAdjacentSections } from '../utils/plss.js';
import { normalizeSection } from '../utils/normalize.js';

const BACKFILL_DAYS = 90; // How far back to look for historical activity

/**
 * Backfill historical alerts for a single property
 * @param {Object} env - Worker environment
 * @param {Object} property - Property record with section, township, range, user
 * @returns {Object} - Results of backfill
 */
export async function backfillPropertyHistory(env, property) {
  const { section, township, range, userId, propertyId } = property;

  if (!section || !township || !range || !userId) {
    return { success: false, error: 'Missing required property fields', created: 0 };
  }

  console.log(`[Backfill] Starting for property ${propertyId}: S${section} T${township} R${range}`);

  // Build list of sections to search (property section + adjacent)
  const sectionsToCheck = new Set();

  // Add the property's own section
  const normalizedSection = normalizeSection(section);
  sectionsToCheck.add(`${normalizedSection}|${township}|${range}`);

  // Add adjacent sections (3x3 grid)
  const adjacents = getAdjacentSections(parseInt(normalizedSection, 10), township, range);
  for (const adj of adjacents) {
    sectionsToCheck.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}`);
  }

  console.log(`[Backfill] Checking ${sectionsToCheck.size} sections`);

  // Calculate date range (last 90 days)
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - BACKFILL_DAYS);
  const sinceDateStr = sinceDate.toISOString().split('T')[0];

  // Query Statewide Activity for matching sections
  const matches = [];

  for (const sectionKey of sectionsToCheck) {
    const [sec, twn, rng] = sectionKey.split('|');

    // Query D1 statewide_activity for matching sections (surface or BH)
    try {
      if (!env.WELLS_DB) throw new Error('D1 not available');
      const { results: rows } = await env.WELLS_DB.prepare(`
        SELECT * FROM statewide_activity
        WHERE ((surface_section = ? AND surface_township = ? AND surface_range = ?)
            OR (bh_section = ? AND bh_township = ? AND bh_range = ?))
          AND created_at >= ?
      `).bind(sec, twn, rng, sec, twn, rng, sinceDateStr).all();

      if (rows && rows.length > 0) {
        for (const row of rows) {
          const surfaceMatch =
            normalizeSection(row.surface_section) === sec &&
            row.surface_township === twn &&
            row.surface_range === rng;

          const bhMatch =
            normalizeSection(row.bh_section) === sec &&
            row.bh_township === twn &&
            row.bh_range === rng;

          const isDirectMatch = (surfaceMatch || bhMatch) &&
            sectionKey === `${normalizedSection}|${township}|${range}`;

          // Transform D1 row to Airtable fields shape for compatibility
          matches.push({
            record: {
              'API Number': row.api_number,
              'Well Name': row.well_name,
              'Operator': row.operator,
              'County': row.county,
              'Surface Section': row.surface_section,
              'Surface Township': row.surface_township,
              'Surface Range': row.surface_range,
              'BH Section': row.bh_section,
              'BH Township': row.bh_township,
              'BH Range': row.bh_range,
              'Has Permit': row.has_permit,
              'Has Completion': row.has_completion,
              'Is Horizontal': row.is_horizontal,
              'Permit Date': row.permit_date,
              'Completion Date': row.completion_date,
              'Formation': row.formation,
              'Well Status': row.well_status,
              'Latitude': row.latitude,
              'Longitude': row.longitude
            },
            recordId: row.id,
            matchedSection: sectionKey,
            alertLevel: isDirectMatch ? 'YOUR PROPERTY' : 'ADJACENT SECTION'
          });
        }
      }
    } catch (err) {
      console.error(`[Backfill] Error querying section ${sectionKey}:`, err.message);
    }
  }

  // Deduplicate by API number (same well might match multiple sections)
  const uniqueMatches = new Map();
  for (const match of matches) {
    const apiNumber = match.record['API Number'];
    if (!uniqueMatches.has(apiNumber)) {
      uniqueMatches.set(apiNumber, match);
    } else {
      // Prefer YOUR PROPERTY over ADJACENT
      const existing = uniqueMatches.get(apiNumber);
      if (match.alertLevel === 'YOUR PROPERTY' && existing.alertLevel !== 'YOUR PROPERTY') {
        uniqueMatches.set(apiNumber, match);
      }
    }
  }

  console.log(`[Backfill] Found ${uniqueMatches.size} unique historical matches`);

  // Check which ones already exist in Activity Log to avoid duplicates
  // Fetch historical alerts and filter client-side (ARRAYJOIN on linked records returns display names)
  const existingAlerts = new Set();
  try {
    const existingFormula = encodeURIComponent(`{Historical}=TRUE()`);
    const existingResponse = await fetch(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}?filterByFormula=${existingFormula}&fields[]=API%20Number&fields[]=User`,
      {
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`
        }
      }
    );

    if (existingResponse.ok) {
      const existingData = await existingResponse.json();
      for (const rec of existingData.records || []) {
        // Filter client-side: check if User array contains userId
        const recUserIds = rec.fields.User || [];
        if (recUserIds.includes(userId) && rec.fields['API Number']) {
          existingAlerts.add(rec.fields['API Number']);
        }
      }
    }
  } catch (err) {
    console.warn('[Backfill] Could not check existing alerts:', err.message);
  }

  // Create Activity Log entries for new matches
  let created = 0;
  const errors = [];

  for (const [apiNumber, match] of uniqueMatches) {
    // Skip if already exists
    if (existingAlerts.has(apiNumber)) {
      console.log(`[Backfill] Skipping ${apiNumber} - already exists`);
      continue;
    }

    const record = match.record;

    // Determine activity type
    let activityType = 'New Well Record';
    if (record['Has Permit']) activityType = 'New Permit';
    if (record['Has Completion']) activityType = 'Well Completed';

    // Build Activity Log entry
    const activityData = {
      'Well Name': record['Well Name'] || 'Unknown',
      'API Number': apiNumber,
      'Activity Type': activityType,
      'Operator': record['Operator'] || 'Unknown',
      'Alert Level': match.alertLevel,
      'Section-Township-Range': `S${record['Surface Section']} T${record['Surface Township']} R${record['Surface Range']}`,
      'County': record['County'] || '',
      'Formation': record['Formation'] || null,
      'OCC Map Link': record['OCC Map Link'] || null,
      'Map Link': `https://portal.mymineralwatch.com/map?well=${apiNumber}`,
      'User': [userId],
      'Historical': true,
      'Email Sent': true, // Mark as "sent" so it doesn't get picked up for digest
      'Detected At': record['Permit Date'] || record['Completion Date'] || record['Created Date'] || new Date().toISOString(),
      'Notes': `Historical alert - activity from ${record['Created Date'] || 'unknown date'}`
    };

    try {
      const createResponse = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: activityData })
        }
      );

      if (createResponse.ok) {
        created++;
        console.log(`[Backfill] Created historical alert for ${apiNumber}`);
      } else {
        const errText = await createResponse.text();
        errors.push({ apiNumber, error: errText });
        console.error(`[Backfill] Failed to create alert for ${apiNumber}:`, errText);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (err) {
      errors.push({ apiNumber, error: err.message });
      console.error(`[Backfill] Error creating alert for ${apiNumber}:`, err.message);
    }
  }

  console.log(`[Backfill] Completed: ${created} historical alerts created`);

  return {
    success: true,
    propertyId,
    section: `S${section} T${township} R${range}`,
    sectionsChecked: sectionsToCheck.size,
    matchesFound: uniqueMatches.size,
    alreadyExisted: existingAlerts.size,
    created,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Backfill historical alerts for multiple properties (e.g., all properties for a user/org)
 * OPTIMIZED: Collects all sections first, queries Statewide Activity once, then creates alerts
 *
 * @param {Object} env - Worker environment
 * @param {string} userId - User's Airtable record ID
 * @returns {Object} - Results of backfill
 */
export async function backfillUserProperties(env, userId) {
  console.log(`[Backfill] Starting bulk backfill for user ${userId}`);

  // Get all active properties for this user from D1
  let allProperties = [];

  try {
    if (!env.WELLS_DB) return { success: false, error: 'D1 not available' };

    // Get user's org to include org properties
    const userRow = await env.WELLS_DB.prepare(
      `SELECT organization_id FROM users WHERE airtable_record_id = ?`
    ).bind(userId).first();
    const orgId = userRow?.organization_id;

    const ownerClause = orgId
      ? `(user_id IN (SELECT airtable_record_id FROM users WHERE organization_id = ?) OR organization_id = ?)`
      : `user_id = ?`;
    const ownerParams = orgId ? [orgId, orgId] : [userId];

    const { results: rows } = await env.WELLS_DB.prepare(`
      SELECT airtable_record_id, section, township, range, meridian, county, monitor_adjacent, user_id
      FROM properties WHERE status = 'Active' AND ${ownerClause}
    `).bind(...ownerParams).all();

    // Transform to Airtable record shape for downstream compatibility
    allProperties = (rows || []).map(r => ({
      id: r.airtable_record_id,
      fields: {
        'SEC': r.section,
        'TWN': r.township,
        'RNG': r.range,
        'MERIDIAN': r.meridian || 'IM',
        'COUNTY': r.county,
        'User': [r.user_id],
        'Monitor Adjacent': r.monitor_adjacent !== 0
      }
    }));
  } catch (err) {
    return { success: false, error: `D1 query failed: ${err.message}` };
  }

  console.log(`[Backfill] Found ${allProperties.length} properties for user`);

  if (allProperties.length === 0) {
    return { success: true, userId, propertiesProcessed: 0, totalAlertsCreated: 0 };
  }

  // Build a map of all unique sections to check (property sections + adjacents)
  // Key: "section|township|range", Value: { properties: [propertyIds], isDirectMatch: boolean }
  const sectionMap = new Map();

  for (const prop of allProperties) {
    const sec = normalizeSection(prop.fields['SEC']);
    const twn = prop.fields['TWN'];
    const rng = prop.fields['RNG'];

    if (!sec || !twn || !rng) continue;

    // Add property's own section
    const propKey = `${sec}|${twn}|${rng}`;
    if (!sectionMap.has(propKey)) {
      sectionMap.set(propKey, { properties: [], isDirectMatch: true });
    }
    sectionMap.get(propKey).properties.push(prop.id);

    // Add adjacent sections
    const adjacents = getAdjacentSections(parseInt(sec, 10), twn, rng);
    for (const adj of adjacents) {
      const adjKey = `${normalizeSection(adj.section)}|${adj.township}|${adj.range}`;
      if (!sectionMap.has(adjKey)) {
        sectionMap.set(adjKey, { properties: [], isDirectMatch: false });
      }
      // Don't add to properties array for adjacents - we just need to know it exists
    }
  }

  console.log(`[Backfill] Checking ${sectionMap.size} unique sections`);

  // Calculate date range
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - BACKFILL_DAYS);
  const sinceDateStr = sinceDate.toISOString().split('T')[0];

  // Query D1 statewide_activity in batches (D1 has 100-param limit)
  const sectionKeys = Array.from(sectionMap.keys());
  const BATCH_SIZE = 10; // 7 params per section (6 for surface+BH + date), keep under 100
  const allMatches = new Map(); // API Number -> match info

  if (!env.WELLS_DB) {
    console.error('[Backfill] D1 not available for statewide activity query');
    return { success: false, error: 'D1 not available' };
  }

  for (let i = 0; i < sectionKeys.length; i += BATCH_SIZE) {
    const batch = sectionKeys.slice(i, i + BATCH_SIZE);

    // Build OR conditions for this batch
    const conditions = batch.map(() =>
      `((surface_section = ? AND surface_township = ? AND surface_range = ?) OR (bh_section = ? AND bh_township = ? AND bh_range = ?))`
    ).join(' OR ');
    const binds = batch.flatMap(key => {
      const [sec, twn, rng] = key.split('|');
      return [sec, twn, rng, sec, twn, rng];
    });
    binds.push(sinceDateStr);

    try {
      const { results: rows } = await env.WELLS_DB.prepare(`
        SELECT * FROM statewide_activity
        WHERE (${conditions}) AND created_at >= ?
      `).bind(...binds).all();

      for (const row of rows || []) {
        const apiNumber = row.api_number;
        if (!apiNumber) continue;

        const surfaceSec = normalizeSection(row.surface_section);
        const surfaceKey = `${surfaceSec}|${row.surface_township}|${row.surface_range}`;
        const bhSec = normalizeSection(row.bh_section);
        const bhKey = bhSec ? `${bhSec}|${row.bh_township}|${row.bh_range}` : null;

        const surfaceMatch = sectionMap.get(surfaceKey);
        const bhMatch = bhKey ? sectionMap.get(bhKey) : null;

        const isDirectMatch = (surfaceMatch?.isDirectMatch || bhMatch?.isDirectMatch);

        // Transform D1 row to Airtable fields shape
        const fields = {
          'API Number': row.api_number,
          'Well Name': row.well_name,
          'Operator': row.operator,
          'County': row.county,
          'Surface Section': row.surface_section,
          'Surface Township': row.surface_township,
          'Surface Range': row.surface_range,
          'BH Section': row.bh_section,
          'BH Township': row.bh_township,
          'BH Range': row.bh_range,
          'Has Permit': row.has_permit,
          'Has Completion': row.has_completion,
          'Is Horizontal': row.is_horizontal,
          'Permit Date': row.permit_date,
          'Completion Date': row.completion_date,
          'Formation': row.formation,
          'Well Status': row.well_status,
          'Latitude': row.latitude,
          'Longitude': row.longitude
        };

        if (!allMatches.has(apiNumber)) {
          allMatches.set(apiNumber, {
            record: fields,
            alertLevel: isDirectMatch ? 'YOUR PROPERTY' : 'ADJACENT SECTION'
          });
        } else if (isDirectMatch && allMatches.get(apiNumber).alertLevel !== 'YOUR PROPERTY') {
          allMatches.get(apiNumber).alertLevel = 'YOUR PROPERTY';
        }
      }
    } catch (err) {
      console.error(`[Backfill] Error querying batch ${i}:`, err.message);
    }

    if (i % 100 === 0 && i > 0) {
      console.log(`[Backfill] Processed ${i}/${sectionKeys.length} sections, found ${allMatches.size} matches so far`);
    }
  }

  console.log(`[Backfill] Found ${allMatches.size} unique historical matches across all properties`);

  // Check existing historical alerts to avoid duplicates
  // Fetch historical alerts and filter client-side by user (same ARRAYJOIN issue)
  const existingAlerts = new Set();
  try {
    const existingFormula = encodeURIComponent(`{Historical}=TRUE()`);

    let existingOffset = null;
    do {
      const existingUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}?filterByFormula=${existingFormula}&fields[]=API%20Number&fields[]=User${existingOffset ? `&offset=${existingOffset}` : ''}`;
      const existingResponse = await fetch(existingUrl, {
        headers: { 'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      });

      if (existingResponse.ok) {
        const existingData = await existingResponse.json();
        for (const rec of existingData.records || []) {
          // Filter client-side: check if User array contains userId
          const recUserIds = rec.fields.User || [];
          if (recUserIds.includes(userId) && rec.fields['API Number']) {
            existingAlerts.add(rec.fields['API Number']);
          }
        }
        existingOffset = existingData.offset;
      } else {
        existingOffset = null;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (existingOffset);
  } catch (err) {
    console.warn('[Backfill] Could not check existing alerts:', err.message);
  }

  // Create Activity Log entries in batches of 10 (Airtable batch limit)
  const toCreate = Array.from(allMatches.entries())
    .filter(([apiNumber]) => !existingAlerts.has(apiNumber));

  console.log(`[Backfill] Creating ${toCreate.length} new historical alerts (${existingAlerts.size} already existed)`);

  let created = 0;
  const errors = [];
  const CREATE_BATCH_SIZE = 10;

  for (let i = 0; i < toCreate.length; i += CREATE_BATCH_SIZE) {
    const batch = toCreate.slice(i, i + CREATE_BATCH_SIZE);

    const records = batch.map(([apiNumber, match]) => {
      const record = match.record;

      let activityType = 'New Well Record';
      if (record['Has Permit']) activityType = 'New Permit';
      if (record['Has Completion']) activityType = 'Well Completed';

      return {
        fields: {
          'Well Name': record['Well Name'] || 'Unknown',
          'API Number': apiNumber,
          'Activity Type': activityType,
          'Operator': record['Operator'] || 'Unknown',
          'Alert Level': match.alertLevel,
          'Section-Township-Range': `S${record['Surface Section']} T${record['Surface Township']} R${record['Surface Range']}`,
          'County': record['County'] || '',
          'Formation': record['Formation'] || null,
          'OCC Map Link': record['OCC Map Link'] || null,
          'Map Link': `https://portal.mymineralwatch.com/map?well=${apiNumber}`,
          'User': [userId],
          'Historical': true,
          'Email Sent': true,
          'Detected At': record['Permit Date'] || record['Completion Date'] || record['Created Date'] || new Date().toISOString(),
          'Notes': `Historical alert - activity from ${record['Created Date'] || 'unknown date'}`
        }
      };
    });

    try {
      const createResponse = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ records })
        }
      );

      if (createResponse.ok) {
        const result = await createResponse.json();
        created += result.records?.length || 0;
      } else {
        const errText = await createResponse.text();
        errors.push({ batch: i, error: errText });
      }

      await new Promise(resolve => setTimeout(resolve, 250));

    } catch (err) {
      errors.push({ batch: i, error: err.message });
    }

    // Progress logging
    if (i % 50 === 0 && i > 0) {
      console.log(`[Backfill] Created ${created} alerts so far...`);
    }
  }

  console.log(`[Backfill] Completed: ${created} historical alerts created for ${allProperties.length} properties`);

  return {
    success: true,
    userId,
    propertiesProcessed: allProperties.length,
    sectionsChecked: sectionMap.size,
    matchesFound: allMatches.size,
    alreadyExisted: existingAlerts.size,
    totalAlertsCreated: created,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Backfill for a newly created property (called from portal)
 * @param {Object} env - Worker environment
 * @param {string} propertyId - Property's Airtable record ID
 * @returns {Object} - Results of backfill
 */
export async function backfillNewProperty(env, propertyId) {
  // Fetch the property details from D1
  if (!env.WELLS_DB) {
    return { success: false, error: 'D1 not available' };
  }

  const prop = await env.WELLS_DB.prepare(`
    SELECT airtable_record_id, section, township, range, user_id
    FROM properties WHERE airtable_record_id = ?
  `).bind(propertyId).first();

  if (!prop) {
    return { success: false, error: 'Property not found' };
  }

  const userId = prop.user_id;
  if (!userId) {
    return { success: false, error: 'Property has no linked user' };
  }

  return backfillPropertyHistory(env, {
    propertyId: prop.airtable_record_id,
    section: prop.section,
    township: prop.township,
    range: prop.range,
    userId
  });
}
