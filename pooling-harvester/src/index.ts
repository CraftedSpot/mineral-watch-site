/**
 * Pooling Order Harvester
 *
 * Scheduled worker that discovers OCC pooling orders and queues them
 * for Claude extraction to build the lease_comps market intelligence database.
 *
 * This is a QUEUE FEEDER - it:
 * 1. Finds POOLING docket entries with HEARD/RECOMMENDED status
 * 2. Calls occ-fetcher /fetch-order to download the order PDF
 * 3. occ-fetcher uploads to R2 and registers with documents-worker
 * 4. Python processor picks up, extracts with pooling prompt + lease_exhibits
 * 5. Post-processing populates pooling_orders, pooling_election_options, lease_comps
 *
 * BE A GOOD CITIZEN:
 * - 5-8 second delay between requests (each /fetch-order is 10-30s internally)
 * - 25 cases per run (~15 min within worker timeout)
 * - Daily cap of 75 cases
 * - Exponential backoff on retries for no_order cases
 */

interface Env {
  DB: D1Database;
  REQUEST_DELAY_MS: string;
  REQUEST_DELAY_JITTER_MS: string;
  BATCH_SIZE: string;
  DAILY_CAP: string;
  TIMEOUT_SAFETY_MS: string;
  MAX_RETRY_ATTEMPTS: string;
  RETRY_BACKOFF_DAYS: string;
  OCC_FETCHER_URL: string;
  OCC_FETCHER?: Fetcher;
}

interface Config {
  requestDelay: number;
  requestJitter: number;
  batchSize: number;
  dailyCap: number;
  timeoutSafety: number;
  maxRetryAttempts: number;
  retryBackoffDays: number;
}

interface PoolingCase {
  case_number: string;
  status: string;
  applicant: string;
  county: string;
  section: string;
  township: string;
  range: string;
  hearing_date: string;
  is_retry: number;
}

interface HarvestResult {
  checked: number;
  ordersFound: number;
  queued: number;
  noOrder: number;
  skipped: number;
  errors: number;
  retriesAttempted: number;
  cases: Array<{ case_number: string; status: string; document_id?: string; error?: string }>;
}

function parseConfig(env: Env): Config {
  return {
    requestDelay: parseInt(env.REQUEST_DELAY_MS) || 5000,
    requestJitter: parseInt(env.REQUEST_DELAY_JITTER_MS) || 3000,
    batchSize: parseInt(env.BATCH_SIZE) || 25,
    dailyCap: parseInt(env.DAILY_CAP) || 75,
    timeoutSafety: parseInt(env.TIMEOUT_SAFETY_MS) || 540000,
    maxRetryAttempts: parseInt(env.MAX_RETRY_ATTEMPTS) || 5,
    retryBackoffDays: parseInt(env.RETRY_BACKOFF_DAYS) || 3,
  };
}

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// ENTRY POINTS
// ============================================================================

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const startTime = Date.now();
    const config = parseConfig(env);

    console.log(`[Pooling Harvester] Starting run at ${new Date().toISOString()}`);
    console.log(`[Pooling Harvester] Config: batch=${config.batchSize}, cap=${config.dailyCap}, delay=${config.requestDelay}ms`);

    const results: HarvestResult = {
      checked: 0, ordersFound: 0, queued: 0, noOrder: 0,
      skipped: 0, errors: 0, retriesAttempted: 0, cases: [],
    };

    try {
      // Sync tracking statuses for previously fetched docs that are now complete
      await syncProcessedStatus(env.DB);

      // Check daily cap
      const todaysCount = await getTodaysCount(env.DB);
      if (todaysCount >= config.dailyCap) {
        console.log(`[Pooling Harvester] Daily cap reached (${todaysCount}/${config.dailyCap})`);
        return;
      }

      const remainingCap = config.dailyCap - todaysCount;

      // Budget split: 70% new, 30% retries
      const retryBudget = Math.min(Math.floor(remainingCap * 0.3), config.batchSize);
      const newBudget = Math.min(remainingCap - retryBudget, config.batchSize);

      // Get cases to process
      const newCases = await getNewPoolingCases(env.DB, newBudget);
      const retryCases = await getRetryCases(env.DB, retryBudget, config.maxRetryAttempts);
      const allCases = [...newCases, ...retryCases];

      console.log(`[Pooling Harvester] Found ${newCases.length} new + ${retryCases.length} retry = ${allCases.length} cases`);

      if (allCases.length === 0) {
        console.log('[Pooling Harvester] No cases to process, all caught up!');
        await updateDailyStats(env.DB, results);
        return;
      }

      // Process each case with rate limiting
      let consecutiveErrors = 0;
      for (const poolingCase of allCases) {
        // Check timeout safety
        if (Date.now() - startTime > config.timeoutSafety) {
          console.log(`[Pooling Harvester] Approaching timeout, stopping after ${results.checked} cases`);
          break;
        }

        // Rate limit
        if (results.checked > 0) {
          const delay = config.requestDelay + Math.random() * config.requestJitter;
          await sleep(delay);
        }

        try {
          await processCase(poolingCase, env, results, config);
          consecutiveErrors = 0;
        } catch (error) {
          // Rate limit = stop run immediately, don't count as error
          if (error instanceof RateLimitError) {
            console.warn('[Pooling Harvester] Rate limited — stopping run, will resume next scheduled run');
            break;
          }

          results.errors++;
          consecutiveErrors++;
          const errMsg = error instanceof Error ? error.message : 'Unknown error';

          console.error(`[Pooling Harvester] Error processing ${poolingCase.case_number}:`, errMsg);
          results.cases.push({ case_number: poolingCase.case_number, status: 'error', error: errMsg });

          // Update tracking with error
          await safeUpdateTracking(env.DB, poolingCase.case_number, poolingCase, {
            harvest_status: 'error',
            error_message: errMsg,
            attempt_count: (poolingCase.is_retry ? await getAttemptCount(env.DB, poolingCase.case_number) : 0) + 1,
            last_attempt_at: new Date().toISOString(),
          });

          if (consecutiveErrors >= 5) {
            console.log('[Pooling Harvester] Too many consecutive errors, stopping run');
            break;
          }
        }

        results.checked++;
      }

      await updateDailyStats(env.DB, results);
      console.log(`[Pooling Harvester] Run complete in ${Date.now() - startTime}ms:`, {
        checked: results.checked,
        ordersFound: results.ordersFound,
        queued: results.queued,
        noOrder: results.noOrder,
        skipped: results.skipped,
        errors: results.errors,
        retriesAttempted: results.retriesAttempted,
      });

    } catch (error) {
      console.error('[Pooling Harvester] Fatal error:', error);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Manual trigger - run full harvest cycle
    if (url.pathname === '/trigger' && request.method === 'POST') {
      const event = { scheduledTime: Date.now(), cron: 'manual' } as ScheduledEvent;
      const ctx = { waitUntil: () => {} } as ExecutionContext;
      await this.scheduled(event, env, ctx);
      return jsonResponse({ success: true, message: 'Harvest triggered' });
    }

    // Stats endpoint
    if (url.pathname === '/stats') {
      const stats = await getHarvestStats(env.DB);
      return jsonResponse(stats);
    }

    // Test single case
    if (url.pathname === '/test' && request.method === 'POST') {
      const body = await request.json() as { case_number?: string };
      if (!body.case_number) {
        return jsonResponse({ error: 'case_number required' }, 400);
      }

      const config = parseConfig(env);
      const results: HarvestResult = {
        checked: 0, ordersFound: 0, queued: 0, noOrder: 0,
        skipped: 0, errors: 0, retriesAttempted: 0, cases: [],
      };

      // Build a synthetic case from docket entry or just use the case number
      const docketEntry = await env.DB.prepare(`
        SELECT case_number, status, applicant, county, section, township, range, hearing_date
        FROM occ_docket_entries WHERE case_number = ?
      `).bind(body.case_number).first<PoolingCase>();

      const testCase: PoolingCase = docketEntry || {
        case_number: body.case_number,
        status: 'HEARD',
        applicant: '', county: '', section: '', township: '', range: '',
        hearing_date: '', is_retry: 0,
      };
      testCase.is_retry = 0;

      try {
        await processCase(testCase, env, results, config);
      } catch (error) {
        results.errors++;
        results.cases.push({
          case_number: body.case_number,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      return jsonResponse({ success: true, results });
    }

    // Trigger backfill - process historical cases with optional date filter
    if (url.pathname === '/trigger-backfill' && request.method === 'POST') {
      const body = await request.json() as { limit?: number; min_hearing_date?: string };
      const limit = Math.min(body.limit || 100, 200);
      const minDate = body.min_hearing_date || '2023-01-01';

      const config = parseConfig(env);
      const startTime = Date.now();
      const results: HarvestResult = {
        checked: 0, ordersFound: 0, queued: 0, noOrder: 0,
        skipped: 0, errors: 0, retriesAttempted: 0, cases: [],
      };

      const cases = await env.DB.prepare(`
        SELECT d.case_number, d.status, d.applicant, d.county,
               d.section, d.township, d.range, d.hearing_date, 0 as is_retry
        FROM occ_docket_entries d
        WHERE d.relief_type = 'POOLING'
          AND d.status IN ('HEARD', 'RECOMMENDED')
          AND d.hearing_date >= ?
          AND NOT EXISTS (
            SELECT 1 FROM pooling_harvest_tracking t
            WHERE t.case_number = d.case_number
          )
        ORDER BY d.hearing_date DESC
        LIMIT ?
      `).bind(minDate, limit).all<PoolingCase>();

      let consecutiveErrors = 0;
      for (const poolingCase of cases.results || []) {
        if (Date.now() - startTime > config.timeoutSafety) break;
        if (results.checked > 0) {
          await sleep(config.requestDelay + Math.random() * config.requestJitter);
        }

        try {
          await processCase(poolingCase, env, results, config);
          consecutiveErrors = 0;
        } catch (error) {
          results.errors++;
          consecutiveErrors++;
          if (consecutiveErrors >= 5) break;
        }
        results.checked++;
      }

      await updateDailyStats(env.DB, results);

      return jsonResponse({
        success: true,
        backfill: true,
        minDate,
        requestedLimit: limit,
        processingMs: Date.now() - startTime,
        results: {
          checked: results.checked,
          ordersFound: results.ordersFound,
          queued: results.queued,
          noOrder: results.noOrder,
          skipped: results.skipped,
          errors: results.errors,
        },
      });
    }

    return new Response(`Pooling Order Harvester

Endpoints:
- POST /trigger           Run full harvest cycle (same as cron)
- POST /trigger-backfill  {"limit": 100, "min_hearing_date": "2024-01-01"}
- POST /test              {"case_number": "CD 2024-001234"} - Test single case
- GET  /stats             Harvest stats, backlog, lease_comps coverage

This worker discovers POOLING docket entries and queues their
Final Orders for Claude extraction via the existing pipeline.
Result: lease_comps table with bonus/NMA, royalty, and lessee data.
`, { headers: { 'Content-Type': 'text/plain' } });
  },
};

// ============================================================================
// CORE PROCESSING
// ============================================================================

async function processCase(
  poolingCase: PoolingCase,
  env: Env,
  results: HarvestResult,
  config: Config
): Promise<void> {
  const caseNumber = poolingCase.case_number;
  const isRetry = !!poolingCase.is_retry;

  console.log(`[Pooling Harvester] Processing ${caseNumber} (${poolingCase.county || 'unknown'} County)${isRetry ? ' [RETRY]' : ''}`);

  if (isRetry) results.retriesAttempted++;

  // For new cases, insert initial tracking record
  if (!isRetry) {
    await safeUpdateTracking(env.DB, caseNumber, poolingCase, {
      harvest_status: 'pending',
    });
  }

  // Check if a document already exists for this case (user may have clicked "Analyze")
  const existingDoc = await env.DB.prepare(`
    SELECT id, status FROM documents
    WHERE deleted_at IS NULL
      AND (json_extract(source_metadata, '$.caseNumber') = ?
           OR json_extract(source_metadata, '$.caseNumber') = ?)
    LIMIT 1
  `).bind(caseNumber, caseNumber.replace(/^CD\s*/i, '')).first<{ id: string; status: string }>();

  if (existingDoc) {
    results.skipped++;
    await safeUpdateTracking(env.DB, caseNumber, poolingCase, {
      harvest_status: 'skipped',
      document_id: existingDoc.id,
      error_message: `Already exists as ${existingDoc.id} (status: ${existingDoc.status})`,
    });
    results.cases.push({ case_number: caseNumber, status: 'skipped', document_id: existingDoc.id });
    console.log(`[Pooling Harvester] ${caseNumber} already has document ${existingDoc.id}, skipping`);
    return;
  }

  // Update status to fetching
  await safeUpdateTracking(env.DB, caseNumber, poolingCase, {
    harvest_status: 'fetching',
    last_attempt_at: new Date().toISOString(),
  });

  // Call occ-fetcher /fetch-order
  const fetchStart = Date.now();
  const response = await fetchFromOccFetcher('/fetch-order', env, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caseNumber: caseNumber,
      userId: 'system_harvester',
      userPlan: 'system',
    }),
  });
  const fetchDuration = Date.now() - fetchStart;
  console.log(`[Pooling Harvester] ${caseNumber}: occ-fetcher responded ${response.status} in ${fetchDuration}ms`);

  // If response times are degrading, warn (potential rate limiting ahead)
  if (fetchDuration > 15000) {
    console.warn(`[Pooling Harvester] Slow response (${fetchDuration}ms) — OCC may be throttling`);
  }

  const attemptCount = isRetry ? (await getAttemptCount(env.DB, caseNumber)) + 1 : 1;

  // Handle 429: Rate limited — stop this run immediately
  if (response.status === 429) {
    console.warn(`[Pooling Harvester] 429 rate limited on ${caseNumber} — stopping run to back off`);
    throw new RateLimitError('Rate limited by OCC');
  }

  // Handle 404: No order on Laserfiche yet
  if (response.status === 404) {
    results.noOrder++;

    // Exponential backoff: 3^attempt * base_days
    const backoffDays = config.retryBackoffDays * Math.pow(3, attemptCount - 1);
    const nextRetry = attemptCount < config.maxRetryAttempts
      ? new Date(Date.now() + backoffDays * 86400000).toISOString()
      : null;

    await safeUpdateTracking(env.DB, caseNumber, poolingCase, {
      harvest_status: 'no_order',
      attempt_count: attemptCount,
      next_retry_at: nextRetry,
      error_message: 'No Final/Interim Order found on Laserfiche',
    });

    results.cases.push({ case_number: caseNumber, status: 'no_order' });
    console.log(`[Pooling Harvester] ${caseNumber}: no order yet (attempt ${attemptCount}, next retry: ${nextRetry || 'never'})`);
    return;
  }

  // Handle server errors
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown');
    throw new Error(`occ-fetcher ${response.status}: ${errorText.substring(0, 200)}`);
  }

  // Parse success response
  const fetchResult = await response.json() as {
    success: boolean;
    document?: { id: string };
    order?: {
      orderNumber: string;
      caseNumber: string;
      applicant: string;
      county: string;
      reliefType: string;
    };
    error?: string;
  };

  if (!fetchResult.success) {
    throw new Error(fetchResult.error || 'Unknown occ-fetcher error');
  }

  // Success - order downloaded and registered
  results.ordersFound++;
  results.queued++;

  await safeUpdateTracking(env.DB, caseNumber, poolingCase, {
    harvest_status: 'fetched',
    document_id: fetchResult.document?.id || null,
    order_number: fetchResult.order?.orderNumber || null,
    attempt_count: attemptCount,
    fetched_at: new Date().toISOString(),
    error_message: null,
    next_retry_at: null,
  });

  results.cases.push({
    case_number: caseNumber,
    status: 'fetched',
    document_id: fetchResult.document?.id,
  });

  console.log(`[Pooling Harvester] ${caseNumber}: order ${fetchResult.order?.orderNumber || '?'} fetched, document ${fetchResult.document?.id} queued`);
}

// ============================================================================
// DISCOVERY QUERIES
// ============================================================================

async function getNewPoolingCases(db: D1Database, limit: number): Promise<PoolingCase[]> {
  const result = await db.prepare(`
    SELECT d.case_number, d.status, d.applicant, d.county,
           d.section, d.township, d.range, d.hearing_date, 0 as is_retry
    FROM occ_docket_entries d
    WHERE d.relief_type = 'POOLING'
      AND d.status IN ('HEARD', 'RECOMMENDED')
      AND NOT EXISTS (
        SELECT 1 FROM pooling_harvest_tracking t
        WHERE t.case_number = d.case_number
      )
    ORDER BY d.hearing_date DESC
    LIMIT ?
  `).bind(limit).all<PoolingCase>();

  const cases = result.results || [];
  console.log(`[Pooling Harvester] New cases: ${cases.length} (limit: ${limit})`);
  return cases;
}

async function getRetryCases(db: D1Database, limit: number, maxAttempts: number): Promise<PoolingCase[]> {
  if (limit <= 0) return [];

  const result = await db.prepare(`
    SELECT case_number, docket_status as status, applicant, county,
           section, township, range, hearing_date, 1 as is_retry
    FROM pooling_harvest_tracking
    WHERE harvest_status = 'no_order'
      AND attempt_count < ?
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
    ORDER BY hearing_date DESC
    LIMIT ?
  `).bind(maxAttempts, limit).all<PoolingCase>();

  const cases = result.results || [];
  console.log(`[Pooling Harvester] Retry cases: ${cases.length} (limit: ${limit}, maxAttempts: ${maxAttempts})`);
  return cases;
}

// ============================================================================
// TRACKING HELPERS
// ============================================================================

/**
 * Insert or update tracking record. Uses INSERT ... ON CONFLICT for upsert.
 */
async function safeUpdateTracking(
  db: D1Database,
  caseNumber: string,
  poolingCase: PoolingCase,
  updates: {
    harvest_status?: string;
    document_id?: string | null;
    order_number?: string | null;
    attempt_count?: number;
    last_attempt_at?: string | null;
    next_retry_at?: string | null;
    error_message?: string | null;
    fetched_at?: string | null;
    processed_at?: string | null;
  }
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO pooling_harvest_tracking (
        case_number, docket_status, applicant, county, section, township, range,
        hearing_date, harvest_status, document_id, order_number,
        attempt_count, last_attempt_at, next_retry_at, error_message,
        fetched_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_number) DO UPDATE SET
        harvest_status = COALESCE(excluded.harvest_status, harvest_status),
        document_id = COALESCE(excluded.document_id, document_id),
        order_number = COALESCE(excluded.order_number, order_number),
        attempt_count = COALESCE(excluded.attempt_count, attempt_count),
        last_attempt_at = COALESCE(excluded.last_attempt_at, last_attempt_at),
        next_retry_at = excluded.next_retry_at,
        error_message = excluded.error_message,
        fetched_at = COALESCE(excluded.fetched_at, fetched_at),
        processed_at = COALESCE(excluded.processed_at, processed_at),
        updated_at = datetime('now')
    `).bind(
      caseNumber,
      poolingCase.status || null,
      poolingCase.applicant || null,
      poolingCase.county || null,
      poolingCase.section || null,
      poolingCase.township || null,
      poolingCase.range || null,
      poolingCase.hearing_date || null,
      updates.harvest_status || 'pending',
      updates.document_id ?? null,
      updates.order_number ?? null,
      updates.attempt_count ?? 0,
      updates.last_attempt_at ?? null,
      updates.next_retry_at ?? null,
      updates.error_message ?? null,
      updates.fetched_at ?? null,
      updates.processed_at ?? null,
    ).run();
  } catch (err) {
    console.error(`[Pooling Harvester] Tracking update failed for ${caseNumber}:`, err);
  }
}

async function getAttemptCount(db: D1Database, caseNumber: string): Promise<number> {
  const row = await db.prepare(
    `SELECT attempt_count FROM pooling_harvest_tracking WHERE case_number = ?`
  ).bind(caseNumber).first<{ attempt_count: number }>();
  return row?.attempt_count || 0;
}

async function getTodaysCount(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    SELECT COUNT(*) as count
    FROM pooling_harvest_tracking
    WHERE date(last_attempt_at) = date('now')
  `).first<{ count: number }>();
  return result?.count || 0;
}

/**
 * Sync tracking statuses: mark 'fetched' docs as 'processed' once extraction completes.
 */
async function syncProcessedStatus(db: D1Database): Promise<void> {
  try {
    const result = await db.prepare(`
      UPDATE pooling_harvest_tracking
      SET harvest_status = 'processed',
          processed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE harvest_status = 'fetched'
        AND document_id IS NOT NULL
        AND document_id IN (
          SELECT id FROM documents WHERE status = 'complete'
        )
    `).run();

    if (result.meta.changes > 0) {
      console.log(`[Pooling Harvester] Synced ${result.meta.changes} docs to 'processed' status`);
    }
  } catch (err) {
    console.error('[Pooling Harvester] Status sync failed:', err);
  }
}

// ============================================================================
// STATS
// ============================================================================

async function updateDailyStats(db: D1Database, results: HarvestResult): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO pooling_harvest_daily_stats
        (date, cases_checked, orders_found, no_order_count, errors, retries_attempted, run_count)
      VALUES (date('now'), ?, ?, ?, ?, ?, 1)
      ON CONFLICT(date) DO UPDATE SET
        cases_checked = cases_checked + excluded.cases_checked,
        orders_found = orders_found + excluded.orders_found,
        no_order_count = no_order_count + excluded.no_order_count,
        errors = errors + excluded.errors,
        retries_attempted = retries_attempted + excluded.retries_attempted,
        run_count = run_count + 1
    `).bind(
      results.checked,
      results.ordersFound,
      results.noOrder,
      results.errors,
      results.retriesAttempted,
    ).run();
  } catch (err) {
    console.error('[Pooling Harvester] Failed to update daily stats:', err);
  }
}

async function getHarvestStats(db: D1Database): Promise<object> {
  const totals = await db.prepare(`
    SELECT
      COUNT(*) as total_tracked,
      SUM(CASE WHEN harvest_status = 'fetched' THEN 1 ELSE 0 END) as fetched,
      SUM(CASE WHEN harvest_status = 'processed' THEN 1 ELSE 0 END) as processed,
      SUM(CASE WHEN harvest_status = 'no_order' THEN 1 ELSE 0 END) as no_order,
      SUM(CASE WHEN harvest_status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      SUM(CASE WHEN harvest_status = 'error' THEN 1 ELSE 0 END) as errors,
      SUM(CASE WHEN harvest_status = 'pending' THEN 1 ELSE 0 END) as pending
    FROM pooling_harvest_tracking
  `).first();

  const byCounty = await db.prepare(`
    SELECT county, harvest_status, COUNT(*) as count
    FROM pooling_harvest_tracking
    WHERE county IS NOT NULL
    GROUP BY county, harvest_status
    ORDER BY count DESC
    LIMIT 50
  `).all();

  const recentDays = await db.prepare(`
    SELECT * FROM pooling_harvest_daily_stats
    ORDER BY date DESC LIMIT 7
  `).all();

  const leaseCompsCoverage = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM lease_comps) as total_lease_comps,
      (SELECT COUNT(DISTINCT source_document_id) FROM lease_comps) as documents_with_comps,
      (SELECT COUNT(*) FROM pooling_orders) as total_pooling_orders
  `).first();

  // How many POOLING HEARD/RECOMMENDED cases remain unharvested
  const backlog = await db.prepare(`
    SELECT COUNT(*) as count
    FROM occ_docket_entries d
    WHERE d.relief_type = 'POOLING'
      AND d.status IN ('HEARD', 'RECOMMENDED')
      AND NOT EXISTS (
        SELECT 1 FROM pooling_harvest_tracking t
        WHERE t.case_number = d.case_number
      )
  `).first();

  // Retry queue size
  const retryQueue = await db.prepare(`
    SELECT COUNT(*) as count
    FROM pooling_harvest_tracking
    WHERE harvest_status = 'no_order'
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
  `).first();

  return {
    totals,
    byCounty: byCounty.results,
    recentDays: recentDays.results,
    leaseCompsCoverage,
    backlog,
    retryQueue,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

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

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
