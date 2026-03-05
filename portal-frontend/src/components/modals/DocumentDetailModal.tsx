import { useMemo, useState, useCallback } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFormDirty } from '../../hooks/useFormDirty';
import { fetchDocumentDetail, saveDocumentNotes } from '../../api/documents';
import { AccordionSection } from '../ui/AccordionSection';
import { Badge } from '../ui/Badge';
import { ModalShell } from '../ui/ModalShell';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TextArea } from '../ui/FormField';
import { Spinner } from '../ui/Spinner';
import { formatDate, getWellStatusColor } from '../../lib/helpers';
import { formatDocType, formatFieldName, formatFieldValue, isEmptyValue } from '../../lib/format-doc-type';
import { MODAL_TYPES, DOC_STATUS_COLORS, BORDER, DARK, SLATE, TEAL, BG_MUTED, BG_FIELD } from '../../lib/constants';
import type { DocumentDetail } from '../../types/document-detail';

interface Props {
  onClose: () => void;
  modalId: string;
  docId: string;
}

// --- Field grouping (maps extracted_data keys → sections) ---

const SECTION_MAP: Record<string, string> = {
  // Legal Description
  legal_description: 'Legal Description', section: 'Legal Description', township: 'Legal Description',
  range: 'Legal Description', county: 'Legal Description', state: 'Legal Description',
  meridian: 'Legal Description', quarter_call: 'Legal Description', quarter: 'Legal Description',
  quarter_section: 'Legal Description', lot: 'Legal Description', lot_block: 'Legal Description',
  block: 'Legal Description', survey: 'Legal Description', abstract: 'Legal Description',
  location: 'Legal Description', acreage: 'Legal Description',

  // Operator & Well
  operator: 'Operator & Well', operator_name: 'Operator & Well', operator_address: 'Operator & Well',
  operator_phone: 'Operator & Well', operator_email: 'Operator & Well',
  return_instructions: 'Operator & Well', property_name: 'Operator & Well',
  property_number: 'Operator & Well', billing_code: 'Operator & Well',
  well_name: 'Operator & Well', api_number: 'Operator & Well',
  wells: 'Operator & Well', well_names: 'Operator & Well', api_numbers: 'Operator & Well',

  // Owner & Interest
  owner_name: 'Owner & Interest', owner_address: 'Owner & Interest',
  trustee_name: 'Owner & Interest', owner_number: 'Owner & Interest',
  owner_phone: 'Owner & Interest', owner_fax: 'Owner & Interest', owner_email: 'Owner & Interest',
  grantors: 'Owner & Interest', grantees: 'Owner & Interest', lessors: 'Owner & Interest',
  lessees: 'Owner & Interest', assignors: 'Owner & Interest', assignees: 'Owner & Interest',
  grantor: 'Owner & Interest', grantee: 'Owner & Interest', lessor: 'Owner & Interest', lessee: 'Owner & Interest',
  heirs: 'Owner & Interest', heirs_summary: 'Owner & Interest', children_living: 'Owner & Interest',
  spouses: 'Owner & Interest', decedent_name: 'Owner & Interest',
  interest_conveyed: 'Owner & Interest', interest_type: 'Owner & Interest', interest_decimal: 'Owner & Interest',
  mineral_interest: 'Owner & Interest', royalty_interest: 'Owner & Interest',
  working_interest: 'Owner & Interest', overriding_royalty: 'Owner & Interest',
  overriding_royalty_interest: 'Owner & Interest', net_revenue_interest: 'Owner & Interest',
  non_participating_royalty_interest: 'Owner & Interest',

  // Terms & Unit
  effective_date: 'Terms & Unit', primary_term: 'Terms & Unit', royalty_rate: 'Terms & Unit',
  bonus_per_acre: 'Terms & Unit', delay_rental: 'Terms & Unit', shut_in_royalty: 'Terms & Unit',
  extension_provisions: 'Terms & Unit', lease_form: 'Terms & Unit',
  habendum_clause: 'Terms & Unit', pooling_provisions: 'Terms & Unit',
  expiration_date: 'Terms & Unit', lease_date: 'Terms & Unit',
  payment_minimum: 'Terms & Unit', product_type: 'Terms & Unit',
  is_multi_section_unit: 'Terms & Unit', unit_sections: 'Terms & Unit',
  acres: 'Terms & Unit', net_acres: 'Terms & Unit', gross_acres: 'Terms & Unit',
  tracts: 'Terms & Unit',

  // Payment Information
  check_number: 'Payment Information', check_date: 'Payment Information',
  check_amount: 'Payment Information', statement_type: 'Payment Information',
  consideration: 'Payment Information', total_amount: 'Payment Information',
  payment_date: 'Payment Information', pay_period: 'Payment Information',

  // Unit Details
  unit_size_acres: 'Unit Details', spacing_order: 'Unit Details',
  lateral_direction: 'Unit Details', lateral_length_ft: 'Unit Details',

  // Recording Info
  recording_info: 'Recording', book: 'Recording', page: 'Recording',
  recording_date: 'Recording', recording_county: 'Recording', document_number: 'Recording',
  filed_date: 'Recording', instrument_number: 'Recording',

  // Election Options (handled separately)
  election_options: '_skip',

  // AI fields (handled separately)
  key_takeaway: '_skip', detailed_analysis: '_skip', ai_observations: '_skip',
  observations: '_skip', notes: '_skip', summary: '_skip',
  document_type: '_skip', status: '_skip', confidence: '_skip',
  skip_extraction: '_skip', _schema_validation: '_skip',

  // Internal metadata (not user-facing)
  _review_flags: '_skip', _validation_issues: '_skip', _flag_details: '_skip',
  adopted_stepchildren: '_skip', grandchildren_of_predeceased: '_skip',
};

const SECTION_ORDER = [
  'Legal Description', 'Operator & Well', 'Owner & Interest',
  'Terms & Unit', 'Payment Information', 'Unit Details',
  'Recording', 'Other Information',
];

function groupExtractedFields(data: Record<string, unknown>): Map<string, Array<[string, unknown]>> {
  const groups = new Map<string, Array<[string, unknown]>>();
  for (const section of SECTION_ORDER) groups.set(section, []);

  for (const [key, val] of Object.entries(data)) {
    if (isEmptyValue(val)) continue;
    const section = SECTION_MAP[key];
    if (section === '_skip') continue;
    const target = section || 'Other Information';
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target)!.push([key, val]);
  }

  // Remove empty sections
  for (const [key, val] of groups) {
    if (val.length === 0) groups.delete(key);
  }
  return groups;
}

// --- Check stub rendering ---

function CheckStubWellRevenue({ wells }: { wells: Array<Record<string, unknown>> }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            {['Well', 'Product', 'Gross Vol', 'Price', 'Gross Value', 'Deductions', 'Net'].map((h) => (
              <th key={h} style={{ padding: '6px 8px', textAlign: h === 'Well' || h === 'Product' ? 'left' : 'right', fontWeight: 600, color: DARK, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {wells.map((w, i) => {
            const deductionTotal = Array.isArray(w.deductions)
              ? (w.deductions as Array<Record<string, unknown>>).reduce((sum, d) => sum + (Number(d.amount) || 0), 0)
              : (Number(w.total_deductions) || 0);
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: '6px 8px', fontWeight: 500, color: DARK }}>{String(w.well_name || w.property_description || '\u2014')}</td>
                <td style={{ padding: '6px 8px', color: SLATE }}>{String(w.product_type || w.product || '\u2014')}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{w.gross_volume != null ? Number(w.gross_volume).toLocaleString() : '\u2014'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{w.price != null ? `$${Number(w.price).toFixed(2)}` : '\u2014'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{w.gross_value != null ? `$${Number(w.gross_value).toFixed(2)}` : '\u2014'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: deductionTotal < 0 ? '#dc2626' : SLATE }}>
                  {deductionTotal !== 0 ? `$${deductionTotal.toFixed(2)}` : '\u2014'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#166534' }}>
                  {w.net_value != null ? `$${Number(w.net_value).toFixed(2)}` : '\u2014'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CheckStubSummary({ summary }: { summary: Record<string, unknown> }) {
  const items = [
    { label: 'Oil Revenue', value: summary.oil_revenue || summary.total_oil, color: '#166534' },
    { label: 'Gas Revenue', value: summary.gas_revenue || summary.total_gas, color: '#166534' },
    { label: 'NGL Revenue', value: summary.ngl_revenue || summary.total_ngl, color: '#166534' },
    { label: 'Total Net', value: summary.total_net || summary.check_amount || summary.total, color: '#166534' },
  ].filter((item) => item.value != null);

  if (items.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{
          background: i === items.length - 1 ? '#dcfce7' : BG_MUTED,
          border: `1px solid ${i === items.length - 1 ? '#86efac' : BORDER}`,
          borderRadius: 8, padding: 10, textAlign: 'center',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: SLATE, textTransform: 'uppercase' }}>{item.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: item.color, marginTop: 2 }}>
            ${Number(item.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      ))}
    </div>
  );
}

function cleanMarkdown(text: string): string {
  return text.trim()
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
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
  const [saving, setSaving] = useState(false);

  const { data: doc, loading, error } = useAsyncData<DocumentDetail>(
    () => fetchDocumentDetail(docId),
    [docId],
  );

  // Parse extracted_data (comes as JSON string from D1)
  const extracted = useMemo(() => {
    if (!doc?.extracted_data) return null;
    if (typeof doc.extracted_data === 'string') {
      try { return JSON.parse(doc.extracted_data); } catch { return null; }
    }
    return doc.extracted_data;
  }, [doc]);

  const initialNotes = useMemo(() => ({ notes: doc?.user_notes ?? '' }), [doc]);
  const { values, setValue, isDirty } = useFormDirty(initialNotes);

  // Group remaining fields by section (must be before conditional returns — Rules of Hooks)
  const fieldGroups = useMemo(() => {
    if (!extracted) return new Map<string, Array<[string, unknown]>>();
    return groupExtractedFields(extracted);
  }, [extracted]);

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

  // Extracted data sections
  const keyTakeaway = extracted?.key_takeaway as string | undefined;
  const detailedAnalysis = (extracted?.detailed_analysis || extracted?.ai_observations) as string | undefined;
  const electionOptions = extracted?.election_options as Array<Record<string, unknown>> | undefined;
  const checkStubWells = isCheckStub ? (extracted?.wells as Array<Record<string, unknown>> | undefined) : undefined;
  const checkStubSummary = isCheckStub ? (extracted?.summary as Record<string, unknown> | undefined) : undefined;

  return (
    <ModalShell
      onClose={onClose}
      closeStyle={docCloseStyle}
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
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" color={TEAL} size="md" onClick={handleViewPdf}
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
              }
            >
              View Original
            </Button>
            <Button variant="secondary" size="md" onClick={handlePrintSummary}>Print Summary</Button>
            <Button variant="ghost" size="md" onClick={handleDownload}>Download</Button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            {isDirty && (
              <Button variant="primary" color={TEAL} size="md" onClick={handleSave} disabled={saving}
                style={{ opacity: saving ? 0.7 : 1 }}
                icon={saving ? <Spinner size={12} color="#fff" /> : undefined}
              >
                Save & Close
              </Button>
            )}
            <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
          </div>
        </>
      }
    >
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
                  style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 500, fontSize: 13 }}
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
            borderLeft: '3px solid #16a34a', paddingLeft: 12, ...wrapStyle,
          }}>
            {cleanMarkdown(keyTakeaway)}
          </div>
        </AccordionSection>
      )}

      {/* Detailed Analysis */}
      {detailedAnalysis && (
        <AccordionSection title="Detailed Analysis">
          <div style={{ fontSize: 14, color: DARK, lineHeight: 1.6, whiteSpace: 'pre-wrap', ...wrapStyle }}>
            {cleanMarkdown(detailedAnalysis)}
          </div>
        </AccordionSection>
      )}

      {/* Check Stub: Well Revenue */}
      {checkStubWells && checkStubWells.length > 0 && (
        <AccordionSection title="Well Revenue" count={checkStubWells.length} defaultOpen>
          <CheckStubWellRevenue wells={checkStubWells} />
        </AccordionSection>
      )}

      {/* Check Stub: Summary */}
      {checkStubSummary && (
        <AccordionSection title="Check Summary" defaultOpen>
          <CheckStubSummary summary={checkStubSummary} />
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
                    <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>Bonus: ${String(opt.bonus_per_acre)}/acre</div>
                  )}
                  {opt.royalty_rate != null && (
                    <div style={{ fontSize: 11, color: SLATE }}>Royalty: {String(opt.royalty_rate)}</div>
                  )}
                </div>
              );
            })}
          </div>
        </AccordionSection>
      )}

      {/* Grouped extracted fields by section */}
      {Array.from(fieldGroups.entries())
        .map(([section, fields]) => (
          <AccordionSection key={section} title={section} count={fields.length} defaultOpen={section !== 'Other Information'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {fields.map(([key, val]: [string, unknown]) => {
                const isArrayOfObjects = Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null;
                return (
                  <div key={key} style={{
                    background: BG_FIELD, borderRadius: 6, padding: 10, border: `1px solid ${BORDER}`,
                    gridColumn: isArrayOfObjects ? '1 / -1' : undefined,
                    ...wrapStyle,
                  }}>
                    <div style={{ fontSize: 12, color: SLATE, fontWeight: 500 }}>{formatFieldName(key)}</div>
                    {isArrayOfObjects ? (
                      <div style={{ marginTop: 4 }}>
                        {(val as Array<Record<string, unknown>>).map((item, idx) => (
                          <div key={idx} style={{
                            fontSize: 13, color: DARK, padding: '4px 0',
                            borderBottom: idx < (val as unknown[]).length - 1 ? `1px solid ${BORDER}` : undefined,
                          }}>
                            {formatFieldValue(item)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, color: DARK, marginTop: 2 }}>{formatFieldValue(val)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </AccordionSection>
        ))
      }

      {/* Notes */}
      <div style={{ marginTop: 14 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: DARK, display: 'block', marginBottom: 4 }}>Notes</label>
        <TextArea
          value={values.notes as string}
          onChange={(e) => setValue('notes', e.target.value)}
          placeholder="Add notes about this document..."
          minHeight={100}
        />
      </div>
    </ModalShell>
  );
}

const wrapStyle: React.CSSProperties = {
  wordBreak: 'break-word', overflowWrap: 'break-word',
};
