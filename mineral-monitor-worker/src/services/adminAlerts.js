/**
 * Admin Alerts Service - Notifies you of worker health and issues
 */

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';
const ADMIN_EMAIL = 'james@mymineralwatch.com'; // Or use env.ADMIN_EMAIL

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
    const response = await fetch(POSTMARK_API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: 'system@mymineralwatch.com',
        To: env.ADMIN_EMAIL || ADMIN_EMAIL,
        Subject: fullSubject,
        TextBody: `${body}\n\n---\nTimestamp: ${new Date().toISOString()}`,
        MessageStream: 'outbound'
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
  const { permitsProcessed, completionsProcessed, alertsSent, errors, duration } = results;
  
  const hasErrors = errors && errors.length > 0;
  const priority = hasErrors ? 'warning' : 'info';
  
  const body = `
Daily Monitor Run Complete
==========================

Permits Processed: ${permitsProcessed || 0}
Completions Processed: ${completionsProcessed || 0}
Alerts Sent: ${alertsSent || 0}
Duration: ${duration}ms
${hasErrors ? `\nErrors (${errors.length}):\n${errors.map(e => `  - ${e}`).join('\n')}` : ''}

No action required.
  `.trim();
  
  await sendAdminAlert(env, `Daily Run: ${alertsSent} alerts sent`, body, priority);
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
${hasErrors ? `\nErrors (${errors.length}):\n${errors.map(e => `  - ${e}`).join('\n')}` : ''}

No action required.
  `.trim();
  
  await sendAdminAlert(env, `Weekly Run: ${alertsSent} alerts sent`, body, priority);
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
 * Send sanity check warnings
 */
export async function sendSanityWarning(env, issue, details) {
  const body = `
Sanity Check Warning
====================

Issue: ${issue}

${details}

This may indicate a problem with OCC data files or worker configuration.
  `.trim();
  
  await sendAdminAlert(env, issue, body, 'warning');
}