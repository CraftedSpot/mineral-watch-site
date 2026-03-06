import { formatFieldName, formatSnakeCaseValue } from '../../../lib/format-doc-type';
import { BORDER } from '../../../lib/constants';

// --- Dates (spud, completion, first production) ---

export function DatesRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  const spud = d.spud_date ? String(d.spud_date) : '';
  const completion = d.completion_date ? String(d.completion_date) : '';
  const firstProd = d.first_production_date ? String(d.first_production_date) : '';
  if (!spud && !completion && !firstProd) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 12, background: '#F9FAFB', borderRadius: 8 }}>
      {spud && (
        <div style={{ background: 'white', padding: '10px 14px', borderRadius: 6, border: '1px solid #E5E7EB' }}>
          <span style={{ color: '#6B7280', fontSize: 12 }}>Spud Date</span>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{spud}</div>
        </div>
      )}
      {completion && (
        <div style={{ background: 'white', padding: '10px 14px', borderRadius: 6, border: '1px solid #E5E7EB' }}>
          <span style={{ color: '#6B7280', fontSize: 12 }}>Completion Date</span>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{completion}</div>
        </div>
      )}
      {firstProd && (
        <div style={{ background: 'white', padding: '10px 14px', borderRadius: 6, border: '1px solid #22C55E' }}>
          <span style={{ color: '#16A34A', fontSize: 12 }}>First Production</span>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#166534' }}>{firstProd}</div>
        </div>
      )}
    </div>
  );
}

// --- Well Type Badges ---

export function WellTypeRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const drillType = v.drill_type ? String(v.drill_type) : '';
  const wellClass = v.well_class ? String(v.well_class) : '';
  const status = v.status ? String(v.status) : '';
  if (!drillType && !wellClass && !status) return null;

  const typeColor = drillType === 'HORIZONTAL' ? '#7C3AED' : '#3B82F6';
  const statusColor = status === 'Accepted' ? '#16A34A' : (status === 'Rejected' ? '#DC2626' : '#F59E0B');

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      {drillType && (
        <span style={{ background: typeColor, color: 'white', padding: '4px 12px', borderRadius: 16, fontSize: 13, fontWeight: 600 }}>{drillType}</span>
      )}
      {wellClass && (
        <span style={{ background: '#E5E7EB', color: '#374151', padding: '4px 12px', borderRadius: 16, fontSize: 13, fontWeight: 500 }}>{wellClass}</span>
      )}
      {status && (
        <span style={{ background: statusColor, color: 'white', padding: '4px 12px', borderRadius: 16, fontSize: 13, fontWeight: 600 }}>{status}</span>
      )}
    </div>
  );
}

// --- Well Identification ---

export function WellIdentificationRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const wellName = v.well_name ? String(v.well_name) : '';
  const api = v.api_number ? String(v.api_number) : '';
  const permit = v.permit_number ? String(v.permit_number) : '';
  const operator = v.operator ? String(v.operator) : '';
  const pun = v.otc_prod_unit_no ? String(v.otc_prod_unit_no) : '';
  if (!wellName && !api && !permit && !operator) return null;

  return (
    <div style={{ background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 8, padding: 14 }}>
      {wellName && <div style={{ fontSize: 18, fontWeight: 700, color: '#1E40AF', marginBottom: 8 }}>{wellName}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
        {api && <div><span style={{ color: '#6B7280' }}>API:</span> <strong style={{ fontFamily: 'monospace' }}>{api}</strong></div>}
        {permit && <div><span style={{ color: '#6B7280' }}>Permit:</span> <strong>{permit}</strong></div>}
        {operator && <div><span style={{ color: '#6B7280' }}>Operator:</span> <strong>{operator}</strong></div>}
        {pun && <div><span style={{ color: '#6B7280' }}>OTC PUN:</span> <strong style={{ fontFamily: 'monospace' }}>{pun}</strong></div>}
      </div>
    </div>
  );
}

// --- Initial Production (dark green gradient card) ---

export function InitialProductionRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const testDate = v.test_date ? String(v.test_date) : '';
  const oil = v.oil_bbl_per_day;
  const gas = v.gas_mcf_per_day;
  const water = v.water_bbl_per_day;
  const choke = v.choke_size ? String(v.choke_size) : '';
  const flowMethod = v.flow_method ? String(v.flow_method) : '';
  const tubingPressure = v.flow_tubing_pressure_psi;
  const shutInPressure = v.initial_shut_in_pressure_psi;
  const oilGravity = v.oil_gravity_api;
  const gor = v.gas_oil_ratio;

  if (!testDate && oil == null && gas == null && water == null && !flowMethod) return null;

  return (
    <div style={{ background: 'linear-gradient(135deg, #065F46 0%, #047857 100%)', borderRadius: 12, padding: 16, color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {testDate ? <div style={{ fontSize: 12, opacity: 0.8 }}>Test Date: {testDate}</div> : <div />}
        {flowMethod && <div style={{ fontSize: 11, background: 'rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: 4 }}>{flowMethod}</div>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
        {oil != null && (
          <div style={{ background: 'rgba(255,255,255,0.15)', padding: '12px 16px', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{Number(oil).toLocaleString()}</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>OIL (BOPD)</div>
          </div>
        )}
        {gas != null && (
          <div style={{ background: 'rgba(255,255,255,0.15)', padding: '12px 16px', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{Number(gas).toLocaleString()}</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>GAS (MCFD)</div>
          </div>
        )}
        {water != null && (
          <div style={{ background: 'rgba(255,255,255,0.15)', padding: '12px 16px', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{Number(water).toLocaleString()}</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>WATER (BWPD)</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, opacity: 0.9 }}>
        {choke && <span>Choke: {choke}</span>}
        {oilGravity != null && <span>API Gravity: {Number(oilGravity)}°</span>}
        {gor != null && <span>GOR: {Number(gor).toLocaleString()}</span>}
        {tubingPressure != null && <span>FTP: {Number(tubingPressure).toLocaleString()} psi</span>}
        {shutInPressure != null && <span>ISIP: {Number(shutInPressure).toLocaleString()} psi</span>}
      </div>
    </div>
  );
}

// --- Surface Location (green card) ---

export function SurfaceLocationRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const section = v.section ? String(v.section) : '';
  const township = v.township ? String(v.township) : '';
  const range = v.range ? String(v.range) : '';
  const county = v.county ? String(v.county) : '';
  const state = v.state ? String(v.state) : '';
  const quarters = v.quarters ? String(v.quarters) : '';
  const footageNS = v.footage_ns ? String(v.footage_ns) : '';
  const footageEW = v.footage_ew ? String(v.footage_ew) : '';
  const elevation = v.ground_elevation_ft as number | undefined;
  const totalDepth = v.total_depth_ft as number | undefined;
  if (!section && !township && !range && !county) return null;

  const footageDisplay = [footageNS, footageEW].filter(Boolean).join(', ');

  return (
    <div style={{ background: '#F0FDF4', border: '1px solid #22C55E', borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#166534', marginBottom: 8 }}>
        {section ? `Section ${section}` : ''} {township ? `- ${township}` : ''} {range ? `- ${range}` : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
        {county && <div><span style={{ color: '#6B7280' }}>County:</span> <strong>{county}</strong></div>}
        {state && <div><span style={{ color: '#6B7280' }}>State:</span> <strong>{state}</strong></div>}
        {quarters && <div><span style={{ color: '#6B7280' }}>Quarters:</span> <strong>{quarters}</strong></div>}
      </div>
      {(footageDisplay || elevation != null || totalDepth != null) && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#374151', background: '#DCFCE7', padding: '6px 10px', borderRadius: 4 }}>
          {footageDisplay && <span>{footageDisplay}</span>}
          {elevation != null && <span>Elev: {Number(elevation).toLocaleString()} ft</span>}
          {totalDepth != null && <span>TD: {Number(totalDepth).toLocaleString()} ft</span>}
        </div>
      )}
    </div>
  );
}

// --- Bottom Hole Location (amber card) ---

export function BottomHoleLocationRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const section = v.section ? String(v.section) : '';
  const township = v.township ? String(v.township) : '';
  const range = v.range ? String(v.range) : '';
  const county = v.county ? String(v.county) : '';
  const quarters = v.quarters ? String(v.quarters) : '';
  const footageNS = v.footage_ns ? String(v.footage_ns) : '';
  const footageEW = v.footage_ew ? String(v.footage_ew) : '';
  if (!section && !township && !range) return null;

  const footageDisplay = [footageNS, footageEW].filter(Boolean).join(', ');

  return (
    <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#92400E', marginBottom: 8 }}>
        Bottom Hole: Section {section} - {township} - {range}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
        {county && <div><span style={{ color: '#6B7280' }}>County:</span> <strong>{county}</strong></div>}
        {quarters && <div><span style={{ color: '#6B7280' }}>Quarters:</span> <strong>{quarters}</strong></div>}
      </div>
      {footageDisplay && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#374151', background: '#FEF9C3', padding: '6px 10px', borderRadius: 4 }}>{footageDisplay}</div>
      )}
    </div>
  );
}

// --- Lateral Details (purple card) ---

export function LateralDetailsRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const lateralLength = v.lateral_length_ft as number | undefined;
  const kickoff = v.depth_of_deviation_ft as number | undefined;
  const radius = v.radius_of_turn_ft as number | undefined;
  const direction = v.direction ? String(v.direction) : (v.direction_degrees ? `${v.direction_degrees}°` : '');
  const completionInterval = v.completion_interval_ft as number | undefined;
  if (!lateralLength && !kickoff && !direction) return null;

  return (
    <div style={{ background: '#F5F3FF', border: '1px solid #8B5CF6', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 14 }}>
        {lateralLength != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#7C3AED' }}>{Number(lateralLength).toLocaleString()}&apos;</div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>Lateral Length</div>
          </div>
        )}
        {completionInterval != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#7C3AED' }}>{Number(completionInterval).toLocaleString()}&apos;</div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>Completion Interval</div>
          </div>
        )}
        {direction && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#7C3AED' }}>{direction}</div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>Direction</div>
          </div>
        )}
      </div>
      {(kickoff != null || radius != null) && (
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#6B7280' }}>
          {kickoff != null && <span>Kickoff: {Number(kickoff).toLocaleString()} ft</span>}
          {radius != null && <span>Turn Radius: {Number(radius).toLocaleString()} ft</span>}
        </div>
      )}
    </div>
  );
}

// --- First Sales (green card) ---

export function FirstSalesRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const salesDate = v.date ? String(v.date) : '';
  const purchaser = v.purchaser ? String(v.purchaser) : '';
  const purchaserNum = v.purchaser_number ? String(v.purchaser_number) : '';
  const gasPlant = v.gas_plant ? String(v.gas_plant) : '';
  if (!salesDate && !purchaser) return null;

  return (
    <div style={{ background: '#F0FDF4', border: '1px solid #22C55E', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {salesDate && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>First Sale Date</span>
            <div style={{ fontWeight: 600, color: '#166534' }}>{salesDate}</div>
          </div>
        )}
        {purchaser && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Purchaser</span>
            <div style={{ fontWeight: 600, color: '#166534' }}>
              {purchaser}{purchaserNum && <span style={{ fontWeight: 400, color: '#6B7280' }}> (#{purchaserNum})</span>}
            </div>
          </div>
        )}
        {gasPlant && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Gas Plant</span>
            <div style={{ fontWeight: 500 }}>{gasPlant}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Stimulation (amber card) ---

export function StimulationRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const method = v.method ? String(v.method) : '';
  const stages = v.stages as number | undefined;
  const proppant = v.total_proppant_lbs as number | undefined;
  const fluid = v.total_fluid_bbls as number | undefined;
  if (!method && stages == null && proppant == null && fluid == null) return null;

  return (
    <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {method && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Method</span>
            <div style={{ fontWeight: 600, color: '#92400E' }}>{method}</div>
          </div>
        )}
        {stages != null && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Frac Stages</span>
            <div style={{ fontWeight: 600, color: '#92400E' }}>{stages}</div>
          </div>
        )}
        {proppant != null && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Total Proppant</span>
            <div style={{ fontWeight: 500 }}>{Number(proppant).toLocaleString()} lbs</div>
          </div>
        )}
        {fluid != null && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Total Fluid</span>
            <div style={{ fontWeight: 500 }}>{Number(fluid).toLocaleString()} bbls</div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Perforated Intervals (table) ---

export function PerforatedIntervalsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'white', border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
        <thead style={{ background: '#F3F4F6' }}>
          <tr>
            {['Formation', 'Top (ft MD)', 'Bottom (ft MD)', 'Length (ft)'].map((h) => (
              <th key={h} style={{ padding: '8px', textAlign: h === 'Formation' ? 'left' : 'right', fontWeight: 600, color: '#374151' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.map((interval: Record<string, unknown>, i: number) => {
            const formation = interval.formation ? String(interval.formation) : `Interval ${i + 1}`;
            const top = interval.top_md_ft ?? interval.from_ft;
            const bottom = interval.bottom_md_ft ?? interval.to_ft;
            const length = interval.interval_length_ft ?? (top != null && bottom != null ? Math.abs(Number(bottom) - Number(top)) : null);
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: 8, fontWeight: 500 }}>{formation}</td>
                <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace' }}>{top != null ? Number(top).toLocaleString() : '-'}</td>
                <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace' }}>{bottom != null ? Number(bottom).toLocaleString() : '-'}</td>
                <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{length != null ? Number(length).toLocaleString() : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Formation Tops (list with depths) ---

export function FormationTopsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '4px 12px' }}>
      {value.map((f: Record<string, unknown>, i: number) => {
        const name = f.name ? String(f.name) : '';
        const md = f.md_ft as number | undefined;
        const tvd = f.tvd_ft as number | undefined;
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < value.length - 1 ? `1px solid ${BORDER}` : undefined }}>
            <span style={{ fontWeight: 500 }}>{name}</span>
            <span style={{ fontFamily: 'monospace', color: '#6B7280' }}>
              {md != null ? `${Number(md).toLocaleString()} ft MD` : ''}
              {md != null && tvd != null ? ' / ' : ''}
              {tvd != null ? `${Number(tvd).toLocaleString()} ft TVD` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// --- Formation Zones (complex: zones with nested intervals) ---

export function FormationZonesRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {value.map((zone: Record<string, unknown>, i: number) => {
        const name = zone.formation_name ? String(zone.formation_name) : (zone.name ? String(zone.name) : `Zone ${i + 1}`);
        const code = zone.formation_code ? String(zone.formation_code) : '';
        const spacingOrder = zone.spacing_order ? String(zone.spacing_order) : '';
        const unitSize = zone.unit_size_acres;
        const intervals = Array.isArray(zone.perforated_intervals) ? zone.perforated_intervals : [];
        const stim = zone.stimulation as Record<string, unknown> | undefined;

        return (
          <div key={i} style={{ background: '#F0F9FF', border: '1px solid #0EA5E9', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span style={{ fontWeight: 600, color: '#0369A1', fontSize: 14 }}>{name}</span>
                {code && <span style={{ marginLeft: 8, background: '#DBEAFE', color: '#1E40AF', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{code}</span>}
              </div>
              {unitSize != null && <span style={{ fontSize: 12, color: '#6B7280' }}>{Number(unitSize).toLocaleString()} acres</span>}
            </div>
            {spacingOrder && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>Spacing Order: {spacingOrder}</div>}
            {intervals.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Perforated Intervals</div>
                {intervals.map((int: Record<string, unknown>, j: number) => {
                  const top = int.from_ft ?? int.top_md_ft;
                  const bottom = int.to_ft ?? int.bottom_md_ft;
                  return (
                    <div key={j} style={{ fontSize: 12, fontFamily: 'monospace', color: '#374151', padding: '2px 0' }}>
                      {top != null ? Number(top).toLocaleString() : '?'} - {bottom != null ? Number(bottom).toLocaleString() : '?'} ft
                    </div>
                  );
                })}
              </div>
            )}
            {stim && stim.method && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#6B7280' }}>
                Stimulation: <strong>{String(stim.method)}</strong>
                {stim.stages != null && <span> ({String(stim.stages)} stages)</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Affected Sections (blue pills) ---

export function AffectedSectionsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {value.map((sec: Record<string, unknown>, i: number) => {
        const section = sec.section ? String(sec.section) : '';
        const township = sec.township ? String(sec.township) : '';
        const range = sec.range ? String(sec.range) : '';
        return (
          <span key={i} style={{ background: '#DBEAFE', color: '#1E40AF', padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 500 }}>
            {section} - {township} - {range}
          </span>
        );
      })}
    </div>
  );
}

// --- Generic Object Sub-fields (vanilla fallback: iterates entries as rows) ---

export function ObjectSubfieldsRenderer({ value, fieldName }: { value: unknown; fieldName?: string }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(([k, v]) => {
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      if (t === '' || t === 'none' || t === 'n/a' || t === 'null') return false;
    }
    if (Array.isArray(v) && v.length === 0) return false;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
    // Skip hidden patterns
    if (k.startsWith('_') || k.endsWith('_confidence') || k.endsWith('_normalized')) return false;
    return true;
  });
  if (entries.length === 0) return null;

  const prefix = fieldName ? formatFieldName(fieldName) + ' ' : '';

  return (
    <div>
      {entries.map(([subField, subValue], i) => {
        let display: string;
        if (Array.isArray(subValue)) {
          if (subValue.every(item => typeof item === 'string' || typeof item === 'number')) {
            display = subValue.join(', ');
          } else {
            display = subValue.map(item => {
              if (typeof item === 'object' && item !== null) {
                return Object.entries(item)
                  .filter(([, v]) => v != null && v !== '' && String(v).toLowerCase() !== 'none')
                  .map(([k, v]) => `${formatFieldName(k)}: ${typeof v === 'string' ? formatSnakeCaseValue(v) : String(v)}`)
                  .join(' \u2022 ');
              }
              return String(item);
            }).join('; ');
          }
        } else if (typeof subValue === 'object' && subValue !== null) {
          display = Object.entries(subValue)
            .filter(([, v]) => v != null && v !== '' && String(v).toLowerCase() !== 'none')
            .map(([k, v]) => `${formatFieldName(k)}: ${typeof v === 'string' ? formatSnakeCaseValue(v) : String(v)}`)
            .join(' \u2022 ');
        } else if (typeof subValue === 'boolean') {
          display = subValue ? 'Yes' : 'No';
        } else {
          display = typeof subValue === 'string' ? formatSnakeCaseValue(subValue) : String(subValue);
        }

        return (
          <div key={subField} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '12px 0', borderBottom: i < entries.length - 1 ? `1px solid ${BORDER}` : undefined, gap: 16,
          }}>
            <label style={{ fontSize: 14, fontWeight: 500, color: '#6B7280', flex: '0 0 140px' }}>
              {prefix}{formatFieldName(subField)}
            </label>
            <div style={{ fontSize: 14, color: '#111827', textAlign: 'right', flex: 1, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
              {display}
            </div>
          </div>
        );
      })}
    </div>
  );
}
