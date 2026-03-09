import { Badge } from '../../ui/Badge';
import { BORDER, DARK, SLATE, ORANGE } from '../../../lib/constants';
import { calcRevenue } from '../../../types/revenue';
import type { PropertyWell } from '../../../types/revenue';

interface WellRevenueCardProps {
  well: PropertyWell;
  oilPrice: number;
  gasPrice: number;
  deduction: number;
  decimal: number | null;
  allocOverride: number | null;
  onAllocChange: (val: number | null) => void;
  onClick: () => void;
  isMobile: boolean;
}

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function WellRevenueCard({
  well, oilPrice, gasPrice, deduction, decimal, allocOverride, onClick, isMobile,
}: WellRevenueCardProps) {
  const alloc = allocOverride ?? well.allocationPct;
  const { gross, net } = calcRevenue(
    well.trailing3mo.avgOilBbl,
    well.trailing3mo.avgGasMcf,
    oilPrice, gasPrice, decimal, alloc, deduction,
  );

  // Production trend: compare most recent month to 3rd most recent
  let trendIcon = '';
  let trendColor = SLATE;
  if (well.production.length >= 3) {
    const recent = well.production[0].oilBbl + well.production[0].gasMcf;
    const older = well.production[2].oilBbl + well.production[2].gasMcf;
    if (older > 0) {
      const change = (recent - older) / older;
      if (change > 0.05) { trendIcon = '↑'; trendColor = '#16a34a'; }
      else if (change < -0.05) { trendIcon = '↓'; trendColor = '#dc2626'; }
      else { trendIcon = '→'; trendColor = SLATE; }
    }
  }

  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${BORDER}`, borderRadius: 8,
        padding: isMobile ? 10 : 12, background: '#fff',
        cursor: 'pointer', transition: 'border-color 0.15s',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 8,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = ORANGE; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; }}
    >
      {/* Left: well info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: DARK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {well.wellName}
          </span>
          {well.wellStatus && (
            <Badge
              bg={well.wellStatus === 'Active' ? '#dcfce7' : '#f1f5f9'}
              color={well.wellStatus === 'Active' ? '#166534' : '#64748b'}
              size="sm"
            >
              {well.wellStatus}
            </Badge>
          )}
          {well.sharedPun && (
            <Badge bg="#dbeafe" color="#1e40af" size="sm">Shared</Badge>
          )}
          {alloc != null && alloc < 1 && (
            <Badge bg="#f3e8ff" color="#7c3aed" size="sm">{(alloc * 100).toFixed(0)}% alloc</Badge>
          )}
        </div>
        {well.operator && (
          <div style={{ fontSize: 11, color: SLATE, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {well.operator}
          </div>
        )}
        <div style={{ display: 'flex', gap: isMobile ? 8 : 12, marginTop: 4, fontSize: 11, color: SLATE }}>
          <span>Oil: {well.trailing3mo.avgOilBbl.toLocaleString()} BBL</span>
          <span>Gas: {well.trailing3mo.avgGasMcf.toLocaleString()} MCF</span>
          {trendIcon && <span style={{ color: trendColor, fontWeight: 600 }}>{trendIcon}</span>}
        </div>
      </div>

      {/* Right: revenue */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {net != null ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>
              {formatCurrency(Math.round(net))}
            </div>
            <div style={{ fontSize: 11, color: SLATE }}>/mo net</div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: '#dc2626' }}>No decimal</div>
        )}
      </div>
    </div>
  );
}
