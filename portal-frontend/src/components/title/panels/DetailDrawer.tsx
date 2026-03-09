import { useState, useEffect, useRef, useCallback } from 'react';
import { ORANGE, DARK, SLATE, GAP_COLOR, GREEN, BORDER, MODAL_TYPES } from '../../../lib/constants';
import type { TitleColors } from '../../../lib/title-colors';
import { formatDate, formatDecimal, truncate } from '../../../lib/helpers';
import { fetchDocumentDetail, fetchDocumentBlob, saveCorrection, deleteCorrection } from '../../../api/documents';
import { addDocumentParty, deleteDocumentParty } from '../../../api/document-parties';
import { updateCurrentOwnerInterest, revertCurrentOwnerInterest } from '../../../api/title-chain';
import { useModal } from '../../../contexts/ModalContext';
import type { FlatNode } from '../../../types/title-chain';

interface DetailDrawerProps {
  node: FlatNode | null;
  propertyId?: string;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  isMobile?: boolean;
  colors?: TitleColors;
  onCorrectionSaved?: () => void;
}

const DRAWER_W = 380;

export function DetailDrawer({ node, propertyId, onClose, onExpandStack, isMobile, colors: c, onCorrectionSaved }: DetailDrawerProps) {
  const isOpen = !!node;
  const [expanded, setExpanded] = useState(false);
  const drawerWidth = expanded ? Math.round(window.innerWidth * 0.6) : DRAWER_W;
  const pendingChangesRef = useRef(false);

  // Mark that party edits happened (no immediate refresh)
  const markDirty = useCallback(() => { pendingChangesRef.current = true; }, []);

  // Flush pending changes → trigger tree refresh
  const flushChanges = useCallback(() => {
    if (pendingChangesRef.current) {
      pendingChangesRef.current = false;
      onCorrectionSaved?.();
    }
  }, [onCorrectionSaved]);

  // Close handler: flush pending party changes, then close
  const handleClose = useCallback(() => {
    flushChanges();
    onClose();
  }, [onClose, flushChanges]);

  // Collapse back when drawer closes
  useEffect(() => {
    if (!isOpen) setExpanded(false);
  }, [isOpen]);

  // Escape key closes drawer
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, handleClose]);

  if (isMobile) {
    return <MobileSheet node={node} propertyId={propertyId} onClose={handleClose} onExpandStack={onExpandStack} colors={c} onCorrectionSaved={onCorrectionSaved} markDirty={markDirty} flushChanges={flushChanges} />;
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
        maxWidth: drawerWidth,
        height: '100%',
        display: 'flex', flexDirection: 'column',
        background: c?.surface || '#fff',
        fontFamily: "'DM Sans', sans-serif",
        overflow: 'hidden',
      }}>
        {node && <DrawerContent node={node} propertyId={propertyId} onClose={handleClose} onExpandStack={onExpandStack} colors={c} expanded={expanded} onToggleExpand={() => setExpanded((e) => !e)} onCorrectionSaved={onCorrectionSaved} markDirty={markDirty} flushChanges={flushChanges} />}
      </div>
    </div>
  );
}

function MobileSheet({ node, propertyId, onClose, onExpandStack, colors: c, onCorrectionSaved, markDirty, flushChanges }: {
  node: FlatNode | null;
  propertyId?: string;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  colors?: TitleColors;
  onCorrectionSaved?: () => void;
  markDirty: () => void;
  flushChanges: () => void;
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
        {node && <DrawerContent node={node} propertyId={propertyId} onClose={onClose} onExpandStack={onExpandStack} colors={c} isMobile onCorrectionSaved={onCorrectionSaved} markDirty={markDirty} flushChanges={flushChanges} />}
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
  doc_type?: string;
}

function DrawerContent({ node, propertyId, onClose, onExpandStack, colors: c, isMobile, expanded, onToggleExpand, onCorrectionSaved, markDirty, flushChanges }: {
  node: FlatNode;
  propertyId?: string;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  colors?: TitleColors;
  isMobile?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onCorrectionSaved?: () => void;
  markDirty?: () => void;
  flushChanges?: () => void;
}) {
  const isDocType = node.type === 'document' || node.type === 'orphan' || (!node.type && node.docType);
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

  // Inline edit state for per-party corrections (keyed by party_row_id)
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [corrSaving, setCorrSaving] = useState(false);
  const [localCorrections, setLocalCorrections] = useState<
    Record<string, { id: string; partyRowId: number; original: string; corrected: string }> | null
  >(null);

  // Sync corrections from node when it changes
  useEffect(() => {
    setLocalCorrections(node._corrections || null);
    setEditingRowId(null);
  }, [node.id]);

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
    return <CurrentOwnerContent node={node} propertyId={propertyId} headerButtons={headerButtons} fieldBg={fieldBg} isMobile={isMobile} colors={c} onCorrectionSaved={onCorrectionSaved} markDirty={markDirty} flushChanges={flushChanges} />;
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
          padding: isMobile ? '14px 16px 24px' : '16px 20px', overflow: 'auto', flex: 1,
          maxWidth: '100%',
        }}>
          <div style={{ fontSize: 9, color: c?.textMuted || SLATE, marginBottom: 12 }}>
            AI-extracted — verify against original
          </div>
          {/* Per-party editable fields, grouped by side */}
          {node._parties && node._parties.length > 0 ? (
            (['grantor', 'grantee'] as const).map((side) => {
              const sideRoles = side === 'grantor'
                ? ['grantor', 'lessor', 'assignor']
                : ['grantee', 'lessee', 'assignee'];
              const sideParties = node._parties!.filter(p => sideRoles.includes(p.role));
              if (sideParties.length === 0) return null;
              return (
                <div key={side} style={{ marginBottom: 12, overflow: 'hidden', maxWidth: '100%' }}>
                  <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    {side === 'grantor' ? 'Grantor' : 'Grantee'}
                  </div>
                  {sideParties.map((party) => {
                    const rowKey = String(party.rowId);
                    const corr = localCorrections?.[rowKey] || null;
                    return (
                      <EditablePartyField
                        key={party.rowId}
                        partyRowId={party.rowId}
                        value={party.name}
                        correction={corr}
                        isEditing={editingRowId === party.rowId}
                        editValue={editValue}
                        saving={corrSaving}
                        colors={c}
                        onStartEdit={() => {
                          setEditingRowId(party.rowId);
                          setEditValue(corr ? corr.corrected : party.name);
                        }}
                        onCancel={() => setEditingRowId(null)}
                        onChangeValue={setEditValue}
                        onSave={async () => {
                          if (!editValue.trim()) return;
                          setCorrSaving(true);
                          try {
                            const result = await saveCorrection(node.id, party.rowId, editValue.trim());
                            setLocalCorrections((prev) => ({
                              ...prev,
                              [rowKey]: { id: result.id, partyRowId: result.party_row_id, original: result.original_value, corrected: result.corrected_value },
                            }));
                            setEditingRowId(null);
                            markDirty?.();
                          } catch { /* toast could go here */ }
                          finally { setCorrSaving(false); }
                        }}
                        onUndo={async () => {
                          if (!corr) return;
                          setCorrSaving(true);
                          try {
                            await deleteCorrection(corr.id);
                            setLocalCorrections((prev) => {
                              if (!prev) return null;
                              const next = { ...prev };
                              delete next[rowKey];
                              return Object.keys(next).length > 0 ? next : null;
                            });
                            setEditingRowId(null);
                            markDirty?.();
                          } catch { /* ignore */ }
                          finally { setCorrSaving(false); }
                        }}
                      />
                    );
                  })}
                </div>
              );
            })
          ) : (
            /* Fallback: show grantor/grantee as read-only text (no party rows available) */
            <>
              <FieldBlock label="Grantor" value={node.grantor || '\u2014'} colors={c} />
              <FieldBlock label="Grantee" value={node.grantee || '\u2014'} colors={c} />
            </>
          )}
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
          {/* Party name strip — always show for orphans (need add button even with 0 parties) */}
          {(node._parties && node._parties.length > 0 || node.type === 'orphan') && (
            <PartyStrip
              docId={node.id}
              parties={node._parties || []}
              corrections={localCorrections}
              colors={c}
              markDirty={markDirty}
              flushChanges={flushChanges}
            />
          )}
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

const INTEREST_TYPES = ['RI', 'ORRI', 'WI', 'MI', 'NRI'] as const;

function CurrentOwnerContent({ node, propertyId, headerButtons, fieldBg, isMobile, colors: c, onCorrectionSaved, markDirty, flushChanges }: {
  node: FlatNode;
  propertyId?: string;
  headerButtons: React.ReactNode;
  fieldBg: string;
  isMobile?: boolean;
  colors?: TitleColors;
  onCorrectionSaved?: () => void;
  markDirty?: () => void;
  flushChanges?: () => void;
}) {
  const modal = useModal();
  const hasSourceDoc = !!node.acquiredViaDocId;
  const sourceDocId = node.acquiredViaDocId!;

  // Interest editing state
  const [editingInterest, setEditingInterest] = useState(false);
  const [interestForm, setInterestForm] = useState({ interest_text: '', interest_decimal: '' as string, interest_type: '' });
  const [interestSaving, setInterestSaving] = useState(false);

  // Owner name editing state (writes to source document's party row)
  const [editingOwnerName, setEditingOwnerName] = useState(false);
  const [ownerNameValue, setOwnerNameValue] = useState('');
  const [ownerNameSaving, setOwnerNameSaving] = useState(false);
  const [localOwnerCorr, setLocalOwnerCorr] = useState(node.sourceCorrection || null);

  // Tabbed layout state (only used when acquiredViaDocId exists)
  const [activeTab, setActiveTab] = useState<'details' | 'document'>('details');

  // Source document detail + blob state
  const [srcDocDetail, setSrcDocDetail] = useState<DocDetail | null>(null);
  const [srcBlob, setSrcBlob] = useState<{ url: string; type: string } | null>(null);
  const [srcBlobLoading, setSrcBlobLoading] = useState(false);
  const [srcBlobError, setSrcBlobError] = useState(false);
  const nodeIdRef = useRef(node.id);

  // Image zoom + pan for source doc
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });

  // Reset all state when node changes
  useEffect(() => {
    nodeIdRef.current = node.id;
    setEditingInterest(false);
    setEditingOwnerName(false);
    setLocalOwnerCorr(node.sourceCorrection || null);
    setActiveTab('details');
    setSrcDocDetail(null);
    setSrcBlobError(false);
    setSrcBlobLoading(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    setSrcBlob((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, [node.id]);

  // Fetch source doc detail on mount (for header info)
  useEffect(() => {
    if (!hasSourceDoc) return;
    const currentId = node.id;
    fetchDocumentDetail(sourceDocId)
      .then((res) => {
        if (nodeIdRef.current !== currentId) return;
        setSrcDocDetail({
          filename: res.filename,
          content_type: res.content_type,
          rotation_applied: res.rotation_applied,
          extracted_data: typeof res.extracted_data === 'string'
            ? JSON.parse(res.extracted_data) : res.extracted_data,
          doc_type: res.doc_type,
        });
      })
      .catch(() => {});
  }, [node.id, hasSourceDoc, sourceDocId]);

  // Fetch blob when Document tab first activated
  useEffect(() => {
    if (activeTab !== 'document' || srcBlob || srcBlobLoading || !hasSourceDoc) return;
    const currentId = node.id;
    setSrcBlobLoading(true);
    setSrcBlobError(false);
    fetchDocumentBlob(sourceDocId)
      .then(({ blob, contentType }) => {
        if (nodeIdRef.current !== currentId) return;
        setSrcBlob({ url: URL.createObjectURL(blob), type: contentType });
      })
      .catch(() => {
        if (nodeIdRef.current !== currentId) return;
        setSrcBlobError(true);
      })
      .finally(() => {
        if (nodeIdRef.current !== currentId) return;
        setSrcBlobLoading(false);
      });
  }, [activeTab, srcBlob, srcBlobLoading, node.id, hasSourceDoc, sourceDocId]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (srcBlob?.url) URL.revokeObjectURL(srcBlob.url); };
  }, [srcBlob]);

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
  const handlePanEnd = useCallback(() => { setIsPanning(false); }, []);
  const handleImgDoubleClick = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // Extract book/page from source doc detail
  const recording = srcDocDetail?.extracted_data as Record<string, unknown> | null;
  const book = recording?.recording_book || recording?.book;
  const page = recording?.recording_page || recording?.page;
  const bookPage = book && page ? `Book ${book} Pg ${page}` : book ? `Book ${book}` : null;

  // Source doc type for header
  const srcDocType = srcDocDetail?.doc_type || '';

  const openFullScreen = () => {
    if (!srcDocDetail || !hasSourceDoc) return;
    modal.open(MODAL_TYPES.DOCUMENT_VIEWER, {
      docId: sourceDocId,
      filename: srcDocDetail.filename,
      contentType: srcDocDetail.content_type,
      rotation: srcDocDetail.rotation_applied,
    });
  };

  const startEditInterest = () => {
    setInterestForm({
      interest_text: node.interest || '',
      interest_decimal: node.interestDecimal != null ? String(node.interestDecimal) : '',
      interest_type: node.interestType || '',
    });
    setEditingInterest(true);
  };

  const handleSaveInterest = async () => {
    if (!propertyId || !node.ownerId) return;
    setInterestSaving(true);
    try {
      const decimalVal = interestForm.interest_decimal ? parseFloat(interestForm.interest_decimal) : null;
      await updateCurrentOwnerInterest(propertyId, node.ownerId, {
        interest_text: interestForm.interest_text || undefined,
        interest_decimal: decimalVal,
        interest_type: interestForm.interest_type || undefined,
      });
      setEditingInterest(false);
      onCorrectionSaved?.();
    } catch { /* toast could go here */ }
    finally { setInterestSaving(false); }
  };

  const handleSaveOwnerName = async () => {
    if (!ownerNameValue.trim() || !node.acquiredViaDocId || !node.sourcePartyRowId) return;
    setOwnerNameSaving(true);
    try {
      const result = await saveCorrection(node.acquiredViaDocId, node.sourcePartyRowId, ownerNameValue.trim());
      setLocalOwnerCorr({ id: result.id, partyRowId: result.party_row_id, original: result.original_value, corrected: result.corrected_value });
      setEditingOwnerName(false);
      onCorrectionSaved?.();
    } catch {}
    finally { setOwnerNameSaving(false); }
  };

  const handleUndoOwnerName = async () => {
    if (!localOwnerCorr) return;
    setOwnerNameSaving(true);
    try {
      await deleteCorrection(localOwnerCorr.id);
      setLocalOwnerCorr(null);
      setEditingOwnerName(false);
      onCorrectionSaved?.();
    } catch {}
    finally { setOwnerNameSaving(false); }
  };

  const handleUndoInterest = async () => {
    if (!propertyId || !node.ownerId) return;
    setInterestSaving(true);
    try {
      await revertCurrentOwnerInterest(propertyId, node.ownerId);
      setEditingInterest(false);
      onCorrectionSaved?.();
    } catch { /* ignore */ }
    finally { setInterestSaving(false); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '8px 10px', fontSize: 13, fontWeight: 600,
    border: `1.5px solid ${ORANGE}`, borderRadius: 6,
    background: c?.surface || '#fff', color: c?.text || DARK,
    fontFamily: "'DM Sans', sans-serif", outline: 'none',
  };

  // --- Interest details block (shared between tabbed and non-tabbed layouts) ---
  const interestDetailsBlock = (
    <>
      <div style={{ borderLeft: `3px solid ${GREEN}`, paddingLeft: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: 1 }}>
          Current Owner
        </div>
        {editingOwnerName ? (
          <div style={{ marginTop: 4 }}>
            <input type="text" value={ownerNameValue}
              onChange={(e) => setOwnerNameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveOwnerName(); if (e.key === 'Escape') setEditingOwnerName(false); }}
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', fontSize: 16, fontWeight: 700,
                border: `1.5px solid ${ORANGE}`, borderRadius: 6,
                background: c?.surface || '#fff', color: c?.text || DARK,
                fontFamily: "'DM Sans', sans-serif", outline: 'none',
              }} />
            {localOwnerCorr && (
              <div style={{ fontSize: 11, color: c?.textMuted || SLATE, marginTop: 4 }}>
                AI extracted: &ldquo;{localOwnerCorr.original}&rdquo;
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={handleSaveOwnerName} disabled={ownerNameSaving}
                style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                  background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif", opacity: ownerNameSaving ? 0.6 : 1 }}>
                {ownerNameSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditingOwnerName(false)}
                style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                  background: 'transparent', color: c?.textMuted || SLATE,
                  border: `1px solid ${c?.border || BORDER}`, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                Cancel
              </button>
              {localOwnerCorr && (
                <button onClick={handleUndoOwnerName} disabled={ownerNameSaving}
                  style={{ padding: '5px 12px', fontSize: 11, borderRadius: 5,
                    background: 'transparent', color: '#dc2626',
                    border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  Undo
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK }}>
              {node.owner}
            </div>
            {localOwnerCorr && (
              <span title="Name corrected" style={{ width: 7, height: 7, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
            )}
            {node.sourcePartyRowId && (
              <button onClick={() => {
                setOwnerNameValue(localOwnerCorr ? localOwnerCorr.corrected : (node.owner || ''));
                setEditingOwnerName(true);
              }}
                title="Edit owner name"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                  color: c?.textMuted || SLATE, fontSize: 14, lineHeight: 1, flexShrink: 0, opacity: 0.6 }}>
                {'\u270E'}
              </button>
            )}
          </div>
        )}
      </div>

      {editingInterest ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              Interest
            </div>
            <input type="text" value={interestForm.interest_text}
              onChange={(e) => setInterestForm((f) => ({ ...f, interest_text: e.target.value }))}
              placeholder='e.g. 1/8, 3/16 of 8/8' style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Type</div>
              <select value={interestForm.interest_type}
                onChange={(e) => setInterestForm((f) => ({ ...f, interest_type: e.target.value }))}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Select type...</option>
                {INTEREST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Decimal</div>
              <input type="number" step="0.000001" min="0" max="1"
                value={interestForm.interest_decimal}
                onChange={(e) => setInterestForm((f) => ({ ...f, interest_decimal: e.target.value }))}
                placeholder="0.000000" style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleSaveInterest} disabled={interestSaving}
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", opacity: interestSaving ? 0.6 : 1 }}>
              {interestSaving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setEditingInterest(false)}
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                background: 'transparent', color: c?.textMuted || SLATE,
                border: `1px solid ${c?.border || BORDER}`, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>Interest</div>
                {node.isManual && (
                  <span title="Manually edited" style={{ width: 6, height: 6, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
                )}
                {node.ownerId && (
                  <button onClick={startEditInterest} title="Edit interest"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      color: c?.textMuted || SLATE, fontSize: 11, lineHeight: 1, flexShrink: 0, opacity: 0.6, marginLeft: 2 }}>
                    {'\u270E'}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 13, color: c?.text || DARK, fontWeight: 600 }}>{node.interest || '\u2014'}</div>
            </div>
            <FieldBlock label="Type" value={node.interestType || '\u2014'} colors={c} valueColor={ORANGE} bold />
          </div>
          <div style={{ background: fieldBg, borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Decimal Interest</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c?.text || DARK, fontFamily: "'JetBrains Mono', monospace" }}>
              {formatDecimal(node.interestDecimal)}
            </div>
          </div>
          {node.isManual && node.ownerId && (
            <button onClick={handleUndoInterest} disabled={interestSaving}
              style={{ marginBottom: 12, padding: '5px 12px', fontSize: 11, borderRadius: 5,
                background: 'transparent', color: '#dc2626', border: 'none', cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", opacity: interestSaving ? 0.6 : 1 }}>
              Undo manual edit
            </button>
          )}
        </>
      )}

      {node.acquiredDate && (
        <div style={{ fontSize: 12, color: c?.textMuted || SLATE, marginBottom: 12 }}>
          <strong style={{ color: c?.text || DARK }}>Acquired:</strong> {node.acquiredDate}
        </div>
      )}
    </>
  );

  // --- Document preview block (reused from document node pattern) ---
  const documentPreviewBlock = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Party name strip */}
      {node._sourceParties && node._sourceParties.length > 0 && (
        <PartyStrip
          docId={sourceDocId}
          parties={node._sourceParties}
          corrections={node._sourceCorrections || null}
          colors={c}
          markDirty={markDirty}
          flushChanges={flushChanges}
        />
      )}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: fieldBg }}>
        {srcBlobLoading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c?.textMuted || SLATE, fontSize: 12 }}>
            <div style={{ width: 24, height: 24, border: `3px solid ${c?.border || BORDER}`, borderTopColor: ORANGE,
              borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 8 }} />
            Loading document...
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
        {srcBlobError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: c?.textMuted || SLATE, fontSize: 12, gap: 8 }}>
            Could not load preview
            <button onClick={() => { setSrcBlobError(false); setSrcBlob(null); }}
              style={{ background: c?.surface || '#fff', border: `1px solid ${c?.border || BORDER}`,
                borderRadius: 6, padding: '6px 14px', fontSize: 11, cursor: 'pointer',
                color: c?.text || DARK, fontFamily: "'DM Sans', sans-serif" }}>
              Retry
            </button>
          </div>
        )}
        {srcBlob && !srcBlobError && (
          srcBlob.type === 'application/pdf' ? (
            <iframe src={`${srcBlob.url}#navpanes=0`}
              style={{ width: '100%', height: '100%', border: 'none' }} title="Document preview" />
          ) : srcBlob.type.startsWith('image/') && !srcBlob.type.includes('tiff') ? (
            <div onWheel={handleWheel} onMouseDown={handlePanStart} onMouseMove={handlePanMove}
              onMouseUp={handlePanEnd} onMouseLeave={handlePanEnd} onDoubleClick={handleImgDoubleClick}
              style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
                cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}>
              <img src={srcBlob.url} alt="Document preview" draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'contain',
                  transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: 'center center' }} />
              {zoom > 1 && (
                <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff',
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, pointerEvents: 'none' }}>
                  {Math.round(zoom * 100)}%
                </div>
              )}
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', color: c?.textMuted || SLATE, fontSize: 12, gap: 8 }}>
              Preview not available for this file type
              <a href={`/api/documents/${sourceDocId}/download`}
                style={{ background: ORANGE, color: '#fff', borderRadius: 6,
                  padding: '8px 16px', fontSize: 11, fontWeight: 600, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
                Download File
              </a>
            </div>
          )
        )}
      </div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 16px', flexShrink: 0,
        borderTop: `1px solid ${c?.border || BORDER}` }}>
        <button onClick={openFullScreen} disabled={!srcDocDetail}
          style={{ flex: 1, background: c?.surface || '#fff', border: `1px solid ${c?.border || BORDER}`,
            borderRadius: 6, padding: '8px 0', fontSize: 11, fontWeight: 600,
            cursor: srcDocDetail ? 'pointer' : 'default', color: c?.text || DARK,
            fontFamily: "'DM Sans', sans-serif", opacity: srcDocDetail ? 1 : 0.4 }}>
          Full Screen
        </button>
        <a href={`/api/documents/${sourceDocId}/download`}
          style={{ flex: 1, background: c?.surface || '#fff', border: `1px solid ${c?.border || BORDER}`,
            borderRadius: 6, padding: '8px 0', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', color: c?.text || DARK, textDecoration: 'none', textAlign: 'center',
            fontFamily: "'DM Sans', sans-serif" }}>
          Download
        </a>
      </div>
    </div>
  );

  // --- No source document: simple non-tabbed layout ---
  if (!hasSourceDoc) {
    return (
      <div style={{ padding: isMobile ? '14px 16px 24px' : '20px 24px', position: 'relative', overflowY: 'auto', flex: 1 }}>
        {headerButtons}
        {interestDetailsBlock}
      </div>
    );
  }

  // --- Has source document: tabbed layout with persistent header ---
  return (
    <>
      {/* Persistent header: source doc info */}
      <div style={{ padding: isMobile ? '12px 16px 8px' : '16px 20px 8px', position: 'relative', flexShrink: 0 }}>
        {headerButtons}
        <div style={{ fontSize: 15, fontWeight: 700, color: c?.text || DARK, paddingRight: 40 }}>
          {srcDocType || 'Source Document'}
          <span style={{ fontWeight: 400, color: c?.textMuted || SLATE, fontSize: 12, marginLeft: 8 }}>
            {formatDate(node.acquiredDate)}
          </span>
        </div>
        {bookPage && (
          <div style={{ fontSize: 11, color: c?.textMuted || SLATE, marginTop: 2 }}>{bookPage}</div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${c?.border || BORDER}`, flexShrink: 0, padding: '0 20px' }}>
        {(['details', 'document'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer', background: 'transparent',
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
        <div style={{ padding: isMobile ? '14px 16px 24px' : '16px 20px', overflow: 'auto', flex: 1, maxWidth: '100%' }}>
          {interestDetailsBlock}
          <button
            onClick={() => modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: sourceDocId })}
            style={{
              width: '100%', background: fieldBg, color: c?.text || DARK,
              border: `1px solid ${c?.border || BORDER}`,
              borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            }}>
            View Full Analysis
          </button>
        </div>
      ) : (
        documentPreviewBlock
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

/** Slim editable party name strip above the PDF in the Document tab */
function PartyStrip({ docId, parties, corrections, colors: c, markDirty, flushChanges }: {
  docId: string;
  parties: Array<{ rowId: number; name: string; role: string; isManual?: boolean }>;
  corrections: Record<string, { id: string; partyRowId: number; original: string; corrected: string }> | null;
  colors?: TitleColors;
  markDirty?: () => void;
  flushChanges?: () => void;
}) {
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [localCorr, setLocalCorr] = useState(corrections);
  const [addingRole, setAddingRole] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [deletedRowIds, setDeletedRowIds] = useState<Set<number>>(new Set());
  const [addedParties, setAddedParties] = useState<Array<{ rowId: number; name: string; role: string; isManual: true }>>([]);

  useEffect(() => {
    setLocalCorr(corrections); setEditingRowId(null); setAddingRole(null);
    setDirty(false); setDeletedRowIds(new Set()); setAddedParties([]);
  }, [corrections]);

  const FROM_ROLES = ['grantor', 'lessor', 'assignor'];
  const TO_ROLES = ['grantee', 'lessee', 'assignee', 'heir', 'beneficiary', 'owner'];
  // Merge original props (minus deleted) with locally added parties
  const allParties = [
    ...parties.filter(p => !deletedRowIds.has(p.rowId)),
    ...addedParties,
  ];
  const fromParties = allParties.filter(p => FROM_ROLES.includes(p.role));
  const toParties = allParties.filter(p => TO_ROLES.includes(p.role));

  const notifyDirty = () => { setDirty(true); markDirty?.(); };

  const handleSave = async (rowId: number) => {
    if (!editValue.trim()) return;
    setSaving(true);
    try {
      const result = await saveCorrection(docId, rowId, editValue.trim());
      setLocalCorr((prev) => ({
        ...prev,
        [String(rowId)]: { id: result.id, partyRowId: result.party_row_id, original: result.original_value, corrected: result.corrected_value },
      }));
      setEditingRowId(null);
      notifyDirty();
    } catch {}
    finally { setSaving(false); }
  };

  const handleUndo = async (rowId: number) => {
    const corr = localCorr?.[String(rowId)];
    if (!corr) return;
    setSaving(true);
    try {
      await deleteCorrection(corr.id);
      setLocalCorr((prev) => {
        if (!prev) return null;
        const next = { ...prev };
        delete next[String(rowId)];
        return Object.keys(next).length > 0 ? next : null;
      });
      setEditingRowId(null);
      notifyDirty();
    } catch {}
    finally { setSaving(false); }
  };

  const handleDeleteParty = async (party: { rowId: number; name: string }) => {
    if (!confirm(`Remove "${party.name}"?`)) return;
    setSaving(true);
    try {
      await deleteDocumentParty(docId, party.rowId);
      setDeletedRowIds(prev => new Set([...prev, party.rowId]));
      notifyDirty();
    } catch {}
    finally { setSaving(false); }
  };

  const handleAddParty = async (role: string) => {
    if (!addName.trim()) return;
    setSaving(true);
    try {
      const result = await addDocumentParty(docId, { party_name: addName.trim(), party_role: role });
      const newParty = result?.party;
      if (newParty) {
        setAddedParties(prev => [...prev, {
          rowId: newParty.id, name: newParty.party_name, role: newParty.party_role, isManual: true as const,
        }]);
      }
      setAddingRole(null);
      setAddName('');
      notifyDirty();
    } catch {}
    finally { setSaving(false); }
  };

  const renderParty = (party: { rowId: number; name: string; role: string; isManual?: boolean }) => {
    const corr = localCorr?.[String(party.rowId)] || null;
    if (editingRowId === party.rowId) {
      return (
        <div key={party.rowId} style={{ marginBottom: 2 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="text" value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(party.rowId); if (e.key === 'Escape') setEditingRowId(null); }}
              autoFocus
              style={{
                flex: 1, padding: '3px 8px', fontSize: 12, fontWeight: 600,
                border: `1.5px solid ${ORANGE}`, borderRadius: 4,
                background: c?.surface || '#fff', color: c?.text || DARK,
                fontFamily: "'DM Sans', sans-serif", outline: 'none', minWidth: 0,
              }} />
            <button onClick={() => handleSave(party.rowId)} disabled={saving}
              style={{ padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>
              {saving ? '...' : 'Save'}
            </button>
            <button onClick={() => setEditingRowId(null)}
              style={{ padding: '3px 6px', fontSize: 10, borderRadius: 4,
                background: 'transparent', color: c?.textMuted || SLATE,
                border: `1px solid ${c?.border || BORDER}`, cursor: 'pointer', flexShrink: 0,
                fontFamily: "'DM Sans', sans-serif" }}>
              {'\u00D7'}
            </button>
            {corr && (
              <button onClick={() => handleUndo(party.rowId)} disabled={saving}
                style={{ padding: '3px 6px', fontSize: 10, borderRadius: 4,
                  background: 'transparent', color: '#dc2626',
                  border: 'none', cursor: 'pointer', flexShrink: 0,
                  fontFamily: "'DM Sans', sans-serif" }}>
                Undo
              </button>
            )}
          </div>
          {corr && (
            <div style={{ fontSize: 10, color: c?.textMuted || SLATE, marginTop: 2, paddingLeft: 2 }}>
              AI extracted: &ldquo;{corr.original}&rdquo;
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={party.rowId} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, marginBottom: 1 }}>
        {party.isManual && (
          <span title="User-added" style={{ fontSize: 9, color: ORANGE, flexShrink: 0, lineHeight: 1 }}>+</span>
        )}
        <span style={{
          fontSize: 12, fontWeight: 600, color: c?.text || DARK,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
        }}>
          {corr ? corr.corrected : party.name}
        </span>
        {corr && <span style={{ width: 5, height: 5, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />}
        {party.rowId > 0 && (
          <button onClick={() => { setEditingRowId(party.rowId); setEditValue(corr ? corr.corrected : party.name); }}
            title="Edit name"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1,
              color: c?.textMuted || SLATE, fontSize: 11, lineHeight: 1, flexShrink: 0, opacity: 0.6 }}>
            {'\u270E'}
          </button>
        )}
        {party.rowId > 0 && (
          <button onClick={() => handleDeleteParty(party)} disabled={saving}
            title="Remove party"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1,
              color: c?.textMuted || SLATE, fontSize: 11, lineHeight: 1, flexShrink: 0, opacity: 0.6 }}>
            {'\u00D7'}
          </button>
        )}
      </div>
    );
  };

  const renderAddForm = (role: string) => {
    if (addingRole !== role) return null;
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
        <input type="text" value={addName} placeholder="Party name..."
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddParty(role); if (e.key === 'Escape') { setAddingRole(null); setAddName(''); } }}
          autoFocus
          style={{
            flex: 1, padding: '3px 8px', fontSize: 12, fontWeight: 600,
            border: `1.5px solid ${ORANGE}`, borderRadius: 4,
            background: c?.surface || '#fff', color: c?.text || DARK,
            fontFamily: "'DM Sans', sans-serif", outline: 'none', minWidth: 0,
          }} />
        <button onClick={() => handleAddParty(role)} disabled={saving || !addName.trim()}
          style={{ padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
            background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif", flexShrink: 0, opacity: (!addName.trim() || saving) ? 0.5 : 1 }}>
          {saving ? '...' : 'Add'}
        </button>
        <button onClick={() => { setAddingRole(null); setAddName(''); }}
          style={{ padding: '3px 6px', fontSize: 10, borderRadius: 4,
            background: 'transparent', color: c?.textMuted || SLATE,
            border: `1px solid ${c?.border || BORDER}`, cursor: 'pointer', flexShrink: 0,
            fontFamily: "'DM Sans', sans-serif" }}>
          {'\u00D7'}
        </button>
      </div>
    );
  };

  const renderSide = (label: string, sideParties: typeof parties, defaultRole: string) => {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>
            {label}
          </div>
          <button onClick={() => { setAddingRole(defaultRole); setAddName(''); setEditingRowId(null); }}
            title={`Add ${label.toLowerCase()}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: c?.textMuted || SLATE, fontSize: 13, lineHeight: 1, opacity: 0.6 }}>
            +
          </button>
        </div>
        {sideParties.map(renderParty)}
        {renderAddForm(defaultRole)}
      </div>
    );
  };

  // Determine side labels from actual role names
  const fromRole = fromParties[0]?.role || 'grantor';
  const toRole = toParties[0]?.role || 'grantee';
  const fromLabel = fromRole === 'lessor' ? 'Lessor'
    : fromRole === 'assignor' ? 'Assignor' : 'Grantor';
  const toLabel = toRole === 'lessee' ? 'Lessee'
    : toRole === 'assignee' ? 'Assignee' : 'Grantee';

  return (
    <div style={{
      padding: '8px 16px', borderBottom: `1px solid ${c?.border || BORDER}`, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', gap: 16 }}>
        {renderSide(fromLabel, fromParties, fromRole)}
        {renderSide(toLabel, toParties, toRole)}
      </div>
      {dirty && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={() => { setDirty(false); flushChanges?.(); }}
            style={{
              padding: '4px 14px', fontSize: 11, fontWeight: 600, borderRadius: 4,
              background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
            }}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function EditablePartyField({ partyRowId, value, correction, isEditing, editValue, saving, colors: c,
  onStartEdit, onCancel, onChangeValue, onSave, onUndo,
}: {
  partyRowId: number;
  value: string;
  correction: { id: string; partyRowId: number; original: string; corrected: string } | null;
  isEditing: boolean;
  editValue: string;
  saving: boolean;
  colors?: TitleColors;
  onStartEdit: () => void;
  onCancel: () => void;
  onChangeValue: (v: string) => void;
  onSave: () => void;
  onUndo: () => void;
}) {
  if (isEditing) {
    return (
      <div style={{ marginBottom: 4, overflow: 'hidden', maxWidth: '100%' }}>
        <input
          type="text"
          value={editValue}
          onChange={(e) => onChangeValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 10px', fontSize: 14, fontWeight: 600,
            border: `1.5px solid ${ORANGE}`, borderRadius: 6,
            background: c?.surface || '#fff', color: c?.text || DARK,
            fontFamily: "'DM Sans', sans-serif", outline: 'none',
          }}
        />
        {correction && (
          <div style={{ fontSize: 11, color: c?.textMuted || SLATE, marginTop: 4 }}>
            AI extracted: &ldquo;{correction.original}&rdquo;
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button onClick={onSave} disabled={saving}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
              background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif", opacity: saving ? 0.6 : 1,
            }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onCancel}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
              background: 'transparent', color: c?.textMuted || SLATE,
              border: `1px solid ${c?.border || BORDER}`, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
            }}>
            Cancel
          </button>
          {correction && (
            <button onClick={onUndo} disabled={saving}
              style={{
                padding: '5px 12px', fontSize: 11, borderRadius: 5,
                background: 'transparent', color: '#dc2626',
                border: 'none', cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
              }}>
              Undo
            </button>
          )}
        </div>
      </div>
    );
  }

  // Display mode
  return (
    <div style={{ marginBottom: 4, overflow: 'hidden', maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
        <div style={{
          fontSize: 13, color: c?.text || DARK, fontWeight: 600,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {correction ? correction.corrected : value}
        </div>
        {correction && (
          <span title="Edited — click pencil to modify or undo" style={{
            width: 6, height: 6, borderRadius: '50%', background: ORANGE, flexShrink: 0,
          }} />
        )}
        <button onClick={onStartEdit} title="Edit name"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: c?.textMuted || SLATE, fontSize: 13, lineHeight: 1, flexShrink: 0,
            opacity: 0.6,
          }}>
          {'\u270E'}
        </button>
      </div>
    </div>
  );
}
