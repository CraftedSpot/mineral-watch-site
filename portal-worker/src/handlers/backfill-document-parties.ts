/**
 * Admin backfill: create document_parties rows for chain-of-title documents
 * that have party data in extracted_data but no persisted party rows.
 *
 * POST /api/admin/backfill-document-parties?limit=500
 * Auth: PROCESSING_API_KEY
 */
import { normalizePartyName } from '../utils/normalize-party-name.js';

interface Env {
  WELLS_DB: D1Database;
  PROCESSING_API_KEY: string;
}

interface Party {
  party_name: string;
  party_name_normalized: string;
  party_role: string;
  party_type: string;
  address: string | null;
  document_date: string | null;
}

// ── Helpers (ported from documents-worker/src/services/party-extraction.ts) ──

function classifyPartyType(name: string): string {
  if (!name) return 'unknown';
  if (/\bLLC\b|\bL\.L\.C\.?\b|\bLIMITED\s+LIABILITY\b/i.test(name)) return 'llc';
  if (/\bTRUST\b|\bTRUSTEE\b/i.test(name)) return 'trust';
  if (/\bESTATE\b/i.test(name)) return 'estate';
  if (/\bINC\.?\b|\bINCORPORATED\b|\bCORP\.?\b|\bCORPORATION\b|\bCOMPANY\b|\bCO\.\b|\bLTD\.?\b|\bLP\b|\bL\.P\.?\b|\bLLP\b|\bL\.L\.P\.?\b|\bLIMITED\s+PARTNERSHIP\b|\bPARTNERS\b|\bPARTNERSHIP\b|\bHOLDINGS\b|\bRESOURCES\b|\bENERGY\b|\bPETROLEUM\b|\bOPERATING\b|\bPRODUCTION\b|\bEXPLORATION\b|\bDRILLING\b/i.test(name)) return 'corporation';
  return 'individual';
}

function extractDocumentDate(data: any): string | null {
  if (!data) return null;
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

function formatAddress(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj === 'string') return obj.trim() || null;
  const parts = [obj.address, obj.city, obj.state, obj.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Extract parties from extracted_data, matching documents-worker logic exactly.
 */
function extractParties(extractedData: any, docType: string): Party[] {
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
        for (const g of extractedData.grantors) addParty(g?.name, 'grantor', formatAddress(g));
      }
      if (Array.isArray(extractedData.grantees)) {
        for (const g of extractedData.grantees) addParty(g?.name, 'grantee', formatAddress(g));
      }
      if (parties.length === 0) {
        addParty(extractedData.lessor?.name, 'grantor', formatAddress(extractedData.lessor));
        addParty(extractedData.lessee?.name, 'grantee', formatAddress(extractedData.lessee));
      }
      if (parties.length === 0) {
        addParty(extractedData.assignor?.name, 'grantor', formatAddress(extractedData.assignor));
        addParty(extractedData.assignee?.name, 'grantee', formatAddress(extractedData.assignee));
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

    // ===== CHANGE OF OPERATOR / WELL TRANSFER =====
    case 'change_of_operator':
    case 'well_transfer':
      addParty(extractedData.current_operator, 'operator');
      addParty(extractedData.new_operator, 'operator');
      // Well transfers sometimes use grantor/grantee or assignor/assignee
      if (parties.length === 0) {
        addParty(extractedData.assignor?.name, 'assignor', formatAddress(extractedData.assignor));
        addParty(extractedData.assignee?.name, 'assignee', formatAddress(extractedData.assignee));
      }
      if (parties.length === 0) {
        addParty(extractedData.grantor?.name || extractedData.grantor, 'grantor');
        addParty(extractedData.grantee?.name || extractedData.grantee, 'grantee');
      }
      break;

    // ===== AFFIDAVIT OF HEIRSHIP =====
    case 'affidavit_of_heirship':
      addParty(extractedData.decedent?.full_name || extractedData.decedent?.name, 'grantor');
      addParty(extractedData.affiant?.full_name || extractedData.affiant?.name, 'affiant');
      if (Array.isArray(extractedData.heirs)) {
        for (const h of extractedData.heirs) addParty(h?.full_name || h?.name, 'grantee');
      }
      if (Array.isArray(extractedData.heirs_summary)) {
        for (const h of extractedData.heirs_summary) addParty(h?.name, 'grantee');
      }
      break;

    // ===== TITLE OPINIONS =====
    case 'title_opinion':
      addParty(extractedData.examining_attorney?.name, 'examiner');
      if (Array.isArray(extractedData.current_owners)) {
        for (const o of extractedData.current_owners) addParty(o?.name, 'owner');
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

    // ===== DEATH CERTIFICATE =====
    case 'death_certificate':
      addParty(extractedData.decedent?.name || extractedData.decedent || extractedData.name, 'decedent');
      break;

    // ===== PROBATE =====
    case 'probate':
      addParty(extractedData.decedent?.name || extractedData.decedent, 'grantor');
      if (Array.isArray(extractedData.heirs || extractedData.beneficiaries)) {
        for (const h of (extractedData.heirs || extractedData.beneficiaries)) {
          addParty(h?.name || h?.full_name, 'grantee');
        }
      }
      break;

    // ===== GENERIC FALLBACK =====
    default:
      if (extractedData.parties && !Array.isArray(extractedData.parties)) {
        if (Array.isArray(extractedData.parties.from)) {
          for (const p of extractedData.parties.from) addParty(p?.name, 'grantor');
        }
        if (Array.isArray(extractedData.parties.to)) {
          for (const p of extractedData.parties.to) addParty(p?.name, 'grantee');
        }
      }
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

  // Deduplicate: same (normalized_name, role) → keep first
  const seen = new Set<string>();
  return parties.filter(p => {
    const key = `${p.party_name_normalized}|${p.party_role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Handler ─────────────────────────────────────────────────────────────────

const FETCH_BATCH = 200;
const DB_BATCH = 100;

export async function handleBackfillDocumentParties(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const maxToProcess = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 2000);

  let processed = 0;
  let partiesCreated = 0;
  let skipped = 0;
  let errors = 0;

  while (processed < maxToProcess) {
    const remaining = maxToProcess - processed;
    const fetchLimit = Math.min(FETCH_BATCH, remaining);

    const result = await env.WELLS_DB.prepare(`
      SELECT d.id, d.doc_type, d.extracted_data
      FROM documents d
      WHERE d.extracted_data IS NOT NULL AND LENGTH(d.extracted_data) > 10
        AND d.status = 'complete'
        AND d.chain_of_title = 1
        AND NOT EXISTS (
          SELECT 1 FROM document_parties dp WHERE dp.document_id = d.id
        )
      LIMIT ?
    `).bind(fetchLimit).all();

    const docs = result.results as any[];
    if (docs.length === 0) break;

    const statements: D1PreparedStatement[] = [];

    for (const doc of docs) {
      processed++;
      try {
        const extractedData = typeof doc.extracted_data === 'string'
          ? JSON.parse(doc.extracted_data) : doc.extracted_data;
        if (!extractedData) { skipped++; continue; }

        const parties = extractParties(extractedData, doc.doc_type || '');
        if (parties.length === 0) { skipped++; continue; }

        for (const p of parties) {
          statements.push(
            env.WELLS_DB.prepare(`
              INSERT INTO document_parties (document_id, party_name, party_name_normalized, party_role, party_type, address, document_date)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(doc.id, p.party_name, p.party_name_normalized, p.party_role, p.party_type, p.address, p.document_date)
          );
          partiesCreated++;
        }
      } catch (e) {
        console.error(`[BackfillParties] Error processing ${doc.id}:`, e);
        errors++;
      }
    }

    // Execute in D1 batches
    for (let i = 0; i < statements.length; i += DB_BATCH) {
      const chunk = statements.slice(i, i + DB_BATCH);
      await env.WELLS_DB.batch(chunk);
    }

    if (docs.length < fetchLimit) break;
  }

  // Count remaining
  const remainingResult = await env.WELLS_DB.prepare(`
    SELECT COUNT(*) as cnt FROM documents d
    WHERE d.extracted_data IS NOT NULL AND LENGTH(d.extracted_data) > 10
      AND d.status = 'complete' AND d.chain_of_title = 1
      AND NOT EXISTS (SELECT 1 FROM document_parties dp WHERE dp.document_id = d.id)
  `).first<{ cnt: number }>();

  return new Response(JSON.stringify({
    success: true,
    processed,
    partiesCreated,
    skipped,
    errors,
    remaining: remainingResult?.cnt || 0,
  }), { headers: { 'Content-Type': 'application/json' } });
}
