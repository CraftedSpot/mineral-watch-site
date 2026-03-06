import { formatFieldValue } from '../../../lib/format-doc-type';

// --- Tracts ---

export function TractsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {value.map((tract, i) => {
        if (typeof tract !== 'object' || tract === null) return null;
        const t = tract as Record<string, unknown>;

        // Support both mineral deed (tract.legal) and lease (tract.legal_description) schemas
        const legal = (typeof t.legal === 'object' && t.legal ? t.legal : t.legal_description) as Record<string, unknown> | null;
        const interest = (typeof t.interest === 'object' && t.interest ? t.interest : {}) as Record<string, unknown>;
        const l = legal && typeof legal === 'object' ? legal : {} as Record<string, unknown>;

        const section = l.section || '';
        const township = l.township || '';
        const range = l.range || '';
        const meridian = l.meridian || '';
        const county = l.county || '';
        const state = l.state || 'OK';
        const quarterCalls = Array.isArray(l.quarter_calls) ? l.quarter_calls : [];
        const quarters = l.quarters || '';
        const grossAcres = l.gross_acres || t.acres;
        const acresQualifier = t.acres_qualifier || '';
        const fullDescription = l.full_description || '';

        const interestType = interest.type || 'mineral';
        const fractionText = interest.fraction_text || '';
        const netMineralAcres = interest.net_mineral_acres;
        const depthClause = interest.depth_clause ? String(interest.depth_clause) : '';
        const formationClause = interest.formation_clause ? String(interest.formation_clause) : '';
        const termClause = interest.term_clause ? String(interest.term_clause) : '';

        let locationStr = '';
        if (section && township && range) {
          locationStr = `Section ${section}-${township}-${range}`;
          if (meridian) locationStr += `-${meridian}`;
        }
        if (county) locationStr += locationStr ? `, ${county} County` : `${county} County`;
        if (state) locationStr += `, ${state}`;

        const quarterDisplay = quarterCalls.length > 0 ? quarterCalls.join(', ') : quarters ? String(quarters) : '';
        const hasInterestData = interest.type || fractionText || netMineralAcres !== undefined;

        return (
          <div key={i} style={{ background: '#F9FAFB', border: '1px solid #D1D5DB', borderRadius: 8, padding: 14 }}>
            {value.length > 1 && <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>Tract {i + 1}</div>}
            <div style={{ fontWeight: 600, color: '#1F2937', fontSize: 14, marginBottom: 8 }}>{locationStr || 'Location not specified'}</div>
            {quarterDisplay && <div style={{ fontSize: 13, color: '#4B5563', marginBottom: 4 }}>Quarter: {quarterDisplay}</div>}
            {grossAcres != null && (
              <div style={{ fontSize: 13, color: '#4B5563', marginBottom: 8 }}>
                Acres: {Number(grossAcres).toLocaleString()}{acresQualifier ? ` (${String(acresQualifier)})` : ''}
              </div>
            )}

            {hasInterestData && (
              <div style={{ background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 6, padding: 10, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>Interest Type:</span>
                    <span style={{ fontWeight: 600, color: '#1E40AF', textTransform: 'capitalize', marginLeft: 4 }}>{String(interestType)}</span>
                  </div>
                  {fractionText && <div style={{ fontWeight: 600, color: '#1E40AF' }}>{String(fractionText)}</div>}
                </div>
                {netMineralAcres != null && (
                  <div style={{ fontSize: 13, color: '#4B5563', marginTop: 6 }}>
                    Net Mineral Acres: <strong>{Number(netMineralAcres).toLocaleString()}</strong>
                  </div>
                )}
              </div>
            )}

            {(depthClause || formationClause || termClause) && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #D1D5DB' }}>
                {depthClause && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 4 }}><strong>Depth Limitation:</strong> {depthClause}</div>}
                {formationClause && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 4 }}><strong>Formation Limitation:</strong> {formationClause}</div>}
                {termClause && <div style={{ fontSize: 12, color: '#9333EA' }}><strong>Term:</strong> {termClause}</div>}
              </div>
            )}

            {fullDescription && (
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 8, fontStyle: 'italic' }}>{String(fullDescription)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Interest Conveyed ---

export function InterestConveyedRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') {
    return value ? <div style={{ fontSize: 14, color: '#1E40AF' }}>{formatFieldValue(value)}</div> : null;
  }
  const v = value as Record<string, unknown>;

  return (
    <div style={{ background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 6, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        {v.type && <div><span style={{ fontSize: 12, color: '#6B7280' }}>Type:</span> <span style={{ fontWeight: 600, color: '#1E40AF', textTransform: 'capitalize' }}>{String(v.type)}</span></div>}
        {v.fraction && <div style={{ fontWeight: 600, color: '#1E40AF' }}>{String(v.fraction)}</div>}
      </div>
      {v.mineral_surface && <div style={{ fontSize: 13, color: '#4B5563', marginTop: 4 }}>{String(v.mineral_surface)}</div>}
      {v.net_mineral_acres != null && <div style={{ fontSize: 13, color: '#4B5563', marginTop: 4 }}>NMA: <strong>{Number(v.net_mineral_acres).toLocaleString()}</strong></div>}
    </div>
  );
}

// --- Reservation ---

export function ReservationRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') {
    return value ? <div style={{ fontSize: 14, color: '#92400E' }}>{formatFieldValue(value)}</div> : null;
  }
  const v = value as Record<string, unknown>;

  return (
    <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: 10 }}>
      {v.reserved_interest_type && <div style={{ fontWeight: 600, color: '#92400E' }}>{String(v.reserved_interest_type)}</div>}
      {v.fraction && <div style={{ fontSize: 13, color: '#92400E', marginTop: 4 }}>{String(v.fraction)}</div>}
      {v.text && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{String(v.text)}</div>}
    </div>
  );
}

// --- Prior Instruments ---

export function PriorInstrumentsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>References to source of title:</div>
      {value.map((instrument, i) => {
        if (typeof instrument !== 'object' || instrument === null) {
          return (
            <div key={i} style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: '10px 12px' }}>
              <span style={{ color: '#92400E' }}>{String(instrument)}</span>
            </div>
          );
        }
        const inst = instrument as Record<string, unknown>;
        const book = inst.book ? String(inst.book) : '';
        const page = inst.page ? String(inst.page) : '';
        const instrumentNumber = inst.instrument_number ? String(inst.instrument_number) : '';
        const description = inst.description ? String(inst.description) : '';

        let refStr = '';
        if (book && page) refStr = `Book ${book}, Page ${page}`;
        if (instrumentNumber) refStr = refStr ? `${refStr} (Inst. #${instrumentNumber})` : `Inst. #${instrumentNumber}`;

        return (
          <div key={i} style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: '10px 12px' }}>
            {refStr && <div style={{ fontWeight: 500, color: '#92400E' }}>{refStr}</div>}
            {description && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{description}</div>}
          </div>
        );
      })}
    </div>
  );
}
