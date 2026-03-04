import { useState, useMemo, useCallback, useRef } from 'react';
import { computeLayout } from '../../lib/layout-engine';
import { transformTreeToFlatNodes } from '../../lib/tree-adapter';
import { ORANGE, DARK, SLATE, BORDER } from '../../lib/constants';
import type { TitleTree, FlatNode, FlatStackDoc } from '../../types/title-chain';

import { Edge } from './nodes/Edge';
import { DocNode } from './nodes/DocNode';
import { GapNode } from './nodes/GapNode';
import { CurrentOwnerNode } from './nodes/CurrentOwnerNode';
import { StackCollapsed } from './nodes/StackCollapsed';
import { StackExpanded } from './nodes/StackExpanded';
import { HoverTooltip } from './panels/HoverTooltip';
import { PinnedDetail } from './panels/PinnedDetail';
import { TreeLegend } from './TreeLegend';

interface ChainTreeViewProps {
  tree: TitleTree;
}

export function ChainTreeView({ tree }: ChainTreeViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(0.82);
  const [pan, setPan] = useState({ x: 40, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mouseDownPos, setMouseDownPos] = useState({ x: 0, y: 0 });
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [pinnedPositions, setPinnedPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  // Transform API tree → flat nodes for layout
  const flatNodes = useMemo(() => transformTreeToFlatNodes(tree), [tree]);
  const flatData = useMemo(() => ({ nodes: flatNodes }), [flatNodes]);

  // Compute layout when stacks expand/collapse
  const layout = useMemo(() => computeLayout(flatData, expandedStacks), [flatData, expandedStacks]);

  // Find a node by ID (checks main nodes and stack docs)
  const findNode = useCallback((id: string): FlatNode | FlatStackDoc | null => {
    const direct = flatNodes.find((n) => n.id === id);
    if (direct) return direct;
    for (const n of flatNodes) {
      if (n.type === 'stack' && n.docs) {
        const doc = n.docs.find((d) => d.id === id);
        if (doc) return doc;
      }
    }
    return null;
  }, [flatNodes]);

  // Wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(2, z + (e.deltaY > 0 ? -0.08 : 0.08))));
  }, []);

  // Attach wheel listener
  const wheelAttached = useRef(false);
  const containerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !wheelAttached.current) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      wheelAttached.current = true;
      (containerRef as React.MutableRefObject<HTMLDivElement>).current = el;
    }
  }, [handleWheel]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Pan with drag threshold (3px) so clicks don't accidentally pan
  const DRAG_THRESHOLD = 3;
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest('[data-pinned]')) {
      setIsPanning(true);
      setIsDragging(false);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      setMouseDownPos({ x: e.clientX, y: e.clientY });
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      if (!isDragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        setIsDragging(true);
      }
      if (isDragging || Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      }
    }
    if (hoveredId && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setHoverPos({ x: e.clientX - rect.left + 16, y: e.clientY - rect.top - 40 });
    }
  };
  const handleMouseUp = () => { setIsPanning(false); setIsDragging(false); };

  // Pin position
  const computePinPosition = useCallback((nodeId: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 200, y: 100 };
    const nodePos = layout.positions[nodeId] || layout.expandedCardPositions[nodeId];
    if (nodePos) {
      let px = (nodePos.x + nodePos.w) * zoom + pan.x + 20;
      let py = nodePos.y * zoom + pan.y;
      px = Math.min(px, rect.width - 330);
      py = Math.max(10, Math.min(py, rect.height - 300));
      return { x: px, y: py };
    }
    return { x: 200, y: 100 };
  }, [layout, zoom, pan]);

  // Click to pin/unpin
  const handleNodeClick = useCallback((node: FlatNode | FlatStackDoc) => {
    const pos = computePinPosition(node.id);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    setPinnedPositions((prev) => ({ ...prev, [node.id]: pos }));
    setHoveredId(null);
  }, [computePinPosition]);

  const handleUnpin = useCallback((id: string) => {
    setPinnedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  // Expand/collapse stacks
  const handleExpandStack = useCallback((id: string) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const stackNode = flatNodes.find((n) => n.id === id);
        if (stackNode?.docs) {
          const childIds = stackNode.docs.map((d) => d.id);
          setPinnedIds((pp) => {
            const np = new Set(pp);
            childIds.forEach((cid) => np.delete(cid));
            return np;
          });
        }
      } else {
        next.add(id);
        setPinnedIds((pp) => { const np = new Set(pp); np.delete(id); return np; });
      }
      return next;
    });
  }, [flatNodes]);

  const hoveredNode = hoveredId ? findNode(hoveredId) : null;
  const showHover = hoveredId && !pinnedIds.has(hoveredId);

  return (
    <div style={{ padding: isFullscreen ? '0' : '0 24px 24px' }}>
      <div
        ref={canvasWrapperRef}
        style={{
          background: '#fff', borderRadius: isFullscreen ? 0 : 12,
          border: isFullscreen ? 'none' : `1px solid ${BORDER}`,
          position: 'relative', overflow: 'hidden',
          height: isFullscreen ? '100vh' : 'calc(100vh - 320px)', minHeight: 450,
        }}>
        <div
          ref={containerCallbackRef}
          style={{ width: '100%', height: '100%', position: 'relative' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { handleMouseUp(); setHoveredId(null); }}
        >
          {/* Zoom controls */}
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 4, flexDirection: 'column' }}>
            {[
              { label: '+', fn: () => setZoom((z) => Math.min(2, z + 0.15)) },
              { label: '\u2212', fn: () => setZoom((z) => Math.max(0.3, z - 0.15)) },
              { label: 'FIT', fn: () => { setZoom(0.82); setPan({ x: 40, y: 0 }); } },
            ].map(({ label, fn }) => (
              <button key={label} onClick={fn}
                style={{
                  width: 32, height: 32, borderRadius: 6, border: `1px solid ${BORDER}`,
                  background: '#fff', cursor: 'pointer',
                  fontSize: label === 'FIT' ? 9 : 16, fontWeight: 700,
                  color: label === 'FIT' ? SLATE : DARK,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                {label}
              </button>
            ))}
            <button onClick={toggleFullscreen}
              style={{
                width: 32, height: 32, borderRadius: 6, border: `1px solid ${BORDER}`,
                background: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={DARK} strokeWidth="1.5">
                  <polyline points="9,1 9,5 13,5" /><polyline points="5,13 5,9 1,9" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={DARK} strokeWidth="1.5">
                  <polyline points="9,1 13,1 13,5" /><polyline points="5,13 1,13 1,9" />
                </svg>
              )}
            </button>
            <div style={{ textAlign: 'center', fontSize: 9, color: SLATE, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Legend */}
          <TreeLegend />

          {/* Pinned count */}
          {pinnedIds.size > 0 && (
            <div style={{
              position: 'absolute', top: 12, left: 12, zIndex: 10,
              background: ORANGE, color: '#fff', borderRadius: 6, padding: '4px 10px',
              fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
            }} onClick={() => setPinnedIds(new Set())}>
              {pinnedIds.size} pinned — clear all
            </div>
          )}

          {/* Expanded stacks count */}
          {expandedStacks.size > 0 && (
            <div style={{
              position: 'absolute', top: 12, left: pinnedIds.size > 0 ? 160 : 12, zIndex: 10,
              background: DARK, color: '#fff', borderRadius: 6, padding: '4px 10px',
              fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
            }} onClick={() => {
              expandedStacks.forEach((sid) => {
                const sn = flatNodes.find((n) => n.id === sid);
                if (sn?.docs) sn.docs.forEach((d) => pinnedIds.delete(d.id));
              });
              setPinnedIds(new Set(pinnedIds));
              setExpandedStacks(new Set());
            }}>
              {expandedStacks.size} expanded — collapse all
            </div>
          )}

          {/* SVG */}
          <svg width="100%" height="100%" style={{ cursor: isDragging ? 'grabbing' : 'grab' }}>
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Edges */}
              {layout.edges.map((edge, i) => (
                <Edge key={i} from={edge.from} to={edge.to} positions={layout.positions} isGap={edge.isGap} />
              ))}
              {/* Nodes */}
              {flatNodes.map((node) => {
                const pos = layout.positions[node.id];
                if (!pos) return null;
                const isHov = hoveredId === node.id;
                const isPin = pinnedIds.has(node.id);

                if (node.type === 'stack') {
                  if (expandedStacks.has(node.id)) {
                    return (
                      <StackExpanded key={node.id} node={node} pos={pos}
                        hoveredId={hoveredId} pinnedIds={pinnedIds}
                        onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                        onCardClick={(doc) => handleNodeClick(doc)}
                        onCollapse={() => handleExpandStack(node.id)} />
                    );
                  }
                  return (
                    <StackCollapsed key={node.id} node={node} pos={pos}
                      isHovered={isHov} isPinned={isPin}
                      onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                      onClick={handleNodeClick} onExpand={handleExpandStack} />
                  );
                }
                if (node.type === 'gap') {
                  return <GapNode key={node.id} node={node} pos={pos}
                    isHovered={isHov} isPinned={isPin}
                    onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                    onClick={handleNodeClick} />;
                }
                if (node.type === 'current') {
                  return <CurrentOwnerNode key={node.id} node={node} pos={pos}
                    isHovered={isHov} isPinned={isPin}
                    onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                    onClick={handleNodeClick} />;
                }
                return <DocNode key={node.id} node={node} pos={pos}
                  isHovered={isHov} isPinned={isPin}
                  onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                  onClick={handleNodeClick} />;
              })}
            </g>
          </svg>

          {/* Hover tooltip */}
          {showHover && hoveredNode && 'type' in hoveredNode && (
            <HoverTooltip node={hoveredNode as FlatNode} pos={hoverPos} />
          )}

          {/* Pinned detail panels */}
          {Array.from(pinnedIds).map((id) => {
            const node = findNode(id);
            const pos = pinnedPositions[id] || computePinPosition(id);
            if (!node || !('type' in node)) return null;
            return (
              <div key={id} data-pinned="true">
                <PinnedDetail
                  node={node as FlatNode}
                  position={pos}
                  onClose={handleUnpin}
                  onExpandStack={handleExpandStack}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
