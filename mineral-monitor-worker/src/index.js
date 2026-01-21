/**
 * Mineral Watch Oklahoma - Well Monitoring Worker
 * 
 * Processes OCC Excel files to detect new drilling permits, completions,
 * and operator transfers, then alerts users with matching properties/wells.
 */

import { runDailyMonitor } from './monitors/daily.js';
import { runWeeklyMonitor } from './monitors/weekly.js';
import { runDocketMonitor } from './monitors/docket.js';
import { runDailyDigest, runWeeklyDigest } from './monitors/digest.js';
import { updateHealthStatus, getHealthStatus } from './utils/health.js';
import { sendDailySummary, sendWeeklySummary, sendFailureAlert } from './services/adminAlerts.js';
import { backfillDateRange, getBackfillStatus, clearBackfillProgress, isBackfillRunning } from './backfill/dockets.js';
import { backfillNewProperty, backfillUserProperties } from './services/historicalBackfill.js';

// Helper for JSON responses
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

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
      
      // Daily run (permits and completions) - 8 AM Central (14 UTC)
      if (cronPattern === '0 14 * * *') {
        result = await runDailyMonitor(env);
        await updateHealthStatus(env, 'daily', {
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          permits_processed: result.permitsProcessed,
          completions_processed: result.completionsProcessed,
          permits_skipped: result.permitsSkippedAsProcessed,
          completions_skipped: result.completionsSkippedAsProcessed,
          alerts_sent: result.alertsSent,
          data_freshness: result.dataFreshness,
          status: 'success'
        });

        // Send admin summary
        await sendDailySummary(env, {
          ...result,
          duration: Date.now() - startTime
        });
      }

      // Weekly run (transfers, status changes) - Sunday 8 AM Central (14 UTC)
      if (cronPattern === '0 14 * * 7') {
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

      // Daily digest - Tue-Sat 00:00 UTC = Mon-Fri 6 PM Central
      if (cronPattern === '0 0 * * 2-6') {
        result = await runDailyDigest(env);
        await updateHealthStatus(env, 'daily-digest', {
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          emails_sent: result.emailsSent,
          alerts_processed: result.alertsProcessed,
          status: result.errors.length > 0 ? 'partial' : 'success'
        });
      }

      // Weekly digest - Monday 00:00 UTC = Sunday 6 PM Central
      if (cronPattern === '0 0 * * 1') {
        result = await runWeeklyDigest(env);
        await updateHealthStatus(env, 'weekly-digest', {
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          emails_sent: result.emailsSent,
          alerts_processed: result.alertsProcessed,
          status: result.errors.length > 0 ? 'partial' : 'success'
        });
      }

      // Docket monitor - 8 AM Central weekdays (14 UTC, Mon-Fri)
      if (cronPattern === '0 14 * * 1-5') {
        // Skip if backfill is running to avoid conflicts
        if (await isBackfillRunning(env)) {
          console.log('[Docket] Skipping - backfill in progress');
          await updateHealthStatus(env, 'docket', {
            timestamp: new Date().toISOString(),
            status: 'skipped',
            reason: 'backfill_running'
          });
          return;
        }

        result = await runDocketMonitor(env);
        await updateHealthStatus(env, 'docket', {
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          fetched: result.fetched,
          parsed: result.parsed,
          stored: result.stored,
          alerts_sent: result.alerts,
          status: 'success'
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
      
      // Check for test parameters
      const testApi = url.searchParams.get('testApi');
      const testStatusChangeApi = url.searchParams.get('testStatusChangeApi');
      const testNewStatus = url.searchParams.get('testNewStatus');
      
      const options = {};
      if (testApi) options.testApi = testApi;
      if (testStatusChangeApi) {
        options.testStatusChangeApi = testStatusChangeApi;
        if (testNewStatus) options.testNewStatus = testNewStatus;
      }
      
      ctx.waitUntil(runWeeklyMonitor(env, options));
      return new Response(JSON.stringify({ 
        status: 'started', 
        type: 'weekly',
        testMode: !!(testApi || testStatusChangeApi) 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Test specific well
    if (url.pathname === '/test/check-well') {
      const targetAPI = url.searchParams.get('api') || '3508700028';
      
      try {
        // Get the well from Airtable
        const response = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_WELLS_TABLE}?filterByFormula={API Number}="${targetAPI}"`, {
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        const well = data.records ? data.records[0] : null;
        
        // Download RBDMS data
        const { checkAllWellStatuses } = await import('./services/rbdmsStatus.js');
        const rbdmsResponse = await fetch('https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/rbdms-wells.csv');
        const text = await rbdmsResponse.text();
        
        // Find the well in RBDMS
        const lines = text.split('\n');
        const headers = lines[0].split(',');
        const apiIndex = headers.findIndex(h => h.toLowerCase().includes('api'));
        const statusIndex = headers.findIndex(h => h.toLowerCase().includes('wellstatus') || h.toLowerCase() === 'status');
        
        let rbdmsStatus = null;
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          if (values[apiIndex] && values[apiIndex].replace(/[^0-9]/g, '') === targetAPI) {
            rbdmsStatus = values[statusIndex];
            break;
          }
        }
        
        return new Response(JSON.stringify({
          targetAPI,
          airtable: {
            found: !!well,
            wellStatus: well?.fields['Well Status'],
            allFields: well?.fields
          },
          rbdms: {
            found: rbdmsStatus !== null,
            wellStatus: rbdmsStatus
          },
          comparison: {
            match: well?.fields['Well Status'] === rbdmsStatus,
            shouldTriggerAlert: well && rbdmsStatus && well.fields['Well Status'] !== rbdmsStatus
          }
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }, null, 2), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Debug endpoint to check wells table
    if (url.pathname === '/test/wells-count') {
      try {
        const response = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_WELLS_TABLE}?pageSize=1`, {
          headers: {
            'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        return new Response(JSON.stringify({
          success: response.ok,
          status: response.status,
          recordCount: data.records ? data.records.length : 0,
          hasMore: !!data.offset,
          tableId: env.AIRTABLE_WELLS_TABLE,
          baseId: env.AIRTABLE_BASE_ID,
          sample: data.records ? data.records[0] : null
        }, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }, null, 2), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
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
    
    // Test weekly transfers endpoint
    if (url.pathname === '/test/weekly-transfers') {
      const forceReprocess = url.searchParams.get('force') === 'true';
      const testApi = url.searchParams.get('testApi');
      const testStatusChangeApi = url.searchParams.get('testStatusChangeApi');
      const testNewStatus = url.searchParams.get('testNewStatus');
      
      if (forceReprocess) {
        // Clear the processed transfers cache
        await env.COMPLETIONS_CACHE.delete('processed-transfers');
        console.log('[Test] Cleared processed transfers cache');
      }
      
      try {
        const { runWeeklyMonitor } = await import('./monitors/weekly.js');
        const startTime = Date.now();
        
        // Pass options based on test parameters
        const options = {};
        if (testApi) options.testApi = testApi;
        if (testStatusChangeApi) {
          options.testStatusChangeApi = testStatusChangeApi;
          if (testNewStatus) options.testNewStatus = testNewStatus;
        }
        
        const results = await runWeeklyMonitor(env, options);
        
        return new Response(JSON.stringify({
          success: true,
          duration_ms: Date.now() - startTime,
          results,
          forcedReprocess: forceReprocess,
          testMode: !!(testApi || testStatusChangeApi)
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
    
    // Test status change simulation endpoint
    if (url.pathname === '/test/status-change') {
      const testApi = url.searchParams.get('api') || '3504523551';
      const newStatus = url.searchParams.get('newStatus') || 'IA';
      
      try {
        const { checkAllWellStatuses } = await import('./services/rbdmsStatus.js');
        const startTime = Date.now();
        
        const results = await checkAllWellStatuses(env, {
          testStatusChangeApi: testApi,
          testNewStatus: newStatus
        });
        
        return new Response(JSON.stringify({
          success: true,
          duration_ms: Date.now() - startTime,
          results,
          testApi,
          simulatedStatus: newStatus
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
    
    // Test endpoint to check RBDMS CSV headers
    if (url.pathname === '/test/rbdms-headers') {
      try {
        console.log('[Test] Fetching RBDMS headers...');
        const response = await fetch('https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/rbdms-wells.csv', {
          headers: {
            'User-Agent': 'MineralWatch/2.0 (header inspection)'
          }
        });
        
        if (!response.ok) {
          return jsonResponse({ error: `Failed to fetch RBDMS CSV: ${response.status}` }, 500);
        }
        
        // Only read the first chunk to get headers (file is very large)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let done = false;
        
        // Read chunks until we have at least one complete line
        while (!done && !text.includes('\n')) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            text += decoder.decode(value, { stream: !done });
          }
        }
        
        // Cancel the rest of the stream
        reader.cancel();
        
        const firstLine = text.split('\n')[0];
        const headers = firstLine.split(',').map(h => h.trim());
        
        // Check for pooling unit related columns
        const punRelatedHeaders = headers.filter(h => 
          h.toLowerCase().includes('pun') || 
          h.toLowerCase().includes('pool') || 
          h.toLowerCase().includes('unit') ||
          h.toLowerCase().includes('spacing') ||
          h.toLowerCase().includes('section')
        );
        
        return jsonResponse({
          totalHeaders: headers.length,
          headers: headers,
          punRelatedHeaders: punRelatedHeaders,
          note: "Only downloaded headers to avoid timeout on large file"
        });
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }
    
    // Test permit/completion simulation endpoint
    if (url.pathname === '/test/daily') {
      const testPermitApi = url.searchParams.get('permitApi');
      const testCompletionApi = url.searchParams.get('completionApi');
      
      if (!testPermitApi && !testCompletionApi) {
        return new Response(JSON.stringify({
          error: 'Specify permitApi or completionApi parameter',
          example: '/test/daily?permitApi=3504523551&completionApi=3504523552'
        }, null, 2), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      try {
        const { runDailyMonitor } = await import('./monitors/daily.js');
        const startTime = Date.now();
        
        const options = {};
        if (testPermitApi) options.testPermitApi = testPermitApi;
        if (testCompletionApi) options.testCompletionApi = testCompletionApi;
        
        // Additional test parameters
        if (url.searchParams.get('drillType')) options.drillType = url.searchParams.get('drillType');
        if (url.searchParams.get('pbhSection')) options.pbhSection = url.searchParams.get('pbhSection');
        if (url.searchParams.get('pbhTownship')) options.pbhTownship = url.searchParams.get('pbhTownship');
        if (url.searchParams.get('pbhRange')) options.pbhRange = url.searchParams.get('pbhRange');
        if (url.searchParams.get('bhSection')) options.bhSection = url.searchParams.get('bhSection');
        if (url.searchParams.get('bhTownship')) options.bhTownship = url.searchParams.get('bhTownship');
        if (url.searchParams.get('bhRange')) options.bhRange = url.searchParams.get('bhRange');
        
        const results = await runDailyMonitor(env, options);
        
        return new Response(JSON.stringify({
          success: true,
          duration_ms: Date.now() - startTime,
          results
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
    
    // Test docket monitor endpoint
    if (url.pathname === '/test/docket') {
      const dateParam = url.searchParams.get('date'); // YYYY-MM-DD
      const typeParam = url.searchParams.get('type'); // okc or tulsa
      const dryRun = url.searchParams.get('dryRun') !== 'false'; // default true for safety
      const skipAlerts = url.searchParams.get('skipAlerts') === 'true';

      try {
        const startTime = Date.now();
        const results = await runDocketMonitor(env, {
          dryRun,
          skipAlerts,
          // If specific date/type provided, we'd need to modify runDocketMonitor
          // For now, it processes today and yesterday
        });

        return new Response(JSON.stringify({
          success: true,
          duration_ms: Date.now() - startTime,
          results
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

    // Test OCC data freshness
    if (url.pathname === '/test/occ-freshness') {
      try {
        const { fetchOCCFile, checkDataFreshness } = await import('./services/occ.js');

        // Fetch and check freshness of both file types
        const permits = await fetchOCCFile('itd', env, { skipCache: true });
        const completions = await fetchOCCFile('completions', env, { skipCache: true });

        const permitFreshness = await checkDataFreshness(permits, 'itd', env, 3);
        const completionFreshness = await checkDataFreshness(completions, 'completions', env, 3);

        return jsonResponse({
          success: true,
          permits: {
            recordCount: permits.length,
            ...permitFreshness
          },
          completions: {
            recordCount: completions.length,
            ...completionFreshness
          },
          overallStatus: permitFreshness.isStale || completionFreshness.isStale ? 'STALE' : 'FRESH'
        });
      } catch (error) {
        return jsonResponse({
          success: false,
          error: error.message,
          stack: error.stack
        }, 500);
      }
    }

    // Test unpdf extraction for OCC docket PDFs
    if (url.pathname === '/test/unpdf') {
      const dateParam = url.searchParams.get('date') || '2026-01-09';
      const typeParam = url.searchParams.get('type') || 'okc';

      try {
        const { extractText } = await import('unpdf');
        const startTime = Date.now();

        // Build URL (2026+ format doesn't have year subdirectory)
        const year = parseInt(dateParam.substring(0, 4), 10);
        const basePath = 'https://oklahoma.gov/content/dam/ok/en/occ/documents/ajls/jls-courts/court-clerk/docket-results';
        const pdfUrl = year >= 2026
          ? `${basePath}/${dateParam}-${typeParam}.pdf`
          : `${basePath}/${year}/${dateParam}-${typeParam}.pdf`;

        console.log(`[unpdf test] Fetching: ${pdfUrl}`);

        // Fetch PDF
        const fetchStart = Date.now();
        const response = await fetch(pdfUrl);
        const fetchTime = Date.now() - fetchStart;

        if (!response.ok) {
          return new Response(JSON.stringify({
            success: false,
            error: `PDF fetch failed: ${response.status}`,
            url: pdfUrl
          }, null, 2), {
            status: response.status === 404 ? 404 : 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const pdfBuffer = await response.arrayBuffer();
        const pdfSize = pdfBuffer.byteLength;

        // Extract text with unpdf
        const extractStart = Date.now();
        const result = await extractText(pdfBuffer);
        const extractTime = Date.now() - extractStart;

        // unpdf returns { text: string[], totalPages: number }
        // text is an array of strings (one per page)
        const textArray = result.text || [];
        const totalPages = result.totalPages || 0;
        const fullText = Array.isArray(textArray) ? textArray.join('\n') : String(textArray);

        // Check if text contains expected patterns
        const caseNumberPattern = /CD\d{4}-\d{6}/g;
        const caseNumbers = fullText.match(caseNumberPattern) || [];
        const uniqueCases = [...new Set(caseNumbers)];

        // Sample of extracted text (first 1000 chars)
        const textSample = fullText.substring(0, 1000);

        return new Response(JSON.stringify({
          success: true,
          url: pdfUrl,
          timing: {
            fetch_ms: fetchTime,
            extract_ms: extractTime,
            total_ms: Date.now() - startTime
          },
          pdf: {
            size_bytes: pdfSize,
            size_kb: Math.round(pdfSize / 1024),
            pages: totalPages
          },
          extraction: {
            text_length: fullText.length,
            case_numbers_found: uniqueCases.length,
            case_numbers: uniqueCases.slice(0, 10), // First 10
            sample: textSample
          },
          verdict: fullText.length > 1000 && uniqueCases.length > 0
            ? '✅ unpdf works! Text extraction successful.'
            : '⚠️ Extraction may have issues - check sample text'
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

    // Backfill endpoints
    if (url.pathname === '/backfill/dockets') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.TRIGGER_SECRET}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const startDate = url.searchParams.get('start') || 'resume';
      const endDate = url.searchParams.get('end') || 'yesterday';

      try {
        const startTime = Date.now();
        const results = await backfillDateRange(env, startDate, endDate);

        return jsonResponse({
          success: !results.error,
          duration_ms: Date.now() - startTime,
          results
        });
      } catch (error) {
        return jsonResponse({
          success: false,
          error: error.message,
          stack: error.stack
        }, 500);
      }
    }

    if (url.pathname === '/backfill/status') {
      try {
        const status = await getBackfillStatus(env);
        return jsonResponse(status);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    if (url.pathname === '/backfill/clear') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.TRIGGER_SECRET}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      try {
        const result = await clearBackfillProgress(env);
        return jsonResponse(result);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // Cache status endpoint - view processed APIs cache
    if (url.pathname === '/cache/status') {
      try {
        const cached = await env.COMPLETIONS_CACHE.get('processed-apis', { type: 'json' });

        if (!cached || !cached.apis) {
          return jsonResponse({
            status: 'empty',
            message: 'No processed APIs in cache',
            cacheKey: 'processed-apis'
          });
        }

        // Parse the cache to show stats
        const apis = cached.apis;
        const permitKeys = apis.filter(k => k.includes('|permit'));
        const completionKeys = apis.filter(k => k.includes('|completion'));

        return jsonResponse({
          status: 'populated',
          totalEntries: apis.length,
          permits: permitKeys.length,
          completions: completionKeys.length,
          updatedAt: cached.updatedAt,
          sampleEntries: apis.slice(0, 20),
          note: 'Cache has 8-day TTL. Entries prevent reprocessing of same permits/completions.'
        });
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // Cache clear endpoint - force reprocessing on next run
    if (url.pathname === '/cache/clear') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.TRIGGER_SECRET}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      try {
        // Get current cache state for reporting
        const cached = await env.COMPLETIONS_CACHE.get('processed-apis', { type: 'json' });
        const previousCount = cached?.apis?.length || 0;

        // Clear the cache
        await env.COMPLETIONS_CACHE.delete('processed-apis');

        return jsonResponse({
          success: true,
          message: 'Processed APIs cache cleared. Next daily run will reprocess all current OCC records.',
          previousEntries: previousCount,
          action: 'Cleared processed-apis cache key',
          nextSteps: [
            'Wait for next scheduled daily run (14:00 UTC / 8 AM CT)',
            'Or trigger manually via /trigger/daily with auth header'
          ]
        });
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // Historical backfill for a single property
    if (url.pathname.startsWith('/backfill/property/')) {
      const propertyId = url.pathname.split('/').pop();

      if (!propertyId || propertyId === 'property') {
        return jsonResponse({ error: 'Property ID required' }, 400);
      }

      try {
        const result = await backfillNewProperty(env, propertyId);
        return jsonResponse(result);
      } catch (error) {
        return jsonResponse({ error: error.message, stack: error.stack }, 500);
      }
    }

    // Historical backfill for all properties of a user
    if (url.pathname.startsWith('/backfill/user/')) {
      const userId = url.pathname.split('/').pop();

      if (!userId || userId === 'user') {
        return jsonResponse({ error: 'User ID required' }, 400);
      }

      // This can take a while, so run in background if requested
      const runInBackground = url.searchParams.get('background') === 'true';

      if (runInBackground) {
        ctx.waitUntil(backfillUserProperties(env, userId));
        return jsonResponse({
          status: 'started',
          message: 'Backfill running in background',
          userId
        });
      }

      try {
        const result = await backfillUserProperties(env, userId);
        return jsonResponse(result);
      } catch (error) {
        return jsonResponse({ error: error.message, stack: error.stack }, 500);
      }
    }

    // Force reprocess endpoint - clear cache AND run daily monitor
    if (url.pathname === '/cache/reprocess') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.TRIGGER_SECRET}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      try {
        // Clear the cache first
        const cached = await env.COMPLETIONS_CACHE.get('processed-apis', { type: 'json' });
        const previousCount = cached?.apis?.length || 0;
        await env.COMPLETIONS_CACHE.delete('processed-apis');

        // Run daily monitor in background
        ctx.waitUntil(runDailyMonitor(env));

        return jsonResponse({
          success: true,
          message: 'Cache cleared and daily monitor started',
          previousCacheEntries: previousCount,
          status: 'Daily monitor running in background. Check /health for results.'
        });
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    // Default response
    return jsonResponse({
      service: 'Mineral Watch Oklahoma',
      version: '2.4.0',
      endpoints: [
        '/health',
        '/trigger/daily',
        '/trigger/weekly',
        '/cache/status - View processed APIs cache',
        '/cache/clear - Clear cache (requires auth)',
        '/cache/reprocess - Clear cache and run daily monitor (requires auth)',
        '/backfill/property/:id - Backfill historical alerts for a property',
        '/backfill/user/:id - Backfill historical alerts for all user properties',
        '/test/rbdms-status',
        '/test/weekly-transfers',
        '/test/status-change',
        '/test/daily',
        '/test/docket',
        '/test/occ-freshness',
        '/test/unpdf',
        '/backfill/dockets?start=YYYY-MM-DD&end=YYYY-MM-DD',
        '/backfill/status',
        '/backfill/clear'
      ]
    });
  }
};
