/**
 * PUN Harvester Worker
 *
 * Scheduled worker that scrapes 1002A completion reports to extract
 * verified PUN→API mappings. Runs nightly at 2am CT, grows crosswalk
 * coverage over time.
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
  USE_CLAUDE_EXTRACTION: string;
  OCC_FETCHER?: Fetcher; // Service binding for worker-to-worker calls
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
  punsExtracted: number;
  errors: number;
  skipped: number;
}

interface HarvestLogEntry {
  has_1002a?: number;
  entry_id?: number;
  extraction_method?: string;
  extracted_pun?: string;
  confidence?: string;
  success: number;
  error_message?: string;
  processing_ms?: number;
}

// PUN regex pattern: XXX-XXXXX-X-XXXXX (3-5-1-5 format)
// Matches with optional leading zeros
const PUN_PATTERN = /\b(\d{3})-(\d{5})-(\d)-(\d{5})\b/g;

// Alternative patterns that might appear in OCR'd documents
const PUN_ALT_PATTERNS = [
  // With spaces instead of dashes
  /\b(\d{3})\s+(\d{5})\s+(\d)\s+(\d{5})\b/g,
  // Partial format with less padding
  /\bPUN[:\s]+(\d{1,3})-(\d{1,5})-(\d)-(\d{1,5})\b/gi,
  // Production Unit Number label
  /Production\s+Unit\s+(?:Number|No\.?)[:\s]+(\d{1,3})-(\d{1,5})-(\d)-(\d{1,5})/gi,
];

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

    console.log(`[Harvester] Starting PUN harvest run at ${new Date().toISOString()}`);
    console.log(`[Harvester] Config: batch=${config.batchSize}, cap=${config.dailyCap}, delay=${config.requestDelay}ms`);

    const results: HarvestResult = {
      checked: 0,
      formsFound: 0,
      punsExtracted: 0,
      errors: 0,
      skipped: 0
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

        try {
          await processWell(well, env, results);
        } catch (error) {
          results.errors++;
          console.error(`[Harvester] Error processing ${well.api_number}:`, error);

          await logHarvest(env.DB, well.api_number, {
            success: 0,
            error_message: error instanceof Error ? error.message : 'Unknown error',
            processing_ms: Date.now() - startTime,
          });

          // Exponential backoff on repeated errors
          if (results.errors >= 3) {
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
      // Trigger a harvest run manually
      const event = { scheduledTime: Date.now(), cron: 'manual' } as ScheduledEvent;
      const ctx = { waitUntil: () => {} } as ExecutionContext;
      await this.scheduled(event, env, ctx);
      return new Response(JSON.stringify({ success: true, message: 'Harvest triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/stats') {
      // Return harvest statistics
      const stats = await getHarvestStats(env.DB);
      return new Response(JSON.stringify(stats, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/test' && request.method === 'POST') {
      // Test a single API number
      const body = await request.json() as { api_number?: string };
      if (!body.api_number) {
        return new Response(JSON.stringify({ error: 'api_number required' }), { status: 400 });
      }

      const result = await testSingleWell(body.api_number, env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('PUN Harvester\n\nEndpoints:\n- POST /trigger - Trigger harvest run\n- GET /stats - View harvest statistics\n- POST /test {api_number} - Test single well', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

/**
 * Get wells to check, prioritized by:
 * 1. Monitored wells (in tracked sections) with no coverage
 * 2. Recent completions (last 2 years) with no coverage
 * 3. Any active wells with no coverage
 */
async function getWellsToCheck(db: D1Database, limit: number): Promise<WellToCheck[]> {
  const wells: WellToCheck[] = [];

  // Priority 1: Monitored wells with no coverage
  // Check if monitored_sections table exists first
  try {
    const priority1 = await db.prepare(`
      SELECT DISTINCT w.api_number, w.well_name, w.county, w.section, w.township, w.range, 1 as priority
      FROM wells w
      INNER JOIN monitored_sections ms
        ON w.section = ms.section
        AND w.township = ms.township
        AND w.range = ms.range
      WHERE NOT EXISTS (SELECT 1 FROM well_pun_links l WHERE l.api_number = w.api_number)
        AND NOT EXISTS (SELECT 1 FROM puns_harvest_log h WHERE h.api_number = w.api_number)
        AND w.well_status IN ('AC', 'NEW', 'Active')
      LIMIT ?
    `).bind(Math.ceil(limit / 3)).all();

    if (priority1.results) {
      for (const row of priority1.results) {
        wells.push(row as unknown as WellToCheck);
      }
    }
  } catch (e) {
    // monitored_sections table may not exist, skip this priority
    console.log('[Harvester] monitored_sections table not found, skipping priority 1');
  }

  // Priority 2: Recent completions with no coverage
  if (wells.length < limit) {
    const priority2 = await db.prepare(`
      SELECT api_number, well_name, county, section, township, range, 2 as priority
      FROM wells w
      WHERE NOT EXISTS (SELECT 1 FROM well_pun_links l WHERE l.api_number = w.api_number)
        AND NOT EXISTS (SELECT 1 FROM puns_harvest_log h WHERE h.api_number = w.api_number)
        AND completion_date > date('now', '-2 years')
        AND well_status IN ('AC', 'Active')
      ORDER BY completion_date DESC
      LIMIT ?
    `).bind(limit - wells.length).all();

    if (priority2.results) {
      for (const row of priority2.results) {
        wells.push(row as unknown as WellToCheck);
      }
    }
  }

  // Priority 3: Any active wells with no coverage
  if (wells.length < limit) {
    const priority3 = await db.prepare(`
      SELECT api_number, well_name, county, section, township, range, 3 as priority
      FROM wells w
      WHERE NOT EXISTS (SELECT 1 FROM well_pun_links l WHERE l.api_number = w.api_number)
        AND NOT EXISTS (SELECT 1 FROM puns_harvest_log h WHERE h.api_number = w.api_number)
        AND well_status IN ('AC', 'Active')
      ORDER BY county, api_number
      LIMIT ?
    `).bind(limit - wells.length).all();

    if (priority3.results) {
      for (const row of priority3.results) {
        wells.push(row as unknown as WellToCheck);
      }
    }
  }

  return wells;
}

/**
 * Process a single well: fetch 1002A forms and extract PUN
 */
async function processWell(well: WellToCheck, env: Env, results: HarvestResult): Promise<void> {
  const startTime = Date.now();
  console.log(`[Harvester] Processing ${well.api_number} (${well.well_name})`);

  // Step 1: Check OCC for 1002A availability via occ-fetcher
  // Use service binding if available, otherwise fall back to HTTP
  let formsResponse: Response;
  if (env.OCC_FETCHER) {
    formsResponse = await env.OCC_FETCHER.fetch(
      new Request(`https://internal/get-1002a-forms?api=${encodeURIComponent(well.api_number)}`)
    );
  } else {
    formsResponse = await fetch(
      `${env.OCC_FETCHER_URL}/get-1002a-forms?api=${encodeURIComponent(well.api_number)}`
    );
  }

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
    // No 1002A forms found for this well
    await logHarvest(env.DB, well.api_number, {
      has_1002a: 0,
      extraction_method: 'no_form',
      success: 1,
      processing_ms: Date.now() - startTime,
    });
    console.log(`[Harvester] No 1002A forms for ${well.api_number}`);
    return;
  }

  results.formsFound++;
  console.log(`[Harvester] Found ${forms.length} 1002A form(s) for ${well.api_number}`);

  // Step 2: Get the most recent form (by effective date or scan date)
  const form = forms.sort((a, b) => {
    const dateA = new Date(a.effectiveDate || a.scanDate || 0);
    const dateB = new Date(b.effectiveDate || b.scanDate || 0);
    return dateB.getTime() - dateA.getTime();
  })[0];

  // Step 3: Download and extract PUN
  const extractionResult = await extractPunFromForm(form, env);

  if (extractionResult.pun) {
    results.punsExtracted++;

    // Step 4: Insert into well_pun_links
    await env.DB.prepare(`
      INSERT OR IGNORE INTO well_pun_links
      (api_number, pun, match_method, confidence, verified)
      VALUES (?, ?, '1002a_extraction', ?, 1)
    `).bind(well.api_number, extractionResult.pun, extractionResult.confidence).run();

    // Step 5: Update pun_metadata if new PUN
    await env.DB.prepare(`
      INSERT INTO pun_metadata (pun, is_multi_well, well_count, county)
      VALUES (?, 0, 1, ?)
      ON CONFLICT(pun) DO UPDATE SET
        well_count = well_count + 1,
        is_multi_well = CASE WHEN well_count > 0 THEN 1 ELSE 0 END
    `).bind(extractionResult.pun, well.county).run();

    console.log(`[Harvester] Extracted PUN ${extractionResult.pun} for ${well.api_number}`);
  }

  // Log the harvest attempt
  await logHarvest(env.DB, well.api_number, {
    has_1002a: 1,
    entry_id: form.entryId,
    extraction_method: extractionResult.method,
    extracted_pun: extractionResult.pun || undefined,
    confidence: extractionResult.confidence,
    success: extractionResult.pun ? 1 : 0,
    error_message: extractionResult.error,
    processing_ms: Date.now() - startTime,
  });
}

/**
 * Extract PUN from a 1002A form using lightweight OCR + regex
 */
async function extractPunFromForm(
  form: Form1002A,
  env: Env
): Promise<{ pun: string | null; method: string; confidence: string; error?: string }> {

  // The OCC forms metadata often contains location info that may include PUN
  // First try to find it in the metadata
  const locationPun = extractPunFromText(form.location || '');
  if (locationPun) {
    return { pun: locationPun, method: 'metadata_regex', confidence: 'high' };
  }

  // Try the document name
  const namePun = extractPunFromText(form.name || '');
  if (namePun) {
    return { pun: namePun, method: 'name_regex', confidence: 'medium' };
  }

  // For now, we'll need to download and OCR the PDF to get the PUN
  // This is more expensive, so we'll mark these for manual review or Claude fallback
  try {
    // Get session cookies first
    const cookies = await getWellRecordsSessionCookies();

    // Download the PDF
    const pdfResponse = await fetch(form.downloadUrl, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!pdfResponse.ok) {
      return {
        pun: null,
        method: 'failed',
        confidence: 'none',
        error: `PDF download failed: ${pdfResponse.status}`
      };
    }

    // For now, we can't OCR in a worker environment without external service
    // Mark for manual review or future Claude extraction
    return {
      pun: null,
      method: 'needs_ocr',
      confidence: 'none',
      error: 'PDF downloaded but OCR not available in worker'
    };

  } catch (error) {
    return {
      pun: null,
      method: 'failed',
      confidence: 'none',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Extract PUN from text using regex patterns
 */
function extractPunFromText(text: string): string | null {
  if (!text) return null;

  // Try main pattern first
  const mainMatch = text.match(PUN_PATTERN);
  if (mainMatch) {
    return mainMatch[0];
  }

  // Try alternative patterns
  for (const pattern of PUN_ALT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // Reconstruct the PUN in standard format
      const county = match[1].padStart(3, '0');
      const lease = match[2].padStart(5, '0');
      const sub = match[3];
      const merge = match[4].padStart(5, '0');
      return `${county}-${lease}-${sub}-${merge}`;
    }
  }

  return null;
}

/**
 * Get session cookies from OCC Well Records system
 */
async function getWellRecordsSessionCookies(): Promise<string> {
  const cookieJar = new Map<string, string>();

  const extractCookies = (response: Response) => {
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const cookies = setCookieHeader.split(/,(?=\s*\w+=)/);
      for (const cookie of cookies) {
        const match = cookie.match(/^([^=]+)=([^;]*)/);
        if (match) {
          cookieJar.set(match[1].trim(), match[2]);
        }
      }
    }
  };

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  let response = await fetch(
    'https://public.occ.ok.gov/OGCDWellRecords/Welcome.aspx?dbid=0&repo=OCC',
    { method: 'GET', headers: browserHeaders, redirect: 'manual' }
  );
  extractCookies(response);

  let location = response.headers.get('location');
  let maxRedirects = 5;
  while (location && response.status >= 300 && response.status < 400 && maxRedirects > 0) {
    if (!location.startsWith('http')) {
      location = 'https://public.occ.ok.gov' + location;
    }
    response = await fetch(location, {
      method: 'GET',
      headers: { ...browserHeaders, Cookie: Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ') },
      redirect: 'manual',
    });
    extractCookies(response);
    location = response.headers.get('location');
    maxRedirects--;
  }

  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Log a harvest attempt to the database
 */
async function logHarvest(db: D1Database, apiNumber: string, data: HarvestLogEntry): Promise<void> {
  await db.prepare(`
    INSERT INTO puns_harvest_log
    (api_number, has_1002a, entry_id, extraction_method, extracted_pun, confidence, success, error_message, processing_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(api_number) DO UPDATE SET
      checked_at = CURRENT_TIMESTAMP,
      has_1002a = COALESCE(excluded.has_1002a, has_1002a),
      entry_id = COALESCE(excluded.entry_id, entry_id),
      extraction_method = COALESCE(excluded.extraction_method, extraction_method),
      extracted_pun = COALESCE(excluded.extracted_pun, extracted_pun),
      confidence = COALESCE(excluded.confidence, confidence),
      success = excluded.success,
      error_message = excluded.error_message,
      processing_ms = excluded.processing_ms,
      retry_count = retry_count + 1,
      last_retry_at = CURRENT_TIMESTAMP
  `).bind(
    apiNumber,
    data.has_1002a ?? null,
    data.entry_id ?? null,
    data.extraction_method ?? null,
    data.extracted_pun ?? null,
    data.confidence ?? null,
    data.success,
    data.error_message ?? null,
    data.processing_ms ?? null
  ).run();
}

/**
 * Get count of wells checked today
 */
async function getTodaysCount(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    SELECT COUNT(*) as count
    FROM puns_harvest_log
    WHERE date(checked_at) = date('now')
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
  `).bind(results.checked, results.formsFound, results.punsExtracted, results.errors).run();
}

/**
 * Get harvest statistics
 */
async function getHarvestStats(db: D1Database): Promise<object> {
  const totals = await db.prepare(`
    SELECT
      COUNT(*) as total_checked,
      SUM(has_1002a) as total_with_forms,
      SUM(CASE WHEN success = 1 AND extracted_pun IS NOT NULL THEN 1 ELSE 0 END) as total_extracted,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as total_failed
    FROM puns_harvest_log
  `).first();

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

  return {
    totals,
    recentDays: recent.results,
    coverage,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Test extraction for a single well (for debugging)
 */
async function testSingleWell(apiNumber: string, env: Env): Promise<object> {
  const startTime = Date.now();

  try {
    // Use service binding if available, otherwise fall back to HTTP
    let formsResponse: Response;
    if (env.OCC_FETCHER) {
      formsResponse = await env.OCC_FETCHER.fetch(
        new Request(`https://internal/get-1002a-forms?api=${encodeURIComponent(apiNumber)}`)
      );
    } else {
      formsResponse = await fetch(
        `${env.OCC_FETCHER_URL}/get-1002a-forms?api=${encodeURIComponent(apiNumber)}`
      );
    }

    const formsData = await formsResponse.json() as { success: boolean; forms?: Form1002A[]; error?: string };

    if (!formsData.success || !formsData.forms?.length) {
      return {
        apiNumber,
        success: false,
        forms: [],
        message: 'No 1002A forms found',
        processingMs: Date.now() - startTime,
      };
    }

    const form = formsData.forms[0];
    const extraction = await extractPunFromForm(form, env);

    return {
      apiNumber,
      success: !!extraction.pun,
      forms: formsData.forms,
      extraction,
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
