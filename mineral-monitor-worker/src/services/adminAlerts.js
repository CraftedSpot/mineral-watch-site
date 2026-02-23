/**
 * Admin Alerts Service - Notifies you of worker health and issues
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const ADMIN_EMAIL = 'james@mymineralwatch.com'; // Or use env.ADMIN_EMAIL

/**
 * Simple delay function for rate limiting
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Send admin alert email
 * @param {Object} env - Worker environment
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text)
 * @param {string} priority - 'critical', 'warning', or 'info'
 */
export async function sendAdminAlert(env, subject, body, priority = 'info') {
  const emoji = {
    critical: '🚨',
    warning: '⚠️',
    info: '✅'
  }[priority] || '📊';
  
  const fullSubject = `${emoji} Mineral Watch: ${subject}`;
  
  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: env.ADMIN_EMAIL || ADMIN_EMAIL,
        subject: fullSubject,
        text: `${body}\n\n---\nTimestamp: ${new Date().toISOString()}`
      })
    });
    
    if (!response.ok) {
      console.error(`[AdminAlert] Failed to send: ${response.status}`);
    }
  } catch (err) {
    // Don't throw - admin alerts should never break the worker
    console.error(`[AdminAlert] Error sending alert:`, err.message);
  }
}

/**
 * Send daily run summary
 */
export async function sendDailySummary(env, results) {
  const { permitsProcessed, completionsProcessed, permitsSkippedAsProcessed, completionsSkippedAsProcessed, statusChanges, alertsSent, errors, duration, dataFreshness } = results;
  
  // Query for today's failed email sends from D1
  let failedEmails = [];
  try {
    const today = new Date().toISOString().split('T')[0];

    if (env.WELLS_DB) {
      // Single D1 query with JOIN — no N+1 Airtable fetches
      const { results: failedRows } = await env.WELLS_DB.prepare(`
        SELECT al.user_id, al.api_number, al.well_name, u.email
        FROM activity_log al
        LEFT JOIN users u ON u.airtable_record_id = al.user_id
        WHERE date(al.detected_at) = ? AND al.email_sent = 0
      `).bind(today).all();

      if (failedRows && failedRows.length > 0) {
        const userEmailMap = new Map();
        for (const row of failedRows) {
          const email = row.email || 'unknown';
          const wellInfo = `${row.well_name || 'Unknown'} (${row.api_number || 'No API'})`;
          if (!userEmailMap.has(email)) {
            userEmailMap.set(email, []);
          }
          userEmailMap.get(email).push(wellInfo);
        }

        failedEmails = Array.from(userEmailMap.entries()).map(([email, wells]) => ({
          email,
          wells: wells.slice(0, 3),
          totalCount: wells.length
        }));
      }
    }
  } catch (err) {
    console.error('[AdminAlert] Error querying failed emails:', err);
  }
  
  const hasErrors = errors && errors.length > 0;
  const hasFailedEmails = failedEmails.length > 0;
  const hasStaleData = dataFreshness && (dataFreshness.permits?.isStale || dataFreshness.completions?.isStale);
  const priority = hasErrors || hasFailedEmails || hasStaleData ? 'warning' : 'info';

  // Format data freshness info
  let freshnessInfo = '';
  if (dataFreshness) {
    const formatFreshness = (data, label) => {
      if (!data) return `${label}: N/A`;
      if (data.totalRecords === 0) return `${label}: ⚠️ FILE EMPTY`;
      const lastNew = data.daysSinceNewRecords !== null
        ? `last new ${data.daysSinceNewRecords}d ago`
        : 'tracking started';
      return `${label}: ${data.totalRecords} in file, ${lastNew}${data.isStale ? ' ⚠️ NO NEW DATA' : ''}`;
    };

    freshnessInfo = `
OCC 7-Day Rolling Files:
  - ${formatFreshness(dataFreshness.permits, 'Permits')}
  - ${formatFreshness(dataFreshness.completions, 'Completions')}`;
  }

  // Calculate totals for context
  const totalPermitsInFile = (permitsProcessed || 0) + (permitsSkippedAsProcessed || 0);
  const totalCompletionsInFile = (completionsProcessed || 0) + (completionsSkippedAsProcessed || 0);

  const body = `
Daily Monitor Run Complete
==========================

Permits: ${permitsProcessed || 0} new / ${totalPermitsInFile} total in OCC file (${permitsSkippedAsProcessed || 0} already processed)
Completions: ${completionsProcessed || 0} new / ${totalCompletionsInFile} total in OCC file (${completionsSkippedAsProcessed || 0} already processed)
Status Changes Detected: ${statusChanges || 0}
Alerts Sent: ${alertsSent || 0}
Emails Failed: ${failedEmails.reduce((sum, f) => sum + f.totalCount, 0)}
Duration: ${duration}ms
${freshnessInfo}
${hasErrors ? `\nProcessing Errors (${errors.length}):\n${errors.map(e => typeof e === 'object' ? `  - ${e.type || e.api || 'unknown'}: ${e.error || JSON.stringify(e)}` : `  - ${e}`).join('\n')}` : ''}
${hasFailedEmails ? `
Failed Email Sends:
${failedEmails.map(f => `  - ${f.email}: ${f.totalCount} alert${f.totalCount > 1 ? 's' : ''} failed
    Wells: ${f.wells.join(', ')}${f.totalCount > 3 ? ` ... and ${f.totalCount - 3} more` : ''}`).join('\n')}

ACTION REQUIRED: Check Resend logs and Activity Log for details.` : ''}

${!hasErrors && !hasFailedEmails ? 'No action required.' : ''}
  `.trim();
  
  const staleWarning = hasStaleData ? ', OCC DATA STALE' : '';
  await sendAdminAlert(env, `Daily Run: ${alertsSent} alerts sent${hasFailedEmails ? ', FAILURES DETECTED' : ''}${staleWarning}`, body, priority);
}

/**
 * Send weekly run summary  
 */
export async function sendWeeklySummary(env, results) {
  const { transfersProcessed, statusChanges, alertsSent, errors, duration } = results;
  
  const hasErrors = errors && errors.length > 0;
  const priority = hasErrors ? 'warning' : 'info';
  
  const body = `
Weekly Monitor Run Complete
===========================

Transfers Processed: ${transfersProcessed || 0}
Status Changes: ${statusChanges || 0}
Alerts Sent: ${alertsSent || 0}
Duration: ${duration}ms
${hasErrors ? `\nErrors (${errors.length}):\n${errors.map(e => typeof e === 'object' ? `  - ${e.type || e.api || 'unknown'}: ${e.error || JSON.stringify(e)}` : `  - ${e}`).join('\n')}` : ''}

No action required.
  `.trim();
  
  await sendAdminAlert(env, `Weekly Run: ${alertsSent} alerts sent`, body, priority);
}

/**
 * Send docket monitor run summary
 */
export async function sendDocketSummary(env, results) {
  const { fetched, parsed, stored, alerts, errors, duration } = results;

  const hasErrors = errors && errors.length > 0;
  const priority = hasErrors ? 'warning' : 'info';

  const body = `
Docket Monitor Run Complete
============================

PDFs Fetched: ${fetched || 0} (OKC + Tulsa, 7-day lookback)
Entries Parsed: ${parsed || 0}
New Entries Stored: ${stored || 0}
Alerts Sent: ${alerts || 0}
Duration: ${duration}ms
${hasErrors ? `\nErrors (${errors.length}):\n${errors.map(e => typeof e === 'object' ? `  - ${e.type || e.api || 'unknown'}: ${e.error || JSON.stringify(e)}` : `  - ${e}`).join('\n')}` : ''}

${!hasErrors ? 'No action required.' : ''}
  `.trim();

  await sendAdminAlert(env, `Docket Monitor: ${parsed} entries, ${alerts} alerts${hasErrors ? ' (ERRORS)' : ''}`, body, priority);
}

/**
 * Send critical failure alert
 */
export async function sendFailureAlert(env, cronPattern, error) {
  const runType = cronPattern.includes('0 12') ? 'Daily' : 'Weekly';
  
  const body = `
${runType} Monitor FAILED
${'='.repeat(30)}

Cron: ${cronPattern}
Error: ${error.message}

Stack Trace:
${error.stack || 'No stack trace available'}

ACTION REQUIRED: Check worker logs in Cloudflare dashboard.
  `.trim();
  
  await sendAdminAlert(env, `${runType} Run FAILED`, body, 'critical');
}

/**
 * Send sanity check warnings (with deduplication - max once per 24 hours per issue)
 */
export async function sendSanityWarning(env, issue, details) {
  // Create a cache key to deduplicate warnings
  const cacheKey = `sanity-warning:${issue.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;

  // Check if we've already warned about this issue in the last 24 hours
  try {
    const lastWarning = await env.MINERAL_CACHE.get(cacheKey);
    if (lastWarning) {
      console.log(`[AdminAlert] Skipping duplicate sanity warning for: ${issue} (last sent: ${lastWarning})`);
      return;
    }
  } catch (err) {
    console.warn('[AdminAlert] Failed to check sanity warning cache:', err.message);
  }

  const body = `
Sanity Check Warning
====================

Issue: ${issue}

${details}

This may indicate a problem with OCC data files or worker configuration.
  `.trim();

  await sendAdminAlert(env, issue, body, 'warning');

  // Mark this warning as sent (expires in 24 hours)
  try {
    await env.MINERAL_CACHE.put(cacheKey, new Date().toISOString(), {
      expirationTtl: 24 * 60 * 60 // 24 hours
    });
  } catch (err) {
    console.warn('[AdminAlert] Failed to cache sanity warning:', err.message);
  }
}