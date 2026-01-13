/**
 * OCC Fetcher Worker
 *
 * Fetches OCC pooling orders by case number, downloads the PDF,
 * and submits to documents-worker for processing.
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
}

interface FetchOrderRequest {
  caseNumber: string;
  userId: string;
  userPlan?: string;
  wellApiNumber?: string;
  organizationId?: string;
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
    // 1. Search OCC for Final Order
    const cleanCaseNumber = caseNumber.replace(/^CD/i, '');

    console.log(`[OCC Fetcher] Searching for case ${caseNumber} (clean: ${cleanCaseNumber})`);

    // OCC uses ASP.NET which requires __VIEWSTATE and __EVENTVALIDATION
    const searchUrl = 'https://public.occ.ok.gov/WebLink/CustomSearch.aspx?SearchName=ImagedCaseDocumentsfiledafter3212022&dbid=0&repo=OCC';

    // Step 1: Handle OCC's cookie check flow with manual redirect following
    const browserHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    };

    // Cookie jar to accumulate cookies across requests
    const cookieJar: Map<string, string> = new Map();

    // Helper to extract and store cookies
    function extractCookies(response: Response) {
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        // Handle multiple cookies in one header (comma-separated)
        const cookies = setCookieHeader.split(/,(?=\s*\w+=)/);
        for (const cookie of cookies) {
          const match = cookie.match(/^([^=]+)=([^;]*)/);
          if (match) {
            cookieJar.set(match[1].trim(), match[2]);
          }
        }
      }
    }

    function getCookieString(): string {
      return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    // Step 1a: Hit the search URL - it will redirect to CookieCheck
    console.log(`[OCC Fetcher] Step 1: Initial request to search URL`);
    let response = await fetch(searchUrl, {
      method: 'GET',
      headers: browserHeaders,
      redirect: 'manual'
    });
    extractCookies(response);
    console.log(`[OCC Fetcher] Cookies after step 1: ${cookieJar.size}`);

    // Step 1b: Follow redirect to CookieCheck if needed
    let location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      if (!location.startsWith('http')) {
        location = 'https://public.occ.ok.gov' + location;
      }
      console.log(`[OCC Fetcher] Step 2: Following redirect to ${location.substring(0, 80)}...`);

      response = await fetch(location, {
        method: 'GET',
        headers: { ...browserHeaders, 'Cookie': getCookieString() },
        redirect: 'manual'
      });
      extractCookies(response);
      console.log(`[OCC Fetcher] Cookies after step 2: ${cookieJar.size}`);

      // Check for another redirect
      location = response.headers.get('location');
      if (location && response.status >= 300 && response.status < 400) {
        if (!location.startsWith('http')) {
          location = 'https://public.occ.ok.gov' + location;
        }
        console.log(`[OCC Fetcher] Step 3: Following redirect to ${location.substring(0, 80)}...`);

        response = await fetch(location, {
          method: 'GET',
          headers: { ...browserHeaders, 'Cookie': getCookieString() },
          redirect: 'manual'
        });
        extractCookies(response);
        console.log(`[OCC Fetcher] Cookies after step 3: ${cookieJar.size}`);
      }
    }

    const initHtml = await response.text();
    const cookies = getCookieString();

    console.log(`[OCC Fetcher] Initial page length: ${initHtml.length}`);

    // Extract ASP.NET hidden fields
    const viewState = initHtml.match(/id="__VIEWSTATE"[^>]*value="([^"]*)"/)?.[1] || '';
    const viewStateGenerator = initHtml.match(/id="__VIEWSTATEGENERATOR"[^>]*value="([^"]*)"/)?.[1] || '';
    const eventValidation = initHtml.match(/id="__EVENTVALIDATION"[^>]*value="([^"]*)"/)?.[1] || '';

    console.log(`[OCC Fetcher] ViewState found: ${viewState.length > 0}, EventValidation found: ${eventValidation.length > 0}`);

    if (!viewState) {
      // Try alternate regex patterns
      const viewStateAlt = initHtml.match(/name="__VIEWSTATE"[^>]*value="([^"]*)"/)?.[1] || '';
      console.log(`[OCC Fetcher] Alt ViewState found: ${viewStateAlt.length > 0}`);
      console.log(`[OCC Fetcher] Page length: ${initHtml.length}`);
      console.log(`[OCC Fetcher] Has form: ${initHtml.includes('<form')}`);
      console.log(`[OCC Fetcher] Has Input0: ${initHtml.includes('Input0')}`);

      // Find where the form fields are
      const formIndex = initHtml.indexOf('<form');
      const inputIndex = initHtml.indexOf('Input0');
      console.log(`[OCC Fetcher] Form at: ${formIndex}, Input0 at: ${inputIndex}`);

      if (viewStateAlt) {
        // Use the alternate pattern
        console.log(`[OCC Fetcher] Using alternate viewstate pattern`);
      } else {
        return jsonResponse({
          success: false,
          error: 'Could not extract form fields from OCC search page',
          pageLength: initHtml.length,
          hasForm: initHtml.includes('<form'),
          debug: initHtml.substring(0, 1500)
        }, 500);
      }
    }

    // Step 2: POST search with hidden fields and cookies
    const searchFormData = new URLSearchParams();
    searchFormData.append('__VIEWSTATE', viewState);
    searchFormData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
    searchFormData.append('__EVENTVALIDATION', eventValidation);
    searchFormData.append('ImagedCaseDocumentsfiledafter3212022_Input0', cleanCaseNumber);
    searchFormData.append('ImagedCaseDocumentsfiledafter3212022_Input3', 'Final Order'); // Try without the "39:" prefix
    searchFormData.append('ImagedCaseDocumentsfiledafter3212022_Submit', 'Search');

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        ...browserHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies
      },
      body: searchFormData.toString(),
      redirect: 'follow'
    });

    const html = await searchResponse.text();

    console.log(`[OCC Fetcher] Search response length: ${html.length}`);
    console.log(`[OCC Fetcher] Response preview: ${html.substring(0, 2000)}`);

    // 2. Parse results
    const results = parseOCCSearchResults(html);

    console.log(`[OCC Fetcher] Found ${results.length} orders`);

    if (results.length === 0) {
      return jsonResponse({
        success: false,
        error: 'No Final Order found for this case',
        caseNumber,
        suggestion: 'The order may not be filed yet, or check the case number'
      }, 404);
    }

    // 3. Select best order (most recent with Entry ID)
    const order = selectBestOrder(results);

    if (!order) {
      return jsonResponse({
        success: false,
        error: 'Orders found but none have downloadable PDFs (missing Entry IDs)',
        caseNumber,
        resultsCount: results.length
      }, 404);
    }

    console.log(`[OCC Fetcher] Selected order ${order.orderNumber}, fetching PDF from ${order.pdfUrl}`);

    // 4. Fetch the PDF
    const pdfResponse = await fetch(order.pdfUrl);
    const contentType = pdfResponse.headers.get('content-type') || '';

    console.log(`[OCC Fetcher] PDF response content-type: ${contentType}`);

    if (contentType.includes('text/html')) {
      return jsonResponse({
        success: false,
        error: 'PDF not yet uploaded to OCC system',
        caseNumber,
        orderNumber: order.orderNumber,
        pdfUrl: order.pdfUrl,
        suggestion: 'The order has been filed but the PDF is not yet available. Try again later.'
      }, 202);
    }

    const pdfBlob = await pdfResponse.blob();

    console.log(`[OCC Fetcher] Downloaded PDF: ${pdfBlob.size} bytes`);

    // 5. Upload to documents-worker
    const filename = `OCC-${order.orderNumber}-${(order.reliefType || 'Order').replace(/\s+/g, '-')}.pdf`;

    const formData = new FormData();
    formData.append('file', pdfBlob, filename);
    formData.append('userId', userId);
    if (userPlan) formData.append('userPlan', userPlan);
    if (organizationId) formData.append('organizationId', organizationId);
    formData.append('sourceType', 'occ_alert');
    if (wellApiNumber) formData.append('sourceApi', wellApiNumber);
    formData.append('originalUrl', order.pdfUrl);
    formData.append('filename', filename);

    console.log(`[OCC Fetcher] Uploading to documents-worker as ${filename}`);

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
      console.error(`[OCC Fetcher] Upload failed:`, uploadResult);
      return jsonResponse({
        success: false,
        error: 'Failed to upload document for processing',
        details: uploadResult
      }, 500);
    }

    console.log(`[OCC Fetcher] Upload successful: ${uploadResult.document?.id}`);

    // 6. Return success
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
    if (results.length > 1) {
      successResponse.note = `This case has ${results.length} orders. Retrieved the most recent (${order.signingDate || order.orderNumber}).`;
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

function parseOCCSearchResults(html: string): OCCOrder[] {
  // Check for no results
  if (html.includes('No results found') || html.includes('Results 0 - 0 of 0')) {
    return [];
  }

  // Extract result count
  const countMatch = html.match(/Results.*?(\d+) - (\d+) of (\d+)/);
  const totalResults = countMatch ? parseInt(countMatch[3]) : 0;

  if (totalResults === 0) return [];

  // Split by "Fields" to separate individual results
  const sections = html.split('Fields');
  const results: OCCOrder[] = [];

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];

    const entryId = section.match(/Entry ID:(\d+)/)?.[1];
    const orderNumber = section.match(/ECF Order Number:(\d+)/)?.[1];

    // Only add if we have the critical Entry ID and Order Number
    if (entryId && orderNumber) {
      results.push({
        entryId,
        orderNumber,
        caseNumber: section.match(/(?:ECF )?Case Number:(?:CD)?([\d-]+)/)?.[1] || '',
        applicant: section.match(/Applicant:([^\s]+)/)?.[1],
        county: section.match(/County:([^\s]+)/)?.[1],
        reliefType: section.match(/(?:ECF )?Relief Types?:([A-Za-z\s]+?)(?=[A-Z][a-z]+:|$)/i)?.[1]?.trim(),
        section: section.match(/Section:(\d+)/)?.[1],
        township: section.match(/Township:(\w+)/)?.[1],
        range: section.match(/Range:(\w+)/)?.[1],
        orderStatus: section.match(/Order Status:(\w+)/)?.[1],
        signingDate: section.match(/Signing Agenda Date:([\d\/]+)/)?.[1],
        orderTitle: section.match(/Order Title:([^O]+?)(?:Order Type|$)/)?.[1]?.trim(),
        pdfUrl: `https://public.occ.ok.gov/WebLink/0/edoc/${entryId}/${orderNumber}.pdf`
      });
    }
  }

  return results;
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
