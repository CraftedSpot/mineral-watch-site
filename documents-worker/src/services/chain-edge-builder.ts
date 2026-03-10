/**
 * Chain-of-Title Edge Builder
 *
 * Deterministic matching: reads from document_parties (authority),
 * builds parent→child edges between chain-of-title documents,
 * persists to document_chain_edges and chain_current_owners.
 *
 * Single source of truth for all matching logic. Portal-worker reads
 * persisted edges only — no matching code in portal-worker.
 */

import { normalizePartyName, classifyPartyType } from './party-extraction.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface BuildResult {
  edgesCreated: number;
  ownersFound: number;
  orphanCount: number;
  duration: number;
}

interface DocParties {
  id: string;
  docType: string;
  date: string | null;
  fromParties: ResolvedParty[];
  toParties: ResolvedParty[];
}

interface ResolvedParty {
  original: string;
  normalized: string;
}

interface EdgeCandidate {
  parentDocId: string;
  childDocId: string;
  matchType: 'exact_normalized' | 'relaxed';
  confidence: number;
  fromName: string;
  toName: string;
  edgeType: string;
}

// ─── Role mapping ──────────────────────────────────────────────────

const FROM_ROLES = new Set(['grantor', 'lessor', 'assignor', 'decedent']);
const TO_ROLES = new Set(['grantee', 'lessee', 'assignee']);

const DOC_CATEGORY: Record<string, string> = {
  mineral_deed: 'ownership', royalty_deed: 'ownership', warranty_deed: 'ownership',
  gift_deed: 'ownership', quit_claim_deed: 'ownership', conveyance: 'ownership',
  trust_funding: 'ownership',
  oil_gas_lease: 'encumbrance', oil_and_gas_lease: 'encumbrance', lease: 'encumbrance',
  memorandum_of_lease: 'encumbrance', lease_amendment: 'encumbrance',
  lease_extension: 'encumbrance', lease_ratification: 'encumbrance',
  assignment: 'assignment', assignment_of_lease: 'assignment',
  lease_assignment: 'assignment', assignment_and_bill_of_sale: 'assignment',
  affidavit_of_heirship: 'succession', probate: 'succession',
  title_opinion: 'informational', death_certificate: 'informational',
  subordination_agreement: 'informational', well_transfer: 'informational',
};

// ─── Relaxed normalization ─────────────────────────────────────────

/**
 * Additional normalization for matching: strips "and", articles,
 * handles & vs "and" differences.
 * Applied to already-normalized names from document_parties.
 */
export function relaxedNormalize(normalized: string): string {
  return normalized
    .replace(/&/g, ' ')
    .replace(/\b(and|the|of|a|an)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Compound name splitting ───────────────────────────────────────

const KNOWN_SUFFIXES = new Set([
  'inc', 'llc', 'ltd', 'corp', 'co', 'lp', 'llp', 'jr', 'sr',
  'ii', 'iii', 'iv', 'trustee', 'trust', 'deceased', 'executor',
  'executrix', 'administrator', 'administratrix', 'guardian',
]);

/**
 * Split a compound party name into individual names.
 * Conservative: returns original unsplit if not confident.
 *
 * "William S. Price, Montine Price Sprehe, and Kelsey Price Walters"
 * → ["William S. Price", "Montine Price Sprehe", "Kelsey Price Walters"]
 *
 * "Price Oil & Gas Company, Ltd." → ["Price Oil & Gas Company, Ltd."] (no split)
 */
export function splitCompoundPartyName(fullName: string): string[] {
  if (!fullName || fullName.length < 4) return [fullName];

  // Don't split corporate/trust entities
  const entityType = classifyPartyType(fullName);
  if (entityType !== 'individual' && entityType !== 'estate') {
    return [fullName];
  }

  // Handle "the Estate of X, Deceased" wrapper — extract inner name
  const estateMatch = fullName.match(/^the\s+estate\s+of\s+(.+?)(?:,\s*deceased)?$/i);
  if (estateMatch) {
    return [estateMatch[1].trim()];
  }

  // Split on ", and " first (most reliable delimiter)
  let parts = fullName.split(/,\s+and\s+/i);

  // If only one part, try splitting on " and " (between capitalized words)
  if (parts.length === 1) {
    parts = fullName.split(/\s+and\s+(?=[A-Z])/);
  }

  // If still one part, try splitting on ", " (before capitalized non-suffix words)
  if (parts.length === 1) {
    const segments: string[] = [];
    let remaining = fullName;

    while (remaining) {
      // Find ", " followed by a capitalized word that isn't a suffix
      const commaMatch = remaining.match(/^(.+?),\s+(?=([A-Z][a-z]))/);
      if (commaMatch) {
        const nextWord = remaining.slice(commaMatch[0].length).split(/[\s,]/)[0].toLowerCase();
        if (KNOWN_SUFFIXES.has(nextWord)) {
          // This comma precedes a suffix — don't split here
          segments.push(remaining);
          remaining = '';
        } else {
          segments.push(commaMatch[1].trim());
          remaining = remaining.slice(commaMatch[0].length);
        }
      } else {
        segments.push(remaining.trim());
        remaining = '';
      }
    }
    if (segments.length > 1) parts = segments;
  }

  // Clean up each part
  const result = parts
    .map(p => p.replace(/^and\s+/i, '').trim())
    .filter(p => p.length >= 2)
    .filter(p => !/^(et\s+al\.?|et\s+ux\.?)$/i.test(p));

  return result.length > 0 ? result : [fullName];
}

// ─── Interest extraction ───────────────────────────────────────────

function parseFraction(text: unknown): number | null {
  if (!text) return null;
  if (typeof text === 'number') return text;
  if (typeof text !== 'string') return null;
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) {
    const denom = parseInt(m[2]);
    return denom > 0 ? parseInt(m[1]) / denom : null;
  }
  return null;
}

interface InterestInfo {
  text: string | null;
  decimal: number | null;
  type: string | null;
}

function extractInterestFromDoc(extractedData: any, docType: string): InterestInfo {
  if (!extractedData) return { text: null, decimal: null, type: null };

  const cat = DOC_CATEGORY[docType] || 'informational';

  if (cat === 'ownership' || cat === 'succession') {
    // Path 1: tracts[0].interest (structured extraction schema)
    const tracts = extractedData.tracts;
    if (Array.isArray(tracts) && tracts.length > 0) {
      const interest = tracts[0].interest;
      if (interest) {
        const fracText = typeof interest.fraction_text === 'string' ? interest.fraction_text : null;
        return {
          text: fracText,
          decimal: interest.fraction_decimal ?? parseFraction(fracText) ?? null,
          type: interest.type || 'mineral',
        };
      }
    }

    // Path 2: interest_conveyed — can be string, number, or structured object
    if (extractedData.interest_conveyed || extractedData.interest_type) {
      const ic = extractedData.interest_conveyed;

      // 2a: Structured object with fraction_text/fraction_decimal (same shape as tracts[].interest)
      if (ic && typeof ic === 'object' && !Array.isArray(ic)) {
        const fracText = typeof ic.fraction_text === 'string' ? ic.fraction_text : null;
        return {
          text: fracText,
          decimal: ic.fraction_decimal ?? parseFraction(fracText) ?? null,
          type: ic.type || extractedData.interest_type || 'mineral',
        };
      }

      // 2b: Plain string or number
      const text = typeof ic === 'string' ? ic : null;
      return {
        text,
        decimal: (typeof ic === 'number' ? ic : null) ?? parseFraction(text) ?? null,
        type: extractedData.interest_type || 'mineral',
      };
    }

    // Path 3: Heirship heirs
    if (Array.isArray(extractedData.heirs)) {
      return { text: null, decimal: null, type: 'mineral' };
    }
  }

  return { text: null, decimal: null, type: null };
}

// ─── Main builder ──────────────────────────────────────────────────

/**
 * Build chain-of-title edges for a property.
 * Reads from document_parties (authority), matches grantee→grantor
 * across documents, persists edges and current owners.
 */
export async function buildChainEdges(
  db: D1Database,
  propertyId: string
): Promise<BuildResult> {
  const start = Date.now();

  // Step 1: Load all chain docs + parties for this property
  const startsWithPattern = `${propertyId},%`;
  const endsWithPattern = `%,${propertyId}`;
  const containsPattern = `%,${propertyId},%`;

  const rawResult = await db.prepare(`
    SELECT
      d.id, d.doc_type, d.extracted_data,
      dp.party_name, dp.party_name_normalized, dp.party_role, dp.document_date
    FROM documents d
    LEFT JOIN document_parties dp ON dp.document_id = d.id AND dp.is_deleted = 0
    WHERE d.chain_of_title = 1
      AND d.status = 'complete'
      AND (d.deleted_at IS NULL OR d.deleted_at = '')
      AND (d.duplicate_status IS NULL OR d.duplicate_status = 'dismissed')
      AND d.doc_type != 'multi_document'
      AND NOT EXISTS (
        SELECT 1 FROM documents child
        WHERE child.parent_document_id = d.id
          AND (child.deleted_at IS NULL OR child.deleted_at = '')
          AND child.status = 'complete'
      )
      AND (
        d.property_id = ?
        OR d.property_id LIKE ?
        OR d.property_id LIKE ?
        OR d.property_id LIKE ?
      )
    ORDER BY dp.document_date ASC NULLS LAST
  `).bind(propertyId, startsWithPattern, endsWithPattern, containsPattern).all<any>();

  // Group by document
  const docsMap = new Map<string, DocParties>();
  const docExtractedData = new Map<string, any>();

  for (const row of rawResult.results || []) {
    if (!docsMap.has(row.id)) {
      docsMap.set(row.id, {
        id: row.id,
        docType: row.doc_type || '',
        date: null,
        fromParties: [],
        toParties: [],
      });
      // Parse extracted_data for interest info later
      try {
        if (row.extracted_data) {
          docExtractedData.set(row.id, JSON.parse(row.extracted_data));
        }
      } catch { /* ignore */ }
    }

    const doc = docsMap.get(row.id)!;
    if (row.document_date && !doc.date) doc.date = row.document_date;

    // Skip if no party data (LEFT JOIN produces null rows)
    if (!row.party_name) continue;

    const role = (row.party_role || '').toLowerCase();
    const originalName = row.party_name;
    const normalizedName = row.party_name_normalized;

    // Resolve compound names into individual names
    const splitNames = splitCompoundPartyName(originalName);
    const resolvedParties: ResolvedParty[] = splitNames.map(name => ({
      original: name,
      normalized: name === originalName ? normalizedName : normalizePartyName(name),
    })).filter(p => p.normalized.length > 0);

    if (FROM_ROLES.has(role)) {
      doc.fromParties.push(...resolvedParties);
    } else if (TO_ROLES.has(role)) {
      doc.toParties.push(...resolvedParties);
    }
  }

  const docs = Array.from(docsMap.values());

  // Step 2: Build "to" index — normalized name → docs where this name received interest
  const toIndex = new Map<string, Array<{ docId: string; date: string | null; original: string }>>();
  const toIndexRelaxed = new Map<string, Array<{ docId: string; date: string | null; original: string; exactNorm: string }>>();

  for (const doc of docs) {
    for (const party of doc.toParties) {
      // Exact normalized index
      if (!toIndex.has(party.normalized)) toIndex.set(party.normalized, []);
      toIndex.get(party.normalized)!.push({ docId: doc.id, date: doc.date, original: party.original });

      // Relaxed index
      const relaxed = relaxedNormalize(party.normalized);
      if (relaxed) {
        if (!toIndexRelaxed.has(relaxed)) toIndexRelaxed.set(relaxed, []);
        toIndexRelaxed.get(relaxed)!.push({ docId: doc.id, date: doc.date, original: party.original, exactNorm: party.normalized });
      }
    }
  }

  // Step 3: Match — for each doc, find parent via "from" party matching a "to" party in an earlier doc
  const edges: EdgeCandidate[] = [];
  const childrenLinked = new Set<string>(); // track which docs have a parent

  for (const doc of docs) {
    for (const fromParty of doc.fromParties) {
      let matched = false;

      // Pass 1: Exact normalized match
      const exactMatches = toIndex.get(fromParty.normalized);
      if (exactMatches) {
        // Find closest ancestor by date (most recent doc with date <= this doc's date)
        const ancestor = findClosestAncestor(exactMatches, doc);
        if (ancestor) {
          edges.push({
            parentDocId: ancestor.docId,
            childDocId: doc.id,
            matchType: 'exact_normalized',
            confidence: 1.0,
            fromName: fromParty.original,
            toName: ancestor.original,
            edgeType: DOC_CATEGORY[doc.docType] || 'informational',
          });
          childrenLinked.add(doc.id);
          matched = true;
        }
      }

      // Pass 2: Relaxed match (only if exact didn't match)
      if (!matched) {
        const relaxedFrom = relaxedNormalize(fromParty.normalized);
        if (relaxedFrom) {
          const relaxedMatches = toIndexRelaxed.get(relaxedFrom);
          if (relaxedMatches) {
            // Filter out self-matches (same exact normalized name would have matched in pass 1)
            const nonExact = relaxedMatches.filter(m => m.exactNorm !== fromParty.normalized);
            const ancestor = findClosestAncestor(nonExact, doc);
            if (ancestor) {
              edges.push({
                parentDocId: ancestor.docId,
                childDocId: doc.id,
                matchType: 'relaxed',
                confidence: 0.8,
                fromName: fromParty.original,
                toName: ancestor.original,
                edgeType: DOC_CATEGORY[doc.docType] || 'informational',
              });
              childrenLinked.add(doc.id);
            }
          }
        }
      }
    }
  }

  // Deduplicate edges (same parent→child pair, keep highest confidence)
  const edgeMap = new Map<string, EdgeCandidate>();
  for (const edge of edges) {
    const key = `${edge.parentDocId}|${edge.childDocId}`;
    const existing = edgeMap.get(key);
    if (!existing || edge.confidence > existing.confidence) {
      edgeMap.set(key, edge);
    }
  }
  const dedupedEdges = Array.from(edgeMap.values());

  // Step 4: Persist edges (preserve manual edges)
  await db.prepare(
    `DELETE FROM document_chain_edges WHERE property_id = ? AND is_manual = 0`
  ).bind(propertyId).run();

  if (dedupedEdges.length > 0) {
    // Batch insert, 50 at a time (each uses 8 params → 400 < 500 D1 batch limit)
    const BATCH = 50;
    for (let i = 0; i < dedupedEdges.length; i += BATCH) {
      const batch = dedupedEdges.slice(i, i + BATCH);
      const stmts = batch.map(e =>
        db.prepare(`
          INSERT OR IGNORE INTO document_chain_edges
            (property_id, parent_doc_id, child_doc_id, match_type, match_confidence, matched_from_name, matched_to_name, edge_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(propertyId, e.parentDocId, e.childDocId, e.matchType, e.confidence, e.fromName, e.toName, e.edgeType)
      );
      await db.batch(stmts);
    }
  }

  // Step 5: Compute current owners
  // Terminal "to" parties whose names never appear as "from" in a later doc
  const allFromNormalized = new Set<string>();
  for (const doc of docs) {
    for (const p of doc.fromParties) {
      allFromNormalized.add(p.normalized);
      allFromNormalized.add(relaxedNormalize(p.normalized));
    }
  }

  const owners: Array<{
    name: string; normalized: string; docId: string; date: string | null;
    interest: InterestInfo;
  }> = [];

  const seenOwners = new Set<string>();
  // Walk docs in reverse chronological order for most-recent acquisition
  const sortedDocs = [...docs].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date); // descending
  });

  for (const doc of sortedDocs) {
    const cat = DOC_CATEGORY[doc.docType];
    // Only ownership transfers and successions create current owners
    if (cat !== 'ownership' && cat !== 'succession') continue;

    for (const toParty of doc.toParties) {
      const relaxed = relaxedNormalize(toParty.normalized);
      // Skip if this party later appears as a "from" (they conveyed away)
      if (allFromNormalized.has(toParty.normalized) || allFromNormalized.has(relaxed)) continue;
      // Skip duplicates
      if (seenOwners.has(toParty.normalized)) continue;
      seenOwners.add(toParty.normalized);

      const extractedData = docExtractedData.get(doc.id);
      const interest = extractInterestFromDoc(extractedData, doc.docType);

      owners.push({
        name: toParty.original,
        normalized: toParty.normalized,
        docId: doc.id,
        date: doc.date,
        interest,
      });
    }
  }

  // Persist owners (preserve manual)
  await db.prepare(
    `DELETE FROM chain_current_owners WHERE property_id = ? AND is_manual = 0`
  ).bind(propertyId).run();

  if (owners.length > 0) {
    const BATCH = 50;
    for (let i = 0; i < owners.length; i += BATCH) {
      const batch = owners.slice(i, i + BATCH);
      const stmts = batch.map(o =>
        db.prepare(`
          INSERT OR IGNORE INTO chain_current_owners
            (property_id, owner_name, owner_name_normalized, acquired_via_doc_id, acquired_date, interest_text, interest_decimal, interest_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(propertyId, o.name, o.normalized, o.docId, o.date, o.interest.text, o.interest.decimal, o.interest.type)
      );
      await db.batch(stmts);
    }
  }

  // Step 6: Invalidate tree cache (will be rebuilt on next read)
  await db.prepare(
    `DELETE FROM chain_tree_cache WHERE property_id = ?`
  ).bind(propertyId).run();

  const orphanCount = docs.filter(d => !childrenLinked.has(d.id) && !dedupedEdges.some(e => e.parentDocId === d.id)).length;

  return {
    edgesCreated: dedupedEdges.length,
    ownersFound: owners.length,
    orphanCount,
    duration: Date.now() - start,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Find the closest ancestor doc by date (most recent doc with date <= child's date).
 * If child has no date, take the most recent match overall.
 * Excludes self-matches.
 */
function findClosestAncestor(
  candidates: Array<{ docId: string; date: string | null; original: string }>,
  child: DocParties
): { docId: string; original: string } | null {
  // Filter out self-matches
  const filtered = candidates.filter(c => c.docId !== child.id);
  if (filtered.length === 0) return null;

  if (!child.date) {
    // No date on child — take the most recent candidate
    const sorted = filtered.filter(c => c.date).sort((a, b) => b.date!.localeCompare(a.date!));
    return sorted.length > 0 ? sorted[0] : filtered[0];
  }

  // Find candidates with date <= child's date, take the most recent
  const eligible = filtered.filter(c => !c.date || c.date <= child.date!);
  if (eligible.length === 0) {
    // No eligible ancestors — could be a date ordering issue, take closest by date
    return filtered[0];
  }

  const sorted = eligible
    .filter(c => c.date)
    .sort((a, b) => b.date!.localeCompare(a.date!));
  return sorted.length > 0 ? sorted[0] : eligible[0];
}
