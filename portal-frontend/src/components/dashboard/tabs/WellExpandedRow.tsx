import { formatDate, formatNumber, formatTRS, getWellStatusColor } from '../../../lib/helpers';
import { SLATE } from '../../../lib/constants';
import type { WellRecord } from '../../../types/dashboard';

const LABEL: React.CSSProperties = { color: '#6B7280', fontSize: 12, marginBottom: 4 };
const VALUE: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#1C2B36' };
const SECTION: React.CSSProperties = { padding: '16px 0', borderBottom: '1px solid #E5E7EB' };

export function WellExpandedRow({ well, onOpenDetail }: { well: WellRecord; onOpenDetail: () => void }) {
  const formationName = well.formation_canonical || well.formation_name || '';
  const formationDepth = well.measured_total_depth || well.true_vertical_depth;
  const formationDisplay = formationName && formationDepth
    ? `${formationName} @ ${formatNumber(formationDepth)} ft`
    : formationName || '\u2014';

  const ipGas = well.ip_gas_mcf ? formatNumber(well.ip_gas_mcf) : null;
  const ipOil = well.ip_oil_bbl ? formatNumber(well.ip_oil_bbl) : null;

  const status = well.well_status || '\u2014';
  const statusColor = getWellStatusColor(status);

  return (
    <div style={{ padding: 20, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, margin: '0 10px 10px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ color: '#6B7280', fontSize: 12, fontWeight: 600, letterSpacing: 0.5 }}>WELL DETAILS</div>
        {well.completion_date && (
          <span style={{ background: '#C05621', color: '#fff', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
            Completed: {formatDate(well.completion_date)}
          </span>
        )}
      </div>

      {/* Info Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={LABEL}>STATUS</div>
          <div style={{ ...VALUE, color: statusColor }}>{status}</div>
        </div>
        <div>
          <div style={LABEL}>FORMATION</div>
          <div style={VALUE}>{formationDisplay}</div>
        </div>
        <div>
          <div style={LABEL}>WELL TYPE</div>
          <div style={VALUE}>{well.well_type || '\u2014'}</div>
        </div>
        <div>
          <div style={LABEL}>FIRST PRODUCTION</div>
          <div style={VALUE}>{well.first_production_date ? formatDate(well.first_production_date) : '\u2014'}</div>
        </div>
        <div>
          <div style={LABEL}>LOCATION</div>
          <div style={VALUE}>
            {well.section && well.township && well.range
              ? formatTRS(well.section, well.township, well.range)
              : '\u2014'}
          </div>
        </div>
        <div>
          <div style={LABEL}>COUNTY</div>
          <div style={VALUE}>{well.county?.replace(/^\d+-/, '') || '\u2014'}</div>
        </div>
      </div>

      {/* Initial Production */}
      {(ipGas || ipOil) && (
        <div style={SECTION}>
          <div style={{ ...LABEL, marginBottom: 8 }}>INITIAL PRODUCTION</div>
          <div style={{ fontSize: 14, color: '#1C2B36' }}>
            {ipGas && <>Gas: <strong>{ipGas} MCF/day</strong></>}
            {ipGas && ipOil && ' \u2022 '}
            {ipOil && <>Oil: <strong>{ipOil} BBL/day</strong></>}
          </div>
        </div>
      )}

      {/* Lifetime Production */}
      {(well.otc_total_oil || well.otc_total_gas) && (
        <div style={SECTION}>
          <div style={{ ...LABEL, marginBottom: 8 }}>LIFETIME PRODUCTION</div>
          <div style={{ fontSize: 14, color: '#1C2B36' }}>
            {well.otc_total_oil != null && <>Oil: <strong>{formatNumber(well.otc_total_oil)} BBL</strong></>}
            {well.otc_total_oil != null && well.otc_total_gas != null && ' \u2022 '}
            {well.otc_total_gas != null && <>Gas: <strong>{formatNumber(well.otc_total_gas)} MCF</strong></>}
          </div>
        </div>
      )}

      {/* Notes */}
      {well.notes && (
        <div style={SECTION}>
          <div style={{ ...LABEL, marginBottom: 8 }}>NOTES</div>
          <div style={{ fontSize: 13, color: SLATE, lineHeight: 1.5 }}>{well.notes}</div>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          style={{
            background: '#C05621', color: '#fff', border: 'none',
            padding: '8px 20px', borderRadius: 4, fontSize: 13,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          Open Well Detail
        </button>
      </div>
    </div>
  );
}
