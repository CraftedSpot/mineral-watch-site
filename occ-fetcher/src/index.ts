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
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
        }
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);

    if (url.pathname === '/fetch-order') {
      return handleFetchOrder(request, env);
    }

    // Alternative: Direct PDF URL upload (bypasses OCC search)
    if (url.pathname === '/fetch-pdf') {
      return handleFetchPdf(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
};

interface Env {
  PROCESSING_API_KEY: string;
  DOCUMENTS_WORKER_URL: string;
  UPLOADS_BUCKET: R2Bucket;
  DOCUMENTS_WORKER: Fetcher;
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
  metadata: Array<{ keyId: number; keyName: string; value: string }>;
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
    // Format: ({[]:[ECF Case Number]="2022-003039"} & {[]:[ECF Document Type]="Final Order"} & ({LF:LOOKIN="\\AJLS\\Judicial & Legislative\\ECF"}) & {LF:templateid=52})
    const searchSyntax = `({[]:[ECF Case Number]="${cleanCaseNumber}"} & {[]:[ECF Document Type]="Final Order"} & ({LF:LOOKIN="\\\\AJLS\\\\Judicial & Legislative\\\\ECF"}) & {LF:templateid=52})`;

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
  for (const item of result.metadata || []) {
    if (item.keyName && item.value) {
      metadata[item.keyName] = item.value;
    }
  }

  const entryId = String(result.entryId);
  const orderNumber = result.name || metadata['ECF Order Number'] || '';

  return {
    entryId,
    orderNumber,
    caseNumber: metadata['ECF Case Number'] || '',
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

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
