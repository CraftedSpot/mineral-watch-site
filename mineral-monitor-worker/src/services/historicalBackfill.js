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

    // Build filter formula for this section
    // Check both surface location and BH location
    const formula = encodeURIComponent(
      `AND(
        OR(
          AND({Surface Section}='${sec}', {Surface Township}='${twn}', {Surface Range}='${rng}'),
          AND({BH Section}='${sec}', {BH Township}='${twn}', {BH Range}='${rng}')
        ),
        {Created Date}>='${sinceDateStr}'
      )`.replace(/\s+/g, ' ')
    );

    try {
      const response = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_STATEWIDE_ACTIVITY_TABLE}?filterByFormula=${formula}`,
        {
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.records && data.records.length > 0) {
          for (const record of data.records) {
            // Determine if this is a direct match or adjacent
            const surfaceMatch =
              normalizeSection(record.fields['Surface Section']) === sec &&
              record.fields['Surface Township'] === twn &&
              record.fields['Surface Range'] === rng;

            const bhMatch =
              normalizeSection(record.fields['BH Section']) === sec &&
              record.fields['BH Township'] === twn &&
              record.fields['BH Range'] === rng;

            const isDirectMatch = (surfaceMatch || bhMatch) &&
              sectionKey === `${normalizedSection}|${township}|${range}`;

            matches.push({
              record: record.fields,
              recordId: record.id,
              matchedSection: sectionKey,
              alertLevel: isDirectMatch ? 'YOUR PROPERTY' : 'ADJACENT SECTION'
            });
          }
        }
      }

      // Rate limiting - small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 100));

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

  // Get all active properties and filter by user client-side
  // (Airtable ARRAYJOIN on linked records returns display names, not IDs)
  let allProperties = [];
  let offset = null;

  do {
    // Fetch active properties with pagination
    const formula = encodeURIComponent(`{Status}='Active'`);
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_PROPERTIES_TABLE}?filterByFormula=${formula}${offset ? `&offset=${offset}` : ''}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `Failed to fetch properties: ${errText}` };
    }

    const data = await response.json();

    // Filter to properties belonging to this user (check User array for userId)
    const userProperties = (data.records || []).filter(prop => {
      const userIds = prop.fields.User || [];
      return userIds.includes(userId);
    });

    allProperties = allProperties.concat(userProperties);
    offset = data.offset;

    await new Promise(resolve => setTimeout(resolve, 200));
  } while (offset);

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

  // Query Statewide Activity in batches (Airtable formula has length limits)
  // Group sections into batches of ~20 to keep formula manageable
  const sectionKeys = Array.from(sectionMap.keys());
  const BATCH_SIZE = 20;
  const allMatches = new Map(); // API Number -> match info

  for (let i = 0; i < sectionKeys.length; i += BATCH_SIZE) {
    const batch = sectionKeys.slice(i, i + BATCH_SIZE);

    // Build OR conditions for this batch
    const conditions = batch.map(key => {
      const [sec, twn, rng] = key.split('|');
      return `OR(AND({Surface Section}='${sec}',{Surface Township}='${twn}',{Surface Range}='${rng}'),AND({BH Section}='${sec}',{BH Township}='${twn}',{BH Range}='${rng}'))`;
    }).join(',');

    const formula = encodeURIComponent(
      `AND(OR(${conditions}),{Created Date}>='${sinceDateStr}')`
    );

    try {
      const response = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_STATEWIDE_ACTIVITY_TABLE}?filterByFormula=${formula}`,
        { headers: { 'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
      );

      if (response.ok) {
        const data = await response.json();
        for (const record of data.records || []) {
          const apiNumber = record.fields['API Number'];
          if (!apiNumber) continue;

          // Determine which sections this record matches
          const surfaceSec = normalizeSection(record.fields['Surface Section']);
          const surfaceKey = `${surfaceSec}|${record.fields['Surface Township']}|${record.fields['Surface Range']}`;
          const bhSec = normalizeSection(record.fields['BH Section']);
          const bhKey = bhSec ? `${bhSec}|${record.fields['BH Township']}|${record.fields['BH Range']}` : null;

          // Check if it's a direct match to any property
          const surfaceMatch = sectionMap.get(surfaceKey);
          const bhMatch = bhKey ? sectionMap.get(bhKey) : null;

          const isDirectMatch = (surfaceMatch?.isDirectMatch || bhMatch?.isDirectMatch);

          if (!allMatches.has(apiNumber)) {
            allMatches.set(apiNumber, {
              record: record.fields,
              alertLevel: isDirectMatch ? 'YOUR PROPERTY' : 'ADJACENT SECTION'
            });
          } else if (isDirectMatch && allMatches.get(apiNumber).alertLevel !== 'YOUR PROPERTY') {
            // Upgrade to YOUR PROPERTY if this is a direct match
            allMatches.get(apiNumber).alertLevel = 'YOUR PROPERTY';
          }
        }
      }

      // Rate limiting between batches
      await new Promise(resolve => setTimeout(resolve, 250));

    } catch (err) {
      console.error(`[Backfill] Error querying batch ${i}:`, err.message);
    }

    // Progress logging for large batches
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
  // Fetch the property details
  const response = await fetch(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_PROPERTIES_TABLE}/${propertyId}`,
    {
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`
      }
    }
  );

  if (!response.ok) {
    return { success: false, error: 'Property not found' };
  }

  const prop = await response.json();
  const userId = prop.fields['User']?.[0];

  if (!userId) {
    return { success: false, error: 'Property has no linked user' };
  }

  return backfillPropertyHistory(env, {
    propertyId: prop.id,
    section: prop.fields['SEC'],
    township: prop.fields['TWN'],
    range: prop.fields['RNG'],
    userId
  });
}
