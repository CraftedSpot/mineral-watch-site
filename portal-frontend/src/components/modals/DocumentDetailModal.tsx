import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFormDirty } from '../../hooks/useFormDirty';
import { useIsMobile } from '../../hooks/useIsMobile';
import { fetchDocumentDetail, saveDocumentNotes, fetchFieldCorrections, saveFieldCorrections, deleteFieldCorrection, fetchDocumentBlob, fetchCorrections, fetchCorrectionCount, reanalyzeDocuments } from '../../api/documents';
import type { FieldCorrection } from '../../api/documents';
import { AccordionSection } from '../ui/AccordionSection';
import { Badge } from '../ui/Badge';
import { ModalShell } from '../ui/ModalShell';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TextArea } from '../ui/FormField';
import { Spinner } from '../ui/Spinner';
import { formatDate, getWellStatusColor } from '../../lib/helpers';
import { formatDocType, cleanFieldValue } from '../../lib/format-doc-type';
import { groupFieldsBySection } from '../../lib/doc-section-config';
import { FieldRenderer } from '../document-detail/FieldRenderer';
import { EditableField } from '../document-detail/EditableField';
import { AnalysisText } from '../document-detail/AnalysisText';
import { MODAL_TYPES, DOC_STATUS_COLORS, BORDER, DARK, SLATE, TEAL, BG_MUTED } from '../../lib/constants';
import type { DocumentDetail } from '../../types/document-detail';

interface Props {
  onClose: () => void;
  modalId: string;
  docId: string;
}

// --- Close button for DocumentDetail: 40px circle ---
const docCloseStyle: React.CSSProperties = {
  position: 'absolute', top: 8, right: 12, zIndex: 10,
  background: 'rgba(255,255,255,0.2)',
  border: 'none', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer',
  fontSize: 24, lineHeight: '40px', textAlign: 'center', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

// --- Main Component ---

export function DocumentDetailModal({ onClose, docId }: Props) {
  const modal = useModal();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const { data: doc, loading, error } = useAsyncData<DocumentDetail>(
    () => fetchDocumentDetail(docId),
    [docId, refreshKey],
  );

  // Split-pane view + field corrections state
  const [showSplitView, setShowSplitView] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  const [fieldCorrections, setFieldCorrections] = useState<Record<string, FieldCorrection>>({});
  const [savingFields, setSavingFields] = useState(false);

  useEffect(() => {
    fetchFieldCorrections(docId).then(setFieldCorrections).catch(() => {});
  }, [docId, refreshKey]);

  // Party name corrections (from title page edits) — displayed as read-only indicators
  const [partyCorrections, setPartyCorrections] = useState<Map<string, { original: string; corrected: string }>>(new Map());
  useEffect(() => {
    fetchCorrections(docId).then(corrections => {
      const map = new Map<string, { original: string; corrected: string }>();
      for (const corr of Object.values(corrections)) {
        if (corr.original && corr.corrected) {
          map.set(corr.original, { original: corr.original, corrected: corr.corrected });
        }
      }
      setPartyCorrections(map);
    }).catch(() => {});
  }, [docId, refreshKey]);

  // Document preview state for split-pane edit mode
  const [editBlob, setEditBlob] = useState<{ url: string; type: string; pageRange?: string } | null>(null);
  const [editBlobLoading, setEditBlobLoading] = useState(false);
  const [editBlobError, setEditBlobError] = useState(false);
  const [docZoom, setDocZoom] = useState(1);
  const [docPan, setDocPan] = useState({ x: 0, y: 0 });
  const [docPanning, setDocPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });

  // Load document blob when entering split view
  useEffect(() => {
    if (!showSplitView || editBlob || editBlobLoading) return;
    setEditBlobLoading(true);
    setEditBlobError(false);
    fetchDocumentBlob(docId)
      .then(({ blob, contentType, pageRange }) => {
        setEditBlob({ url: URL.createObjectURL(blob), type: contentType, pageRange });
      })
      .catch(() => setEditBlobError(true))
      .finally(() => setEditBlobLoading(false));
  }, [showSplitView, editBlob, editBlobLoading, docId]);

  // Cleanup blob URL when leaving split view or unmounting
  useEffect(() => {
    if (!showSplitView && editBlob) {
      URL.revokeObjectURL(editBlob.url);
      setEditBlob(null);
      setDocZoom(1);
      setDocPan({ x: 0, y: 0 });
      setIsEditMode(false);
      setPendingEdits({});
    }
  }, [showSplitView]);
  useEffect(() => {
    return () => { if (editBlob?.url) URL.revokeObjectURL(editBlob.url); };
  }, [editBlob]);

  // Zoom/pan handlers for document preview
  const handleDocWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setDocZoom(z => {
      const next = Math.min(5, Math.max(1, z * factor));
      if (next <= 1) setDocPan({ x: 0, y: 0 });
      return next;
    });
  }, []);
  const handleDocPanStart = useCallback((e: React.MouseEvent) => {
    if (docZoom <= 1) return;
    e.preventDefault();
    setDocPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY };
    panOriginRef.current = { ...docPan };
  }, [docZoom, docPan]);
  const handleDocPanMove = useCallback((e: React.MouseEvent) => {
    if (!docPanning) return;
    const dx = (e.clientX - panStartRef.current.x) / docZoom;
    const dy = (e.clientY - panStartRef.current.y) / docZoom;
    setDocPan({ x: panOriginRef.current.x + dx, y: panOriginRef.current.y + dy });
  }, [docPanning, docZoom]);
  const handleDocPanEnd = useCallback(() => setDocPanning(false), []);
  const handleDocDoubleClick = useCallback(() => { setDocZoom(1); setDocPan({ x: 0, y: 0 }); }, []);

  // Parse extracted_data (comes as JSON string from D1)
  // Party name corrections are written back to document_parties — extracted_data shows raw AI output.
  const extracted = useMemo(() => {
    if (!doc?.extracted_data) return null;
    if (typeof doc.extracted_data === 'string') {
      try { return JSON.parse(doc.extracted_data); } catch { return null; }
    }
    return { ...doc.extracted_data };
  }, [doc]);

  const initialNotes = useMemo(() => ({ notes: doc?.user_notes ?? '' }), [doc]);
  const { values, setValue, isDirty } = useFormDirty(initialNotes);

  // Group fields by section using the new config system
  const fieldGroups = useMemo(() => {
    if (!extracted) return new Map<string, Array<[string, unknown]>>();
    return groupFieldsBySection(extracted, doc?.doc_type);
  }, [extracted, doc?.doc_type]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveDocumentNotes(docId, values.notes as string);
      toast.success('Notes saved');
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [docId, values.notes, toast, onClose]);

  const handleViewPdf = useCallback(() => {
    if (!doc) return;
    modal.open(MODAL_TYPES.DOCUMENT_VIEWER, {
      docId,
      filename: doc.filename || 'Document',
      contentType: doc.content_type || 'application/pdf',
      rotation: doc.rotation_applied || 0,
    });
  }, [modal, doc, docId]);

  const handleDownload = useCallback(() => {
    window.open(`/api/documents/${docId}/download`, '_blank');
  }, [docId]);

  const handlePrintSummary = useCallback(() => {
    window.open(`/print/document?id=${docId}`, '_blank');
  }, [docId]);

  // Editable field paths (Phase 1)
  const EDITABLE_RECORDING_KEYS = new Set(['book', 'page', 'instrument_number', 'recording_date']);
  const EDITABLE_TOP_KEYS = new Set(['execution_date', 'effective_date']);

  const handleFieldEdit = useCallback((fieldPath: string, newValue: string) => {
    setPendingEdits(prev => ({ ...prev, [fieldPath]: newValue }));
  }, []);

  const handleFieldUndo = useCallback(async (fieldPath: string, correctionId: string) => {
    try {
      await deleteFieldCorrection(docId, correctionId);
      setFieldCorrections(prev => { const n = { ...prev }; delete n[fieldPath]; return n; });
      setRefreshKey(k => k + 1);
      toast.success('Correction undone');
    } catch { toast.error('Failed to undo'); }
  }, [docId, toast]);

  // Re-analyze state and handler
  const [reanalyzing, setReanalyzing] = useState(false);
  const [showReanalyzeConfirm, setShowReanalyzeConfirm] = useState<{ field: number; party: number; children: number } | null>(null);

  const handleReanalyze = useCallback(async () => {
    if (!doc || reanalyzing) return;
    const eligible = ['complete', 'completed', 'failed', 'unprocessed', 'manual_review'];
    if (!eligible.includes(doc.status)) {
      toast.error('Document is currently being processed');
      return;
    }
    try {
      const counts = await fetchCorrectionCount(docId);
      if (counts.hasCorrections || counts.childDocIds.length > 0) {
        setShowReanalyzeConfirm({
          field: counts.fieldCorrections,
          party: counts.partyCorrections,
          children: counts.childDocIds.length,
        });
        return;
      }
      // No corrections — proceed directly
      setReanalyzing(true);
      const result = await reanalyzeDocuments([docId], !!doc.enhanced_extraction);
      toast.success(`Queued for re-analysis (${result.credits_reserved} credit${result.credits_reserved !== 1 ? 's' : ''})`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to re-analyze');
    } finally {
      setReanalyzing(false);
    }
  }, [doc, docId, reanalyzing, toast, onClose]);

  const confirmReanalyze = useCallback(async () => {
    setShowReanalyzeConfirm(null);
    setReanalyzing(true);
    try {
      const result = await reanalyzeDocuments([docId], !!doc?.enhanced_extraction);
      toast.success(`Queued for re-analysis (${result.credits_reserved} credit${result.credits_reserved !== 1 ? 's' : ''})`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to re-analyze');
    } finally {
      setReanalyzing(false);
    }
  }, [docId, doc, toast, onClose]);

  const handleSaveFieldCorrections = useCallback(async () => {
    const entries = Object.entries(pendingEdits);
    if (entries.length === 0) { setIsEditMode(false); return; }
    setSavingFields(true);
    try {
      const result = await saveFieldCorrections(docId, entries.map(([field_path, value]) => ({ field_path, value })));
      setFieldCorrections(result);
      setPendingEdits({});
      setIsEditMode(false);
      setRefreshKey(k => k + 1);
      toast.success(`${entries.length} field${entries.length > 1 ? 's' : ''} corrected`);
    } catch { toast.error('Failed to save corrections'); }
    finally { setSavingFields(false); }
  }, [docId, pendingEdits, toast]);

  if (loading) {
    return (
      <ModalShell onClose={onClose} showHeader={false} bodyBg="#fff">
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={24} /></div>
      </ModalShell>
    );
  }

  if (error || !doc) {
    return (
      <ModalShell onClose={onClose} showHeader={false} bodyBg="#fff">
        <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>
          {error || 'Document not found'}
        </div>
      </ModalShell>
    );
  }

  const statusColor = DOC_STATUS_COLORS[doc.status] || SLATE;
  const displayName = doc.display_name || formatDocType(doc.doc_type);
  const isCheckStub = (doc.doc_type || '').includes('check_stub') || (doc.doc_type || '').includes('royalty_statement');
  const isDeathCert = doc.doc_type === 'death_certificate';
  const hasUnits = extracted?.units && Array.isArray(extracted.units);

  // Extracted data sections
  const keyTakeaway = extracted?.key_takeaway as string | undefined;
  const detailedAnalysis = (extracted?.detailed_analysis || extracted?.ai_observations) as string | undefined;
  const extractedNotes = (extracted?.notes || extracted?.extraction_notes || extracted?.additional_info) as string | undefined;
  const rawUnderlyingLease = extracted?.underlying_lease as string | Record<string, unknown> | undefined;
  // Only show underlying lease for assignments/releases/amendments — not for the lease itself.
  // Also skip empty objects.
  const isLeaseDoc = (doc?.doc_type || '').includes('lease') && !(doc?.doc_type || '').includes('assignment') && !(doc?.doc_type || '').includes('release') && !(doc?.doc_type || '').includes('amendment') && !(doc?.doc_type || '').includes('extension');
  const underlyingLease = (!isLeaseDoc && rawUnderlyingLease &&
    (typeof rawUnderlyingLease === 'string'
      ? rawUnderlyingLease.trim().length > 0
      : Object.values(rawUnderlyingLease).some(v => v != null && v !== '')))
    ? rawUnderlyingLease : undefined;

  // Check stub special sections (rendered directly, outside the section loop)
  const checkStubWells = isCheckStub ? (extracted?.wells as Array<Record<string, unknown>> | undefined) : undefined;
  const checkStubSummary = isCheckStub ? (extracted?.summary as Record<string, unknown> | undefined) : undefined;
  const checkStubExpenses = isCheckStub ? (extracted?.operating_expenses as Array<Record<string, unknown>> | undefined) : undefined;

  return (
    <ModalShell
      onClose={onClose}
      closeStyle={docCloseStyle}
      maxWidth={showSplitView && !isMobile ? '95vw' : 700}
      headerBg={TEAL}
      headerContent={
        <>
          <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            {formatDocType(doc.doc_type)}
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.3, fontFamily: "'Merriweather', 'Georgia', serif" }}>{displayName}</h2>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{doc.filename}</div>
        </>
      }
      bodyBg={BG_MUTED}
      footer={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 8, width: '100%', alignItems: 'center' }}>
          <Button variant="primary" color={TEAL} size={isMobile ? 'sm' : 'md'}
            onClick={isMobile ? handleViewPdf : () => setShowSplitView(v => !v)}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
              </svg>
            }
          >
            {showSplitView ? 'Hide Original' : 'View Original'}
          </Button>
          <Button variant="secondary" size={isMobile ? 'sm' : 'md'} onClick={handlePrintSummary}>Print</Button>
          <Button variant="ghost" size={isMobile ? 'sm' : 'md'} onClick={handleDownload}>Download</Button>
          {extracted && showSplitView && (
            <Button
              variant={isEditMode ? 'primary' : 'secondary'}
              color={isEditMode ? '#f59e0b' : undefined}
              size={isMobile ? 'sm' : 'md'}
              onClick={isEditMode ? handleSaveFieldCorrections : () => setIsEditMode(true)}
              disabled={savingFields}
            >
              {savingFields ? 'Saving...' : isEditMode ? (Object.keys(pendingEdits).length > 0 ? 'Save Changes' : 'Done') : 'Edit Fields'}
            </Button>
          )}
          {extracted && !showSplitView && (
            <Button variant="secondary" size={isMobile ? 'sm' : 'md'}
              onClick={() => { setShowSplitView(true); setIsEditMode(true); }}>
              Edit Fields
            </Button>
          )}
          {doc && ['complete', 'completed', 'failed', 'unprocessed', 'manual_review'].includes(doc.status) && (
            <Button variant="ghost" size={isMobile ? 'sm' : 'md'}
              onClick={handleReanalyze} disabled={reanalyzing}>
              {reanalyzing ? 'Queuing...' : `Re-analyze`}
            </Button>
          )}
          <div style={{ flex: 1 }} />
          {isDirty && (
            <Button variant="primary" color={TEAL} size={isMobile ? 'sm' : 'md'} onClick={handleSave} disabled={saving}
              style={{ opacity: saving ? 0.7 : 1 }}
              icon={saving ? <Spinner size={12} color="#fff" /> : undefined}
            >
              Save
            </Button>
          )}
          <Button variant="ghost" size={isMobile ? 'sm' : 'md'} onClick={onClose}>Close</Button>
        </div>
      }
    >
      {/* Re-analyze confirmation dialog */}
      {showReanalyzeConfirm && (
        <div style={{
          background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: 16, marginBottom: 12,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>
            Re-analyze will overwrite existing data
          </div>
          <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>
            {showReanalyzeConfirm.field + showReanalyzeConfirm.party > 0 && (
              <div>
                {showReanalyzeConfirm.field > 0 && `${showReanalyzeConfirm.field} field correction${showReanalyzeConfirm.field !== 1 ? 's' : ''}`}
                {showReanalyzeConfirm.field > 0 && showReanalyzeConfirm.party > 0 && ' and '}
                {showReanalyzeConfirm.party > 0 && `${showReanalyzeConfirm.party} party correction${showReanalyzeConfirm.party !== 1 ? 's' : ''}`}
                {' will be lost.'}
              </div>
            )}
            {showReanalyzeConfirm.children > 0 && (
              <div>{showReanalyzeConfirm.children} child document{showReanalyzeConfirm.children !== 1 ? 's' : ''} will be deleted and re-created.</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button variant="primary" color="#f59e0b" size="sm" onClick={confirmReanalyze} disabled={reanalyzing}>
              {reanalyzing ? 'Queuing...' : 'Proceed'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowReanalyzeConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Split-pane view: document preview left, extraction right */}
      {showSplitView && !isMobile ? (
        <div style={{ display: 'flex', height: 'calc(100vh - 200px)', maxHeight: 800, overflow: 'hidden' }}>
          {/* Left: Document preview with zoom */}
          <div style={{ flex: 1, minWidth: 0, borderRight: `1px solid ${BORDER}`, background: '#f8f9fa', position: 'relative', overflow: 'hidden' }}>
            {editBlobLoading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SLATE, fontSize: 13 }}>
                <Spinner size={20} /> <span style={{ marginLeft: 8 }}>Loading document...</span>
              </div>
            )}
            {editBlobError && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: SLATE, fontSize: 13, gap: 8 }}>
                Could not load preview
                <Button variant="secondary" size="sm" onClick={() => { setEditBlobError(false); setEditBlob(null); }}>Retry</Button>
              </div>
            )}
            {editBlob && !editBlobError && (
              editBlob.type === 'application/pdf' ? (
                <iframe
                  src={`${editBlob.url}#${editBlob.pageRange ? `page=${editBlob.pageRange.split('-')[0]}&` : ''}navpanes=0`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="Document preview"
                />
              ) : editBlob.type.startsWith('image/') && !editBlob.type.includes('tiff') ? (
                <div
                  onWheel={handleDocWheel}
                  onMouseDown={handleDocPanStart}
                  onMouseMove={handleDocPanMove}
                  onMouseUp={handleDocPanEnd}
                  onMouseLeave={handleDocPanEnd}
                  onDoubleClick={handleDocDoubleClick}
                  style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
                    cursor: docZoom > 1 ? (docPanning ? 'grabbing' : 'grab') : 'default' }}
                >
                  <img src={editBlob.url} alt="Document" draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'contain',
                      transform: `scale(${docZoom}) translate(${docPan.x}px, ${docPan.y}px)`,
                      transformOrigin: 'center center' }}
                  />
                  {docZoom > 1 && (
                    <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff',
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, pointerEvents: 'none' }}>
                      {Math.round(docZoom * 100)}%
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: SLATE, fontSize: 13, gap: 8 }}>
                  Preview not available
                  <a href={`/api/documents/${docId}/download`} style={{ color: TEAL, fontWeight: 600 }}>Download</a>
                </div>
              )
            )}
            {/* Zoom controls */}
            {editBlob && editBlob.type.startsWith('image/') && (
              <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 4, zIndex: 5 }}>
                {[
                  { label: '+', fn: () => setDocZoom(z => Math.min(5, z * 1.2)) },
                  { label: '\u2212', fn: () => setDocZoom(z => { const n = Math.max(1, z / 1.2); if (n <= 1) setDocPan({ x: 0, y: 0 }); return n; }) },
                  { label: 'FIT', fn: () => { setDocZoom(1); setDocPan({ x: 0, y: 0 }); } },
                ].map(({ label, fn }) => (
                  <button key={label} onClick={fn} style={{
                    width: 32, height: 32, borderRadius: 6, border: `1px solid ${BORDER}`,
                    background: '#fff', cursor: 'pointer', fontSize: label === 'FIT' ? 9 : 16,
                    fontWeight: 700, color: DARK, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{label}</button>
                ))}
              </div>
            )}
          </div>
          {/* Right: Editable fields (scrollable) */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 20px' }}>
            {/* Grouped extracted fields with editable overrides */}
            {Array.from(fieldGroups.entries())
              .filter(([section]) => section !== 'Other Information')
              .map(([section, fields]) => (
                <AccordionSection key={section} title={section} count={fields.length} defaultOpen>
                  <div style={{ maxWidth: 600 }}>
                    {fields.flatMap(([key, val]: [string, unknown]) => {
                      if ((key === 'recording' || key === 'recording_info') && val && typeof val === 'object' && !Array.isArray(val)) {
                        const recObj = val as Record<string, unknown>;
                        return Object.entries(recObj).map(([subKey, subVal]) => {
                          if (EDITABLE_RECORDING_KEYS.has(subKey)) {
                            const fp = `recording.${subKey}`;
                            return (
                              <EditableField key={`${key}.${subKey}`} fieldName={subKey} fieldPath={fp}
                                value={subVal} isEditMode={isEditMode}
                                correction={fieldCorrections[fp]} pendingValue={pendingEdits[fp]}
                                onEdit={handleFieldEdit} onUndo={handleFieldUndo} />
                            );
                          }
                          return <FieldRenderer key={`${key}.${subKey}`} fieldName={subKey} value={subVal} docType={doc?.doc_type} partyCorrections={partyCorrections} />;
                        });
                      }
                      if (EDITABLE_TOP_KEYS.has(key)) {
                        return [(
                          <EditableField key={key} fieldName={key} fieldPath={key}
                            value={val} isEditMode={isEditMode}
                            correction={fieldCorrections[key]} pendingValue={pendingEdits[key]}
                            onEdit={handleFieldEdit} onUndo={handleFieldUndo} />
                        )];
                      }
                      return [<FieldRenderer key={key} fieldName={key} value={val} docType={doc?.doc_type} partyCorrections={partyCorrections} />];
                    })}
                  </div>
                </AccordionSection>
              ))
            }
          </div>
        </div>
      ) : (
      <>
      {/* Children (multi-doc) */}
      {doc.children && doc.children.length > 0 && (
        <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e40af', marginBottom: 6 }}>
            This PDF contained {doc.children.length + 1} documents
          </div>
          {doc.children.map((child) => (
            <div key={child.id} style={{ marginTop: 4 }}>
              <span
                onClick={() => modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: child.id })}
                style={{ color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >
                {child.display_name || formatDocType(child.doc_type)}
                {child.page_range && <span style={{ color: SLATE }}> (pp. {child.page_range})</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Extraction error */}
      {doc.extraction_error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>Extraction Error</div>
          <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>{doc.extraction_error}</div>
        </div>
      )}

      {/* Status + Uploaded row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <Card padding={10}>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 4 }}>Status</div>
          <Badge bg={statusColor + '20'} color={statusColor}>{doc.status}</Badge>
        </Card>
        <Card padding={10}>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 4 }}>Uploaded</div>
          <div style={{ fontSize: 14, color: DARK }}>{formatDate(doc.created_at)}</div>
        </Card>
      </div>

      {/* Linked Properties */}
      {doc.linked_properties && doc.linked_properties.length > 0 && (
        <AccordionSection title="Linked Properties" count={doc.linked_properties.length} defaultOpen>
          {doc.linked_properties.map((p) => {
            const loc = p.name || [p.section && `S${p.section}`, p.township && `T${p.township}`, p.range && `R${p.range}`].filter(Boolean).join('-') || 'Property';
            return (
              <div key={p.id} style={{ padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                <span
                  onClick={() => modal.open(MODAL_TYPES.PROPERTY, { propertyId: p.id })}
                  style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                >
                  {loc}
                </span>
                {p.county && <span style={{ fontSize: 12, color: SLATE, marginLeft: 8 }}>{p.county}</span>}
              </div>
            );
          })}
        </AccordionSection>
      )}

      {/* Linked Wells */}
      {doc.linked_wells && doc.linked_wells.length > 0 && (
        <AccordionSection title="Linked Wells" count={doc.linked_wells.length} defaultOpen>
          {doc.linked_wells.map((w) => (
            <div key={w.id} style={{ padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
              <span
                onClick={() => modal.open(MODAL_TYPES.WELL, { apiNumber: w.api_number, wellName: w.well_name })}
                style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
              >
                {w.well_name}
              </span>
              <div style={{ fontSize: 12, color: SLATE }}>
                {w.api_number && <span>API: {w.api_number}</span>}
                {w.operator && <span> &middot; {w.operator}</span>}
                {w.well_status && (
                  <Badge
                    bg={getWellStatusColor(w.well_status) + '20'}
                    color={getWellStatusColor(w.well_status)}
                    size="sm"
                    style={{ marginLeft: 6 }}
                  >
                    {w.well_status}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </AccordionSection>
      )}

      {/* Key Takeaway */}
      {keyTakeaway && (
        <AccordionSection title="Key Takeaway" defaultOpen>
          <div style={{
            fontSize: 14, color: '#065f46', lineHeight: 1.6, whiteSpace: 'pre-wrap',
            borderLeft: '3px solid #16a34a', paddingLeft: 12,
            wordBreak: 'break-word', overflowWrap: 'break-word',
          }}>
            {cleanFieldValue(keyTakeaway)}
          </div>
        </AccordionSection>
      )}

      {/* Detailed Analysis */}
      {detailedAnalysis && (
        <AccordionSection title="Detailed Analysis">
          <AnalysisText text={detailedAnalysis} />
        </AccordionSection>
      )}

      {/* Underlying Lease (full-width standalone block) */}
      {underlyingLease && (
        <AccordionSection title="Underlying Lease" defaultOpen>
          {typeof underlyingLease === 'string' ? (
            <div style={{
              fontSize: 14, color: DARK, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              borderLeft: '3px solid #3b82f6', paddingLeft: 12,
              wordBreak: 'break-word', overflowWrap: 'break-word',
            }}>
              {cleanFieldValue(underlyingLease)}
            </div>
          ) : (
            <FieldRenderer fieldName="underlying_lease" value={underlyingLease} docType={doc?.doc_type} partyCorrections={partyCorrections} />
          )}
        </AccordionSection>
      )}

      {/* Check Stub: Well Revenue (direct, outside section loop) */}
      {checkStubWells && checkStubWells.length > 0 && (
        <AccordionSection title="Well Revenue" count={checkStubWells.length} defaultOpen>
          <FieldRenderer fieldName="wells" value={checkStubWells} docType={doc.doc_type} partyCorrections={partyCorrections} />
        </AccordionSection>
      )}

      {/* Check Stub: Summary */}
      {checkStubSummary && (
        <AccordionSection title="Check Summary" defaultOpen>
          <FieldRenderer fieldName="summary" value={checkStubSummary} docType={doc.doc_type} partyCorrections={partyCorrections} />
        </AccordionSection>
      )}

      {/* Check Stub: Operating Expenses */}
      {checkStubExpenses && checkStubExpenses.length > 0 && (
        <AccordionSection title="Operating Expenses" count={checkStubExpenses.length} defaultOpen>
          <FieldRenderer fieldName="operating_expenses" value={checkStubExpenses} docType={doc.doc_type} partyCorrections={partyCorrections} />
        </AccordionSection>
      )}

      {/* Grouped extracted fields by section */}
      {Array.from(fieldGroups.entries())
        .filter(([section, fields]) => {
          // Skip Legal Description for death certs and when units array exists
          if (section === 'Legal Description' && (isDeathCert || hasUnits)) return false;
          // Skip Underlying Lease section if rendered as standalone block
          if (section === 'Underlying Lease' && underlyingLease) {
            const remaining = fields.filter(([k]) => k !== 'underlying_lease');
            if (remaining.length === 0) return false;
          }
          // Skip Notes section if we're rendering extracted notes as a standalone block
          if (section === 'Notes' && extractedNotes) {
            const remaining = fields.filter(([k]) => k !== 'notes' && k !== 'extraction_notes' && k !== 'additional_info');
            if (remaining.length === 0) return false;
          }
          return true;
        })
        .map(([section, fields]) => (
          <AccordionSection key={section} title={section} count={fields.length}
            defaultOpen={section !== 'Other Information'}>
            <div style={{ maxWidth: 600 }}>
              {fields.flatMap(([key, val]: [string, unknown]) => {
                // Break out recording/recording_info sub-fields for individual editing
                if ((key === 'recording' || key === 'recording_info') && val && typeof val === 'object' && !Array.isArray(val)) {
                  const recObj = val as Record<string, unknown>;
                  return Object.entries(recObj).map(([subKey, subVal]) => {
                    if (EDITABLE_RECORDING_KEYS.has(subKey)) {
                      const fp = `recording.${subKey}`;
                      return (
                        <EditableField key={`${key}.${subKey}`} fieldName={subKey} fieldPath={fp}
                          value={subVal} isEditMode={isEditMode}
                          correction={fieldCorrections[fp]} pendingValue={pendingEdits[fp]}
                          onEdit={handleFieldEdit} onUndo={handleFieldUndo} />
                      );
                    }
                    return <FieldRenderer key={`${key}.${subKey}`} fieldName={subKey} value={subVal} docType={doc?.doc_type} partyCorrections={partyCorrections} />;
                  });
                }
                // Top-level editable fields
                if (EDITABLE_TOP_KEYS.has(key)) {
                  return [(
                    <EditableField key={key} fieldName={key} fieldPath={key}
                      value={val} isEditMode={isEditMode}
                      correction={fieldCorrections[key]} pendingValue={pendingEdits[key]}
                      onEdit={handleFieldEdit} onUndo={handleFieldUndo} />
                  )];
                }
                return [<FieldRenderer key={key} fieldName={key} value={val} docType={doc?.doc_type} partyCorrections={partyCorrections} />];
              })}
            </div>
          </AccordionSection>
        ))
      }

      {/* Extraction Notes (full-width, like Key Takeaway) */}
      {extractedNotes && (
        <AccordionSection title="Extraction Notes" defaultOpen>
          <div style={{
            fontSize: 14, color: DARK, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            borderLeft: `3px solid ${TEAL}`, paddingLeft: 12,
            wordBreak: 'break-word', overflowWrap: 'break-word',
          }}>
            {cleanFieldValue(extractedNotes)}
          </div>
        </AccordionSection>
      )}

      {/* User Notes */}
      <div style={{ marginTop: 14 }}>
        <label htmlFor="doc-notes" style={{ fontSize: 14, fontWeight: 600, color: DARK, display: 'block', marginBottom: 4 }}>Your Notes</label>
        <TextArea
          id="doc-notes"
          value={values.notes as string}
          onChange={(e) => setValue('notes', e.target.value)}
          placeholder="Add notes about this document..."
          minHeight={100}
        />
      </div>
      </>
      )}
    </ModalShell>
  );
}
