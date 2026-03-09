/**
 * Party Extraction Service
 *
 * Deterministically extracts party/entity information from document extracted_data
 * and persists it to the document_parties table. No additional Claude call needed —
 * just reshapes existing structured data.
 *
 * Enables: chain of title, chatbot, cross-document search.
 */

export interface Party {
  party_name: string;
  party_name_normalized: string;
  party_role: string;
  party_type: string;
  address: string | null;
  document_date: string | null;
}

/**
 * Normalize a party name for matching across documents.
 * Strips suffixes, honorifics, middle initials; lowercases; collapses whitespace.
 */
export function normalizePartyName(name: string): string {
  if (!name) return '';

  let n = name.trim();
  if (!n) return '';

  n = n.toLowerCase();

  // Strip honorifics
  n = n.replace(/\b(mr|mrs|ms|dr)\.?\s*/gi, '');

  // Strip corporate/legal suffixes (order: more specific first)
  n = n.replace(/\blimited\s+liability\s+(company|co\.?)\b/gi, '');
  n = n.replace(/\blimited\s+partnership\b/gi, '');
  n = n.replace(/\b(l\.l\.c\.?|llc)\b/gi, '');
  n = n.replace(/\b(l\.l\.p\.?|llp)\b/gi, '');
  n = n.replace(/\b(l\.p\.?)\b/gi, '');
  n = n.replace(/\bincorporated\b/gi, '');
  n = n.replace(/\binc\.?\b/gi, '');
  n = n.replace(/\bcorporation\b/gi, '');
  n = n.replace(/\bcorp\.?\b/gi, '');
  n = n.replace(/\bltd\.?\b/gi, '');
  n = n.replace(/\bCo\.\b/g, ''); // Case-sensitive period required — preserves "conoco"

  // Strip et al., et ux.
  n = n.replace(/\bet\s+al\.?\b/gi, '');
  n = n.replace(/\bet\s+ux\.?\b/gi, '');

  // Strip generational suffixes
  n = n.replace(/\b(jr|sr)\.?\b/gi, '');
  n = n.replace(/\b(iv|iii|ii)\b/gi, '');

  // Strip middle initials: single letter followed by optional period, surrounded by spaces
  // "John A. Smith" → "John Smith", but don't strip from "J. Paul Getty" (leading initial)
  n = n.replace(/(?<=\s)[a-z]\.?\s/gi, ' ');

  // Remove punctuation except hyphens and apostrophes
  n = n.replace(/[^a-z0-9\s\-']/g, '');

  // Collapse whitespace and trim
  n = n.replace(/\s+/g, ' ').trim();

  return n;
}

/**
 * Classify a party name as individual, corporation, trust, estate, or llc.
 * Priority order matters — LLC checked before corporation keywords.
 */
export function classifyPartyType(name: string): string {
  if (!name) return 'unknown';

  const upper = name.toUpperCase();

  // LLC / L.L.C. / Limited Liability (check first — "Smith Estate LLC" is an LLC)
  if (/\bLLC\b|\bL\.L\.C\.?\b|\bLIMITED\s+LIABILITY\b/i.test(name)) return 'llc';

  // Trust / Trustee
  if (/\bTRUST\b|\bTRUSTEE\b/i.test(name)) return 'trust';

  // Estate
  if (/\bESTATE\b/i.test(name)) return 'estate';

  // Corporation indicators
  if (/\bINC\.?\b|\bINCORPORATED\b|\bCORP\.?\b|\bCORPORATION\b|\bCOMPANY\b|\bCO\.\b|\bLTD\.?\b|\bLP\b|\bL\.P\.?\b|\bLLP\b|\bL\.L\.P\.?\b|\bLIMITED\s+PARTNERSHIP\b|\bPARTNERS\b|\bPARTNERSHIP\b|\bHOLDINGS\b|\bRESOURCES\b|\bENERGY\b|\bPETROLEUM\b|\bOPERATING\b|\bPRODUCTION\b|\bEXPLORATION\b|\bDRILLING\b/i.test(name)) return 'corporation';

  return 'individual';
}

/**
 * Extract the best available date from extracted_data for chain-of-title ordering.
 */
function extractDocumentDate(data: any): string | null {
  if (!data) return null;

  // Priority: execution_date > effective_date > recording date > order date
  const candidates = [
    data.execution_date,
    data.effective_date,
    data.recording?.recording_date,
    data.recording_info?.recording_date,
    data.order_info?.order_date,
    data.order_info?.effective_date,
  ];

  for (const d of candidates) {
    if (d && typeof d === 'string' && d.trim()) return d.trim();
  }

  return null;
}

/**
 * Format an address object into a single string.
 */
function formatAddress(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj === 'string') return obj.trim() || null;

  const parts = [obj.address, obj.city, obj.state, obj.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Extract party records from extracted_data based on doc_type.
 * Returns a deduped array of Party objects.
 */
export function extractParties(extractedData: any, docType: string): Party[] {
  if (!extractedData) return [];

  const parties: Party[] = [];
  const documentDate = extractDocumentDate(extractedData);

  const addParty = (name: string | null | undefined, role: string, address?: string | null) => {
    if (!name || typeof name !== 'string' || !name.trim()) return;
    const trimmed = name.trim();
    const normalized = normalizePartyName(trimmed);
    if (!normalized) return;

    parties.push({
      party_name: trimmed,
      party_name_normalized: normalized,
      party_role: role,
      party_type: classifyPartyType(trimmed),
      address: address?.trim() || null,
      document_date: documentDate,
    });
  };

  const normalizedType = (docType || '').toLowerCase().replace(/\s+/g, '_');

  switch (normalizedType) {
    // ===== LEASES =====
    case 'oil_gas_lease':
    case 'lease':
    case 'lease_amendment':
    case 'lease_extension':
    case 'lease_ratification':
    case 'memorandum_of_lease':
      addParty(extractedData.lessor?.name, 'lessor', formatAddress(extractedData.lessor));
      addParty(extractedData.lessee?.name, 'lessee', formatAddress(extractedData.lessee));
      break;

    // ===== DEEDS =====
    case 'mineral_deed':
    case 'royalty_deed':
    case 'warranty_deed':
    case 'quitclaim_deed':
    case 'quit_claim_deed':
    case 'gift_deed':
    case 'trust_funding':
    case 'conveyance':
      if (Array.isArray(extractedData.grantors)) {
        for (const g of extractedData.grantors) {
          addParty(g?.name, 'grantor', formatAddress(g));
        }
      }
      if (Array.isArray(extractedData.grantees)) {
        for (const g of extractedData.grantees) {
          addParty(g?.name, 'grantee', formatAddress(g));
        }
      }
      break;

    // ===== ASSIGNMENTS =====
    case 'assignment':
    case 'assignment_of_lease':
    case 'lease_assignment':
    case 'assignment_and_bill_of_sale':
      addParty(extractedData.assignor?.name, 'assignor', formatAddress(extractedData.assignor));
      addParty(extractedData.assignee?.name, 'assignee', formatAddress(extractedData.assignee));
      if (extractedData.underlying_lease) {
        addParty(extractedData.underlying_lease.lessor, 'lessor');
        addParty(extractedData.underlying_lease.lessee, 'lessee');
      }
      break;

    // ===== POOLING ORDERS =====
    case 'pooling_order':
    case 'force_pooling_order':
      addParty(extractedData.applicant?.name, 'applicant');
      addParty(extractedData.operator?.name, 'operator', formatAddress(extractedData.operator));
      // Excluded: lease_exhibits parties (comparable market data, not transaction parties)
      break;

    // ===== DIVISION ORDERS =====
    case 'division_order':
      addParty(extractedData.operator_name || extractedData.operator?.name, 'operator',
        extractedData.operator_address || formatAddress(extractedData.operator));
      addParty(extractedData.owner_name, 'owner');
      break;

    // ===== CHECK STUBS =====
    case 'check_stub':
      addParty(extractedData.operator || extractedData.operator_name, 'operator',
        extractedData.operator_address);
      addParty(extractedData.owner_name || extractedData.payee, 'owner');
      break;

    // ===== JOA =====
    case 'joa':
      addParty(extractedData.operator_name || extractedData.operator?.name, 'operator',
        extractedData.operator_address || formatAddress(extractedData.operator));
      if (Array.isArray(extractedData.parties)) {
        for (const p of extractedData.parties) {
          addParty(p?.name, p?.role === 'operator' ? 'operator' : 'owner');
        }
      }
      break;

    // ===== CHANGE OF OPERATOR =====
    case 'change_of_operator':
    case 'well_transfer':
      addParty(extractedData.current_operator, 'operator');
      addParty(extractedData.new_operator, 'operator');
      break;

    // ===== AFFIDAVIT OF HEIRSHIP =====
    case 'affidavit_of_heirship':
      // Decedent is the "grantor" — ownership passes from them
      addParty(extractedData.decedent?.full_name || extractedData.decedent?.name, 'grantor');
      // Affiant
      addParty(extractedData.affiant?.full_name || extractedData.affiant?.name, 'affiant');
      // Heirs are the "grantees" — ownership passes to them
      if (Array.isArray(extractedData.heirs)) {
        for (const h of extractedData.heirs) {
          addParty(h?.full_name || h?.name, 'grantee');
        }
      }
      // Fallback: mega-prompt format used heirs_summary
      if (Array.isArray(extractedData.heirs_summary)) {
        for (const h of extractedData.heirs_summary) {
          addParty(h?.name, 'grantee');
        }
      }
      break;

    // ===== TITLE OPINIONS =====
    case 'title_opinion':
      addParty(extractedData.examining_attorney?.name, 'examiner');
      if (extractedData.examining_attorney?.firm &&
          extractedData.examining_attorney.firm !== extractedData.examining_attorney?.name) {
        addParty(extractedData.examining_attorney.firm, 'examiner');
      }
      addParty(extractedData.addressed_to?.name, 'client');
      if (Array.isArray(extractedData.current_owners)) {
        for (const o of extractedData.current_owners) {
          addParty(o?.name, 'owner');
        }
      }
      if (Array.isArray(extractedData.chain_of_instruments)) {
        for (const inst of extractedData.chain_of_instruments) {
          if (Array.isArray(inst?.grantors)) {
            for (const g of inst.grantors) addParty(g, 'grantor');
          }
          if (Array.isArray(inst?.grantees)) {
            for (const g of inst.grantees) addParty(g, 'grantee');
          }
        }
      }
      break;

    // ===== GENERIC / FALLBACK =====
    default:
      // Generic prompt: parties.from[] / parties.to[]
      if (extractedData.parties && !Array.isArray(extractedData.parties)) {
        if (Array.isArray(extractedData.parties.from)) {
          for (const p of extractedData.parties.from) {
            addParty(p?.name, 'grantor');
          }
        }
        if (Array.isArray(extractedData.parties.to)) {
          for (const p of extractedData.parties.to) {
            addParty(p?.name, 'grantee');
          }
        }
      }
      // Fallback: check common top-level fields
      addParty(extractedData.operator_name || extractedData.operator?.name, 'operator');
      addParty(extractedData.lessor?.name, 'lessor');
      addParty(extractedData.lessee?.name, 'lessee');
      if (Array.isArray(extractedData.grantors)) {
        for (const g of extractedData.grantors) addParty(g?.name, 'grantor');
      }
      if (Array.isArray(extractedData.grantees)) {
        for (const g of extractedData.grantees) addParty(g?.name, 'grantee');
      }
      break;
  }

  // Deduplicate: same normalized name + role = keep first occurrence
  const seen = new Set<string>();
  return parties.filter(p => {
    const key = `${p.party_name_normalized}|${p.party_role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract summary (key_takeaway) from extracted_data.
 */
export function extractSummary(extractedData: any): string | null {
  if (!extractedData) return null;
  const kt = extractedData.key_takeaway;
  if (!kt || typeof kt !== 'string') return null;
  return kt.trim().substring(0, 1000) || null;
}

/**
 * Persist extracted parties to document_parties table.
 * Idempotent: DELETE existing + INSERT new. Non-fatal on error.
 */
export async function persistParties(
  db: D1Database,
  documentId: string,
  extractedData: any,
  docType: string
): Promise<number> {
  const parties = extractParties(extractedData, docType);
  if (parties.length === 0) return 0;

  // Delete existing extracted parties for this document (supports re-extraction)
  // Preserves user-added (is_manual=1) and user-deleted (is_deleted=1) rows
  await db.prepare('DELETE FROM document_parties WHERE document_id = ? AND is_manual = 0 AND is_deleted = 0')
    .bind(documentId).run();

  // Batch insert
  const stmts = parties.map(p =>
    db.prepare(`
      INSERT INTO document_parties (document_id, party_name, party_name_normalized, party_role, party_type, address, document_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      documentId,
      p.party_name,
      p.party_name_normalized,
      p.party_role,
      p.party_type,
      p.address,
      p.document_date
    )
  );

  // D1 batch limit is 500 statements — parties per doc is typically 2-6, well under limit
  await db.batch(stmts);

  return parties.length;
}
