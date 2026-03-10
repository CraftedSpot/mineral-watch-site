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
 * Safely coerce a value to string — handles objects from newer extraction schemas.
 * e.g. interest_conveyed may be { fraction_text: "1/2", type: "mineral" }
 */
function asString(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    // Common object shapes from extraction
    return val.fraction_text || val.description || val.text || val.value || val.name || null;
  }
  return null;
}

/**
 * Extract interest conveyed from extracted_data based on doc type
 */
function extractInterest(data: any, docType: string): string | null {
  if (!data) return null;

  // Deeds: interest_conveyed or fraction
  if (docType.includes('deed') || docType === 'conveyance') {
    return asString(data.interest_conveyed) || asString(data.fraction) || asString(data.interest_description) || null;
  }
  // Leases: royalty fraction + primary term
  if (docType.includes('lease') || docType === 'oil_gas_lease' || docType === 'oil_and_gas_lease') {
    const parts = [];
    const rf = asString(data.royalty_fraction);
    if (rf) parts.push(rf + ' royalty');
    if (data.primary_term_years) parts.push(data.primary_term_years + '-year primary');
    return parts.length > 0 ? parts.join(', ') : null;
  }
  // Assignments: assigned interest
  if (docType.includes('assignment')) {
    return asString(data.interest_assigned) || asString(data.assigned_interest) || null;
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
    addArray(data.grantor_names, 'grantor');
    addArray(data.grantee_names, 'grantee');
    add(data.grantor?.name || data.grantor_name || data.grantor, 'grantor');
    add(data.grantee?.name || data.grantee_name || data.grantee, 'grantee');
  }
  // Leases
  else if (docType.includes('lease') || docType === 'oil_gas_lease' || docType === 'oil_and_gas_lease') {
    add(data.lessor?.name || data.lessor_name || data.lessor, 'lessor');
    add(data.lessee?.name || data.lessee_name || data.lessee, 'lessee');
    addArray(data.lessors, 'lessor');
    addArray(data.lessees, 'lessee');
  }
  // Assignments
  else if (docType.includes('assignment')) {
    add(data.assignor?.name || data.assignor_name || data.assignor, 'assignor');
    add(data.assignee?.name || data.assignee_name || data.assignee, 'assignee');
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


// ─── Tree Assembly (pure graph traversal — no matching logic) ─────

interface ChainEdgeRow {
  id: number;
  parent_doc_id: string;
  child_doc_id: string;
  match_type: string;
  match_confidence: number;
  matched_from_name: string | null;
  matched_to_name: string | null;
  edge_type: string | null;
  is_manual: number;
}

interface ChainOwnerRow {
  id: number;
  owner_name: string;
  owner_name_normalized: string;
  acquired_via_doc_id: string | null;
  acquired_date: string | null;
  interest_text: string | null;
  interest_decimal: number | null;
  interest_type: string | null;
  is_manual: number;
}

interface TreeNode {
  id: string;
  docType: string | null;
  category: string | null;
  date: string | null;
  displayName: string;
  fromNames: string[];
  toNames: string[];
  interestConveyed: string | null;
  recording: { book: string | null; page: string | null } | null;
  edgeType: string | null;
  matchType: string | null;
  matchConfidence: number | null;
  stackedDocs: string[];
  _stackedNodes?: Array<{
    id: string;
    docType: string | null;
    date: string | null;
    fromNames: string[];
    toNames: string[];
    interestConveyed: string | null;
    _parties: Array<{ rowId: number; name: string; role: string }>;
    _corrections: Record<string, { id: string; partyRowId: number; original: string; corrected: string }> | null;
  }>;
  children: TreeNode[];
  _corrections: Record<string, { id: string; partyRowId: number; original: string; corrected: string }> | null;
  _parties: Array<{ rowId: number; name: string; role: string }>;
}

interface OrphanDoc {
  id: string;
  docType: string | null;
  category: string | null;
  date: string | null;
  displayName: string;
  fromNames: string[];
  toNames: string[];
  interestConveyed: string | null;
  reason: 'no_parties' | 'no_match' | 'unknown';
  _parties: Array<{ rowId: number; name: string; role: string; isManual?: boolean }>;
  _corrections: Record<string, { id: string; partyRowId: number; original: string; corrected: string }> | null;
}

interface TitleTree {
  roots: TreeNode[];
  gaps: Array<{
    partyName: string;
    lastSeenAs: string;
    lastSeenDocId: string;
    lastSeenDate: string | null;
  }>;
  currentOwners: ChainOwnerRow[];
  orphanDocs: OrphanDoc[];
  stats: {
    totalDocs: number;
    linkedDocs: number;
    stackedGroups: number;
    gapCount: number;
    ownerCount: number;
  };
}

/**
 * Assemble a tree structure from persisted edges + documents.
 * Pure graph traversal — no name matching.
 */
function assembleTree(
  documents: any[],
  edges: ChainEdgeRow[],
  owners: ChainOwnerRow[],
  partiesMap: Record<string, Array<{ name: string; role: string; [key: string]: any }>>,
  correctionsMap: Record<string, Record<string, { id: string; partyRowId: number; original: string; corrected: string }>>
): TitleTree {
  const docMap = new Map<string, any>();
  for (const doc of documents) docMap.set(doc.id, doc);

  // Build adjacency: parent → children
  const childrenOf = new Map<string, { docId: string; edge: ChainEdgeRow }[]>();
  const hasParent = new Set<string>();

  for (const edge of edges) {
    if (!childrenOf.has(edge.parent_doc_id)) childrenOf.set(edge.parent_doc_id, []);
    childrenOf.get(edge.parent_doc_id)!.push({ docId: edge.child_doc_id, edge });
    hasParent.add(edge.child_doc_id);
  }

  // All doc IDs that appear in any edge
  const inEdge = new Set<string>();
  for (const edge of edges) {
    inEdge.add(edge.parent_doc_id);
    inEdge.add(edge.child_doc_id);
  }

  // Orphans: docs with no edges at all — enrich with full metadata + reason
  const orphanDocs: OrphanDoc[] = documents.filter(d => !inEdge.has(d.id)).map(d => {
    const parties = partiesMap[d.id] || [];
    const hasParties = parties.length > 0;
    const reason: OrphanDoc['reason'] = !hasParties ? 'no_parties' : 'no_match';

    const doc = docMap.get(d.id);
    const docType = doc?.docType || d.docType || d.doc_type || null;

    return {
      id: d.id,
      docType,
      category: d.category || null,
      date: d.date || null,
      displayName: d.displayName || d.display_name || 'Untitled',
      fromNames: getPartyNames(d.id, 'from'),
      toNames: getPartyNames(d.id, 'to'),
      interestConveyed: d.interestConveyed || null,
      reason,
      _parties: parties.filter((p: any) => p.rowId > 0).map((p: any) => ({
        rowId: p.rowId, name: p.name, role: p.role, isManual: p.isManual || false,
      })),
      _corrections: correctionsMap[d.id] || null,
    };
  });

  // Roots: docs that are parents but never children
  const rootIds = [...inEdge].filter(id => !hasParent.has(id) && docMap.has(id));
  // Also add docs that are parents but not in our doc list (shouldn't happen, but defensive)

  // Helper: resolve parties for a doc by role
  function getPartyNames(docId: string, roleSide: 'from' | 'to'): string[] {
    const doc = docMap.get(docId);
    if (!doc) return [];
    const parties = partiesMap[docId] || doc.parties || [];
    const docType = doc.docType || '';
    const roles = ARROW_ROLE_TYPES[docType];
    if (!roles) return parties.map((p: any) => p.name);
    const targetRole = roleSide === 'from' ? roles[0] : roles[1];
    return parties.filter((p: any) => p.role === targetRole).map((p: any) => p.name);
  }

  // Helper: extract recording info from doc
  function getRecording(docId: string): { book: string | null; page: string | null } | null {
    const doc = docMap.get(docId);
    if (!doc) return null;
    // Recording info is in extracted_data but not passed through to the flat doc list.
    // The tree nodes just carry doc IDs — frontend calls openDocumentDetail(docId) for full info.
    return null;
  }

  // Stack detection: siblings with same date + same from/to parties
  function detectStacks(childEntries: { docId: string; edge: ChainEdgeRow }[]): { docId: string; edge: ChainEdgeRow; stackedWith: string[] }[] {
    if (childEntries.length <= 1) return childEntries.map(c => ({ ...c, stackedWith: [] }));

    const result: { docId: string; edge: ChainEdgeRow; stackedWith: string[] }[] = [];
    const consumed = new Set<number>();

    for (let i = 0; i < childEntries.length; i++) {
      if (consumed.has(i)) continue;
      const a = childEntries[i];
      const docA = docMap.get(a.docId);
      if (!docA) { result.push({ ...a, stackedWith: [] }); continue; }

      const stacked: string[] = [];
      for (let j = i + 1; j < childEntries.length; j++) {
        if (consumed.has(j)) continue;
        const b = childEntries[j];
        const docB = docMap.get(b.docId);
        if (!docB) continue;

        // Same date + same matched party names → stack
        if (docA.date && docA.date === docB.date &&
            a.edge.matched_from_name === b.edge.matched_from_name &&
            a.edge.matched_to_name === b.edge.matched_to_name) {
          stacked.push(b.docId);
          consumed.add(j);
        }
      }

      result.push({ ...a, stackedWith: stacked });
    }

    return result;
  }

  // Recursive tree builder
  function buildNode(docId: string, edge: ChainEdgeRow | null, stackedWith: string[]): TreeNode {
    const doc = docMap.get(docId);
    const children: TreeNode[] = [];
    let stackedGroups = 0;

    const childEntries = childrenOf.get(docId) || [];
    const withStacks = detectStacks(childEntries);

    for (const child of withStacks) {
      if (docMap.has(child.docId)) {
        children.push(buildNode(child.docId, child.edge, child.stackedWith));
        if (child.stackedWith.length > 0) stackedGroups++;
      }
    }

    // Build stacked node data for secondary docs in this stack
    const stackedNodes = stackedWith.length > 0 ? stackedWith.map(sdId => {
      const sdDoc = docMap.get(sdId);
      return {
        id: sdId,
        docType: sdDoc?.docType || null,
        date: sdDoc?.date || null,
        fromNames: getPartyNames(sdId, 'from'),
        toNames: getPartyNames(sdId, 'to'),
        interestConveyed: sdDoc?.interestConveyed || null,
        _parties: (sdDoc?._parties || []) as Array<{ rowId: number; name: string; role: string }>,
        _corrections: sdDoc?._corrections || null,
      };
    }) : undefined;

    return {
      id: docId,
      docType: doc?.docType || null,
      category: doc?.category || null,
      date: doc?.date || null,
      displayName: doc?.displayName || 'Unknown Document',
      fromNames: getPartyNames(docId, 'from'),
      toNames: getPartyNames(docId, 'to'),
      interestConveyed: doc?.interestConveyed || null,
      summary: doc?.summary || null,
      recording: getRecording(docId),
      edgeType: edge?.edge_type || null,
      matchType: edge?.match_type || null,
      matchConfidence: edge?.match_confidence ?? null,
      stackedDocs: stackedWith,
      _stackedNodes: stackedNodes,
      children,
      _corrections: doc?._corrections || null,
      _parties: (doc?._parties || []) as Array<{ rowId: number; name: string; role: string }>,
    };
  }

  // Build roots
  const roots: TreeNode[] = [];
  for (const rootId of rootIds) {
    roots.push(buildNode(rootId, null, []));
  }

  // Sort roots by date
  roots.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  // Gap detection: "to" parties on leaf ownership docs that aren't in current owners
  // and don't appear as "from" in any later doc
  const ownerNormSet = new Set(owners.map(o => o.owner_name_normalized));
  const gaps: TitleTree['gaps'] = [];

  function findGaps(node: TreeNode) {
    // Leaf node with ownership/succession edge type
    if (node.children.length === 0 && ['ownership', 'succession'].includes(node.edgeType || '')) {
      for (const toName of node.toNames) {
        const norm = toName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        if (!ownerNormSet.has(norm)) {
          gaps.push({
            partyName: toName,
            lastSeenAs: 'grantee',
            lastSeenDocId: node.id,
            lastSeenDate: node.date,
          });
        }
      }
    }
    for (const child of node.children) findGaps(child);
  }
  for (const root of roots) findGaps(root);

  // Count stacked groups
  let totalStackedGroups = 0;
  function countStacks(node: TreeNode) {
    if (node.stackedDocs.length > 0) totalStackedGroups++;
    for (const child of node.children) countStacks(child);
  }
  for (const root of roots) countStacks(root);

  return {
    roots,
    gaps,
    currentOwners: owners,
    orphanDocs,
    stats: {
      totalDocs: documents.length,
      linkedDocs: documents.length - orphanDocs.length,
      stackedGroups: totalStackedGroups,
      gapCount: gaps.length,
      ownerCount: owners.length,
    },
  };
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
        AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
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
        AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
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
        AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
        AND d.doc_type != 'multi_document'
        AND (
          d.property_id = ?
          OR d.property_id LIKE ?
          OR d.property_id LIKE ?
          OR d.property_id LIKE ?
        )
        AND ${docOwner.where}
    `).bind(airtableId, startsWithPattern, endsWithPattern, containsPattern, ...docOwner.params).all();

    // Batch-fetch document_parties for all docs (include dp.id for per-party corrections)
    const docIds = (docsResult.results as any[]).map((r: any) => r.id);
    let partiesMap: Record<string, Array<{ rowId: number; name: string; normalized: string; role: string; date: string | null; isManual?: boolean }>> = {};

    if (docIds.length > 0) {
      // Query in batches of 30 to stay under D1 bind limit
      const BATCH = 30;
      for (let i = 0; i < docIds.length; i += BATCH) {
        const batch = docIds.slice(i, i + BATCH);
        const placeholders = batch.map(() => '?').join(',');
        const partiesResult = await env.WELLS_DB.prepare(`
          SELECT id, document_id, party_name, party_name_normalized, party_role, document_date, is_manual
          FROM document_parties
          WHERE document_id IN (${placeholders}) AND is_deleted = 0
          ORDER BY party_role, party_name
        `).bind(...batch).all();

        for (const row of partiesResult.results as any[]) {
          if (!partiesMap[row.document_id]) partiesMap[row.document_id] = [];
          partiesMap[row.document_id].push({
            rowId: row.id as number,
            name: row.party_name,
            normalized: row.party_name_normalized || '',
            role: row.party_role,
            date: row.document_date,
            isManual: row.is_manual === 1,
          });
        }
      }
    }

    // Fetch user corrections for all docs — keyed by party_row_id
    // Corrections are already written back to document_parties (party_name + normalized),
    // so partiesMap already has corrected names. This is metadata for the edit UI.
    let correctionsMap: Record<string, Record<string, { id: string; partyRowId: number; original: string; corrected: string }>> = {};
    if (docIds.length > 0) {
      const CORR_BATCH = 30;
      for (let i = 0; i < docIds.length; i += CORR_BATCH) {
        const batch = docIds.slice(i, i + CORR_BATCH);
        const placeholders = batch.map(() => '?').join(',');
        const corrResult = await env.WELLS_DB.prepare(`
          SELECT id, document_id, field, party_row_id, original_value, corrected_value
          FROM user_corrections
          WHERE document_id IN (${placeholders}) AND party_row_id IS NOT NULL
        `).bind(...batch).all();
        for (const row of corrResult.results as any[]) {
          if (!correctionsMap[row.document_id]) correctionsMap[row.document_id] = {};
          correctionsMap[row.document_id][String(row.party_row_id)] = {
            id: row.id, partyRowId: row.party_row_id as number,
            original: row.original_value, corrected: row.corrected_value,
          };
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
        parties = extractPartiesFromJson(extractedData, row.doc_type || '').map((p, idx) => ({
          ...p,
          rowId: -1 - idx, // Negative sentinel — no document_parties row
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
        _parties: parties.filter((p: any) => p.rowId > 0).map((p: any) => ({ rowId: p.rowId, name: p.name, role: p.role, isManual: p.isManual || false })),
        interestConveyed: interest,
        summary: row.summary || asString(extractedData?.key_takeaway) || null,
        r2Key: row.r2_key,
        _corrections: correctionsMap[row.id] || null,
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
          AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
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

    // Fetch pending duplicate docs for this property
    const pendingDupsResult = await env.WELLS_DB.prepare(`
      SELECT d.id, d.display_name, d.filename, d.doc_type, d.duplicate_of_doc_id, d.duplicate_match_type
      FROM documents d
      WHERE d.chain_of_title = 1
        AND d.duplicate_status = 'pending_review'
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND (
          d.property_id = ?
          OR d.property_id LIKE ?
          OR d.property_id LIKE ?
          OR d.property_id LIKE ?
        )
        AND ${docOwner.where}
    `).bind(airtableId, startsWithPattern, endsWithPattern, containsPattern, ...docOwner.params).all();

    // Also include pending dups where the *keeper* is on this property but the candidate isn't directly linked
    const keeperDupsResult = await env.WELLS_DB.prepare(`
      SELECT d.id, d.display_name, d.filename, d.doc_type, d.duplicate_of_doc_id, d.duplicate_match_type
      FROM documents d
      WHERE d.chain_of_title = 1
        AND d.duplicate_status = 'pending_review'
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.duplicate_of_doc_id IN (
          SELECT id FROM documents WHERE (
            property_id = ?
            OR property_id LIKE ?
            OR property_id LIKE ?
            OR property_id LIKE ?
          )
        )
        AND ${docOwner.where}
    `).bind(airtableId, startsWithPattern, endsWithPattern, containsPattern, ...docOwner.params).all();

    // Merge and deduplicate
    const seenDupIds = new Set<string>();
    const pendingDuplicates: any[] = [];
    for (const row of [...(pendingDupsResult.results as any[]), ...(keeperDupsResult.results as any[])]) {
      if (seenDupIds.has(row.id)) continue;
      seenDupIds.add(row.id);

      // Get keeper's display name
      let keeperName = '';
      if (row.duplicate_of_doc_id) {
        const keeper = await env.WELLS_DB.prepare(
          `SELECT display_name, filename FROM documents WHERE id = ?`
        ).bind(row.duplicate_of_doc_id).first<any>();
        keeperName = keeper?.display_name || keeper?.filename || 'Unknown';
      }

      pendingDuplicates.push({
        id: row.id,
        displayName: row.display_name || row.filename || 'Untitled',
        docType: row.doc_type,
        duplicateOfDocId: row.duplicate_of_doc_id,
        matchType: row.duplicate_match_type,
        keeperName,
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

    // ─── Tree view: ?include_tree=1 ─────────────────────────────────
    let tree: TitleTree | null = null;
    const includeTree = url.searchParams.get('include_tree') === '1';

    if (includeTree) {
      try {
        // 1. Check cache
        const cached = await env.WELLS_DB.prepare(
          `SELECT tree_json FROM chain_tree_cache WHERE property_id = ? AND invalidated_at IS NULL`
        ).bind(airtableId).first<any>();

        if (cached?.tree_json) {
          tree = JSON.parse(cached.tree_json);
        } else {
          // 2. Cache miss or invalid — trigger edge rebuild via service binding
          if (env.DOCUMENTS_WORKER) {
            try {
              await env.DOCUMENTS_WORKER.fetch(new Request('https://internal/api/internal/build-chain-edges', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ property_id: airtableId }),
              }));
            } catch (err) {
              console.error('[TitleTree] Edge rebuild via service binding failed:', err);
            }
          }

          // 3. Read freshly-built edges
          const edgesResult = await env.WELLS_DB.prepare(
            `SELECT id, parent_doc_id, child_doc_id, match_type, match_confidence,
                    matched_from_name, matched_to_name, edge_type, is_manual
             FROM document_chain_edges WHERE property_id = ?`
          ).bind(airtableId).all();

          const ownersResult = await env.WELLS_DB.prepare(
            `SELECT id, owner_name, owner_name_normalized, acquired_via_doc_id,
                    acquired_date, interest_text, interest_decimal, interest_type, is_manual
             FROM chain_current_owners WHERE property_id = ?`
          ).bind(airtableId).all();

          // 4. Assemble tree (pure graph traversal)
          tree = assembleTree(
            documents,
            (edgesResult.results || []) as unknown as ChainEdgeRow[],
            (ownersResult.results || []) as unknown as ChainOwnerRow[],
            partiesMap,
            correctionsMap
          );

          // 4b. Post-process: resolve source party row IDs + attach source doc data for current owners
          const GRANTEE_SIDE_ROLES = ['grantee', 'lessee', 'assignee', 'heir', 'beneficiary', 'owner'];
          for (const owner of tree.currentOwners) {
            if (!owner.acquired_via_doc_id) continue;
            const docParties = partiesMap[owner.acquired_via_doc_id];
            if (docParties) {
              // Find matching grantee-side party by normalized name
              const match = docParties.find(p =>
                GRANTEE_SIDE_ROLES.includes(p.role) &&
                p.normalized === owner.owner_name_normalized
              );
              if (match) {
                (owner as any).source_party_row_id = match.rowId;
                const docCorr = correctionsMap[owner.acquired_via_doc_id];
                if (docCorr?.[String(match.rowId)]) {
                  (owner as any).source_correction = docCorr[String(match.rowId)];
                }
              }
              // Attach all source doc parties for Document tab party strip
              (owner as any)._sourceParties = docParties
                .filter(p => p.rowId > 0)
                .map(p => ({ rowId: p.rowId, name: p.name, role: p.role, isManual: p.isManual || false }));
            }
            // Attach source doc corrections
            const docCorrAll = correctionsMap[owner.acquired_via_doc_id];
            if (docCorrAll) {
              (owner as any)._sourceCorrections = docCorrAll;
            }
          }

          // 5. Cache the result
          try {
            await env.WELLS_DB.prepare(
              `INSERT OR REPLACE INTO chain_tree_cache (property_id, tree_json, doc_count) VALUES (?, ?, ?)`
            ).bind(airtableId, JSON.stringify(tree), documents.length).run();
          } catch (cacheErr) {
            console.error('[TitleTree] Cache write error:', cacheErr);
          }
        }
      } catch (treeErr) {
        console.error('[TitleTree] Tree assembly error:', treeErr);
        // Non-fatal — still return documents without tree
      }
    }

    return jsonResponse({
      success: true,
      property,
      documents,
      partyDataGaps,
      unlinkedDocuments,
      pendingDuplicates,
      pendingDuplicateCount: pendingDuplicates.length,
      ...(tree ? { tree } : {}),
      queryTime: Date.now() - start,
    });
  } catch (error) {
    console.error('[TitleChain] Chain error:', error);
    return jsonResponse({ error: 'Failed to fetch title chain' }, 500);
  }
}
