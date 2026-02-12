/**
 * OCC Fetcher Worker
 *
 * Fetches OCC pooling orders by case number, downloads the PDF,
 * and submits to documents-worker for processing.
 *
 * Uses OCC's Laserfiche WebLink JSON API (not the ASP.NET form).
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS handling
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
        }
      });
    }

    const url = new URL(request.url);

    // GET endpoints
    if (request.method === 'GET') {
      if (url.pathname === '/get-1002a-forms') {
        return handleGet1002AForms(request, env);
      }
      if (url.pathname === '/get-1000-forms') {
        return handleGet1000Forms(request, env);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }

    // POST endpoints
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/fetch-order') {
      return handleFetchOrder(request, env);
    }

    // Alternative: Direct PDF URL upload (bypasses OCC search)
    if (url.pathname === '/fetch-pdf') {
      return handleFetchPdf(request, env);
    }

    // Debug endpoint: Search case without document type filter
    if (url.pathname === '/search-case') {
      return handleSearchCase(request, env);
    }

    // Test endpoint: Probe well records API
    if (url.pathname === '/test-well-records') {
      return handleTestWellRecords(request);
    }

    // 1002A Completion Report endpoints
    if (url.pathname === '/download-1002a-forms') {
      return handleDownload1002AForms(request, env);
    }

    // Form 1000 Drilling Permit endpoints
    if (url.pathname === '/download-1000-forms') {
      return handleDownload1000Forms(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
};

interface Env {
  PROCESSING_API_KEY: string;
  DOCUMENTS_WORKER_URL: string;
  UPLOADS_BUCKET: R2Bucket;
  DOCUMENTS_WORKER: Fetcher;
  OCC_CACHE?: KVNamespace;
}

interface FetchOrderRequest {
  caseNumber: string;
  userId: string;
  userPlan?: string;
  wellApiNumber?: string;
  organizationId?: string;
}

interface OCCSearchResult {
  entryId: number;
  name: string;
  metadata: Array<{ name: string; values: string[]; isMvfg: boolean }>;
}

interface OCCOrder {
  entryId: string;
  orderNumber: string;
  caseNumber: string;
  applicant?: string;
  county?: string;
  reliefType?: string;
  section?: string;
  township?: string;
  range?: string;
  orderStatus?: string;
  signingDate?: string;
  orderTitle?: string;
  pdfUrl: string;
}

// ============================================================================
// 1002A Completion Report Types and Helpers
// ============================================================================

const WELL_RECORDS_COOKIE_KEY = 'occ-well-records-session';
const COOKIE_TTL_SECONDS = 600; // 10 minutes

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

/**
 * Get session cookies from OCC Well Records system with KV caching.
 * Sessions last 15-30 minutes, so we cache for 10 minutes to reduce latency.
 */
async function getWellRecordsSessionCookies(env?: Env): Promise<string> {
  // Try to get cached cookies from KV
  if (env?.OCC_CACHE) {
    const cached = await env.OCC_CACHE.get(WELL_RECORDS_COOKIE_KEY);
    if (cached) {
      console.log('[1002A] Using cached session cookies');
      return cached;
    }
  }

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

  const cookies = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

  // Cache the cookies in KV
  if (env?.OCC_CACHE && cookies) {
    await env.OCC_CACHE.put(WELL_RECORDS_COOKIE_KEY, cookies, { expirationTtl: COOKIE_TTL_SECONDS });
    console.log('[1002A] Cached session cookies for 10 minutes');
  }

  return cookies;
}

/**
 * Search OCC Well Records for documents by API number.
 * Supports pagination and optional form number filtering.
 */
async function searchWellRecords(
  apiNumber: string,
  cookies: string,
  formNumberFilter?: string
): Promise<Form1002A[]> {
  const PAGE_SIZE = 100;
  let startIdx = 0;
  const allForms: Form1002A[] = [];

  while (true) {
    const searchPayload = {
      repoName: 'OCC',
      searchSyn: `{[OG Well Records]:[API Number]="${apiNumber}*"}`,
      searchUuid: '',
      sortColumn: '',
      startIdx,
      endIdx: startIdx + PAGE_SIZE,
      getNewListing: startIdx === 0,
      sortOrder: 2,
      displayInGridView: false,
    };

    const searchResponse = await fetch(
      'https://public.occ.ok.gov/OGCDWellRecords/SearchService.aspx/GetSearchListing',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Origin: 'https://public.occ.ok.gov',
          Referer: 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx',
        },
        body: JSON.stringify(searchPayload),
      }
    );

    if (!searchResponse.ok) {
      throw new Error(`Search failed: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json() as any;
    const results = searchData?.data?.results || [];

    for (const result of results) {
      const metadata: Record<string, string> = {};
      for (const item of result.metadata || []) {
        if (item.name && item.values && item.values.length > 0) {
          metadata[item.name] = item.values[0];
        }
      }

      const formNumber = metadata['Form Number'] || '';

      if (formNumberFilter && formNumber !== formNumberFilter) {
        continue;
      }

      allForms.push({
        entryId: result.entryId,
        name: result.name,
        formNumber,
        apiNumber: metadata['API Number'] || '',
        wellName: metadata['Well Name'] || '',
        county: metadata['County'] || '',
        location: metadata['Location'] || '',
        effectiveDate: metadata['Effective Date'] || '',
        scanDate: metadata['Scan Date'] || '',
        docId: metadata['DocID'] || '',
        downloadUrl: `https://public.occ.ok.gov/OGCDWellRecords/ElectronicFile.aspx?docid=${result.entryId}&dbid=0&repo=OCC`,
      });
    }

    // If we got fewer results than page size, we've reached the end
    if (results.length < PAGE_SIZE) {
      break;
    }

    startIdx += PAGE_SIZE;

    // Safety limit: don't fetch more than 500 records
    if (startIdx >= 500) {
      console.log('[1002A] Hit pagination safety limit');
      break;
    }
  }

  return allForms;
}

/**
 * GET /get-1002a-forms - List all 1002A forms for an API number
 */
async function handleGet1002AForms(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const apiNumber = url.searchParams.get('api');

  if (!apiNumber) {
    return jsonResponse({ error: 'api parameter required' }, 400);
  }

  try {
    const cookies = await getWellRecordsSessionCookies(env);
    const forms = await searchWellRecords(apiNumber, cookies, '1002A');

    return jsonResponse({
      success: true,
      apiNumber,
      count: forms.length,
      forms,
    });
  } catch (error) {
    console.error('[1002A] Search error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

/**
 * POST /download-1002a-forms - Download all 1002A forms, store in R2, register with documents-worker
 */
async function handleDownload1002AForms(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { apiNumber, userId, userPlan, organizationId, wellApiNumber, entryIds } = body;

  if (!apiNumber || !userId) {
    return jsonResponse({ error: 'apiNumber and userId required' }, 400);
  }

  try {
    const cookies = await getWellRecordsSessionCookies(env);
    let forms = await searchWellRecords(apiNumber, cookies, '1002A');

    if (forms.length === 0) {
      return jsonResponse({
        success: false,
        error: 'No 1002A forms found',
        apiNumber,
      });
    }

    console.log(`[1002A] Found ${forms.length} forms for API ${apiNumber}`);

    // Filter to only requested entryIds if provided
    if (entryIds && Array.isArray(entryIds) && entryIds.length > 0) {
      const requestedIds = new Set(entryIds.map(id => Number(id)));
      forms = forms.filter(f => requestedIds.has(f.entryId));
      console.log(`[1002A] Filtered to ${forms.length} requested forms (entryIds: ${entryIds.join(', ')})`);

      if (forms.length === 0) {
        return jsonResponse({
          success: false,
          error: 'Requested forms not found',
          apiNumber,
          requestedEntryIds: entryIds,
        });
      }
    }

    const results: any[] = [];

    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];

      // Rate limiting: 200ms delay between downloads (skip first)
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }

      try {
        console.log(`[1002A] Downloading form ${i + 1}/${forms.length}: ${form.name} (entryId: ${form.entryId})`);

        // Download PDF using ElectronicFile.aspx (OGCDWellRecords system)
        // Note: This is different from OCC orders which use GeneratePDF10.aspx (WebLink system)
        let pdfResponse = await fetch(form.downloadUrl, {
          headers: {
            Cookie: cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        // Retry once on 5xx errors
        if (!pdfResponse.ok && pdfResponse.status >= 500) {
          console.log(`[1002A] Retrying download for ${form.name} after ${pdfResponse.status} error`);
          await new Promise(r => setTimeout(r, 1000));
          pdfResponse = await fetch(form.downloadUrl, {
            headers: {
              Cookie: cookies,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
        }

        if (!pdfResponse.ok) {
          console.error(`[1002A] Failed to download PDF for ${form.name}: HTTP ${pdfResponse.status}`);
          results.push({ success: false, form, error: `HTTP ${pdfResponse.status}` });
          continue;
        }

        const pdfBuffer = await pdfResponse.arrayBuffer();

        // Validate that the response is actually a PDF (check magic bytes)
        const pdfBytes = new Uint8Array(pdfBuffer.slice(0, 5));
        const pdfMagic = String.fromCharCode(...pdfBytes);
        if (!pdfMagic.startsWith('%PDF-')) {
          console.error(`[1002A] Downloaded file is not a PDF for ${form.name}. First bytes: ${pdfMagic}`);
          results.push({ success: false, form, error: 'Downloaded file is not a valid PDF (OCC may have returned an error page)' });
          continue;
        }

        console.log(`[1002A] Successfully downloaded ${pdfBuffer.byteLength} bytes for ${form.name}`);

        const filename = `1002A-${form.apiNumber}-${form.wellName.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
        const r2Key = `uploads/${userId}/${Date.now()}-${filename}`;

        console.log(`[1002A] Uploading ${pdfBuffer.byteLength} bytes to R2 as ${r2Key}`);

        // Store in R2
        if (env.UPLOADS_BUCKET) {
          await env.UPLOADS_BUCKET.put(r2Key, pdfBuffer, {
            httpMetadata: {
              contentType: 'application/pdf',
              contentDisposition: `attachment; filename="${filename}"`,
            },
            customMetadata: {
              source: 'occ-1002a-fetcher',
              apiNumber: form.apiNumber,
              formNumber: '1002A',
              wellName: form.wellName,
              county: form.county,
              effectiveDate: form.effectiveDate,
              entryId: String(form.entryId),
            },
          });
        }

        // Register with documents-worker
        let documentId: string | undefined;
        if (env.DOCUMENTS_WORKER) {
          try {
            const registerResponse = await env.DOCUMENTS_WORKER.fetch(
              new Request('https://internal/api/documents/register-external', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': env.PROCESSING_API_KEY,
                },
                body: JSON.stringify({
                  r2Key,
                  userId,
                  userPlan,
                  organizationId,
                  filename,
                  fileSize: pdfBuffer.byteLength,
                  contentType: 'application/pdf',
                  sourceType: 'occ_1002a',
                  sourceApi: wellApiNumber || form.apiNumber,
                  originalUrl: form.downloadUrl,
                  metadata: {
                    formNumber: '1002A',
                    apiNumber: form.apiNumber,
                    wellName: form.wellName,
                    county: form.county,
                    location: form.location,
                    effectiveDate: form.effectiveDate,
                    entryId: form.entryId,
                  },
                }),
              })
            );
            if (registerResponse.ok) {
              const result = await registerResponse.json() as any;
              documentId = result.document?.id;
              console.log(`[1002A] Registered document: ${documentId}`);
            } else {
              console.error(`[1002A] Registration failed: ${registerResponse.status}`);
            }
          } catch (e) {
            console.error('[1002A] Document registration failed:', e);
          }
        }

        results.push({ success: true, form, r2Key, documentId });
      } catch (error) {
        console.error(`[1002A] Error processing form ${form.name}:`, error);
        results.push({
          success: false,
          form,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return jsonResponse({
      success: results.some(r => r.success),
      apiNumber,
      summary: {
        total: forms.length,
        downloaded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      },
      results,
    });
  } catch (error) {
    console.error('[1002A] Error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

/**
 * GET /get-1000-forms - List all Form 1000 drilling permits for an API number
 */
async function handleGet1000Forms(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const apiNumber = url.searchParams.get('api');

  if (!apiNumber) {
    return jsonResponse({ error: 'api parameter required' }, 400);
  }

  try {
    const cookies = await getWellRecordsSessionCookies(env);
    const forms = await searchWellRecords(apiNumber, cookies, '1000');

    return jsonResponse({
      success: true,
      apiNumber,
      count: forms.length,
      forms,
    });
  } catch (error) {
    console.error('[1000] Search error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

/**
 * POST /download-1000-forms - Download Form 1000 drilling permits, store in R2, register with documents-worker
 */
async function handleDownload1000Forms(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { apiNumber, userId, userPlan, organizationId, wellApiNumber, entryIds } = body;

  if (!apiNumber || !userId) {
    return jsonResponse({ error: 'apiNumber and userId required' }, 400);
  }

  try {
    const cookies = await getWellRecordsSessionCookies(env);
    let forms = await searchWellRecords(apiNumber, cookies, '1000');

    if (forms.length === 0) {
      return jsonResponse({
        success: false,
        error: 'No Form 1000 drilling permits found',
        apiNumber,
      });
    }

    console.log(`[1000] Found ${forms.length} forms for API ${apiNumber}`);

    // Filter to only requested entryIds if provided
    if (entryIds && Array.isArray(entryIds) && entryIds.length > 0) {
      const requestedIds = new Set(entryIds.map(id => Number(id)));
      forms = forms.filter(f => requestedIds.has(f.entryId));
      console.log(`[1000] Filtered to ${forms.length} requested forms (entryIds: ${entryIds.join(', ')})`);

      if (forms.length === 0) {
        return jsonResponse({
          success: false,
          error: 'Requested forms not found',
          apiNumber,
          requestedEntryIds: entryIds,
        });
      }
    }

    const results: any[] = [];

    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];

      // Rate limiting: 200ms delay between downloads (skip first)
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }

      try {
        console.log(`[1000] Downloading form ${i + 1}/${forms.length}: ${form.name} (entryId: ${form.entryId})`);

        let pdfResponse = await fetch(form.downloadUrl, {
          headers: {
            Cookie: cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        // Retry once on 5xx errors
        if (!pdfResponse.ok && pdfResponse.status >= 500) {
          console.log(`[1000] Retrying download for ${form.name} after ${pdfResponse.status} error`);
          await new Promise(r => setTimeout(r, 1000));
          pdfResponse = await fetch(form.downloadUrl, {
            headers: {
              Cookie: cookies,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
        }

        if (!pdfResponse.ok) {
          console.error(`[1000] Failed to download PDF for ${form.name}: HTTP ${pdfResponse.status}`);
          results.push({ success: false, form, error: `HTTP ${pdfResponse.status}` });
          continue;
        }

        const pdfBuffer = await pdfResponse.arrayBuffer();

        // Validate PDF magic bytes
        const pdfBytes = new Uint8Array(pdfBuffer.slice(0, 5));
        const pdfMagic = String.fromCharCode(...pdfBytes);
        if (!pdfMagic.startsWith('%PDF-')) {
          console.error(`[1000] Downloaded file is not a PDF for ${form.name}. First bytes: ${pdfMagic}`);
          results.push({ success: false, form, error: 'Downloaded file is not a valid PDF' });
          continue;
        }

        console.log(`[1000] Successfully downloaded ${pdfBuffer.byteLength} bytes for ${form.name}`);

        const filename = `1000-${form.apiNumber}-${form.wellName.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
        const r2Key = `uploads/${userId}/${Date.now()}-${filename}`;

        // Store in R2
        if (env.UPLOADS_BUCKET) {
          await env.UPLOADS_BUCKET.put(r2Key, pdfBuffer, {
            httpMetadata: {
              contentType: 'application/pdf',
              contentDisposition: `attachment; filename="${filename}"`,
            },
            customMetadata: {
              source: 'occ-1000-fetcher',
              apiNumber: form.apiNumber,
              formNumber: '1000',
              wellName: form.wellName,
              county: form.county,
              effectiveDate: form.effectiveDate,
              entryId: String(form.entryId),
            },
          });
        }

        // Register with documents-worker
        let documentId: string | undefined;
        if (env.DOCUMENTS_WORKER) {
          try {
            const registerResponse = await env.DOCUMENTS_WORKER.fetch(
              new Request('https://internal/api/documents/register-external', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': env.PROCESSING_API_KEY,
                },
                body: JSON.stringify({
                  r2Key,
                  userId,
                  userPlan,
                  organizationId,
                  filename,
                  fileSize: pdfBuffer.byteLength,
                  contentType: 'application/pdf',
                  sourceType: 'occ_1000',
                  sourceApi: wellApiNumber || form.apiNumber,
                  originalUrl: form.downloadUrl,
                  metadata: {
                    formNumber: '1000',
                    apiNumber: form.apiNumber,
                    wellName: form.wellName,
                    county: form.county,
                    location: form.location,
                    effectiveDate: form.effectiveDate,
                    entryId: form.entryId,
                  },
                }),
              })
            );
            if (registerResponse.ok) {
              const result = await registerResponse.json() as any;
              documentId = result.document?.id;
              console.log(`[1000] Registered document: ${documentId}`);
            } else {
              console.error(`[1000] Registration failed: ${registerResponse.status}`);
            }
          } catch (e) {
            console.error('[1000] Document registration failed:', e);
          }
        }

        results.push({ success: true, form, r2Key, documentId });
      } catch (error) {
        console.error(`[1000] Error processing form ${form.name}:`, error);
        results.push({
          success: false,
          form,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return jsonResponse({
      success: results.some(r => r.success),
      apiNumber,
      summary: {
        total: forms.length,
        downloaded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      },
      results,
    });
  } catch (error) {
    console.error('[1000] Error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

async function handleFetchOrder(request: Request, env: Env): Promise<Response> {
  let body: FetchOrderRequest;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { caseNumber, userId, userPlan, wellApiNumber, organizationId } = body;

  if (!caseNumber || !userId) {
    return jsonResponse({ error: 'caseNumber and userId are required' }, 400);
  }

  try {
    // Clean case number - remove CD prefix if present
    const cleanCaseNumber = caseNumber.replace(/^CD/i, '');

    console.log(`[OCC Fetcher] Searching for case ${caseNumber} (clean: ${cleanCaseNumber})`);

    // Step 1: Get session cookies from OCC
    const cookies = await getOCCSessionCookies();
    console.log(`[OCC Fetcher] Session cookies obtained: ${cookies.substring(0, 60)}...`);

    // Step 2: Build search syntax
    // Search for Final Order OR Interim Order (horizontal wells use Interim Order)
    // Format: ({[]:[ECF Case Number]="2022-003039"} & ({[]:[ECF Document Type]="Final Order"} | {[]:[ECF Document Type]="Interim Order"}) & ({LF:LOOKIN="\\AJLS\\Judicial & Legislative\\ECF"}) & {LF:templateid=52})
    const searchSyntax = `({[]:[ECF Case Number]="${cleanCaseNumber}"} & ({[]:[ECF Document Type]="Final Order"} | {[]:[ECF Document Type]="Interim Order"}) & ({LF:LOOKIN="\\\\AJLS\\\\Judicial & Legislative\\\\ECF"}) & {LF:templateid=52})`;

    console.log(`[OCC Fetcher] Search syntax: ${searchSyntax}`);

    // Step 3: Call GetSearchListing API
    const searchPayload = {
      repoName: 'OCC',
      searchSyn: searchSyntax,
      searchUuid: '',
      sortColumn: '',
      startIdx: 0,
      endIdx: 10,
      getNewListing: true,
      sortOrder: 2,
      displayInGridView: false
    };

    const searchResponse = await fetch('https://public.occ.ok.gov/WebLink/SearchService.aspx/GetSearchListing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://public.occ.ok.gov',
        'Referer': 'https://public.occ.ok.gov/WebLink/CustomSearch.aspx?SearchName=ImagedCaseDocumentsfiledafter3212022&dbid=0&repo=OCC'
      },
      body: JSON.stringify(searchPayload)
    });

    const responseText = await searchResponse.text();
    console.log(`[OCC Fetcher] Search response length: ${responseText.length}`);
    console.log(`[OCC Fetcher] Response preview: ${responseText.substring(0, 500)}`);

    if (!searchResponse.ok) {
      return jsonResponse({
        success: false,
        error: `OCC API error: ${searchResponse.status}`,
        details: responseText.substring(0, 500)
      }, 500);
    }

    // Parse the JSON response
    let searchData: any;
    try {
      searchData = JSON.parse(responseText);
    } catch (e) {
      return jsonResponse({
        success: false,
        error: 'Failed to parse OCC API response',
        details: responseText.substring(0, 500)
      }, 500);
    }

    // Log the structure to understand it
    console.log(`[OCC Fetcher] Response keys: ${Object.keys(searchData).join(', ')}`);
    if (searchData.data) {
      console.log(`[OCC Fetcher] data keys: ${Object.keys(searchData.data).join(', ')}`);
    }
    if (searchData.d) {
      console.log(`[OCC Fetcher] d keys: ${Object.keys(searchData.d).join(', ')}`);
    }

    // Response structure varies - try multiple paths
    // OCC uses: { data: { results: [...], totalResults: N } } or { d: { results: [...] } }
    const data = searchData?.data || searchData?.d || searchData;
    const results: OCCSearchResult[] = data?.results || data?.entries || [];
    const totalResults = data?.totalResults ?? data?.TotalResults ?? results.length;

    console.log(`[OCC Fetcher] Found ${results.length} orders (total: ${totalResults})`);
    if (results.length > 0) {
      console.log(`[OCC Fetcher] First result keys: ${Object.keys(results[0]).join(', ')}`);
    }

    if (results.length === 0) {
      return jsonResponse({
        success: false,
        error: 'No Final Order found for this case',
        caseNumber,
        suggestion: 'The order may not be filed yet, or check the case number'
      }, 404);
    }

    // Step 4: Parse results into OCCOrder objects
    const orders = results.map(parseSearchResult);

    console.log(`[OCC Fetcher] Parsed ${orders.length} orders`);

    // Step 5: Select best order (most recent)
    const order = selectBestOrder(orders);

    if (!order) {
      return jsonResponse({
        success: false,
        error: 'Orders found but could not determine downloadable PDF',
        caseNumber,
        resultsCount: results.length
      }, 404);
    }

    console.log(`[OCC Fetcher] Selected order ${order.orderNumber}, entryId: ${order.entryId}`);

    // Step 6: Generate and download PDF using OCC's PDF generation flow
    // First get document info to find page count
    const docInfoResponse = await fetch('https://public.occ.ok.gov/WebLink/DocumentService.aspx/GetBasicDocumentInfo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ entryId: parseInt(order.entryId), repoName: 'OCC' })
    });

    const docInfo = await docInfoResponse.json() as any;
    const pageCount = docInfo?.data?.pageCount || 12;
    console.log(`[OCC Fetcher] Document has ${pageCount} pages`);

    // Start PDF generation
    const pageRange = `1 - ${pageCount}`;
    const generateUrl = `https://public.occ.ok.gov/WebLink/GeneratePDF10.aspx?key=${order.entryId}&PageRange=${encodeURIComponent(pageRange)}&Watermark=0&repo=OCC`;

    console.log(`[OCC Fetcher] Starting PDF generation: ${generateUrl}`);

    const generateResponse = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://public.occ.ok.gov',
        'Referer': `https://public.occ.ok.gov/WebLink/DocView.aspx?id=${order.entryId}`
      },
      body: JSON.stringify({})
    });

    const generateText = await generateResponse.text();
    console.log(`[OCC Fetcher] Generate response: ${generateText.substring(0, 200)}`);

    // Extract the key from the response (first line before newline)
    const pdfKey = generateText.split('\n')[0].replace('\r', '').trim();

    if (!pdfKey || pdfKey.includes('error')) {
      return jsonResponse({
        success: false,
        error: 'Failed to start PDF generation',
        caseNumber,
        orderNumber: order.orderNumber,
        details: generateText.substring(0, 200)
      }, 500);
    }

    console.log(`[OCC Fetcher] PDF generation key: ${pdfKey}`);

    // Poll for PDF completion
    let pdfReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    while (!pdfReady && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const progressResponse = await fetch('https://public.occ.ok.gov/WebLink/DocumentService.aspx/PDFTransition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({ Key: pdfKey })
      });

      const progress = await progressResponse.json() as any;
      console.log(`[OCC Fetcher] PDF progress (attempt ${attempts}): ${JSON.stringify(progress?.data || progress)}`);

      if (progress?.data?.finished) {
        if (progress.data.success) {
          pdfReady = true;
        } else {
          return jsonResponse({
            success: false,
            error: 'PDF generation failed',
            caseNumber,
            orderNumber: order.orderNumber,
            details: progress.data.errMsg
          }, 500);
        }
      }
    }

    if (!pdfReady) {
      return jsonResponse({
        success: false,
        error: 'PDF generation timed out',
        caseNumber,
        orderNumber: order.orderNumber
      }, 504);
    }

    // Download the generated PDF
    const pdfUrl = `https://public.occ.ok.gov/WebLink/PDF10/${pdfKey}/${order.entryId}`;
    console.log(`[OCC Fetcher] Downloading PDF from: ${pdfUrl}`);

    const pdfResponse = await fetch(pdfUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const contentType = pdfResponse.headers.get('content-type') || '';
    console.log(`[OCC Fetcher] PDF response content-type: ${contentType}, status: ${pdfResponse.status}`);

    if (!pdfResponse.ok) {
      return jsonResponse({
        success: false,
        error: `Failed to download PDF: ${pdfResponse.status}`,
        caseNumber,
        orderNumber: order.orderNumber,
        pdfUrl
      }, pdfResponse.status);
    }

    const pdfBlob = await pdfResponse.blob();
    console.log(`[OCC Fetcher] Downloaded PDF: ${pdfBlob.size} bytes`);

    // Update pdfUrl for the response
    order.pdfUrl = pdfUrl;

    // Step 7: Upload directly to R2 (avoids passing large file between workers)
    const filename = `OCC-${order.orderNumber}-${(order.reliefType || 'Order').replace(/\s+/g, '-')}.pdf`;
    const r2Key = `uploads/${userId}/${Date.now()}-${filename}`;

    console.log(`[OCC Fetcher] Uploading ${pdfBlob.size} bytes directly to R2 as ${r2Key}`);

    // Convert blob to ArrayBuffer for R2
    const pdfBuffer = await pdfBlob.arrayBuffer();
    console.log(`[OCC Fetcher] ArrayBuffer size: ${pdfBuffer.byteLength}`);

    try {
      const r2Result = await env.UPLOADS_BUCKET.put(r2Key, pdfBuffer, {
        httpMetadata: {
          contentType: 'application/pdf',
          contentDisposition: `attachment; filename="${filename}"`
        },
        customMetadata: {
          originalFilename: filename,
          uploadedAt: new Date().toISOString(),
          source: 'occ-fetcher',
          caseNumber: order.caseNumber,
          orderNumber: order.orderNumber
        }
      });
      console.log(`[OCC Fetcher] R2 put result: ${JSON.stringify(r2Result ? { key: r2Result.key, size: r2Result.size } : 'null')}`);

      if (!r2Result) {
        return jsonResponse({
          success: false,
          error: 'R2 upload failed - no result returned',
          caseNumber,
          orderNumber: order.orderNumber
        }, 500);
      }
    } catch (r2Error) {
      console.error(`[OCC Fetcher] R2 upload error:`, r2Error);
      return jsonResponse({
        success: false,
        error: 'R2 upload failed',
        details: r2Error instanceof Error ? r2Error.message : 'Unknown error',
        caseNumber,
        orderNumber: order.orderNumber
      }, 500);
    }

    console.log(`[OCC Fetcher] R2 upload complete, registering with documents-worker`);

    // Step 8: Register the document with documents-worker (lightweight JSON call)
    const registerPayload = {
      r2Key,
      userId,
      userPlan,
      organizationId,
      filename,
      fileSize: pdfBlob.size,
      contentType: 'application/pdf',
      sourceType: 'occ_alert',
      sourceApi: wellApiNumber,
      originalUrl: order.pdfUrl,
      metadata: {
        caseNumber: order.caseNumber,
        orderNumber: order.orderNumber,
        applicant: order.applicant,
        county: order.county,
        reliefType: order.reliefType,
        signingDate: order.signingDate
      }
    };

    // Use service binding to call documents-worker directly (avoids worker-to-worker HTTP issues)
    console.log(`[OCC Fetcher] Calling documents-worker via service binding`);
    console.log(`[OCC Fetcher] Register payload: ${JSON.stringify(registerPayload)}`);

    let registerResponse: Response;
    try {
      registerResponse = await env.DOCUMENTS_WORKER.fetch(
        new Request('https://internal/api/documents/register-external', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.PROCESSING_API_KEY
          },
          body: JSON.stringify(registerPayload)
        })
      );
    } catch (fetchError) {
      console.error(`[OCC Fetcher] Service binding error:`, fetchError);
      return jsonResponse({
        success: false,
        error: 'Failed to call documents-worker via service binding',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown fetch error'
      }, 500);
    }

    console.log(`[OCC Fetcher] Register response status: ${registerResponse.status}`);

    const registerText = await registerResponse.text();
    console.log(`[OCC Fetcher] Register response: ${registerText.substring(0, 500)}`);

    let uploadResult: any;
    try {
      uploadResult = JSON.parse(registerText);
    } catch (e) {
      return jsonResponse({
        success: false,
        error: 'Invalid response from documents-worker registration',
        status: registerResponse.status,
        responseText: registerText.substring(0, 200)
      }, 500);
    }

    if (!registerResponse.ok) {
      console.error(`[OCC Fetcher] Registration failed:`, uploadResult);
      return jsonResponse({
        success: false,
        error: 'Failed to register document',
        details: uploadResult
      }, 500);
    }

    console.log(`[OCC Fetcher] Registration successful: ${uploadResult.document?.id}`);

    // Step 8: Return success
    const successResponse: any = {
      success: true,
      document: uploadResult.document,
      order: {
        orderNumber: order.orderNumber,
        caseNumber: order.caseNumber,
        applicant: order.applicant,
        county: order.county,
        reliefType: order.reliefType,
        legalDescription: formatLegal(order),
        signingDate: order.signingDate,
        orderTitle: order.orderTitle
      },
      pdfUrl: order.pdfUrl
    };

    // Add note if multiple orders existed
    if (orders.length > 1) {
      successResponse.note = `This case has ${orders.length} orders. Retrieved the most recent (${order.signingDate || order.orderNumber}).`;
    }

    return jsonResponse(successResponse);

  } catch (error) {
    console.error(`[OCC Fetcher] Error:`, error);
    return jsonResponse({
      success: false,
      error: 'Failed to fetch order from OCC',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Get session cookies from OCC by visiting the site
 */
async function getOCCSessionCookies(): Promise<string> {
  const cookieJar: Map<string, string> = new Map();

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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  };

  // Hit the search page to get cookies, following redirects manually
  let response = await fetch('https://public.occ.ok.gov/WebLink/CustomSearch.aspx?SearchName=ImagedCaseDocumentsfiledafter3212022&dbid=0&repo=OCC', {
    method: 'GET',
    headers: browserHeaders,
    redirect: 'manual'
  });
  extractCookies(response);

  // Follow redirects to accumulate cookies
  let location = response.headers.get('location');
  let maxRedirects = 5;

  while (location && response.status >= 300 && response.status < 400 && maxRedirects > 0) {
    if (!location.startsWith('http')) {
      location = 'https://public.occ.ok.gov' + location;
    }

    response = await fetch(location, {
      method: 'GET',
      headers: {
        ...browserHeaders,
        'Cookie': Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
      },
      redirect: 'manual'
    });
    extractCookies(response);
    location = response.headers.get('location');
    maxRedirects--;
  }

  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Parse OCC search result into OCCOrder
 */
function parseSearchResult(result: OCCSearchResult): OCCOrder {
  const metadata: Record<string, string> = {};

  // Convert metadata array to lookup object
  // Structure: { name: "Field Name", values: ["value1"], isMvfg: false }
  for (const item of result.metadata || []) {
    if (item.name && item.values && item.values.length > 0) {
      metadata[item.name] = item.values[0];
    }
  }

  console.log(`[OCC Fetcher] Parsed metadata for entry ${result.entryId}:`, Object.keys(metadata).join(', '));

  const entryId = String(result.entryId);
  const orderNumber = result.name || metadata['ECF Order Number'] || '';

  return {
    entryId,
    orderNumber,
    caseNumber: metadata['ECF Case Number'] || metadata['Case Number'] || '',
    applicant: metadata['Applicant'],
    county: metadata['County'],
    reliefType: metadata['ECF Relief Type'] || metadata['Relief Type'],
    section: metadata['Section'],
    township: metadata['Township'],
    range: metadata['Range'],
    orderStatus: metadata['Order Status'],
    signingDate: metadata['Signing Agenda Date'],
    orderTitle: metadata['Order Title'],
    pdfUrl: `https://public.occ.ok.gov/WebLink/0/edoc/${entryId}/${orderNumber}.pdf`
  };
}

/**
 * Handle direct PDF fetch - bypasses OCC search when we already have the URL
 * Used when alerts already contain document URLs
 */
interface FetchPdfRequest {
  pdfUrl: string;
  userId: string;
  userPlan?: string;
  organizationId?: string;
  wellApiNumber?: string;
  filename?: string;
}

async function handleFetchPdf(request: Request, env: Env): Promise<Response> {
  let body: FetchPdfRequest;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { pdfUrl, userId, userPlan, organizationId, wellApiNumber, filename } = body;

  if (!pdfUrl || !userId) {
    return jsonResponse({ error: 'pdfUrl and userId are required' }, 400);
  }

  // Validate URL is from OCC
  if (!pdfUrl.includes('occ.ok.gov')) {
    return jsonResponse({ error: 'URL must be from occ.ok.gov domain' }, 400);
  }

  try {
    console.log(`[OCC Fetcher] Fetching PDF from ${pdfUrl}`);

    const pdfResponse = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!pdfResponse.ok) {
      return jsonResponse({
        success: false,
        error: `Failed to fetch PDF: ${pdfResponse.status} ${pdfResponse.statusText}`,
        pdfUrl
      }, pdfResponse.status);
    }

    const contentType = pdfResponse.headers.get('content-type') || '';
    if (!contentType.includes('pdf')) {
      return jsonResponse({
        success: false,
        error: 'URL did not return a PDF',
        contentType,
        pdfUrl
      }, 400);
    }

    const pdfBlob = await pdfResponse.blob();
    console.log(`[OCC Fetcher] Downloaded PDF: ${pdfBlob.size} bytes`);

    // Generate filename from URL if not provided
    const defaultFilename = pdfUrl.split('/').pop() || `occ-document-${Date.now()}.pdf`;
    const finalFilename = filename || defaultFilename;

    // Upload to documents-worker
    const formData = new FormData();
    formData.append('file', pdfBlob, finalFilename);
    formData.append('userId', userId);
    if (userPlan) formData.append('userPlan', userPlan);
    if (organizationId) formData.append('organizationId', organizationId);
    formData.append('sourceType', 'occ_direct');
    if (wellApiNumber) formData.append('sourceApi', wellApiNumber);
    formData.append('originalUrl', pdfUrl);
    formData.append('filename', finalFilename);

    console.log(`[OCC Fetcher] Uploading to documents-worker as ${finalFilename}`);

    const uploadResponse = await fetch(
      `${env.DOCUMENTS_WORKER_URL}/api/documents/upload-external`,
      {
        method: 'POST',
        headers: { 'X-API-Key': env.PROCESSING_API_KEY },
        body: formData
      }
    );

    const uploadResult = await uploadResponse.json() as any;

    if (!uploadResponse.ok) {
      return jsonResponse({
        success: false,
        error: 'Failed to upload document for processing',
        details: uploadResult
      }, 500);
    }

    console.log(`[OCC Fetcher] Upload successful: ${uploadResult.document?.id}`);

    return jsonResponse({
      success: true,
      document: uploadResult.document,
      pdfUrl,
      filename: finalFilename
    });

  } catch (error) {
    console.error(`[OCC Fetcher] Error:`, error);
    return jsonResponse({
      success: false,
      error: 'Failed to fetch PDF',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

function selectBestOrder(results: OCCOrder[]): OCCOrder | null {
  // Filter to only those with Entry ID (downloadable)
  const downloadable = results.filter(r => r.entryId);

  if (downloadable.length === 0) return null;
  if (downloadable.length === 1) return downloadable[0];

  // Multiple downloadable - return most recent by signing date
  return downloadable.sort((a, b) => {
    if (!a.signingDate || !b.signingDate) return 0;
    const dateA = new Date(a.signingDate);
    const dateB = new Date(b.signingDate);
    return dateB.getTime() - dateA.getTime();
  })[0];
}

function formatLegal(order: OCCOrder): string | undefined {
  if (order.section && order.township && order.range) {
    return `S${order.section}-T${order.township}-R${order.range}`;
  }
  return undefined;
}

/**
 * Debug endpoint: Search for all documents in a case (without Document Type filter)
 */
async function handleSearchCase(request: Request, env: Env): Promise<Response> {
  let body: { caseNumber: string };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { caseNumber } = body;
  if (!caseNumber) {
    return jsonResponse({ error: 'caseNumber is required' }, 400);
  }

  try {
    // Clean case number (remove "CD" prefix if present)
    const cleanCaseNumber = caseNumber.replace(/^CD\s*/i, '').trim();
    console.log(`[OCC Search] Searching for all documents in case ${caseNumber} (clean: ${cleanCaseNumber})`);

    // Get session cookies
    const cookies = await getOCCSessionCookies();
    console.log(`[OCC Search] Session cookies obtained: ${cookies.substring(0, 80)}...`);

    // Search WITHOUT the Document Type filter - get ALL documents for this case
    const searchSyntax = `({[]:[ECF Case Number]="${cleanCaseNumber}"} & ({LF:LOOKIN="\\\\AJLS\\\\Judicial & Legislative\\\\ECF"}) & {LF:templateid=52})`;
    console.log(`[OCC Search] Search syntax: ${searchSyntax}`);

    const searchPayload = {
      repoName: 'OCC',
      searchSyn: searchSyntax,
      searchUuid: '',
      sortColumn: '',
      startIdx: 0,
      endIdx: 50,
      getNewListing: true,
      sortOrder: 2,
      displayInGridView: false
    };

    const searchResponse = await fetch('https://public.occ.ok.gov/WebLink/SearchService.aspx/GetSearchListing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://public.occ.ok.gov',
        'Referer': 'https://public.occ.ok.gov/WebLink/CustomSearch.aspx?SearchName=ImagedCaseDocumentsfiledafter3212022&dbid=0&repo=OCC'
      },
      body: JSON.stringify(searchPayload)
    });

    const searchText = await searchResponse.text();
    console.log(`[OCC Search] Response length: ${searchText.length}`);

    if (!searchResponse.ok) {
      return jsonResponse({
        success: false,
        error: 'OCC search failed',
        status: searchResponse.status,
        response: searchText.substring(0, 500)
      }, 500);
    }

    let searchData: any;
    try {
      searchData = JSON.parse(searchText);
    } catch (e) {
      return jsonResponse({
        success: false,
        error: 'Invalid JSON from OCC',
        response: searchText.substring(0, 500)
      }, 500);
    }

    // Response structure varies - try multiple paths
    const data = searchData?.data || searchData?.d || searchData;
    const results = data?.results || [];
    console.log(`[OCC Search] Found ${results.length} documents`);

    // Parse all results to see what document types exist
    const documents = results.map((result: any) => {
      const metadata: Record<string, string> = {};
      for (const item of result.metadata || []) {
        if (item.name && item.values && item.values.length > 0) {
          metadata[item.name] = item.values[0];
        }
      }

      return {
        entryId: result.entryId,
        name: result.name,
        extension: result.extension,
        documentType: metadata['ECF Document Type'] || 'Unknown',
        orderNumber: metadata['ECF Order Number'],
        caseNumber: metadata['ECF Case Number'],
        applicant: metadata['Applicant'],
        county: metadata['County'],
        reliefType: metadata['ECF Relief Type'],
        docketDate: metadata['ECF Docket Date'],
        orderStatus: metadata['Order Status'],
        allMetadata: metadata
      };
    });

    return jsonResponse({
      success: true,
      caseNumber,
      cleanCaseNumber,
      totalDocuments: documents.length,
      documents,
      documentTypes: [...new Set(documents.map((d: any) => d.documentType))]
    });

  } catch (error) {
    console.error(`[OCC Search] Error:`, error);
    return jsonResponse({
      success: false,
      error: 'Search failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/**
 * Test endpoint: Probe OCC Well Records API to see if we can fetch Form 1000/1001/1002
 * by API number using the same Laserfiche JSON API we use for case documents.
 */
async function handleTestWellRecords(request: Request): Promise<Response> {
  let body: { apiNumber: string };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { apiNumber } = body;
  if (!apiNumber) {
    return jsonResponse({ error: 'apiNumber is required' }, 400);
  }

  const results: any = {
    apiNumber,
    tests: [],
    summary: {}
  };

  try {
    // Step 1: Get session cookies from the Well Records search page
    console.log(`[Well Records Test] Getting cookies for API ${apiNumber}`);

    const cookieJar: Map<string, string> = new Map();
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    };

    // Try getting cookies from the OGCDWellRecords search page
    let response = await fetch('https://public.occ.ok.gov/OGCDWellRecords/Search.aspx', {
      method: 'GET',
      headers: browserHeaders,
      redirect: 'manual'
    });
    extractCookies(response);

    // Follow redirects
    let location = response.headers.get('location');
    let maxRedirects = 5;
    while (location && response.status >= 300 && response.status < 400 && maxRedirects > 0) {
      if (!location.startsWith('http')) {
        location = 'https://public.occ.ok.gov' + location;
      }
      response = await fetch(location, {
        method: 'GET',
        headers: {
          ...browserHeaders,
          'Cookie': Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
        },
        redirect: 'manual'
      });
      extractCookies(response);
      location = response.headers.get('location');
      maxRedirects--;
    }

    const cookies = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    results.cookiesObtained = cookies.length > 0;
    results.cookiePreview = cookies.substring(0, 100) + '...';

    // Test different search syntaxes
    const searchVariants = [
      {
        name: 'OG Well Records - Simple',
        syntax: `{[OG Well Records]:[API Number]="${apiNumber}*"}`,
        lookin: null,
        templateId: null,
        referer: 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx'
      },
      {
        name: 'OilandGasWellRecordsSearch collection',
        syntax: `{[OG Well Records]:[API Number]="${apiNumber}*"}`,
        lookin: null,
        templateId: null,
        referer: 'https://public.occ.ok.gov/WebLink/CustomSearch.aspx?SearchName=OilandGasWellRecordsSearch&dbid=0&repo=OCC'
      },
      {
        name: 'Form 1000 search',
        syntax: `({[OG Well Records]:[API Number]="${apiNumber}*"} & {[OG Well Records]:[Form Number]="1000"})`,
        lookin: null,
        templateId: null,
        referer: 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx'
      },
      {
        name: 'Form 1000 wildcard',
        syntax: `({[]:[API Number]="${apiNumber}*"} & {[]:[Form Number]="1000*"})`,
        lookin: null,
        templateId: null,
        referer: 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx'
      },
      {
        name: 'Intent to Drill search',
        syntax: `({[]:[API Number]="${apiNumber}*"} & {[]:[Document Type]="Intent to Drill"})`,
        lookin: null,
        templateId: null,
        referer: 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx'
      },
      {
        name: 'OG Well Records - With OGCD path',
        syntax: `({[OG Well Records]:[API Number]="${apiNumber}*"} & {LF:LOOKIN="\\\\OGCD"})`,
        lookin: '\\\\OGCD',
        templateId: null,
        referer: 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx'
      }
    ];

    for (const variant of searchVariants) {
      console.log(`[Well Records Test] Testing: ${variant.name}`);

      const searchPayload = {
        repoName: 'OCC',
        searchSyn: variant.syntax,
        searchUuid: '',
        sortColumn: '',
        startIdx: 0,
        endIdx: 20,
        getNewListing: true,
        sortOrder: 2,
        displayInGridView: false
      };

      const testResult: any = {
        name: variant.name,
        syntax: variant.syntax,
        status: 'pending'
      };

      try {
        const searchResponse = await fetch('https://public.occ.ok.gov/WebLink/SearchService.aspx/GetSearchListing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Cookie': cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin': 'https://public.occ.ok.gov',
            'Referer': (variant as any).referer || 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx'
          },
          body: JSON.stringify(searchPayload)
        });

        testResult.httpStatus = searchResponse.status;
        const responseText = await searchResponse.text();
        testResult.responseLength = responseText.length;

        if (!searchResponse.ok) {
          testResult.status = 'http_error';
          testResult.errorPreview = responseText.substring(0, 300);
        } else {
          try {
            const searchData = JSON.parse(responseText);
            const data = searchData?.data || searchData?.d || searchData;
            const searchResults = data?.results || data?.entries || [];

            testResult.status = 'success';
            testResult.totalResults = data?.totalResults ?? searchResults.length;
            testResult.resultsReturned = searchResults.length;

            if (searchResults.length > 0) {
              // Parse first few results to see structure
              testResult.sampleResults = searchResults.slice(0, 3).map((result: any) => {
                const metadata: Record<string, string> = {};
                for (const item of result.metadata || []) {
                  if (item.name && item.values && item.values.length > 0) {
                    metadata[item.name] = item.values[0];
                  }
                }
                return {
                  entryId: result.entryId,
                  name: result.name,
                  extension: result.extension,
                  metadataFields: Object.keys(metadata),
                  metadata
                };
              });
            }
          } catch (parseError) {
            testResult.status = 'parse_error';
            testResult.responsePreview = responseText.substring(0, 500);
          }
        }
      } catch (fetchError) {
        testResult.status = 'fetch_error';
        testResult.error = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      }

      results.tests.push(testResult);
    }

    // Also try the OGCDWellRecords specific endpoint if it exists
    console.log(`[Well Records Test] Testing OGCDWellRecords specific API`);
    try {
      // The OGCDWellRecords site might use a different API endpoint
      const ogcdResponse = await fetch('https://public.occ.ok.gov/OGCDWellRecords/SearchService.aspx/GetSearchListing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://public.occ.ok.gov',
          'Referer': 'https://public.occ.ok.gov/OGCDWellRecords/Search.aspx'
        },
        body: JSON.stringify({
          repoName: 'OCC',
          searchSyn: `{[OG Well Records]:[API Number]="${apiNumber}*"}`,
          searchUuid: '',
          sortColumn: '',
          startIdx: 0,
          endIdx: 20,
          getNewListing: true,
          sortOrder: 2,
          displayInGridView: false
        })
      });

      results.tests.push({
        name: 'OGCDWellRecords endpoint',
        endpoint: '/OGCDWellRecords/SearchService.aspx/GetSearchListing',
        httpStatus: ogcdResponse.status,
        responseLength: (await ogcdResponse.text()).length,
        note: ogcdResponse.ok ? 'Endpoint exists!' : 'Endpoint may not exist or requires different params'
      });
    } catch (e) {
      results.tests.push({
        name: 'OGCDWellRecords endpoint',
        status: 'error',
        error: e instanceof Error ? e.message : 'Unknown error'
      });
    }

    // Summary
    const successfulTests = results.tests.filter((t: any) => t.status === 'success' && t.resultsReturned > 0);
    results.summary = {
      totalTests: results.tests.length,
      successful: successfulTests.length,
      bestResult: successfulTests.length > 0
        ? successfulTests.reduce((best: any, current: any) =>
            (current.resultsReturned || 0) > (best.resultsReturned || 0) ? current : best
          )
        : null,
      recommendation: successfulTests.length > 0
        ? 'API search works! Can implement automated PDF fetch.'
        : 'No successful searches. May need different approach or manual inspection.'
    };

    return jsonResponse(results);

  } catch (error) {
    console.error(`[Well Records Test] Error:`, error);
    return jsonResponse({
      ...results,
      error: 'Test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}
