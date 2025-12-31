/**
 * Email Batch Service - Groups and sends batched alert emails
 * Reduces email volume by combining multiple alerts per category
 */

import { sendAlertEmail } from './email.js';
import { createActivityLog, updateActivityLog } from './airtable.js';

/**
 * Simple delay function for rate limiting
 * @param {number} ms - Milliseconds to delay
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Process and send batched emails for all collected alerts
 * @param {Object} env - Worker environment
 * @param {Map} userAlertMap - Map of userId -> array of alerts
 * @param {boolean} dryRun - Whether this is a dry run
 * @param {Object} options - Additional options including test mode
 * @returns {Object} - Results of email sending
 */
export async function sendBatchedEmails(env, userAlertMap, dryRun = false, options = {}) {
  const results = {
    emailsSent: 0,
    alertsSent: 0,
    errors: [],
    testMode: options.testMode || false,
    skippedUsers: []
  };

  // Test mode email filtering
  const approvedTestEmails = ['photog12@gmail.com', 'mrsprice518@gmail.com'];
  
  // Process each user's alerts
  for (const [userId, userAlerts] of userAlertMap.entries()) {
    try {
      // Get user email from first alert
      const userEmail = userAlerts[0]?.user?.email;
      
      // In test mode, filter to approved emails only
      if (results.testMode && userEmail) {
        if (!approvedTestEmails.includes(userEmail)) {
          console.log(`[Test Mode] Skipping batched email to: ${userEmail} (${userAlerts.length} alerts)`);
          results.skippedUsers.push({ email: userEmail, alertCount: userAlerts.length });
          continue;
        } else {
          console.log(`[Test Mode] Sending batched email to: ${userEmail} (${userAlerts.length} alerts)`);
        }
      }
      
      // Send one email per user with all their alerts
      const sent = await sendBatchedUserEmail(env, userId, userAlerts, dryRun);
      if (sent) {
        results.emailsSent++;
        results.alertsSent += userAlerts.length;
      }
    } catch (error) {
      console.error(`[EmailBatch] Error processing user ${userId}:`, error);
      results.errors.push({ userId, error: error.message });
    }
  }

  return results;
}

/**
 * Send a batched email for a specific user with all their alerts
 */
async function sendBatchedUserEmail(env, userId, alerts, dryRun) {
  if (alerts.length === 0) return false;
  
  // Get user info from first alert
  const firstAlert = alerts[0];
  const userEmail = firstAlert.user.email;
  const userName = firstAlert.user.name;

  if (dryRun) {
    console.log(`[EmailBatch] DRY RUN: Would send email to ${userEmail} with ${alerts.length} alerts`);
    alerts.forEach(a => {
      console.log(`  - ${a.wellName} (${a.apiNumber}) - ${a.alertLevel} [${a.activityType}]`);
    });
    return true;
  }

  // Create activity logs for all alerts with rate limiting
  const activityRecords = [];
  for (let i = 0; i < alerts.length; i++) {
    const alert = alerts[i];
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
    
    // Add 200ms delay between Airtable writes (except after the last one)
    if (i < alerts.length - 1) {
      await delay(200);
    }
  }

  try {
    // Send the batched email
    if (alerts.length === 1) {
      // Single alert - use existing email format
      await sendAlertEmail(env, {
        ...alerts[0],
        to: userEmail,
        userName: userName,
        userId: userId  // Ensure userId is passed for track link generation
      });
    } else {
      // Multiple alerts - send batched email
      await sendBatchedAlertEmail(env, {
        to: userEmail,
        userName: userName,
        alerts: alerts,
        userId: userId
      });
    }

    // Update all activity logs to mark emails as sent with rate limiting
    for (let i = 0; i < activityRecords.length; i++) {
      const record = activityRecords[i];
      await updateActivityLog(env, record.id, { 'Email Sent': true });
      
      // Add 200ms delay between Airtable updates (except after the last one)
      if (i < activityRecords.length - 1) {
        await delay(200);
      }
    }

    console.log(`[EmailBatch] Sent email to ${userEmail} with ${alerts.length} alerts`);
    return true;
  } catch (emailError) {
    console.error(`[EmailBatch] Failed to send email to ${userEmail}:`, emailError.message);
    // Activity logs remain with Email Sent = false
    return false;
  }
}

/**
 * Send a batched alert email with multiple wells
 */
async function sendBatchedAlertEmail(env, data) {
  const { to, userName, alerts, userId } = data;
  
  // Group alerts by alert level
  const yourPropertyAlerts = alerts.filter(a => a.alertLevel === 'YOUR PROPERTY');
  const adjacentAlerts = alerts.filter(a => a.alertLevel === 'ADJACENT TO YOUR PROPERTY');
  const trackedAlerts = alerts.filter(a => a.alertLevel === 'TRACKED WELL');

  // Count by activity type
  const permitCount = alerts.filter(a => a.activityType === 'Intent to Drill - New Permit').length;
  const completionCount = alerts.filter(a => a.activityType === 'Well Completed').length;
  
  // Build email subject
  let subject = 'MyMineralWatch Alert: ';
  const parts = [];
  
  if (permitCount > 0) {
    parts.push(`${permitCount} New Permit${permitCount > 1 ? 's' : ''}`);
  }
  if (completionCount > 0) {
    parts.push(`${completionCount} Completion${completionCount > 1 ? 's' : ''}`);
  }
  
  subject += parts.join(' & ');

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
        We've detected the following activity that may affect your mineral interests:
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
      Tag: 'batch-daily',
      Metadata: {
        permitCount: permitCount.toString(),
        completionCount: completionCount.toString(),
        alertCount: alerts.length.toString(),
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
          <strong>${alert.activityType}</strong> • ${alert.operator}
        </p>
        <p style="margin: 0 0 4px 0; color: #64748b; font-size: 14px;">
          ${alert.location} • API: ${alert.apiNumber}
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