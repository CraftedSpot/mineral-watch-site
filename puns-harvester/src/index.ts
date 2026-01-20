/**
 * PUN Harvester Worker
 *
 * Scheduled worker that discovers wells with 1002A completion reports and
 * queues them for processing via the existing Claude extraction pipeline.
 *
 * This is a QUEUE FEEDER - it:
 * 1. Finds wells without PUN coverage
 * 2. Checks OCC for 1002A availability
 * 3. Calls /download-1002a-forms to queue for Claude extraction
 * 4. Tracks progress in well_1002a_tracking table
 *
 * BE A GOOD CITIZEN:
 * - 3-5 second delay between requests (mimics human browsing)
 * - 50-100 wells per run (completes in ~5-10 min)
 * - Daily cap of 100 wells
 * - Exponential backoff on errors
 */

interface Env {
  DB: D1Database;
  REQUEST_DELAY_MS: string;
  REQUEST_DELAY_JITTER_MS: string;
  BATCH_SIZE: string;
  DAILY_CAP: string;
  TIMEOUT_SAFETY_MS: string;
  OCC_FETCHER_URL: string;
  OCC_FETCHER?: Fetcher;
}

interface WellToCheck {
  api_number: string;
  well_name: string;
  county: string;
  section?: string;
  township?: string;
  range?: string;
  priority: number;
}

interface Form1002A {
  entryId: number;
  name: string;
  formNumber: string;
  apiNumber: string;
  wellName: string;
  county: string;
  location: string;
  effectiveDate: string;
  scanDate: string;
  docId: string;
  downloadUrl: string;
}

interface HarvestResult {
  checked: number;
  formsFound: number;
  queued: number;
  noForms: number;
  errors: number;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const startTime = Date.now();
    const config = {
      requestDelay: parseInt(env.REQUEST_DELAY_MS) || 3000,
      requestJitter: parseInt(env.REQUEST_DELAY_JITTER_MS) || 2000,
      batchSize: parseInt(env.BATCH_SIZE) || 50,
      dailyCap: parseInt(env.DAILY_CAP) || 100,
      timeoutSafety: parseInt(env.TIMEOUT_SAFETY_MS) || 540000,
    };

    console.log(`[Harvester] Starting run at ${new Date().toISOString()}`);
    console.log(`[Harvester] Config: batch=${config.batchSize}, cap=${config.dailyCap}, delay=${config.requestDelay}ms`);

    const results: HarvestResult = {
      checked: 0,
      formsFound: 0,
      queued: 0,
      noForms: 0,
      errors: 0
    };

    try {
      // Check daily cap
      const todaysCount = await getTodaysCount(env.DB);
      if (todaysCount >= config.dailyCap) {
        console.log(`[Harvester] Daily cap reached (${todaysCount}/${config.dailyCap}), skipping run`);
        return;
      }

      const remainingCap = config.dailyCap - todaysCount;
      const effectiveBatchSize = Math.min(config.batchSize, remainingCap);
      console.log(`[Harvester] Today's count: ${todaysCount}, remaining cap: ${remainingCap}, batch: ${effectiveBatchSize}`);

      // Get prioritized wells to check
      const wells = await getWellsToCheck(env.DB, effectiveBatchSize);
      console.log(`[Harvester] Found ${wells.length} wells to check`);

      if (wells.length === 0) {
        console.log('[Harvester] No wells need checking, all caught up!');
        await updateDailyStats(env.DB, results);
        return;
      }

      // Process each well with rate limiting
      for (const well of wells) {
        // Check timeout safety
        if (Date.now() - startTime > config.timeoutSafety) {
          console.log(`[Harvester] Approaching timeout, stopping early after ${results.checked} wells`);
          break;
        }

        // Rate limit: delay between requests
        if (results.checked > 0) {
          const delay = config.requestDelay + Math.random() * config.requestJitter;
          await sleep(delay);
        }

        const wellStartTime = Date.now();

        try {
          await processWell(well, env, results, wellStartTime);
        } catch (error) {
          results.errors++;
          console.error(`[Harvester] Error processing ${well.api_number}:`, error);

          await updateTracking(env.DB, well.api_number, 0, {
            status: 'error',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            processing_ms: Date.now() - wellStartTime,
            source: 'harvester'
          });

          // Exponential backoff on repeated errors
          if (results.errors >= 5) {
            console.log('[Harvester] Too many errors, stopping run');
            break;
          }
        }

        results.checked++;
      }

      // Update daily stats
      await updateDailyStats(env.DB, results);

      console.log(`[Harvester] Run complete in ${Date.now() - startTime}ms:`, results);

    } catch (error) {
      console.error('[Harvester] Fatal error:', error);
    }
  },

  // Manual trigger endpoint for testing
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const event = { scheduledTime: Date.now(), cron: 'manual' } as ScheduledEvent;
      const ctx = { waitUntil: () => {} } as ExecutionContext;
      await this.scheduled(event, env, ctx);
      return new Response(JSON.stringify({ success: true, message: 'Harvest triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/stats') {
      const stats = await getHarvestStats(env.DB);
      return new Response(JSON.stringify(stats, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/test' && request.method === 'POST') {
      const body = await request.json() as { api_number?: string };
      if (!body.api_number) {
        return new Response(JSON.stringify({ error: 'api_number required' }), { status: 400 });
      }

      const result = await testSingleWell(body.api_number, env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Test batch endpoint - process a small number of wells for testing
    if (url.pathname === '/test-batch' && request.method === 'POST') {
      const body = await request.json() as { count?: number };
      const count = Math.min(body.count || 5, 10); // Max 10 for testing

      const startTime = Date.now();
      const config = {
        requestDelay: parseInt(env.REQUEST_DELAY_MS) || 3000,
        requestJitter: parseInt(env.REQUEST_DELAY_JITTER_MS) || 2000,
      };

      const results = {
        checked: 0,
        formsFound: 0,
        queued: 0,
        noForms: 0,
        errors: 0,
        wells: [] as Array<{ api: string; status: string; forms: number; error?: string }>
      };

      const wells = await getWellsToCheck(env.DB, count);

      for (const well of wells) {
        if (results.checked > 0) {
          const delay = config.requestDelay + Math.random() * config.requestJitter;
          await sleep(delay);
        }

        const wellStart = Date.now();
        try {
          await processWell(well, env, results, wellStart);
          results.wells.push({
            api: well.api_number,
            status: 'queued',
            forms: 1
          });
        } catch (error) {
          results.errors++;
          results.wells.push({
            api: well.api_number,
            status: 'error',
            forms: 0,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        results.checked++;
      }

      return new Response(JSON.stringify({
        success: true,
        batchSize: count,
        processingMs: Date.now() - startTime,
        results,
        message: `Processed ${results.checked} wells. Check /stats for pipeline status.`
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(`PUN Harvester

Endpoints:
- POST /trigger - Trigger full harvest run
- POST /test-batch {"count": 5} - Test small batch (max 10)
- GET /stats - View harvest statistics
- POST /test {api_number} - Test single well lookup

This worker discovers wells with 1002A forms and queues them
for Claude extraction via the existing document pipeline.
`, {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

/**
 * Get wells to check, prioritized for maximum PUN extraction success:
 *
 * STATUS FILTER (only wells that matter to mineral owners):
 *   - AC (Active): Generating royalties NOW - highest priority
 *   - NEW: About to produce - high priority
 *   - DRL (Drilling): Coming soon - medium priority
 *   - SKIP: PA (Plugged), TA (Temp Abandoned), SI (Shut-in) - no future royalties
 *
 * DATE FILTER:
 *   - Only wells completed >= 2010 (modern forms have PUNs filled in)
 *   - Pre-2010 forms often have blank "OTC Prod. Unit No." fields
 *
 * Rationale: 1997 1002A forms have blank PUN fields,
 * while 2019+ forms have PUNs clearly filled in (e.g., "043-226597-0-0000")
 */
async function getWellsToCheck(db: D1Database, limit: number): Promise<WellToCheck[]> {
  // Single optimized query with proper priority ordering
  const result = await db.prepare(`
    SELECT
      w.api_number,
      w.well_name,
      w.county,
      w.section,
      w.township,
      w.range,
      w.well_status,
      w.completion_date,
      CASE w.well_status
        WHEN 'AC' THEN 1
        WHEN 'Active' THEN 1
        WHEN 'NEW' THEN 2
        WHEN 'DRL' THEN 3
        ELSE 4
      END as priority
    FROM wells w
    WHERE NOT EXISTS (SELECT 1 FROM well_pun_links l WHERE l.api_number = w.api_number)
      AND NOT EXISTS (SELECT 1 FROM well_1002a_tracking t WHERE t.api_number = w.api_number)
      AND w.well_status IN ('AC', 'Active', 'NEW', 'DRL')
      AND w.completion_date >= '2010-01-01'
    ORDER BY
      CASE w.well_status
        WHEN 'AC' THEN 1
        WHEN 'Active' THEN 1
        WHEN 'NEW' THEN 2
        WHEN 'DRL' THEN 3
        ELSE 4
      END,
      w.completion_date DESC
    LIMIT ?
  `).bind(limit).all();

  const wells = (result.results || []) as unknown as WellToCheck[];

  // Log breakdown by status
  const statusCounts: Record<string, number> = {};
  for (const w of wells) {
    const status = (w as any).well_status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  console.log(`[Harvester] Selected ${wells.length} wells (limit: ${limit})`);
  console.log(`[Harvester] By status:`, statusCounts);
  console.log(`[Harvester] Filters: status IN (AC, NEW, DRL), completion >= 2010`);
  console.log(`[Harvester] Skipped: PA, TA, SI, pre-2010 wells`);

  return wells;
}

/**
 * Process a single well:
 * 1. Check OCC for 1002A availability
 * 2. If found, call /download-1002a-forms to queue for processing
 * 3. Track status in well_1002a_tracking
 */
async function processWell(
  well: WellToCheck,
  env: Env,
  results: HarvestResult,
  startTime: number
): Promise<void> {
  console.log(`[Harvester] Processing ${well.api_number} (${well.well_name})`);

  // Step 1: Check OCC for 1002A availability
  const formsResponse = await fetchFromOccFetcher(
    `/get-1002a-forms?api=${encodeURIComponent(well.api_number)}`,
    env
  );

  if (!formsResponse.ok) {
    throw new Error(`OCC fetcher error: ${formsResponse.status}`);
  }

  const formsData = await formsResponse.json() as {
    success: boolean;
    forms?: Form1002A[];
    error?: string;
  };

  if (!formsData.success) {
    throw new Error(formsData.error || 'Unknown OCC fetcher error');
  }

  const forms = formsData.forms || [];

  if (forms.length === 0) {
    // No 1002A forms found - mark as checked but no form
    results.noForms++;
    await updateTracking(env.DB, well.api_number, 0, {
      has_1002a: 0,
      status: 'no_form',
      checked_at: new Date().toISOString(),
      processing_ms: Date.now() - startTime,
      source: 'harvester'
    });
    console.log(`[Harvester] No 1002A forms for ${well.api_number}`);
    return;
  }

  results.formsFound++;
  console.log(`[Harvester] Found ${forms.length} 1002A form(s) for ${well.api_number}`);

  // Step 2: Queue for processing via /download-1002a-forms
  // This downloads the PDF, stores in R2, and registers with documents-worker
  const downloadResponse = await fetchFromOccFetcher(
    '/download-1002a-forms',
    env,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiNumber: well.api_number,
        userId: 'system_harvester',
        userPlan: 'system'
      })
    }
  );

  const downloadResult = await downloadResponse.json() as {
    success: boolean;
    error?: string;
    results?: Array<{
      success: boolean;
      form: { entryId: number };
      documentId?: string;
      error?: string;
    }>;
  };

  if (!downloadResult.success) {
    // Track error but don't throw - this well has forms, just failed to download
    await updateTracking(env.DB, well.api_number, forms[0].entryId, {
      has_1002a: 1,
      status: 'error',
      error_message: downloadResult.error || 'Download failed',
      checked_at: new Date().toISOString(),
      processing_ms: Date.now() - startTime,
      source: 'harvester'
    });
    console.log(`[Harvester] Download failed for ${well.api_number}: ${downloadResult.error}`);
    return;
  }

  // Create a map of entryId -> formNumber for form_type tracking
  const formTypeMap = new Map<number, string>();
  for (const form of forms) {
    formTypeMap.set(form.entryId, form.formNumber);
  }

  // Step 3: Track each successfully queued form
  for (const result of downloadResult.results || []) {
    if (result.success && result.form?.entryId) {
      results.queued++;
      const formType = formTypeMap.get(result.form.entryId) || null;
      await updateTracking(env.DB, well.api_number, result.form.entryId, {
        has_1002a: 1,
        status: 'fetched',  // PDF downloaded, waiting for Claude extraction
        document_id: result.documentId || null,
        checked_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        processing_ms: Date.now() - startTime,
        source: 'harvester',
        form_type: formType  // e.g., "1002A" or "1002C"
      });
      console.log(`[Harvester] Queued ${well.api_number} entry ${result.form.entryId} (${formType}) for processing`);
    }
  }
}

/**
 * Helper to fetch from occ-fetcher using service binding if available
 */
async function fetchFromOccFetcher(
  path: string,
  env: Env,
  options?: RequestInit
): Promise<Response> {
  if (env.OCC_FETCHER) {
    return env.OCC_FETCHER.fetch(
      new Request(`https://occ-fetcher${path}`, options)
    );
  }
  return fetch(`${env.OCC_FETCHER_URL}${path}`, options);
}

/**
 * Update or insert tracking record
 */
async function updateTracking(
  db: D1Database,
  apiNumber: string,
  entryId: number,
  data: {
    has_1002a?: number;
    status?: string;
    document_id?: string | null;
    extracted_pun?: string | null;
    extraction_method?: string | null;
    confidence?: string | null;
    error_message?: string | null;
    checked_at?: string;
    fetched_at?: string;
    processed_at?: string;
    processing_ms?: number;
    source?: string;
    triggered_by?: string | null;
    form_type?: string | null;
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO well_1002a_tracking
    (api_number, entry_id, has_1002a, status, document_id, extracted_pun, extraction_method,
     confidence, error_message, checked_at, fetched_at, processed_at, processing_ms, source, triggered_by, form_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(api_number, entry_id) DO UPDATE SET
      has_1002a = COALESCE(excluded.has_1002a, has_1002a),
      status = COALESCE(excluded.status, status),
      document_id = COALESCE(excluded.document_id, document_id),
      extracted_pun = COALESCE(excluded.extracted_pun, extracted_pun),
      extraction_method = COALESCE(excluded.extraction_method, extraction_method),
      confidence = COALESCE(excluded.confidence, confidence),
      error_message = excluded.error_message,
      checked_at = COALESCE(excluded.checked_at, checked_at),
      fetched_at = COALESCE(excluded.fetched_at, fetched_at),
      processed_at = COALESCE(excluded.processed_at, processed_at),
      processing_ms = COALESCE(excluded.processing_ms, processing_ms),
      form_type = COALESCE(excluded.form_type, form_type),
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    apiNumber,
    entryId,
    data.has_1002a ?? null,
    data.status ?? null,
    data.document_id ?? null,
    data.extracted_pun ?? null,
    data.extraction_method ?? null,
    data.confidence ?? null,
    data.error_message ?? null,
    data.checked_at ?? null,
    data.fetched_at ?? null,
    data.processed_at ?? null,
    data.processing_ms ?? null,
    data.source ?? 'harvester',
    data.triggered_by ?? null,
    data.form_type ?? null
  ).run();
}

/**
 * Get count of wells checked today
 */
async function getTodaysCount(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    SELECT COUNT(*) as count
    FROM well_1002a_tracking
    WHERE date(checked_at) = date('now')
      AND source = 'harvester'
  `).first<{ count: number }>();

  return result?.count || 0;
}

/**
 * Update daily statistics
 */
async function updateDailyStats(db: D1Database, results: HarvestResult): Promise<void> {
  await db.prepare(`
    INSERT INTO puns_harvest_daily_stats (date, wells_checked, forms_found, puns_extracted, errors, run_count)
    VALUES (date('now'), ?, ?, ?, ?, 1)
    ON CONFLICT(date) DO UPDATE SET
      wells_checked = wells_checked + excluded.wells_checked,
      forms_found = forms_found + excluded.forms_found,
      puns_extracted = puns_extracted + excluded.puns_extracted,
      errors = errors + excluded.errors,
      run_count = run_count + 1
  `).bind(results.checked, results.formsFound, results.queued, results.errors).run();
}

/**
 * Get harvest statistics
 */
async function getHarvestStats(db: D1Database): Promise<object> {
  const totals = await db.prepare(`
    SELECT
      COUNT(*) as total_checked,
      SUM(CASE WHEN has_1002a = 1 THEN 1 ELSE 0 END) as total_with_forms,
      SUM(CASE WHEN status = 'fetched' THEN 1 ELSE 0 END) as total_queued,
      SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as total_processed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as total_errors,
      SUM(CASE WHEN has_1002a = 0 THEN 1 ELSE 0 END) as total_no_form
    FROM well_1002a_tracking
  `).first();

  const bySource = await db.prepare(`
    SELECT source, COUNT(*) as count
    FROM well_1002a_tracking
    GROUP BY source
  `).all();

  const recent = await db.prepare(`
    SELECT * FROM puns_harvest_daily_stats
    ORDER BY date DESC
    LIMIT 7
  `).all();

  const coverage = await db.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT api_number) FROM well_pun_links) as wells_with_pun,
      (SELECT COUNT(*) FROM wells WHERE well_status IN ('AC', 'Active')) as total_active_wells
  `).first();

  const pipeline = await db.prepare(`
    SELECT status, COUNT(*) as count
    FROM well_1002a_tracking
    WHERE has_1002a = 1
    GROUP BY status
  `).all();

  return {
    totals,
    bySource: bySource.results,
    pipeline: pipeline.results,
    recentDays: recent.results,
    coverage,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Test single well (for debugging)
 */
async function testSingleWell(apiNumber: string, env: Env): Promise<object> {
  const startTime = Date.now();

  try {
    // Check for 1002A forms
    const formsResponse = await fetchFromOccFetcher(
      `/get-1002a-forms?api=${encodeURIComponent(apiNumber)}`,
      env
    );

    const formsData = await formsResponse.json() as { success: boolean; forms?: Form1002A[]; error?: string };

    if (!formsData.success || !formsData.forms?.length) {
      return {
        apiNumber,
        has1002a: false,
        forms: [],
        message: 'No 1002A forms found',
        processingMs: Date.now() - startTime,
      };
    }

    return {
      apiNumber,
      has1002a: true,
      formCount: formsData.forms.length,
      forms: formsData.forms.map(f => ({
        entryId: f.entryId,
        effectiveDate: f.effectiveDate,
        wellName: f.wellName,
        county: f.county
      })),
      message: `Found ${formsData.forms.length} form(s). Use POST /download-1002a-forms to queue for processing.`,
      processingMs: Date.now() - startTime,
    };

  } catch (error) {
    return {
      apiNumber,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      processingMs: Date.now() - startTime,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
