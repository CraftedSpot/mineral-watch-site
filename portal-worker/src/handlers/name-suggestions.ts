/**
 * Name Suggestions Handler
 *
 * Detects name clusters (misspellings/variations) within a property's title chain,
 * surfaces merge suggestions, enables bulk correction, and persists org-scoped
 * learned mappings so future extractions auto-resolve.
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { getUserByIdD1First } from '../services/airtable.js';
import { getOrgMemberIds, buildOwnershipFilter } from '../utils/ownership.js';
import { normalizePartyName } from '../utils/normalize-party-name.js';
import { invalidateAndRebuild } from '../utils/invalidate-rebuild.js';
import { relaxedNormalize, editDistance, fuzzyTokenMatch } from '../utils/fuzzy-match.js';
import type { Env } from '../types/env.js';

const GRANTOR_ROLES = ['grantor', 'lessor', 'assignor'];
const BATCH = 30;

// ── Union-Find for fuzzy merge ──────────────────────────────────────────────

class UnionFind {
  parent: Map<string, string>;
  rank: Map<string, number>;
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }
  make(x: string) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }
  find(x: string): string {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else { this.parent.set(rb, ra); this.rank.set(ra, rankA + 1); }
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface PartyRow {
  rowId: number;
  documentId: string;
  partyName: string;
  partyNameNormalized: string;
  partyRole: string;
  documentDate: string | null;
  docType: string | null;
}

interface VariantInfo {
  originalName: string;
  normalizedName: string;
  matchType: 'exact_normalized' | 'relaxed' | 'fuzzy';
  docCount: number;
  partyRowIds: number[];
  isCanonical: boolean;
}

interface NameCluster {
  clusterId: string;
  canonicalName: string;
  canonicalSource: 'mapping' | 'division_order' | 'frequency' | 'recent';
  ambiguous: boolean;
  variants: VariantInfo[];
  alreadyMapped: boolean;
  mappingIds?: string[];
}

// ── Auth + property helpers ─────────────────────────────────────────────────

async function resolveAuthAndProperty(propertyId: string, request: Request, env: Env): Promise<
  { error: Response } |
  { authUser: any; userOrgId: string | undefined; memberIds: string[] | null; docOwner: { where: string; params: any[] }; prop: any; allPropertyIds: string[]; userEmail: string }
> {
  const authUser = await authenticateRequest(request, env);
  if (!authUser) return { error: jsonResponse({ error: 'Unauthorized' }, 401) };

  const userRecord = await getUserByIdD1First(env, authUser.id);
  if (!userRecord) return { error: jsonResponse({ error: 'User not found' }, 404) };

  const userOrgId = userRecord.fields.Organization?.[0] as string | undefined;
  const memberIds = await getOrgMemberIds(env.WELLS_DB, userOrgId);
  const docOwner = buildOwnershipFilter('d', userOrgId, authUser.id, memberIds, { includeUserId: true });

  // Resolve property — accept both prop_recXXX and recXXX formats
  const bareId = propertyId.startsWith('prop_') ? propertyId.slice(5) : propertyId;
  const prop = await env.WELLS_DB.prepare(`
    SELECT id, airtable_record_id, county, section, township, range
    FROM properties
    WHERE airtable_record_id = ? OR id = ?
    LIMIT 1
  `).bind(bareId, propertyId).first<any>();

  if (!prop) return { error: jsonResponse({ error: 'Property not found' }, 404) };

  // Sibling properties (multi-entity same TRS)
  const siblingResult = await env.WELLS_DB.prepare(`
    SELECT airtable_record_id FROM properties
    WHERE county = ? AND section = ? AND township = ? AND range = ?
      AND (user_id = ? OR organization_id = ?)
  `).bind(prop.county, prop.section, prop.township, prop.range, authUser.id, userOrgId || '').all();
  const allPropertyIds = (siblingResult.results as any[]).map((r: any) => r.airtable_record_id as string);
  if (!allPropertyIds.includes(prop.airtable_record_id)) allPropertyIds.push(prop.airtable_record_id);

  return {
    authUser,
    userOrgId,
    memberIds,
    docOwner,
    prop,
    allPropertyIds,
    userEmail: authUser.email,
  };
}

// ── GET /api/property/:propertyId/name-suggestions ──────────────────────────

export async function handleGetNameSuggestions(propertyId: string, request: Request, env: Env): Promise<Response> {
  try {
    const ctx = await resolveAuthAndProperty(propertyId, request, env);
    if ('error' in ctx) return ctx.error;

    const { docOwner, allPropertyIds, userOrgId, authUser } = ctx;

    // 1. Get all chain-of-title doc IDs (same filter as title-chain.ts)
    const propConditions: string[] = [];
    const propParams: string[] = [];
    for (const pid of allPropertyIds) {
      propConditions.push('d.property_id = ?', 'd.property_id LIKE ?', 'd.property_id LIKE ?', 'd.property_id LIKE ?');
      propParams.push(pid, `${pid},%`, `%,${pid}`, `%,${pid},%`);
    }

    const docsResult = await env.WELLS_DB.prepare(`
      SELECT d.id, d.doc_type, d.upload_date
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

    const docs = docsResult.results as any[];
    if (docs.length === 0) return jsonResponse({ clusters: [] });

    // Build docId→docType/date map
    const docMeta: Record<string, { docType: string | null; date: string | null }> = {};
    for (const d of docs) {
      docMeta[d.id] = { docType: d.doc_type, date: d.upload_date };
    }
    const docIds = docs.map(d => d.id);

    // 2. Batch-fetch all document_parties
    const allParties: PartyRow[] = [];
    const BATCH = 30;
    for (let i = 0; i < docIds.length; i += BATCH) {
      const batch = docIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(`
        SELECT id, document_id, party_name, party_name_normalized, party_role, document_date
        FROM document_parties
        WHERE document_id IN (${placeholders}) AND is_deleted = 0
      `).bind(...batch).all();
      for (const row of result.results as any[]) {
        allParties.push({
          rowId: row.id,
          documentId: row.document_id,
          partyName: row.party_name,
          partyNameNormalized: row.party_name_normalized || normalizePartyName(row.party_name),
          partyRole: row.party_role,
          documentDate: row.document_date,
          docType: docMeta[row.document_id]?.docType || null,
        });
      }
    }

    if (allParties.length === 0) return jsonResponse({ clusters: [] });

    // 3. Phase A — Group by normalized name
    const normGroups = new Map<string, PartyRow[]>();
    for (const p of allParties) {
      const key = p.partyNameNormalized;
      if (!normGroups.has(key)) normGroups.set(key, []);
      normGroups.get(key)!.push(p);
    }

    // 4. Phase B — Cross-group fuzzy merging via Union-Find
    const uf = new UnionFind();
    const normKeys = Array.from(normGroups.keys());
    for (const k of normKeys) uf.make(k);

    // Detect multi-person names: check original party names for conjunctions
    // joining additional people (e.g., "Joel S. Price & Virginia K. Price")
    const isMultiPerson = new Map<string, boolean>();
    const MULTI_PERSON_RE = /\s*&\s*[A-Z]|\s+and\s+[A-Z]/;
    for (const [normKey, parties] of normGroups) {
      let multi = false;
      for (const p of parties) {
        if (MULTI_PERSON_RE.test(p.partyName)) { multi = true; break; }
      }
      isMultiPerson.set(normKey, multi);
    }

    // Track which merges are ambiguous (short-name guard)
    const ambiguousMerges = new Set<string>();

    for (let i = 0; i < normKeys.length; i++) {
      for (let j = i + 1; j < normKeys.length; j++) {
        const a = normKeys[i];
        const b = normKeys[j];
        if (uf.find(a) === uf.find(b)) continue;

        // Multi-person guard: never merge single-person with multi-person names
        // "Joel S. Price" should not merge with "Joel S. Price & Virginia K. Price"
        const aMulti = isMultiPerson.get(a) || false;
        const bMulti = isMultiPerson.get(b) || false;
        if (aMulti !== bMulti) continue;

        const relaxA = relaxedNormalize(a);
        const relaxB = relaxedNormalize(b);

        // Check relaxed exact match
        if (relaxA === relaxB) {
          uf.union(a, b);
          continue;
        }

        // Check fuzzy token match with short-name guard
        const match = fuzzyTokenMatch(relaxA, relaxB);
        if (match) {
          const tokensA = a.split(' ');
          const tokensB = b.split(' ');
          const minTokens = Math.min(tokensA.length, tokensB.length);

          // Short-name guard: ≤2 tokens require edit distance ≤1
          if (minTokens <= 2 && match.matchType === 'edit_distance') {
            // Check if first-name tokens differ by >1 edit
            const firstA = tokensA[0];
            const firstB = tokensB[0];
            if (firstA !== firstB && editDistance(firstA, firstB, 2) > 1) {
              // Mark as ambiguous rather than auto-merging
              ambiguousMerges.add(`${a}|||${b}`);
              uf.union(a, b);
              continue;
            }
          }

          // Token subset guard: when one name adds/removes tokens (e.g., surname change
          // like "Virginia Price" → "Virginia Price Giles"), mark as ambiguous since
          // they could be different people
          if (match.matchType === 'token_subset' && minTokens <= 3) {
            ambiguousMerges.add(`${a}|||${b}`);
          }

          uf.union(a, b);
        }
      }
    }

    // 5. Collect clusters
    const clusterMap = new Map<string, string[]>(); // root → normalized names
    for (const k of normKeys) {
      const root = uf.find(k);
      if (!clusterMap.has(root)) clusterMap.set(root, []);
      clusterMap.get(root)!.push(k);
    }

    // 6. Load existing mappings for this org/user
    const existingMappings = new Map<string, { id: string; canonical: string }>();
    const mappingScope = userOrgId
      ? { where: 'organization_id = ?', params: [userOrgId] }
      : { where: 'user_id = ? AND organization_id IS NULL', params: [authUser.id] };

    const mappingsResult = await env.WELLS_DB.prepare(`
      SELECT id, variant_name_normalized, canonical_name
      FROM party_name_mappings
      WHERE ${mappingScope.where}
    `).bind(...mappingScope.params).all();
    for (const row of mappingsResult.results as any[]) {
      existingMappings.set(row.variant_name_normalized as string, {
        id: row.id as string,
        canonical: row.canonical_name as string,
      });
    }

    // 7. Build response clusters
    const clusters: NameCluster[] = [];

    for (const [, normNames] of clusterMap) {
      // Collect all distinct original spellings
      const variantMap = new Map<string, { normalized: string; parties: PartyRow[] }>();
      for (const norm of normNames) {
        const parties = normGroups.get(norm) || [];
        for (const p of parties) {
          if (!variantMap.has(p.partyName)) {
            variantMap.set(p.partyName, { normalized: norm, parties: [] });
          }
          variantMap.get(p.partyName)!.parties.push(p);
        }
      }

      // Skip single-spelling groups (no variations to merge)
      if (variantMap.size < 2) continue;

      // Check if any merge in this cluster was ambiguous
      const isAmbiguous = normNames.some((a, i) =>
        normNames.slice(i + 1).some(b =>
          ambiguousMerges.has(`${a}|||${b}`) || ambiguousMerges.has(`${b}|||${a}`)
        )
      );

      // Select canonical name (priority order)
      let canonicalName = '';
      let canonicalSource: 'mapping' | 'division_order' | 'frequency' | 'recent' = 'frequency';
      let alreadyMapped = false;
      const mappingIds: string[] = [];

      // (a) Check existing mappings
      for (const norm of normNames) {
        const mapping = existingMappings.get(norm);
        if (mapping) {
          if (!canonicalName) {
            canonicalName = mapping.canonical;
            canonicalSource = 'mapping';
          }
          alreadyMapped = true;
          mappingIds.push(mapping.id);
        }
      }

      if (!canonicalName) {
        // (b) Name from most recent division order
        let doParties: PartyRow[] = [];
        for (const [, data] of variantMap) {
          for (const p of data.parties) {
            if (p.docType === 'division_order') doParties.push(p);
          }
        }
        if (doParties.length > 0) {
          doParties.sort((a, b) => (b.documentDate || '').localeCompare(a.documentDate || ''));
          canonicalName = doParties[0].partyName;
          canonicalSource = 'division_order';
        }
      }

      if (!canonicalName) {
        // (c) Most frequent original spelling
        let maxCount = 0;
        for (const [name, data] of variantMap) {
          if (data.parties.length > maxCount) {
            maxCount = data.parties.length;
            canonicalName = name;
            canonicalSource = 'frequency';
          }
        }
      }

      if (!canonicalName) {
        // (d) Most recent document
        let latestDate = '';
        for (const [name, data] of variantMap) {
          for (const p of data.parties) {
            if ((p.documentDate || '') > latestDate) {
              latestDate = p.documentDate || '';
              canonicalName = name;
              canonicalSource = 'recent';
            }
          }
        }
      }

      // Build variants array — match type relative to canonical's normalized form
      const canonNorm = normalizePartyName(canonicalName);
      const variants: VariantInfo[] = [];
      for (const [originalName, data] of variantMap) {
        const isCanon = originalName === canonicalName;
        let matchType: 'exact_normalized' | 'relaxed' | 'fuzzy' = 'exact_normalized';
        if (data.normalized !== canonNorm) {
          const relaxA = relaxedNormalize(data.normalized);
          const relaxCanon = relaxedNormalize(canonNorm);
          matchType = relaxA === relaxCanon ? 'relaxed' : 'fuzzy';
        }

        variants.push({
          originalName,
          normalizedName: data.normalized,
          matchType,
          docCount: data.parties.length,
          partyRowIds: data.parties.map(p => p.rowId),
          isCanonical: isCanon,
        });
      }

      // Sort: canonical first, then by doc count descending
      variants.sort((a, b) => {
        if (a.isCanonical) return -1;
        if (b.isCanonical) return 1;
        return b.docCount - a.docCount;
      });

      clusters.push({
        clusterId: `cluster_${crypto.randomUUID().slice(0, 8)}`,
        canonicalName,
        canonicalSource,
        ambiguous: isAmbiguous,
        variants,
        alreadyMapped,
        mappingIds: mappingIds.length > 0 ? mappingIds : undefined,
      });
    }

    // Sort clusters: unmapped first, then by total variant count descending
    clusters.sort((a, b) => {
      if (a.alreadyMapped !== b.alreadyMapped) return a.alreadyMapped ? 1 : -1;
      const aCount = a.variants.reduce((s, v) => s + v.docCount, 0);
      const bCount = b.variants.reduce((s, v) => s + v.docCount, 0);
      return bCount - aCount;
    });

    return jsonResponse({ clusters });
  } catch (error) {
    console.error('[NameSuggestions] GET error:', error);
    return jsonResponse({ error: 'Failed to fetch name suggestions' }, 500);
  }
}

// ── POST /api/property/:propertyId/bulk-correct ─────────────────────────────

export async function handleBulkCorrect(propertyId: string, request: Request, env: Env): Promise<Response> {
  try {
    const ctx = await resolveAuthAndProperty(propertyId, request, env);
    if ('error' in ctx) return ctx.error;

    const { authUser, userOrgId, docOwner } = ctx;

    const body = await request.json() as any;
    const corrections: Array<{ partyRowId: number; documentId?: string; correctedValue: string }> = body.corrections || [];
    const mappings: Array<{ variantOriginal: string; variantNormalized: string; canonicalName: string }> = body.mappings || [];

    if (corrections.length === 0) return jsonResponse({ error: 'No corrections provided' }, 400);

    // Fetch original names + document IDs for all party rows (resolves documentId from partyRowId)
    const allPartyRowIds = corrections.map(c => c.partyRowId);
    const originalNames = new Map<number, { name: string; role: string; docId: string }>();
    for (let i = 0; i < allPartyRowIds.length; i += BATCH) {
      const batch = allPartyRowIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(`
        SELECT id, document_id, party_name, party_role FROM document_parties
        WHERE id IN (${placeholders})
      `).bind(...batch).all();
      for (const row of result.results as any[]) {
        originalNames.set(row.id as number, {
          name: row.party_name as string,
          role: row.party_role as string,
          docId: row.document_id as string,
        });
      }
    }

    // Verify all documents are accessible
    const uniqueDocIds = [...new Set(
      Array.from(originalNames.values()).map(v => v.docId)
    )];
    const accessibleDocs = new Set<string>();
    for (let i = 0; i < uniqueDocIds.length; i += BATCH) {
      const batch = uniqueDocIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const result = await env.WELLS_DB.prepare(`
        SELECT d.id FROM documents d
        WHERE d.id IN (${placeholders}) AND ${docOwner.where}
      `).bind(...batch, ...docOwner.params).all();
      for (const row of result.results as any[]) {
        accessibleDocs.add(row.id as string);
      }
    }

    // Filter corrections to only those with accessible docs
    const validCorrections = corrections.filter(c => {
      const orig = originalNames.get(c.partyRowId);
      return orig && accessibleDocs.has(orig.docId);
    });
    if (validCorrections.length === 0) return jsonResponse({ error: 'No accessible documents found' }, 403);

    // Process corrections in batches of 250 (500 stmts per batch, D1 limit)
    const CORRECTION_BATCH = 250;
    let correctedCount = 0;
    const failedRowIds: number[] = [];

    for (let i = 0; i < validCorrections.length; i += CORRECTION_BATCH) {
      const batch = validCorrections.slice(i, i + CORRECTION_BATCH);
      const stmts: D1PreparedStatement[] = [];

      for (const corr of batch) {
        const original = originalNames.get(corr.partyRowId);
        if (!original) {
          failedRowIds.push(corr.partyRowId);
          continue;
        }

        const correctedTrimmed = corr.correctedValue.trim();
        const normalizedCorrected = normalizePartyName(correctedTrimmed);
        const field = GRANTOR_ROLES.includes(original.role) ? 'grantor' : 'grantee';
        const corrId = `corr_${crypto.randomUUID()}`;

        // Upsert user_corrections
        stmts.push(
          env.WELLS_DB.prepare(`
            INSERT INTO user_corrections (id, document_id, field, party_row_id, original_value, corrected_value, corrected_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(document_id, party_row_id) DO UPDATE SET
              corrected_value = excluded.corrected_value,
              corrected_by = excluded.corrected_by,
              updated_at = datetime('now')
          `).bind(corrId, original.docId, field, corr.partyRowId, original.name, correctedTrimmed, authUser.email)
        );

        // Update document_parties
        stmts.push(
          env.WELLS_DB.prepare(`
            UPDATE document_parties SET party_name = ?, party_name_normalized = ?
            WHERE id = ? AND document_id = ?
          `).bind(correctedTrimmed, normalizedCorrected, corr.partyRowId, original.docId)
        );
      }

      if (stmts.length > 0) {
        try {
          await env.WELLS_DB.batch(stmts);
          correctedCount += batch.length - failedRowIds.filter(id => batch.some(c => c.partyRowId === id)).length;
        } catch (err) {
          console.error(`[BulkCorrect] Batch ${i / CORRECTION_BATCH} failed:`, err);
          for (const c of batch) failedRowIds.push(c.partyRowId);
        }
      }
    }

    // Upsert party_name_mappings
    let mappingsCreated = 0;
    if (mappings.length > 0) {
      const mappingStmts: D1PreparedStatement[] = [];
      for (const m of mappings) {
        const normalizedVariant = m.variantNormalized || normalizePartyName(m.variantOriginal);
        const normalizedCanonical = normalizePartyName(m.canonicalName);
        const mappingId = `pnm_${crypto.randomUUID()}`;

        mappingStmts.push(
          env.WELLS_DB.prepare(`
            INSERT INTO party_name_mappings (id, organization_id, user_id, variant_name_normalized, canonical_name, canonical_name_normalized, variant_original, created_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT DO UPDATE SET
              canonical_name = excluded.canonical_name,
              canonical_name_normalized = excluded.canonical_name_normalized,
              variant_original = excluded.variant_original,
              created_by = excluded.created_by,
              updated_at = datetime('now')
          `).bind(
            mappingId,
            userOrgId || null,
            authUser.id,
            normalizedVariant,
            m.canonicalName,
            normalizedCanonical,
            m.variantOriginal,
            authUser.email
          )
        );
      }

      try {
        await env.WELLS_DB.batch(mappingStmts);
        mappingsCreated = mappings.length;
      } catch (err) {
        console.error('[BulkCorrect] Mapping upsert failed:', err);
      }
    }

    // Invalidate cache + trigger edge rebuild ONCE
    await invalidateAndRebuild(env, ctx.prop.airtable_record_id);

    return jsonResponse({
      correctedCount,
      failedRowIds: [...new Set(failedRowIds)],
      mappingsCreated,
    });
  } catch (error) {
    console.error('[BulkCorrect] POST error:', error);
    return jsonResponse({ error: 'Failed to apply bulk corrections' }, 500);
  }
}

// ── DELETE /api/property/:propertyId/name-mapping/:mappingId ────────────────

export async function handleDeleteNameMapping(propertyId: string, mappingId: string, request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userRecord = await getUserByIdD1First(env, authUser.id);
    if (!userRecord) return jsonResponse({ error: 'User not found' }, 404);

    const userOrgId = userRecord.fields.Organization?.[0] as string | undefined;

    // Verify the mapping belongs to this user's org/scope
    const mapping = await env.WELLS_DB.prepare(`
      SELECT id, organization_id, user_id FROM party_name_mappings WHERE id = ?
    `).bind(mappingId).first<any>();

    if (!mapping) return jsonResponse({ error: 'Mapping not found' }, 404);

    // Check ownership: org match or user match for solo users
    if (userOrgId) {
      if (mapping.organization_id !== userOrgId) {
        return jsonResponse({ error: 'Access denied' }, 403);
      }
    } else {
      if (mapping.user_id !== authUser.id) {
        return jsonResponse({ error: 'Access denied' }, 403);
      }
    }

    await env.WELLS_DB.prepare(`
      DELETE FROM party_name_mappings WHERE id = ?
    `).bind(mappingId).run();

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[NameMapping] DELETE error:', error);
    return jsonResponse({ error: 'Failed to delete name mapping' }, 500);
  }
}
