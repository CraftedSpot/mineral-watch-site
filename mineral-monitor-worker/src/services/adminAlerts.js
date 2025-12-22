/**
 * Admin Alerts Service - Notifies you of worker health and issues
 */

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';
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
  const { permitsProcessed, completionsProcessed, statusChanges, alertsSent, errors, duration } = results;
  
  // Query for today's failed email sends
  let failedEmails = [];
  try {
    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // Query Activity Log for today's records where Email Sent = false
    const response = await fetch(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_ACTIVITY_TABLE}?filterByFormula=AND(DATESTR({Created})='${today}',NOT({Email Sent}))&fields[]=User&fields[]=API Number&fields[]=Well Name`,
      {
        headers: {
          'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      if (data.records && data.records.length > 0) {
        // Group failed sends by user email
        const userEmailMap = new Map();
        
        for (let i = 0; i < data.records.length; i++) {
          const record = data.records[i];
          if (record.fields.User && record.fields.User[0]) {
            // Add delay between API calls to respect rate limit
            if (i > 0) {
              await delay(200);
            }
            
            // Need to fetch user email
            const userResponse = await fetch(
              `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_USERS_TABLE}/${record.fields.User[0]}?fields[]=Email`,
              {
                headers: {
                  'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`
                }
              }
            );
            
            if (userResponse.ok) {
              const userData = await userResponse.json();
              const email = userData.fields.Email;
              const wellInfo = `${record.fields['Well Name'] || 'Unknown'} (${record.fields['API Number'] || 'No API'})`;
              
              if (!userEmailMap.has(email)) {
                userEmailMap.set(email, []);
              }
              userEmailMap.get(email).push(wellInfo);
            }
          }
        }
        
        // Convert to array format
        failedEmails = Array.from(userEmailMap.entries()).map(([email, wells]) => ({
          email,
          wells: wells.slice(0, 3), // Limit to first 3 wells per user
          totalCount: wells.length
        }));
      }
    }
  } catch (err) {
    console.error('[AdminAlert] Error querying failed emails:', err);
  }
  
  const hasErrors = errors && errors.length > 0;
  const hasFailedEmails = failedEmails.length > 0;
  const priority = hasErrors || hasFailedEmails ? 'warning' : 'info';
  
  const body = `
Daily Monitor Run Complete
==========================

Permits Processed: ${permitsProcessed || 0}
Completions Processed: ${completionsProcessed || 0}
Status Changes Detected: ${statusChanges || 0}
Alerts Sent: ${alertsSent || 0}
Emails Failed: ${failedEmails.reduce((sum, f) => sum + f.totalCount, 0)}
Duration: ${duration}ms
${hasErrors ? `\nProcessing Errors (${errors.length}):\n${errors.map(e => `  - ${e}`).join('\n')}` : ''}
${hasFailedEmails ? `
Failed Email Sends:
${failedEmails.map(f => `  - ${f.email}: ${f.totalCount} alert${f.totalCount > 1 ? 's' : ''} failed
    Wells: ${f.wells.join(', ')}${f.totalCount > 3 ? ` ... and ${f.totalCount - 3} more` : ''}`).join('\n')}

ACTION REQUIRED: Check Postmark logs and Activity Log for details.` : ''}

${!hasErrors && !hasFailedEmails ? 'No action required.' : ''}
  `.trim();
  
  await sendAdminAlert(env, `Daily Run: ${alertsSent} alerts sent${hasFailedEmails ? ', FAILURES DETECTED' : ''}`, body, priority);
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