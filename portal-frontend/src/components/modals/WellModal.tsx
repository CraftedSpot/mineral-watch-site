import { useMemo, useState, useCallback } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useWells } from '../../hooks/useWells';
import { useAsyncData } from '../../hooks/useAsyncData';
import { fetchWellEnrichment, fetchLinkedProperties } from '../../api/wells';
import { AccordionSection } from '../ui/AccordionSection';
import { StatusBadge } from '../ui/StatusBadge';
import { SkeletonRows } from '../ui/SkeletonRows';
import { OTCProductionSection } from '../shared/OTCProductionSection';
import { OCCFilingsSection } from '../shared/OCCFilingsSection';
import { CompletionReportsSection } from '../shared/CompletionReportsSection';
import { DrillingPermitsSection } from '../shared/DrillingPermitsSection';
import { titleCase, formatTRS, getWellStatusColor, formatPhone, formatNumber } from '../../lib/helpers';
import { MODAL_TYPES, BORDER, DARK, SLATE } from '../../lib/constants';
import type { WellEnrichment, LinkedProperty } from '../../types/well-detail';

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
  const { data: wells } = useWells();
  const [occCount, setOccCount] = useState<number | null>(null);
  const [completionCount, setCompletionCount] = useState<number | null>(null);
  const [permitCount, setPermitCount] = useState<number | null>(null);

  // Resolve apiNumber from wellId if needed
  const resolvedApi = useMemo(() => {
    if (apiProp) return apiProp;
    if (wellId) {
      const found = wells.find((w) => w.id === wellId);
      return found?.apiNumber || '';
    }
    return '';
  }, [apiProp, wellId, wells]);

  // Fetch enrichment data
  const { data: enrichment, loading: enrichLoading } = useAsyncData<WellEnrichment>(
    () => resolvedApi ? fetchWellEnrichment(resolvedApi) : Promise.reject('No API number'),
    [resolvedApi],
  );

  // Resolve clientWellId for linked properties
  const clientWellId = useMemo(() => {
    if (enrichment?.clientWellId) return enrichment.clientWellId;
    if (wellId) return wellId;
    return null;
  }, [enrichment, wellId]);

  // Fetch linked properties (only if we have a client well ID)
  const { data: linkedProps, loading: propsLoading } = useAsyncData<LinkedProperty[]>(
    () => clientWellId ? fetchLinkedProperties(clientWellId) : Promise.resolve([]),
    [clientWellId],
  );

  // Merge pre-known data with enrichment
  const wellName = enrichment?.well_name || nameProp || 'Unknown Well';
  const operator = enrichment?.operator || opProp || '';
  const county = enrichment?.county || countyProp || '';
  const wellStatus = enrichment?.well_status || statusProp || '';
  const wellType = enrichment?.well_type || '';
  const hz = isHorizontal(wellName, enrichment);
  const section = enrichment?.section;
  const township = enrichment?.township;
  const range = enrichment?.range;

  const statusColor = getWellStatusColor(wellStatus);

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
        color: '#fff', padding: '20px 24px', borderRadius: '16px 16px 0 0', position: 'relative',
      }}>
        <button onClick={onClose} style={closeStyle}>&times;</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{titleCase(wellName)}</h2>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4, fontFamily: 'monospace' }}>
          API: {resolvedApi}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 'calc(100vh - 200px)', background: '#f8fafc' }}>
        {enrichLoading ? (
          <SkeletonRows count={4} />
        ) : (
          <>
            {/* Status Row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {wellStatus && (
                <StatusBadge label={wellStatus} color={statusColor} background={statusColor + '20'} />
              )}
              {wellType && (
                <StatusBadge label={wellType} />
              )}
              <StatusBadge
                label={hz ? 'Horizontal' : 'Vertical'}
                background={hz ? '#ede9fe' : '#f1f5f9'}
                color={hz ? '#7c3aed' : SLATE}
              />
            </div>

            {/* Operator / Location Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div style={infoBoxStyle}>
                <div style={{ fontSize: 11, color: SLATE, fontWeight: 600, marginBottom: 4 }}>Operator</div>
                <div style={{ fontSize: 13, color: DARK, fontWeight: 600 }}>{operator || '\u2014'}</div>
                {enrichment?.operator_phone && (
                  <a href={`tel:${enrichment.operator_phone}`} style={{ fontSize: 11, color: '#3b82f6', textDecoration: 'none' }}>
                    {formatPhone(enrichment.operator_phone)}
                  </a>
                )}
                {enrichment?.operator_contact && (
                  <div style={{ fontSize: 11, color: SLATE }}>{enrichment.operator_contact}</div>
                )}
              </div>
              <div style={infoBoxStyle}>
                <div style={{ fontSize: 11, color: SLATE, fontWeight: 600, marginBottom: 4 }}>Location</div>
                <div style={{ fontSize: 13, color: DARK, fontWeight: 600, fontFamily: 'monospace' }}>
                  {formatTRS(section, township, range) || '\u2014'}
                </div>
                {county && <div style={{ fontSize: 11, color: SLATE }}>{county} County</div>}
              </div>
            </div>

            {/* Formation & IP (conditional) */}
            {(enrichment?.formation_name || enrichment?.measured_total_depth || enrichment?.ip_oil_bbl || enrichment?.ip_gas_mcf) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                {(enrichment.formation_name || enrichment.measured_total_depth) && (
                  <div style={infoBoxStyle}>
                    <div style={{ fontSize: 11, color: SLATE, fontWeight: 600, marginBottom: 4 }}>Formation & Depth</div>
                    {enrichment.formation_name && (
                      <div style={{ fontSize: 13, color: DARK }}>
                        {enrichment.formation_canonical || enrichment.formation_name}
                      </div>
                    )}
                    {enrichment.measured_total_depth && (
                      <div style={{ fontSize: 11, color: SLATE }}>TD: {enrichment.measured_total_depth} ft</div>
                    )}
                  </div>
                )}
                {(enrichment.ip_oil_bbl || enrichment.ip_gas_mcf) && (
                  <div style={infoBoxStyle}>
                    <div style={{ fontSize: 11, color: SLATE, fontWeight: 600, marginBottom: 4 }}>Initial Production</div>
                    {enrichment.ip_oil_bbl != null && (
                      <div style={{ fontSize: 13, color: DARK }}>Oil: {formatNumber(enrichment.ip_oil_bbl)} BBL</div>
                    )}
                    {enrichment.ip_gas_mcf != null && (
                      <div style={{ fontSize: 13, color: DARK }}>Gas: {formatNumber(enrichment.ip_gas_mcf)} MCF</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* OTC Production (non-collapsible) */}
            {resolvedApi && <OTCProductionSection apiNumber={resolvedApi} />}

            {/* Linked Properties */}
            {clientWellId && (
              <AccordionSection title="Linked Properties" count={propsLoading ? null : (linkedProps?.length ?? 0)}>
                {propsLoading ? <SkeletonRows count={2} /> : linkedProps && linkedProps.length > 0 ? (
                  <div>
                    {linkedProps.map((p) => (
                      <div key={p.propertyId} style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
                        <span
                          onClick={() => modal.open(MODAL_TYPES.PROPERTY, { propertyId: p.propertyId })}
                          style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                        >
                          {p.location || 'Property'}
                        </span>
                        <div style={{ fontSize: 11, color: SLATE, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                          {p.group && <StatusBadge label={p.group} style={{ fontSize: 10, padding: '1px 6px' }} />}
                          {p.nma != null && <span>{p.nma} NMA</span>}
                          {p.county && <span>{p.county}</span>}
                          {p.matchReason && (() => {
                            const ms = { bg: '#e5e7eb', color: '#374151' };
                            return <StatusBadge label={p.matchReason} background={ms.bg} color={ms.color} style={{ fontSize: 10 }} />;
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: SLATE, fontSize: 12, padding: 8, textAlign: 'center' }}>No linked properties</div>
                )}
              </AccordionSection>
            )}

            {/* OCC Filings */}
            <AccordionSection title="OCC Filings" count={occCount}>
              {section && township && range ? (
                <OCCFilingsSection
                  apiNumber={resolvedApi}
                  section={section}
                  township={township}
                  range={range}
                  onCountChange={setOccCount}
                />
              ) : (
                <div style={{ color: SLATE, fontSize: 12, padding: 8 }}>Location data needed for filings</div>
              )}
            </AccordionSection>

            {/* Completion Reports */}
            <AccordionSection title="Well Records" count={completionCount}>
              {resolvedApi && (
                <CompletionReportsSection apiNumber={resolvedApi} onCountChange={setCompletionCount} />
              )}
            </AccordionSection>

            {/* Drilling Permits */}
            <AccordionSection title="Drilling Permits" count={permitCount}>
              {resolvedApi && (
                <DrillingPermitsSection apiNumber={resolvedApi} onCountChange={setPermitCount} />
              )}
            </AccordionSection>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px', borderTop: `1px solid ${BORDER}`, background: '#fff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderRadius: '0 0 16px 16px',
      }}>
        <a href={`/portal?tab=wells&search=${resolvedApi}`} style={{ ...footerBtnStyle, textDecoration: 'none' }}>
          Open in Dashboard
        </a>
        <a
          href={`https://imaging.occ.ok.gov/OG/Well/${resolvedApi.replace(/^35/, '')}`}
          target="_blank" rel="noopener noreferrer"
          style={{ ...footerBtnStyle, textDecoration: 'none' }}
        >
          OCC Well Records &#8599;
        </a>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 640,
  maxHeight: '90vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.15)', fontFamily: "'Inter', 'DM Sans', sans-serif",
  overflow: 'hidden',
};

const closeStyle: React.CSSProperties = {
  position: 'absolute', top: 12, right: 16, background: 'rgba(255,255,255,0.2)',
  border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
  fontSize: 18, lineHeight: '28px', textAlign: 'center', color: '#fff',
};

const infoBoxStyle: React.CSSProperties = {
  background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12,
};

const footerBtnStyle: React.CSSProperties = {
  background: '#f1f5f9', border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: '6px 14px', fontSize: 12, color: DARK, cursor: 'pointer',
  display: 'inline-block',
};
