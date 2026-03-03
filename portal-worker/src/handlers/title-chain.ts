/**
 * Title Chain API Handlers
 *
 * Endpoints for the chain-of-title timeline view.
 * Returns chronologically ordered title documents per property with party data.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import type { Env } from '../types/env.js';

// Party role display patterns by document type
const ARROW_ROLE_TYPES: Record<string, [string, string]> = {
  'mineral_deed': ['grantor', 'grantee'],
  'royalty_deed': ['grantor', 'grantee'],
  'gift_deed': ['grantor', 'grantee'],
  'quit_claim_deed': ['grantor', 'grantee'],
  'warranty_deed': ['grantor', 'grantee'],
  'conveyance': ['grantor', 'grantee'],
  'oil_gas_lease': ['lessor', 'lessee'],
  'oil_and_gas_lease': ['lessor', 'lessee'],
  'lease': ['lessor', 'lessee'],
  'memorandum_of_lease': ['lessor', 'lessee'],
  'lease_amendment': ['lessor', 'lessee'],
  'lease_extension': ['lessor', 'lessee'],
  'lease_ratification': ['lessor', 'lessee'],
  'assignment': ['assignor', 'assignee'],
  'assignment_of_lease': ['assignor', 'assignee'],
  'lease_assignment': ['assignor', 'assignee'],
  'assignment_and_bill_of_sale': ['assignor', 'assignee'],
  'trust_funding': ['grantor', 'grantee'],
};

/**
 * Extract best available date from extracted_data JSON
 */
function extractDate(data: any): { date: string | null; source: string | null } {
  if (!data) return { date: null, source: null };
  for (const field of ['execution_date', 'effective_date', 'recording_date', 'order_date']) {
    if (data[field] && typeof data[field] === 'string' && data[field].trim()) {
      return { date: data[field].trim(), source: field };
    }
  }
  return { date: null, source: null };
}

/**
 * Extract interest conveyed from extracted_data based on doc type
 */
function extractInterest(data: any, docType: string): string | null {
  if (!data) return null;

  // Deeds: interest_conveyed or fraction
  if (docType.includes('deed') || docType === 'conveyance') {
    return data.interest_conveyed || data.fraction || data.interest_description || null;
  }
  // Leases: royalty fraction + primary term
  if (docType.includes('lease') || docType === 'oil_gas_lease' || docType === 'oil_and_gas_lease') {
    const parts = [];
    if (data.royalty_fraction) parts.push(data.royalty_fraction + ' royalty');
    if (data.primary_term_years) parts.push(data.primary_term_years + '-year primary');
    return parts.length > 0 ? parts.join(', ') : null;
  }
  // Assignments: assigned interest
  if (docType.includes('assignment')) {
    return data.interest_assigned || data.assigned_interest || null;
  }
  return null;
}

/**
 * Extract parties from extracted_data JSON as fallback when document_parties table is empty.
 * Simplified version of documents-worker/src/services/party-extraction.ts extractParties().
 */
function extractPartiesFromJson(data: any, docType: string): Array<{ name: string; role: string }> {
  if (!data) return [];
  const parties: Array<{ name: string; role: string }> = [];
  const seen = new Set<string>();

  function add(name: string | undefined | null, role: string) {
    if (!name || typeof name !== 'string') return;
    name = name.trim();
    if (!name || name.length < 2) return;
    const key = `${name.toLowerCase()}|${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    parties.push({ name, role });
  }

  function addArray(arr: any, role: string) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      add(typeof item === 'string' ? item : item?.name, role);
    }
  }

  // Deeds
  if (docType.includes('deed') || docType === 'conveyance' || docType === 'trust_funding') {
    addArray(data.grantors, 'grantor');
    addArray(data.grantees, 'grantee');
    add(data.grantor?.name || data.grantor, 'grantor');
    add(data.grantee?.name || data.grantee, 'grantee');
  }
  // Leases
  else if (docType.includes('lease') || docType === 'oil_gas_lease' || docType === 'oil_and_gas_lease') {
    add(data.lessor?.name || data.lessor, 'lessor');
    add(data.lessee?.name || data.lessee, 'lessee');
    addArray(data.lessors, 'lessor');
    addArray(data.lessees, 'lessee');
  }
  // Assignments
  else if (docType.includes('assignment')) {
    add(data.assignor?.name || data.assignor, 'assignor');
    add(data.assignee?.name || data.assignee, 'assignee');
  }
  // Affidavit of heirship
  else if (docType === 'affidavit_of_heirship') {
    add(data.decedent?.name || data.decedent, 'grantor');
    add(data.affiant?.name || data.affiant, 'affiant');
    addArray(data.heirs, 'grantee');
  }
  // Title opinion
  else if (docType === 'title_opinion') {
    add(data.examining_attorney?.name || data.examining_attorney, 'examiner');
    addArray(data.current_owners, 'owner');
    if (data.chain_of_instruments) {
      for (const inst of data.chain_of_instruments) {
        addArray(inst.grantors, 'grantor');
        addArray(inst.grantees, 'grantee');
      }
    }
  }
  // Death certificate
  else if (docType === 'death_certificate') {
    add(data.decedent?.name || data.decedent || data.name, 'decedent');
  }
  // Probate
  else if (docType === 'probate') {
    add(data.decedent?.name || data.decedent, 'grantor');
    addArray(data.heirs || data.beneficiaries, 'grantee');
  }
  // Fallback: try common fields
  else {
    addArray(data.grantors, 'grantor');
    addArray(data.grantees, 'grantee');
    add(data.grantor?.name || data.grantor, 'grantor');
    add(data.grantee?.name || data.grantee, 'grantee');
    add(data.lessor?.name || data.lessor, 'lessor');
    add(data.lessee?.name || data.lessee, 'lessee');
  }

  return parties;
}


/**
 * GET /api/title-chain/properties
 * Returns properties that have chain-of-title documents for the authenticated user/org.
 */
export async function handleGetTitleChainProperties(request: Request, env: Env) {
  const start = Date.now();
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, authUser.id, memberIds, { includeUserId: true });

    // Properties with chain docs
    const propsResult = await env.WELLS_DB.prepare(`
      SELECT
        p.id,
        p.airtable_record_id,
        p.county,
        p.section,
        p.township,
        p.range,
        COUNT(DISTINCT d.id) as chain_doc_count
      FROM documents d
      JOIN properties p ON (
        d.property_id = p.airtable_record_id
      )
      WHERE d.chain_of_title = 1
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.status = 'complete'
        AND ${docOwner.where}
      GROUP BY p.id
      ORDER BY p.county, CAST(REPLACE(REPLACE(p.section, 'S', ''), ' ', '') AS INTEGER),
               CAST(REPLACE(REPLACE(REPLACE(p.township, 'N', ''), 'S', ''), ' ', '') AS INTEGER),
               CAST(REPLACE(REPLACE(REPLACE(p.range, 'W', ''), 'E', ''), ' ', '') AS INTEGER)
    `).bind(...docOwner.params).all();

    // Count unlinked chain docs
    const unlinkedResult = await env.WELLS_DB.prepare(`
      SELECT COUNT(*) as cnt FROM documents d
      WHERE d.chain_of_title = 1
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.status = 'complete'
        AND (d.property_id IS NULL OR d.property_id = '')
        AND ${docOwner.where}
    `).bind(...docOwner.params).first();

    const properties = (propsResult.results as any[]).map((row: any) => ({
      id: row.id,
      airtableRecordId: row.airtable_record_id,
      county: row.county,
      section: row.section,
      township: row.township,
      range: row.range,
      chainDocCount: row.chain_doc_count,
    }));

    return jsonResponse({
      success: true,
      properties,
      unlinkedCount: (unlinkedResult as any)?.cnt || 0,
      queryTime: Date.now() - start,
    });
  } catch (error) {
    console.error('[TitleChain] Properties error:', error);
    return jsonResponse({ error: 'Failed to fetch title chain properties' }, 500);
  }
}


/**
 * GET /api/property/:propertyId/title-chain
 * Returns chain-of-title documents for a property, ordered oldest-first.
 */
export async function handleGetTitleChain(propertyId: string, request: Request, env: Env) {
  const start = Date.now();
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, authUser.id, memberIds, { includeUserId: true });

    // Resolve property — accept both prop_recXXX and recXXX formats
    const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
    const propResult = await env.WELLS_DB.prepare(`
      SELECT id, airtable_record_id, county, section, township, range
      FROM properties
      WHERE airtable_record_id = ? OR id = ?
      LIMIT 1
    `).bind(bareId, propertyId).first();

    if (!propResult) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    const airtableId = (propResult as any).airtable_record_id;
    const url = new URL(request.url);
    const includeUnlinked = url.searchParams.get('include_unlinked') === '1';

    // Fetch chain docs for this property
    const startsWithPattern = `${airtableId},%`;
    const endsWithPattern = `%,${airtableId}`;
    const containsPattern = `%,${airtableId},%`;

    const docsResult = await env.WELLS_DB.prepare(`
      SELECT
        d.id,
        d.display_name,
        d.filename,
        d.doc_type,
        d.category,
        d.summary,
        d.r2_key,
        d.extracted_data,
        d.upload_date
      FROM documents d
      WHERE d.chain_of_title = 1
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.status = 'complete'
        AND (
          d.property_id = ?
          OR d.property_id LIKE ?
          OR d.property_id LIKE ?
          OR d.property_id LIKE ?
        )
        AND ${docOwner.where}
    `).bind(airtableId, startsWithPattern, endsWithPattern, containsPattern, ...docOwner.params).all();

    // Batch-fetch document_parties for all docs
    const docIds = (docsResult.results as any[]).map((r: any) => r.id);
    let partiesMap: Record<string, Array<{ name: string; role: string; date: string | null }>> = {};

    if (docIds.length > 0) {
      // Query in batches of 30 to stay under D1 bind limit
      const BATCH = 30;
      for (let i = 0; i < docIds.length; i += BATCH) {
        const batch = docIds.slice(i, i + BATCH);
        const placeholders = batch.map(() => '?').join(',');
        const partiesResult = await env.WELLS_DB.prepare(`
          SELECT document_id, party_name, party_role, document_date
          FROM document_parties
          WHERE document_id IN (${placeholders})
          ORDER BY party_role, party_name
        `).bind(...batch).all();

        for (const row of partiesResult.results as any[]) {
          if (!partiesMap[row.document_id]) partiesMap[row.document_id] = [];
          partiesMap[row.document_id].push({
            name: row.party_name,
            role: row.party_role,
            date: row.document_date,
          });
        }
      }
    }

    // Build response documents
    let partyDataGaps = 0;
    const documents = (docsResult.results as any[]).map((row: any) => {
      let extractedData: any = null;
      try {
        extractedData = row.extracted_data ? JSON.parse(row.extracted_data) : null;
      } catch { /* ignore */ }

      // Get parties from document_parties table, fall back to extracted_data
      let parties = partiesMap[row.id];
      let partiesFromJson = false;
      if (!parties || parties.length === 0) {
        parties = extractPartiesFromJson(extractedData, row.doc_type || '').map(p => ({
          ...p,
          date: null,
        }));
        if (parties.length > 0) partyDataGaps++;
        partiesFromJson = true;
      }

      // Extract date and interest
      const { date, source: dateSource } = extractDate(extractedData);
      const partyDate = !partiesFromJson && parties.length > 0 ? parties[0].date : null;
      const bestDate = date || partyDate || null;

      const interest = extractInterest(extractedData, row.doc_type || '');

      return {
        id: row.id,
        displayName: row.display_name || row.filename || 'Untitled',
        docType: row.doc_type,
        category: row.category,
        date: bestDate,
        dateSource: date ? dateSource : (partyDate ? 'document_parties' : null),
        parties: parties.map(p => ({ name: p.name, role: p.role })),
        interestConveyed: interest,
        summary: row.summary || (extractedData?.key_takeaway) || null,
        r2Key: row.r2_key,
      };
    });

    // Sort by date (oldest first), nulls at end
    documents.sort((a: any, b: any) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });

    // Optionally fetch unlinked chain docs
    let unlinkedDocuments: any[] = [];
    if (includeUnlinked) {
      const unlinkedResult = await env.WELLS_DB.prepare(`
        SELECT d.id, d.display_name, d.filename, d.doc_type, d.summary, d.extracted_data
        FROM documents d
        WHERE d.chain_of_title = 1
          AND (d.deleted_at IS NULL OR d.deleted_at = '')
          AND d.status = 'complete'
          AND (d.property_id IS NULL OR d.property_id = '')
          AND ${docOwner.where}
        ORDER BY d.upload_date DESC
      `).bind(...docOwner.params).all();

      unlinkedDocuments = (unlinkedResult.results as any[]).map((row: any) => {
        let extractedData: any = null;
        try { extractedData = row.extracted_data ? JSON.parse(row.extracted_data) : null; } catch {}
        const { date } = extractDate(extractedData);
        return {
          id: row.id,
          displayName: row.display_name || row.filename || 'Untitled',
          docType: row.doc_type,
          date,
          summary: row.summary || extractedData?.key_takeaway || null,
        };
      });
    }

    const property = {
      id: (propResult as any).id,
      airtableRecordId: airtableId,
      county: (propResult as any).county,
      section: (propResult as any).section,
      township: (propResult as any).township,
      range: (propResult as any).range,
      legal: `S${(propResult as any).section}-${(propResult as any).township}-${(propResult as any).range}`,
    };

    return jsonResponse({
      success: true,
      property,
      documents,
      partyDataGaps,
      unlinkedDocuments,
      queryTime: Date.now() - start,
    });
  } catch (error) {
    console.error('[TitleChain] Chain error:', error);
    return jsonResponse({ error: 'Failed to fetch title chain' }, 500);
  }
}
