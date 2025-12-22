/**
 * Email Batch Service - Groups and sends batched alert emails
 * Reduces email volume by combining multiple alerts per category
 */

import { sendAlertEmail } from './email.js';
import { createActivityLog, updateActivityLog } from './airtable.js';

/**
 * Process and send batched emails for all collected alerts
 * @param {Object} env - Worker environment
 * @param {Map} userAlertMap - Map of userId -> array of alerts
 * @param {boolean} dryRun - Whether this is a dry run
 * @returns {Object} - Results of email sending
 */
export async function sendBatchedEmails(env, userAlertMap, dryRun = false) {
  const results = {
    emailsSent: 0,
    alertsSent: 0,
    errors: []
  };

  // Process each user's alerts
  for (const [userId, userAlerts] of userAlertMap.entries()) {
    try {
      // Group alerts by category
      const permitAlerts = userAlerts.filter(a => a.activityType === 'Intent to Drill - New Permit');
      const completionAlerts = userAlerts.filter(a => a.activityType === 'Well Completed');
      const transferAlerts = userAlerts.filter(a => a.activityType === 'Operator Transfer');

      // Send batched email for permits
      if (permitAlerts.length > 0) {
        const sent = await sendBatchedCategoryEmail(env, userId, permitAlerts, 'permits', dryRun);
        if (sent) {
          results.emailsSent++;
          results.alertsSent += permitAlerts.length;
        }
      }

      // Send batched email for completions
      if (completionAlerts.length > 0) {
        const sent = await sendBatchedCategoryEmail(env, userId, completionAlerts, 'completions', dryRun);
        if (sent) {
          results.emailsSent++;
          results.alertsSent += completionAlerts.length;
        }
      }

      // Send batched email for transfers
      if (transferAlerts.length > 0) {
        const sent = await sendBatchedCategoryEmail(env, userId, transferAlerts, 'transfers', dryRun);
        if (sent) {
          results.emailsSent++;
          results.alertsSent += transferAlerts.length;
        }
      }
    } catch (error) {
      console.error(`[EmailBatch] Error processing user ${userId}:`, error);
      results.errors.push({ userId, error: error.message });
    }
  }

  return results;
}

/**
 * Send a batched email for a specific category
 */
async function sendBatchedCategoryEmail(env, userId, alerts, category, dryRun) {
  if (alerts.length === 0) return false;
  
  // Get user info from first alert
  const firstAlert = alerts[0];
  const userEmail = firstAlert.user.email;
  const userName = firstAlert.user.name;

  if (dryRun) {
    console.log(`[EmailBatch] DRY RUN: Would send ${category} email to ${userEmail} with ${alerts.length} alerts`);
    alerts.forEach(a => {
      console.log(`  - ${a.wellName} (${a.apiNumber}) - ${a.alertLevel}`);
    });
    return true;
  }

  // Create activity logs for all alerts
  const activityRecords = [];
  for (const alert of alerts) {
    const activityData = {
      wellName: alert.wellName,
      apiNumber: alert.apiNumber,
      activityType: alert.activityType,
      operator: alert.operator,
      operatorPhone: alert.operatorPhone,
      alertLevel: alert.alertLevel,
      sectionTownshipRange: alert.location,
      county: alert.county,
      occLink: alert.occLink || null,
      mapLink: alert.mapLink || "",
      userId: alert.user.id,
      formation: alert.formation || null,
      coordinateSource: alert.coordinateSource || null
    };

    const record = await createActivityLog(env, activityData);
    activityRecords.push(record);
  }

  // Determine email type based on category and count
  let emailType = 'single';
  if (alerts.length > 1) {
    emailType = category === 'permits' ? 'multiple-permits' : 
                 category === 'completions' ? 'multiple-completions' : 
                 'multiple-transfers';
  }

  try {
    // Send the batched email
    if (alerts.length === 1) {
      // Single alert - use existing email format
      await sendAlertEmail(env, alerts[0]);
    } else {
      // Multiple alerts - send batched email
      await sendBatchedAlertEmail(env, {
        to: userEmail,
        userName: userName,
        category: category,
        alerts: alerts,
        userId: userId
      });
    }

    // Update all activity logs to mark emails as sent
    for (const record of activityRecords) {
      await updateActivityLog(env, record.id, { 'Email Sent': true });
    }

    console.log(`[EmailBatch] Sent ${category} email to ${userEmail} with ${alerts.length} alerts`);
    return true;
  } catch (emailError) {
    console.error(`[EmailBatch] Failed to send ${category} email to ${userEmail}:`, emailError.message);
    // Activity logs remain with Email Sent = false
    return false;
  }
}

/**
 * Send a batched alert email with multiple wells
 */
async function sendBatchedAlertEmail(env, data) {
  const { to, userName, category, alerts, userId } = data;
  
  // Group alerts by alert level
  const yourPropertyAlerts = alerts.filter(a => a.alertLevel === 'YOUR PROPERTY');
  const adjacentAlerts = alerts.filter(a => a.alertLevel === 'ADJACENT TO YOUR PROPERTY');
  const trackedAlerts = alerts.filter(a => a.alertLevel === 'TRACKED WELL');

  // Build email subject
  let subject = '';
  const totalCount = alerts.length;
  
  if (category === 'permits') {
    subject = `${totalCount} New Drilling Permit${totalCount > 1 ? 's' : ''} Filed`;
  } else if (category === 'completions') {
    subject = `${totalCount} Well Completion${totalCount > 1 ? 's' : ''} Reported`;
  } else {
    subject = `${totalCount} Operator Transfer${totalCount > 1 ? 's' : ''}`;
  }

  // Add priority indicator
  if (yourPropertyAlerts.length > 0) {
    subject += ' - YOUR PROPERTY AFFECTED';
  }

  // Build HTML content
  let htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1e293b; margin-bottom: 24px;">${subject}</h2>
      
      <p style="color: #475569; margin-bottom: 24px;">
        Hello ${userName || 'there'},<br><br>
        We've detected ${totalCount} ${category === 'permits' ? 'new drilling permit' : category === 'completions' ? 'well completion' : 'operator transfer'}${totalCount > 1 ? 's' : ''} 
        that may affect your mineral interests:
      </p>
  `;

  // Add sections for each alert level
  if (yourPropertyAlerts.length > 0) {
    htmlContent += buildAlertSection('On Your Property', yourPropertyAlerts, '#dc2626');
  }
  
  if (adjacentAlerts.length > 0) {
    htmlContent += buildAlertSection('Adjacent to Your Property', adjacentAlerts, '#ea580c');
  }
  
  if (trackedAlerts.length > 0) {
    htmlContent += buildAlertSection('Tracked Wells', trackedAlerts, '#0891b2');
  }

  // Add footer
  htmlContent += `
      <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">
          View all your alerts and manage your properties in your dashboard:
        </p>
        <a href="https://portal.mymineralwatch.com" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
          View Dashboard
        </a>
      </div>
    </div>
  `;

  // Send via Postmark
  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN
    },
    body: JSON.stringify({
      From: 'alerts@mymineralwatch.com',
      To: to,
      Subject: subject,
      HtmlBody: htmlContent,
      Tag: `batch-${category}`,
      Metadata: {
        category: category,
        alertCount: totalCount.toString(),
        userId: userId
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Postmark API error: ${response.status} - ${errorText}`);
  }

  return true;
}

/**
 * Build HTML section for a group of alerts
 */
function buildAlertSection(title, alerts, color) {
  let html = `
    <div style="margin-bottom: 32px;">
      <h3 style="color: ${color}; margin-bottom: 16px; font-size: 18px; font-weight: 600;">
        ${title} (${alerts.length})
      </h3>
      <div style="border-left: 3px solid ${color}; padding-left: 16px;">
  `;

  for (const alert of alerts) {
    const isHorizontal = alert.bhLocation && alert.alertLevel === 'YOUR PROPERTY';
    
    html += `
      <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
        <h4 style="margin: 0 0 8px 0; color: #1e293b; font-size: 16px;">
          ${alert.wellName}
        </h4>
        <p style="margin: 0 0 4px 0; color: #64748b; font-size: 14px;">
          ${alert.operator} • ${alert.location}
        </p>
        <p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px;">
          API: ${alert.apiNumber}
        </p>
    `;

    if (isHorizontal) {
      html += `
        <p style="margin: 0 0 8px 0; color: #059669; font-size: 14px; font-weight: 500;">
          ↔️ Horizontal Well - ${alert.lateralLength ? (alert.lateralLength/5280).toFixed(1) + ' miles' : 'Multi-section'}
        </p>
      `;
    }

    // Add action links
    html += `
      <div style="margin-top: 8px;">
    `;
    
    if (alert.mapLink) {
      html += `<a href="${alert.mapLink}" style="color: #3b82f6; text-decoration: none; margin-right: 16px; font-size: 14px;">📍 View Map</a>`;
    }
    
    if (alert.occLink) {
      html += `<a href="${alert.occLink}" style="color: #3b82f6; text-decoration: none; font-size: 14px;">📄 OCC Filing</a>`;
    }
    
    html += `
      </div>
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}