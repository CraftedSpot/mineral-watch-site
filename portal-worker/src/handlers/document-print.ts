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
  const keyTakeaway = extractedData.key_takeaway || extractedData.summary || null;
  const detailedAnalysis = extractedData.detailed_analysis || extractedData.analysis || null;

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
      extractedFieldsHtml = generateDeedFields(data.extractedData);
      break;
    case 'lease':
    case 'oil_and_gas_lease':
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
  <title>Document Summary - ${escapeHtml(data.displayName)}</title>
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
      justify-content: flex-end;
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
    <button class="print-btn primary" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      Print / Save PDF
    </button>
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
        <div class="key-takeaway-text">${escapeHtml(data.keyTakeaway)}</div>
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
      <div class="analysis-content">${escapeHtml(data.detailedAnalysis)}</div>
    </div>
    `
        : ''
    }

    <div class="section">
      <div class="section-title">EXTRACTED INFORMATION</div>
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
  const grantor = data.grantor || {};
  const grantee = data.grantee || {};
  const legalDescription = data.legal_description || {};
  const interestConveyed = data.interest_conveyed || {};

  return `
    <div class="parties-grid">
      <div class="party-box">
        <div class="party-label">Grantor (Seller)</div>
        <div class="party-name">${escapeHtml(grantor.name || 'Not specified')}</div>
        ${grantor.address ? `<div class="party-detail">${escapeHtml(grantor.address)}</div>` : ''}
      </div>
      <div class="party-box">
        <div class="party-label">Grantee (Buyer)</div>
        <div class="party-name">${escapeHtml(grantee.name || 'Not specified')}</div>
        ${grantee.address ? `<div class="party-detail">${escapeHtml(grantee.address)}</div>` : ''}
      </div>
    </div>

    <div class="field-grid" style="margin-top: 16px;">
      <div class="field-item">
        <div class="field-label">Execution Date</div>
        <div class="field-value">${formatDate(data.execution_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Recording Date</div>
        <div class="field-value">${formatDate(data.recording_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Book/Page</div>
        <div class="field-value mono">${data.book ? `Book ${escapeHtml(data.book)}, Page ${escapeHtml(data.page)}` : 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Document Number</div>
        <div class="field-value mono">${escapeHtml(data.document_number) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Interest Type</div>
        <div class="field-value">${escapeHtml(interestConveyed.type) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Interest Fraction</div>
        <div class="field-value highlight">${escapeHtml(interestConveyed.fraction) || 'Not specified'}</div>
      </div>
      ${
        data.consideration
          ? `
      <div class="field-item">
        <div class="field-label">Consideration</div>
        <div class="field-value">${escapeHtml(data.consideration)}</div>
      </div>
      `
          : ''
      }
    </div>

    ${
      legalDescription.full_text
        ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Legal Description</div>
      <div class="legal-description">${escapeHtml(legalDescription.full_text)}</div>
    </div>
    `
        : ''
    }
  `;
}

function generateLeaseFields(data: any): string {
  const lessor = data.lessor || {};
  const lessee = data.lessee || {};
  const legalDescription = data.legal_description || {};
  const primaryTerm = data.primary_term || {};
  const royalty = data.royalty || {};
  const bonusConsideration = data.bonus_consideration || {};

  return `
    <div class="parties-grid">
      <div class="party-box">
        <div class="party-label">Lessor (Mineral Owner)</div>
        <div class="party-name">${escapeHtml(lessor.name || 'Not specified')}</div>
        ${lessor.address ? `<div class="party-detail">${escapeHtml(lessor.address)}</div>` : ''}
      </div>
      <div class="party-box">
        <div class="party-label">Lessee (Oil Company)</div>
        <div class="party-name">${escapeHtml(lessee.name || 'Not specified')}</div>
        ${lessee.address ? `<div class="party-detail">${escapeHtml(lessee.address)}</div>` : ''}
      </div>
    </div>

    <div class="field-grid" style="margin-top: 16px;">
      <div class="field-item">
        <div class="field-label">Lease Date</div>
        <div class="field-value">${formatDate(data.lease_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Recording Date</div>
        <div class="field-value">${formatDate(data.recording_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Primary Term</div>
        <div class="field-value highlight">${primaryTerm.duration ? escapeHtml(primaryTerm.duration) + ' ' + escapeHtml(primaryTerm.unit || 'years') : 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Royalty Rate</div>
        <div class="field-value highlight">${royalty.rate ? escapeHtml(royalty.rate) : 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Gross Acres</div>
        <div class="field-value">${data.gross_acres ? escapeHtml(data.gross_acres) + ' acres' : 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Net Mineral Acres</div>
        <div class="field-value">${data.net_mineral_acres ? escapeHtml(data.net_mineral_acres) + ' NMA' : 'Not specified'}</div>
      </div>
      ${
        bonusConsideration.amount
          ? `
      <div class="field-item">
        <div class="field-label">Bonus Payment</div>
        <div class="field-value">${escapeHtml(bonusConsideration.amount)}${bonusConsideration.per_acre ? '/acre' : ''}</div>
      </div>
      `
          : ''
      }
      <div class="field-item">
        <div class="field-label">Book/Page</div>
        <div class="field-value mono">${data.book ? `Book ${escapeHtml(data.book)}, Page ${escapeHtml(data.page)}` : 'Not specified'}</div>
      </div>
    </div>

    ${
      legalDescription.full_text
        ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Legal Description</div>
      <div class="legal-description">${escapeHtml(legalDescription.full_text)}</div>
    </div>
    `
        : ''
    }
  `;
}

function generatePoolingFields(data: any): string {
  const orderInfo = data.order_info || {};
  const applicant = data.applicant || {};
  const pooledUnit = data.pooled_unit || data.unit || {};

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
        <div class="field-label">Well Name</div>
        <div class="field-value">${escapeHtml(data.well_name) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Formation/Zone</div>
        <div class="field-value">${escapeHtml(data.formation || pooledUnit.formation) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Unit Size</div>
        <div class="field-value highlight">${pooledUnit.size ? escapeHtml(pooledUnit.size) + ' acres' : 'Not specified'}</div>
      </div>
    </div>

    ${
      data.pooling_options && data.pooling_options.length > 0
        ? `
    <div style="margin-top: 16px;">
      <div class="field-label" style="margin-bottom: 8px;">Pooling Options</div>
      <table class="data-table">
        <thead>
          <tr><th>Option</th><th>Bonus</th><th>Royalty</th></tr>
        </thead>
        <tbody>
          ${data.pooling_options
            .map(
              (opt: any, i: number) => `
            <tr ${i % 2 !== 0 ? 'class="alt"' : ''}>
              <td>${escapeHtml(opt.name || opt.option || `Option ${i + 1}`)}</td>
              <td>${escapeHtml(opt.bonus) || '-'}</td>
              <td>${escapeHtml(opt.royalty) || '-'}</td>
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
  const operator = data.operator || {};

  return `
    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Operator</div>
        <div class="field-value">${escapeHtml(operator.name || data.operator_name) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Effective Date</div>
        <div class="field-value">${formatDate(data.effective_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Well/Unit Name</div>
        <div class="field-value">${escapeHtml(data.well_name || data.unit_name) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Decimal Interest</div>
        <div class="field-value highlight">${escapeHtml(data.decimal_interest) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Product Type</div>
        <div class="field-value">${escapeHtml(data.product_type) || 'Oil & Gas'}</div>
      </div>
    </div>

    ${
      data.owner_info
        ? `
    <div style="margin-top: 16px;">
      <div class="party-box">
        <div class="party-label">Interest Owner</div>
        <div class="party-name">${escapeHtml(data.owner_info.name || data.owner_name)}</div>
        ${data.owner_info.address ? `<div class="party-detail">${escapeHtml(data.owner_info.address)}</div>` : ''}
      </div>
    </div>
    `
        : ''
    }
  `;
}

function generateSpacingFields(data: any): string {
  const orderInfo = data.order_info || {};
  const applicant = data.applicant || {};
  const spacingUnit = data.spacing_unit || data.unit || {};

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
        <div class="field-label">Unit Size</div>
        <div class="field-value highlight">${spacingUnit.size ? escapeHtml(spacingUnit.size) + ' acres' : 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Unit Configuration</div>
        <div class="field-value">${escapeHtml(spacingUnit.configuration || spacingUnit.shape) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Formation/Zone</div>
        <div class="field-value">${escapeHtml(data.formation || spacingUnit.formation) || 'Not specified'}</div>
      </div>
      ${
        data.well_type
          ? `
      <div class="field-item">
        <div class="field-label">Well Type</div>
        <div class="field-value">${escapeHtml(data.well_type)}</div>
      </div>
      `
          : ''
      }
      ${
        data.wells_allowed
          ? `
      <div class="field-item">
        <div class="field-label">Wells Allowed</div>
        <div class="field-value">${escapeHtml(data.wells_allowed)}</div>
      </div>
      `
          : ''
      }
    </div>
  `;
}

function generateLocationExceptionFields(data: any): string {
  const orderInfo = data.order_info || {};
  const applicant = data.applicant || {};
  const wellInfo = data.well_info || {};
  const lateralPath = data.lateral_path || {};
  const exceptionDetails = data.exception_details || {};

  // Get primary formation from target_formations array
  const targetFormations = data.target_formations || [];
  const primaryFormation = targetFormations.find((f: any) => f.is_primary) || targetFormations[0];
  const formationName = primaryFormation?.name || data.formation || '';

  // Get well name from well_info or top-level
  const wellName = wellInfo.well_name || data.well_name || '';

  // Get unit size from well_info
  const unitSize = wellInfo.spacing_unit_acres || data.unit_size_acres || '';

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
        <div class="field-label">Target Formation</div>
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
        exceptionDetails.granted_setback_ft !== undefined
          ? `
      <div class="field-item">
        <div class="field-label">Standard Setback</div>
        <div class="field-value">${escapeHtml(String(exceptionDetails.standard_setback_ft || 165))} ft</div>
      </div>
      <div class="field-item">
        <div class="field-label">Granted Setback</div>
        <div class="field-value highlight">${escapeHtml(String(exceptionDetails.granted_setback_ft))} ft</div>
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
        <div class="field-value">${escapeHtml(data.formation) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Wells Allowed</div>
        <div class="field-value highlight">${escapeHtml(data.wells_allowed || data.additional_wells) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Unit Size</div>
        <div class="field-value">${data.unit_size ? escapeHtml(data.unit_size) + ' acres' : 'Not specified'}</div>
      </div>
    </div>
  `;
}

function generateCompletionReportFields(data: any): string {
  const wellInfo = data.well_info || data.well || {};
  const completion = data.completion || {};
  const production = data.production || data.initial_production || {};

  return `
    <div class="field-grid">
      <div class="field-item">
        <div class="field-label">Well Name</div>
        <div class="field-value">${escapeHtml(wellInfo.name || data.well_name) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">API Number</div>
        <div class="field-value mono">${escapeHtml(wellInfo.api_number || data.api_number) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Operator</div>
        <div class="field-value">${escapeHtml(data.operator || wellInfo.operator) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Completion Date</div>
        <div class="field-value">${formatDate(completion.date || data.completion_date) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Formation</div>
        <div class="field-value">${escapeHtml(completion.formation || data.formation) || 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Total Depth</div>
        <div class="field-value">${data.total_depth ? escapeHtml(data.total_depth) + ' ft' : 'Not specified'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Well Type</div>
        <div class="field-value">${escapeHtml(data.well_type) || 'Not specified'}</div>
      </div>
      ${
        production.oil || production.gas
          ? `
      <div class="field-item">
        <div class="field-label">Initial Production (Oil)</div>
        <div class="field-value highlight">${production.oil ? escapeHtml(production.oil) + ' BOPD' : 'N/A'}</div>
      </div>
      <div class="field-item">
        <div class="field-label">Initial Production (Gas)</div>
        <div class="field-value highlight">${production.gas ? escapeHtml(production.gas) + ' MCFD' : 'N/A'}</div>
      </div>
      `
          : ''
      }
    </div>
  `;
}

function generateGenericFields(data: any): string {
  // Filter out meta fields and empty values
  const skipFields = [
    'key_takeaway',
    'detailed_analysis',
    'summary',
    'analysis',
    'field_scores',
    'skip_extraction',
  ];
  const entries = Object.entries(data).filter(([key, value]) => {
    if (skipFields.includes(key)) return false;
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
