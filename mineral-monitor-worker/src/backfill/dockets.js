/**
 * Historical Docket Backfill
 *
 * Populates D1 with ~160K historical docket entries from 2023-2025.
 * Data only — no alerts, no Activity Log entries.
 */

import {
  buildDocketUrl,
  fetchDocketPdf,
  extractTextFromPdf,
  parseFromText,
  filterRelevantEntries
} from '../services/docketParser.js';

const EARLIEST_DATE = '2023-01-03';
const DOCKET_TYPES = ['okc', 'tulsa'];
const DELAY_MS = 500; // Be nice to OCC servers
const BATCH_SIZE = 50; // D1 batch limit

/**
 * Check if backfill is currently running (prevent cron conflicts)
 */
export async function isBackfillRunning(env) {
  const running = await env.MINERAL_CACHE.get('backfill:running');
  return running === 'true';
}

/**
 * Set backfill lock
 */
async function setBackfillLock(env, running) {
  if (running) {
    // Lock expires after 10 minutes (safety)
    await env.MINERAL_CACHE.put('backfill:running', 'true', { expirationTtl: 600 });
  } else {
    await env.MINERAL_CACHE.delete('backfill:running');
  }
}

/**
 * Get/set progress for resumability
 */
async function getProgress(env) {
  const progress = await env.MINERAL_CACHE.get('backfill:progress');
  return progress ? JSON.parse(progress) : null;
}

async function setProgress(env, date, stats) {
  await env.MINERAL_CACHE.put('backfill:progress', JSON.stringify({
    lastDate: date,
    updatedAt: new Date().toISOString(),
    stats
  }));
}

/**
 * Generate unique ID for docket entry
 */
function generateEntryId(entry) {
  return `${entry.case_number}_${entry.source_date || 'unknown'}`;
}

/**
 * Store entries using D1 batch API with alerted_at set
 */
async function storeEntriesBatch(db, entries, sourceUrl) {
  if (entries.length === 0) return 0;

  let stored = 0;
  const now = new Date().toISOString();

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    const statements = batch.map(entry => {
      const id = generateEntryId(entry);

      // Serialize additional_sections to JSON if present
      const additionalSectionsJson = entry.additional_sections
        ? JSON.stringify(entry.additional_sections)
        : null;

      // Serialize api_numbers to JSON if present
      const apiNumbersJson = entry.api_numbers
        ? JSON.stringify(entry.api_numbers)
        : null;

      return db.prepare(`
        INSERT INTO occ_docket_entries (
          id, case_number, relief_type, relief_type_raw, relief_sought,
          applicant, county, section, township, range, meridian,
          additional_sections, api_numbers,
          hearing_date, hearing_time, status, continuation_date,
          judge, attorney, courtroom, notes, result_raw,
          docket_date, docket_type, source_url, raw_text,
          order_number, related_order_numbers, alerted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(case_number) DO NOTHING
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
        sourceUrl,
        entry.raw_text,
        entry.order_number || null,
        entry.related_order_numbers ? JSON.stringify(entry.related_order_numbers) : null,
        now // alerted_at - prevents live monitor from alerting on backfilled entries
      );
    });

    try {
      await db.batch(statements);
      stored += batch.length;
    } catch (err) {
      // If batch fails, try individual inserts (some may be dupes)
      for (const stmt of statements) {
        try {
          await stmt.run();
          stored++;
        } catch (individualErr) {
          // Likely duplicate, ignore
          if (!individualErr.message.includes('UNIQUE')) {
            console.error(`[Backfill] Store error:`, individualErr.message);
          }
        }
      }
    }
  }

  return stored;
}

/**
 * Fetch and parse a single docket
 */
async function fetchAndParseDocket(date, type) {
  const dateStr = date.toISOString().split('T')[0];
  const url = buildDocketUrl(dateStr, type);

  try {
    const pdfBuffer = await fetchDocketPdf(url);
    const text = await extractTextFromPdf(pdfBuffer);
    const metadata = { date: dateStr, type, url };
    const entries = parseFromText(text, metadata);
    const relevant = filterRelevantEntries(entries);

    return { success: true, entries: relevant, url, dateStr, type };
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('404')) {
      return { success: false, skipped: true, dateStr, type };
    }
    return { success: false, error: err.message, dateStr, type };
  }
}

/**
 * Process a single date (parallel fetch OKC + Tulsa)
 */
async function processDate(env, date) {
  const results = await Promise.all(
    DOCKET_TYPES.map(type => fetchAndParseDocket(date, type))
  );

  let entriesStored = 0;
  let docketsFetched = 0;
  let docketsSkipped = 0;
  const errors = [];

  for (const result of results) {
    if (result.success) {
      docketsFetched++;
      const stored = await storeEntriesBatch(env.WELLS_DB, result.entries, result.url);
      entriesStored += stored;
    } else if (result.skipped) {
      docketsSkipped++;
    } else {
      errors.push({ date: result.dateStr, type: result.type, error: result.error });
    }
  }

  return { entriesStored, docketsFetched, docketsSkipped, errors };
}

/**
 * Check if date is a weekday
 */
function isWeekday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Get yesterday's date
 */
function getYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Main backfill function for a date range
 *
 * @param {Object} env - Worker environment
 * @param {string} startDate - Start date (YYYY-MM-DD) or 'resume' to continue from last progress
 * @param {string} endDate - End date (YYYY-MM-DD) or 'yesterday' for dynamic end
 */
export async function backfillDateRange(env, startDate, endDate) {
  const stats = {
    docketsFetched: 0,
    docketsSkipped: 0,
    entriesStored: 0,
    datesProcessed: 0,
    errors: [],
    startedAt: new Date().toISOString()
  };

  // Check if already running
  if (await isBackfillRunning(env)) {
    return { error: 'Backfill already running', stats };
  }

  // Set lock
  await setBackfillLock(env, true);

  try {
    // Handle 'resume' start date
    let start;
    if (startDate === 'resume') {
      const progress = await getProgress(env);
      if (progress && progress.lastDate) {
        start = parseDate(progress.lastDate);
        start.setDate(start.getDate() + 1); // Start from day after last processed
        console.log(`[Backfill] Resuming from ${formatDate(start)}`);
      } else {
        start = parseDate(EARLIEST_DATE);
        console.log(`[Backfill] No progress found, starting from ${EARLIEST_DATE}`);
      }
    } else {
      start = parseDate(startDate);
    }

    // Handle 'yesterday' end date
    const end = endDate === 'yesterday' ? getYesterday() : parseDate(endDate);

    console.log(`[Backfill] Processing ${formatDate(start)} to ${formatDate(end)}`);

    let current = new Date(start);

    while (current <= end) {
      // Skip weekends
      if (!isWeekday(current)) {
        current.setDate(current.getDate() + 1);
        continue;
      }

      const dateStr = formatDate(current);

      try {
        const result = await processDate(env, current);

        stats.docketsFetched += result.docketsFetched;
        stats.docketsSkipped += result.docketsSkipped;
        stats.entriesStored += result.entriesStored;
        stats.datesProcessed++;
        stats.errors.push(...result.errors);

        // Update progress
        await setProgress(env, dateStr, {
          docketsFetched: stats.docketsFetched,
          entriesStored: stats.entriesStored
        });

        // Log progress every 10 dates
        if (stats.datesProcessed % 10 === 0) {
          console.log(`[Backfill] Progress: ${dateStr} | Dates: ${stats.datesProcessed} | Entries: ${stats.entriesStored}`);
        }

        // Rate limiting - one delay per date (both dockets fetched in parallel)
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));

      } catch (err) {
        stats.errors.push({ date: dateStr, error: err.message });
        console.error(`[Backfill] Error on ${dateStr}:`, err.message);
      }

      current.setDate(current.getDate() + 1);
    }

    stats.completedAt = new Date().toISOString();
    console.log(`[Backfill] Complete:`, stats);

  } finally {
    // Release lock
    await setBackfillLock(env, false);
  }

  return stats;
}

/**
 * Get backfill status
 */
export async function getBackfillStatus(env) {
  const running = await isBackfillRunning(env);
  const progress = await getProgress(env);

  // Get current counts from D1
  const countResult = await env.WELLS_DB.prepare(`
    SELECT
      COUNT(*) as total,
      MIN(docket_date) as earliest,
      MAX(docket_date) as latest
    FROM occ_docket_entries
  `).first();

  return {
    running,
    progress,
    database: countResult
  };
}

/**
 * Clear backfill progress (for fresh start)
 */
export async function clearBackfillProgress(env) {
  await env.MINERAL_CACHE.delete('backfill:progress');
  await env.MINERAL_CACHE.delete('backfill:running');
  return { cleared: true };
}
