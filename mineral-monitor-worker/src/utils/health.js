/**
 * Health Monitoring Utilities - Track worker run status in KV
 */

const HEALTH_KEY_PREFIX = 'mineral-watch';

/**
 * Update health status for a run type
 * @param {Object} env - Worker environment
 * @param {string} runType - 'daily', 'weekly', or 'last-error'
 * @param {Object} status - Status object to store
 */
export async function updateHealthStatus(env, runType, status) {
  const key = `${HEALTH_KEY_PREFIX}:last-run:${runType}`;
  
  await env.MINERAL_CACHE.put(key, JSON.stringify(status), {
    // Keep health data for 30 days
    expirationTtl: 30 * 24 * 60 * 60
  });
  
  console.log(`[Health] Updated ${runType} status`);
}

/**
 * Get current health status
 * @param {Object} env - Worker environment
 * @returns {Object} - Combined health status
 */
export async function getHealthStatus(env) {
  const [daily, weekly, docket, lastError] = await Promise.all([
    env.MINERAL_CACHE.get(`${HEALTH_KEY_PREFIX}:last-run:daily`, { type: 'json' }),
    env.MINERAL_CACHE.get(`${HEALTH_KEY_PREFIX}:last-run:weekly`, { type: 'json' }),
    env.MINERAL_CACHE.get(`${HEALTH_KEY_PREFIX}:last-run:docket`, { type: 'json' }),
    env.MINERAL_CACHE.get(`${HEALTH_KEY_PREFIX}:last-run:last-error`, { type: 'json' })
  ]);
  
  const now = new Date();
  
  // Check if daily run is stale (more than 36 hours old)
  let dailyHealthy = true;
  let dailyWarning = null;
  if (daily?.timestamp) {
    const lastDaily = new Date(daily.timestamp);
    const hoursSince = (now - lastDaily) / (1000 * 60 * 60);
    if (hoursSince > 36) {
      dailyHealthy = false;
      dailyWarning = `Last daily run was ${Math.round(hoursSince)} hours ago`;
    }
  } else {
    dailyHealthy = false;
    dailyWarning = 'No daily run recorded';
  }
  
  // Check if weekly run is stale (more than 8 days old)
  let weeklyHealthy = true;
  let weeklyWarning = null;
  if (weekly?.timestamp) {
    const lastWeekly = new Date(weekly.timestamp);
    const daysSince = (now - lastWeekly) / (1000 * 60 * 60 * 24);
    if (daysSince > 8) {
      weeklyHealthy = false;
      weeklyWarning = `Last weekly run was ${Math.round(daysSince)} days ago`;
    }
  } else {
    // Weekly might not have run yet, only warn if we have daily runs
    if (daily?.timestamp) {
      weeklyWarning = 'No weekly run recorded yet';
    }
  }
  
  // Check for recent errors
  let hasRecentError = false;
  if (lastError?.timestamp) {
    const errorTime = new Date(lastError.timestamp);
    const hoursSinceError = (now - errorTime) / (1000 * 60 * 60);
    hasRecentError = hoursSinceError < 24;
  }
  
  // Check if docket run is stale (more than 3 days for weekday monitor)
  let docketHealthy = true;
  let docketWarning = null;
  if (docket?.timestamp) {
    const lastDocket = new Date(docket.timestamp);
    const daysSince = (now - lastDocket) / (1000 * 60 * 60 * 24);
    if (daysSince > 3) {
      docketHealthy = false;
      docketWarning = `Last docket run was ${Math.round(daysSince)} days ago`;
    }
  } else {
    docketWarning = 'No docket run recorded';
  }

  return {
    status: dailyHealthy && weeklyHealthy && !hasRecentError ? 'healthy' : 'unhealthy',
    timestamp: now.toISOString(),
    daily: {
      healthy: dailyHealthy,
      warning: dailyWarning,
      lastRun: daily
    },
    weekly: {
      healthy: weeklyHealthy,
      warning: weeklyWarning,
      lastRun: weekly
    },
    docket: {
      healthy: docketHealthy,
      warning: docketWarning,
      lastRun: docket
    },
    lastError: hasRecentError ? lastError : null
  };
}

/**
 * Get statistics about recent runs
 * @param {Object} env - Worker environment
 * @returns {Object} - Run statistics
 */
export async function getRunStats(env) {
  const daily = await env.MINERAL_CACHE.get(`${HEALTH_KEY_PREFIX}:last-run:daily`, { type: 'json' });
  const weekly = await env.MINERAL_CACHE.get(`${HEALTH_KEY_PREFIX}:last-run:weekly`, { type: 'json' });
  
  return {
    daily: {
      permitsProcessed: daily?.permits_processed || 0,
      alertsSent: daily?.alerts_sent || 0,
      durationMs: daily?.duration_ms || 0,
      timestamp: daily?.timestamp
    },
    weekly: {
      transfersProcessed: weekly?.transfers_processed || 0,
      statusChanges: weekly?.status_changes || 0,
      alertsSent: weekly?.alerts_sent || 0,
      durationMs: weekly?.duration_ms || 0,
      timestamp: weekly?.timestamp
    }
  };
}
