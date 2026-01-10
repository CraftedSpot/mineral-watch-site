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
 * Map docket relief types to activity descriptions
 */
function getReliefTypeLabel(reliefType) {
  const labels = {
    'INCREASED_DENSITY': 'Increased Density Application',
    'POOLING': 'Pooling Application',
    'SPACING': 'Spacing Unit Application',
    'LOCATION_EXCEPTION': 'Location Exception Application',
    'OPERATOR_CHANGE': 'Operator Change Filing',
    'HORIZONTAL_WELL': 'Horizontal Well Application',
    'ORDER_MODIFICATION': 'Order Modification',
    'WELL_TRANSFER': 'Well Transfer Application',
    'OTHER': 'OCC Docket Filing'
  };
  return labels[reliefType] || 'OCC Docket Filing';
}

/**
 * Build docket alert email HTML
 */
function buildDocketAlertEmail(entry, alertLevel, user) {
  const reliefLabel = getReliefTypeLabel(entry.relief_type);

  const subject = `OCC Filing Alert: ${reliefLabel} - ${alertLevel}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 20px;">OCC Docket Filing Alert</h1>
    <p style="margin: 5px 0 0 0; opacity: 0.9;">${reliefLabel}</p>
  </div>

  <div style="background: ${alertLevel === 'YOUR PROPERTY' ? '#fef3c7' : '#dbeafe'}; padding: 12px 20px; border-left: 4px solid ${alertLevel === 'YOUR PROPERTY' ? '#f59e0b' : '#3b82f6'};">
    <strong>${alertLevel}</strong>
  </div>

  <div style="padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; width: 140px; color: #6b7280;"><strong>Case Number</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${entry.case_number}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Applicant</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${entry.applicant || 'Not specified'}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Location</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
          Section ${entry.section}, T${entry.township}, R${entry.range}<br>
          <span style="color: #6b7280;">${entry.county || ''} County, Oklahoma</span>
        </td>
      </tr>
      ${entry.relief_sought ? `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Relief Sought</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${entry.relief_sought}</td>
      </tr>
      ` : ''}
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Hearing Date</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${entry.hearing_date || 'TBD'} ${entry.hearing_time || ''}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Status</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${entry.status}</td>
      </tr>
      ${entry.judge ? `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;"><strong>Judge</strong></td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${entry.judge}</td>
      </tr>
      ` : ''}
    </table>

    ${entry.source_url ? `
    <div style="margin-top: 20px;">
      <a href="${entry.source_url}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500;">
        View Full Docket PDF
      </a>
    </div>
    ` : ''}
  </div>

  <div style="padding: 15px 20px; background: #f3f4f6; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280;">
    <p style="margin: 0;">
      This filing was found in the OCC docket dated ${entry.docket_date}.
      Docket filings typically appear 2-4 weeks before official records are updated.
    </p>
    <p style="margin: 10px 0 0 0;">
      <a href="https://mymineralwatch.com" style="color: #2563eb;">MyMineralWatch.com</a>
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

    // Find matching properties
    const matches = await findMatchingProperties(location, env);

    if (matches.length === 0) {
      processedIds.push(entry.id);
      continue;
    }

    console.log(`[Docket] ${entry.case_number}: ${matches.length} matching properties`);

    for (const match of matches) {
      if (dryRun) {
        console.log(`[Docket DRY RUN] Would alert ${match.user.email} for ${entry.case_number}`);
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
