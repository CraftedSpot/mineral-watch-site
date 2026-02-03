/**
 * County Records Handlers
 *
 * Search OKCountyRecords.com for county clerk documents (leases, deeds, etc.)
 * Phase 1: Search (free). Phase 2: Retrieval + extraction (5 credits).
 */

import { jsonResponse, errorResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import type { Env } from '../types/env.js';

const CREDITS_PER_RETRIEVAL = 5;

// Cache TTLs
const COUNTIES_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const TYPES_CACHE_TTL = 7 * 24 * 60 * 60;    // 7 days
const TRS_CACHE_STALE_DAYS = 3;               // D1 cache staleness threshold

/**
 * Make an authenticated request to the OKCountyRecords API.
 * Uses Basic Auth with API key as username, empty password.
 */
async function fetchOKCR(env: Env, path: string): Promise<Response> {
  if (!env.OKCR_API_KEY || !env.OKCR_API_BASE) {
    throw new Error('OKCR API not configured');
  }

  const credentials = btoa(env.OKCR_API_KEY + ':');
  return fetch(`${env.OKCR_API_BASE}${path}`, {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    },
  });
}

/**
 * Check if search is a pure TRS lookup (county + section + township + range, no filters).
 * These qualify for D1 permanent cache — any page number is cacheable.
 */
function isCacheableTrsSearch(body: Record<string, any>): boolean {
  if (!body.section || !body.township || !body.range) return false;
  if (body.type || body.party_name || body.party_type || body.text) return false;
  if (body.indexed_date_start || body.indexed_date_end) return false;
  if (body.instrument_date_start || body.instrument_date_end) return false;
  return true;
}

/**
 * Transform raw OKCR API results into our normalized format (without in_library flags).
 */
function transformOkcrResults(rawResults: any[]): any[] {
  return rawResults.map((item: any) => {
    const grantors = (item.parties || [])
      .filter((p: any) => p.type === 'Grantor')
      .map((p: any) => p.name);
    const grantees = (item.parties || [])
      .filter((p: any) => p.type === 'Grantee')
      .map((p: any) => p.name);

    return {
      county: item.county,
      series: item.series,
      number: item.number,
      instrument_type: item.type,
      instrument_date: item.instrument_date?.split(' ')[0] || null,
      indexed_date: item.indexed_date?.split(' ')[0] || null,
      grantors,
      grantees,
      legal_descriptions: (item.legal_descriptions || []).map((ld: any) => ({
        section: ld.section,
        township: ld.township,
        range: ld.range,
        quarter: ld.quarter || null,
        legal: ld.legal,
        acres: ld.acres || null,
      })),
      page_count: item.total_pages || 0,
      cost_to_view: item.cost_to_view || 0.40,
      free_to_view: item.free_to_view || false,
      images: (item.images || []).map((img: any) => ({
        number: img.number,
        page: img.page,
      })),
    };
  });
}

/**
 * Enrich results with per-user in_library status.
 * Mutates the results array in place for efficiency.
 */
async function enrichWithLibraryStatus(env: Env, userId: string, results: any[]): Promise<void> {
  if (!env.WELLS_DB || results.length === 0) return;

  try {
    const instrumentNumbers = results.map(r => r.number).filter(Boolean);
    if (instrumentNumbers.length === 0) return;

    const placeholders = instrumentNumbers.map(() => '?').join(',');
    const owned = await env.WELLS_DB.prepare(`
      SELECT json_extract(source_metadata, '$.instrument_number') as inst_num,
             id as doc_id, status as doc_status
      FROM documents
      WHERE user_id = ?
        AND json_extract(source_metadata, '$.source') = 'okcr'
        AND json_extract(source_metadata, '$.instrument_number') IN (${placeholders})
    `).bind(userId, ...instrumentNumbers).all();

    const ownedMap = new Map<string, { doc_id: string; doc_status: string }>();
    for (const row of owned.results || []) {
      if (row.inst_num) {
        ownedMap.set(row.inst_num as string, {
          doc_id: row.doc_id as string,
          doc_status: row.doc_status as string,
        });
      }
    }

    for (const r of results) {
      const entry = ownedMap.get(r.number);
      if (entry) {
        r.in_library = true;
        r.retrieve_credits = 0;
        r.document_id = entry.doc_id;
        r.doc_status = entry.doc_status;
      } else {
        r.in_library = false;
        r.retrieve_credits = CREDITS_PER_RETRIEVAL;
      }
    }
  } catch (e) {
    console.error('[CountyRecords] Library check error:', e);
    // Default to not in library
    for (const r of results) {
      r.in_library = false;
      r.retrieve_credits = CREDITS_PER_RETRIEVAL;
    }
  }
}

/**
 * Fetch a specific page from OKCR for a TRS and store in D1 cache.
 * Used for both initial fetch and background refresh.
 */
async function fetchAndCachePage(
  env: Env,
  county: string,
  section: string,
  township: string,
  range: string,
  page: number = 1
): Promise<{ results: any[]; totalResults: number; totalPages: number; page: number } | null> {
  const qs = [
    `county=${encodeURIComponent(county)}`,
    `section=${encodeURIComponent(section)}`,
    `township=${encodeURIComponent(township)}`,
    `range=${encodeURIComponent(range)}`,
    `results_per_page=15`,
    ...(page > 1 ? [`result_page=${page}`] : []),
  ].join('&');

  const response = await fetchOKCR(env, `/search?${qs}`);
  if (!response.ok) {
    console.error(`[CountyRecords] OKCR fetch error (page ${page}):`, response.status);
    return null;
  }

  const totalResults = parseInt(response.headers.get('API-Total-Result-Count') || '0');
  const totalPages = parseInt(response.headers.get('API-Result-Page-Count') || '1');
  const currentPage = parseInt(response.headers.get('API-Result-Page') || String(page));
  const rawResults: any[] = await response.json();
  const results = transformOkcrResults(rawResults);

  // Upsert into D1 cache (page is part of the unique key)
  if (env.WELLS_DB) {
    try {
      await env.WELLS_DB.prepare(`
        INSERT INTO county_records_cache (county, section, township, range, page, searched_at, total_results, total_pages, results)
        VALUES (?, ?, ?, ?, ?, datetime('now', '-6 hours'), ?, ?, ?)
        ON CONFLICT(county, section, township, range, page)
        DO UPDATE SET searched_at = datetime('now', '-6 hours'),
                      total_results = excluded.total_results,
                      total_pages = excluded.total_pages,
                      results = excluded.results
      `).bind(county, section, township, range, currentPage, totalResults, totalPages, JSON.stringify(results)).run();
    } catch (e) {
      console.error('[CountyRecords] Cache store error:', e);
    }
  }

  return { results, totalResults, totalPages, page: currentPage };
}

/**
 * GET /api/county-records/counties
 *
 * Returns list of available OKCR counties. No auth required.
 * Cached in KV for 7 days.
 */
export async function handleCountyRecordsCounties(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.OKCR_API_KEY) {
      return errorResponse('County records service not configured', 503);
    }

    // Check cache
    const cached = await env.OCC_CACHE.get('okcr:counties', 'json');
    if (cached) {
      return jsonResponse({ counties: cached, from_cache: true });
    }

    // Fetch from OKCR
    const response = await fetchOKCR(env, '/counties');
    if (!response.ok) {
      console.error('[CountyRecords] OKCR counties error:', response.status);
      return errorResponse('Failed to fetch counties', 502);
    }

    const rawCounties: any[] = await response.json();

    // Transform to simplified format
    const counties = rawCounties
      .filter((c: any) => c.searching_enabled && c.images_enabled)
      .map((c: any) => ({
        name: c.name,
        instrument_count: c.number_of_instruments,
        image_count: c.number_of_images,
        data_beginning_date: c.data_beginning_date,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    // Cache
    await env.OCC_CACHE.put('okcr:counties', JSON.stringify(counties), { expirationTtl: COUNTIES_CACHE_TTL });

    return jsonResponse({ counties, from_cache: false });
  } catch (error) {
    console.error('[CountyRecords] Counties error:', error);
    return errorResponse('Failed to fetch counties', 500);
  }
}

/**
 * GET /api/county-records/instrument-types?county=Grady
 *
 * Returns instrument types for a specific county. No auth required.
 * Cached per county in KV for 7 days.
 */
export async function handleCountyRecordsInstrumentTypes(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.OKCR_API_KEY) {
      return errorResponse('County records service not configured', 503);
    }

    const url = new URL(request.url);
    const county = url.searchParams.get('county')?.trim();
    if (!county) {
      return errorResponse('county parameter is required', 400);
    }

    // Check cache
    const cacheKey = `okcr:types:${county.toLowerCase()}`;
    const cached = await env.OCC_CACHE.get(cacheKey, 'json');
    if (cached) {
      return jsonResponse({ county, instrument_types: cached, from_cache: true });
    }

    // Fetch from OKCR
    const response = await fetchOKCR(env, `/instrument-types?county=${encodeURIComponent(county)}`);
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404 || text.includes('does not publish')) {
        return errorResponse(`County "${county}" is not available on OKCountyRecords`, 404);
      }
      console.error('[CountyRecords] OKCR types error:', response.status, text);
      return errorResponse('Failed to fetch instrument types', 502);
    }

    const rawTypes: any[] = await response.json();

    // Transform
    const instrumentTypes = rawTypes.map((t: any) => ({
      name: t.name,
      alternate_name: t.alternate_name || null,
      count: t.number_of_instruments,
    }));

    // Cache
    await env.OCC_CACHE.put(cacheKey, JSON.stringify(instrumentTypes), { expirationTtl: TYPES_CACHE_TTL });

    return jsonResponse({ county, instrument_types: instrumentTypes, from_cache: false });
  } catch (error) {
    console.error('[CountyRecords] Instrument types error:', error);
    return errorResponse('Failed to fetch instrument types', 500);
  }
}

/**
 * POST /api/county-records/search
 *
 * Search OKCR for county clerk documents. Auth required.
 *
 * For TRS-only page-1 searches: uses D1 permanent cache with stale-while-revalidate.
 * For filtered/paginated searches: goes directly to OKCR.
 *
 * Request body:
 * {
 *   county: string (required),
 *   section?: string,
 *   township?: string,
 *   range?: string,
 *   type?: string,
 *   party_name?: string,
 *   party_type?: string,  // "Grantor" | "Grantee"
 *   indexed_date_start?: string,  // YYYY-MM-DD
 *   indexed_date_end?: string,
 *   instrument_date_start?: string,
 *   instrument_date_end?: string,
 *   text?: string,  // Full-text search
 *   page?: number
 * }
 */
export async function handleCountyRecordsSearch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    // Auth required
    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!env.OKCR_API_KEY) {
      return errorResponse('County records service not configured', 503);
    }

    const body = await request.json() as Record<string, any>;
    const county = body.county?.trim();
    if (!county) {
      return errorResponse('county is required', 400);
    }

    // ── D1 cache path: pure TRS searches (any page) ──
    const requestedPage = body.page || 1;

    if (isCacheableTrsSearch(body) && env.WELLS_DB) {
      const section = body.section.trim();
      const township = body.township.trim();
      const range = body.range.trim();

      // Check D1 cache for the requested page
      const cacheRow = await env.WELLS_DB.prepare(`
        SELECT results, total_results, total_pages, searched_at
        FROM county_records_cache
        WHERE county = ? AND section = ? AND township = ? AND range = ? AND page = ?
      `).bind(county, section, township, range, requestedPage).first();

      if (cacheRow) {
        // Parse cached results and enrich with per-user in_library status
        const results = JSON.parse(cacheRow.results as string);
        await enrichWithLibraryStatus(env, authResult.id, results);

        // Check staleness
        const searchedAt = new Date(cacheRow.searched_at as string);
        const ageMs = Date.now() - searchedAt.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const isStale = ageDays > TRS_CACHE_STALE_DAYS;

        if (isStale && ctx) {
          console.log(`[CountyRecords] Stale cache (${ageDays.toFixed(0)}d) for ${county} ${section}-${township}-${range} p${requestedPage}, refreshing`);
          ctx.waitUntil((async () => {
            try {
              // Always refresh page 1 first
              const cachedTotal = cacheRow.total_results as number;
              const fresh = await fetchAndCachePage(env, county, section, township, range, 1);
              // If total changed, pagination shifted — invalidate stale sibling pages
              if (fresh && fresh.totalResults !== cachedTotal) {
                await env.WELLS_DB!.prepare(
                  `DELETE FROM county_records_cache
                   WHERE county = ? AND section = ? AND township = ? AND range = ? AND page > 1`
                ).bind(county, section, township, range).run();
                console.log(`[CountyRecords] Invalidated sibling pages for ${county} ${section}-${township}-${range} (total changed ${cachedTotal} → ${fresh.totalResults})`);
              }
              // Also refresh the requested page if it wasn't page 1
              if (requestedPage > 1) {
                await fetchAndCachePage(env, county, section, township, range, requestedPage);
              }
            } catch (e) {
              console.error('[CountyRecords] Background refresh error:', e);
            }
          })());
        }

        return jsonResponse({
          results,
          total_results: cacheRow.total_results as number,
          page: requestedPage,
          total_pages: cacheRow.total_pages as number,
          from_cache: true,
        });
      }

      // Cache miss — fetch from OKCR, store in D1
      console.log(`[CountyRecords] Cache miss for ${county} ${section}-${township}-${range} p${requestedPage}, fetching from OKCR`);
      const freshData = await fetchAndCachePage(env, county, section, township, range, requestedPage);
      if (!freshData) {
        return errorResponse('Search failed', 502);
      }

      // Enrich with per-user in_library status
      await enrichWithLibraryStatus(env, authResult.id, freshData.results);

      return jsonResponse({
        results: freshData.results,
        total_results: freshData.totalResults,
        page: freshData.page,
        total_pages: freshData.totalPages,
        from_cache: false,
      });
    }

    // ── Direct OKCR path: filtered or paginated searches ──
    const queryParams: Record<string, string> = {
      county,
      results_per_page: '15',
    };

    if (body.section) queryParams.section = body.section;
    if (body.township) queryParams.township = body.township;
    if (body.range) queryParams.range = body.range;
    if (body.type) queryParams.type = body.type;
    if (body.party_name) queryParams.party_name = body.party_name;
    if (body.party_type) queryParams.party_type = body.party_type;
    if (body.indexed_date_start) queryParams.indexed_date_start = body.indexed_date_start;
    if (body.indexed_date_end) queryParams.indexed_date_end = body.indexed_date_end;
    if (body.instrument_date_start) queryParams.instrument_date_start = body.instrument_date_start;
    if (body.instrument_date_end) queryParams.instrument_date_end = body.instrument_date_end;
    if (body.text) queryParams.text = body.text;
    if (body.page && body.page > 1) queryParams.result_page = String(body.page);

    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const response = await fetchOKCR(env, `/search?${qs}`);

    if (!response.ok) {
      const text = await response.text();
      try {
        const err = JSON.parse(text);
        if (err.error) {
          return errorResponse(err.error, response.status === 404 ? 404 : 400);
        }
      } catch {}
      console.error('[CountyRecords] OKCR search error:', response.status, text.substring(0, 200));
      return errorResponse('Search failed', 502);
    }

    const totalResults = parseInt(response.headers.get('API-Total-Result-Count') || '0');
    const totalPages = parseInt(response.headers.get('API-Result-Page-Count') || '1');
    const currentPage = parseInt(response.headers.get('API-Result-Page') || '1');
    const rawResults: any[] = await response.json();

    const results = transformOkcrResults(rawResults);
    await enrichWithLibraryStatus(env, authResult.id, results);

    return jsonResponse({
      results,
      total_results: totalResults,
      page: currentPage,
      total_pages: totalPages,
      from_cache: false,
    });
  } catch (error) {
    console.error('[CountyRecords] Search error:', error);
    return errorResponse('Search failed', 500);
  }
}

/**
 * POST /api/county-records/retrieve
 *
 * Retrieve and extract a county record. Auth required. Costs 5 credits.
 *
 * Flow:
 * 1. Check if user already has this document → return it (0 credits)
 * 2. Check user has sufficient credits
 * 3. Check global cache (county_record_extractions table)
 *    - Cached + complete → create copy for user via documents-worker (tiered credits)
 *    - Processing → return { status: 'processing' }
 *    - Failed → allow retry
 *    - Not found → full extraction
 * 4. Call documents-worker to fetch from OKCR, extract, store, charge credits
 * 5. Update cache index
 * 6. Return document data
 *
 * Request body:
 * {
 *   county: string,
 *   instrument_number: string,
 *   images: { number: number, page: string }[],
 *   instrument_type?: string,
 *   format?: 'extract' | 'official'
 * }
 */
export async function handleCountyRecordsRetrieve(request: Request, env: Env): Promise<Response> {
  try {
    // Auth required
    const session = await authenticateRequest(request, env);
    if (!session) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!env.WELLS_DB || !env.DOCUMENTS_WORKER) {
      return errorResponse('Service not available', 503);
    }

    const body = await request.json() as Record<string, any>;
    const county = body.county?.trim();
    const instrumentNumber = body.instrument_number?.trim();
    const images = body.images as { number: number; page: string }[];
    const instrumentType = body.instrument_type || null;
    const format = body.format || 'extract';

    if (!county || !instrumentNumber) {
      return errorResponse('county and instrument_number are required', 400);
    }
    if (!images || !Array.isArray(images) || images.length === 0) {
      return errorResponse('images array is required', 400);
    }
    if (images.length > 50) {
      return errorResponse('Documents over 50 pages are not currently supported', 400);
    }

    const userId = session.id;
    const userPlan = session.airtableUser?.fields?.Plan || 'free';
    const organizationId = session.airtableUser?.fields?.Organization?.[0] || null;

    console.log(`[CountyRecords] Retrieve ${county}:${instrumentNumber} — ${images.length} pages, ${CREDITS_PER_RETRIEVAL} credits`);

    // Step 1: Check if user already has this document in their library
    const existingDoc = await env.WELLS_DB.prepare(`
      SELECT id, status, extracted_data, doc_type, display_name, page_count
      FROM documents
      WHERE user_id = ?
        AND json_extract(source_metadata, '$.source') = 'okcr'
        AND json_extract(source_metadata, '$.instrument_number') = ?
    `).bind(userId, instrumentNumber).first();

    if (existingDoc) {
      console.log(`[CountyRecords] User ${userId} already has document ${existingDoc.id}`);
      return jsonResponse({
        success: true,
        document_id: existingDoc.id,
        status: existingDoc.status,
        doc_type: existingDoc.doc_type,
        display_name: existingDoc.display_name,
        page_count: existingDoc.page_count,
        credits_charged: 0,
        message: 'Document already in your library'
      });
    }

    // Step 2: Check credits
    // We'll let the documents-worker do the actual deduction, but we do a
    // pre-check here so we can fail fast before hitting OKCR.
    // Use the usage tracking service via documents-worker for consistency.

    // Step 3: Check global cache
    const cacheRow = await env.WELLS_DB.prepare(`
      SELECT id, county, instrument_number, instrument_type, format, document_id,
             r2_path, page_count, status, error_message, created_at
      FROM county_record_extractions
      WHERE county = ? AND instrument_number = ?
    `).bind(county, instrumentNumber).first();

    if (cacheRow) {
      const cacheStatus = cacheRow.status as string;

      // If currently processing, tell the client to poll
      if (cacheStatus === 'processing') {
        const createdAt = new Date(cacheRow.created_at as string).getTime();
        const ageMinutes = (Date.now() - createdAt) / 60000;

        // If stuck processing for > 10 minutes, allow retry
        if (ageMinutes < 10) {
          return jsonResponse({
            status: 'processing',
            message: 'This document is currently being processed. Please try again shortly.'
          });
        }
        // Fall through to retry
        console.log(`[CountyRecords] Cache row stuck processing for ${ageMinutes.toFixed(0)}m, retrying`);
      }

      // If complete + has a document_id, create a copy for this user
      if (cacheStatus === 'complete' && cacheRow.document_id) {
        console.log(`[CountyRecords] Cache hit for ${county}:${instrumentNumber}, creating copy for user ${userId}`);

        const docResponse = await env.DOCUMENTS_WORKER.fetch(
          new Request('https://documents-worker/api/processing/extract-county-record', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.PROCESSING_API_KEY || ''
            },
            body: JSON.stringify({
              action: 'create_from_cache',
              userId,
              userPlan,
              organizationId,
              cacheRow: {
                document_id: cacheRow.document_id,
                county,
                instrument_number: instrumentNumber,
                instrument_type: cacheRow.instrument_type,
                r2_path: cacheRow.r2_path,
                page_count: cacheRow.page_count
              },
              credits_required: CREDITS_PER_RETRIEVAL
            })
          })
        );

        const docResult = await docResponse.json() as any;

        if (!docResult.success) {
          return jsonResponse({
            error: docResult.error || 'Failed to create document from cache',
            credits_required: CREDITS_PER_RETRIEVAL
          }, docResult.status || 500);
        }

        return jsonResponse({
          success: true,
          document_id: docResult.document_id,
          status: 'complete',
          doc_type: docResult.doc_type,
          display_name: docResult.display_name || null,
          page_count: docResult.page_count,
          credits_charged: docResult.credits_charged || CREDITS_PER_RETRIEVAL,
          cached: true
        });
      }

      // Failed — allow retry by updating status
      if (cacheStatus === 'failed') {
        console.log(`[CountyRecords] Cache failed for ${county}:${instrumentNumber}, retrying`);
        await env.WELLS_DB.prepare(`
          UPDATE county_record_extractions
          SET status = 'processing', error_message = NULL,
              updated_at = datetime('now', '-6 hours')
          WHERE id = ?
        `).bind(cacheRow.id).run();
      }
    }

    // Step 4: No cache or retrying — insert/update cache row as 'processing'
    if (!cacheRow) {
      await env.WELLS_DB.prepare(`
        INSERT INTO county_record_extractions (county, instrument_number, instrument_type, format, status)
        VALUES (?, ?, ?, ?, 'processing')
      `).bind(county, instrumentNumber, instrumentType, format).run();
    }

    // Step 5: Call documents-worker for full extraction
    console.log(`[CountyRecords] Full extraction for ${county}:${instrumentNumber} (${images.length} pages)`);

    const extractResponse = await env.DOCUMENTS_WORKER.fetch(
      new Request('https://documents-worker/api/processing/extract-county-record', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.PROCESSING_API_KEY || ''
        },
        body: JSON.stringify({
          county,
          instrument_number: instrumentNumber,
          images,
          format,
          instrument_type: instrumentType,
          userId,
          userPlan,
          organizationId,
          credits_required: CREDITS_PER_RETRIEVAL
        })
      })
    );

    const extractResult = await extractResponse.json() as any;

    if (!extractResult.success) {
      // Update cache as failed
      await env.WELLS_DB.prepare(`
        UPDATE county_record_extractions
        SET status = 'failed', error_message = ?,
            updated_at = datetime('now', '-6 hours')
        WHERE county = ? AND instrument_number = ?
      `).bind(
        extractResult.error || 'Unknown error',
        county,
        instrumentNumber
      ).run();

      return jsonResponse({
        error: extractResult.error || 'Extraction failed',
        credits_required: CREDITS_PER_RETRIEVAL
      }, extractResult.status || 500);
    }

    // Step 6: Update cache index with successful extraction
    await env.WELLS_DB.prepare(`
      UPDATE county_record_extractions
      SET status = 'complete', document_id = ?, r2_path = ?,
          page_count = ?, instrument_type = ?,
          updated_at = datetime('now', '-6 hours')
      WHERE county = ? AND instrument_number = ?
    `).bind(
      extractResult.document_id,
      extractResult.r2_path || null,
      extractResult.page_count || images.length,
      instrumentType,
      county,
      instrumentNumber
    ).run();

    // Step 7: Return document data
    return jsonResponse({
      success: true,
      document_id: extractResult.document_id,
      status: 'complete',
      doc_type: extractResult.doc_type,
      key_takeaway: extractResult.key_takeaway,
      display_name: extractResult.display_name || null,
      page_count: extractResult.page_count,
      credits_charged: extractResult.credits_charged || CREDITS_PER_RETRIEVAL,
      extraction_model: extractResult.extraction_model,
      cached: false
    });

  } catch (error) {
    console.error('[CountyRecords] Retrieve error:', error);
    return errorResponse('Failed to retrieve county record: ' + (error as Error).message, 500);
  }
}
