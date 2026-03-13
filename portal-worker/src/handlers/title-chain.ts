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
    // Fallback: extraction sometimes uses lessor/lessee or assignor/assignee keys for deeds
    if (parties.length === 0) {
      add(data.lessor?.name || data.lessor_name || data.lessor, 'grantor');
      add(data.lessee?.name || data.lessee_name || data.lessee, 'grantee');
    }
    if (parties.length === 0) {
      add(data.assignor?.name || data.assignor_name || data.assignor, 'grantor');
      add(data.assignee?.name || data.assignee_name || data.assignee, 'grantee');
    }
  }
  // Leases
  else if (docType.includes('lease') || docType === 'oil_gas_lease' || docType === 'oil_and_gas_lease') {
    add(data.lessor?.name || data.lessor_name || data.lessor, 'lessor');
    add(data.lessee?.name || data.lessee_name || data.lessee, 'lessee');
    addArray(data.lessors, 'lessor');
    addArray(data.lessees, 'lessee');
  }
  // Assignments
  else if (docType.includes('assignment') || docType === 'well_transfer') {
    add(data.assignor?.name || data.assignor_name || data.assignor, 'assignor');
    add(data.assignee?.name || data.assignee_name || data.assignee, 'assignee');
    // Fallback for well_transfer with grantor/grantee keys
    if (parties.length === 0) {
      add(data.grantor?.name || data.grantor, 'grantor');
      add(data.grantee?.name || data.grantee, 'grantee');
    }
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
  hiddenDuplicates?: number;
}

interface ChainGap {
  partyName: string;
  lastSeenAs: string;
  lastSeenDocId: string;
  lastSeenDate: string | null;
  county: string | null;
  section: string | null;
  township: string | null;
  range: string | null;
  suggestedTypes: string[];
  lastSeenDocType: string | null;
  grantorName: string | null;
}

interface TitleTree {
  roots: TreeNode[];
  gaps: ChainGap[];
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

// ─── Gap analysis helpers ─────────────────────────────────────

function extractLastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
}

function extractFirstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, -1).join(' ').toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

function suggestGapDocTypes(context: {
  partyName?: string;
  lastSeenAs?: string;
  lastSeenDocType?: string | null;
}): string[] {
  const name = (context.partyName || '').toLowerCase();
  const docType = (context.lastSeenDocType || '').toLowerCase();

  // Implied death (from name-change detection)
  if (context.lastSeenAs === 'implied_death') {
    return ['Affidavit of Heirship', 'Mineral Deed', 'Quit Claim Deed'];
  }

  // Death indicators in party name
  if (name.includes('estate') || name.includes('heirs of') || name.includes('trustee')) {
    return ['Affidavit of Heirship', 'Mineral Deed', 'Quit Claim Deed'];
  }

  // Corporate/LLC name
  if (name.includes('llc') || name.includes('inc') || name.includes('corp') ||
      name.includes('company') || name.includes('partners')) {
    return ['Assignment', 'Mineral Deed', 'Deed & Conveyance'];
  }

  // Last doc was a lease
  if (docType.includes('lease')) {
    return ['Assignment', 'Partial Assignment', 'Oil & Gas Lease'];
  }

  // Default
  return ['Mineral Deed', 'Warranty Deed', 'Quit Claim Deed', 'Affidavit of Heirship'];
}

/**
 * Extract recording info from a doc's _recording field (populated during doc mapping).
 */
function getRecordingKey(doc: any): string | null {
  const rec = doc?._recording;
  if (!rec || !rec.book || !rec.page) return null;
  const county = (rec.county || '').toLowerCase().trim();
  const book = String(rec.book).toLowerCase().trim();
  const page = String(rec.page).toLowerCase().trim();
  if (!county || !book || !page) return null;
  return `${county}|${book}|${page}`;
}

/**
 * Collapse orphans that share the same county+book+page.
 * Read-only — no D1 writes. Picks the first orphan (by date, then id) as keeper.
 */
function deduplicateOrphans(orphans: OrphanDoc[], docMap: Map<string, any>): OrphanDoc[] {
  const consumed = new Set<string>(); // orphan IDs already collapsed

  // Pass 1: Group by county+book+page (recording key)
  const bookPageGroups = new Map<string, OrphanDoc[]>();
  for (const orphan of orphans) {
    const doc = docMap.get(orphan.id);
    const key = getRecordingKey(doc);
    if (key) {
      if (!bookPageGroups.has(key)) bookPageGroups.set(key, []);
      bookPageGroups.get(key)!.push(orphan);
    }
  }
  for (const [, group] of bookPageGroups) {
    if (group.length < 2) continue;
    sortOrphanGroup(group);
    for (let i = 1; i < group.length; i++) consumed.add(group[i].id);
    group[0].hiddenDuplicates = (group[0].hiddenDuplicates || 0) + group.length - 1;
  }

  // Pass 2: Tier 2 — county+docType+date with bidirectional party overlap
  const remaining = orphans.filter(o => !consumed.has(o.id));
  const dateGroups = new Map<string, OrphanDoc[]>();
  for (const orphan of remaining) {
    const doc = docMap.get(orphan.id);
    const county = (doc?._recording?.county || '').toLowerCase().trim();
    const docType = (doc?.docType || '').toLowerCase().trim();
    const date = orphan.date || '';
    if (!county || !docType || !date) continue;
    const key = `${county}|${docType}|${date}`;
    if (!dateGroups.has(key)) dateGroups.set(key, []);
    dateGroups.get(key)!.push(orphan);
  }
  for (const [, group] of dateGroups) {
    if (group.length < 2) continue;
    // Check bidirectional party overlap within group
    const clusters: OrphanDoc[][] = [];
    const used = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (used.has(i)) continue;
      const a = group[i];
      const aFrom = new Set(a.fromNames.map(n => n.toLowerCase()));
      const aTo = new Set(a.toNames.map(n => n.toLowerCase()));
      if (!aFrom.size || !aTo.size) continue;
      const cluster = [a];
      used.add(i);
      for (let j = i + 1; j < group.length; j++) {
        if (used.has(j)) continue;
        const b = group[j];
        const bFrom = new Set(b.fromNames.map(n => n.toLowerCase()));
        const bTo = new Set(b.toNames.map(n => n.toLowerCase()));
        if (!bFrom.size || !bTo.size) continue;
        let fromMatch = false;
        for (const n of aFrom) { if (bFrom.has(n)) { fromMatch = true; break; } }
        if (!fromMatch) continue;
        let toMatch = false;
        for (const n of aTo) { if (bTo.has(n)) { toMatch = true; break; } }
        if (!toMatch) continue;
        cluster.push(b);
        used.add(j);
      }
      if (cluster.length > 1) clusters.push(cluster);
    }
    for (const cluster of clusters) {
      sortOrphanGroup(cluster);
      for (let i = 1; i < cluster.length; i++) consumed.add(cluster[i].id);
      cluster[0].hiddenDuplicates = (cluster[0].hiddenDuplicates || 0) + cluster.length - 1;
    }
  }

  return orphans.filter(o => !consumed.has(o.id));
}

function sortOrphanGroup(group: OrphanDoc[]): void {
  group.sort((a, b) => {
    const aCorrected = a._corrections && Object.keys(a._corrections).length > 0 ? 1 : 0;
    const bCorrected = b._corrections && Object.keys(b._corrections).length > 0 ? 1 : 0;
    if (aCorrected !== bCorrected) return bCorrected - aCorrected;
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.id.localeCompare(b.id);
  });
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
  const rawOrphans: OrphanDoc[] = documents.filter(d => !inEdge.has(d.id)).map(d => {
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

  // Orphan dedup: collapse same-book-page orphans (read-only, no D1 writes)
  const orphanDocs = deduplicateOrphans(rawOrphans, docMap);

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

  // Recursive tree builder — visited set prevents cycles from blowing the stack
  const visited = new Set<string>();
  function buildNode(docId: string, edge: ChainEdgeRow | null, stackedWith: string[]): TreeNode {
    const doc = docMap.get(docId);
    const children: TreeNode[] = [];
    let stackedGroups = 0;

    if (!visited.has(docId)) {
      visited.add(docId);
      const childEntries = childrenOf.get(docId) || [];
      const withStacks = detectStacks(childEntries);

      for (const child of withStacks) {
        if (docMap.has(child.docId) && !visited.has(child.docId)) {
          children.push(buildNode(child.docId, child.edge, child.stackedWith));
          if (child.stackedWith.length > 0) stackedGroups++;
        }
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
  const gaps: ChainGap[] = [];

  function findGaps(node: TreeNode) {
    // Leaf node with ownership/succession edge type
    if (node.children.length === 0 && ['ownership', 'succession'].includes(node.edgeType || '')) {
      const doc = docMap.get(node.id);
      const docType = doc?.docType || null;
      for (const toName of node.toNames) {
        const norm = toName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        if (!ownerNormSet.has(norm)) {
          gaps.push({
            partyName: toName,
            lastSeenAs: 'grantee',
            lastSeenDocId: node.id,
            lastSeenDate: node.date,
            county: null, section: null, township: null, range: null, // enriched post-assembly
            lastSeenDocType: docType,
            grantorName: node.fromNames[0] || null,
            suggestedTypes: suggestGapDocTypes({ partyName: toName, lastSeenAs: 'grantee', lastSeenDocType: docType }),
          });
        }
      }
    }
    for (const child of node.children) findGaps(child);
  }
  for (const root of roots) findGaps(root);

  // Implied-death gap detection: parent→child where last name matches but first name changes
  // (implies death/inheritance with no probate or heirship in the chain)
  const HEIRSHIP_TYPES = new Set(['affidavit_of_heirship', 'probate', 'death_certificate']);
  function hasHeirshipBetween(parent: TreeNode, child: TreeNode): boolean {
    // Check if any node between parent and child is an heirship-type doc
    for (const c of parent.children) {
      const doc = docMap.get(c.id);
      if (doc?.docType && HEIRSHIP_TYPES.has(doc.docType)) return true;
      if (c === child) continue;
      if (hasHeirshipBetween(c, child)) return true;
    }
    return false;
  }

  function findImpliedDeathGaps(node: TreeNode) {
    for (const child of node.children) {
      for (const toName of node.toNames) {
        for (const fromName of child.fromNames) {
          const toLast = extractLastName(toName);
          const fromLast = extractLastName(fromName);
          const toFirst = extractFirstName(toName);
          const fromFirst = extractFirstName(fromName);
          if (toLast && toFirst && fromFirst && toLast === fromLast && toFirst !== fromFirst) {
            // Check no heirship doc exists between them
            if (!hasHeirshipBetween(node, child)) {
              // Don't duplicate if already flagged as a regular gap
              const alreadyGapped = gaps.some(g =>
                g.partyName === toName && g.lastSeenDocId === node.id
              );
              if (!alreadyGapped) {
                const doc = docMap.get(node.id);
                gaps.push({
                  partyName: toName,
                  lastSeenAs: 'implied_death',
                  lastSeenDocId: node.id,
                  lastSeenDate: node.date,
                  county: null, section: null, township: null, range: null,
                  lastSeenDocType: doc?.docType || null,
                  grantorName: node.fromNames[0] || null,
                  suggestedTypes: ['Affidavit of Heirship', 'Mineral Deed', 'Quit Claim Deed'],
                });
              }
            }
          }
        }
      }
      findImpliedDeathGaps(child);
    }
  }
  for (const root of roots) findImpliedDeathGaps(root);

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

    // Properties with chain docs — grouped by TRS to deduplicate multi-entity properties
    const propsResult = await env.WELLS_DB.prepare(`
      SELECT
        MIN(p.id) as id,
        MIN(p.airtable_record_id) as airtable_record_id,
        p.county,
        p.section,
        p.township,
        p.range,
        COUNT(DISTINCT d.id) as chain_doc_count,
        GROUP_CONCAT(DISTINCT p.airtable_record_id) as all_record_ids
      FROM documents d
      JOIN properties p ON (
        d.property_id = p.airtable_record_id
        OR d.property_id LIKE p.airtable_record_id || ',%'
        OR d.property_id LIKE '%,' || p.airtable_record_id
        OR d.property_id LIKE '%,' || p.airtable_record_id || ',%'
      )
      WHERE d.chain_of_title = 1
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.status = 'complete'
        AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
        AND ${docOwner.where}
      GROUP BY p.county, p.section, p.township, p.range
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
      allRecordIds: row.all_record_ids ? (row.all_record_ids as string).split(',') : [row.airtable_record_id],
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

    // Find all sibling property records for the same TRS (multi-entity dedup)
    const prop = propResult as any;
    const siblingResult = await env.WELLS_DB.prepare(`
      SELECT airtable_record_id FROM properties
      WHERE county = ? AND section = ? AND township = ? AND range = ?
        AND (user_id = ? OR organization_id = ?)
    `).bind(prop.county, prop.section, prop.township, prop.range, authUser.id, userOrgId || '').all();
    const allPropertyIds = (siblingResult.results as any[]).map((r: any) => r.airtable_record_id as string);
    if (!allPropertyIds.includes(airtableId)) allPropertyIds.push(airtableId);

    // Build LIKE conditions for all property IDs (handles comma-separated property_id)
    const propConditions: string[] = [];
    const propParams: string[] = [];
    for (const pid of allPropertyIds) {
      propConditions.push('d.property_id = ?', 'd.property_id LIKE ?', 'd.property_id LIKE ?', 'd.property_id LIKE ?');
      propParams.push(pid, `${pid},%`, `%,${pid}`, `%,${pid},%`);
    }

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
        d.upload_date,
        d.county
      FROM documents d
      WHERE d.chain_of_title = 1
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.status = 'complete'
        AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
        AND d.doc_type != 'multi_document'
        AND NOT EXISTS (
          SELECT 1 FROM documents child
          WHERE child.parent_document_id = d.id
            AND (child.deleted_at IS NULL OR child.deleted_at = '')
            AND child.status = 'complete'
        )
        AND (${propConditions.join(' OR ')})
        AND ${docOwner.where}
    `).bind(...propParams, ...docOwner.params).all();

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

      // Extract recording info for dedup
      const ri = extractedData?.recording_info || extractedData?.recording || {};
      const recBook = asString(ri.book) || null;
      const recPage = asString(ri.page) || null;
      const recInstrument = asString(ri.instrument_number) || asString(extractedData?.instrument_number) || null;
      const recCounty = row.county || asString(extractedData?.county) || null;

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
        _recording: { book: recBook, page: recPage, instrumentNumber: recInstrument, county: recCounty },
        _uploadDate: row.upload_date,
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
        AND (${propConditions.join(' OR ')})
        AND ${docOwner.where}
    `).bind(...propParams, ...docOwner.params).all();

    // Also include pending dups where the *keeper* is on this property but the candidate isn't directly linked
    const keeperDupsResult = await env.WELLS_DB.prepare(`
      SELECT d.id, d.display_name, d.filename, d.doc_type, d.duplicate_of_doc_id, d.duplicate_match_type
      FROM documents d
      WHERE d.chain_of_title = 1
        AND d.duplicate_status = 'pending_review'
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.duplicate_of_doc_id IN (
          SELECT id FROM documents WHERE (${propConditions.join(' OR ')})
        )
        AND ${docOwner.where}
    `).bind(...propParams, ...docOwner.params).all();

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
                body: JSON.stringify({ property_id: airtableId, sibling_property_ids: allPropertyIds }),
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

          // 4c. Enrich gaps with property-level TRS/county
          for (const gap of tree.gaps) {
            gap.county = property.county;
            gap.section = property.section;
            gap.township = property.township;
            gap.range = property.range;
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
      } catch (treeErr: any) {
        console.error('[TitleTree] Tree assembly error:', treeErr?.message, treeErr?.stack);
        // Non-fatal — still return documents without tree, but surface error for diagnostics
        return jsonResponse({
          success: true,
          property,
          documents,
          partyDataGaps,
          unlinkedDocuments,
          pendingDuplicates,
          pendingDuplicateCount: pendingDuplicates.length,
          _treeError: treeErr?.message || 'Unknown tree assembly error',
          queryTime: Date.now() - start,
        });
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

// ─── Retroactive Duplicate Detection ────────────────────────────

function asStringOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s || null;
}

interface DedupDoc {
  id: string;
  county: string | null;
  docType: string | null;
  date: string | null;
  confidence: number;
  uploadDate: string | null;
  book: string | null;
  page: string | null;
  instrumentNumber: string | null;
  recordingYear: string | null;
  hasCorrections: boolean;
  extractedFieldCount: number;
}

function selectKeeper(docs: DedupDoc[]): DedupDoc {
  return docs.sort((a, b) => {
    // 1. Has user corrections wins
    if (a.hasCorrections !== b.hasCorrections) return a.hasCorrections ? -1 : 1;
    // 2. Higher confidence
    if ((a.confidence || 0) !== (b.confidence || 0)) return (b.confidence || 0) - (a.confidence || 0);
    // 3. More extracted fields
    if (a.extractedFieldCount !== b.extractedFieldCount) return b.extractedFieldCount - a.extractedFieldCount;
    // 4. Earlier upload date
    if (a.uploadDate && b.uploadDate) return a.uploadDate.localeCompare(b.uploadDate);
    if (a.uploadDate) return -1;
    if (b.uploadDate) return 1;
    return 0;
  })[0];
}

/**
 * POST /api/property/:propertyId/dedup-scan
 * Scans chain-of-title documents for a property and flags duplicates.
 */
export async function handleDedupScan(propertyId: string, request: Request, env: Env) {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0];
    const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
    const docOwner = buildOwnershipFilter('d', userOrgId, authUser.id, memberIds, { includeUserId: true });

    // Resolve property
    const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
    const propResult = await env.WELLS_DB.prepare(`
      SELECT id, airtable_record_id, county, section, township, range
      FROM properties WHERE airtable_record_id = ? OR id = ? LIMIT 1
    `).bind(bareId, propertyId).first() as any;
    if (!propResult) return jsonResponse({ error: 'Property not found' }, 404);

    const airtableId = propResult.airtable_record_id;

    // Find sibling property IDs for same TRS
    const siblingResult = await env.WELLS_DB.prepare(`
      SELECT airtable_record_id FROM properties
      WHERE county = ? AND section = ? AND township = ? AND range = ?
        AND (user_id = ? OR organization_id = ?)
    `).bind(propResult.county, propResult.section, propResult.township, propResult.range, authUser.id, userOrgId || '').all();
    const allPropertyIds = (siblingResult.results as any[]).map((r: any) => r.airtable_record_id as string);
    if (!allPropertyIds.includes(airtableId)) allPropertyIds.push(airtableId);

    // Build property filter
    const propConditions: string[] = [];
    const propParams: string[] = [];
    for (const pid of allPropertyIds) {
      propConditions.push('d.property_id = ?', 'd.property_id LIKE ?', 'd.property_id LIKE ?', 'd.property_id LIKE ?');
      propParams.push(pid, `${pid},%`, `%,${pid}`, `%,${pid},%`);
    }

    // Load all chain-of-title docs (not already flagged)
    const docsResult = await env.WELLS_DB.prepare(`
      SELECT d.id, d.county, d.doc_type, d.confidence, d.upload_date, d.extracted_data
      FROM documents d
      WHERE d.chain_of_title = 1
        AND (d.deleted_at IS NULL OR d.deleted_at = '')
        AND d.status = 'complete'
        AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
        AND d.doc_type != 'multi_document'
        AND NOT EXISTS (
          SELECT 1 FROM documents child
          WHERE child.parent_document_id = d.id
            AND (child.deleted_at IS NULL OR child.deleted_at = '')
            AND child.status = 'complete'
        )
        AND (${propConditions.join(' OR ')})
        AND ${docOwner.where}
    `).bind(...propParams, ...docOwner.params).all();

    const docIds = (docsResult.results as any[]).map((r: any) => r.id as string);
    if (docIds.length === 0) {
      return jsonResponse({ success: true, docsScanned: 0, totalFlagged: 0 });
    }

    // Check which docs have user corrections (batch query)
    const correctedDocIds = new Set<string>();
    const CORR_BATCH = 30;
    for (let i = 0; i < docIds.length; i += CORR_BATCH) {
      const batch = docIds.slice(i, i + CORR_BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const corrResult = await env.WELLS_DB.prepare(
        `SELECT DISTINCT document_id FROM user_corrections WHERE document_id IN (${placeholders})`
      ).bind(...batch).all();
      for (const row of corrResult.results as any[]) {
        correctedDocIds.add(row.document_id as string);
      }
    }

    // Parse docs into DedupDoc objects
    const docs: DedupDoc[] = (docsResult.results as any[]).map((row: any) => {
      let ed: any = null;
      try { ed = row.extracted_data ? JSON.parse(row.extracted_data) : null; } catch {}
      const ri = ed?.recording_info || ed?.recording || {};
      const recDate = asStringOrNull(ri.recording_date);

      let fieldCount = 0;
      if (ed) {
        for (const key of Object.keys(ed)) {
          if (ed[key] !== null && ed[key] !== undefined && ed[key] !== '') fieldCount++;
        }
      }

      // Extract execution date for Tier 2
      const execDate = asStringOrNull(ed?.execution_date) || asStringOrNull(ed?.date) || null;

      return {
        id: row.id,
        county: (row.county || asStringOrNull(ed?.county) || '').toLowerCase().trim() || null,
        docType: row.doc_type || null,
        date: execDate,
        confidence: row.confidence || 0,
        uploadDate: row.upload_date || null,
        book: asStringOrNull(ri.book)?.toLowerCase() || null,
        page: asStringOrNull(ri.page)?.toLowerCase() || null,
        instrumentNumber: (asStringOrNull(ri.instrument_number) || asStringOrNull(ed?.instrument_number))?.toLowerCase() || null,
        recordingYear: recDate ? recDate.substring(0, 4) : null,
        hasCorrections: correctedDocIds.has(row.id),
        extractedFieldCount: fieldCount,
      };
    });

    // Load parties for all docs (needed for Tier 2)
    const FROM_ROLES = new Set(['grantor', 'lessor', 'assignor', 'decedent']);
    const TO_ROLES = new Set(['grantee', 'lessee', 'assignee']);
    const docFromParties = new Map<string, Set<string>>(); // normalized grantor names
    const docToParties = new Map<string, Set<string>>();   // normalized grantee names
    const PARTY_BATCH = 30;
    for (let i = 0; i < docIds.length; i += PARTY_BATCH) {
      const batch = docIds.slice(i, i + PARTY_BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const partiesResult = await env.WELLS_DB.prepare(
        `SELECT document_id, party_name_normalized, party_role FROM document_parties
         WHERE document_id IN (${placeholders}) AND is_deleted = 0`
      ).bind(...batch).all();
      for (const row of partiesResult.results as any[]) {
        const norm = (row.party_name_normalized || '').toLowerCase().trim();
        if (!norm) continue;
        const role = (row.party_role || '').toLowerCase();
        if (FROM_ROLES.has(role)) {
          if (!docFromParties.has(row.document_id)) docFromParties.set(row.document_id, new Set());
          docFromParties.get(row.document_id)!.add(norm);
        } else if (TO_ROLES.has(role)) {
          if (!docToParties.has(row.document_id)) docToParties.set(row.document_id, new Set());
          docToParties.get(row.document_id)!.add(norm);
        }
      }
    }

    const flagged: Array<{ candidateId: string; keeperId: string; matchType: string }> = [];
    const alreadyFlagged = new Set<string>();

    // Tier 1a: Group by county + instrument_number + recording_year
    const tier1aGroups = new Map<string, DedupDoc[]>();
    for (const doc of docs) {
      if (!doc.county || !doc.instrumentNumber || !doc.recordingYear) continue;
      const key = `${doc.county}|${doc.instrumentNumber}|${doc.recordingYear}`;
      if (!tier1aGroups.has(key)) tier1aGroups.set(key, []);
      tier1aGroups.get(key)!.push(doc);
    }
    for (const [, group] of tier1aGroups) {
      if (group.length < 2) continue;
      const keeper = selectKeeper(group);
      for (const doc of group) {
        if (doc.id !== keeper.id && !alreadyFlagged.has(doc.id)) {
          flagged.push({ candidateId: doc.id, keeperId: keeper.id, matchType: 'instrument_number' });
          alreadyFlagged.add(doc.id);
        }
      }
    }

    // Tier 1b: Group by county + book + page (skip already-flagged)
    const tier1bGroups = new Map<string, DedupDoc[]>();
    for (const doc of docs) {
      if (alreadyFlagged.has(doc.id)) continue;
      if (!doc.county || !doc.book || !doc.page) continue;
      const key = `${doc.county}|${doc.book}|${doc.page}`;
      if (!tier1bGroups.has(key)) tier1bGroups.set(key, []);
      tier1bGroups.get(key)!.push(doc);
    }
    for (const [, group] of tier1bGroups) {
      if (group.length < 2) continue;
      const keeper = selectKeeper(group);
      for (const doc of group) {
        if (doc.id !== keeper.id && !alreadyFlagged.has(doc.id)) {
          flagged.push({ candidateId: doc.id, keeperId: keeper.id, matchType: 'book_page' });
          alreadyFlagged.add(doc.id);
        }
      }
    }

    // Tier 2: Group by county + doc_type + date, then check bidirectional party overlap
    // Requires BOTH a grantor AND a grantee to match between two docs
    const tier2Groups = new Map<string, DedupDoc[]>();
    for (const doc of docs) {
      if (alreadyFlagged.has(doc.id)) continue;
      if (!doc.county || !doc.docType || !doc.date) continue;
      const key = `${doc.county}|${doc.docType}|${doc.date}`;
      if (!tier2Groups.has(key)) tier2Groups.set(key, []);
      tier2Groups.get(key)!.push(doc);
    }
    for (const [, group] of tier2Groups) {
      if (group.length < 2) continue;
      // Within each group, find pairs with bidirectional party overlap
      // Build clusters of docs that share both a grantor and a grantee
      const clusters: DedupDoc[][] = [];
      const consumed = new Set<number>();
      for (let i = 0; i < group.length; i++) {
        if (consumed.has(i)) continue;
        const cluster = [group[i]];
        consumed.add(i);
        const aFrom = docFromParties.get(group[i].id);
        const aTo = docToParties.get(group[i].id);
        if (!aFrom?.size || !aTo?.size) continue; // need both sides

        for (let j = i + 1; j < group.length; j++) {
          if (consumed.has(j)) continue;
          const bFrom = docFromParties.get(group[j].id);
          const bTo = docToParties.get(group[j].id);
          if (!bFrom?.size || !bTo?.size) continue;

          // Check: at least one grantor overlaps AND at least one grantee overlaps
          let fromOverlap = false;
          for (const name of aFrom) { if (bFrom.has(name)) { fromOverlap = true; break; } }
          if (!fromOverlap) continue;
          let toOverlap = false;
          for (const name of aTo) { if (bTo.has(name)) { toOverlap = true; break; } }
          if (!toOverlap) continue;

          cluster.push(group[j]);
          consumed.add(j);
        }
        if (cluster.length > 1) clusters.push(cluster);
      }

      for (const cluster of clusters) {
        const keeper = selectKeeper(cluster);
        for (const doc of cluster) {
          if (doc.id !== keeper.id && !alreadyFlagged.has(doc.id)) {
            flagged.push({ candidateId: doc.id, keeperId: keeper.id, matchType: 'party_date' });
            alreadyFlagged.add(doc.id);
          }
        }
      }
    }

    // Write flags in batches
    const now = new Date().toISOString();
    const BATCH_SIZE = 100;
    for (let i = 0; i < flagged.length; i += BATCH_SIZE) {
      const batch = flagged.slice(i, i + BATCH_SIZE);
      const stmts = batch.map(f =>
        env.WELLS_DB.prepare(`
          UPDATE documents
          SET duplicate_of_doc_id = ?, duplicate_status = 'pending_review',
              duplicate_match_type = ?, duplicate_detected_at = ?
          WHERE id = ?
        `).bind(f.keeperId, f.matchType, now, f.candidateId)
      );
      await env.WELLS_DB.batch(stmts);
    }

    const tier1aCount = flagged.filter(f => f.matchType === 'instrument_number').length;
    const tier1bCount = flagged.filter(f => f.matchType === 'book_page').length;
    const tier2Count = flagged.filter(f => f.matchType === 'party_date').length;

    return jsonResponse({
      success: true,
      docsScanned: docs.length,
      tier1aDuplicates: tier1aCount,
      tier1bDuplicates: tier1bCount,
      tier2Duplicates: tier2Count,
      totalFlagged: flagged.length,
    });
  } catch (error) {
    console.error('[DedupScan] Error:', error);
    return jsonResponse({ error: 'Duplicate scan failed', details: error instanceof Error ? error.message : String(error) }, 500);
  }
}
