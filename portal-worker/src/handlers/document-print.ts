/**
 * Document Print Report Handler
 *
 * Serves a print-friendly summary page for analyzed documents
 * GET /print/document?id=XXX
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest, SessionPayload } from '../utils/auth.js';
import type { Env } from '../types/env.js';

interface DocumentPrintData {
  id: string;
  displayName: string;
  filename: string;
  docType: string;
  category: string;
  status: string;
  confidence: string | null;
  county: string | null;
  uploadDate: string;
  userNotes: string | null;
  linkedProperties: Array<{
    name: string;
    section: string;
    township: string;
    range: string;
    county: string;
  }>;
  extractedData: any;
  keyTakeaway: string | null;
  detailedAnalysis: string | null;
}

/**
 * Fetch document data from the documents-worker
 */
async function fetchDocumentPrintData(
  docId: string,
  env: Env,
  request: Request
): Promise<DocumentPrintData | null> {
  console.log(`[DocumentPrint] Fetching document: ${docId}`);

  if (!env.DOCUMENTS_WORKER) {
    throw new Error('Documents service not available');
  }

  // Fetch document from documents-worker - pass original request headers (including cookies)
  const response = await env.DOCUMENTS_WORKER.fetch(
    new Request(`https://documents-worker/api/documents/${docId}`, {
      method: 'GET',
      headers: request.headers,
    })
  );

  if (!response.ok) {
    console.error(`[DocumentPrint] Failed to fetch document: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as { document: any };
  const doc = data.document;

  if (!doc) {
    return null;
  }

  // Parse extracted_data
  let extractedData: any = {};
  if (doc.extracted_data) {
    try {
      extractedData =
        typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : doc.extracted_data;
    } catch (e) {
      console.error('[DocumentPrint] Failed to parse extracted_data:', e);
    }
  }

  // Extract key takeaway and detailed analysis from AI response
  // Check multiple possible field names for compatibility
  const keyTakeaway = extractedData.key_takeaway || extractedData.summary ||
                      extractedData.executive_summary || null;
  // ai_observations is the primary field name used by the extractor
  let detailedAnalysis = extractedData.ai_observations || extractedData.detailed_analysis ||
                           extractedData.analysis || extractedData.full_analysis || null;

  // Clean up analysis text - remove embedded field scores, confidence, etc.
  if (detailedAnalysis) {
    // Remove "**Field Scores:**" section and any JSON that follows
    detailedAnalysis = detailedAnalysis.replace(/\*\*Field Scores:\*\*[\s\S]*?```json[\s\S]*?```/gi, '');
    detailedAnalysis = detailedAnalysis.replace(/\*\*Field Scores:\*\*[\s\S]*?\{[\s\S]*?\}/gi, '');
    detailedAnalysis = detailedAnalysis.replace(/Field Scores:[\s\S]*?```json[\s\S]*?```/gi, '');
    // Remove "**Document Confidence:**" lines
    detailedAnalysis = detailedAnalysis.replace(/\*\*Document Confidence:\*\*.*$/gim, '');
    detailedAnalysis = detailedAnalysis.replace(/Document Confidence:.*$/gim, '');
    // Trim any trailing whitespace/newlines
    detailedAnalysis = detailedAnalysis.trim();
  }

  // Format linked properties
  const linkedProperties = (doc.linked_properties || []).map((p: any) => ({
    name: p.name || `S${p.section}-T${p.township}-R${p.range}`,
    section: p.section || '',
    township: p.township || '',
    range: p.range || '',
    county: p.county || '',
  }));

  // Calculate confidence text
  let confidenceText = doc.confidence;
  const fieldScores = extractedData.field_scores;
  if (fieldScores && Object.keys(fieldScores).length > 0) {
    const scores = Object.values(fieldScores).filter((s): s is number => typeof s === 'number');
    if (scores.length > 0) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      confidenceText = avg >= 0.9 ? 'high' : avg >= 0.5 ? 'medium' : 'low';
    }
  }

  return {
    id: doc.id,
    displayName: doc.display_name || doc.filename,
    filename: doc.filename,
    docType: doc.doc_type || 'unknown',
    category: doc.category || doc.doc_type || 'document',
    status: doc.status,
    confidence: confidenceText,
    county: doc.county,
    uploadDate: doc.upload_date,
    userNotes: doc.user_notes,
    linkedProperties,
    extractedData,
    keyTakeaway,
    detailedAnalysis,
  };
}

/**
 * GET /print/document?id=XXX
 * Serves the document print report page
 */
export async function handleDocumentPrint(request: Request, env: Env): Promise<Response> {
  // Require authentication
  const session = await authenticateRequest(request, env);
  if (!session) {
    const url = new URL(request.url);
    const redirectUrl = `/portal/login?redirect=${encodeURIComponent(url.pathname + url.search)}`;
    return Response.redirect(redirectUrl, 302);
  }

  const url = new URL(request.url);
  const docId = url.searchParams.get('id');

  if (!docId) {
    return new Response('Missing document id parameter', { status: 400 });
  }

  try {
    const data = await fetchDocumentPrintData(docId, env, request);

    if (!data) {
      return new Response('Document not found', { status: 404 });
    }

    const html = generateDocumentPrintHtml(data);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Error generating document print report:', error);
    return new Response(
      `Error generating report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
}

/**
 * Format document type for display
 */
function formatDocType(docType: string): string {
  const typeMap: Record<string, string> = {
    deed: 'Deed',
    mineral_deed: 'Mineral Deed',
    royalty_deed: 'Royalty Deed',
    warranty_deed: 'Warranty Deed',
    quitclaim_deed: 'Quitclaim Deed',
    lease: 'Oil & Gas Lease',
    oil_and_gas_lease: 'Oil & Gas Lease',
    pooling_order: 'Pooling Order',
    division_order: 'Division Order',
    drilling_and_spacing_order: 'Spacing Order',
    horizontal_drilling_and_spacing_order: 'Horizontal Spacing Order',
    location_exception_order: 'Location Exception',
    horizontal_location_exception_order: 'Horizontal Location Exception',
    increased_density_order: 'Increased Density Order',
    occ_order: 'OCC Order',
    completion_report: 'Completion Report',
    title_opinion: 'Title Opinion',
    affidavit: 'Affidavit',
    check_stub: 'Check Stub / Revenue Statement',
    other: 'Document',
  };
  return typeMap[docType] || docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format text with basic markdown support (bold, italic)
 * Escapes HTML first, then converts markdown syntax
 * Also cleans up malformed markdown from AI extraction
 */
function formatMarkdown(s: string | null | undefined): string {
  if (!s) return '';

  // Strip --- horizontal rules before escaping
  let text = s.replace(/^---+$/gm, '');

  text = escapeHtml(text);

  // Convert ### headers to styled section headers
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<br><strong style="font-size: 15px; display: inline-block; margin-top: 8px;">$1</strong>');

  // Clean up malformed markdown patterns from AI:
  // 1. Remove orphaned ** at end of lines (like "Headline:**")
  text = text.replace(/:\*\*\s*$/gm, ':');
  text = text.replace(/:\*\*\n/g, ':\n');

  // 2. Lines that look like headlines (end with :) followed by ** on next line
  //    should have the ** moved to wrap the headline instead
  text = text.replace(/^([A-Z][^:\n]+:)\s*\n\*\*/gm, '**$1**\n');

  // 3. Convert properly formatted **bold** to <strong>
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 4. Clean up any remaining orphaned ** markers
  text = text.replace(/\*\*/g, '');

  // 5. Convert *italic* to <em> (but not if it was part of **)
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // 6. Convert markdown bullet lists (- item) to bullet characters
  text = text.replace(/^- (.+)$/gm, '&bull; $1');

  return text;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Generate the main print HTML
 */
function generateDocumentPrintHtml(data: DocumentPrintData): string {
  const docTypeDisplay = formatDocType(data.docType);

  // Generate content based on document type
  let extractedFieldsHtml = '';
  switch (data.docType) {
    case 'deed':
    case 'mineral_deed':
    case 'royalty_deed':
    case 'warranty_deed':
    case 'quitclaim_deed':
    case 'gift_deed':
    case 'trust_funding':
      extractedFieldsHtml = generateDeedFields(data.extractedData);
      break;
    case 'lease':
    case 'oil_and_gas_lease':
    case 'oil_gas_lease':
      extractedFieldsHtml = generateLeaseFields(data.extractedData);
      break;
    case 'pooling_order':
      extractedFieldsHtml = generatePoolingFields(data.extractedData);
      break;
    case 'division_order':
      extractedFieldsHtml = generateDivisionOrderFields(data.extractedData);
      break;
    case 'drilling_and_spacing_order':
    case 'horizontal_drilling_and_spacing_order':
      extractedFieldsHtml = generateSpacingFields(data.extractedData);
      break;
    case 'location_exception_order':
    case 'horizontal_location_exception_order':
      extractedFieldsHtml = generateLocationExceptionFields(data.extractedData);
      break;
    case 'increased_density_order':
      extractedFieldsHtml = generateIncreasedDensityFields(data.extractedData);
      break;
    case 'completion_report':
      extractedFieldsHtml = generateCompletionReportFields(data.extractedData);
      break;
    case 'drilling_permit':
      extractedFieldsHtml = generateDrillingPermitFields(data.extractedData);
      break;
    case 'assignment_of_lease':
    case 'assignment':
      extractedFieldsHtml = generateAssignmentFields(data.extractedData);
      break;
    case 'change_of_operator_order':
      extractedFieldsHtml = generateChangeOfOperatorFields(data.extractedData);
      break;
    case 'multi_unit_horizontal_order':
      extractedFieldsHtml = generateMultiUnitHorizontalFields(data.extractedData);
      break;
    case 'death_certificate':
      extractedFieldsHtml = generateDeathCertificateFields(data.extractedData);
      break;
    case 'correspondence':
    case 'letter':
    case 'email':
    case 'notice':
    case 'transmittal':
      extractedFieldsHtml = generateCorrespondenceFields(data.extractedData);
      break;
    case 'check_stub':
    case 'royalty_statement':
    case 'revenue_statement':
      extractedFieldsHtml = generateCheckStubFields(data.extractedData);
      break;
    default:
      extractedFieldsHtml = generateGenericFields(data.extractedData);
  }

  // Generate linked properties section if any
  const linkedPropertiesHtml =
    data.linkedProperties.length > 0
      ? `
    <div class="section">
      <div class="section-title">LINKED MINERAL INTERESTS</div>
      <table class="data-table">
        <thead>
          <tr><th>Location</th><th>County</th></tr>
        </thead>
        <tbody>
          ${data.linkedProperties
            .map(
              (p, i) => `
            <tr ${i % 2 !== 0 ? 'class="alt"' : ''}>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.county)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `
      : '';

  // User notes section
  const userNotesHtml = data.userNotes
    ? `
    <div class="section notes-section">
      <div class="section-title">YOUR NOTES</div>
      <div class="notes-content">${escapeHtml(data.userNotes)}</div>
    </div>
  `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.displayName)} - Summary</title>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #f1f5f9;
      padding: 20px;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .print-controls {
      max-width: 8.5in;
      margin: 0 auto 16px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .print-btn {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .print-btn.primary { background: #1C2B36; color: white; }
    .print-btn.primary:hover { background: #334E68; }
    .print-btn.secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
    .print-btn.secondary:hover { background: #f8fafc; }
    .print-container {
      width: 8.5in;
      min-height: 11in;
      margin: 0 auto;
      background: white;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #1C2B36 0%, #334E68 100%);
      color: white;
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 6px;
      letter-spacing: 0.5px;
    }
    .header .doc-name {
      font-size: 14px;
      font-weight: 500;
      opacity: 0.9;
      margin-bottom: 4px;
    }
    .header .doc-meta {
      font-size: 12px;
      opacity: 0.8;
    }
    .header .brand { text-align: right; flex-shrink: 0; }
    .header .brand-name {
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      font-family: 'Merriweather', Georgia, serif;
      white-space: nowrap;
    }
    .header .brand-url {
      font-size: 9px;
      opacity: 0.8;
      margin-top: 2px;
    }
    .confidence-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 8px;
    }
    .confidence-high { background: rgba(34, 197, 94, 0.2); color: #16a34a; }
    .confidence-medium { background: rgba(245, 158, 11, 0.2); color: #d97706; }
    .confidence-low { background: rgba(239, 68, 68, 0.2); color: #dc2626; }

    .section {
      padding: 16px 24px;
      border-bottom: 1px solid #e2e8f0;
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      color: #1C2B36;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }

    /* Key Takeaway styling - uses border instead of background for better printing */
    .key-takeaway {
      background: #fff;
      border-left: 4px solid #16a34a;
      border-radius: 0;
      padding: 12px 16px;
    }
    .key-takeaway-label {
      font-size: 10px;
      font-weight: 600;
      color: #16a34a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .key-takeaway-text {
      font-size: 14px;
      line-height: 1.5;
      color: #1e293b;
      font-weight: 500;
    }

    /* Detailed Analysis styling */
    .analysis-content {
      font-size: 13px;
      line-height: 1.6;
      color: #374151;
      white-space: pre-wrap;
    }

    /* Field grid styling */
    .field-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .field-item {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .field-item.full-width {
      grid-column: 1 / -1;
    }
    .field-label {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-bottom: 4px;
    }
    .field-value {
      font-size: 13px;
      color: #1e293b;
      font-weight: 500;
    }
    .field-value.highlight {
      color: #059669;
      font-weight: 600;
    }
    .field-value.mono {
      font-family: monospace;
      font-size: 12px;
    }

    /* Data table styling */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .data-table th {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 2px solid #e2e8f0;
      font-weight: 600;
      color: #64748b;
      background: #f8fafc;
    }
    .data-table td {
      padding: 6px 10px;
    }
    .data-table tr.alt {
      background: #f8fafc;
    }

    /* Legal description styling */
    .legal-description {
      background: #fefce8;
      border: 1px solid #fde047;
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
      line-height: 1.5;
      color: #713f12;
    }

    /* Parties styling */
    .parties-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .party-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px;
    }
    .party-label {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .party-name {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 4px;
    }
    .party-detail {
      font-size: 12px;
      color: #64748b;
    }

    /* Notes styling */
    .notes-section {
      background: #fffbeb;
    }
    .notes-content {
      font-size: 13px;
      line-height: 1.5;
      color: #78350f;
      white-space: pre-wrap;
    }

    .footer {
      padding: 10px 24px;
      font-size: 9px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      background: #f8fafc;
    }

    /* Mobile responsive */
    @media screen and (max-width: 900px) {
      body { padding: 10px; }
      .print-container { width: 100%; min-height: auto; }
      .print-controls { flex-direction: column; gap: 8px; }
      .print-btn { width: 100%; justify-content: center; }
      .header { flex-direction: column; gap: 12px; padding: 16px; }
      .header .brand { text-align: left; }
      .section { padding: 12px 16px; }
      .field-grid { grid-template-columns: 1fr; }
      .parties-grid { grid-template-columns: 1fr; }
      .footer { flex-direction: column; gap: 4px; text-align: center; }
    }

    @media print {
      body { background: white; padding: 0; }
      .print-controls { display: none !important; }
      .print-container { box-shadow: none; width: 100%; }
      .header { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    @page { size: letter; margin: 0.25in; }
  </style>
</head>
<body>
  <div class="print-controls">
    <button class="print-btn secondary" onclick="window.close()">Back to Dashboard</button>
    <div style="display: flex; gap: 12px;">
      <a href="/api/documents/${escapeHtml(data.id)}/download" class="print-btn secondary" style="text-decoration: none;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download Original
      </a>
      <button class="print-btn primary" onclick="window.print()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 6 2 18 2 18 9"></polyline>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
          <rect x="6" y="14" width="12" height="8"></rect>
        </svg>
        Print Summary
      </button>
    </div>
  </div>

  <div class="print-container">
    <div class="header">
      <div>
        <h1>${escapeHtml(docTypeDisplay).toUpperCase()} SUMMARY</h1>
        <div class="doc-name">${escapeHtml(data.displayName)}</div>
        <div class="doc-meta">
          ${data.county ? escapeHtml(data.county) + ' County' : ''}
          ${data.confidence ? `<span class="confidence-badge confidence-${data.confidence}">${data.confidence} confidence</span>` : ''}
        </div>
      </div>
      <div class="brand">
        <div class="brand-name">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          MINERAL WATCH
        </div>
        <div class="brand-url">mymineralwatch.com</div>
      </div>
    </div>

    ${
      data.keyTakeaway
        ? `
    <div class="section">
      <div class="key-takeaway">
        <div class="key-takeaway-label">Key Takeaway</div>
        <div class="key-takeaway-text">${formatMarkdown(data.keyTakeaway)}</div>
      </div>
    </div>
    `
        : ''
    }

    ${
      data.detailedAnalysis
        ? `
    <div class="section">
      <div class="section-title">DETAILED ANALYSIS</div>
      <div class="analysis-content">${formatMarkdown(data.detailedAnalysis)}</div>
    </div>
    `
        : ''
    }

    <div class="section">
      <div class="section-title">EXTRACTED INFORMATION (KEY POINTS)</div>
      ${extractedFieldsHtml}
    </div>

    ${linkedPropertiesHtml}

    ${userNotesHtml}

    <div class="footer">
      <span>Generated by Mineral Watch on ${formatDate(new Date().toISOString())}</span>
      <span>Analyzed: ${formatDate(data.uploadDate)}</span>
    </div>
  </div>


</body>
</html>`;
}

// ============================================
// Document Type-Specific Field Generators
// ============================================

function generateDeedFields(data: any): string {
  // Grantors and Grantees are arrays
  const grantors = data.grantors || [];
  const grantees = data.grantees || [];
  const tracts = data.tracts || [];
  const recordingInfo = data.recording_info || data.recording || {};

  // Format party names with tenancy info
  const formatPartyList = (parties: any[]): string => {
    if (!parties || parties.length === 0) return 'Not specified';

    const names = parties.map((p: any) => {
      let name = p.name || '';
      if (p.capacity) name += ` (${p.capacity})`;
      return name;
    }).filter(Boolean);

    if (names.length === 0) return 'Not specified';

    // Check for tenancy type
    const tenancy = parties[0]?.tenancy;
    let tenancyText = '';
    if (tenancy === 'joint_tenants' || tenancy === 'joint_tenants_wros') {
      tenancyText = ' (Joint Tenants)';
    } else if (tenancy === 'tenants_in_common') {
      tenancyText = ' (Tenants in Common)';
    }

    return names.join(' and ') + tenancyText;
  };

  // Get book/page from recording_info
  const book = recordingInfo.book || data.book || '';
  const page = recordingInfo.page || data.page || '';

  // Build grantors party box
  const grantorsHtml = `
    <div class="party-box">
      <div class="party-label">Grantor${grantors.length > 1 ? 's' : ''} (Seller)</div>
      <div class="party-name">${escapeHtml(formatPartyList(grantors))}</div>
      ${grantors[0]?.address ? `<div class="party-detail">${escapeHtml(grantors[0].address)}</div>` : ''}
    </div>
  `;

  // Build grantees party box
  const granteesHtml = `
    <div class="party-box">
      <div class="party-label">Grantee${grantees.length > 1 ? 's' : ''} (Buyer)</div>
      <div class="party-name">${escapeHtml(formatPartyList(grantees))}</div>
      ${grantees[0]?.address ? `<div class="party-detail">${escapeHtml(grantees[0].address)}</div>` : ''}
    </div>
  `;

  // Build tracts display
  const tractsHtml = tracts.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Tracts Conveyed</div>
      ${tracts.map((tract: any, i: number) => {
        const legal = tract.legal || tract.legal_description || {};
        const interest = tract.interest || {};
        const section = legal.section || tract.section || '';
        const township = legal.township || tract.township || '';
        const range = legal.range || tract.range || '';
        const county = legal.county || tract.county || '';
        const quarters = legal.quarter_calls?.join(', ') || legal.quarters || tract.quarters || '';
        const acres = tract.acres || legal.gross_acres || '';
        const interestType = interest.type || tract.interest_type || '';
        const fraction = interest.fraction_text || interest.fraction || tract.fraction || '';
        const nma = tract.net_mineral_acres || interest.net_mineral_acres || '';

        return `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; ${i > 0 ? 'margin-top: 8px;' : ''}">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px;">
              ${section && township && range ? `Section ${escapeHtml(String(section))}-${escapeHtml(township)}-${escapeHtml(range)}` : 'Tract ' + (i + 1)}
              ${county ? `, ${escapeHtml(county)} County` : ''}
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 13px;">
              ${quarters ? `<div><span style="color: #64748b;">Quarter:</span> ${escapeHtml(quarters)}</div>` : ''}
              ${acres ? `<div><span style="color: #64748b;">Acres:</span> ${escapeHtml(String(acres))}</div>` : ''}
              ${interestType ? `<div><span style="color: #64748b;">Interest Type:</span> ${escapeHtml(interestType)}</div>` : ''}
              ${fraction ? `<div><span style="color: #64748b;">Fraction:</span> <strong>${escapeHtml(fraction)}</strong></div>` : ''}
              ${nma ? `<div><span style="color: #64748b;">Net Mineral Acres:</span> <strong>${escapeHtml(String(nma))}</strong></div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="parties-grid">
      ${grantorsHtml}
      ${granteesHtml}
    </div>

    <div class="field-grid" style="margin-top: 16px;">
      <div class="field-item">
        <div class="field-label">Deed Type</div>
        <div class="field-value">${escapeHtml(data.deed_type) || 'Mineral Deed'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Execution Date</div>
        <div class="field-value">${formatDate(data.execution_date) || 'Not specified'}</div>
      </div>
      ${book ? `
      <div class="field-item">
        <div class="field-label">Book/Page</div>
        <div class="field-value mono">Book ${escapeHtml(book)}${page ? `, Page ${escapeHtml(page)}` : ''}</div>
      </div>
      ` : ''}
      ${data.consideration ? `
      <div class="field-item">
        <div class="field-label">Consideration</div>
        <div class="field-value">${escapeHtml(data.consideration)}</div>
      </div>
      ` : ''}
    </div>

    ${tractsHtml}
  `;
}

function generateLeaseFields(data: any): string {
  // Handle both flat and nested lessor/lessee structures
  const lessor = typeof data.lessor === 'string' ? { name: data.lessor } : (data.lessor || {});
  const lessee = typeof data.lessee === 'string' ? { name: data.lessee } : (data.lessee || {});
  const legalDescription = data.legal_description || {};
  const recording = data.recording || data.recording_info || {};
  const primaryTerm = (typeof data.primary_term === 'object' && data.primary_term) ? data.primary_term : {};
  const royalty = data.royalty || {};
  const bonusConsideration = data.bonus_consideration || {};
  const consideration = (typeof data.consideration === 'object' && data.consideration) ? data.consideration : {};
  const tracts = data.tracts || [];

  // Primary term: handle multiple formats
  let primaryTermDisplay = '';
  if (primaryTerm.years || primaryTerm.months) {
    const parts: string[] = [];
    if (primaryTerm.years) parts.push(`${primaryTerm.years} year${primaryTerm.years > 1 ? 's' : ''}`);
    if (primaryTerm.months) parts.push(`${primaryTerm.months} month${primaryTerm.months > 1 ? 's' : ''}`);
    primaryTermDisplay = parts.join(', ');
  } else if (primaryTerm.duration) {
    primaryTermDisplay = `${escapeHtml(primaryTerm.duration)} ${escapeHtml(primaryTerm.unit || 'years')}`;
  } else if (data.primary_term_years) {
    primaryTermDisplay = `${escapeHtml(String(data.primary_term_years))} years`;
  }

  // Royalty: handle oil/gas sub-objects, flat fraction, or flat rate
  let royaltyDisplay = '';
  if (royalty.oil?.fraction || royalty.gas?.fraction) {
    const oilFrac = royalty.oil?.fraction || '';
    const gasFrac = royalty.gas?.fraction || '';
    if (oilFrac && gasFrac && oilFrac === gasFrac) {
      royaltyDisplay = oilFrac;
    } else {
      const parts: string[] = [];
      if (oilFrac) parts.push(`Oil: ${oilFrac}`);
      if (gasFrac) parts.push(`Gas: ${gasFrac}`);
      royaltyDisplay = parts.join(', ');
    }
  } else if (royalty.rate) {
    royaltyDisplay = royalty.rate;
  } else if (data.royalty_fraction) {
    royaltyDisplay = String(data.royalty_fraction);
  } else if (data.royalty_decimal) {
    royaltyDisplay = String(data.royalty_decimal);
  }

  // Lease date: try multiple field names
  const leaseDate = formatDate(data.lease_date || data.execution_date) || '';

  // Recording date: try flat and nested
  const recordingDate = formatDate(data.recording_date || recording.recording_date) || '';

  // Book/page: try flat and nested recording object
  const book = data.book || recording.book || '';
  const page = data.page || recording.page || '';

  // Bonus: try new consideration object, old bonus_consideration, and flat fields
  const bonusDisplay = consideration.bonus_stated || consideration.total_bonus
    ? escapeHtml(String(consideration.bonus_stated || `$${consideration.total_bonus}`))
    : bonusConsideration.amount || data.bonus_paid
      ? escapeHtml(String(bonusConsideration.amount || data.bonus_paid)) + (bonusConsideration.per_acre ? '/acre' : '')
      : '';

  // Delay rental
  const delayRental = consideration.delay_rental || data.delay_rental || '';

  // Location line from top-level TRS
  const section = data.section;
  const township = data.township;
  const range = data.range;
  const county = data.county || '';
  let locationLine = '';
  if (section || township || range) {
    const trsParts: string[] = [];
    if (section) trsParts.push(`S${section}`);
    if (township) trsParts.push(`T${township}`);
    if (range) trsParts.push(`R${range}`);
    locationLine = trsParts.join('-');
    if (county) locationLine += `, ${county} County`;
  }

  // Gross acres from tracts if not at top level
  const grossAcres = data.gross_acres || (tracts.length > 0 ? tracts.reduce((sum: number, t: any) => sum + (t.acres || 0), 0) : 0);

  // Build tracts/legal description
  const tractsHtml = tracts.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Property Description</div>
      ${tracts.map((tract: any, i: number) => {
        const legal = tract.legal_description || tract.legal || {};
        const quarters = legal.quarters || (legal.quarter_calls ? legal.quarter_calls.join(', ') : '') || '';
        const tSection = legal.section || '';
        const tTownship = legal.township || '';
        const tRange = legal.range || '';
        const tCounty = legal.county || '';
        const acres = tract.acres || '';

        return `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; ${i > 0 ? 'margin-top: 8px;' : ''}">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 6px;">
              ${tSection && tTownship && tRange ? `Section ${escapeHtml(String(tSection))}-${escapeHtml(tTownship)}-${escapeHtml(tRange)}` : `Tract ${i + 1}`}
              ${tCounty ? `, ${escapeHtml(tCounty)} County` : ''}
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 13px;">
              ${quarters ? `<div><span style="color: #64748b;">Quarter:</span> ${escapeHtml(quarters)}</div>` : ''}
              ${acres ? `<div><span style="color: #64748b;">Acres:</span> ${escapeHtml(String(acres))}${tract.acres_qualifier ? ` (${escapeHtml(tract.acres_qualifier)})` : ''}</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : legalDescription.full_text ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Legal Description</div>
      <div class="legal-description">${escapeHtml(legalDescription.full_text)}</div>
    </div>
  ` : '';

  // Lessor address line
  const lessorAddress = [lessor.address, lessor.city, lessor.state, lessor.zip].filter(Boolean).join(', ');
  const lesseeAddress = [lessee.address, lessee.city, lessee.state, lessee.zip].filter(Boolean).join(', ');

  return `
    <div class="parties-grid">
      <div class="party-box">
        <div class="party-label">Lessor (Mineral Owner)</div>
        <div class="party-name">${escapeHtml(lessor.name || 'Not specified')}</div>
        ${lessorAddress ? `<div class="party-detail">${escapeHtml(lessorAddress)}</div>` : ''}
      </div>
      <div class="party-box">
        <div class="party-label">Lessee (Oil Company)</div>
        <div class="party-name">${escapeHtml(lessee.name || 'Not specified')}</div>
        ${lesseeAddress ? `<div class="party-detail">${escapeHtml(lesseeAddress)}</div>` : ''}
      </div>
    </div>

    <div class="field-grid" style="margin-top: 16px;">
      ${locationLine ? `
      <div class="field-item">
        <div class="field-label">Location</div>
        <div class="field-value">${escapeHtml(locationLine)}</div>
      </div>
      ` : ''}
      <div class="field-item">
        <div class="field-label">Lease Date</div>
        <div class="field-value">${leaseDate || 'Not specified'}</div>
      </div>
      ${data.lease_form ? `
      <div class="field-item">
        <div class="field-label">Lease Form</div>
        <div class="field-value">${escapeHtml(data.lease_form)}</div>
      </div>
      ` : ''}
      <div class="field-item">
        <div class="field-label">Primary Term</div>
        <div class="field-value highlight">${primaryTermDisplay || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Royalty Rate</div>
        <div class="field-value highlight">${royaltyDisplay || 'Not specified'}</div>
      </div>
      ${grossAcres ? `
      <div class="field-item">
        <div class="field-label">Gross Acres</div>
        <div class="field-value">${escapeHtml(String(grossAcres))} acres</div>
      </div>
      ` : ''}
      ${data.net_mineral_acres ? `
      <div class="field-item">
        <div class="field-label">Net Mineral Acres</div>
        <div class="field-value">${escapeHtml(String(data.net_mineral_acres))} NMA</div>
      </div>
      ` : ''}
      ${bonusDisplay ? `
      <div class="field-item">
        <div class="field-label">Bonus / Consideration</div>
        <div class="field-value">${bonusDisplay}</div>
      </div>
      ` : ''}
      ${delayRental ? `
      <div class="field-item">
        <div class="field-label">Delay Rental</div>
        <div class="field-value">${escapeHtml(String(delayRental))}</div>
      </div>
      ` : ''}
      ${book ? `
      <div class="field-item">
        <div class="field-label">Book/Page</div>
        <div class="field-value mono">Book ${escapeHtml(String(book))}${page ? `, Page ${escapeHtml(String(page))}` : ''}</div>
      </div>
      ` : ''}
      ${recordingDate ? `
      <div class="field-item">
        <div class="field-label">Recording Date</div>
        <div class="field-value">${recordingDate}</div>
      </div>
      ` : ''}
    </div>

    ${tractsHtml}
  `;
}

function generatePoolingFields(data: any): string {
  const orderInfo = data.order_info || {};
  const applicant = data.applicant || {};
  const operator = data.operator || {};
  const wellInfo = data.well_info || {};
  const unitInfo = data.unit_info || data.pooled_unit || data.unit || {};
  const formations = data.formations || [];
  const electionOptions = data.election_options || data.pooling_options || [];

  // Build formation display string from formations array
  const formationNames = Array.isArray(formations)
    ? formations.map((f: any) => f.name || f.formation_name || '').filter(Boolean).join(', ')
    : '';
  const formationDisplay = formationNames || data.formation || unitInfo.formation || '';

  // Well name: check well_info first, then top-level
  const wellName = wellInfo.proposed_well_name || wellInfo.well_name || wellInfo.name || data.well_name || '';

  // Unit size: check unit_info first, then pooled_unit
  const unitSize = unitInfo.unit_size_acres || unitInfo.size || unitInfo.acres || '';

  // Cause number: extraction uses case_number
  const causeNumber = orderInfo.case_number || orderInfo.cause_number || '';

  // Applicant/Operator: try applicant name, fall back to operator name
  const applicantName = applicant.name || operator.name || '';

  return `
    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Cause Number</div>
        <div class="field-value mono">${escapeHtml(causeNumber) || 'Not specified'}</div>
      </div>
      ${orderInfo.order_date && orderInfo.effective_date && orderInfo.order_date === orderInfo.effective_date ? `
      <div class="field-item">
        <div class="field-label">Order / Effective Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date)}</div>
      </div>
      ` : `
      <div class="field-item">
        <div class="field-label">Order Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Effective Date</div>
        <div class="field-value">${formatDate(orderInfo.effective_date) || 'Not specified'}</div>
      </div>
      `}
      <div class="field-item">
        <div class="field-label">Applicant/Operator</div>
        <div class="field-value">${escapeHtml(applicantName) || 'Not specified'}</div>
      </div>
      ${wellName ? `
      <div class="field-item">
        <div class="field-label">Well Name</div>
        <div class="field-value">${escapeHtml(wellName)}</div>
      </div>
      ` : ''}
      <div class="field-item">
        <div class="field-label">Formation/Zone</div>
        <div class="field-value">${escapeHtml(formationDisplay) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Unit Size</div>
        <div class="field-value highlight">${unitSize ? escapeHtml(String(unitSize)) + ' acres' : 'Not specified'}</div>
      </div>
    </div>

    ${
      electionOptions.length > 0
        ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Election Options</div>
      <table class="data-table">
        <thead>
          <tr><th>Option</th><th>Type</th><th>Bonus/NMA</th><th>Royalty</th><th>Default</th></tr>
        </thead>
        <tbody>
          ${electionOptions
            .map(
              (opt: any, i: number) => `
            <tr ${i % 2 !== 0 ? 'class="alt"' : ''}>
              <td>${escapeHtml(opt.option_number ? `Option ${opt.option_number}` : opt.name || opt.option || `Option ${i + 1}`)}</td>
              <td>${escapeHtml(opt.option_type || opt.description || '') || '-'}</td>
              <td>${opt.bonus_per_nma ? '$' + escapeHtml(String(opt.bonus_per_nma)) : (opt.cost_per_nma ? '$' + escapeHtml(String(opt.cost_per_nma)) + ' cost' : (escapeHtml(opt.bonus) || '-'))}</td>
              <td>${escapeHtml(opt.royalty_rate || opt.royalty || '') || '-'}${opt.excess_royalty ? ' + ' + escapeHtml(opt.excess_royalty) + ' excess' : ''}</td>
              <td>${opt.is_default ? 'Yes' : ''}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
    `
        : ''
    }
  `;
}

function generateDivisionOrderFields(data: any): string {
  // Division order uses flat field names (not nested objects)
  const operatorName = data.operator_name || data.operator || '';
  const operatorAddress = data.operator_address || '';
  const operatorPhone = data.operator_phone || '';
  const operatorEmail = data.operator_email || '';

  // property_name is the well/unit name in division orders
  const propertyName = data.property_name || data.well_name || data.unit_name || '';
  const propertyNumber = data.property_number || '';

  const ownerName = data.owner_name || '';
  const ownerAddress = data.owner_address || '';
  const trusteeName = data.trustee_name || '';
  // Owner-provided contact (from signature section)
  const ownerPhone = data.owner_phone || '';
  const ownerEmail = data.owner_email || '';

  // Interest fields - extract each type separately
  const workingInterest = data.working_interest || '';
  const royaltyInterest = data.royalty_interest || '';
  const overridingRoyaltyInterest = data.overriding_royalty_interest || '';
  const netRevenueInterest = data.net_revenue_interest || '';
  const nonParticipatingRoyaltyInterest = data.non_participating_royalty_interest || '';
  const decimalInterest = data.decimal_interest || '';
  const interestType = data.interest_type || data.ownership_type || '';

  // Payment info
  const paymentMinimum = data.payment_minimum || '';

  // Effective date
  const effectiveDate = data.effective_date || '';

  // Product type and unit size
  const productType = data.product_type || '';
  const unitSizeAcres = data.unit_size_acres || '';

  // API number
  const apiNumber = data.api_number || '';

  // Unit sections
  const unitSections = data.unit_sections || [];
  const isMultiSection = data.is_multi_section_unit || unitSections.length > 1;

  // Build operator party box (with contact info for questions)
  const operatorHtml = operatorName ? `
    <div class="party-box">
      <div class="party-label">Operator (Payor)</div>
      <div class="party-name">${escapeHtml(operatorName)}</div>
      ${operatorAddress ? `<div class="party-detail">${escapeHtml(operatorAddress)}</div>` : ''}
      ${operatorPhone ? `<div class="party-detail">📞 ${escapeHtml(operatorPhone)}</div>` : ''}
      ${operatorEmail ? `<div class="party-detail">✉️ ${escapeHtml(operatorEmail)}</div>` : ''}
    </div>
  ` : '';

  // Build owner party box
  const ownerHtml = ownerName ? `
    <div class="party-box">
      <div class="party-label">Interest Owner</div>
      <div class="party-name">${escapeHtml(ownerName)}</div>
      ${trusteeName ? `<div class="party-detail">Trustee: ${escapeHtml(trusteeName)}</div>` : ''}
      ${ownerAddress ? `<div class="party-detail">${escapeHtml(ownerAddress)}</div>` : ''}
      ${ownerPhone || ownerEmail ? `<div class="party-detail" style="margin-top: 4px; font-size: 11px; color: #64748b;">Your contact (from signature):</div>` : ''}
      ${ownerPhone ? `<div class="party-detail">${escapeHtml(ownerPhone)}</div>` : ''}
      ${ownerEmail ? `<div class="party-detail">${escapeHtml(ownerEmail)}</div>` : ''}
    </div>
  ` : '';

  // Build interest fields HTML - show each type that has a value
  const interestFieldsHtml = [
    workingInterest ? `
      <div class="field-item">
        <div class="field-label">Working Interest</div>
        <div class="field-value highlight">${escapeHtml(String(workingInterest))}</div>
      </div>` : '',
    royaltyInterest ? `
      <div class="field-item">
        <div class="field-label">Royalty Interest</div>
        <div class="field-value highlight">${escapeHtml(String(royaltyInterest))}</div>
      </div>` : '',
    overridingRoyaltyInterest ? `
      <div class="field-item">
        <div class="field-label">Overriding Royalty Interest</div>
        <div class="field-value highlight">${escapeHtml(String(overridingRoyaltyInterest))}</div>
      </div>` : '',
    netRevenueInterest ? `
      <div class="field-item">
        <div class="field-label">Net Revenue Interest</div>
        <div class="field-value highlight">${escapeHtml(String(netRevenueInterest))}</div>
      </div>` : '',
    nonParticipatingRoyaltyInterest ? `
      <div class="field-item">
        <div class="field-label">Non-Participating Royalty</div>
        <div class="field-value highlight">${escapeHtml(String(nonParticipatingRoyaltyInterest))}</div>
      </div>` : '',
  ].filter(Boolean).join('');

  // If no specific interest types, fall back to decimal_interest with type label
  const fallbackInterestHtml = !interestFieldsHtml && decimalInterest ? `
    <div class="field-item">
      <div class="field-label">${interestType ? escapeHtml(interestType.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')) : 'Decimal Interest'}</div>
      <div class="field-value highlight">${escapeHtml(String(decimalInterest))}</div>
    </div>` : '';

  // Build unit sections table if multi-section
  const unitSectionsHtml = isMultiSection && unitSections.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Unit Sections & Allocation</div>
      <table class="data-table">
        <thead>
          <tr><th>Section</th><th>Location</th><th>Acres</th><th>Allocation</th></tr>
        </thead>
        <tbody>
          ${unitSections.map((sec: any, i: number) => `
            <tr ${i % 2 !== 0 ? 'class="alt"' : ''}>
              <td>${escapeHtml(String(sec.section || ''))}</td>
              <td>${escapeHtml(`${sec.township || ''}-${sec.range || ''}`)}</td>
              <td>${sec.acres ? escapeHtml(String(sec.acres)) : '-'}</td>
              <td>${sec.allocation_factor ? (Number(sec.allocation_factor) * 100).toFixed(2) + '%' : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  return `
    ${operatorHtml || ownerHtml ? `
    <div class="parties-grid" style="margin-bottom: 16px;">
      ${operatorHtml}
      ${ownerHtml}
    </div>
    ` : ''}

    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Well/Lease Name</div>
        <div class="field-value">${escapeHtml(propertyName) || 'Not specified'}</div>
      </div>
      ${propertyNumber ? `
      <div class="field-item">
        <div class="field-label">Property Number</div>
        <div class="field-value mono">${escapeHtml(propertyNumber)}</div>
      </div>
      ` : ''}
      ${apiNumber ? `
      <div class="field-item">
        <div class="field-label">API Number</div>
        <div class="field-value mono">${escapeHtml(apiNumber)}</div>
      </div>
      ` : ''}
      <div class="field-item">
        <div class="field-label">Effective Date</div>
        <div class="field-value">${formatDate(effectiveDate) || 'Not specified'}</div>
      </div>
      ${interestFieldsHtml}
      ${fallbackInterestHtml}
      ${paymentMinimum ? `
      <div class="field-item">
        <div class="field-label">Minimum Payment</div>
        <div class="field-value">$${escapeHtml(String(paymentMinimum))}</div>
      </div>
      ` : ''}
      ${productType ? `
      <div class="field-item">
        <div class="field-label">Product Type</div>
        <div class="field-value">${escapeHtml(productType)}</div>
      </div>
      ` : ''}
      ${unitSizeAcres ? `
      <div class="field-item">
        <div class="field-label">Unit Spacing</div>
        <div class="field-value">${escapeHtml(String(unitSizeAcres))} acres</div>
      </div>
      ` : ''}
    </div>

    ${unitSectionsHtml}
  `;
}

function generateSpacingFields(data: any): string {
  const orderInfo = data.order_info || {};
  const applicant = data.applicant || {};
  const units = data.units || [];

  // Extract all unique formations from all units
  const allFormations: string[] = [];
  let unitSizes: number[] = [];
  let wellTypes: string[] = [];
  let setbackParts: string[] = [];

  // Helper to extract setbacks from well_location object
  const extractSetbacks = (wellLoc: any) => {
    if (!wellLoc || typeof wellLoc !== 'object') return;
    if (typeof wellLoc.unit_boundary_setback_ft === 'number') {
      setbackParts.push(`${wellLoc.unit_boundary_setback_ft}' unit boundary`);
    }
    if (typeof wellLoc.lateral_setback_ft === 'number') {
      setbackParts.push(`${wellLoc.lateral_setback_ft}' lateral`);
    }
    if (typeof wellLoc.completion_interval_setback_ft === 'number') {
      setbackParts.push(`${wellLoc.completion_interval_setback_ft}' completion interval`);
    }
    if (typeof wellLoc.lease_line_setback_ft === 'number') {
      setbackParts.push(`${wellLoc.lease_line_setback_ft}' lease line`);
    }
  };

  units.forEach((unit: any) => {
    // Get unit size
    if (unit.unit_size_acres) {
      unitSizes.push(unit.unit_size_acres);
    }
    // Get well type
    if (unit.well_type) {
      wellTypes.push(unit.well_type);
    }
    // Get setbacks from well_location
    extractSetbacks(unit.well_location);
    // Get formations from unit
    const formations = unit.formations || [];
    formations.forEach((f: any) => {
      const name = f.name || f.formation_name || '';
      if (name && !allFormations.includes(name)) {
        allFormations.push(name);
      }
    });
  });

  // Fallback to old structure if no units array
  if (allFormations.length === 0 || unitSizes.length === 0) {
    // Check spacing_units (alternate structure)
    const spacingUnits = data.spacing_units || [];
    spacingUnits.forEach((su: any) => {
      const formations = su.formations || [];
      formations.forEach((f: any) => {
        const name = typeof f === 'string' ? f : (f.name || f.formation_name || '');
        if (name && !allFormations.includes(name)) {
          allFormations.push(name);
        }
      });
      if (su.unit_size_acres) unitSizes.push(su.unit_size_acres);
      extractSetbacks(su.well_location);
    });
    // Check top-level formation
    if (allFormations.length === 0 && data.formation) {
      allFormations.push(data.formation);
    }
    // Check top-level well_setbacks
    if (data.well_setbacks) {
      extractSetbacks(data.well_setbacks);
    }
    // Check top-level unit_size_acres
    if (unitSizes.length === 0 && data.unit_size_acres) {
      unitSizes.push(data.unit_size_acres);
    }
  }

  // Format unit size (show range if multiple different sizes)
  const uniqueSizes = [...new Set(unitSizes)].sort((a, b) => a - b);
  let unitSizeStr = '';
  if (uniqueSizes.length === 1) {
    unitSizeStr = `${uniqueSizes[0]} acres`;
  } else if (uniqueSizes.length > 1) {
    unitSizeStr = `${uniqueSizes[0]}-${uniqueSizes[uniqueSizes.length - 1]} acres`;
  }

  // Format well type
  const uniqueWellTypes = [...new Set(wellTypes)];
  const wellTypeStr = uniqueWellTypes.join(', ') || data.well_type || '';

  // Format formations as comma-separated list
  const formationsStr = allFormations.join(', ');

  // Format setbacks - dedupe and join
  const uniqueSetbacks = [...new Set(setbackParts)];
  const setbackStr = uniqueSetbacks.join('; ');

  // Get cause/order info - check both nested and top-level
  const causeNumber = orderInfo.cause_number || data.case_number || data.cause_number || '';
  const orderDate = orderInfo.order_date || data.order_date || '';
  const effectiveDate = orderInfo.effective_date || data.effective_date || '';
  const applicantName = applicant.name || data.applicant || '';

  return `
    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Cause Number</div>
        <div class="field-value mono">${escapeHtml(causeNumber) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Order Date</div>
        <div class="field-value">${formatDate(orderDate) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Applicant/Operator</div>
        <div class="field-value">${escapeHtml(applicantName) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Unit Size</div>
        <div class="field-value highlight">${escapeHtml(unitSizeStr) || 'Not specified'}</div>
      </div>
      ${
        wellTypeStr
          ? `
      <div class="field-item">
        <div class="field-label">Well Type</div>
        <div class="field-value">${escapeHtml(wellTypeStr)}</div>
      </div>
      `
          : ''
      }
      ${
        setbackStr
          ? `
      <div class="field-item">
        <div class="field-label">Setbacks</div>
        <div class="field-value">${escapeHtml(setbackStr)}</div>
      </div>
      `
          : ''
      }
      <div class="field-item full-width">
        <div class="field-label">Formations</div>
        <div class="field-value">${escapeHtml(formationsStr) || 'Not specified'}</div>
      </div>
    </div>
  `;
}

function generateLocationExceptionFields(data: any): string {
  const orderInfo = data.order_info || {};
  const applicant = data.applicant || {};
  const wellInfo = data.well_info || {};
  const lateralPath = data.lateral_path || {};
  const exceptionDetails = data.exception_details || {};

  // Get primary formation - check multiple possible locations/formats
  let formationName = '';
  // 1. Check target_formations array (new schema) - can be .name or .formation_name
  const targetFormations = data.target_formations || [];
  if (targetFormations.length > 0) {
    const primaryFormation = targetFormations.find((f: any) => f.is_primary) || targetFormations[0];
    formationName = primaryFormation?.name || primaryFormation?.formation_name || '';
  }
  // 2. Check target_formation singular (string like "Woodford (Primary)")
  if (!formationName && data.target_formation) {
    // Extract just the formation name, strip "(Primary)" suffix if present
    formationName = String(data.target_formation).replace(/\s*\(Primary\)\s*$/i, '').trim();
  }
  // 3. Check well_info.target_formation
  if (!formationName && wellInfo.target_formation) {
    formationName = String(wellInfo.target_formation).replace(/\s*\(Primary\)\s*$/i, '').trim();
  }
  // 4. Fallback to generic formation field
  if (!formationName) {
    formationName = data.formation || wellInfo.formation || '';
  }

  // Get well name from well_info or top-level
  const wellName = wellInfo.well_name || data.well_name || '';

  // Get unit size from well_info
  const unitSize = wellInfo.spacing_unit_acres || data.unit_size_acres || data.spacing_unit_acres || '';

  // Get exception reason
  const exceptionReason = exceptionDetails.exception_reason || data.exception_reason || '';

  // Get granted setback (only if it's a real number)
  const grantedSetback = exceptionDetails.granted_setback_ft;
  const hasGrantedSetback = grantedSetback !== null && grantedSetback !== undefined && !isNaN(Number(grantedSetback));

  // Format surface location from lateral_path
  const surfaceLocation = lateralPath.surface_location;
  const surfaceLocationStr = surfaceLocation
    ? `S${surfaceLocation.section}-T${surfaceLocation.township}-R${surfaceLocation.range}` +
      (surfaceLocation.footage_fnl || surfaceLocation.footage_fsl
        ? ` (${surfaceLocation.footage_fnl ? surfaceLocation.footage_fnl + ' FNL' : ''}${surfaceLocation.footage_fsl ? surfaceLocation.footage_fsl + ' FSL' : ''}, ${surfaceLocation.footage_fel ? surfaceLocation.footage_fel + ' FEL' : ''}${surfaceLocation.footage_fwl ? surfaceLocation.footage_fwl + ' FWL' : ''})`
        : '')
    : '';

  return `
    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Cause Number</div>
        <div class="field-value mono">${escapeHtml(orderInfo.cause_number) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Order Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Applicant/Operator</div>
        <div class="field-value">${escapeHtml(applicant.name || wellInfo.operator) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Well Name</div>
        <div class="field-value">${escapeHtml(wellName) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Target Formation (Primary)</div>
        <div class="field-value">${escapeHtml(formationName) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Unit Size</div>
        <div class="field-value highlight">${unitSize ? escapeHtml(String(unitSize)) + ' acres' : 'Not specified'}</div>
      </div>
      ${
        surfaceLocationStr
          ? `
      <div class="field-item full-width">
        <div class="field-label">Surface Location</div>
        <div class="field-value">${escapeHtml(surfaceLocationStr)}</div>
      </div>
      `
          : ''
      }
      ${
        hasGrantedSetback
          ? `
      <div class="field-item">
        <div class="field-label">Granted Setback</div>
        <div class="field-value highlight">${escapeHtml(String(grantedSetback))} ft</div>
      </div>
      `
          : ''
      }
      ${
        exceptionReason
          ? `
      <div class="field-item full-width">
        <div class="field-label">Exception Reason</div>
        <div class="field-value">${escapeHtml(exceptionReason)}</div>
      </div>
      `
          : ''
      }
    </div>
  `;
}

function generateIncreasedDensityFields(data: any): string {
  const orderInfo = data.order_info || {};
  const applicant = data.applicant || {};
  const unitInfo = data.unit_info || {};
  const wellAuth = data.well_authorization || {};
  const targetFormations = data.target_formations || [];

  // Formation: try nested target_formations first, fall back to flat field
  const formation = targetFormations.length > 0
    ? targetFormations.map((f: any) => f.name || f).filter(Boolean).join(', ')
    : (data.formation || '');

  // Wells allowed: try nested well_authorization first, fall back to flat fields
  const wellsAllowed = wellAuth.additional_wells_authorized
    || data.wells_allowed || data.additional_wells || '';

  // Unit size: try nested unit_info first, fall back to flat field
  const unitSize = unitInfo.unit_size_acres || data.unit_size_acres || data.unit_size || '';

  // Well name from well_authorization
  const wellName = wellAuth.well_name || '';

  return `
    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Cause Number</div>
        <div class="field-value mono">${escapeHtml(orderInfo.cause_number) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Order Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Effective Date</div>
        <div class="field-value">${formatDate(orderInfo.effective_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Applicant/Operator</div>
        <div class="field-value">${escapeHtml(applicant.name) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Formation/Zone</div>
        <div class="field-value">${escapeHtml(formation) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Wells Allowed</div>
        <div class="field-value highlight">${escapeHtml(String(wellsAllowed)) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Unit Size</div>
        <div class="field-value">${unitSize ? escapeHtml(String(unitSize)) + ' acres' : 'Not specified'}</div>
      </div>
      ${wellName ? `
      <div class="field-item">
        <div class="field-label">Well Name</div>
        <div class="field-value">${escapeHtml(wellName)}</div>
      </div>
      ` : ''}
    </div>
  `;
}

function generateCompletionReportFields(data: any): string {
  const wellInfo = data.well_info || data.well || {};
  const surfaceLocation = data.surface_location || {};
  const completion = data.completion || {};
  const production = data.production || data.initial_production || {};
  const formationZones = data.formation_zones || [];

  // Extract operator name - handle both object and string formats
  const operatorName = typeof data.operator === 'object'
    ? (data.operator?.name || '')
    : (data.operator || wellInfo.operator || '');

  // Extract well type - handle object format with drill_type, well_class, completion_type
  let wellTypeDisplay = '';
  if (typeof data.well_type === 'object') {
    // Schema uses: drill_type (VERTICAL HOLE), well_class (OIL/GAS), completion_type
    const drillType = data.well_type?.drill_type || '';
    const wellClass = data.well_type?.well_class || '';
    const completionType = data.well_type?.completion_type || '';
    // Build display: "OIL - VERTICAL HOLE" or "GAS - Commingled"
    const parts = [wellClass, drillType].filter(Boolean);
    wellTypeDisplay = parts.join(' - ');
    if (completionType && completionType !== 'Single Zone') {
      wellTypeDisplay += completionType ? ` (${completionType})` : '';
    }
  } else {
    wellTypeDisplay = data.well_type || '';
  }

  // Extract completion date - check multiple locations (extractor may nest in dates object)
  const dates = data.dates || {};
  const completionDate = data.completion_date || dates.completion_date || completion.date ||
    (production.test_date ? production.test_date : '');

  // Extract formation - check formation_zones array first, then fallback
  let formationDisplay = '';
  if (formationZones.length > 0) {
    formationDisplay = formationZones.map((fz: any) => fz.formation_name || fz.name || '').filter(Boolean).join(', ');
  }
  if (!formationDisplay) {
    formationDisplay = completion.formation || data.formation || '';
  }

  // Extract total depth - check surface_location (per schema), then fallback
  const totalDepth = surfaceLocation.total_depth_ft || data.total_depth_ft || data.total_depth || '';

  // Extract initial production - handle nested structure
  const oilProd = production.oil_bbl_per_day || production.oil || '';
  const gasProd = production.gas_mcf_per_day || production.gas || '';

  return `
    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Well Name</div>
        <div class="field-value">${escapeHtml(data.well_name || wellInfo.name) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">API Number</div>
        <div class="field-value mono">${escapeHtml(data.api_number_normalized || data.api_number || wellInfo.api_number) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Operator</div>
        <div class="field-value">${escapeHtml(operatorName) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Completion Date</div>
        <div class="field-value">${formatDate(completionDate) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Formation</div>
        <div class="field-value">${escapeHtml(formationDisplay) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Total Depth</div>
        <div class="field-value">${totalDepth ? escapeHtml(String(totalDepth)) + ' ft' : 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Well Type</div>
        <div class="field-value">${escapeHtml(wellTypeDisplay) || 'Not specified'}</div>
      </div>
      ${oilProd ? `
      <div class="field-item">
        <div class="field-label">Initial Production (Oil)</div>
        <div class="field-value highlight">${escapeHtml(String(oilProd))} BOPD</div>
      </div>
      ` : ''}${gasProd ? `
      <div class="field-item">
        <div class="field-label">Initial Production (Gas)</div>
        <div class="field-value highlight">${escapeHtml(String(gasProd))} MCFD</div>
      </div>
      ` : ''}
    </div>
  `;
}

function generateCorrespondenceFields(data: any): string {
  // For correspondence, we only show: from, sender (if different), to, date
  // Everything else goes in the analysis
  const from = data.from || {};
  const sender = data.sender || {};
  const to = data.to || {};
  const date = data.date || '';

  // Extract names from objects
  const fromName = typeof from === 'object' ? (from.name || from.company || '') : String(from);
  const fromAddress = typeof from === 'object' ? from.address : '';
  const fromPhone = typeof from === 'object' ? from.phone : '';

  const senderName = typeof sender === 'object' ? sender.name : String(sender || '');
  const senderTitle = typeof sender === 'object' ? sender.title : '';
  const senderEmail = typeof sender === 'object' ? sender.email : '';

  const toName = typeof to === 'object' ? (to.name || to.company || '') : String(to);
  const toAddress = typeof to === 'object' ? to.address : '';

  // Build from party box
  const fromHtml = fromName ? `
    <div class="party-box">
      <div class="party-label">From</div>
      <div class="party-name">${escapeHtml(fromName)}</div>
      ${fromAddress ? `<div class="party-detail">${escapeHtml(fromAddress)}</div>` : ''}
      ${fromPhone ? `<div class="party-detail">${escapeHtml(fromPhone)}</div>` : ''}
    </div>
  ` : '';

  // Build to party box
  const toHtml = toName ? `
    <div class="party-box">
      <div class="party-label">To</div>
      <div class="party-name">${escapeHtml(toName)}</div>
      ${toAddress ? `<div class="party-detail">${escapeHtml(toAddress)}</div>` : ''}
    </div>
  ` : '';

  // Build sender info (if different from company)
  const senderHtml = senderName && senderName !== fromName ? `
    <div class="field-item">
      <div class="field-label">Contact Person</div>
      <div class="field-value">${escapeHtml(senderName)}${senderTitle ? ` (${escapeHtml(senderTitle)})` : ''}</div>
      ${senderEmail ? `<div style="font-size: 12px; color: #64748b; margin-top: 2px;">${escapeHtml(senderEmail)}</div>` : ''}
    </div>
  ` : '';

  return `
    ${fromHtml || toHtml ? `
    <div class="parties-grid" style="margin-bottom: 16px;">
      ${fromHtml}
      ${toHtml}
    </div>
    ` : ''}

    <div class="field-grid">
      ${date ? `
      <div class="field-item">
        <div class="field-label">Date</div>
        <div class="field-value">${formatDate(date)}</div>
      </div>
      ` : ''}
      ${senderHtml}
    </div>

    <div style="margin-top: 12px; padding: 12px 16px; background: #fff; border-left: 4px solid #16a34a; border-radius: 0;">
      <div style="font-size: 13px; color: #1e293b;">See the <strong>Detailed Analysis</strong> above for the full content and any action items.</div>
    </div>
  `;
}

function generateDrillingPermitFields(data: any): string {
  // Combined well name + number
  const wellName = data.well_name || '';
  const wellNumber = data.well_number || '';
  const fullWellName = [wellName, wellNumber].filter(Boolean).join(' ');

  // Combined operator
  const operatorName = data.operator_name || '';
  const operatorAddress = data.operator_address || '';

  // Location line
  const section = data.section;
  const township = data.township;
  const range = data.range;
  const county = data.county || '';
  const locationParts: string[] = [];
  if (section || township || range) {
    let trs = '';
    if (section) trs += `S${section}`;
    if (township) trs += (trs ? '-' : '') + `T${township}`;
    if (range) trs += (trs ? '-' : '') + `R${range}`;
    locationParts.push(trs);
  }
  if (county) locationParts.push(`${county} County`);
  const locationLine = locationParts.join(', ');

  // Surface location
  const surface = data.surface_location || {};
  const surfaceParts: string[] = [];
  if (surface.quarters) surfaceParts.push(surface.quarters);
  if (surface.footage_ns || surface.footage_ew) {
    const footages = [surface.footage_ns, surface.footage_ew].filter(Boolean).join(', ');
    surfaceParts.push(footages);
  }
  if (surface.latitude && surface.longitude) {
    surfaceParts.push(`${surface.latitude}, ${surface.longitude}`);
  }
  const surfaceLine = surfaceParts.join(' — ');

  // Well type: check well_type field first, then target_formation if it looks like a well type
  const gasOilTypes = ['gas', 'oil', 'oil & gas', 'oil and gas', 'injection', 'disposal', 'swi', 'swd'];
  let wellType = data.well_type || '';
  let targetFormation = data.target_formation || '';
  // If target_formation is actually a well type (e.g., "GAS"), move it
  if (targetFormation && gasOilTypes.includes(targetFormation.toLowerCase()) && !wellType) {
    wellType = targetFormation;
    targetFormation = '';
  }

  return `
    <div class="field-grid">
      ${fullWellName ? `
      <div class="field-item">
        <div class="field-label">Well</div>
        <div class="field-value" style="font-weight: 600; font-size: 15px;">${escapeHtml(fullWellName)}</div>
      </div>
      ` : ''}
      ${data.api_number ? `
      <div class="field-item">
        <div class="field-label">API Number</div>
        <div class="field-value mono">${escapeHtml(data.api_number)}</div>
      </div>
      ` : ''}
      ${locationLine ? `
      <div class="field-item">
        <div class="field-label">Location</div>
        <div class="field-value">${escapeHtml(locationLine)}</div>
      </div>
      ` : ''}
      ${data.permit_type ? `
      <div class="field-item">
        <div class="field-label">Permit Type</div>
        <div class="field-value">${escapeHtml(data.permit_type)}</div>
      </div>
      ` : ''}
      ${wellType ? `
      <div class="field-item">
        <div class="field-label">Well Type</div>
        <div class="field-value">${escapeHtml(wellType)}</div>
      </div>
      ` : ''}
      ${targetFormation ? `
      <div class="field-item">
        <div class="field-label">Target Formation</div>
        <div class="field-value">${escapeHtml(targetFormation)}</div>
      </div>
      ` : ''}
      ${data.issue_date ? `
      <div class="field-item">
        <div class="field-label">Issue Date</div>
        <div class="field-value">${formatDate(data.issue_date)}</div>
      </div>
      ` : ''}
      ${data.expiration_date ? `
      <div class="field-item">
        <div class="field-label">Expiration Date</div>
        <div class="field-value">${formatDate(data.expiration_date)}</div>
      </div>
      ` : ''}
      ${data.unit_size_acres ? `
      <div class="field-item">
        <div class="field-label">Unit Size</div>
        <div class="field-value">${data.unit_size_acres} acres</div>
      </div>
      ` : ''}
      ${data.spacing_order ? `
      <div class="field-item">
        <div class="field-label">Spacing Order</div>
        <div class="field-value mono">${escapeHtml(data.spacing_order)}</div>
      </div>
      ` : ''}
      ${data.target_depth_top || data.target_depth_bottom ? `
      <div class="field-item">
        <div class="field-label">Target Depth</div>
        <div class="field-value">${data.target_depth_top ? escapeHtml(String(data.target_depth_top)) : '?'} — ${data.target_depth_bottom ? escapeHtml(String(data.target_depth_bottom)) : '?'} ft</div>
      </div>
      ` : ''}
    </div>

    ${operatorName ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 6px;">Operator</div>
      <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 12px;">
        <div style="font-weight: 600; color: #1E40AF; font-size: 15px;">${escapeHtml(operatorName)}</div>
        ${operatorAddress ? `<div style="font-size: 13px; color: #6B7280; margin-top: 4px;">${escapeHtml(operatorAddress)}</div>` : ''}
      </div>
    </div>
    ` : ''}

    ${surfaceLine ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 6px;">Surface Location</div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px;">
        ${escapeHtml(surfaceLine)}
      </div>
    </div>
    ` : ''}
  `;
}

function generateAssignmentFields(data: any): string {
  const assignor = data.assignor || {};
  const assignee = data.assignee || {};
  const underlyingLease = data.underlying_lease || {};
  const recording = data.recording || {};
  const reservation = data.reservation || {};
  const tracts = data.tracts || [];

  // Assignor name
  const assignorName = assignor.name || 'Not specified';
  // Assignee name with capacity
  let assigneeName = assignee.name || 'Not specified';
  if (assignee.capacity) assigneeName += ` (${assignee.capacity})`;

  // Recording info
  const book = recording.book || '';
  const page = recording.page || '';
  const instrumentNo = recording.instrument_number || '';

  // Build tracts display (reuses deed pattern)
  const tractsHtml = tracts.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Property Description</div>
      ${tracts.map((tract: any, i: number) => {
        const legal = tract.legal || tract.legal_description || {};
        const interest = tract.interest || {};
        const section = legal.section || '';
        const township = legal.township || '';
        const range = legal.range || '';
        const county = legal.county || '';
        const quarters = legal.quarter_calls?.join(', ') || legal.quarters || '';
        const interestType = interest.type || '';
        const interestDesc = interest.description || '';

        return `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; ${i > 0 ? 'margin-top: 8px;' : ''}">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px;">
              ${section && township && range ? `Section ${escapeHtml(String(section))}-${escapeHtml(township)}-${escapeHtml(range)}` : 'Tract ' + (i + 1)}
              ${county ? `, ${escapeHtml(county)} County` : ''}
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 13px;">
              ${quarters ? `<div><span style="color: #64748b;">Quarter:</span> ${escapeHtml(quarters)}</div>` : ''}
              ${interestType ? `<div><span style="color: #64748b;">Interest Type:</span> ${escapeHtml(interestType.replace(/_/g, ' '))}</div>` : ''}
            </div>
            ${interestDesc ? `<div style="font-size: 12px; color: #475569; margin-top: 6px;">${escapeHtml(interestDesc)}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  // Reservation section
  const reservationHtml = reservation.type ? `
    <div style="margin-top: 16px; background: #fefce8; border: 1px solid #facc15; border-radius: 6px; padding: 12px;">
      <div class="field-label" style="margin-bottom: 6px;">Reserved Interest</div>
      <div style="font-weight: 600; color: #854d0e; font-size: 14px;">
        ${escapeHtml(reservation.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()))}
        ${reservation.fraction_text ? ` — ${escapeHtml(reservation.fraction_text)}` : ''}
        ${reservation.fraction_decimal ? ` (${(reservation.fraction_decimal * 100).toFixed(4).replace(/\.?0+$/, '')}%)` : ''}
      </div>
      ${reservation.description ? `<div style="font-size: 12px; color: #713f12; margin-top: 6px;">${escapeHtml(reservation.description)}</div>` : ''}
    </div>
  ` : '';

  // Underlying lease section
  const leaseHtml = underlyingLease.lessor || underlyingLease.lessee ? `
    <div style="margin-top: 16px; background: #f0f9ff; border: 1px solid #93c5fd; border-radius: 6px; padding: 12px;">
      <div class="field-label" style="margin-bottom: 6px;">Underlying Lease</div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 13px;">
        ${underlyingLease.lessor ? `<div><span style="color: #64748b;">Lessor:</span> ${escapeHtml(underlyingLease.lessor)}</div>` : ''}
        ${underlyingLease.lessee ? `<div><span style="color: #64748b;">Lessee:</span> ${escapeHtml(underlyingLease.lessee)}</div>` : ''}
        ${underlyingLease.lease_date ? `<div><span style="color: #64748b;">Lease Date:</span> ${formatDate(underlyingLease.lease_date)}</div>` : ''}
        ${underlyingLease.recording_book ? `<div><span style="color: #64748b;">Recorded:</span> Book ${escapeHtml(underlyingLease.recording_book)}${underlyingLease.recording_page ? `, Page ${escapeHtml(underlyingLease.recording_page)}` : ''}</div>` : ''}
      </div>
    </div>
  ` : '';

  return `
    <div class="parties-grid">
      <div class="party-box">
        <div class="party-label">Assignor</div>
        <div class="party-name">${escapeHtml(assignorName)}</div>
        ${assignor.address ? `<div class="party-detail">${escapeHtml(assignor.address)}</div>` : ''}
      </div>
      <div class="party-box">
        <div class="party-label">Assignee</div>
        <div class="party-name">${escapeHtml(assigneeName)}</div>
        ${assignee.address ? `<div class="party-detail">${escapeHtml(assignee.address)}</div>` : ''}
      </div>
    </div>

    <div class="field-grid" style="margin-top: 16px;">
      <div class="field-item">
        <div class="field-label">Execution Date</div>
        <div class="field-value">${formatDate(data.execution_date) || 'Not specified'}</div>
      </div>
      ${book ? `
      <div class="field-item">
        <div class="field-label">Book/Page</div>
        <div class="field-value mono">Book ${escapeHtml(book)}${page ? `, Page ${escapeHtml(page)}` : ''}</div>
      </div>
      ` : ''}
      ${instrumentNo ? `
      <div class="field-item">
        <div class="field-label">Instrument #</div>
        <div class="field-value mono">${escapeHtml(instrumentNo)}</div>
      </div>
      ` : ''}
      ${data.consideration ? `
      <div class="field-item">
        <div class="field-label">Consideration</div>
        <div class="field-value">${escapeHtml(data.consideration)}</div>
      </div>
      ` : ''}
    </div>

    ${tractsHtml}
    ${reservationHtml}
    ${leaseHtml}
  `;
}

function generateMultiUnitHorizontalFields(data: any): string {
  const orderInfo = data.order_info || {};
  const wellAuth = data.well_authorization || {};
  const wellLoc = data.well_location || {};
  const applicant = data.applicant || {};
  const targetFormations = data.target_formations || [];
  const allocations = data.allocation_factors || [];
  const causeNumber = orderInfo.cause_number || orderInfo.case_number || '';

  // Well name and type
  const wellName = wellAuth.well_name || '';
  const wellType = wellAuth.well_classification || wellAuth.well_type || '';

  // Location line
  const locationParts: string[] = [];
  if (data.section || data.township || data.range) {
    let trs = '';
    if (data.section) trs += `S${data.section}`;
    if (data.township) trs += (trs ? '-' : '') + `T${data.township}`;
    if (data.range) trs += (trs ? '-' : '') + `R${data.range}`;
    locationParts.push(trs);
  }
  if (data.county) locationParts.push(`${data.county} County`);
  const locationLine = locationParts.join(', ');

  // Allocation table
  const allocationHtml = allocations.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Production Allocation by Section</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #1e3a5f; color: white;">
            <th style="padding: 8px 12px; text-align: left;">Section</th>
            <th style="padding: 8px 12px; text-align: right;">Lateral (ft)</th>
            <th style="padding: 8px 12px; text-align: right;">Allocation</th>
            <th style="padding: 8px 12px; text-align: left;">Role</th>
          </tr>
        </thead>
        <tbody>
          ${allocations.map((a: any, i: number) => {
            const trs = `S${a.section || '?'}-T${a.township || '?'}-R${a.range || '?'}`;
            const roles: string[] = [];
            if (a.is_surface_location) roles.push('Surface');
            if (a.is_target_section) roles.push('Target');
            return `
              <tr style="background: ${i % 2 === 0 ? '#f8fafc' : 'white'}; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 12px; font-weight: 500;">${escapeHtml(trs)}</td>
                <td style="padding: 8px 12px; text-align: right;">${a.completion_interval_length_ft ? a.completion_interval_length_ft.toLocaleString() : '—'}</td>
                <td style="padding: 8px 12px; text-align: right; font-weight: 600; color: #1e40af;">${a.allocation_percentage ? a.allocation_percentage.toFixed(2) + '%' : '—'}</td>
                <td style="padding: 8px 12px; font-size: 12px; color: #6B7280;">${roles.join(', ') || '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  // Well path summary
  const surfaceLoc = wellLoc.surface_location || {};
  const firstPerf = wellLoc.first_perforation || {};
  const lastPerf = wellLoc.last_perforation || {};
  const wellPathHtml = (surfaceLoc.section || firstPerf.section || lastPerf.section) ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Well Path</div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        ${surfaceLoc.section ? `
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 10px; text-align: center;">
          <div style="font-size: 11px; color: #6B7280; text-transform: uppercase;">Surface</div>
          <div style="font-weight: 600; color: #166534;">S${surfaceLoc.section}-T${surfaceLoc.township}-R${surfaceLoc.range}</div>
          <div style="font-size: 11px; color: #6B7280; margin-top: 4px;">${escapeHtml(surfaceLoc.footage_ns || '')} ${escapeHtml(surfaceLoc.footage_ew || '')}</div>
        </div>
        ` : ''}
        ${firstPerf.section ? `
        <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 6px; padding: 10px; text-align: center;">
          <div style="font-size: 11px; color: #6B7280; text-transform: uppercase;">First Perf</div>
          <div style="font-weight: 600; color: #1e40af;">S${firstPerf.section}-T${firstPerf.township}-R${firstPerf.range}</div>
          <div style="font-size: 11px; color: #6B7280; margin-top: 4px;">${firstPerf.measured_depth_ft ? firstPerf.measured_depth_ft.toLocaleString() + ' ft MD' : ''}</div>
        </div>
        ` : ''}
        ${lastPerf.section ? `
        <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; padding: 10px; text-align: center;">
          <div style="font-size: 11px; color: #6B7280; text-transform: uppercase;">Last Perf</div>
          <div style="font-weight: 600; color: #991b1b;">S${lastPerf.section}-T${lastPerf.township}-R${lastPerf.range}</div>
          <div style="font-size: 11px; color: #6B7280; margin-top: 4px;">${lastPerf.measured_depth_ft ? lastPerf.measured_depth_ft.toLocaleString() + ' ft MD' : ''}</div>
        </div>
        ` : ''}
      </div>
      <div style="display: flex; gap: 16px; margin-top: 8px; font-size: 13px; color: #374151;">
        ${wellLoc.lateral_total_length_ft ? `<span><strong>Total Lateral:</strong> ${wellLoc.lateral_total_length_ft.toLocaleString()} ft</span>` : ''}
        ${wellLoc.total_measured_depth_ft ? `<span><strong>Total MD:</strong> ${wellLoc.total_measured_depth_ft.toLocaleString()} ft</span>` : ''}
      </div>
    </div>
  ` : '';

  // Target formations
  const formationsHtml = targetFormations.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Target Formations</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        ${targetFormations.map((f: any) => {
          const name = typeof f === 'string' ? f : f.name || '';
          const depth = f.depth_range ? `${f.depth_range.top_ft?.toLocaleString() || '?'} — ${f.depth_range.bottom_ft?.toLocaleString() || '?'} ft` : '';
          return `<span style="background: #DBEAFE; color: #1E40AF; padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 500;">${escapeHtml(name)}${depth ? ` (${depth})` : ''}</span>`;
        }).join('')}
      </div>
    </div>
  ` : '';

  return `
    ${wellName ? `
    <div style="text-align: center; margin-bottom: 16px;">
      <div style="font-size: 1.3rem; font-weight: 700; color: #1e293b;">${escapeHtml(wellName)}</div>
      <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
        ${wellType ? escapeHtml(wellType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())) + ' Well' : ''}
        ${wellAuth.api_number ? ` — API: ${escapeHtml(wellAuth.api_number)}` : ''}
      </div>
    </div>
    ` : ''}

    <div class="field-grid">
      ${causeNumber ? `
      <div class="field-item">
        <div class="field-label">Cause Number</div>
        <div class="field-value mono">${escapeHtml(causeNumber)}</div>
      </div>
      ` : ''}
      ${orderInfo.order_number ? `
      <div class="field-item">
        <div class="field-label">Order Number</div>
        <div class="field-value mono">${escapeHtml(orderInfo.order_number)}</div>
      </div>
      ` : ''}
      ${orderInfo.order_date && orderInfo.order_date === (orderInfo as any).effective_date ? `
      <div class="field-item">
        <div class="field-label">Order / Effective Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date)}</div>
      </div>
      ` : `
      ${orderInfo.order_date ? `
      <div class="field-item">
        <div class="field-label">Order Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date)}</div>
      </div>
      ` : ''}
      `}
      ${locationLine ? `
      <div class="field-item">
        <div class="field-label">Surface Location</div>
        <div class="field-value">${escapeHtml(locationLine)}</div>
      </div>
      ` : ''}
      ${applicant.name ? `
      <div class="field-item">
        <div class="field-label">Operator</div>
        <div class="field-value">${escapeHtml(applicant.name)}</div>
      </div>
      ` : ''}
    </div>

    ${allocationHtml}
    ${wellPathHtml}
    ${formationsHtml}
  `;
}

function generateChangeOfOperatorFields(data: any): string {
  const orderInfo = data.order_info || {};
  const formerOp = data.former_operator || {};
  const newOp = data.new_operator || {};
  const affectedWells = data.affected_wells || [];
  const targetFormations = data.target_formations || [];
  const modifiedOrders = data.modified_orders || [];
  const causeNumber = orderInfo.cause_number || orderInfo.case_number || '';

  // Former/New operator party boxes
  const formerAddress = [formerOp.address, formerOp.city, formerOp.state, formerOp.zip].filter(Boolean).join(', ');
  const newAddress = [newOp.address, newOp.city, newOp.state, newOp.zip].filter(Boolean).join(', ');

  // Affected wells list
  const wellsHtml = affectedWells.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Affected Wells</div>
      ${affectedWells.map((w: any) => `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 6px;">
          <div style="font-weight: 600; color: #1e293b;">${escapeHtml(w.well_name || 'Unknown')}</div>
          <div style="display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; margin-top: 4px;">
            ${w.api_number ? `<span style="color: #64748b;">API: <strong>${escapeHtml(w.api_number)}</strong></span>` : ''}
            ${w.well_type ? `<span style="color: #64748b;">Type: ${escapeHtml(w.well_type)}</span>` : ''}
            ${w.status ? `<span style="color: #64748b;">Status: ${escapeHtml(w.status)}</span>` : ''}
          </div>
          ${w.producing_formations && w.producing_formations.length > 0 ? `<div style="font-size: 12px; color: #6B7280; margin-top: 4px;">Producing: ${escapeHtml(w.producing_formations.join(', '))}</div>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  // Target formations
  const formationsHtml = targetFormations.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Target Formations</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        ${targetFormations.map((f: any) => `<span style="background: #DBEAFE; color: #1E40AF; padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 500;">${escapeHtml(typeof f === 'string' ? f : f.name || '')}</span>`).join('')}
      </div>
    </div>
  ` : '';

  // Modified orders
  const modOrdersHtml = modifiedOrders.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Modified Orders</div>
      ${modifiedOrders.map((o: any) => `
        <div style="background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 6px; padding: 10px; margin-bottom: 6px; font-size: 13px;">
          <div style="font-weight: 600; color: #92400E;">Order #${escapeHtml(o.order_number || '')} ${o.order_type ? `(${escapeHtml(o.order_type)})` : ''} ${o.order_date ? `— ${escapeHtml(o.order_date)}` : ''}</div>
          ${o.modifications_made && o.modifications_made.length > 0 ? `<ul style="margin: 6px 0 0 16px; padding: 0; color: #78350F;">
            ${o.modifications_made.map((m: string) => `<li>${escapeHtml(m)}</li>`).join('')}
          </ul>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="parties-grid">
      <div class="party-box">
        <div class="party-label">Former Operator</div>
        <div class="party-name">${escapeHtml(formerOp.name || 'Not specified')}</div>
        ${formerOp.otc_operator_number ? `<div class="party-detail">OTC #${escapeHtml(formerOp.otc_operator_number)}</div>` : ''}
        ${formerAddress ? `<div class="party-detail">${escapeHtml(formerAddress)}</div>` : ''}
      </div>
      <div class="party-box">
        <div class="party-label">New Operator</div>
        <div class="party-name">${escapeHtml(newOp.name || 'Not specified')}</div>
        ${newOp.otc_operator_number ? `<div class="party-detail">OTC #${escapeHtml(newOp.otc_operator_number)}</div>` : ''}
        ${newAddress ? `<div class="party-detail">${escapeHtml(newAddress)}</div>` : ''}
        ${newOp.wells_currently_operated ? `<div class="party-detail">${newOp.wells_currently_operated} wells operated</div>` : ''}
      </div>
    </div>

    <div class="field-grid" style="margin-top: 16px;">
      ${causeNumber ? `
      <div class="field-item">
        <div class="field-label">Cause Number</div>
        <div class="field-value mono">${escapeHtml(causeNumber)}</div>
      </div>
      ` : ''}
      ${orderInfo.order_number ? `
      <div class="field-item">
        <div class="field-label">Order Number</div>
        <div class="field-value mono">${escapeHtml(orderInfo.order_number)}</div>
      </div>
      ` : ''}
      ${orderInfo.order_date && orderInfo.effective_date && orderInfo.order_date === orderInfo.effective_date ? `
      <div class="field-item">
        <div class="field-label">Order / Effective Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date)}</div>
      </div>
      ` : `
      ${orderInfo.order_date ? `
      <div class="field-item">
        <div class="field-label">Order Date</div>
        <div class="field-value">${formatDate(orderInfo.order_date)}</div>
      </div>
      ` : ''}
      ${orderInfo.effective_date ? `
      <div class="field-item">
        <div class="field-label">Effective Date</div>
        <div class="field-value">${formatDate(orderInfo.effective_date)}</div>
      </div>
      ` : ''}
      `}
      ${data.section ? `
      <div class="field-item">
        <div class="field-label">Location</div>
        <div class="field-value">S${data.section}-T${data.township}-R${data.range}${data.county ? `, ${escapeHtml(data.county)} County` : ''}</div>
      </div>
      ` : ''}
    </div>

    ${wellsHtml}
    ${formationsHtml}
    ${modOrdersHtml}
  `;
}

function generateDeathCertificateFields(data: any): string {
  const decedent = data.decedent || {};
  const residence = data.residence_at_death || {};
  const parents = data.parents || {};
  const marital = data.marital_status || {};
  const chainOfTitle = data.chain_of_title || {};
  const familyMembers = data.family_members || [];
  const causeOfDeath = data.cause_of_death || {};
  const disposition = data.disposition || {};
  const certInfo = data.certificate_info || {};

  // Residence line
  const residenceParts = [residence.street_address, residence.city, residence.state, residence.zip_code].filter(Boolean);
  const residenceLine = residenceParts.join(', ');

  // Name variations for chain of title
  const nameVariations = chainOfTitle.name_variations || [];
  const children = chainOfTitle.children_names || [];

  // Family members display
  const familyHtml = familyMembers.length > 0 ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Family Members Identified</div>
      ${familyMembers.map((m: any) => `
        <div style="display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px;">
          <strong>${escapeHtml(m.name || '')}</strong>
          ${m.relationship ? `<span style="color: #6B7280;">(${escapeHtml(m.relationship)})</span>` : ''}
          ${m.role_on_certificate ? `<span style="background: #E0E7FF; color: #3730A3; font-size: 11px; padding: 1px 6px; border-radius: 3px;">${escapeHtml(m.role_on_certificate)}</span>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  // Chain of title section (important for mineral rights)
  const chainHtml = (nameVariations.length > 0 || children.length > 0) ? `
    <div style="margin-top: 16px; background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 6px; padding: 14px;">
      <div class="field-label" style="margin-bottom: 8px; color: #92400E;">Chain of Title Information</div>
      ${nameVariations.length > 0 ? `
        <div style="margin-bottom: 8px;">
          <div style="font-size: 12px; color: #78350F; font-weight: 600; margin-bottom: 4px;">Name Variations (check mineral records under):</div>
          <div style="font-size: 13px; color: #451A03;">${nameVariations.map((n: string) => escapeHtml(n)).join(' &bull; ')}</div>
        </div>
      ` : ''}
      ${children.length > 0 ? `
        <div>
          <div style="font-size: 12px; color: #78350F; font-weight: 600; margin-bottom: 4px;">Children Identified:</div>
          <div style="font-size: 13px; color: #451A03;">${children.map((n: string) => escapeHtml(n)).join(', ')}</div>
        </div>
      ` : ''}
      ${chainOfTitle.has_surviving_spouse === false ? `
        <div style="font-size: 12px; color: #78350F; margin-top: 6px;">No surviving spouse</div>
      ` : chainOfTitle.surviving_spouse_name ? `
        <div style="font-size: 12px; color: #78350F; margin-top: 6px;">Surviving Spouse: <strong>${escapeHtml(chainOfTitle.surviving_spouse_name)}</strong></div>
      ` : ''}
      ${chainOfTitle.domicile_county ? `
        <div style="font-size: 12px; color: #78350F; margin-top: 4px;">Domicile: ${escapeHtml(chainOfTitle.domicile_county)} County, ${escapeHtml(chainOfTitle.domicile_state || '')}</div>
      ` : ''}
    </div>
  ` : '';

  return `
    <div style="text-align: center; margin-bottom: 16px;">
      <div style="font-size: 1.4rem; font-weight: 700; color: #1e293b;">${escapeHtml(decedent.full_name || 'Unknown')}</div>
      ${decedent.date_of_birth || decedent.date_of_death ? `
        <div style="font-size: 14px; color: #64748b; margin-top: 4px;">
          ${decedent.date_of_birth ? formatDate(decedent.date_of_birth) : '?'} — ${decedent.date_of_death ? formatDate(decedent.date_of_death) : '?'}
          ${decedent.age_at_death_years ? ` (age ${decedent.age_at_death_years})` : ''}
        </div>
      ` : ''}
    </div>

    <div class="field-grid">
      ${residenceLine ? `
      <div class="field-item full-width">
        <div class="field-label">Residence at Death</div>
        <div class="field-value">${escapeHtml(residenceLine)}</div>
      </div>
      ` : ''}
      ${marital.status ? `
      <div class="field-item">
        <div class="field-label">Marital Status</div>
        <div class="field-value">${escapeHtml(marital.status.charAt(0).toUpperCase() + marital.status.slice(1))}</div>
      </div>
      ` : ''}
      ${parents.father?.full_name ? `
      <div class="field-item">
        <div class="field-label">Father</div>
        <div class="field-value">${escapeHtml(parents.father.full_name)}</div>
      </div>
      ` : ''}
      ${parents.mother?.full_name ? `
      <div class="field-item">
        <div class="field-label">Mother</div>
        <div class="field-value">${escapeHtml(parents.mother.full_name)}</div>
      </div>
      ` : ''}
      ${certInfo.state_file_number ? `
      <div class="field-item">
        <div class="field-label">State File Number</div>
        <div class="field-value mono">${escapeHtml(certInfo.state_file_number)}</div>
      </div>
      ` : ''}
      ${disposition.cemetery_name ? `
      <div class="field-item">
        <div class="field-label">Burial</div>
        <div class="field-value">${escapeHtml(disposition.cemetery_name)}${disposition.date ? `, ${formatDate(disposition.date)}` : ''}</div>
      </div>
      ` : ''}
    </div>

    ${familyHtml}
    ${chainHtml}
  `;
}

function fmtCurrencyPrint(val: any): string {
  if (val == null) return '-';
  const n = parseFloat(val);
  if (isNaN(n)) return escapeHtml(String(val));
  const neg = n < 0;
  const formatted = '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return neg ? `<span style="color:#DC2626;">-${formatted}</span>` : formatted;
}

function generateCheckStubFields(data: any): string {
  const operator = data.operator || '';
  const operatorNumber = data.operator_number || '';
  const operatorAddress = data.operator_address || '';
  const ownerName = data.owner_name || '';
  const ownerNumber = data.owner_number || '';
  const checkNumber = data.check_number || '';
  const checkDate = data.check_date || '';
  const checkAmount = data.check_amount;
  const statementType = data.statement_type || 'royalty_check';
  const interestType = data.interest_type || '';
  const wells: any[] = data.wells || [];
  const summary = data.summary || {};

  const stmtLabel = statementType === 'operating_statement' ? 'Operating Statement'
    : statementType === 'supplemental_voucher' ? 'Supplemental Voucher' : 'Royalty Check';

  // Parties
  const operatorHtml = operator ? `
    <div class="party-box">
      <div class="party-label">Operator</div>
      <div class="party-name">${escapeHtml(operator)}</div>
      ${operatorNumber ? `<div class="party-detail">ID: ${escapeHtml(operatorNumber)}</div>` : ''}
      ${operatorAddress ? `<div class="party-detail">${escapeHtml(operatorAddress)}</div>` : ''}
    </div>` : '';

  const ownerHtml = ownerName ? `
    <div class="party-box">
      <div class="party-label">Payee / Interest Owner</div>
      <div class="party-name">${escapeHtml(ownerName)}</div>
      ${ownerNumber ? `<div class="party-detail">Owner #: ${escapeHtml(ownerNumber)}</div>` : ''}
    </div>` : '';

  // Payment info
  const checkAmountDisplay = checkAmount != null ? fmtCurrencyPrint(checkAmount) : '-';

  // Wells table
  let wellsHtml = '';
  if (wells.length > 0) {
    wellsHtml = `<div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Well Revenue Detail</div>`;

    wells.forEach((well: any) => {
      const wellName = well.well_name || 'Unknown';
      const wellNum = well.well_number || '';
      const api = well.api_number || '';
      const months = Array.isArray(well.production_months) ? well.production_months.join(', ') : '';
      const loc = [well.county, well.state].filter(Boolean).join(', ');

      wellsHtml += `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
        <div style="font-weight: 600; color: #1e293b;">${escapeHtml(wellName)}${wellNum ? ` (#${escapeHtml(wellNum)})` : ''}</div>
        <div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">
          ${api ? `API: ${escapeHtml(api)} | ` : ''}${loc ? `${escapeHtml(loc)} | ` : ''}${months ? `Production: ${escapeHtml(months)}` : ''}
        </div>`;

      if (Array.isArray(well.products) && well.products.length > 0) {
        wellsHtml += `<table class="data-table" style="font-size: 12px;">
          <thead><tr>
            <th>Product</th><th>Volume</th><th style="text-align:right;">Price</th>
            <th>Decimal</th><th>Purchaser</th>
            <th style="text-align:right;">Gross</th><th style="text-align:right;">Deductions</th>
            <th style="text-align:right;">Taxes</th><th style="text-align:right;">Owner Amt</th>
          </tr></thead><tbody>`;

        well.products.forEach((p: any, i: number) => {
          const prodType = (p.product_type || '').charAt(0).toUpperCase() + (p.product_type || '').slice(1);
          const vol = p.volume != null ? Number(p.volume).toLocaleString('en-US') + (p.volume_unit ? ' ' + p.volume_unit : '') : '-';
          const price = p.price_per_unit != null ? '$' + Number(p.price_per_unit).toFixed(2) : '-';
          const dec = p.decimal_interest != null ? String(p.decimal_interest) : '-';
          const purchaser = p.purchaser || '-';

          wellsHtml += `<tr ${i % 2 !== 0 ? 'class="alt"' : ''}>
            <td>${escapeHtml(prodType)}</td>
            <td>${escapeHtml(vol)}</td>
            <td style="text-align:right;">${escapeHtml(price)}</td>
            <td style="font-family:monospace;font-size:11px;">${escapeHtml(dec)}</td>
            <td>${escapeHtml(purchaser)}</td>
            <td style="text-align:right;">${fmtCurrencyPrint(p.gross_sales)}</td>
            <td style="text-align:right;">${fmtCurrencyPrint(p.total_deductions)}</td>
            <td style="text-align:right;">${fmtCurrencyPrint(p.total_taxes)}</td>
            <td style="text-align:right;font-weight:600;">${fmtCurrencyPrint(p.owner_amount)}</td>
          </tr>`;

          // Deduction detail if available
          if (Array.isArray(p.deductions) && p.deductions.length > 0) {
            wellsHtml += `<tr><td colspan="9" style="padding: 4px 8px 4px 20px; background: #fffbeb; font-size: 11px;">`;
            wellsHtml += `<strong>Deductions:</strong> `;
            wellsHtml += p.deductions.map((d: any) => `${escapeHtml(d.raw_label || '')} (${escapeHtml(d.normalized_category || '')}) ${fmtCurrencyPrint(d.amount)}`).join(' | ');
            wellsHtml += `</td></tr>`;
          }
          if (Array.isArray(p.taxes) && p.taxes.length > 0) {
            wellsHtml += `<tr><td colspan="9" style="padding: 4px 8px 4px 20px; background: #eff6ff; font-size: 11px;">`;
            wellsHtml += `<strong>Taxes:</strong> `;
            wellsHtml += p.taxes.map((t: any) => `${escapeHtml(t.raw_label || '')} (${escapeHtml(t.normalized_type || '')}) ${fmtCurrencyPrint(t.amount)}`).join(' | ');
            wellsHtml += `</td></tr>`;
          }
        });

        wellsHtml += `</tbody></table>`;
      }

      if (well.well_owner_total != null) {
        wellsHtml += `<div style="text-align:right;margin-top:6px;font-weight:600;font-size:13px;">Well Total: ${fmtCurrencyPrint(well.well_owner_total)}</div>`;
      }
      wellsHtml += `</div>`;
    });
    wellsHtml += `</div>`;
  }

  // Summary
  let summaryHtml = '';
  if (summary.total_net_revenue != null) {
    summaryHtml = `<div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Revenue Summary</div>
      <div class="field-grid">
        ${summary.gas_net_revenue != null ? `<div class="field-item"><div class="field-label">Gas Net Revenue</div><div class="field-value">${fmtCurrencyPrint(summary.gas_net_revenue)}</div></div>` : ''}
        ${summary.oil_net_revenue != null ? `<div class="field-item"><div class="field-label">Oil Net Revenue</div><div class="field-value">${fmtCurrencyPrint(summary.oil_net_revenue)}</div></div>` : ''}
        ${summary.liquids_net_revenue ? `<div class="field-item"><div class="field-label">Liquids Net Revenue</div><div class="field-value">${fmtCurrencyPrint(summary.liquids_net_revenue)}</div></div>` : ''}
        <div class="field-item"><div class="field-label">Total Net Revenue</div><div class="field-value highlight">${fmtCurrencyPrint(summary.total_net_revenue)}</div></div>
      </div>
    </div>`;
  }

  return `
    ${operatorHtml || ownerHtml ? `
    <div class="parties-grid" style="margin-bottom: 16px;">
      ${operatorHtml}
      ${ownerHtml}
    </div>` : ''}

    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Statement Type</div>
        <div class="field-value">${escapeHtml(stmtLabel)}</div>
      </div>
      ${interestType ? `<div class="field-item"><div class="field-label">Interest Type</div><div class="field-value">${escapeHtml(interestType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()))}</div></div>` : ''}
      ${checkNumber ? `<div class="field-item"><div class="field-label">Check Number</div><div class="field-value mono">${escapeHtml(checkNumber)}</div></div>` : ''}
      ${checkDate ? `<div class="field-item"><div class="field-label">Check Date</div><div class="field-value">${escapeHtml(formatDate(checkDate))}</div></div>` : ''}
      <div class="field-item">
        <div class="field-label">Check Amount</div>
        <div class="field-value highlight" style="font-size: 16px;">${checkAmountDisplay}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Wells</div>
        <div class="field-value">${wells.length} well${wells.length !== 1 ? 's' : ''}</div>
      </div>
    </div>

    ${wellsHtml}
    ${summaryHtml}
  `;
}

function generateGenericFields(data: any): string {
  // Filter out meta fields, internal fields, and empty values
  const skipFields = [
    // Analysis fields (shown separately)
    'key_takeaway',
    'detailed_analysis',
    'summary',
    'analysis',
    'ai_observations',
    // Meta/internal fields
    'field_scores',
    'skip_extraction',
    'document_confidence',
    'schema_validation',
    'review_flags',
    'coarse_type',
    'detected_title',
    'split_reason',
    'start_page',
    'end_page',
    // Doc type shown in header
    'doc_type',
    'category',
  ];
  const entries = Object.entries(data).filter(([key, value]) => {
    if (skipFields.includes(key)) return false;
    // Skip internal/system fields (prefixed with _)
    if (key.startsWith('_')) return false;
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'object' && Object.keys(value).length === 0) return false;
    return true;
  });

  if (entries.length === 0) {
    return '<div class="field-value" style="color: #64748b; font-style: italic;">No extracted data available</div>';
  }

  return `
    <div class="field-grid">
      ${entries
        .map(([key, value]) => {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          let displayValue = '';

          if (typeof value === 'object') {
            displayValue = JSON.stringify(value, null, 2);
          } else {
            displayValue = String(value);
          }

          return `
          <div class="field-item${typeof value === 'object' ? ' full-width' : ''}">
            <div class="field-label">${escapeHtml(label)}</div>
            <div class="field-value${typeof value === 'object' ? ' mono' : ''}" style="${typeof value === 'object' ? 'white-space: pre-wrap; font-size: 11px;' : ''}">${escapeHtml(displayValue)}</div>
          </div>
        `;
        })
        .join('')}
    </div>
  `;
}
