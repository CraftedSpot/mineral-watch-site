/**
 * Tree adapter — transforms API TitleTree → flat node format for the layout engine.
 *
 * This is the critical glue between the API response (nested tree with TreeNode[])
 * and the layout engine (flat array of FlatNode with children as ID arrays).
 *
 * API TreeNode structure (nested):
 *   { id, docType, date, fromNames, toNames, stackedDocs: string[], children: TreeNode[] }
 *
 * Layout FlatNode structure (flat):
 *   { id, type, docType, date, grantor, grantee, children: string[], docs?: [...] }
 */
import type {
  TitleTree, TreeNode, ChainOwnerRow, ChainGap, FlatNode, FlatStackDoc, OrphanDoc,
} from '../types/title-chain';

/** Format an ISO date for display: "1951-03-15" → "Mar 15, 1951" */
function formatDateShort(d: string): string {
  const date = d.includes('-') && d.indexOf('-') === 4
    ? new Date(d + 'T00:00:00')
    : new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format a doc type slug for display: "mineral_deed" → "Mineral Deed" */
function formatDocType(docType: string | null): string {
  if (!docType) return 'Document';
  return docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Transforms an API TitleTree into a flat node array for the layout engine.
 * Handles: nested→flat, stacked docs, gaps, current owners.
 */
export function transformTreeToFlatNodes(tree: TitleTree): FlatNode[] {
  const nodes: FlatNode[] = [];
  const seen = new Set<string>();

  // 1. Recursively walk tree roots → flat nodes
  function walkNode(treeNode: TreeNode, parentId?: string): string {
    // Skip if already processed (shouldn't happen, but defensive)
    if (seen.has(treeNode.id)) return treeNode.id;
    seen.add(treeNode.id);

    const hasStack = treeNode.stackedDocs.length > 0;

    if (hasStack) {
      // This node + its stackedDocs form a stack
      const stackId = `stack_${treeNode.id}`;
      const allStackDocIds = [treeNode.id, ...treeNode.stackedDocs];

      // Build docs array for the stack — primary doc first
      const stackDocs: FlatStackDoc[] = [{
        id: treeNode.id,
        docType: formatDocType(treeNode.docType),
        date: treeNode.date,
        grantor: (treeNode.fromNames || []).join(', ') || '',
        grantee: (treeNode.toNames || []).join(', ') || '',
        interestConveyed: treeNode.interestConveyed,
        _treeNode: treeNode,
        _parties: treeNode._parties || [],
        _corrections: treeNode._corrections || null,
      }];

      // Secondary stacked docs — use _stackedNodes for rich data, fallback to minimal
      const stackedNodeMap = new Map(
        (treeNode._stackedNodes || []).map(sn => [sn.id, sn])
      );
      for (const sdId of treeNode.stackedDocs) {
        seen.add(sdId);
        const sn = stackedNodeMap.get(sdId);
        stackDocs.push({
          id: sdId,
          docType: sn ? formatDocType(sn.docType) : 'Document',
          date: sn?.date ?? treeNode.date,
          grantor: sn ? (sn.fromNames || []).join(', ') : (treeNode.fromNames || []).join(', ') || '',
          grantee: sn ? (sn.toNames || []).join(', ') : (treeNode.toNames || []).join(', ') || '',
          interestConveyed: sn?.interestConveyed,
          _treeNode: treeNode,
          _parties: sn?._parties || [],
          _corrections: sn?._corrections || null,
        });
      }

      // Recurse into children
      const childIds: string[] = [];
      for (const child of treeNode.children) {
        if (!seen.has(child.id)) {
          childIds.push(walkNode(child));
        }
      }

      nodes.push({
        id: stackId,
        type: 'stack',
        docType: formatDocType(treeNode.docType),
        date: treeNode.date,
        grantor: (treeNode.fromNames || []).join(', ') || '',
        grantee: (treeNode.toNames || []).join(', ') || '',
        children: childIds,
        docs: stackDocs,
        label: `${stackDocs.length} docs — ${formatDocType(treeNode.docType)}`,
        _parties: treeNode._parties || [],
        _corrections: treeNode._corrections || null,
        _treeNode: treeNode,
      });

      return stackId;
    }

    // Regular document node
    const childIds: string[] = [];
    for (const child of treeNode.children) {
      if (!seen.has(child.id)) {
        childIds.push(walkNode(child));
      }
    }

    nodes.push({
      id: treeNode.id,
      type: 'document',
      docType: formatDocType(treeNode.docType),
      date: treeNode.date,
      grantor: (treeNode.fromNames || []).join(', ') || '',
      grantee: (treeNode.toNames || []).join(', ') || '',
      interestConveyed: treeNode.interestConveyed,
      summary: treeNode.summary,
      children: childIds,
      _parties: treeNode._parties || [],
      _corrections: treeNode._corrections || null,
      _treeNode: treeNode,
    });

    return treeNode.id;
  }

  // Walk all roots
  for (const root of tree.roots) {
    walkNode(root);
  }

  // Helper: find the flat node that contains a given doc ID
  // Checks direct ID, _treeNode.id, AND docs inside stacks
  function findParentByDocId(docId: string): FlatNode | undefined {
    return nodes.find((n) => {
      if (n.id === docId) return true;
      if (n._treeNode?.id === docId) return true;
      // Check if docId is inside this stack's docs array
      if (n.type === 'stack' && n.docs?.some((d) => d.id === docId)) return true;
      return false;
    });
  }

  // 2. Add gap nodes — attached as children of lastSeenDocId
  for (const gap of tree.gaps) {
    const gapId = `gap_${gap.lastSeenDocId}_${gap.partyName.replace(/\s+/g, '_').slice(0, 20)}`;
    if (seen.has(gapId)) continue;
    seen.add(gapId);

    const lastDateRaw = gap.lastSeenDate || 'Unknown';
    const lastDateFmt = lastDateRaw !== 'Unknown' ? formatDateShort(lastDateRaw) : 'Unknown';
    // Look up parent doc for context
    const parentNode = findParentByDocId(gap.lastSeenDocId);

    nodes.push({
      id: gapId,
      type: 'gap',
      children: [],
      dateRange: `${lastDateFmt} — present`,
      description: `${gap.partyName} last seen as ${gap.lastSeenAs}`,
      suggestion: `Search county records for ${gap.partyName} conveyances after ${lastDateFmt}.`,
      gapPartyName: gap.partyName,
      gapLastSeenAs: gap.lastSeenAs,
      gapLastSeenDocId: gap.lastSeenDocId,
      gapLastSeenDate: gap.lastSeenDate,
      gapParentDocType: parentNode?.docType,
      gapParentGrantor: parentNode?.grantor,
      gapParentGrantee: parentNode?.grantee,
    });

    // Attach gap as child of the last-seen doc
    if (parentNode) {
      parentNode.children.push(gapId);
    }
  }

  // 3. Add current owner nodes — attached as children of acquiredViaDocId
  for (const owner of tree.currentOwners) {
    const ownerId = `current_${owner.owner_name_normalized.replace(/\s+/g, '_').slice(0, 30)}`;
    // Handle duplicate owners with different interests
    let uniqueId = ownerId;
    let counter = 1;
    while (seen.has(uniqueId)) {
      uniqueId = `${ownerId}_${counter++}`;
    }
    seen.add(uniqueId);

    nodes.push({
      id: uniqueId,
      type: 'current',
      children: [],
      owner: owner.owner_name,
      interest: owner.interest_text || undefined,
      interestDecimal: owner.interest_decimal,
      interestType: owner.interest_type,
      acquiredDate: owner.acquired_date,
      acquiredViaDocId: owner.acquired_via_doc_id,
      ownerId: owner.id,
      isManual: owner.is_manual === 1,
      sourcePartyRowId: owner.source_party_row_id,
      sourceCorrection: owner.source_correction,
      _sourceParties: owner._sourceParties,
      _sourceCorrections: owner._sourceCorrections,
    });

    // Attach as child of acquired-via doc (checks stacks too)
    if (owner.acquired_via_doc_id) {
      const parentNode = findParentByDocId(owner.acquired_via_doc_id);
      if (parentNode) {
        parentNode.children.push(uniqueId);
      }
    }
  }

  // 4. Add orphan document nodes — parentless, rendered in separate section
  const orphanDocs = tree.orphanDocs || [];
  for (const orphan of orphanDocs) {
    // Use raw doc ID — orphans are by definition not in the tree, so no collision
    if (seen.has(orphan.id)) continue;
    seen.add(orphan.id);

    nodes.push({
      id: orphan.id,
      type: 'orphan',
      docType: formatDocType(orphan.docType),
      date: orphan.date,
      displayName: orphan.displayName,
      category: orphan.category,
      grantor: (orphan.fromNames || []).join(', ') || '',
      grantee: (orphan.toNames || []).join(', ') || '',
      interestConveyed: orphan.interestConveyed,
      reason: orphan.reason,
      children: [],
      _parties: orphan._parties || [],
      _corrections: orphan._corrections || null,
    });
  }

  return nodes;
}
