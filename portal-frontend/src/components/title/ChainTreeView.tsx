import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { computeLayout, type ViewMode } from '../../lib/layout-engine';
import { transformTreeToFlatNodes } from '../../lib/tree-adapter';
import { ORANGE, DARK, SLATE, BORDER, WARNING_AMBER } from '../../lib/constants';
import type { TitleColors } from '../../lib/title-colors';
import type { TitleTree, FlatNode, FlatStackDoc, ChainProperty } from '../../types/title-chain';

import { PropertySelector } from './PropertySelector';
import { Edge } from './nodes/Edge';
import { DocNode } from './nodes/DocNode';
import { GapNode } from './nodes/GapNode';
import { CurrentOwnerNode } from './nodes/CurrentOwnerNode';
import { StackCollapsed } from './nodes/StackCollapsed';
import { StackExpanded } from './nodes/StackExpanded';
import { HoverTooltip } from './panels/HoverTooltip';
import { DetailDrawer } from './panels/DetailDrawer';
import { TreeLegend } from './TreeLegend';
import { OrphanCard } from './nodes/OrphanCard';
import { dedupScan } from '../../api/title-chain';
import { Spinner } from '../ui/Spinner';

interface ChainTreeViewProps {
  tree: TitleTree;
  propertyId?: string;
  isMobile?: boolean;
  viewMode?: ViewMode;
  darkMode?: boolean;
  colors?: TitleColors;
  onRefresh?: () => void;
  properties?: ChainProperty[];
  selectedPropertyId?: string | null;
  onPropertySelect?: (id: string) => void;
  propsLoading?: boolean;
  chainLoading?: boolean;
  isSuperAdmin?: boolean;
}

export function ChainTreeView({ tree, propertyId, isMobile, viewMode = 'detailed', darkMode, colors, onRefresh, properties, selectedPropertyId, onPropertySelect, propsLoading, chainLoading, isSuperAdmin }: ChainTreeViewProps) {
  const c = colors; // shorthand
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(isMobile ? 0.55 : 0.82);
  const [pan, setPan] = useState({ x: isMobile ? 10 : 40, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mouseDownPos, setMouseDownPos] = useState({ x: 0, y: 0 });
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [entranceKey, setEntranceKey] = useState(0);
  const [orphansExpanded, setOrphansExpanded] = useState(false);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [dedupResult, setDedupResult] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flexParentRef = useRef<HTMLDivElement>(null);

  // Entrance animation: increment key when tree or viewMode changes
  useEffect(() => { setEntranceKey((k) => k + 1); }, [tree, viewMode]);

  // Clear selection when tree changes (new property loaded)
  useEffect(() => { setSelectedNodeId(null); }, [tree]);

  // Transform API tree → flat nodes for layout
  const flatNodes = useMemo(() => transformTreeToFlatNodes(tree), [tree]);
  const orphanNodes = useMemo(() => flatNodes.filter(n => n.type === 'orphan'), [flatNodes]);
  const flatData = useMemo(() => ({ nodes: flatNodes.filter(n => n.type !== 'orphan') }), [flatNodes]);

  // Compute layout when stacks expand/collapse or view mode changes
  const layout = useMemo(() => computeLayout(flatData, expandedStacks, viewMode), [flatData, expandedStacks, viewMode]);

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

  // Wheel zoom — skip if cursor is over a scrollable overlay (property selector, etc.)
  const handleWheel = useCallback((e: WheelEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-scroll-passthrough]')) return;
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

  // Fullscreen — target flex parent so drawer is included
  const toggleFullscreen = useCallback(() => {
    const el = flexParentRef.current;
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
    if (e.button === 0) {
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
  const handleMouseUp = (e: React.MouseEvent) => {
    // Click empty canvas (no drag) → close drawer
    if (!isDragging && selectedNodeId) {
      const target = e.target as HTMLElement;
      // Only close if clicked on canvas bg (svg or rect bg), not on a node
      if (target.tagName === 'svg' || (target.tagName === 'rect' && !target.closest('g[style]'))) {
        setSelectedNodeId(null);
      }
    }
    setIsPanning(false);
    setIsDragging(false);
  };

  // Touch events for mobile pan
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setIsPanning(true);
      setIsDragging(false);
      setPanStart({ x: t.clientX - pan.x, y: t.clientY - pan.y });
      setMouseDownPos({ x: t.clientX, y: t.clientY });
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (isPanning && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - mouseDownPos.x;
      const dy = t.clientY - mouseDownPos.y;
      if (!isDragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        setIsDragging(true);
      }
      if (isDragging || Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        setPan({ x: t.clientX - panStart.x, y: t.clientY - panStart.y });
      }
    }
  };
  const handleTouchEnd = () => { setIsPanning(false); setIsDragging(false); };

  // Click to select/deselect node → opens drawer
  const handleNodeClick = useCallback((node: FlatNode | FlatStackDoc) => {
    setSelectedNodeId((prev) => prev === node.id ? null : node.id);
    setHoveredId(null);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Expand/collapse stacks
  const handleExpandStack = useCallback((id: string) => {
    setExpandedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // If selected node was a child of this stack, deselect
        const stackNode = flatNodes.find((n) => n.id === id);
        if (stackNode?.docs) {
          const childIds = stackNode.docs.map((d) => d.id);
          setSelectedNodeId((sel) => sel && childIds.includes(sel) ? null : sel);
        }
      } else {
        next.add(id);
        // Deselect the stack itself when expanding
        setSelectedNodeId((sel) => sel === id ? null : sel);
      }
      return next;
    });
  }, [flatNodes]);

  const hoveredNode = hoveredId ? findNode(hoveredId) : null;
  const showHover = hoveredId && hoveredId !== selectedNodeId;

  // Resolve selected node for drawer
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const found = findNode(selectedNodeId);
    if (!found) return null;
    // FlatStackDoc doesn't have 'type' field — wrap it as a doc FlatNode for drawer
    if (!('type' in found)) {
      return {
        ...found,
        type: 'document' as const,
      } as FlatNode;
    }
    return found as FlatNode;
  }, [selectedNodeId, findNode]);

  // Glow filter opacity — bump in dark mode for visibility
  const glowOpacity = darkMode ? '0.4' : '0.25';

  return (
    <div style={{ padding: isFullscreen ? '0' : isMobile ? '0 8px 8px' : '0 24px 24px', overflow: 'hidden' }}>
      <div
        ref={flexParentRef}
        style={{
          display: 'flex',
          background: c?.surface || '#fff', borderRadius: isFullscreen ? 0 : 12,
          border: isFullscreen ? 'none' : `1px solid ${c?.border || BORDER}`,
          overflow: 'hidden',
          height: isFullscreen ? '100vh' : isMobile ? 'calc(100vh - 180px)' : 'calc(100vh - 240px)',
          minHeight: isMobile ? 300 : 450,
        }}>
        {/* Canvas area */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
          <div
            ref={containerCallbackRef}
            style={{ width: '100%', height: '100%', position: 'relative' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setIsPanning(false); setIsDragging(false); setHoveredId(null); }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Property selector in fullscreen */}
            {isFullscreen && properties && onPropertySelect && (
              <div data-scroll-passthrough style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
                <PropertySelector
                  properties={properties}
                  selectedId={selectedPropertyId ?? null}
                  onSelect={onPropertySelect}
                  loading={propsLoading || false}
                  isMobile={isMobile}
                  darkMode={darkMode}
                  colors={c}
                />
              </div>
            )}
            {/* Zoom controls */}
            <div data-scroll-passthrough onMouseUp={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 4, flexDirection: 'column' }}>
              {[
                { label: '+', fn: () => setZoom((z) => Math.min(2, z + 0.15)) },
                { label: '\u2212', fn: () => setZoom((z) => Math.max(0.3, z - 0.15)) },
                { label: 'FIT', fn: () => { setZoom(isMobile ? 0.55 : 0.82); setPan({ x: isMobile ? 10 : 40, y: 0 }); } },
              ].map(({ label, fn }) => (
                <button key={label} onClick={fn}
                  style={{
                    width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, borderRadius: 6,
                    border: `1px solid ${c?.border || BORDER}`,
                    background: c?.zoomBtn || '#fff', cursor: 'pointer',
                    fontSize: label === 'FIT' ? (isMobile ? 10 : 9) : (isMobile ? 20 : 16), fontWeight: 700,
                    color: label === 'FIT' ? (c?.textMuted || SLATE) : (c?.zoomText || DARK),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                  {label}
                </button>
              ))}
              <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                onMouseUp={(e) => e.stopPropagation()}
                style={{
                  width: isMobile ? 44 : 32, height: isMobile ? 44 : 32, borderRadius: 6,
                  border: `1px solid ${c?.border || BORDER}`,
                  background: c?.zoomBtn || '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {isFullscreen ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c?.zoomText || DARK} strokeWidth="1.5">
                    <polyline points="9,1 9,5 13,5" /><polyline points="5,13 5,9 1,9" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c?.zoomText || DARK} strokeWidth="1.5">
                    <polyline points="9,1 13,1 13,5" /><polyline points="5,13 1,13 1,9" />
                  </svg>
                )}
              </button>
              <div style={{ textAlign: 'center', fontSize: 9, color: c?.textMuted || SLATE, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>
                {Math.round(zoom * 100)}%
              </div>
            </div>

            {/* Legend */}
            <TreeLegend isMobile={isMobile} colors={c} />

            {/* Expanded stacks count */}
            {expandedStacks.size > 0 && (
              <div style={{
                position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
                background: c?.text || DARK, color: c?.surface || '#fff', borderRadius: 6,
                padding: isMobile ? '8px 12px' : '4px 10px', minHeight: isMobile ? 44 : undefined,
                display: 'flex', alignItems: 'center',
                fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
              }} onClick={() => {
                setExpandedStacks(new Set());
                setSelectedNodeId(null);
              }}>
                {expandedStacks.size} expanded — collapse all
              </div>
            )}

            {/* SVG */}
            <style>{`
              @keyframes fadeSlideIn {
                from { opacity: 0; transform: translateY(-8px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>
            <svg width="100%" height="100%" overflow="hidden" style={{ cursor: isDragging ? 'grabbing' : 'grab', maxWidth: '100%' }}>
              <defs>
                <filter id="glow-orange" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#C05621" floodOpacity={glowOpacity} />
                </filter>
                <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#16a34a" floodOpacity={glowOpacity} />
                </filter>
                <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#e85d4a" floodOpacity={glowOpacity} />
                </filter>
              </defs>
              <g key={entranceKey} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
                style={{ animation: 'fadeSlideIn 0.4s ease-out' }}>
                {/* Edges */}
                {layout.edges.map((edge, i) => (
                  <Edge key={i} from={edge.from} to={edge.to} positions={layout.positions} isGap={edge.isGap} darkMode={darkMode} />
                ))}
                {/* Nodes */}
                {flatNodes.map((node) => {
                  const pos = layout.positions[node.id];
                  if (!pos) return null;
                  const isHov = hoveredId === node.id;
                  const isSel = selectedNodeId === node.id;
                  const isDimmed = selectedNodeId != null && !isSel && !isHov;

                  if (node.type === 'stack') {
                    if (expandedStacks.has(node.id)) {
                      return (
                        <StackExpanded key={node.id} node={node} pos={pos}
                          hoveredId={hoveredId} selectedNodeId={selectedNodeId}
                          viewMode={viewMode} colors={c}
                          onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                          onCardClick={(doc) => handleNodeClick(doc)}
                          onCollapse={() => handleExpandStack(node.id)} />
                      );
                    }
                    return (
                      <StackCollapsed key={node.id} node={node} pos={pos}
                        isHovered={isHov} isPinned={isSel} isDimmed={isDimmed}
                        viewMode={viewMode} colors={c}
                        onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                        onClick={handleNodeClick} onExpand={handleExpandStack} />
                    );
                  }
                  if (node.type === 'gap') {
                    return <GapNode key={node.id} node={node} pos={pos}
                      isHovered={isHov} isPinned={isSel} isDimmed={isDimmed}
                      viewMode={viewMode} colors={c}
                      onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                      onClick={handleNodeClick} />;
                  }
                  if (node.type === 'current') {
                    return <CurrentOwnerNode key={node.id} node={node} pos={pos}
                      isHovered={isHov} isPinned={isSel} isDimmed={isDimmed}
                      viewMode={viewMode} colors={c}
                      onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                      onClick={handleNodeClick} />;
                  }
                  return <DocNode key={node.id} node={node} pos={pos}
                    isHovered={isHov} isPinned={isSel} isDimmed={isDimmed}
                    viewMode={viewMode} colors={c} darkMode={darkMode}
                    onHover={setHoveredId} onLeave={() => setHoveredId(null)}
                    onClick={handleNodeClick} />;
                })}
              </g>
            </svg>

            {/* Hover tooltip — hidden on mobile */}
            {!isMobile && showHover && hoveredNode && 'type' in hoveredNode && (
              <HoverTooltip node={hoveredNode as FlatNode} pos={hoverPos} colors={c} />
            )}

            {/* Loading overlay when switching properties in fullscreen */}
            {chainLoading && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 20,
                background: (c?.surface || '#fff') + 'cc',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 28, height: 28, border: `3px solid ${c?.border || BORDER}`, borderTopColor: '#C05621',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ marginLeft: 10, fontSize: 13, color: c?.textMuted || SLATE }}>Loading...</span>
              </div>
            )}
          </div>
        </div>

        {/* Detail drawer — desktop only (mobile uses bottom sheet rendered via portal) */}
        {!isMobile && (
          <DetailDrawer
            node={selectedNode}
            propertyId={propertyId}
            onClose={handleCloseDrawer}
            onExpandStack={handleExpandStack}
            colors={c}
            onCorrectionSaved={onRefresh}
            isSuperAdmin={isSuperAdmin}
            onChainRefresh={onRefresh}
          />
        )}
      </div>

      {/* Orphan documents section */}
      {orphanNodes.length > 0 && (
        <div style={{
          marginTop: 12, borderRadius: 10,
          border: `1px solid ${c?.border || BORDER}`,
          background: c?.surface || '#fff', overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              onClick={() => setOrphansExpanded(v => !v)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: isMobile ? '12px 14px' : '10px 16px', background: 'none', border: 'none',
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5,
                  background: 'rgba(245,158,11,0.12)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11,
                }}>{'\u26A0'}</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: c?.text || DARK }}>
                  {orphanNodes.length} Orphan Document{orphanNodes.length !== 1 ? 's' : ''}
                </span>
                <span style={{ fontSize: 11, color: c?.textMuted || SLATE }}>
                  — not linked into chain
                </span>
              </div>
              <span style={{ fontSize: 14, color: c?.textMuted || SLATE, transition: 'transform 0.2s',
                transform: orphansExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                {'\u25BE'}
              </span>
            </button>
            {propertyId && (
              <button
                disabled={dedupRunning}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!propertyId || dedupRunning) return;
                  setDedupRunning(true);
                  setDedupResult(null);
                  dedupScan(propertyId)
                    .then((res) => {
                      if (res.totalFlagged > 0) {
                        const confirmed = (res.tier1aDuplicates || 0) + (res.tier1bDuplicates || 0);
                        const review = res.tier2Duplicates || 0;
                        const parts: string[] = [];
                        if (confirmed > 0) parts.push(`${confirmed} confirmed`);
                        if (review > 0) parts.push(`${review} needs review`);
                        setDedupResult(`Flagged ${res.totalFlagged} duplicate${res.totalFlagged !== 1 ? 's' : ''} (${parts.join(', ')})`);
                        onRefresh?.();
                      } else {
                        setDedupResult('No duplicates found');
                      }
                      setTimeout(() => setDedupResult(null), 5000);
                    })
                    .catch(() => setDedupResult('Scan failed'))
                    .finally(() => setDedupRunning(false));
                }}
                style={{
                  marginRight: 12, padding: '4px 10px', fontSize: 10, fontWeight: 600,
                  border: `1px solid ${c?.border || BORDER}`, borderRadius: 5,
                  background: c?.surface || '#fff', color: c?.textMuted || SLATE,
                  cursor: dedupRunning ? 'default' : 'pointer', fontFamily: "'DM Sans', sans-serif",
                  display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                  opacity: dedupRunning ? 0.6 : 1,
                }}
                title="Scan for and flag duplicate documents based on book/page and instrument number"
              >
                {dedupRunning ? <><Spinner size={10} /> Scanning...</> : 'Scan Duplicates'}
              </button>
            )}
          </div>
          {dedupResult && (
            <div style={{
              padding: '4px 16px 8px', fontSize: 11, fontWeight: 600,
              color: dedupResult.includes('Flagged') ? '#059669' : (c?.textMuted || SLATE),
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {dedupResult}
            </div>
          )}
          {orphansExpanded && (
            <div style={{
              padding: isMobile ? '0 14px 14px' : '0 16px 14px',
              display: 'grid', gap: 8,
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
            }}>
              {orphanNodes.map(node => (
                <OrphanCard
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  isMobile={isMobile}
                  colors={c}
                  onClick={handleNodeClick}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mobile bottom sheet */}
      {isMobile && (
        <DetailDrawer
          node={selectedNode}
          propertyId={propertyId}
          onClose={handleCloseDrawer}
          onExpandStack={handleExpandStack}
          isMobile
          colors={c}
          onCorrectionSaved={onRefresh}
          isSuperAdmin={isSuperAdmin}
          onChainRefresh={onRefresh}
        />
      )}
    </div>
  );
}
