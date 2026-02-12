/**
 * Digest Monitor
 * Processes pending alerts and sends digest emails (daily/weekly)
 *
 * Weekly digest is an enhanced "Weekly Digest" that includes:
 * - Your Properties: pending alerts from the week (existing behavior)
 * - Activity in Your Area: statewide activity in 3x3 township grid
 * - New Operators: operators filing their first permit near user properties
 * - County Roundup: summary stats for user's counties
 */

import {
  getPendingAlertsForDigest,
  markAlertsProcessed,
  groupAlertsForDigest,
  getEffectiveNotificationMode,
  shouldQueueWeekly
} from '../services/pendingAlerts.js';
import { getUserById, getUserNotificationOverrides, updateActivityLog } from '../services/airtable.js';
import { sendDigestEmail } from '../services/email.js';
import {
  getAllActiveUsersWithOrg,
  getPropertiesForUser,
  getNearbyActivity,
  getHistoricalOperators,
  getCountyActivityStats,
  getDocketCountByCounty
} from '../services/d1.js';
import { parseTownship, parseRange } from '../utils/normalize.js';

/**
 * Compute the 3x3 township grid around a given township/range.
 * Returns 9 {township, range} pairs (center + 8 surrounding).
 */
function getTownshipGrid(township, range) {
  const t = parseTownship(township);
  const r = parseRange(range);
  if (!t.number || !r.number) return [{ township, range }];

  const grid = [];

  for (let td = -1; td <= 1; td++) {
    for (let rd = -1; rd <= 1; rd++) {
      let tNum, tDir;
      if (t.direction === 'N') {
        tNum = t.number + td;
        tDir = 'N';
        if (tNum <= 0) {
          tNum = Math.abs(tNum) + 1;
          tDir = 'S';
        }
      } else {
        tNum = t.number - td;
        tDir = 'S';
        if (tNum <= 0) {
          tNum = Math.abs(tNum) + 1;
          tDir = 'N';
        }
      }

      let rNum, rDir;
      if (r.direction === 'W') {
        rNum = r.number + rd;
        rDir = 'W';
        if (rNum <= 0) {
          rNum = Math.abs(rNum) + 1;
          rDir = 'E';
        }
      } else {
        rNum = r.number - rd;
        rDir = 'E';
        if (rNum <= 0) {
          rNum = Math.abs(rNum) + 1;
          rDir = 'W';
        }
      }

      grid.push({
        township: `${tNum}${tDir}`,
        range: `${rNum}${rDir}`
      });
    }
  }

  return grid;
}

/**
 * Detect operators who are new to a user's area this week.
 * Compares recent activity operators against historical wells table operators.
 */
function detectNewOperators(recentActivity, historicalOperators) {
  const newOps = [];
  const seenOperators = new Set();

  for (const activity of recentActivity) {
    if (!activity.operator || !activity.has_permit) continue;
    const normalized = activity.operator.trim().toUpperCase();
    if (seenOperators.has(normalized)) continue;
    seenOperators.add(normalized);

    const key = `${activity.surface_township}|${activity.surface_range}`;
    const historicalOps = historicalOperators.get(key) || new Set();

    if (!historicalOps.has(normalized)) {
      newOps.push({
        operator: activity.operator,
        location: `${activity.surface_section}-${activity.surface_township}-${activity.surface_range}`,
        county: activity.county
      });
    }
  }

  return newOps;
}

/**
 * Process and send the weekly digest
 * @param {Object} env - Worker environment
 * @returns {Object} - Processing results
 */
export async function processDigest(env) {
  console.log('[Digest] Starting weekly digest processing');

  const results = {
    frequency: 'weekly',
    usersProcessed: 0,
    alertsProcessed: 0,
    emailsSent: 0,
    errors: []
  };

  try {
    // Get pending alerts queued for weekly digest
    const pendingAlerts = await getPendingAlertsForDigest(env, 'weekly');
    console.log(`[Digest] Found ${pendingAlerts.length} pending weekly alerts`);

    // Group pending alerts by user
    const pendingByUser = groupAlertsForDigest(pendingAlerts);

    return await processWeeklyDigest(env, pendingByUser, results);

  } catch (err) {
    console.error('[Digest] Fatal error processing weekly digest:', err);
    results.errors.push({ type: 'fatal', error: err.message });
  }

  return results;
}

/**
 * Process the enhanced weekly digest
 */
async function processWeeklyDigest(env, pendingByUser, results) {
  // Step 1: Find all users who should receive weekly digest
  // Query D1 for user/org data, and Airtable for notification preferences
  // (D1's notification_override may be stale; Airtable is source of truth)
  const [allUsers, airtableOverrides] = await Promise.all([
    getAllActiveUsersWithOrg(env),
    getUserNotificationOverrides(env)
  ]);
  console.log(`[Digest] Found ${allUsers.length} active users total, ${airtableOverrides.size} with Airtable overrides`);

  const weeklyUsers = allUsers.filter(row => {
    // Use Airtable override if available, fall back to D1 value
    const notificationOverride = airtableOverrides.get(row.airtable_record_id) || row.notification_override || null;

    const user = {
      fields: {
        'Notification Override': notificationOverride
      }
    };
    const org = row.org_notification_mode ? {
      fields: {
        'Default Notification Mode': row.org_notification_mode,
        'Allow User Override': row.org_allow_override === 1
      }
    } : null;

    const mode = getEffectiveNotificationMode(user, org);
    return shouldQueueWeekly(mode);
  });

  console.log(`[Digest] ${weeklyUsers.length} users subscribed to weekly digest`);

  if (weeklyUsers.length === 0 && pendingByUser.size === 0) {
    console.log('[Digest] No weekly digest users and no pending alerts — nothing to do');
    return results;
  }

  // Step 2: Collect all user properties and compute township grids
  const userPropertyMap = new Map(); // userId -> properties
  const allTownships = new Map(); // "township|range" -> {township, range}
  const allCounties = new Set();

  for (const row of weeklyUsers) {
    const properties = await getPropertiesForUser(env, row.airtable_record_id);
    userPropertyMap.set(row.airtable_record_id, properties);

    for (const prop of properties) {
      if (prop.township && prop.range) {
        const grid = getTownshipGrid(prop.township, prop.range);
        for (const t of grid) {
          allTownships.set(`${t.township}|${t.range}`, t);
        }
      }
      if (prop.county) {
        allCounties.add(prop.county.toUpperCase());
      }
    }
  }

  console.log(`[Digest] Collected ${allTownships.size} unique township/range pairs, ${allCounties.size} counties`);

  // Step 3: Batch-query shared data
  const townshipList = [...allTownships.values()];
  const countyList = [...allCounties];

  const [nearbyActivity, historicalOps, countyStats, docketCounts] = await Promise.all([
    getNearbyActivity(env, townshipList, 7),
    getHistoricalOperators(env, townshipList),
    getCountyActivityStats(env, countyList, 7),
    getDocketCountByCounty(env, countyList, 7)
  ]);

  console.log(`[Digest] Nearby activity: ${nearbyActivity.length} records, Historical operators: ${historicalOps.size} townships`);

  // Index nearby activity by township for fast lookup
  const activityByTownship = new Map();
  for (const act of nearbyActivity) {
    const key = `${act.surface_township}|${act.surface_range}`;
    if (!activityByTownship.has(key)) {
      activityByTownship.set(key, []);
    }
    activityByTownship.get(key).push(act);
  }

  // Step 4: Process each weekly user
  for (const row of weeklyUsers) {
    try {
      const userId = row.airtable_record_id;
      const userEmail = row.email;
      const userName = row.name || userEmail.split('@')[0];

      // Get pending alerts for this user (may be empty)
      const userData = pendingByUser.get(userEmail) || {
        alerts: { permits: [], completions: [], statusChanges: [], expirations: [], transfers: [] },
        highlights: []
      };

      // Get user's properties and compute their township grid
      const properties = userPropertyMap.get(userId) || [];
      const userTownships = new Set();
      const userCounties = new Set();

      for (const prop of properties) {
        if (prop.township && prop.range) {
          const grid = getTownshipGrid(prop.township, prop.range);
          for (const t of grid) {
            userTownships.add(`${t.township}|${t.range}`);
          }
        }
        if (prop.county) {
          userCounties.add(prop.county.toUpperCase());
        }
      }

      // Collect API numbers from pending alerts to exclude from nearby
      const alertedApis = new Set();
      for (const typeAlerts of Object.values(userData.alerts)) {
        if (Array.isArray(typeAlerts)) {
          for (const alert of typeAlerts) {
            if (alert.api_number) alertedApis.add(alert.api_number);
          }
        }
      }

      // Filter nearby activity to this user's townships, excluding alerted items
      const userNearby = [];
      for (const key of userTownships) {
        const acts = activityByTownship.get(key) || [];
        for (const act of acts) {
          if (!alertedApis.has(act.api_number)) {
            userNearby.push(act);
          }
        }
      }

      // Deduplicate by API number (same well may appear in multiple township queries)
      const seenApis = new Set();
      const dedupedNearby = [];
      for (const act of userNearby) {
        if (!seenApis.has(act.api_number)) {
          seenApis.add(act.api_number);
          dedupedNearby.push(act);
        }
      }

      // Sort by date descending, cap at 10
      dedupedNearby.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      const nearbyForEmail = dedupedNearby.slice(0, 10);
      const nearbyOverflow = dedupedNearby.length > 10 ? dedupedNearby.length - 10 : 0;

      // Detect new operators in this user's area
      const newOperators = detectNewOperators(dedupedNearby, historicalOps);

      // Build county stats for this user's counties
      const userCountyStats = [];
      for (const county of userCounties) {
        const stats = countyStats.get(county) || { permitCount: 0, completionCount: 0 };
        const dockets = docketCounts.get(county) || 0;
        const total = stats.permitCount + stats.completionCount + dockets;
        if (total > 0) {
          userCountyStats.push({
            county: county.charAt(0) + county.slice(1).toLowerCase(),
            permits: stats.permitCount,
            completions: stats.completionCount,
            dockets
          });
        }
      }

      // Count pending alert totals
      const totalPendingAlerts =
        (userData.alerts.permits?.length || 0) +
        (userData.alerts.completions?.length || 0) +
        (userData.alerts.statusChanges?.length || 0) +
        (userData.alerts.expirations?.length || 0) +
        (userData.alerts.transfers?.length || 0);

      // Skip if there's truly nothing to report
      if (totalPendingAlerts === 0 && nearbyForEmail.length === 0 && newOperators.length === 0 && userCountyStats.length === 0) {
        console.log(`[Digest] No content for ${userEmail}, skipping`);
        continue;
      }

      // Send the enhanced weekly digest
      await sendDigestEmail(env, {
        to: userEmail,
        userName,
        userId,
        frequency: 'weekly',
        alerts: userData.alerts,
        highlights: userData.highlights,
        nearbyActivity: nearbyForEmail,
        nearbyOverflow,
        newOperators,
        countyStats: userCountyStats
      });

      results.emailsSent++;
      results.usersProcessed++;

      // Mark pending alerts as processed
      const alertIds = [];
      for (const typeAlerts of Object.values(userData.alerts)) {
        if (Array.isArray(typeAlerts)) {
          for (const alert of typeAlerts) {
            alertIds.push(alert.id);
            results.alertsProcessed++;
          }
        }
      }
      if (alertIds.length > 0) {
        await markAlertsProcessed(env, alertIds);
      }

      console.log(`[Digest] Sent weekly digest to ${userEmail}: ${totalPendingAlerts} alerts, ${nearbyForEmail.length} nearby, ${newOperators.length} new ops, ${userCountyStats.length} counties`);

      // Remove from pendingByUser so we don't double-process
      pendingByUser.delete(userEmail);

    } catch (userError) {
      console.error(`[Digest] Error processing user ${row.email}:`, userError);
      results.errors.push({ user: row.email, error: userError.message });
    }
  }

  // Step 5: Handle any remaining pending alerts for users NOT in weeklyUsers
  // (edge case: user had pending weekly alerts but their preference changed)
  if (pendingByUser.size > 0) {
    console.log(`[Digest] ${pendingByUser.size} remaining users with pending alerts (not in weekly user list)`);
    for (const [userEmail, userData] of pendingByUser) {
      try {
        const user = await getUserById(env, userData.userId);
        const userName = user?.fields?.Name || userEmail.split('@')[0];

        const totalAlerts =
          (userData.alerts.permits?.length || 0) +
          (userData.alerts.completions?.length || 0) +
          (userData.alerts.statusChanges?.length || 0) +
          (userData.alerts.expirations?.length || 0) +
          (userData.alerts.transfers?.length || 0) +
          (userData.alerts.occFilings?.length || 0);

        if (totalAlerts === 0) continue;

        await sendDigestEmail(env, {
          to: userEmail,
          userName,
          userId: userData.userId,
          frequency: 'weekly',
          alerts: userData.alerts,
          highlights: userData.highlights
        });

        results.emailsSent++;
        results.usersProcessed++;

        const alertIds = [];
        for (const typeAlerts of Object.values(userData.alerts)) {
          if (Array.isArray(typeAlerts)) {
            for (const alert of typeAlerts) {
              alertIds.push(alert.id);
              results.alertsProcessed++;
            }
          }
        }
        if (alertIds.length > 0) {
          await markAlertsProcessed(env, alertIds);
        }
      } catch (userError) {
        console.error(`[Digest] Error processing leftover user ${userEmail}:`, userError);
        results.errors.push({ user: userEmail, error: userError.message });
      }
    }
  }

  console.log(`[Digest] Weekly digest complete: ${results.emailsSent} emails sent, ${results.alertsProcessed} alerts processed`);
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
  const results = await processDigest(env);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Digest] Weekly digest completed in ${duration}s`);
  console.log('[Digest] ========== WEEKLY DIGEST END ==========');

  return results;
}

/**
 * Process and send daily digest emails.
 * Pulls pending alerts with digest_frequency='daily', groups by user,
 * and sends a concise daily update email.
 * @param {Object} env - Worker environment
 * @returns {Object} - Processing results
 */
export async function runDailyDigest(env) {
  console.log('[Digest] ========== DAILY DIGEST START ==========');

  const startTime = Date.now();
  const results = {
    frequency: 'daily',
    usersProcessed: 0,
    alertsProcessed: 0,
    emailsSent: 0,
    errors: []
  };

  try {
    // Get pending daily alerts
    const pendingAlerts = await getPendingAlertsForDigest(env, 'daily');
    console.log(`[Digest] Found ${pendingAlerts.length} pending daily alerts`);

    if (pendingAlerts.length === 0) {
      console.log('[Digest] No pending daily alerts — nothing to send');
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[Digest] Daily digest completed in ${duration}s`);
      console.log('[Digest] ========== DAILY DIGEST END ==========');
      return results;
    }

    // Group alerts by user
    const userGroups = groupAlertsForDigest(pendingAlerts);
    console.log(`[Digest] Grouped into ${userGroups.size} users`);

    // Process each user
    for (const [userEmail, userData] of userGroups) {
      try {
        const userId = userData.userId;
        const user = await getUserById(env, userId);
        const userName = user?.fields?.Name || userEmail.split('@')[0];

        const totalAlerts =
          (userData.alerts.permits?.length || 0) +
          (userData.alerts.completions?.length || 0) +
          (userData.alerts.statusChanges?.length || 0) +
          (userData.alerts.expirations?.length || 0) +
          (userData.alerts.transfers?.length || 0) +
          (userData.alerts.occFilings?.length || 0);

        if (totalAlerts === 0) {
          console.log(`[Digest] No alerts for ${userEmail}, skipping`);
          continue;
        }

        // Send daily digest email
        await sendDigestEmail(env, {
          to: userEmail,
          userName,
          userId,
          frequency: 'daily',
          alerts: userData.alerts,
          highlights: userData.highlights
        });

        results.emailsSent++;
        results.usersProcessed++;

        // Mark alerts as processed and update activity logs
        const alertIds = [];
        for (const typeAlerts of Object.values(userData.alerts)) {
          if (Array.isArray(typeAlerts)) {
            for (const alert of typeAlerts) {
              alertIds.push(alert.id);
              results.alertsProcessed++;

              // Mark activity log as email sent
              if (alert.activity_log_id) {
                try {
                  await updateActivityLog(env, alert.activity_log_id, { 'Email Sent': true });
                } catch (err) {
                  // Non-fatal: activity log update failure shouldn't stop digest
                  console.error(`[Digest] Failed to update activity log ${alert.activity_log_id}:`, err.message);
                }
              }
            }
          }
        }
        if (alertIds.length > 0) {
          await markAlertsProcessed(env, alertIds);
        }

        console.log(`[Digest] Sent daily digest to ${userEmail}: ${totalAlerts} alerts`);

      } catch (userError) {
        console.error(`[Digest] Error processing daily digest for ${userEmail}:`, userError);
        results.errors.push({ user: userEmail, error: userError.message });
      }
    }
  } catch (err) {
    console.error('[Digest] Fatal error processing daily digest:', err);
    results.errors.push({ type: 'fatal', error: err.message });
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Digest] Daily digest complete: ${results.emailsSent} emails sent, ${results.alertsProcessed} alerts processed`);
  console.log(`[Digest] Daily digest completed in ${duration}s`);
  console.log('[Digest] ========== DAILY DIGEST END ==========');

  return results;
}
