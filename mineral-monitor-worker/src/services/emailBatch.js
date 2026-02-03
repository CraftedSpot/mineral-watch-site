/**
 * Email Batch Service - Queues alerts for daily/weekly digest delivery
 * All alerts are queued to pending_alerts table for digest processing.
 * No instant emails are sent - users receive daily and/or weekly digests.
 */

import { createActivityLog, getUserById } from './airtable.js';
import {
  getEffectiveNotificationMode,
  getDigestFrequency,
  shouldQueueWeekly,
  queuePendingAlert,
  getOrganizationById
} from './pendingAlerts.js';

/**
 * Simple delay function for rate limiting
 * @param {number} ms - Milliseconds to delay
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Process all collected alerts - create activity logs and queue for digest delivery
 * @param {Object} env - Worker environment
 * @param {Map} userAlertMap - Map of userId -> array of alerts
 * @param {boolean} dryRun - Whether this is a dry run
 * @param {Object} options - Additional options including test mode
 * @returns {Object} - Results of processing
 */
export async function sendBatchedEmails(env, userAlertMap, dryRun = false, options = {}) {
  const results = {
    emailsSent: 0,
    alertsSent: 0,
    alertsQueued: 0,
    alertsSkipped: 0,
    errors: [],
    testMode: options.testMode || false,
    skippedUsers: []
  };

  // Process each user's alerts
  for (const [userId, userAlerts] of userAlertMap.entries()) {
    try {
      // Get user email from first alert
      const userEmail = userAlerts[0]?.user?.email;

      // Get user's notification mode
      const user = await getUserById(env, userId);

      // Use organizationId from alert if available (property/well org),
      // otherwise fall back to user's own organization field
      const alertOrgId = userAlerts[0]?.organizationId;
      const userOrgId = user?.fields?.Organization?.[0] || null;
      const organizationId = alertOrgId || userOrgId;

      const organization = organizationId ? await getOrganizationById(env, organizationId) : null;
      const notificationMode = getEffectiveNotificationMode(user, organization);

      console.log(`[EmailBatch] User ${userEmail} notification mode: ${notificationMode} (orgId: ${organizationId}, via: ${alertOrgId ? 'alert' : 'user'})`);

      // Check if user wants no notifications
      if (notificationMode === 'None') {
        console.log(`[EmailBatch] Skipping user ${userEmail} - notifications disabled`);
        results.alertsSkipped += userAlerts.length;
        continue;
      }

      // Determine digest frequency for this user
      const digestFrequency = getDigestFrequency(notificationMode);

      if (!digestFrequency) {
        console.log(`[EmailBatch] No digest frequency for user ${userEmail} (mode: ${notificationMode})`);
        results.alertsSkipped += userAlerts.length;
        continue;
      }

      if (dryRun) {
        console.log(`[EmailBatch] DRY RUN: Would queue ${userAlerts.length} alerts for ${digestFrequency} digest for ${userEmail}`);
        results.alertsQueued += userAlerts.length;
        continue;
      }

      // Create activity logs and queue alerts for digest
      for (let i = 0; i < userAlerts.length; i++) {
        const alert = userAlerts[i];

        // Create activity log entry
        const activityData = {
          wellName: alert.wellName,
          apiNumber: alert.apiNumber,
          activityType: alert.activityType,
          operator: alert.operator,
          alertLevel: alert.alertLevel,
          sectionTownshipRange: alert.location,
          county: alert.county,
          occLink: alert.occLink || null,
          mapLink: alert.mapLink || "",
          userId: alert.user.id,
          formation: alert.formation || null,
          organizationId: alert.organizationId || null
        };
        const record = await createActivityLog(env, activityData);
        const activityLogId = record.id;

        // Queue for digest delivery
        await queuePendingAlert(env, {
          userId: userId,
          userEmail: userEmail,
          organizationId: organizationId,
          activityLogId: activityLogId,
          activityType: alert.activityType,
          wellName: alert.wellName,
          apiNumber: alert.apiNumber,
          operator: alert.operator,
          county: alert.county,
          sectionTownshipRange: alert.location,
          alertLevel: alert.alertLevel,
          daysUntilExpiration: alert.daysUntilExpiration || null,
          expireDate: alert.expireDate || null,
          previousStatus: alert.previousStatus || null,
          newStatus: alert.newStatus || null,
          previousOperator: alert.previousOperator || null,
          digestFrequency: digestFrequency
        });
        results.alertsQueued++;

        // Rate limit Airtable writes
        if (i < userAlerts.length - 1) {
          await delay(200);
        }
      }

      // For 'Daily + Weekly' users, also queue a copy for the weekly report
      if (shouldQueueWeekly(notificationMode) && digestFrequency === 'daily') {
        for (const alert of userAlerts) {
          await queuePendingAlert(env, {
            userId: userId,
            userEmail: userEmail,
            organizationId: organizationId,
            activityLogId: null, // weekly report doesn't need individual activity log refs
            activityType: alert.activityType,
            wellName: alert.wellName,
            apiNumber: alert.apiNumber,
            operator: alert.operator,
            county: alert.county,
            sectionTownshipRange: alert.location,
            alertLevel: alert.alertLevel,
            daysUntilExpiration: alert.daysUntilExpiration || null,
            expireDate: alert.expireDate || null,
            previousStatus: alert.previousStatus || null,
            newStatus: alert.newStatus || null,
            previousOperator: alert.previousOperator || null,
            digestFrequency: 'weekly'
          });
        }
        console.log(`[EmailBatch] Also queued ${userAlerts.length} alerts for weekly report for ${userEmail}`);
      }

      console.log(`[EmailBatch] Queued ${userAlerts.length} alerts for ${digestFrequency} digest for ${userEmail}`);

    } catch (error) {
      console.error(`[EmailBatch] Error processing user ${userId}:`, error);
      results.errors.push({ userId, error: error.message });
    }
  }

  console.log(`[EmailBatch] Summary: ${results.alertsQueued} alerts queued, ${results.alertsSkipped} skipped`);
  return results;
}

// Note: Instant email sending functions removed. All alerts now queue for
// daily/weekly digest delivery. Daily digest emails are sent by digest.js.