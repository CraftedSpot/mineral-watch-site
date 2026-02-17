/**
 * County Record Extraction Service
 *
 * Handles fetching county records from OKCR, combining multi-page PDFs,
 * storing in R2, extracting with Claude Sonnet, creating document records,
 * and deducting credits.
 *
 * Called by portal-worker via service binding:
 *   POST /api/processing/extract-county-record
 */

import { PDFDocument } from 'pdf-lib';
import { UsageTrackingService } from './usage-tracking';
import { getExtractionPrompt, preparePrompt } from './extraction-prompts';

interface Env {
  WELLS_DB: D1Database;
  LOCKER_BUCKET: R2Bucket;
  OKCR_API_KEY?: string;
  OKCR_API_BASE?: string;
  ANTHROPIC_API_KEY?: string;
}

interface ExtractionRequest {
  county: string;
  instrument_number: string;
  images: { number: number; page: string }[];
  format: 'extract' | 'official';
  instrument_type?: string;
  userId: string;
  userPlan: string;
  organizationId?: string;
  credits_required: number;
}

interface ExtractionResult {
  success: boolean;
  document_id?: string;
  extracted_data?: any;
  doc_type?: string;
  key_takeaway?: string;
  detailed_analysis?: string;
  r2_path?: string;
  page_count?: number;
  credits_charged?: number;
  extraction_model?: string;
  error?: string;
  status?: number;
}

export class CountyRecordExtractionService {
  private usageService: UsageTrackingService;

  constructor(
    private env: Env,
    usageService?: UsageTrackingService
  ) {
    this.usageService = usageService || new UsageTrackingService(env.WELLS_DB);
  }

  async extractCountyRecord(params: ExtractionRequest): Promise<ExtractionResult> {
    const {
      county, instrument_number, images, format,
      instrument_type, userId, userPlan, organizationId,
      credits_required
    } = params;

    // 1. Check credits
    const creditCheck = await this.usageService.checkCreditsAvailable(userId, userPlan);
    if (creditCheck.totalAvailable < credits_required) {
      return {
        success: false,
        error: `Insufficient credits. Need ${credits_required}, have ${creditCheck.totalAvailable}.`,
        status: 402
      };
    }

    // 2. Fetch all OKCR images
    let pageBuffers: ArrayBuffer[];
    try {
      pageBuffers = await this.fetchOkcrImages(county, images, format);
    } catch (err: any) {
      console.error(`[OKCR] Failed to fetch images for ${county}:${instrument_number}:`, err);
      return {
        success: false,
        error: `Failed to fetch document from OKCR: ${err.message}`,
        status: 502
      };
    }

    // 3. Combine PDFs with pdf-lib
    let mergedPdfBytes: Uint8Array;
    try {
      mergedPdfBytes = await this.combinePdfs(pageBuffers);
    } catch (err: any) {
      console.error(`[OKCR] Failed to combine PDFs for ${county}:${instrument_number}:`, err);
      return {
        success: false,
        error: `Failed to combine PDF pages: ${err.message}`,
        status: 500
      };
    }

    // 4. Store in R2
    const r2Key = `county-records/${county}/${instrument_number}.pdf`;
    try {
      await this.env.LOCKER_BUCKET.put(r2Key, mergedPdfBytes, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: {
          county,
          instrument_number,
          instrument_type: instrument_type || 'unknown',
          page_count: String(images.length),
          format,
        }
      });
      console.log(`[OKCR] Stored PDF in R2: ${r2Key} (${mergedPdfBytes.length} bytes, ${images.length} pages)`);
    } catch (err: any) {
      console.error(`[OKCR] Failed to store PDF in R2:`, err);
      return {
        success: false,
        error: `Failed to store document: ${err.message}`,
        status: 500
      };
    }

    // 5. Extract with Claude Sonnet
    let extraction: any;
    let rawResponse: string;
    try {
      const result = await this.callClaudeExtraction(mergedPdfBytes, instrument_type);
      extraction = result.extraction;
      rawResponse = result.rawResponse;
    } catch (err: any) {
      console.error(`[OKCR] Claude extraction failed for ${county}:${instrument_number}:`, err);
      return {
        success: false,
        error: `Extraction failed: ${err.message}`,
        status: 500
      };
    }

    // 6. Create document record in documents table
    const documentId = this.generateDocumentId();
    const docType = extraction?.doc_type || instrument_type || 'unknown';
    const section = extraction?.section || extraction?.tracts?.[0]?.legal_description?.section || extraction?.tracts?.[0]?.legal?.section || null;
    const township = extraction?.township || extraction?.tracts?.[0]?.legal_description?.township || extraction?.tracts?.[0]?.legal?.township || null;
    const range = extraction?.range || extraction?.tracts?.[0]?.legal_description?.range || extraction?.tracts?.[0]?.legal?.range || null;
    const extractedCounty = extraction?.county || county;

    const displayName = this.generateDisplayName(extraction, instrument_type, county, instrument_number);
    const keyTakeaway = extraction?.key_takeaway || null;
    const detailedAnalysis = extraction?.detailed_analysis || null;

    const sourceMetadata = JSON.stringify({
      source: 'okcr',
      county,
      instrument_number,
      instrument_type,
      format,
      images,
      r2_key: r2Key,
    });

    try {
      await this.env.WELLS_DB.prepare(`
        INSERT INTO documents (
          id, r2_key, filename, doc_type, county, section, township, range,
          extracted_data, confidence, status, user_id, organization_id,
          upload_date, extraction_started_at, extraction_completed_at,
          page_count, display_name, category, source_metadata, content_type,
          original_filename, file_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-6 hours'),
          datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        documentId,
        r2Key,
        `${county}_${instrument_number}.pdf`,
        docType,
        extractedCounty,
        section ? String(section) : null,
        township,
        range,
        JSON.stringify(extraction),
        'high',
        'complete',
        userId,
        organizationId || null,
        images.length,
        displayName,
        docType || 'county_record',
        sourceMetadata,
        'application/pdf',
        `${county}_${instrument_number}.pdf`,
        mergedPdfBytes.length
      ).run();

      console.log(`[OKCR] Created document record: ${documentId} for user ${userId}`);
    } catch (err: any) {
      console.error(`[OKCR] Failed to create document record:`, err);
      return {
        success: false,
        error: `Failed to save extraction: ${err.message}`,
        status: 500
      };
    }

    // 6b. Post-process: populate specialized tables for pooling orders
    if (extraction?.doc_type === 'pooling_order' ||
        (instrument_type || '').toLowerCase().includes('pooling')) {
      try {
        await this.postProcessPoolingOrder(documentId, extraction);
      } catch (err: any) {
        console.error(`[OKCR] Pooling post-processing failed for ${documentId}:`, err);
        // Non-fatal — document is already saved with full extracted_data JSON
      }
    }

    // 7. Deduct credits
    const deducted = await this.usageService.deductCredits(userId, userPlan, credits_required);
    if (!deducted) {
      console.error(`[OKCR] Credit deduction failed for user ${userId} (${credits_required} credits)`);
      // Document was created but credits weren't deducted — log but don't fail
      // The user already has the document, and we don't want to leave them in a broken state
    }

    // 8. Return result
    return {
      success: true,
      document_id: documentId,
      extracted_data: extraction,
      doc_type: docType,
      key_takeaway: keyTakeaway,
      detailed_analysis: detailedAnalysis,
      r2_path: r2Key,
      page_count: images.length,
      credits_charged: credits_required,
      extraction_model: 'claude-sonnet-4-6-20250514',
    };
  }

  /**
   * Create a document record from cached extraction (no OKCR fetch needed).
   * Used when another user has already extracted this instrument.
   */
  async createDocumentFromCache(params: {
    userId: string;
    userPlan: string;
    organizationId?: string;
    cacheRow: any;
    credits_required: number;
  }): Promise<ExtractionResult> {
    const { userId, userPlan, organizationId, cacheRow, credits_required } = params;

    // Check credits
    const creditCheck = await this.usageService.checkCreditsAvailable(userId, userPlan);
    if (creditCheck.totalAvailable < credits_required) {
      return {
        success: false,
        error: `Insufficient credits. Need ${credits_required}, have ${creditCheck.totalAvailable}.`,
        status: 402
      };
    }

    // Find the original document to copy extraction data from
    const originalDoc = await this.env.WELLS_DB.prepare(
      `SELECT extracted_data, doc_type, county, section, township, range,
              display_name, page_count, r2_key, source_metadata
       FROM documents WHERE id = ?`
    ).bind(cacheRow.document_id).first();

    if (!originalDoc) {
      return {
        success: false,
        error: 'Cached document not found',
        status: 404
      };
    }

    // Create a new document record for this user
    const documentId = this.generateDocumentId();
    const extractedData = originalDoc.extracted_data as string;
    const extraction = extractedData ? JSON.parse(extractedData) : {};

    try {
      await this.env.WELLS_DB.prepare(`
        INSERT INTO documents (
          id, r2_key, filename, doc_type, county, section, township, range,
          extracted_data, confidence, status, user_id, organization_id,
          upload_date, extraction_started_at, extraction_completed_at,
          page_count, display_name, category, source_metadata, content_type,
          original_filename, file_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-6 hours'),
          datetime('now', '-6 hours'), datetime('now', '-6 hours'), ?, ?, ?, ?, ?, ?, 0)
      `).bind(
        documentId,
        originalDoc.r2_key as string,
        `${cacheRow.county}_${cacheRow.instrument_number}.pdf`,
        originalDoc.doc_type as string,
        originalDoc.county as string,
        originalDoc.section as string | null,
        originalDoc.township as string | null,
        originalDoc.range as string | null,
        extractedData,
        'high',
        'complete',
        userId,
        organizationId || null,
        originalDoc.page_count as number,
        originalDoc.display_name as string,
        (originalDoc.doc_type as string) || 'county_record',
        originalDoc.source_metadata as string,
        'application/pdf',
        `${cacheRow.county}_${cacheRow.instrument_number}.pdf`
      ).run();

      console.log(`[OKCR] Created cached document record: ${documentId} for user ${userId} (from cache ${cacheRow.document_id})`);
    } catch (err: any) {
      console.error(`[OKCR] Failed to create cached document record:`, err);
      return {
        success: false,
        error: `Failed to save document: ${err.message}`,
        status: 500
      };
    }

    // Deduct credits
    await this.usageService.deductCredits(userId, userPlan, credits_required);

    return {
      success: true,
      document_id: documentId,
      extracted_data: extraction,
      doc_type: originalDoc.doc_type as string,
      key_takeaway: extraction?.key_takeaway,
      detailed_analysis: extraction?.detailed_analysis,
      r2_path: originalDoc.r2_key as string,
      page_count: originalDoc.page_count as number,
      credits_charged: credits_required,
      extraction_model: 'claude-sonnet-4-6-20250514',
    };
  }

  // ===== Private helpers =====

  private async fetchOkcrImages(
    county: string,
    images: { number: number; page: string }[],
    format: 'extract' | 'official'
  ): Promise<ArrayBuffer[]> {
    if (!this.env.OKCR_API_KEY || !this.env.OKCR_API_BASE) {
      throw new Error('OKCR API not configured');
    }

    const action = format === 'official' ? 'print' : 'view';
    const credentials = btoa(this.env.OKCR_API_KEY + ':');
    const buffers: ArrayBuffer[] = [];

    for (const img of images) {
      const url = `${this.env.OKCR_API_BASE}/images?county=${encodeURIComponent(county)}&number=${img.number}&action=${action}`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Accept': 'application/pdf',
        }
      });

      if (!resp.ok) {
        throw new Error(`OKCR image fetch failed: ${resp.status} for image ${img.number}`);
      }

      buffers.push(await resp.arrayBuffer());
      console.log(`[OKCR] Fetched image ${img.number} (page ${img.page}): ${buffers[buffers.length - 1].byteLength} bytes`);
    }

    return buffers;
  }

  private async combinePdfs(pageBuffers: ArrayBuffer[]): Promise<Uint8Array> {
    const mergedDoc = await PDFDocument.create();

    for (const pageBytes of pageBuffers) {
      const srcDoc = await PDFDocument.load(pageBytes);
      const pages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      for (const page of pages) {
        mergedDoc.addPage(page);
      }
    }

    return await mergedDoc.save();
  }

  private async callClaudeExtraction(
    pdfBytes: Uint8Array,
    instrumentType?: string
  ): Promise<{ extraction: any; rawResponse: string }> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const base64Pdf = this.uint8ArrayToBase64(pdfBytes);
    const prompt = preparePrompt(getExtractionPrompt(instrumentType));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Pdf,
              }
            },
            {
              type: 'text',
              text: prompt,
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const result: any = await response.json();
    const rawResponse = result.content?.[0]?.text || '';

    // Parse JSON from response (it may have text after the JSON)
    const extraction = this.parseExtractionResponse(rawResponse);

    return { extraction, rawResponse };
  }

  private parseExtractionResponse(text: string): any {
    // Try to find JSON object in the response
    // The prompt instructs: JSON first, then KEY TAKEAWAY, then DETAILED ANALYSIS
    try {
      // Find the first { and match to its closing }
      const firstBrace = text.indexOf('{');
      if (firstBrace === -1) {
        console.error('[OKCR] No JSON found in extraction response');
        return { raw_text: text };
      }

      let depth = 0;
      let lastBrace = -1;
      for (let i = firstBrace; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            lastBrace = i;
            break;
          }
        }
      }

      if (lastBrace === -1) {
        console.error('[OKCR] Unmatched JSON braces in extraction response');
        return { raw_text: text };
      }

      const jsonStr = text.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);

      // Extract key_takeaway and detailed_analysis from the text after JSON
      const afterJson = text.substring(lastBrace + 1);

      const takeawayMatch = afterJson.match(/KEY TAKEAWAY[:\s]*\n?([\s\S]*?)(?=DETAILED ANALYSIS|$)/i);
      if (takeawayMatch && !parsed.key_takeaway) {
        parsed.key_takeaway = takeawayMatch[1].trim();
      }

      const analysisMatch = afterJson.match(/DETAILED ANALYSIS[:\s]*\n?([\s\S]*?)$/i);
      if (analysisMatch && !parsed.detailed_analysis) {
        parsed.detailed_analysis = analysisMatch[1].trim();
      }

      return parsed;
    } catch (err) {
      console.error('[OKCR] Failed to parse extraction JSON:', err);
      return { raw_text: text };
    }
  }

  private generateDocumentId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'doc_okcr_';
    for (let i = 0; i < 16; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  private generateDisplayName(
    extraction: any,
    instrumentType?: string,
    county?: string,
    instrumentNumber?: string
  ): string {
    const type = instrumentType || extraction?.doc_type || 'County Record';

    // Try to build a descriptive name
    const grantor = extraction?.lessor?.name || extraction?.grantors?.[0]?.name || extraction?.assignor?.name || extraction?.applicant?.name;
    const grantee = extraction?.lessee?.name || extraction?.grantees?.[0]?.name || extraction?.assignee?.name || extraction?.operator?.name;

    if (grantor && grantee) {
      return `${type} - ${grantor} to ${grantee}`;
    }
    if (grantor) {
      return `${type} - ${grantor}`;
    }

    return `${type} - ${county} Co. #${instrumentNumber}`;
  }

  /**
   * Post-process pooling order extraction: populate pooling_orders,
   * pooling_election_options, and lease_comps tables from extracted_data.
   * Non-fatal — the document is already saved with full JSON.
   */
  private async postProcessPoolingOrder(documentId: string, extraction: any): Promise<void> {
    if (!this.env.WELLS_DB || !extraction) return;

    const orderInfo = extraction.order_info || {};
    const unitInfo = extraction.unit_info || {};
    const wellInfo = extraction.well_info || {};
    const deadlines = extraction.deadlines || {};
    const defaultElection = extraction.default_election || {};

    const poolingId = 'po_' + documentId.replace('doc_okcr_', '');

    // 1. Insert into pooling_orders
    try {
      await this.env.WELLS_DB.prepare(`
        INSERT OR IGNORE INTO pooling_orders (
          id, document_id, case_number, order_number, order_date, effective_date,
          applicant, operator, proposed_well_name,
          section, township, range, county, meridian,
          unit_description, unit_size_acres,
          well_type, formations,
          response_deadline, response_deadline_days,
          default_election_option, default_election_description,
          confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        poolingId,
        documentId,
        orderInfo.case_number || null,
        orderInfo.order_number || null,
        orderInfo.order_date || null,
        orderInfo.effective_date || null,
        extraction.applicant?.name || null,
        extraction.operator?.name || null,
        wellInfo.proposed_well_name || null,
        extraction.section ? String(extraction.section) : null,
        extraction.township || null,
        extraction.range || null,
        extraction.county || null,
        'IM',
        unitInfo.unit_description || null,
        unitInfo.unit_size_acres || null,
        wellInfo.well_type || null,
        extraction.formations ? JSON.stringify(extraction.formations) : null,
        deadlines.election_deadline || null,
        deadlines.election_period_days || null,
        defaultElection.option_number != null ? String(defaultElection.option_number) : null,
        defaultElection.description || null,
        'high'
      ).run();
    } catch (err: any) {
      console.error(`[OKCR] Failed to insert pooling_orders for ${documentId}:`, err);
    }

    // 2. Insert election options
    const options = extraction.election_options || [];
    for (const opt of options) {
      try {
        await this.env.WELLS_DB.prepare(`
          INSERT INTO pooling_election_options (
            pooling_order_id, option_number, option_type, description,
            bonus_per_acre, royalty_fraction, royalty_decimal,
            working_interest_retained, cost_per_nma, penalty_percentage, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          poolingId,
          opt.option_number || null,
          opt.option_type || null,
          opt.description || null,
          opt.bonus_per_nma || null,
          opt.royalty_rate || null,
          opt.nri_delivered ? parseFloat(String(opt.nri_delivered).replace('%', '')) / 100 : null,
          opt.option_type === 'participate' ? 1 : 0,
          opt.cost_per_nma || null,
          opt.risk_penalty_percentage || null,
          opt.excess_royalty ? `Excess royalty: ${opt.excess_royalty}` : null
        ).run();
      } catch (err: any) {
        console.error(`[OKCR] Failed to insert election option ${opt.option_number} for ${documentId}:`, err);
      }
    }

    // 3. Insert lease comps from exhibits
    const leaseExhibits = extraction.lease_exhibits || [];
    for (const comp of leaseExhibits) {
      try {
        await this.env.WELLS_DB.prepare(`
          INSERT INTO lease_comps (
            source_document_id, section, township, range, county, state, quarters,
            lessor, lessee, bonus_per_nma, royalty, royalty_decimal,
            lease_date, term_years, acres,
            source_case_number, source_order_number
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          documentId,
          comp.section ? String(comp.section) : null,
          comp.township || null,
          comp.range || null,
          comp.county || extraction.county || null,
          'Oklahoma',
          comp.quarters || null,
          comp.lessor || null,
          comp.lessee || null,
          comp.bonus_per_nma || null,
          comp.royalty || null,
          comp.royalty_decimal || null,
          comp.lease_date || null,
          comp.term_years || null,
          comp.acres || null,
          orderInfo.case_number || null,
          orderInfo.order_number || null
        ).run();
      } catch (err: any) {
        console.error(`[OKCR] Failed to insert lease comp for ${documentId}:`, err);
      }
    }

    console.log(`[OKCR] Pooling post-processing complete for ${documentId}: ${options.length} options, ${leaseExhibits.length} lease comps`);
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
