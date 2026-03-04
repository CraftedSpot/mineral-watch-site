/**
 * Layout engine — computes x/y positions for all nodes in the tree.
 * Pure function extracted from chain-of-title-tree-v4.jsx computeLayout().
 * No React dependencies.
 */
import {
  NODE_W, NODE_H, STACK_H, GAP_H, CURRENT_H,
  H_GAP, V_GAP, PAD, EXPANDED_CARD_H, EXPANDED_CARD_GAP,
} from './constants';
import type {
  FlatNode, LayoutResult, NodePosition, ExpandedCardPosition, LayoutEdge,
} from '../types/title-chain';

export interface FlatData {
  nodes: FlatNode[];
}

export function computeLayout(data: FlatData, expandedStacks: Set<string>): LayoutResult {
  const nodeMap: Record<string, FlatNode> = {};
  data.nodes.forEach((n) => (nodeMap[n.id] = { ...n }));

  // Identify roots (nodes that are never listed as children)
  const childIds = new Set<string>();
  data.nodes.forEach((n) => (n.children || []).forEach((c) => childIds.add(c)));
  const roots = data.nodes.filter((n) => !childIds.has(n.id));

  // BFS to assign levels
  const levels: Record<string, number> = {};
  const queue: Array<{ id: string; level: number }> = roots.map((r) => ({ id: r.id, level: 0 }));
  const visited = new Set<string>();
  let maxLevel = 0;

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    levels[id] = level;
    maxLevel = Math.max(maxLevel, level);
    const node = nodeMap[id];
    if (node?.children) {
      node.children.forEach((cid) => {
        if (!visited.has(cid)) queue.push({ id: cid, level: level + 1 });
      });
    }
  }

  const positions: Record<string, NodePosition> = {};
  const expandedCardPositions: Record<string, ExpandedCardPosition> = {};

  function getNodeHeight(id: string): number {
    const node = nodeMap[id];
    if (!node) return NODE_H;
    if (node.type === 'stack' && expandedStacks.has(id)) {
      const docCount = (node.docs || []).length;
      return docCount * (EXPANDED_CARD_H + EXPANDED_CARD_GAP) + 36;
    }
    if (node.type === 'stack') return STACK_H;
    if (node.type === 'gap') return GAP_H;
    if (node.type === 'current') return CURRENT_H;
    return NODE_H;
  }

  function getSubtreeWidth(id: string): number {
    const node = nodeMap[id];
    if (!node || !node.children || node.children.length === 0) return NODE_W;
    return Math.max(
      NODE_W,
      node.children.reduce((sum, cid, i) => sum + getSubtreeWidth(cid) + (i > 0 ? H_GAP : 0), 0),
    );
  }

  function assignPositions(id: string, xCenter: number, level: number) {
    const node = nodeMap[id];
    if (!node) return;
    const h = getNodeHeight(id);
    const y = PAD + (maxLevel - level) * (NODE_H + V_GAP);
    positions[id] = { x: xCenter - NODE_W / 2, y, w: NODE_W, h };

    // Expanded stack: compute individual card positions
    if (node.type === 'stack' && expandedStacks.has(id)) {
      const docs = node.docs || [];
      docs.forEach((doc, i) => {
        expandedCardPositions[doc.id] = {
          x: xCenter - NODE_W / 2,
          y: y + 28 + i * (EXPANDED_CARD_H + EXPANDED_CARD_GAP),
          w: NODE_W,
          h: EXPANDED_CARD_H,
          parentStackId: id,
        };
      });
    }

    if (node.children?.length > 0) {
      const totalWidth = node.children.reduce(
        (sum, cid, i) => sum + getSubtreeWidth(cid) + (i > 0 ? H_GAP : 0),
        0,
      );
      let startX = xCenter - totalWidth / 2;
      node.children.forEach((cid) => {
        const w = getSubtreeWidth(cid);
        assignPositions(cid, startX + w / 2, levels[cid] ?? level + 1);
        startX += w + H_GAP;
      });
    }
  }

  // Assign positions for each root (support multiple roots)
  if (roots.length === 1) {
    const rootCenter = getSubtreeWidth(roots[0].id) / 2 + PAD;
    assignPositions(roots[0].id, rootCenter, 0);
  } else if (roots.length > 1) {
    let xOffset = PAD;
    for (const root of roots) {
      const w = getSubtreeWidth(root.id);
      assignPositions(root.id, xOffset + w / 2, 0);
      xOffset += w + H_GAP * 2;
    }
  }

  // Compute bounding box
  let maxX = 0, maxY = 0;
  Object.values(positions).forEach((p) => {
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  });

  // Build edges
  const edges: LayoutEdge[] = [];
  data.nodes.forEach((node) => {
    (node.children || []).forEach((cid) => {
      if (positions[node.id] && positions[cid]) {
        edges.push({ from: node.id, to: cid, isGap: nodeMap[cid]?.type === 'gap' });
      }
    });
  });

  return {
    positions,
    expandedCardPositions,
    edges,
    width: maxX + PAD,
    height: maxY + PAD,
    nodeMap,
    maxLevel,
  };
}
