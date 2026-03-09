import { useState, useEffect, useRef, useCallback } from 'react';
import { ORANGE, DARK, SLATE, GAP_COLOR, GREEN, BORDER, MODAL_TYPES } from '../../../lib/constants';
import type { TitleColors } from '../../../lib/title-colors';
import { formatDate, formatDecimal, truncate } from '../../../lib/helpers';
import { fetchDocumentDetail, fetchDocumentBlob } from '../../../api/documents';
import { useModal } from '../../../contexts/ModalContext';
import type { FlatNode } from '../../../types/title-chain';

interface DetailDrawerProps {
  node: FlatNode | null;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  isMobile?: boolean;
  colors?: TitleColors;
}

const DRAWER_W = 380;

export function DetailDrawer({ node, onClose, onExpandStack, isMobile, colors: c }: DetailDrawerProps) {
  const isOpen = !!node;
  const [expanded, setExpanded] = useState(false);
  const drawerWidth = expanded ? Math.round(window.innerWidth * 0.6) : DRAWER_W;

  // Collapse back when drawer closes
  useEffect(() => {
    if (!isOpen) setExpanded(false);
  }, [isOpen]);

  // Escape key closes drawer
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (isMobile) {
    return <MobileSheet node={node} onClose={onClose} onExpandStack={onExpandStack} colors={c} />;
  }

  // Desktop: right-side drawer
  return (
    <div style={{
      width: isOpen ? drawerWidth : 0,
      transition: 'width 0.3s ease',
      overflow: 'hidden',
      flexShrink: 0,
      borderLeft: isOpen ? `1px solid ${c?.border || BORDER}` : 'none',
    }}>
      <div style={{
        width: drawerWidth,
        height: '100%',
        display: 'flex', flexDirection: 'column',
        background: c?.surface || '#fff',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {node && <DrawerContent node={node} onClose={onClose} onExpandStack={onExpandStack} colors={c} expanded={expanded} onToggleExpand={() => setExpanded((e) => !e)} />}
      </div>
    </div>
  );
}

function MobileSheet({ node, onClose, onExpandStack, colors: c }: {
  node: FlatNode | null;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  colors?: TitleColors;
}) {
  const isOpen = !!node;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', zIndex: 999998,
          }}
        />
      )}
      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        maxHeight: '60vh',
        transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s ease',
        background: c?.surface || '#fff',
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
        zIndex: 999999,
        display: 'flex', flexDirection: 'column',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {/* Drag handle */}
        <div style={{
          display: 'flex', justifyContent: 'center', padding: '8px 0 4px', flexShrink: 0,
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: c?.border || '#d1d5db' }} />
        </div>
        {node && <DrawerContent node={node} onClose={onClose} onExpandStack={onExpandStack} colors={c} isMobile />}
      </div>
    </>
  );
}

// --- Document detail types (subset of what the API returns) ---
interface DocDetail {
  filename: string;
  content_type: string;
  rotation_applied: number;
  extracted_data: Record<string, unknown> | null;
}

function DrawerContent({ node, onClose, onExpandStack, colors: c, isMobile, expanded, onToggleExpand }: {
  node: FlatNode;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  colors?: TitleColors;
  isMobile?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const isDocType = node.type === 'document' || (!node.type && node.docType);
  const modal = useModal();

  // Document detail state (for header book/page + viewer)
  const [docDetail, setDocDetail] = useState<DocDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'document'>('document');
  const [docBlob, setDocBlob] = useState<{ url: string; type: string } | null>(null);
  const [blobLoading, setBlobLoading] = useState(false);
  const [blobError, setBlobError] = useState(false);
  const nodeIdRef = useRef(node.id);

  // Reset state when node changes
  useEffect(() => {
    nodeIdRef.current = node.id;
    setActiveTab('document');
    setDocDetail(null);
    setBlobError(false);
    setBlobLoading(false);
    // Clean up previous blob
    setDocBlob((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, [node.id]);

  // Fetch document detail on mount (for header + enabling Document tab)
  useEffect(() => {
    if (!isDocType) return;
    const currentId = node.id;
    fetchDocumentDetail(node.id)
      .then((res) => {
        if (nodeIdRef.current !== currentId) return; // stale
        setDocDetail({
          filename: res.filename,
          content_type: res.content_type,
          rotation_applied: res.rotation_applied,
          extracted_data: typeof res.extracted_data === 'string'
            ? JSON.parse(res.extracted_data) : res.extracted_data,
        });
      })
      .catch(() => {}); // non-critical — drawer still shows tree data
  }, [node.id, isDocType]);

  // Fetch blob when Document tab first activated
  useEffect(() => {
    if (activeTab !== 'document' || docBlob || blobLoading || !isDocType) return;
    const currentId = node.id;
    setBlobLoading(true);
    setBlobError(false);
    fetchDocumentBlob(node.id)
      .then(({ blob, contentType }) => {
        if (nodeIdRef.current !== currentId) return; // stale
        setDocBlob({ url: URL.createObjectURL(blob), type: contentType });
      })
      .catch(() => {
        if (nodeIdRef.current !== currentId) return;
        setBlobError(true);
      })
      .finally(() => {
        if (nodeIdRef.current !== currentId) return;
        setBlobLoading(false);
      });
  }, [activeTab, docBlob, blobLoading, node.id, isDocType]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (docBlob?.url) URL.revokeObjectURL(docBlob.url);
    };
  }, [docBlob]);

  // Image zoom + pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });

  // Reset zoom/pan when node changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
  }, [node.id]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => {
      const next = Math.min(5, Math.max(1, z * factor));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY };
    panOriginRef.current = { ...pan };
  }, [zoom, pan]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = (e.clientX - panStartRef.current.x) / zoom;
    const dy = (e.clientY - panStartRef.current.y) / zoom;
    setPan({ x: panOriginRef.current.x + dx, y: panOriginRef.current.y + dy });
  }, [isPanning, zoom]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleImgDoubleClick = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Extract book/page from detail
  const recording = docDetail?.extracted_data as Record<string, unknown> | null;
  const book = recording?.recording_book || recording?.book;
  const page = recording?.recording_page || recording?.page;
  const bookPage = book && page ? `Book ${book} Pg ${page}` : book ? `Book ${book}` : null;

  const fieldBg = c?.fieldBg || '#f8f9fb';

  const headerBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none',
    color: c?.textMuted || SLATE, cursor: 'pointer',
    lineHeight: 1, padding: isMobile ? 8 : 4,
    minWidth: 36, minHeight: 36,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  const headerButtons = (
    <div style={{
      position: 'absolute', top: isMobile ? 6 : 8, right: isMobile ? 6 : 8,
      display: 'flex', gap: 2, alignItems: 'center',
    }}>
      {/* Expand / collapse toggle (desktop only) */}
      {!isMobile && onToggleExpand && (
        <button onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          title={expanded ? 'Collapse panel' : 'Expand panel'}
          style={{ ...headerBtnStyle, fontSize: 14 }}>
          {expanded ? '\u25B6' : '\u25C0'}
        </button>
      )}
      {/* Close */}
      <button onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{ ...headerBtnStyle, fontSize: isMobile ? 22 : 18 }}>
        {'\u00D7'}
      </button>
    </div>
  );

  // --- Non-document types: no tabs ---
  if (node.type === 'gap') {
    return (
      <div style={{ padding: isMobile ? '14px 16px 24px' : '20px 24px', position: 'relative', overflowY: 'auto', flex: 1 }}>
        {headerButtons}
        <div style={{ borderLeft: `3px solid ${GAP_COLOR}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: GAP_COLOR, textTransform: 'uppercase', letterSpacing: 1 }}>
            Gap in Chain
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK, marginTop: 4 }}>
            {'\u26A0'} Missing Documents
          </div>
        </div>
        <div style={{ fontSize: 13, color: c?.text || DARK, marginBottom: 12, lineHeight: 1.6 }}>
          {node.description}
        </div>
        <div style={{ fontSize: 12, color: c?.textMuted || SLATE, marginBottom: 16 }}>
          Period: {node.dateRange}
        </div>
        {node.suggestion && (
          <div style={{
            fontSize: 12, color: c?.text || DARK, padding: '12px 16px',
            background: fieldBg, borderRadius: 8, lineHeight: 1.5,
          }}>
            <strong>Suggestion:</strong> {node.suggestion}
          </div>
        )}
      </div>
    );
  }

  if (node.type === 'current') {
    return (
      <div style={{ padding: isMobile ? '14px 16px 24px' : '20px 24px', position: 'relative', overflowY: 'auto', flex: 1 }}>
        {headerButtons}
        <div style={{ borderLeft: `3px solid ${GREEN}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: 1 }}>
            Current Owner
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK, marginTop: 4 }}>
            {node.owner}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <FieldBlock label="Interest" value={node.interest || '\u2014'} colors={c} />
          <FieldBlock label="Type" value={node.interestType || '\u2014'} colors={c} valueColor={ORANGE} bold />
        </div>
        <div style={{
          background: fieldBg, borderRadius: 10, padding: '14px 18px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Decimal Interest
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: c?.text || DARK, fontFamily: "'JetBrains Mono', monospace" }}>
            {formatDecimal(node.interestDecimal)}
          </div>
        </div>
        {node.acquiredDate && (
          <div style={{ fontSize: 12, color: c?.textMuted || SLATE }}>
            <strong style={{ color: c?.text || DARK }}>Acquired:</strong> {node.acquiredDate}
          </div>
        )}
      </div>
    );
  }

  if (node.type === 'stack') {
    const docs = node.docs || [];
    return (
      <div style={{ padding: isMobile ? '14px 16px 24px' : '20px 24px', position: 'relative', overflowY: 'auto', flex: 1 }}>
        {headerButtons}
        <div style={{ borderLeft: `3px solid ${ORANGE}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1 }}>
            Stacked Documents
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK, marginTop: 4 }}>
            {node.label}
          </div>
          <div style={{ fontSize: 12, color: c?.textMuted || SLATE, marginTop: 2 }}>
            {docs.length} documents recorded {formatDate(node.date)}
          </div>
        </div>
        {docs.map((doc) => (
          <div key={doc.id} style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 8,
            background: fieldBg, border: `1px solid ${c?.border || BORDER}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: c?.text || DARK }}>{doc.docType}</span>
              <span style={{ fontSize: 10, color: c?.textMuted || SLATE }}>{formatDate(doc.date)}</span>
            </div>
            <div style={{ fontSize: 11, color: c?.textMuted || SLATE, marginTop: 4 }}>
              {truncate(doc.grantor, 30)} {'\u2192'} {truncate(doc.grantee, 28)}
            </div>
            {doc.interestConveyed && (
              <div style={{ fontSize: 10, color: c?.textMuted || SLATE, marginTop: 2 }}>
                {doc.interestConveyed}
              </div>
            )}
          </div>
        ))}
        <button onClick={(e) => { e.stopPropagation(); onExpandStack(node.id); }}
          style={{
            width: '100%', background: fieldBg, color: c?.text || DARK,
            border: `1px solid ${c?.border || BORDER}`,
            borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginTop: 4,
          }}>
          Expand Stack on Canvas
        </button>
      </div>
    );
  }

  // --- Document type: tabs ---
  const openFullScreen = () => {
    if (!docDetail) return;
    modal.open(MODAL_TYPES.DOCUMENT_VIEWER, {
      docId: node.id,
      filename: docDetail.filename,
      contentType: docDetail.content_type,
      rotation: docDetail.rotation_applied,
    });
  };

  return (
    <>
      {/* Persistent header */}
      <div style={{
        padding: isMobile ? '12px 16px 8px' : '16px 20px 8px',
        position: 'relative', flexShrink: 0,
      }}>
        {headerButtons}
        <div style={{ fontSize: 15, fontWeight: 700, color: c?.text || DARK, paddingRight: 40 }}>
          {node.docType}
          <span style={{ fontWeight: 400, color: c?.textMuted || SLATE, fontSize: 12, marginLeft: 8 }}>
            {formatDate(node.date)}
          </span>
        </div>
        {bookPage && (
          <div style={{ fontSize: 11, color: c?.textMuted || SLATE, marginTop: 2 }}>
            {bookPage}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${c?.border || BORDER}`,
        flexShrink: 0, padding: '0 20px',
      }}>
        {(['details', 'document'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer',
              background: 'transparent',
              color: activeTab === tab ? ORANGE : (c?.textMuted || SLATE),
              fontWeight: activeTab === tab ? 700 : 500,
              fontSize: 12, fontFamily: "'DM Sans', sans-serif",
              borderBottom: activeTab === tab ? `2px solid ${ORANGE}` : '2px solid transparent',
              marginBottom: -1,
            }}>
            {tab === 'details' ? 'Details' : 'Document'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'details' ? (
        <div style={{
          padding: isMobile ? '14px 16px 24px' : '16px 20px', overflowY: 'auto', flex: 1,
        }}>
          <FieldBlock label="Grantor" value={node.grantor || '\u2014'} colors={c} large />
          <div style={{ marginBottom: 12 }}>
            <FieldBlock label="Grantee" value={node.grantee || '\u2014'} colors={c} large />
          </div>
          {node.interestConveyed && (
            <div style={{
              fontSize: 12, color: c?.text || DARK, padding: '12px 16px',
              background: fieldBg, borderRadius: 8, lineHeight: 1.5, marginBottom: 12,
            }}>
              <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Interest Conveyed
              </div>
              {node.interestConveyed}
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Document preview */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: fieldBg }}>
            {blobLoading && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c?.textMuted || SLATE, fontSize: 12,
              }}>
                <div style={{
                  width: 24, height: 24, border: `3px solid ${c?.border || BORDER}`, borderTopColor: ORANGE,
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 8,
                }} />
                Loading document...
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {blobError && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', color: c?.textMuted || SLATE, fontSize: 12, gap: 8,
              }}>
                Could not load preview
                <button onClick={() => { setBlobError(false); setDocBlob(null); }}
                  style={{
                    background: c?.surface || '#fff', border: `1px solid ${c?.border || BORDER}`,
                    borderRadius: 6, padding: '6px 14px', fontSize: 11, cursor: 'pointer',
                    color: c?.text || DARK, fontFamily: "'DM Sans', sans-serif",
                  }}>
                  Retry
                </button>
              </div>
            )}
            {docBlob && !blobError && (
              docBlob.type === 'application/pdf' ? (
                <iframe
                  src={`${docBlob.url}#navpanes=0`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="Document preview"
                />
              ) : docBlob.type.startsWith('image/') && !docBlob.type.includes('tiff') ? (
                <div
                  onWheel={handleWheel}
                  onMouseDown={handlePanStart}
                  onMouseMove={handlePanMove}
                  onMouseUp={handlePanEnd}
                  onMouseLeave={handlePanEnd}
                  onDoubleClick={handleImgDoubleClick}
                  style={{
                    width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
                    cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default',
                  }}
                >
                  <img
                    src={docBlob.url}
                    alt="Document preview"
                    draggable={false}
                    style={{
                      width: '100%', height: '100%', objectFit: 'contain',
                      transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                      transformOrigin: 'center center',
                    }}
                  />
                  {zoom > 1 && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      background: 'rgba(0,0,0,0.6)', color: '#fff',
                      fontSize: 10, fontWeight: 600, padding: '2px 8px',
                      borderRadius: 10, pointerEvents: 'none',
                    }}>
                      {Math.round(zoom * 100)}%
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', color: c?.textMuted || SLATE, fontSize: 12, gap: 8,
                }}>
                  Preview not available for this file type
                  <a href={`/api/documents/${node.id}/download`}
                    style={{
                      background: ORANGE, color: '#fff', borderRadius: 6,
                      padding: '8px 16px', fontSize: 11, fontWeight: 600, textDecoration: 'none',
                      fontFamily: "'DM Sans', sans-serif",
                    }}>
                    Download File
                  </a>
                </div>
              )
            )}
          </div>
          {/* Toolbar */}
          <div style={{
            display: 'flex', gap: 8, padding: '8px 16px', flexShrink: 0,
            borderTop: `1px solid ${c?.border || BORDER}`,
          }}>
            <button onClick={openFullScreen} disabled={!docDetail}
              style={{
                flex: 1, background: c?.surface || '#fff', border: `1px solid ${c?.border || BORDER}`,
                borderRadius: 6, padding: '8px 0', fontSize: 11, fontWeight: 600,
                cursor: docDetail ? 'pointer' : 'default', color: c?.text || DARK,
                fontFamily: "'DM Sans', sans-serif", opacity: docDetail ? 1 : 0.4,
              }}>
              Full Screen
            </button>
            <a href={`/api/documents/${node.id}/download`}
              style={{
                flex: 1, background: c?.surface || '#fff', border: `1px solid ${c?.border || BORDER}`,
                borderRadius: 6, padding: '8px 0', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', color: c?.text || DARK, textDecoration: 'none', textAlign: 'center',
                fontFamily: "'DM Sans', sans-serif",
              }}>
              Download
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function FieldBlock({ label, value, colors: c, valueColor, bold, large }: {
  label: string;
  value: string;
  colors?: TitleColors;
  valueColor?: string;
  bold?: boolean;
  large?: boolean;
}) {
  return (
    <div style={{ marginBottom: large ? 0 : 8 }}>
      <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{
        fontSize: large ? 15 : 13, color: valueColor || (c?.text || DARK),
        fontWeight: bold ? 700 : 600,
      }}>
        {value}
      </div>
    </div>
  );
}
