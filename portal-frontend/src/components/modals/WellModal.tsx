import { useMemo, useState, useCallback } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useWells } from '../../hooks/useWells';
import { useToast } from '../../contexts/ToastContext';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  fetchWellEnrichment, fetchLinkedProperties, fetchLinkedDocuments, saveWellNotes,
} from '../../api/wells';
import { AccordionSection } from '../ui/AccordionSection';
import { Badge } from '../ui/Badge';
import { ModalShell } from '../ui/ModalShell';
import { Card } from '../ui/Card';
import { TextArea } from '../ui/FormField';
import { SkeletonRows } from '../ui/SkeletonRows';
import { OTCProductionSection } from '../shared/OTCProductionSection';
import { OCCFilingsSection } from '../shared/OCCFilingsSection';
import { CompletionReportsSection } from '../shared/CompletionReportsSection';
import { DrillingPermitsSection } from '../shared/DrillingPermitsSection';
import {
  titleCase, formatTRS, getWellStatusColor, formatPhone, formatNumber, formatDate, formatDecimal,
} from '../../lib/helpers';
import { MODAL_TYPES, BORDER } from '../../lib/constants';
import type { WellEnrichment, LinkedProperty, LinkedDocument } from '../../types/well-detail';
import type { WellRecord } from '../../types/dashboard';

// Vanilla color constants
const OIL_NAVY = '#1C2B36';
const SLATE_BLUE = '#334E68';

interface Props {
  onClose: () => void;
  modalId: string;
  apiNumber?: string;
  wellId?: string;
  wellName?: string;
  operator?: string;
  county?: string;
  status?: string;
}

function isHorizontal(name?: string, enrichment?: WellEnrichment | null): boolean {
  if (enrichment?.is_horizontal) return true;
  if (!name) return false;
  const n = name.toUpperCase();
  return n.includes(' H ') || n.includes(' HZ ') || n.endsWith(' H') || n.endsWith(' HZ') ||
    /\d+H$/.test(n) || /\d+HZ$/.test(n) || n.includes('HORIZONTAL');
}

export function WellModal({ onClose, apiNumber: apiProp, wellId, wellName: nameProp, operator: opProp, county: countyProp, status: statusProp }: Props) {
  const modal = useModal();
  const toast = useToast();
  const { data: wells } = useWells();
  const [occCountOverride, setOccCountOverride] = useState<number | undefined>(undefined);
  const [completionCount, setCompletionCount] = useState<number | null>(null);
  const [permitCount, setPermitCount] = useState<number | null>(null);
  const [notesValue, setNotesValue] = useState<string | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Resolve full WellRecord from store
  const wellRecord: WellRecord | null = useMemo(() => {
    if (wellId) return wells.find((w) => w.id === wellId) || null;
    if (apiProp) return wells.find((w) => w.apiNumber === apiProp) || null;
    return null;
  }, [wellId, apiProp, wells]);

  // OCC filing count: show pre-fetched _linkCounts immediately, override once accordion loads
  const occCount = occCountOverride ?? wellRecord?._linkCounts?.filings;

  const resolvedApi = useMemo(() => {
    if (apiProp) return apiProp;
    if (wellRecord) return wellRecord.apiNumber;
    return '';
  }, [apiProp, wellRecord]);

  // Enrichment fallback
  const { data: enrichment, loading: enrichLoading } = useAsyncData<WellEnrichment>(
    () => resolvedApi ? fetchWellEnrichment(resolvedApi) : Promise.reject('No API number'),
    [resolvedApi],
  );

  const clientWellId = useMemo(() => {
    if (wellRecord) return wellRecord.id;
    if (enrichment?.clientWellId) return enrichment.clientWellId;
    if (wellId) return wellId;
    return null;
  }, [wellRecord, enrichment, wellId]);

  // Linked data fetches
  const { data: linkedProps, loading: propsLoading } = useAsyncData<LinkedProperty[]>(
    () => clientWellId ? fetchLinkedProperties(clientWellId) : Promise.resolve([]),
    [clientWellId],
  );

  const { data: linkedDocs, loading: docsLoading } = useAsyncData<LinkedDocument[]>(
    () => (clientWellId && resolvedApi) ? fetchLinkedDocuments(clientWellId, resolvedApi) : Promise.resolve([]),
    [clientWellId, resolvedApi],
  );

  // Merge data: prefer wellRecord, fallback to enrichment
  const w = wellRecord;
  const wellName = w?.well_name || enrichment?.well_name || nameProp || 'Unknown Well';
  const operator = w?.operator || enrichment?.operator || opProp || '';
  const county = w?.county || enrichment?.county || countyProp || '';
  const wellStatus = w?.well_status || enrichment?.well_status || statusProp || '';
  const wellType = w?.well_type || enrichment?.well_type || '';
  const hz = isHorizontal(wellName, enrichment);
  const section = w?.section || enrichment?.section;
  const township = w?.township || enrichment?.township;
  const range = w?.range || enrichment?.range;
  const formationName = w?.formation_canonical || w?.formation_name || enrichment?.formation_canonical || enrichment?.formation_name || '';
  const userWellCode = w?.user_well_code || enrichment?.user_well_code || '';
  const occMapLink = w?.occMapLink || enrichment?.occMapLink || '';

  // Key dates & specs
  const completionDate = w?.completion_date || enrichment?.completion_date || null;
  const firstProdDate = w?.first_production_date || enrichment?.first_production_date || null;
  const totalDepth = w?.measured_total_depth || (enrichment?.measured_total_depth ? Number(enrichment.measured_total_depth) : null);
  const lateralLength = w?.lateral_length || enrichment?.lateral_length || null;
  const ipOil = w?.ip_oil_bbl ?? enrichment?.ip_oil_bbl ?? null;
  const ipGas = w?.ip_gas_mcf ?? enrichment?.ip_gas_mcf ?? null;
  const hasKeyDates = completionDate || firstProdDate || totalDepth || lateralLength || ipOil || ipGas;

  // Interests
  const riNri = w?.ri_nri ?? enrichment?.ri_nri ?? null;
  const wiNri = w?.wi_nri ?? enrichment?.wi_nri ?? null;
  const orriNri = w?.orri_nri ?? enrichment?.orri_nri ?? null;
  const hasInterests = riNri != null || wiNri != null || orriNri != null;
  const interestCount = [riNri, wiNri, orriNri].filter((v) => v != null).length;

  // Notes
  const originalNotes = w?.notes || enrichment?.notes || '';
  const currentNotes = notesValue !== null ? notesValue : originalNotes;

  // Operator contact
  const opPhone = w?.operator_phone || enrichment?.operator_phone || '';
  const opContact = w?.operator_contact || enrichment?.operator_contact || '';

  const statusColor = getWellStatusColor(wellStatus);

  // MW Map URL
  const mwMapUrl = useMemo(() => {
    if (!clientWellId) return '';
    const params = new URLSearchParams();
    params.set('well', clientWellId);
    if (county) params.set('county', county);
    if (section) params.set('section', section);
    if (township) params.set('township', township);
    if (range) params.set('range', range);
    return `/portal/oklahoma-map?${params.toString()}`;
  }, [clientWellId, county, section, township, range]);

  // OCC Well Records URL
  const occRecordsUrl = useMemo(() => {
    if (!resolvedApi) return '';
    const searchCmd = encodeURIComponent(`{[OG Well Records]:[API Number]="${resolvedApi}*"}`);
    return `https://public.occ.ok.gov/OGCDWellRecords/Search.aspx?searchcommand=${searchCmd}`;
  }, [resolvedApi]);

  // PUN from production data
  const [pun, setPun] = useState<string | null>(null);

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotesValue(e.target.value);
    setNotesDirty(e.target.value !== originalNotes);
  }, [originalNotes]);

  const handleSaveAndClose = useCallback(async () => {
    if (!clientWellId || !notesDirty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await saveWellNotes(clientWellId, currentNotes);
      toast.success('Notes saved');
      onClose();
    } catch {
      toast.error('Failed to save notes');
    } finally {
      setSaving(false);
    }
  }, [clientWellId, notesDirty, currentNotes, onClose, toast]);

  const handleEstimateRevenue = useCallback(() => {
    toast.info('Revenue Estimator coming in Phase 2d');
  }, [toast]);

  // Clean county display (strip numeric prefix)
  const cleanCounty = (c: string) => c.replace(/^\d+-/, '');

  return (
    <ModalShell
      onClose={onClose}
      headerBg={`linear-gradient(135deg, ${OIL_NAVY} 0%, ${SLATE_BLUE} 100%)`}
      headerContent={
        <>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: "'Merriweather', serif" }}>
            {wellName}
          </h2>
          <div style={{ fontSize: 15, opacity: 0.9, marginTop: 2 }}>
            API: {resolvedApi || '\u2014'}
          </div>
          {userWellCode && (
            <div style={{ marginTop: 4 }}>
              <span style={{
                fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
                fontSize: 12, background: 'rgba(255,255,255,0.15)',
                padding: '2px 8px', borderRadius: 4, opacity: 0.85,
              }}>
                Ref: {userWellCode}
              </span>
            </div>
          )}
        </>
      }
      bodyBg="#fff"
      footer={
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={handleEstimateRevenue} style={footerBtnStyle}>Estimate Revenue</button>
              {mwMapUrl && (
                <a href={mwMapUrl} target="_blank" rel="noopener noreferrer"
                  style={{ ...footerBtnStyle, textDecoration: 'none' }}>
                  MW Map &#8599;
                </a>
              )}
              {occMapLink && occMapLink !== '#' && (
                <a href={occMapLink} target="_blank" rel="noopener noreferrer"
                  style={{ ...footerBtnStyle, textDecoration: 'none' }}>
                  OCC Map &#8599;
                </a>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {occRecordsUrl && (
                <a href={occRecordsUrl} target="_blank" rel="noopener noreferrer" style={{ ...footerBtnStyle, textDecoration: 'none' }}>
                  Well Records &#8599;
                </a>
              )}
              {resolvedApi && (
                <a
                  href={pun ? `/print/unit?pun=${pun}&wellApi=${resolvedApi}` : '#'}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    ...footerBtnStyle, textDecoration: 'none',
                    ...(pun ? {} : { opacity: 0.5, pointerEvents: 'none' as const }),
                  }}
                >
                  Unit Report &#8599;
                </a>
              )}
            </div>
          </div>
          {notesDirty && (
            <button
              onClick={handleSaveAndClose}
              disabled={saving}
              style={{
                ...footerBtnStyle,
                marginTop: 10, width: '100%',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save & Close'}
            </button>
          )}
        </>
      }
    >
      {enrichLoading && !wellRecord ? (
        <SkeletonRows count={4} />
      ) : (
        <>
          {/* Status Row */}
          <div style={{
            display: 'flex', gap: 24, marginBottom: 20, paddingBottom: 16,
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <StatusItem label="Well Type">
              <span style={{ fontSize: 14, fontWeight: 600, color: OIL_NAVY }}>{wellType || '\u2014'}</span>
            </StatusItem>
            <StatusItem label="Direction">
              <Badge bg={hz ? '#DBEAFE' : '#f1f5f9'} color={hz ? '#1E40AF' : '#64748b'}>
                {hz ? 'Horizontal' : 'Vertical'}
              </Badge>
            </StatusItem>
            {formationName && (
              <StatusItem label="Formation">
                <Badge bg="#FEF3C7" color="#92400E">{formationName}</Badge>
              </StatusItem>
            )}
          </div>

          {/* Operator / Location */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <Card style={{ flex: 1 }}>
              <div style={sectionLabelStyle}>Operator</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: OIL_NAVY, marginBottom: 4 }}>
                {operator || '\u2014'}
              </div>
              {(opPhone || opContact) && (
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  {opPhone && (
                    <a href={`tel:${opPhone}`} style={{ color: SLATE_BLUE, textDecoration: 'none' }}>
                      {formatPhone(opPhone)}
                    </a>
                  )}
                  {opPhone && opContact && ' \u2022 '}
                  {opContact && <span>{opContact}</span>}
                </div>
              )}
            </Card>
            <Card style={{ flex: 1 }}>
              <div style={sectionLabelStyle}>Location</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: OIL_NAVY, marginBottom: 4 }}>
                {formatTRS(section, township, range) || '\u2014'}
              </div>
              {county && <div style={{ fontSize: 13, color: '#64748b' }}>{cleanCounty(county)} County</div>}
            </Card>
          </div>

          {/* Key Dates & Specs Row */}
          {hasKeyDates && (
            <Card bg="#f8fafc" padding="12px 16px" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {completionDate && <KeyDateItem label="Completed" value={formatDate(completionDate)} />}
                {firstProdDate && <KeyDateItem label="First Production" value={formatDate(firstProdDate)} />}
                {totalDepth && <KeyDateItem label="Total Depth" value={`${formatNumber(totalDepth)}\u2032`} />}
                {lateralLength && <KeyDateItem label="Lateral" value={`${formatNumber(lateralLength)}\u2032`} />}
                {ipOil != null && ipOil > 0 && <KeyDateItem label="IP Oil" value={`${formatNumber(ipOil)} bo/d`} color="#059669" />}
                {ipGas != null && ipGas > 0 && <KeyDateItem label="IP Gas" value={`${formatNumber(ipGas)} mcf/d`} color="#059669" />}
              </div>
            </Card>
          )}

          {/* OTC Production */}
          {resolvedApi && <OTCProductionSection apiNumber={resolvedApi} onPunLoaded={setPun} />}

          {/* Decimal Interest */}
          {hasInterests && (
            <AccordionSection title="Decimal Interest" count={interestCount} defaultOpen={hasInterests}>
              <div style={{ paddingTop: 12 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: '#059669', textTransform: 'uppercase',
                  marginBottom: 8, letterSpacing: '0.5px',
                }}>
                  Your Interest
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {riNri != null && <InterestRow label="Royalty Interest (RI NRI)" value={riNri} />}
                  {wiNri != null && <InterestRow label="Working Interest (WI NRI)" value={wiNri} />}
                  {orriNri != null && <InterestRow label="Override (ORRI NRI)" value={orriNri} />}
                </div>
              </div>
            </AccordionSection>
          )}

          {/* Linked Properties */}
          {clientWellId && (
            <AccordionSection title="Linked Properties" count={propsLoading ? null : (linkedProps?.length ?? 0)} maxHeight={250}>
              {propsLoading ? <SkeletonRows count={2} /> : linkedProps && linkedProps.length > 0 ? (
                <div>
                  {linkedProps.map((p) => (
                    <div key={p.propertyId} style={{
                      display: 'flex', justifyContent: 'space-between', padding: '10px 0',
                      borderBottom: '1px solid #f3f4f6',
                    }}>
                      <div>
                        <span
                          onClick={() => modal.open(MODAL_TYPES.PROPERTY, { propertyId: p.propertyId })}
                          style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
                        >
                          {p.location || 'Property'}
                        </span>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                          {p.group && (
                            <Badge bg="#e0e7ff" color="#3730a3" size="sm">{p.group}</Badge>
                          )}
                          {p.nma != null && (
                            <Badge bg="#dcfce7" color="#166534" size="sm">{p.nma} NMA</Badge>
                          )}
                          {p.county && <span>{p.county}</span>}
                          {p.matchReason && (
                            <Badge bg={BORDER} color="#374151" size="sm">{p.matchReason}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#6b7280', fontSize: 14, padding: '12px 0' }}>No properties linked to this well</div>
              )}
            </AccordionSection>
          )}

          {/* Linked Documents */}
          <AccordionSection title="Linked Documents" count={docsLoading ? null : (linkedDocs?.length ?? 0)} maxHeight={300}>
            {docsLoading ? <SkeletonRows count={2} /> : linkedDocs && linkedDocs.length > 0 ? (
              <div>
                {linkedDocs.map((doc) => (
                  <div key={doc.id} style={{
                    padding: '10px 0', borderBottom: '1px solid #f3f4f6',
                  }}>
                    <span
                      onClick={() => modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: doc.id })}
                      style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
                    >
                      {doc.displayName || 'Untitled Document'}
                    </span>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {doc.docType}
                      {doc.uploadDate && <> &middot; {formatDate(doc.uploadDate)}</>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#6b7280', fontSize: 14, padding: '12px 0' }}>No documents linked to this well</div>
            )}
          </AccordionSection>

          {/* OCC Filings */}
          <AccordionSection title="OCC Filings" count={occCount} maxHeight={300}>
            {section && township && range ? (
              <OCCFilingsSection
                apiNumber={resolvedApi}
                section={section}
                township={township}
                range={range}
                onCountChange={setOccCountOverride}
              />
            ) : (
              <div style={{ color: '#6b7280', fontSize: 14, padding: '12px 0', fontStyle: 'italic' }}>
                Location data needed for filings
              </div>
            )}
          </AccordionSection>

          {/* Completion Reports */}
          <AccordionSection title="Completion Reports" count={completionCount} maxHeight={300}>
            {resolvedApi && (
              <CompletionReportsSection apiNumber={resolvedApi} onCountChange={setCompletionCount} />
            )}
          </AccordionSection>

          {/* Drilling Permits */}
          <AccordionSection title="Drilling Permits" count={permitCount} maxHeight={300}>
            {resolvedApi && (
              <DrillingPermitsSection apiNumber={resolvedApi} onCountChange={setPermitCount} />
            )}
          </AccordionSection>

          {/* Notes */}
          <div style={{ marginTop: 16 }}>
            <div style={sectionLabelStyle}>Notes</div>
            <TextArea
              value={currentNotes}
              onChange={handleNotesChange}
              placeholder="Add notes about this well..."
              style={{ marginTop: 6 }}
            />
          </div>
        </>
      )}
    </ModalShell>
  );
}

/* Status row item with label above value */
function StatusItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.5px', color: SLATE_BLUE,
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function KeyDateItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        color: SLATE_BLUE, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: color || OIL_NAVY }}>{value}</div>
    </div>
  );
}

function InterestRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 13, color: '#6b7280' }}>{label}</span>
      <span style={{
        fontSize: 13, fontWeight: 600, color: OIL_NAVY,
        fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
      }}>
        {formatDecimal(value)}
      </span>
    </div>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.5px', color: SLATE_BLUE, marginBottom: 6,
};

const footerBtnStyle: React.CSSProperties = {
  background: SLATE_BLUE, color: '#fff', border: 'none', borderRadius: 6,
  padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 110, textAlign: 'center',
};
