/**
 * Digest Monitor
 * Processes pending alerts and sends digest emails (daily/weekly)
 */

import {
  getPendingAlertsForDigest,
  markAlertsProcessed,
  groupAlertsForDigest
} from '../services/pendingAlerts.js';
import { getUserById } from '../services/airtable.js';
import { sendDigestEmail } from '../services/email.js';

/**
 * Process and send digest emails
 * @param {Object} env - Worker environment
 * @param {string} frequency - 'daily' or 'weekly'
 * @returns {Object} - Processing results
 */
export async function processDigest(env, frequency) {
  console.log(`[Digest] Starting ${frequency} digest processing`);

  const results = {
    frequency,
    usersProcessed: 0,
    alertsProcessed: 0,
    emailsSent: 0,
    errors: []
  };

  try {
    // Get all pending alerts for this frequency
    const pendingAlerts = await getPendingAlertsForDigest(env, frequency);

    if (pendingAlerts.length === 0) {
      console.log(`[Digest] No pending ${frequency} alerts to process`);
      return results;
    }

    console.log(`[Digest] Found ${pendingAlerts.length} pending ${frequency} alerts`);

    // Group alerts by user
    const userAlerts = groupAlertsForDigest(pendingAlerts);

    console.log(`[Digest] Grouped alerts for ${userAlerts.size} users`);

    // Process each user
    for (const [userEmail, userData] of userAlerts) {
      try {
        // Get user details for personalization
        const user = await getUserById(env, userData.userId);
        const userName = user?.fields?.Name || userEmail.split('@')[0];

        // Count total alerts for this user
        const totalAlerts =
          (userData.alerts.permits?.length || 0) +
          (userData.alerts.completions?.length || 0) +
          (userData.alerts.statusChanges?.length || 0) +
          (userData.alerts.expirations?.length || 0) +
          (userData.alerts.transfers?.length || 0);

        if (totalAlerts === 0) {
          console.log(`[Digest] No alerts for ${userEmail}, skipping`);
          continue;
        }

        // Send digest email
        await sendDigestEmail(env, {
          to: userEmail,
          userName,
          frequency,
          alerts: userData.alerts,
          highlights: userData.highlights
        });

        results.emailsSent++;
        results.usersProcessed++;

        // Collect alert IDs for this user
        const alertIds = [];
        for (const typeAlerts of Object.values(userData.alerts)) {
          if (Array.isArray(typeAlerts)) {
            for (const alert of typeAlerts) {
              alertIds.push(alert.id);
              results.alertsProcessed++;
            }
          }
        }

        // Mark alerts as processed
        if (alertIds.length > 0) {
          await markAlertsProcessed(env, alertIds);
        }

        console.log(`[Digest] Sent ${frequency} digest to ${userEmail} with ${totalAlerts} alerts`);

      } catch (userError) {
        console.error(`[Digest] Error processing user ${userEmail}:`, userError);
        results.errors.push({
          user: userEmail,
          error: userError.message
        });
      }
    }

    console.log(`[Digest] ${frequency} digest complete: ${results.emailsSent} emails sent, ${results.alertsProcessed} alerts processed`);

  } catch (err) {
    console.error(`[Digest] Fatal error processing ${frequency} digest:`, err);
    results.errors.push({
      type: 'fatal',
      error: err.message
    });
  }

  return results;
}

/**
 * Run the daily digest (called at 6 PM CT weekdays)
 * @param {Object} env - Worker environment
 * @returns {Object} - Processing results
 */
export async function runDailyDigest(env) {
  console.log('[Digest] ========== DAILY DIGEST START ==========');

  const startTime = Date.now();
  const results = await processDigest(env, 'daily');

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Digest] Daily digest completed in ${duration}s`);
  console.log('[Digest] ========== DAILY DIGEST END ==========');

  return results;
}

/**
 * Run the weekly digest (called at 6 PM CT Sunday)
 * @param {Object} env - Worker environment
 * @returns {Object} - Processing results
 */
export async function runWeeklyDigest(env) {
  console.log('[Digest] ========== WEEKLY DIGEST START ==========');

  const startTime = Date.now();
  const results = await processDigest(env, 'weekly');

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Digest] Weekly digest completed in ${duration}s`);
  console.log('[Digest] ========== WEEKLY DIGEST END ==========');

  return results;
}
