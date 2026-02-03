/**
 * Pending Alerts Service
 * Handles queuing alerts for digest emails instead of instant delivery
 */

/**
 * Get the effective notification mode for a user
 * Takes into account organization defaults and user overrides
 *
 * Valid modes:
 *   'Daily + Weekly'  - Daily alert digest + weekly regional report (default)
 *   'Daily Digest'    - Daily alert digest only
 *   'Weekly Report'   - Weekly regional report only (includes alerts)
 *   'None'            - No notifications
 *
 * @param {Object} user - Airtable user record
 * @param {Object} organization - Airtable organization record (optional)
 * @returns {string} - Notification mode
 */
export function getEffectiveNotificationMode(user, organization = null) {
  const userOverride = user?.fields?.['Notification Override'];

  // Migrate legacy modes to new system
  const normalize = (mode) => {
    switch (mode) {
      case 'Instant + Weekly': return 'Daily + Weekly';
      case 'Instant': return 'Daily Digest';
      case 'Weekly Digest': return 'Weekly Report';
      case 'Daily Digest': return 'Daily Digest';
      case 'Daily + Weekly': return 'Daily + Weekly';
      case 'Weekly Report': return 'Weekly Report';
      case 'None': return 'None';
      default: return mode;
    }
  };

  // If user has an override and it's not "Use Org Default", use it
  if (userOverride && userOverride !== 'Use Org Default') {
    return normalize(userOverride);
  }

  // If user is in an organization, check org settings
  if (organization) {
    const orgMode = organization?.fields?.['Default Notification Mode'];
    const allowOverride = organization?.fields?.['Allow User Override'] !== false;

    // If org doesn't allow override, use org default
    if (!allowOverride && orgMode) {
      return normalize(orgMode);
    }

    // Use org default if available
    if (orgMode) {
      return normalize(orgMode);
    }
  }

  // Default: daily digest + weekly report
  return 'Daily + Weekly';
}

/**
 * Determine if we should queue for daily digest based on notification mode
 * @param {string} mode - Effective notification mode
 * @returns {boolean}
 */
export function shouldQueueDaily(mode) {
  return mode === 'Daily Digest' || mode === 'Daily + Weekly';
}

/**
 * Determine if we should queue for weekly digest based on notification mode
 * @param {string} mode - Effective notification mode
 * @returns {boolean}
 */
export function shouldQueueWeekly(mode) {
  return mode === 'Weekly Report' || mode === 'Daily + Weekly';
}

/**
 * @deprecated Use shouldQueueDaily instead. Kept for backward compatibility.
 */
export function shouldSendInstant(mode) {
  // No more instant sending - everything is digest-based
  return false;
}

/**
 * Get the digest frequency to queue an alert for
 * @param {string} mode - Effective notification mode
 * @returns {string|null} - 'daily', 'weekly', or null
 */
export function getDigestFrequency(mode) {
  if (mode === 'Daily Digest' || mode === 'Daily + Weekly') {
    return 'daily';
  }
  if (mode === 'Weekly Report') {
    return 'weekly';
  }
  return null;
}

/**
 * Queue an alert for digest delivery
 * @param {Object} env - Worker environment
 * @param {Object} alertData - Alert data to queue
 * @returns {Object} - Result of the queue operation
 */
export async function queuePendingAlert(env, alertData) {
  if (!env.WELLS_DB) {
    console.error('[PendingAlerts] D1 database binding (WELLS_DB) not found');
    return { success: false, error: 'Database not configured' };
  }

  try {
    const stmt = env.WELLS_DB.prepare(`
      INSERT INTO pending_alerts (
        user_id, user_email, organization_id,
        activity_log_id, activity_type,
        well_name, api_number, operator, county,
        section_township_range, alert_level,
        days_until_expiration, expire_date,
        previous_status, new_status,
        previous_operator,
        digest_frequency
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
      )
    `);

    await stmt.bind(
      alertData.userId,
      alertData.userEmail,
      alertData.organizationId || null,
      alertData.activityLogId,
      alertData.activityType,
      alertData.wellName || null,
      alertData.apiNumber || null,
      alertData.operator || null,
      alertData.county || null,
      alertData.sectionTownshipRange || null,
      alertData.alertLevel || null,
      alertData.daysUntilExpiration || null,
      alertData.expireDate || null,
      alertData.previousStatus || null,
      alertData.newStatus || null,
      alertData.previousOperator || null,
      alertData.digestFrequency
    ).run();

    console.log(`[PendingAlerts] Queued ${alertData.activityType} alert for ${alertData.userEmail} (${alertData.digestFrequency} digest)`);
    return { success: true };

  } catch (err) {
    console.error(`[PendingAlerts] Failed to queue alert:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Get pending alerts for digest processing
 * @param {Object} env - Worker environment
 * @param {string} frequency - 'daily' or 'weekly'
 * @returns {Array} - Array of pending alerts grouped by user
 */
export async function getPendingAlertsForDigest(env, frequency) {
  if (!env.WELLS_DB) {
    console.error('[PendingAlerts] D1 database binding (WELLS_DB) not found');
    return [];
  }

  try {
    const stmt = env.WELLS_DB.prepare(`
      SELECT * FROM pending_alerts
      WHERE digest_frequency = ? AND processed_at IS NULL
      ORDER BY user_id, activity_type, created_at
    `);

    const result = await stmt.bind(frequency).all();
    return result.results || [];

  } catch (err) {
    console.error(`[PendingAlerts] Failed to get pending alerts:`, err);
    return [];
  }
}

/**
 * Mark alerts as processed after sending digest
 * @param {Object} env - Worker environment
 * @param {Array} alertIds - Array of alert IDs to mark as processed
 */
export async function markAlertsProcessed(env, alertIds) {
  if (!env.WELLS_DB || alertIds.length === 0) return;

  try {
    // D1 has a ~100 bind variable limit. 1 variable per alert ID.
    const CHUNK_SIZE = 90;

    for (let i = 0; i < alertIds.length; i += CHUNK_SIZE) {
      const chunk = alertIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');

      await env.WELLS_DB.prepare(`
        UPDATE pending_alerts
        SET processed_at = datetime('now'), digest_sent_at = datetime('now')
        WHERE id IN (${placeholders})
      `).bind(...chunk).run();
    }

    console.log(`[PendingAlerts] Marked ${alertIds.length} alerts as processed`);

  } catch (err) {
    console.error(`[PendingAlerts] Failed to mark alerts as processed:`, err);
  }
}

/**
 * Group pending alerts by user for digest email generation
 * @param {Array} alerts - Array of pending alert records
 * @returns {Map} - Map of userEmail -> grouped alerts by type
 */
export function groupAlertsForDigest(alerts) {
  const userAlerts = new Map();

  for (const alert of alerts) {
    if (!userAlerts.has(alert.user_email)) {
      userAlerts.set(alert.user_email, {
        userId: alert.user_id,
        userEmail: alert.user_email,
        organizationId: alert.organization_id,
        alerts: {
          permits: [],
          completions: [],
          statusChanges: [],
          expirations: [],
          transfers: []
        },
        highlights: []
      });
    }

    const userData = userAlerts.get(alert.user_email);

    // Group by type
    switch (alert.activity_type) {
      case 'New Permit':
        userData.alerts.permits.push(alert);
        break;
      case 'Well Completed':
        userData.alerts.completions.push(alert);
        break;
      case 'Status Change':
        userData.alerts.statusChanges.push(alert);
        break;
      case 'Permit Expiring':
      case 'Permit Expired':
        userData.alerts.expirations.push(alert);
        // Add to highlights if expiring soon
        if (alert.days_until_expiration !== null && alert.days_until_expiration <= 7) {
          userData.highlights.push({
            type: 'expiration',
            message: alert.days_until_expiration < 0
              ? `Permit EXPIRED: ${alert.well_name || alert.api_number}`
              : `Permit expiring in ${alert.days_until_expiration} days: ${alert.well_name || alert.api_number}`
          });
        }
        break;
      case 'Operator Transfer':
        userData.alerts.transfers.push(alert);
        break;
    }
  }

  return userAlerts;
}

/**
 * Get organization record by ID
 * @param {Object} env - Worker environment
 * @param {string} orgId - Organization Airtable record ID
 * @returns {Object|null} - Organization record or null
 */
export async function getOrganizationById(env, orgId) {
  if (!orgId) return null;

  try {
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent('🏢 Organization')}/${orgId}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Airtable get organization failed: ${response.status}`);
    }

    return await response.json();

  } catch (err) {
    console.error(`[PendingAlerts] Failed to get organization ${orgId}:`, err);
    return null;
  }
}
