import { useMemo, useState, useCallback } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFormDirty } from '../../hooks/useFormDirty';
import { fetchDocumentDetail, saveDocumentNotes } from '../../api/documents';
import { AccordionSection } from '../ui/AccordionSection';
import { StatusBadge } from '../ui/StatusBadge';
import { Spinner } from '../ui/Spinner';
import { SkeletonRows } from '../ui/SkeletonRows';
import { formatDate, getWellStatusColor } from '../../lib/helpers';
import { formatDocType, formatFieldName, formatFieldValue } from '../../lib/format-doc-type';
import { MODAL_TYPES, DOC_STATUS_COLORS, BORDER, DARK, SLATE } from '../../lib/constants';
import type { DocumentDetail } from '../../types/document-detail';

interface Props {
  onClose: () => void;
  modalId: string;
  docId: string;
}

function cleanMarkdown(text: string): string {
  return text.trim()
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

export function DocumentDetailModal({ onClose, docId }: Props) {
  const modal = useModal();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const { data: doc, loading, error } = useAsyncData<DocumentDetail>(
    () => fetchDocumentDetail(docId),
    [docId],
  );

  // Parse extracted_data
  const extracted = useMemo(() => {
    if (!doc?.extracted_data) return null;
    if (typeof doc.extracted_data === 'string') {
      try { return JSON.parse(doc.extracted_data); } catch { return null; }
    }
    return doc.extracted_data;
  }, [doc]);

  const initialNotes = useMemo(() => ({ notes: doc?.user_notes ?? '' }), [doc]);
  const { values, setValue, isDirty } = useFormDirty(initialNotes);

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

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={24} /></div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>
          {error || 'Document not found'}
        </div>
      </div>
    );
  }

  const statusColor = DOC_STATUS_COLORS[doc.status] || SLATE;
  const electionOptions = extracted?.election_options as Array<Record<string, unknown>> | undefined;
  const keyTakeaway = extracted?.key_takeaway as string | undefined;
  const detailedAnalysis = extracted?.detailed_analysis as string | undefined;
  const recordingInfo = extracted?.recording_info as Record<string, unknown> | undefined;

  // Parties
  const partyKeys = ['grantors', 'grantees', 'lessors', 'lessees', 'assignors', 'assignees'];
  const parties = partyKeys.filter((k) => {
    const v = extracted?.[k];
    return Array.isArray(v) && v.length > 0;
  });

  // Fields to exclude from extracted grid
  const excludeFields = new Set([
    'key_takeaway', 'detailed_analysis', 'election_options', 'recording_info',
    ...partyKeys, 'document_type', 'status', 'confidence', 'summary',
  ]);
  const extractedFields = extracted
    ? Object.entries(extracted).filter(([k]) => !excludeFields.has(k) && extracted[k] != null)
    : [];

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)',
        color: '#fff', padding: '20px 24px', borderRadius: '16px 16px 0 0', position: 'relative',
      }}>
        <button onClick={onClose} style={closeStyle}>&times;</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{formatDocType(doc.doc_type)}</h2>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{doc.filename}</div>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 'calc(100vh - 220px)', background: '#f8fafc' }}>
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
                  style={{ color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
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

        {/* Status + Type row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div style={infoBoxStyle}>
            <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Status</div>
            <StatusBadge label={doc.status} color={statusColor} background={statusColor + '20'} />
          </div>
          <div style={infoBoxStyle}>
            <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Type</div>
            <div style={{ fontSize: 13, color: DARK, fontWeight: 500 }}>{formatDocType(doc.doc_type)}</div>
          </div>
        </div>

        {/* Key Takeaway */}
        {keyTakeaway && (
          <AccordionSection title="Key Takeaway" defaultOpen>
            <div style={{
              fontSize: 13, color: DARK, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              borderLeft: '3px solid #16a34a', paddingLeft: 12,
            }}>
              {cleanMarkdown(keyTakeaway)}
            </div>
          </AccordionSection>
        )}

        {/* Detailed Analysis */}
        {detailedAnalysis && (
          <AccordionSection title="Detailed Analysis">
            <div style={{ fontSize: 13, color: DARK, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {cleanMarkdown(detailedAnalysis)}
            </div>
          </AccordionSection>
        )}

        {/* Election Options */}
        {electionOptions && electionOptions.length > 0 && (
          <AccordionSection title="Election Options" count={electionOptions.length} defaultOpen>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {electionOptions.map((opt, i) => {
                const optType = String(opt.option_type || opt.type || 'unknown').toLowerCase();
                let bg = '#f3f4f6', border = '#d1d5db';
                if (optType === 'participate') { bg = '#eff6ff'; border = '#3b82f6'; }
                else if (optType.includes('cash')) { bg = '#fef3c7'; border = '#f59e0b'; }
                else if (optType === 'non_consent') { bg = '#fee2e2'; border = '#ef4444'; }
                return (
                  <div key={i} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: DARK, textTransform: 'capitalize' }}>
                      {String(opt.option_type || opt.type || 'Option').replace(/_/g, ' ')}
                    </div>
                    {opt.bonus_per_acre != null && (
                      <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>
                        Bonus: ${String(opt.bonus_per_acre)}/acre
                      </div>
                    )}
                    {opt.royalty_rate != null && (
                      <div style={{ fontSize: 11, color: SLATE }}>
                        Royalty: {String(opt.royalty_rate)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </AccordionSection>
        )}

        {/* Recording Info */}
        {recordingInfo && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            {recordingInfo.book != null && (
              <div style={infoBoxStyle}>
                <div style={{ fontSize: 11, color: SLATE }}>Book</div>
                <div style={{ fontSize: 13, color: DARK }}>{String(recordingInfo.book)}</div>
              </div>
            )}
            {recordingInfo.page != null && (
              <div style={infoBoxStyle}>
                <div style={{ fontSize: 11, color: SLATE }}>Page</div>
                <div style={{ fontSize: 13, color: DARK }}>{String(recordingInfo.page)}</div>
              </div>
            )}
            {recordingInfo.recording_date != null && (
              <div style={infoBoxStyle}>
                <div style={{ fontSize: 11, color: SLATE }}>Recording Date</div>
                <div style={{ fontSize: 13, color: DARK }}>{formatDate(String(recordingInfo.recording_date))}</div>
              </div>
            )}
            {recordingInfo.recording_county != null && (
              <div style={infoBoxStyle}>
                <div style={{ fontSize: 11, color: SLATE }}>Recording County</div>
                <div style={{ fontSize: 13, color: DARK }}>{String(recordingInfo.recording_county)}</div>
              </div>
            )}
          </div>
        )}

        {/* Parties */}
        {parties.length > 0 && (
          <AccordionSection title="Parties" count={parties.length}>
            {parties.map((key) => {
              const names = extracted[key] as string[];
              return (
                <div key={key} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: SLATE, textTransform: 'capitalize', marginBottom: 2 }}>
                    {key}
                  </div>
                  {names.map((name, i) => (
                    <div key={i} style={{ fontSize: 13, color: DARK, paddingLeft: 8 }}>{name}</div>
                  ))}
                </div>
              );
            })}
          </AccordionSection>
        )}

        {/* Extracted Fields Grid */}
        {extractedFields.length > 0 && (
          <AccordionSection title="Extracted Information" count={extractedFields.length}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {extractedFields.map(([key, val]) => (
                <div key={key} style={{ background: '#f8fafc', borderRadius: 6, padding: 8 }}>
                  <div style={{ fontSize: 11, color: SLATE, fontWeight: 500 }}>{formatFieldName(key)}</div>
                  <div style={{ fontSize: 13, color: DARK, marginTop: 2 }}>{formatFieldValue(val)}</div>
                </div>
              ))}
            </div>
          </AccordionSection>
        )}

        {/* Linked Properties */}
        {doc.linked_properties && doc.linked_properties.length > 0 && (
          <AccordionSection title="Linked Properties" count={doc.linked_properties.length}>
            {doc.linked_properties.map((p) => (
              <div key={p.id} style={{ padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                <span
                  onClick={() => modal.open(MODAL_TYPES.PROPERTY, { propertyId: p.id })}
                  style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 500, fontSize: 13 }}
                >
                  {p.location || 'Property'}
                </span>
                {p.county && <span style={{ fontSize: 11, color: SLATE, marginLeft: 8 }}>{p.county}</span>}
              </div>
            ))}
          </AccordionSection>
        )}

        {/* Linked Wells */}
        {doc.linked_wells && doc.linked_wells.length > 0 && (
          <AccordionSection title="Linked Wells" count={doc.linked_wells.length}>
            {doc.linked_wells.map((w) => (
              <div key={w.id} style={{ padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                <span
                  onClick={() => modal.open(MODAL_TYPES.WELL, { apiNumber: w.api_number, wellName: w.well_name })}
                  style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                >
                  {w.well_name}
                </span>
                <div style={{ fontSize: 11, color: SLATE }}>
                  {w.api_number && <span>API: {w.api_number}</span>}
                  {w.operator && <span> &middot; {w.operator}</span>}
                  {w.well_status && (
                    <StatusBadge
                      label={w.well_status}
                      color={getWellStatusColor(w.well_status)}
                      background={getWellStatusColor(w.well_status) + '20'}
                      style={{ marginLeft: 6, fontSize: 10 }}
                    />
                  )}
                </div>
              </div>
            ))}
          </AccordionSection>
        )}

        {/* Notes */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: DARK, display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea
            value={values.notes as string}
            onChange={(e) => setValue('notes', e.target.value)}
            style={{
              width: '100%', minHeight: 60, padding: 10, borderRadius: 6,
              border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: 'inherit',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px', borderTop: `1px solid ${BORDER}`, background: '#fff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderRadius: '0 0 16px 16px',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleViewPdf} style={footerBtnStyle}>View PDF</button>
          <button onClick={handleDownload} style={footerBtnStyle}>Download</button>
        </div>
        {isDirty && (
          <button onClick={handleSave} disabled={saving} style={{
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {saving && <Spinner size={12} color="#fff" />}
            Save & Close
          </button>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700,
  maxHeight: 'calc(100vh - 20px)', display: 'flex', flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.15)', fontFamily: "'Inter', 'DM Sans', sans-serif",
  overflow: 'hidden',
};

const closeStyle: React.CSSProperties = {
  position: 'absolute', top: 12, right: 16, background: 'rgba(255,255,255,0.2)',
  border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
  fontSize: 18, lineHeight: '28px', textAlign: 'center', color: '#fff',
};

const infoBoxStyle: React.CSSProperties = {
  background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10,
};

const footerBtnStyle: React.CSSProperties = {
  background: '#f1f5f9', border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: '6px 14px', fontSize: 12, color: DARK, cursor: 'pointer',
};
