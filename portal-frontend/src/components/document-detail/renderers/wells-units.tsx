import { condenseLegal } from '../../../lib/format-doc-type';
import { BORDER } from '../../../lib/constants';

// --- Unit Sections ---

export function UnitSectionsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((unit, i) => {
        if (typeof unit !== 'object' || unit === null) {
          return (
            <div key={i} style={{ background: '#F0F9FF', border: '1px solid #3B82F6', borderRadius: 6, padding: '10px 12px' }}>
              <span style={{ fontWeight: 500, color: '#1E40AF' }}>{String(unit)}</span>
            </div>
          );
        }
        const u = unit as Record<string, unknown>;
        const section = u.section || '';
        const township = u.township || '';
        const range = u.range || '';
        let allocation = u.allocation_percentage;
        if (allocation === undefined && u.allocation_factor !== undefined) {
          allocation = (Number(u.allocation_factor) * 100).toFixed(2);
        }
        const acres = u.acres;
        const spacingOrder = u.spacing_order;
        const locationStr = section
          ? `Section ${section}` + (township ? ` - ${township}` : '') + (range ? `-${range}` : '')
          : 'Unknown Section';

        return (
          <div key={i} style={{ background: '#F0F9FF', border: '1px solid #3B82F6', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500, color: '#1E40AF' }}>{locationStr}</span>
              {allocation !== undefined && (
                <span style={{ background: '#DBEAFE', color: '#1E40AF', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                  {String(allocation)}% Allocation
                </span>
              )}
            </div>
            {(acres || spacingOrder) && (
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                {acres ? `${acres} acres` : ''}
                {acres && spacingOrder ? ' \u2022 ' : ''}
                {spacingOrder ? `Spacing Order: ${spacingOrder}` : ''}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Allocation Factors ---

export function AllocFactorsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>
        Production and costs are allocated across these sections:
      </div>
      {value.map((factor, i) => {
        if (typeof factor !== 'object' || factor === null) return null;
        const f = factor as Record<string, unknown>;
        const section = f.section || '';
        const township = f.township || '';
        const range = f.range || '';
        const percentage = f.percentage;
        const acres = f.acres;
        const pun = f.pun ? String(f.pun) : '';
        const isSurface = f.is_surface_location === true;
        const location = section
          ? `Section ${section}${township ? ` - ${township}` : ''}${range ? `-${range}` : ''}`
          : '';

        if (!location) return null;

        return (
          <div key={i} style={{ background: '#F0F9FF', border: '1px solid #0EA5E9', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600, color: '#0369A1', fontSize: 14 }}>{location}</span>
                {acres != null && <span style={{ color: '#6B7280', fontSize: 12, marginLeft: 8 }}>({Number(acres).toLocaleString()} acres)</span>}
                {isSurface && (
                  <span style={{ background: '#DBEAFE', color: '#1E40AF', padding: '2px 6px', borderRadius: 4, fontSize: 10, marginLeft: 8 }}>
                    SURFACE
                  </span>
                )}
              </div>
              {percentage !== undefined && (
                <span style={{ background: '#0369A1', color: 'white', padding: '4px 12px', borderRadius: 6, fontWeight: 600, fontSize: 14 }}>
                  {String(percentage)}%
                </span>
              )}
            </div>
            {pun && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#6B7280' }}>
                OTC PUN: <span style={{ fontFamily: 'monospace', background: '#F3F4F6', padding: '2px 6px', borderRadius: 3 }}>{pun}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Wells Table (well transfers, not check stubs) ---

export function WellsTableRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const wells = value as Array<Record<string, unknown>>;
  const hasDetailedData = wells.some((w) => w.api_number);

  if (!hasDetailedData) {
    // Summary info boxes
    return (
      <div>
        {wells.map((item, i) => {
          const name = item.well_name ? String(item.well_name) : '';
          const comments = item.comments ? String(item.comments) : '';
          return (
            <div key={i} style={{ background: '#F0F9FF', border: '1px solid #0EA5E9', borderRadius: 6, padding: 12, marginBottom: 8 }}>
              {name && <div style={{ fontWeight: 500, color: '#0369A1', marginBottom: 4 }}>{name}</div>}
              {comments && <div style={{ fontSize: 13, color: '#475569' }}>{comments}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    AC: 'Active', TA: 'Temp Abandoned', SP: 'Spudded',
    ND: 'Not Drilled', TM: 'Temp Shut-in', PA: 'Perm Abandoned', CM: 'Commingled',
  };

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'white', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', minWidth: 700 }}>
          <thead style={{ background: '#F3F4F6' }}>
            <tr>
              {['API', 'Well Name', 'Type', 'Status', 'Location', 'County'].map((h) => (
                <th key={h} style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {wells.map((well, i) => {
              const api = well.api_number ? String(well.api_number) : '';
              const name = well.well_name ? String(well.well_name) : '';
              const num = well.well_number ? String(well.well_number) : '';
              const type = well.well_type ? String(well.well_type) : '';
              const status = well.well_status ? String(well.well_status) : '';
              const statusLabel = statusLabels[status] || status;
              const section = well.section || '';
              const township = well.township || '';
              const range = well.range || '';
              const county = well.county ? String(well.county) : '';
              const comments = well.comments ? String(well.comments) : '';
              const typeColor = type === 'OIL' ? '#92400E' : (type === 'GAS' ? '#1E40AF' : '#6B7280');
              const statusColor = status === 'AC' ? '#16A34A' : (status === 'TA' || status === 'TM' ? '#F59E0B' : '#6B7280');

              return (
                <>
                  <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '10px 8px' }}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6B7280' }}>{api}</span></td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>
                      {name}{num ? <span style={{ fontWeight: 400, color: '#6B7280' }}> {num}</span> : ''}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{ background: typeColor + '15', color: typeColor, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{type}</span>
                    </td>
                    <td style={{ padding: '10px 8px' }}><span style={{ color: statusColor, fontSize: 12 }}>{statusLabel}</span></td>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: 12 }}>
                      {section ? `S${section}` : ''}-{String(township)}-{String(range)}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: 12, color: '#6B7280' }}>{county}</td>
                  </tr>
                  {comments && (
                    <tr key={`c-${i}`} style={{ background: '#FEF3C7' }}>
                      <td colSpan={6} style={{ padding: '4px 8px 4px 20px', fontSize: 11, color: '#92400E' }}>
                        {comments}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#6B7280' }}>
        {wells.length} well{wells.length !== 1 ? 's' : ''} transferred
      </div>
    </div>
  );
}

// --- Legal Description (multi-section chips or single-line) ---

export function LegalDescriptionRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') {
    return value ? <div style={{ fontSize: 14 }}>{String(value)}</div> : null;
  }

  const condensed = condenseLegal(value as Record<string, unknown>);
  if (!condensed) return null;

  const locations = condensed.split('\n').filter((s) => s.trim());

  if (locations.length > 1) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {locations.map((loc, i) => (
          <div key={i} style={{ background: '#F0F9FF', border: '1px solid #3B82F6', borderRadius: 6, padding: '6px 10px' }}>
            <span style={{ fontWeight: 500, color: '#1E40AF' }}>{loc}</span>
          </div>
        ))}
      </div>
    );
  }

  return <div style={{ fontSize: 14, color: '#1a2332' }}>{condensed}</div>;
}
