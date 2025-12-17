/**
 * Mineral Watch Oklahoma - Well Monitoring Worker
 * 
 * Processes OCC Excel files to detect new drilling permits, completions,
 * and operator transfers, then alerts users with matching properties/wells.
 */

import { runDailyMonitor } from './monitors/daily.js';
import { runWeeklyMonitor } from './monitors/weekly.js';
import { updateHealthStatus, getHealthStatus } from './utils/health.js';
import { sendDailySummary, sendWeeklySummary, sendFailureAlert } from './services/adminAlerts.js';

export default {
  /**
   * Scheduled handler for cron triggers
   */
  async scheduled(controller, env, ctx) {
    const startTime = Date.now();
    const cronPattern = controller.cron;
    
    console.log(`[Mineral Watch] Cron triggered: ${cronPattern} at ${new Date().toISOString()}`);
    
    try {
      let result;
      
      // Daily run (permits and completions)
      if (cronPattern === '0 12 * * *') {
        result = await runDailyMonitor(env);
        await updateHealthStatus(env, 'daily', {
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          permits_processed: result.permitsProcessed,
          alerts_sent: result.alertsSent,
          status: 'success'
        });
        
        // Send admin summary
        await sendDailySummary(env, {
          ...result,
          duration: Date.now() - startTime
        });
      }
      
      // Weekly run (transfers, status changes)
      if (cronPattern === '0 8 * * 0') {
        result = await runWeeklyMonitor(env);
        await updateHealthStatus(env, 'weekly', {
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          transfers_processed: result.transfersProcessed,
          status_changes: result.statusChanges,
          alerts_sent: result.alertsSent,
          status: 'success'
        });
        
        // Send admin summary
        await sendWeeklySummary(env, {
          ...result,
          duration: Date.now() - startTime
        });
      }
      
      console.log(`[Mineral Watch] Completed in ${Date.now() - startTime}ms`);
      
    } catch (error) {
      console.error(`[Mineral Watch] Error:`, error);
      
      await updateHealthStatus(env, 'last-error', {
        timestamp: new Date().toISOString(),
        cron: cronPattern,
        error_message: error.message,
        stack: error.stack
      });
      
      // Alert admin of failure
      await sendFailureAlert(env, cronPattern, error);
      
      throw error; // Re-throw so Cloudflare marks the run as failed
    }
  },
  
  /**
   * HTTP handler for manual triggers and health checks
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === '/health') {
      const health = await getHealthStatus(env);
      return new Response(JSON.stringify(health, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Manual trigger for daily run (protected)
    if (url.pathname === '/trigger/daily') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.TRIGGER_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      
      ctx.waitUntil(runDailyMonitor(env));
      return new Response(JSON.stringify({ status: 'started', type: 'daily' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Manual trigger for weekly run (protected)
    if (url.pathname === '/trigger/weekly') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.TRIGGER_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      
      ctx.waitUntil(runWeeklyMonitor(env));
      return new Response(JSON.stringify({ status: 'started', type: 'weekly' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Test RBDMS status check endpoint (temporary)
    if (url.pathname === '/test/rbdms-status') {
      // Add force parameter to bypass cache
      const forceRefresh = url.searchParams.get('force') === 'true';
      
      if (forceRefresh) {
        // Clear the cache key first
        await env.MINERAL_CACHE.delete('rbdms-last-modified');
      }
      
      try {
        const { checkAllWellStatuses } = await import('./services/rbdmsStatus.js');
        const startTime = Date.now();
        const results = await checkAllWellStatuses(env);
        
        return new Response(JSON.stringify({
          success: true,
          duration_ms: Date.now() - startTime,
          results,
          forced: forceRefresh
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message,
          stack: error.stack
        }, null, 2), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Default response
    return new Response(JSON.stringify({
      service: 'Mineral Watch Oklahoma',
      version: '2.0.0',
      endpoints: ['/health', '/trigger/daily', '/trigger/weekly', '/test/rbdms-status']
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
