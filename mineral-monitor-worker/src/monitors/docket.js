/**
 * OCC Docket Monitor
 *
 * Fetches OCC court docket PDFs, parses them, stores entries in D1,
 * matches to user properties, and sends alerts.
 *
 * Runs on weekdays via cron - dockets are posted for upcoming hearings.
 */

import {
  buildDocketUrl,
  fetchDocketPdf,
  extractTextFromPdf,
  parseFromText,
  filterRelevantEntries
} from '../services/docketParser.js';
import { findMatchingWells } from '../services/matching.js';
import { createActivityLog, getUserById } from '../services/airtable.js';
import {
  isUserOverPlanLimit,
  batchGetPropertiesByLocations,
  batchGetUsers,
  getOrganizationById as getD1OrgById,
  getOrganizationMembers
} from '../services/d1.js';
import { normalizeSection } from '../utils/normalize.js';
import { getAdjacentSections, getExtendedAdjacentSections } from '../utils/plss.js';
import {
  getEffectiveNotificationMode,
  getDigestFrequency,
  shouldQueueWeekly,
  queuePendingAlert,
  getOrganizationById
} from '../services/pendingAlerts.js';

/**
 * Generate unique ID for docket entry
 */
function generateEntryId(entry) {
  // Use case number + docket date as unique identifier
  return `${entry.case_number}_${entry.source_date || 'unknown'}`;
}

/**
 * Store parsed entries in D1, skipping duplicates
 */
async function storeDocketEntries(db, entries) {
  let inserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    const id = generateEntryId(entry);

    // Serialize additional_sections to JSON if present
    const additionalSectionsJson = entry.additional_sections
      ? JSON.stringify(entry.additional_sections)
      : null;

    // Serialize api_numbers to JSON if present
    const apiNumbersJson = entry.api_numbers
      ? JSON.stringify(entry.api_numbers)
      : null;

    try {
      await db.prepare(`
        INSERT INTO occ_docket_entries (
          id, case_number, relief_type, relief_type_raw, relief_sought,
          applicant, county, section, township, range, meridian,
          additional_sections, api_numbers,
          hearing_date, hearing_time, status, continuation_date,
          judge, attorney, courtroom, notes, result_raw,
          docket_date, docket_type, source_url, raw_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(case_number) DO UPDATE SET
          status = excluded.status,
          continuation_date = excluded.continuation_date,
          result_raw = excluded.result_raw,
          additional_sections = COALESCE(excluded.additional_sections, additional_sections),
          api_numbers = COALESCE(excluded.api_numbers, api_numbers),
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        id,
        entry.case_number,
        entry.relief_type,
        entry.relief_type_raw,
        entry.relief_sought,
        entry.applicant,
        entry.county,
        entry.section,
        entry.township,
        entry.range,
        entry.meridian || (['CIMARRON', 'TEXAS', 'BEAVER'].includes(entry.county?.toUpperCase()) ? 'CM' : 'IM'),
        additionalSectionsJson,
        apiNumbersJson,
        entry.hearing_date,
        entry.hearing_time,
        entry.status,
        entry.continuation_date,
        entry.judge,
        entry.attorney,
        entry.courtroom,
        entry.notes,
        entry.result_raw,
        entry.source_date,
        entry.source_type,
        entry.source_url,
        entry.raw_text
      ).run();

      inserted++;

      // Sync junction table for additional_sections (used by property-link-counts)
      if (entry.additional_sections && entry.additional_sections.length > 0) {
        try {
          await db.prepare('DELETE FROM docket_entry_sections WHERE case_number = ?')
            .bind(entry.case_number).run();
          for (const sec of entry.additional_sections) {
            const normSec = parseInt(sec.section, 10);
            if (isNaN(normSec)) continue;
            const twn = (sec.township || '').toString().trim().toUpperCase();
            const rng = (sec.range || '').toString().trim().toUpperCase();
            if (!twn || !rng) continue;
            const meridian = sec.meridian?.toUpperCase() ||
              (['CIMARRON', 'TEXAS', 'BEAVER'].includes(entry.county?.toUpperCase()) ? 'CM' : 'IM');
            await db.prepare(`
              INSERT OR IGNORE INTO docket_entry_sections (case_number, section, township, range, meridian)
              VALUES (?, ?, ?, ?, ?)
            `).bind(entry.case_number, String(normSec), twn, rng, meridian).run();
          }
        } catch (jErr) {
          console.error(`[Docket] Error syncing junction sections for ${entry.case_number}:`, jErr.message);
        }
      }
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        skipped++;
      } else {
        console.error(`[Docket] Error storing entry ${entry.case_number}:`, err.message);
      }
    }
  }

  console.log(`[Docket] Stored ${inserted} entries, skipped ${skipped} duplicates`);
  return { inserted, skipped };
}

/**
 * Get entries that haven't been processed for alerts yet
 */
async function getUnalertedEntries(db) {
  const result = await db.prepare(`
    SELECT * FROM occ_docket_entries
    WHERE alerted_at IS NULL
    AND relief_type != 'OTHER'
    AND relief_type != 'ENFORCEMENT'
    ORDER BY docket_date DESC
  `).all();

  return result.results || [];
}

/**
 * Mark entries as alerted
 */
async function markEntriesAlerted(db, entryIds) {
  if (entryIds.length === 0) return;

  const now = new Date().toISOString();
  // D1 has a ~100 bind variable limit. 1 variable per ID + 1 for timestamp.
  const CHUNK_SIZE = 90;

  for (let i = 0; i < entryIds.length; i += CHUNK_SIZE) {
    const chunk = entryIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');

    await db.prepare(`
      UPDATE occ_docket_entries
      SET alerted_at = ?
      WHERE id IN (${placeholders})
    `).bind(now, ...chunk).run();
  }
}

/**
 * Relief type explanations for mineral owners
 */
const RELIEF_EXPLANATIONS = {
  POOLING: {
    title: 'Pooling Application',
    emoji: '📋',
    meaning: 'An operator is combining mineral interests into a drilling unit. If you own unleased minerals, you may receive a pooling offer.',
    tip: 'Watch for a pooling order in the mail. You typically have 20 days to respond.'
  },
  INCREASED_DENSITY: {
    title: 'Increased Density Application',
    emoji: '📈',
    meaning: 'Operator wants to drill additional wells in an existing unit.',
    tip: 'More wells could mean more royalty income from your minerals.'
  },
  SPACING: {
    title: 'Spacing Unit Application',
    emoji: '📐',
    meaning: 'Operator is establishing or modifying a drilling unit that includes your minerals.',
    tip: 'This determines how royalties are divided among mineral owners in the unit.'
  },
  LOCATION_EXCEPTION: {
    title: 'Location Exception',
    emoji: '📍',
    meaning: 'Operator needs permission to drill at a non-standard location.',
    tip: 'Common for horizontal wells needing surface location flexibility.'
  },
  HORIZONTAL_WELL: {
    title: 'Horizontal Well Application',
    emoji: '↔️',
    meaning: 'A horizontal well may cross multiple sections including yours.',
    tip: 'Larger units mean more owners sharing royalties, but often higher total production.'
  },
  OPERATOR_CHANGE: {
    title: 'Operator Change',
    emoji: '🔄',
    meaning: 'Well operations are transferring to a new company.',
    tip: 'Expect royalty checks from the new operator. Watch for a new division order.'
  },
  WELL_TRANSFER: {
    title: 'Well Transfer',
    emoji: '🔄',
    meaning: 'Ownership or operational control of wells is being transferred.',
    tip: 'Your division order may need to be updated with the new operator.'
  },
  ORDER_MODIFICATION: {
    title: 'Order Modification',
    emoji: '📝',
    meaning: 'An existing OCC order is being amended or modified.',
    tip: 'Review how changes might affect your royalty payments or working interest.'
  },
  OTHER: {
    title: 'OCC Filing',
    emoji: '📋',
    meaning: 'A legal filing has been made that may affect your mineral interests.',
    tip: 'Review the full docket for details on how this may impact your property.'
  }
};

/**
 * Get relief explanation for a given type
 */
function getReliefExplanation(reliefType) {
  return RELIEF_EXPLANATIONS[reliefType] || RELIEF_EXPLANATIONS.OTHER;
}

/**
 * Map docket relief types to activity descriptions
 */
function getReliefTypeLabel(reliefType) {
  const explanation = getReliefExplanation(reliefType);
  return explanation.title;
}

/**
 * Build docket alert email HTML
 * @param {Object} entry - Docket entry
 * @param {Object} match - Match object with alertLevel, user, and optional well info
 */
function buildDocketAlertEmail(entry, match) {
  const explanation = getReliefExplanation(entry.relief_type);
  const { alertLevel, user, isWellMatch, matchedAPI, well } = match;

  // Determine display text and color based on match type
  let alertLevelDisplay;
  let alertColor;
  let matchDescription;

  if (isWellMatch && well) {
    // Well-based match
    alertLevelDisplay = '🛢️ TRACKED WELL';
    alertColor = '#7c3aed'; // Purple for well matches
    const wellName = well.fields?.Name || well.fields?.['Well Name'] || 'Unknown Well';
    const apiDisplay = matchedAPI || well.fields?.['API Number'] || '';
    matchDescription = `<strong>${wellName}</strong>${apiDisplay ? ` (API: ${apiDisplay})` : ''}`;
  } else if (alertLevel === 'YOUR PROPERTY') {
    // Direct property match
    alertLevelDisplay = '🎯 YOUR PROPERTY';
    alertColor = '#dc2626'; // Red
    matchDescription = `Section ${entry.section}, T${entry.township}, R${entry.range}`;
  } else {
    // Adjacent property match
    alertLevelDisplay = '📍 ADJACENT TO YOUR PROPERTY';
    alertColor = '#2563eb'; // Blue
    matchDescription = `Section ${entry.section}, T${entry.township}, R${entry.range}`;
  }

  const subject = `${explanation.emoji} ${explanation.title} - ${alertLevel} - ${entry.county} County`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <!-- Alert Level Banner -->
  <div style="background: ${alertColor}; color: white; padding: 12px 20px; font-size: 14px; font-weight: bold; text-align: center; border-radius: 4px 4px 0 0;">
    ${alertLevelDisplay}
  </div>

  <!-- Match Description -->
  <div style="background: ${alertColor}15; padding: 10px 20px; border: 1px solid ${alertColor}40; border-top: none; text-align: center; font-size: 13px; color: #374151;">
    ${matchDescription}
  </div>

  <!-- Relief Type Header -->
  <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
    <h2 style="margin: 0 0 10px 0; color: #1e293b;">${explanation.emoji} ${explanation.title}</h2>
  </div>

  <!-- Explanation Box -->
  <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 4px; padding: 16px; margin: 20px 0;">
    <p style="margin: 0 0 10px 0; color: #92400e;">
      <strong>What this means:</strong><br>
      ${explanation.meaning}
    </p>
    <p style="margin: 0; color: #92400e;">
      <strong>💡 Tip:</strong> ${explanation.tip}
    </p>
  </div>

  <!-- Details Table -->
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #f8fafc; width: 140px;"><strong>Case Number</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">${entry.case_number}</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #f8fafc;"><strong>Applicant</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">${entry.applicant || 'Not specified'}</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #f8fafc;"><strong>Location</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">
        Section ${entry.section}, T${entry.township}, R${entry.range}, ${entry.county} County
      </td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #f8fafc;"><strong>Hearing Date</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">${entry.hearing_date || 'TBD'} ${entry.hearing_time || ''}</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #f8fafc;"><strong>Status</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">${entry.status}</td>
    </tr>
    ${entry.judge ? `
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #f8fafc;"><strong>Judge</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">${entry.judge}</td>
    </tr>
    ` : ''}
    ${entry.attorney ? `
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #f8fafc;"><strong>Attorney</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0;">${entry.attorney}</td>
    </tr>
    ` : ''}
    ${entry.status === 'CONTINUED' && entry.continuation_date ? `
    <tr>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #fef3c7;"><strong>Continued To</strong></td>
      <td style="padding: 10px; border: 1px solid #e2e8f0; background: #fef3c7;">${entry.continuation_date}</td>
    </tr>
    ` : ''}
  </table>

  <!-- Relief Sought -->
  ${entry.relief_sought ? `
  <div style="margin: 20px 0;">
    <p style="margin: 0 0 8px 0; font-weight: bold; color: #475569;">Relief Sought:</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 12px;">
      ${entry.relief_sought}
    </div>
  </div>
  ` : ''}

  <!-- Notes (if present) -->
  ${entry.notes ? `
  <div style="margin: 20px 0;">
    <p style="margin: 0 0 8px 0; font-weight: bold; color: #475569;">Notes:</p>
    <div style="background: #fefce8; border: 1px solid #fcd34d; border-radius: 4px; padding: 12px;">
      ${entry.notes}
    </div>
  </div>
  ` : ''}

  <!-- CTA Buttons -->
  <div style="text-align: center; margin: 30px 0;">
    ${entry.source_url ? `
    <a href="${entry.source_url}"
       style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 5px;">
      View Full Docket PDF
    </a>
    ` : ''}
    ${(entry.status === 'HEARD' || entry.status === 'RECOMMENDED') ? `
    <a href="https://portal.mymineralwatch.com/analyze?case=${encodeURIComponent(entry.case_number)}"
       style="background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin: 5px;">
      Analyze Order →
    </a>
    ` : ''}
  </div>

  <!-- Footer -->
  <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 30px; color: #64748b; font-size: 13px;">
    <p style="margin: 0 0 10px 0;">
      This filing appeared in the OCC docket dated ${entry.docket_date}.
      Docket filings typically appear <strong>2-4 weeks before</strong> official records are updated.
    </p>
    <p style="margin: 0;">
      <a href="https://portal.mymineralwatch.com" style="color: #2563eb;">Mineral Watch</a> ·
      Early warning for Oklahoma mineral owners
    </p>
  </div>

</body>
</html>
  `;

  return { subject, html };
}

/**
 * Create Activity Log entry in Airtable (batched)
 */
async function createActivityLogEntries(env, alertsToLog) {
  if (alertsToLog.length === 0) return;

  const BATCH_SIZE = 10;
  const batches = [];

  for (let i = 0; i < alertsToLog.length; i += BATCH_SIZE) {
    batches.push(alertsToLog.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const records = batch.map(alert => ({
      fields: {
        'Detected At': new Date().toISOString(),
        'Activity Type': getReliefTypeLabel(alert.entry.relief_type),
        'Alert Level': alert.alertLevel,
        'User': [alert.userId],
        'Property': alert.propertyId ? [alert.propertyId] : undefined,
        'Section': alert.entry.section,
        'Township': alert.entry.township,
        'Range': alert.entry.range,
        'County': alert.entry.county,
        'Operator': alert.entry.applicant,
        'Case Number': alert.entry.case_number,
        'Source URL': alert.entry.source_url,
        'Notes': `Hearing: ${alert.entry.hearing_date || 'TBD'}. ${alert.entry.relief_sought || ''}`
      }
    }));

    try {
      await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records })
      });
    } catch (err) {
      console.error('[Docket] Error creating Activity Log entries:', err.message);
    }
  }
}

/**
 * Deduplicate matches by case_number + userId, keeping highest priority
 * Priority: YOUR PROPERTY > ADJACENT SECTION
 */
function deduplicateMatches(entry, matches) {
  const matchesByUser = new Map();

  for (const match of matches) {
    const key = `${entry.case_number}|${match.user.id}`;
    const existing = matchesByUser.get(key);

    if (!existing) {
      matchesByUser.set(key, match);
    } else {
      // Keep higher priority match (YOUR PROPERTY > ADJACENT)
      if (match.alertLevel === 'YOUR PROPERTY' && existing.alertLevel !== 'YOUR PROPERTY') {
        matchesByUser.set(key, match);
      }
    }
  }

  return Array.from(matchesByUser.values());
}

/**
 * Batch load all properties needed for docket alert matching.
 * Collects all TRS locations (primary + additional + adjacent sections)
 * from all entries and queries D1 in batches instead of per-entry.
 */
async function batchLoadDocketProperties(entries, env) {
  const sectionsToLoad = new Set();
  const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];

  for (const entry of entries) {
    if (!entry.section || !entry.township || !entry.range) continue;

    const meridian = entry.meridian ||
      (panhandleCounties.includes(entry.county?.toUpperCase()) ? 'CM' : 'IM');
    const normalizedSec = normalizeSection(entry.section);
    const useExtendedGrid = entry.relief_type === 'HORIZONTAL_WELL';

    // Primary location
    sectionsToLoad.add(`${normalizedSec}|${entry.township}|${entry.range}|${meridian}`);

    // Adjacent sections for primary location
    const adjacents = useExtendedGrid
      ? getExtendedAdjacentSections(parseInt(normalizedSec, 10), entry.township, entry.range)
      : getAdjacentSections(parseInt(normalizedSec, 10), entry.township, entry.range);
    for (const adj of adjacents) {
      sectionsToLoad.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${meridian}`);
    }

    // Additional sections (multi-section orders)
    if (entry.additional_sections) {
      let addlSections = [];
      try {
        addlSections = typeof entry.additional_sections === 'string'
          ? JSON.parse(entry.additional_sections)
          : entry.additional_sections;
      } catch (e) { /* ignore parse errors */ }

      for (const addl of addlSections) {
        const addlMeridian = addl.meridian || entry.meridian || meridian;
        const addlNormSec = normalizeSection(addl.section);
        sectionsToLoad.add(`${addlNormSec}|${addl.township}|${addl.range}|${addlMeridian}`);

        const addlAdj = useExtendedGrid
          ? getExtendedAdjacentSections(parseInt(addlNormSec, 10), addl.township, addl.range)
          : getAdjacentSections(parseInt(addlNormSec, 10), addl.township, addl.range);
        for (const adj of addlAdj) {
          sectionsToLoad.add(`${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${addlMeridian}`);
        }
      }
    }
  }

  console.log(`[Docket] Batch loading properties for ${sectionsToLoad.size} unique sections`);

  const locations = Array.from(sectionsToLoad).map(key => {
    const [section, township, range, meridian] = key.split('|');
    return { section, township, range, meridian };
  });

  const properties = await batchGetPropertiesByLocations(env, locations);

  // Index by section key for O(1) lookup
  const propertyMap = new Map();
  for (const prop of properties) {
    const key = `${prop.fields.SEC}|${prop.fields.TWN}|${prop.fields.RNG}|${prop.fields.MERIDIAN}`;
    if (!propertyMap.has(key)) {
      propertyMap.set(key, []);
    }
    propertyMap.get(key).push(prop);
  }

  console.log(`[Docket] Loaded ${properties.length} properties across ${propertyMap.size} sections from D1`);
  return propertyMap;
}

/**
 * Collect all unique user IDs from a preloaded property map for batch user loading.
 */
function collectDocketUserIds(propertyMap) {
  const userIds = new Set();
  for (const properties of propertyMap.values()) {
    for (const prop of properties) {
      if (prop._user && prop._user.id) {
        userIds.add(prop._user.id);
      }
    }
  }
  return Array.from(userIds);
}

/**
 * Find matches using preloaded property map and user/org caches.
 * Equivalent to findMatchingProperties() but O(1) map lookups instead of D1 queries.
 * Handles both individual users and organization members.
 */
async function findDocketMatchesInMap(location, propertyMap, userCache, orgCache, env, options = {}) {
  const { section, township, range, meridian, county } = location;
  const normalizedSec = normalizeSection(section);

  const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
  const effectiveMeridian = meridian ||
    (county && panhandleCounties.includes(county.toUpperCase()) ? 'CM' : 'IM');

  const matches = [];
  const seenUsers = new Set();

  // Helper to add matches for a property (handles individual + org users)
  async function addMatchesForProp(prop, alertLevel, matchedSection, permitSection) {
    // Case 1: Individual user linked to property
    if (prop._user && prop._user.id) {
      const userId = prop._user.id;
      if (!seenUsers.has(userId)) {
        const user = userCache.get(userId);
        if (user && user.fields.Status === 'Active') {
          seenUsers.add(userId);
          const match = {
            property: prop,
            user: { id: user.id, email: user.fields.Email, name: user.fields.Name },
            alertLevel,
            matchedSection
          };
          if (permitSection) match.permitSection = permitSection;
          matches.push(match);
        }
      }
    }

    // Case 2: Organization linked to property — get all org members
    const orgIds = prop.fields.Organization;
    if (orgIds && orgIds.length > 0) {
      const orgId = orgIds[0];

      // Lazy-load org data into cache (typically only 1-5 unique orgs)
      if (!orgCache.has(orgId)) {
        const org = await getD1OrgById(env, orgId);
        const members = org ? await getOrganizationMembers(env, orgId) : [];
        orgCache.set(orgId, { org, members });
      }

      const { org, members } = orgCache.get(orgId);
      if (org) {
        for (const orgUser of members) {
          if (!seenUsers.has(orgUser.id)) {
            seenUsers.add(orgUser.id);
            const match = {
              property: prop,
              user: { id: orgUser.id, email: orgUser.fields.Email, name: orgUser.fields.Name },
              alertLevel,
              matchedSection,
              organizationId: orgId,
              viaOrganization: org.fields.Name
            };
            if (permitSection) match.permitSection = permitSection;
            matches.push(match);
          }
        }
      }
    }
  }

  // Direct property matches
  const directKey = `${normalizedSec}|${township}|${range}|${effectiveMeridian}`;
  const directProperties = propertyMap.get(directKey) || [];

  for (const prop of directProperties) {
    await addMatchesForProp(prop, 'YOUR PROPERTY', `${normalizedSec}-${township}-${range}`, null);
  }

  // Adjacent section matches
  const adjacentSections = options.useExtendedGrid
    ? getExtendedAdjacentSections(parseInt(normalizedSec, 10), township, range)
    : getAdjacentSections(parseInt(normalizedSec, 10), township, range);

  for (const adj of adjacentSections) {
    const adjKey = `${normalizeSection(adj.section)}|${adj.township}|${adj.range}|${effectiveMeridian}`;
    const adjProperties = propertyMap.get(adjKey) || [];

    for (const prop of adjProperties) {
      if (!prop.fields['Monitor Adjacent']) continue;

      await addMatchesForProp(
        prop,
        'ADJACENT SECTION',
        `${normalizeSection(prop.fields.SEC)}-${prop.fields.TWN}-${prop.fields.RNG}`,
        `${normalizedSec}-${township}-${range}`
      );
    }
  }

  return matches;
}

/**
 * Process alerts for new docket entries
 */
async function processDocketAlerts(env, dryRun = false) {
  const entries = await getUnalertedEntries(env.WELLS_DB);

  if (entries.length === 0) {
    console.log('[Docket] No new entries to alert on');
    return 0;
  }

  console.log(`[Docket] Processing alerts for ${entries.length} entries`);

  // PRELOAD: Batch load all properties and users for O(1) matching
  // Replaces per-entry D1 queries with a single batch load upfront
  const propertyMap = await batchLoadDocketProperties(entries, env);
  const preloadUserIds = collectDocketUserIds(propertyMap);
  const userCache = await batchGetUsers(env, preloadUserIds);
  const orgCache = new Map(); // Lazily populated per org on first encounter
  console.log(`[Docket] Preloaded ${propertyMap.size} sections, ${userCache.size} users for matching`);

  let alertCount = 0;
  const processedIds = [];
  // Cache plan limit checks per run to avoid repeated D1 queries
  const planLimitCache = new Map();

  // Collect all matches across entries for cross-entry dedup
  // Key: userId|section-township-range|alertLevel -> first match wins
  const userSectionAlerted = new Set();
  const allAlerts = [];

  for (const entry of entries) {
    // Skip entries without location data
    if (!entry.section || !entry.township || !entry.range) {
      console.log(`[Docket] Skipping ${entry.case_number} - missing location data`);
      processedIds.push(entry.id);
      continue;
    }

    // Build primary location object for matching
    const primaryLocation = {
      section: entry.section,
      township: entry.township,
      range: entry.range,
      meridian: entry.meridian || null,  // findDocketMatchesInMap infers from county for panhandle
      county: entry.county
    };

    // Parse additional sections if present (stored as JSON)
    let additionalSections = [];
    if (entry.additional_sections) {
      try {
        additionalSections = typeof entry.additional_sections === 'string'
          ? JSON.parse(entry.additional_sections)
          : entry.additional_sections;
      } catch (e) {
        console.error(`[Docket] Error parsing additional_sections for ${entry.case_number}:`, e.message);
      }
    }

    // Use extended 5x5 grid (24 sections) for horizontal wells since they span multiple sections
    // Standard 3x3 grid (8 adjacent) for all other relief types
    const useExtendedGrid = entry.relief_type === 'HORIZONTAL_WELL';

    // Find matching properties for primary location (uses preloaded map)
    let rawMatches = await findDocketMatchesInMap(primaryLocation, propertyMap, userCache, orgCache, env, { useExtendedGrid });

    // Also check additional sections (multi-section orders)
    if (additionalSections.length > 0) {
      console.log(`[Docket] ${entry.case_number}: Checking ${additionalSections.length} additional sections`);

      for (const addlSection of additionalSections) {
        const addlLocation = {
          section: addlSection.section,
          township: addlSection.township,
          range: addlSection.range,
          meridian: addlSection.meridian || entry.meridian || null,
          county: addlSection.county || entry.county
        };

        const addlMatches = await findDocketMatchesInMap(addlLocation, propertyMap, userCache, orgCache, env, { useExtendedGrid });
        rawMatches = rawMatches.concat(addlMatches);
      }
    }

    // API number matching for Location Exception and Change of Operator entries
    // These relief types often reference specific wells by API
    const wellBasedReliefTypes = ['LOCATION_EXCEPTION', 'OPERATOR_CHANGE'];

    if (wellBasedReliefTypes.includes(entry.relief_type) && entry.api_numbers) {
      // Parse API numbers from entry
      let apiNumbers = [];
      try {
        apiNumbers = typeof entry.api_numbers === 'string'
          ? JSON.parse(entry.api_numbers)
          : entry.api_numbers;
      } catch (e) {
        console.error(`[Docket] Error parsing api_numbers for ${entry.case_number}:`, e.message);
      }

      if (apiNumbers.length > 0) {
        console.log(`[Docket] ${entry.case_number}: Checking ${apiNumbers.length} API numbers for well matches`);

        for (const api of apiNumbers) {
          try {
            const wellMatches = await findMatchingWells(api, env);

            // Mark these matches as well-based (vs property-based)
            for (const wellMatch of wellMatches) {
              wellMatch.alertLevel = 'TRACKED WELL';
              wellMatch.matchedAPI = api;
              wellMatch.isWellMatch = true;
            }

            rawMatches = rawMatches.concat(wellMatches);
          } catch (err) {
            console.error(`[Docket] Error finding well matches for API ${api}:`, err.message);
          }
        }
      }
    }

    if (rawMatches.length === 0) {
      processedIds.push(entry.id);
      continue;
    }

    // Deduplicate: if user matches both direct AND adjacent, keep only direct
    const matches = deduplicateMatches(entry, rawMatches);

    console.log(`[Docket] ${entry.case_number}: ${rawMatches.length} raw matches, ${matches.length} after dedupe`);

    for (const match of matches) {
      // Cross-entry dedup for ADJACENT SECTION alerts:
      // If same user already alerted for the same section in this batch, skip
      if (match.alertLevel === 'ADJACENT SECTION') {
        const str = `${entry.section}-${entry.township}-${entry.range}`;
        const dedupKey = `${match.user.id}|${str}|ADJACENT`;
        if (userSectionAlerted.has(dedupKey)) {
          console.log(`[Docket] Skipping duplicate adjacent alert for ${match.user.email} section ${str}`);
          continue;
        }
        userSectionAlerted.add(dedupKey);
      }

      allAlerts.push({ entry, match });
    }

    processedIds.push(entry.id);
  }

  // Now process all collected alerts: create activity logs and queue for digest
  for (const { entry, match } of allAlerts) {
    if (dryRun) {
      console.log(`[Docket DRY RUN] Would queue ${match.user.email} (${match.alertLevel}) for ${entry.case_number}`);
      alertCount++;
      continue;
    }

    try {
      const reliefLabel = getReliefTypeLabel(entry.relief_type);
      const str = `${entry.section}-${entry.township}-${entry.range}`;

      // Compute meaningful display name based on match type
      let displayName;
      if (match.isWellMatch && match.well) {
        // Tracked well match — use actual well name
        displayName = match.well.fields?.['Well Name'] || match.well.fields?.Name || entry.case_number;
      } else {
        // Property match — use operator + relief type (what mineral owners recognize)
        displayName = entry.applicant
          ? `${entry.applicant} - ${reliefLabel}`
          : entry.case_number;
      }

      // Create D1 activity log entry
      const activityLog = await createActivityLog(env, {
        userId: match.user.id,
        organizationId: match.organizationId || null,
        apiNumber: match.matchedAPI || null,
        wellName: displayName,
        operator: entry.applicant,
        activityType: reliefLabel,
        alertLevel: match.alertLevel,
        county: entry.county,
        sectionTownshipRange: str,
        occLink: entry.source_url || null,
        mapLink: null,
        caseNumber: entry.case_number
      });

      // Get user's notification mode for digest frequency
      const user = await getUserById(env, match.user.id);
      const userOrgId = user?.fields?.Organization?.[0] || null;
      const organization = userOrgId ? await getOrganizationById(env, userOrgId) : null;
      const notificationMode = getEffectiveNotificationMode(user, organization);

      if (notificationMode === 'None') {
        console.log(`[Docket] Skipping ${match.user.email} - notifications disabled`);
        continue;
      }

      // Check plan limits — skip alerts for users who exceed their plan
      const dkPlan = user?.fields?.Plan || 'Free';
      if (!planLimitCache.has(match.user.id)) {
        planLimitCache.set(match.user.id, await isUserOverPlanLimit(env, match.user.id, dkPlan));
      }
      if (planLimitCache.get(match.user.id)) {
        console.log(`[Docket] Skipped alert for ${match.user.email} - over ${dkPlan} plan limit`);
        continue;
      }

      const digestFrequency = getDigestFrequency(notificationMode);
      if (!digestFrequency) continue;

      // Queue for daily digest
      await queuePendingAlert(env, {
        userId: match.user.id,
        userEmail: match.user.email,
        organizationId: match.organizationId || null,
        activityLogId: activityLog.id,
        activityType: reliefLabel,
        wellName: displayName,
        apiNumber: match.matchedAPI || null,
        operator: entry.applicant,
        county: entry.county,
        sectionTownshipRange: str,
        alertLevel: match.alertLevel,
        digestFrequency: digestFrequency,
        caseNumber: entry.case_number
      });

      // For 'Daily + Weekly' users, also queue for weekly
      if (shouldQueueWeekly(notificationMode) && digestFrequency === 'daily') {
        await queuePendingAlert(env, {
          userId: match.user.id,
          userEmail: match.user.email,
          organizationId: match.organizationId || null,
          activityLogId: null,
          activityType: reliefLabel,
          wellName: displayName,
          apiNumber: match.matchedAPI || null,
          operator: entry.applicant,
          county: entry.county,
          sectionTownshipRange: str,
          alertLevel: match.alertLevel,
          digestFrequency: 'weekly',
          caseNumber: entry.case_number
        });
      }

      alertCount++;
      console.log(`[Docket] Queued ${reliefLabel} alert for ${match.user.email} (${match.alertLevel}) - ${entry.case_number}`);

    } catch (err) {
      console.error(`[Docket] Error queuing alert for ${match.user.email}:`, err.message);
    }
  }

  // Mark all processed entries as alerted
  if (!dryRun) {
    await markEntriesAlerted(env.WELLS_DB, processedIds);
  }

  return alertCount;
}

/**
 * Main docket monitoring function
 * Called by cron trigger
 */
export async function runDocketMonitor(env, options = {}) {
  console.log('[Docket Monitor] Starting...');

  const dryRun = env.DRY_RUN === 'true' || options.dryRun;
  const today = new Date();

  const results = {
    dryRun,
    fetched: 0,
    parsed: 0,
    stored: 0,
    alerts: 0,
    errors: []
  };

  const lookbackDays = options.lookbackDays || 7;

  // Process both OKC and Tulsa dockets
  for (const docketType of ['okc', 'tulsa']) {
    try {
      // Look back N days to catch any missed dockets from prior runs.
      // Duplicates are handled by ON CONFLICT(case_number) in storeDocketEntries.
      for (let daysAgo = 0; daysAgo < lookbackDays; daysAgo++) {
        const date = new Date(today);
        date.setDate(date.getDate() - daysAgo);

        // Skip weekends - no dockets posted
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        const dateStr = date.toISOString().split('T')[0];
        const url = buildDocketUrl(dateStr, docketType);

        console.log(`[Docket] Fetching ${docketType} docket for ${dateStr}`);

        try {
          // Fetch PDF
          const pdfBuffer = await fetchDocketPdf(url);
          results.fetched++;

          // Extract text
          const text = await extractTextFromPdf(pdfBuffer);

          // Parse entries
          const metadata = { date: dateStr, type: docketType, url };
          const entries = parseFromText(text, metadata);
          results.parsed += entries.length;

          console.log(`[Docket] Parsed ${entries.length} entries from ${docketType} ${dateStr}`);

          // Filter to relevant entries and store
          const relevant = filterRelevantEntries(entries);
          if (relevant.length > 0 && !dryRun) {
            const { inserted } = await storeDocketEntries(env.WELLS_DB, relevant);
            results.stored += inserted;
          } else if (dryRun) {
            console.log(`[Docket DRY RUN] Would store ${relevant.length} relevant entries`);
            results.stored += relevant.length;
          }

        } catch (fetchErr) {
          if (fetchErr.message.includes('not found') || fetchErr.message.includes('404')) {
            console.log(`[Docket] No docket found for ${docketType} ${dateStr}`);
          } else {
            throw fetchErr;
          }
        }
      }
    } catch (err) {
      console.error(`[Docket Monitor] Error processing ${docketType}:`, err.message);
      results.errors.push(`${docketType}: ${err.message}`);
    }
  }

  // Process alerts for new entries
  if (!options.skipAlerts) {
    try {
      const alertCount = await processDocketAlerts(env, dryRun);
      results.alerts = alertCount;
    } catch (err) {
      console.error('[Docket Monitor] Error processing alerts:', err.message);
      results.errors.push(`alerts: ${err.message}`);
    }
  }

  console.log('[Docket Monitor] Complete:', results);
  return results;
}
