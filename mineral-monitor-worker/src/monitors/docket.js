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
import { findMatchingProperties } from '../services/matching.js';
import { sendEmail } from '../services/email.js';

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

    try {
      await db.prepare(`
        INSERT INTO occ_docket_entries (
          id, case_number, relief_type, relief_type_raw, relief_sought,
          applicant, county, section, township, range, meridian,
          hearing_date, hearing_time, status, continuation_date,
          judge, attorney, courtroom, notes, result_raw,
          docket_date, docket_type, source_url, raw_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(case_number) DO UPDATE SET
          status = excluded.status,
          continuation_date = excluded.continuation_date,
          result_raw = excluded.result_raw,
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
        entry.meridian || 'IM',
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
  const placeholders = entryIds.map(() => '?').join(',');

  await db.prepare(`
    UPDATE occ_docket_entries
    SET alerted_at = ?
    WHERE id IN (${placeholders})
  `).bind(now, ...entryIds).run();
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
 */
function buildDocketAlertEmail(entry, alertLevel, user) {
  const explanation = getReliefExplanation(entry.relief_type);

  const alertLevelDisplay = alertLevel === 'YOUR PROPERTY'
    ? '🎯 YOUR PROPERTY'
    : '📍 ADJACENT TO YOUR PROPERTY';

  const alertColor = alertLevel === 'YOUR PROPERTY' ? '#dc2626' : '#2563eb';

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
 * Process alerts for new docket entries
 */
async function processDocketAlerts(env, dryRun = false) {
  const entries = await getUnalertedEntries(env.WELLS_DB);

  if (entries.length === 0) {
    console.log('[Docket] No new entries to alert on');
    return 0;
  }

  console.log(`[Docket] Processing alerts for ${entries.length} entries`);

  let alertCount = 0;
  const processedIds = [];
  const alertsToLog = [];

  for (const entry of entries) {
    // Skip entries without location data
    if (!entry.section || !entry.township || !entry.range) {
      console.log(`[Docket] Skipping ${entry.case_number} - missing location data`);
      processedIds.push(entry.id);
      continue;
    }

    // Build location object for matching
    const location = {
      section: entry.section,
      township: entry.township,
      range: entry.range,
      meridian: entry.meridian || 'IM',
      county: entry.county
    };

    // Use extended 5x5 grid (24 sections) for horizontal wells since they span multiple sections
    // Standard 3x3 grid (8 adjacent) for all other relief types
    const useExtendedGrid = entry.relief_type === 'HORIZONTAL_WELL';

    // Find matching properties
    const rawMatches = await findMatchingProperties(location, env, { useExtendedGrid });

    if (rawMatches.length === 0) {
      processedIds.push(entry.id);
      continue;
    }

    // Deduplicate: if user matches both direct AND adjacent, keep only direct
    const matches = deduplicateMatches(entry, rawMatches);

    console.log(`[Docket] ${entry.case_number}: ${rawMatches.length} raw matches, ${matches.length} after dedupe`);

    for (const match of matches) {
      if (dryRun) {
        console.log(`[Docket DRY RUN] Would alert ${match.user.email} (${match.alertLevel}) for ${entry.case_number}`);
        alertCount++;
        continue;
      }

      // Build and send email
      const { subject, html } = buildDocketAlertEmail(entry, match.alertLevel, match.user);

      try {
        await sendEmail(env, {
          to: match.user.email,
          subject,
          html
        });
        alertCount++;

        // Queue for Activity Log
        alertsToLog.push({
          entry,
          alertLevel: match.alertLevel,
          userId: match.user.id,
          propertyId: match.property?.id
        });

      } catch (err) {
        console.error(`[Docket] Error sending alert to ${match.user.email}:`, err.message);
      }
    }

    processedIds.push(entry.id);
  }

  // Batch create Activity Log entries
  if (!dryRun && alertsToLog.length > 0) {
    await createActivityLogEntries(env, alertsToLog);
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

  // Process both OKC and Tulsa dockets
  for (const docketType of ['okc', 'tulsa']) {
    try {
      // Try today and yesterday (dockets may be posted day before)
      for (const daysAgo of [0, 1]) {
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
