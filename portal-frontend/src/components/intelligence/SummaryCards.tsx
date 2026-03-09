import { OIL_NAVY } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { SummaryData, ReportType } from '../../types/intelligence';

interface SummaryCardsProps {
  data: SummaryData | null;
  insightCount: number;
  loading: boolean;
  onOpenReport: (type: ReportType) => void;
  onScrollToInsights: () => void;
}

function formatCurrency(amount: number): string {
  if (amount >= 10000) return '$' + (amount / 1000).toFixed(1) + 'K';
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function SummaryCards({ data, insightCount, loading, onOpenReport, onScrollToInsights }: SummaryCardsProps) {
  const isMobile = useIsMobile();

  const cardStyle = (clickable: boolean): React.CSSProperties => ({
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '20px 16px',
    cursor: clickable ? 'pointer' : 'default',
    transition: 'background 0.15s',
  });

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 4,
  };

  const detailStyle = (variant: 'neutral' | 'success' | 'alert' = 'neutral'): React.CSSProperties => ({
    fontSize: 12,
    color: variant === 'success' ? '#86efac'
      : variant === 'alert' ? '#fca5a5'
      : 'rgba(255,255,255,0.6)',
  });

  // Revenue detail text
  let revenueValue = '—';
  let revenueDetail = 'No revenue data yet';
  let revenueVariant: 'neutral' | 'success' | 'alert' = 'neutral';
  if (data) {
    if (data.estimatedRevenue != null) {
      revenueValue = formatCurrency(data.estimatedRevenue);
      if (data.revenueWellCount && data.totalWells) {
        revenueDetail = `Based on ${data.revenueWellCount} of ${data.totalWells} wells with data`;
      } else if (data.revenueChange != null) {
        const sign = data.revenueChange >= 0 ? '+' : '';
        revenueDetail = `${sign}${data.revenueChange.toFixed(1)}% from prior month`;
        revenueVariant = data.revenueChange >= 0 ? 'success' : 'alert';
      } else {
        revenueDetail = 'Based on available data';
      }
    } else if (data.totalWells && data.totalWells > 0) {
      revenueDetail = 'Upload check data to unlock';
    }
  }

  // Deduction detail
  let deductionValue = '—';
  let deductionDetail = 'No deduction data yet';
  let deductionWarning = false;
  if (data && data.deductionFlags != null) {
    deductionValue = data.deductionFlags > 0 ? `${data.deductionFlags} High` : '0 High';
    deductionWarning = data.deductionFlags > 0;
    deductionDetail = data.wellsAnalyzed ? `${data.wellsAnalyzed} wells analyzed` : 'No high deduction wells';
  }

  // Findings detail
  let findingsDetail = 'Loading...';
  let findingsVariant: 'neutral' | 'success' = 'neutral';
  if (!loading) {
    if (insightCount === 0) {
      findingsDetail = 'Portfolio looks healthy';
      findingsVariant = 'success';
    } else {
      findingsDetail = insightCount === 1 ? '1 new finding' : `${insightCount} new findings`;
    }
  }

  const shimmer = loading ? {
    animation: 'shimmer 1.5s ease-in-out infinite',
  } : {};

  return (
    <div style={{ background: OIL_NAVY, padding: '32px 0 28px' }}>
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: isMobile ? '0 16px' : '0 24px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Intelligence</h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', margin: '0 0 20px' }}>
          Insights and analysis across your mineral portfolio
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
          gap: 12,
          ...shimmer,
        }}>
          {/* Active Wells */}
          <div
            style={cardStyle(true)}
            onClick={() => onOpenReport('production-decline')}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          >
            <div style={labelStyle}>Active Wells</div>
            <div style={valueStyle}>{data ? (data.activeWells ?? '—') : '—'}</div>
            <div style={detailStyle()}>
              {data ? (data.countyCount ? `Across ${data.countyCount} counties` : 'No well data yet') : 'Loading...'}
            </div>
          </div>

          {/* Est. Monthly Revenue */}
          <div
            style={cardStyle(true)}
            onClick={() => onOpenReport('deduction')}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          >
            <div style={labelStyle}>Est. Monthly Revenue</div>
            <div style={valueStyle}>{loading ? '—' : revenueValue}</div>
            <div style={{
              ...detailStyle(revenueVariant),
              ...(revenueValue === '—' && !loading ? { textDecoration: 'underline', textUnderlineOffset: 2, opacity: 0.8 } : {}),
            }}>
              {loading ? 'Loading...' : revenueDetail}
            </div>
          </div>

          {/* Deduction Health */}
          <div
            style={cardStyle(true)}
            onClick={() => onOpenReport('deduction')}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          >
            <div style={labelStyle}>Residue Gas Deduction Health</div>
            <div style={{ ...valueStyle, color: deductionWarning ? '#fbbf24' : '#fff' }}>
              {loading ? '—' : deductionValue}
            </div>
            <div style={detailStyle()}>{loading ? 'Loading...' : deductionDetail}</div>
          </div>

          {/* Findings */}
          <div
            style={{
              ...cardStyle(true),
              borderLeft: !loading && insightCount > 0 ? '3px solid #f59e0b' : '1px solid rgba(255,255,255,0.12)',
            }}
            onClick={onScrollToInsights}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          >
            <div style={labelStyle}>Findings</div>
            <div style={{ ...valueStyle, color: !loading && insightCount > 0 ? '#fbbf24' : '#fff' }}>
              {loading ? '—' : insightCount}
            </div>
            <div style={{
              ...detailStyle(findingsVariant),
              ...(insightCount > 0 ? { textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' } : {}),
            }}>
              {findingsDetail}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
