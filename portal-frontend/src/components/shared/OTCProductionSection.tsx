import { useAsyncData } from '../../hooks/useAsyncData';
import { fetchProductionSummary } from '../../api/wells';
import { formatNumber } from '../../lib/helpers';
import { SkeletonRows } from '../ui/SkeletonRows';
import { BORDER, SLATE, DARK } from '../../lib/constants';
import type { ProductionSummary } from '../../types/well-detail';

interface Props {
  apiNumber: string;
}

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  active: { text: 'Active', color: '#10b981' },
  recently_idle: { text: 'Recently Idle', color: '#f59e0b' },
  extended_idle: { text: 'Extended Idle', color: '#ea580c' },
  no_recent_production: { text: 'No Recent Production', color: '#dc2626' },
};

function Sparkline({ data, months }: { data: number[]; months: string[] }) {
  if (!data || data.length < 2) return null;
  const w = 120, h = 32, pad = 4;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  });

  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline
        points={points.join(' ')}
        fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinejoin="round"
      />
      {data.map((v, i) => {
        const x = pad + (i / (data.length - 1)) * (w - pad * 2);
        const y = h - pad - (v / max) * (h - pad * 2);
        return (
          <circle key={i} cx={x} cy={y} r={2.5} fill="#3b82f6">
            <title>{months?.[i] || ''}: {v} BOE</title>
          </circle>
        );
      })}
    </svg>
  );
}

function ProductionGrid({ prod }: { prod: ProductionSummary }) {
  const p = prod.production;
  if (!p) return <div style={{ color: SLATE, fontSize: 12, padding: 8 }}>No production data available</div>;

  const cols = [
    { label: 'Last Reported', oil: p.lastMonth?.oil, gas: p.lastMonth?.gas, sub: p.lastMonth?.formatted },
    { label: 'Last 12 Mo', oil: p.last12Mo?.oil, gas: p.last12Mo?.gas },
    { label: 'Lifetime', oil: p.lifetime?.oil, gas: p.lifetime?.gas },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr', gap: 0, fontSize: 12 }}>
      {/* Header row */}
      <div />
      {cols.map((c) => (
        <div key={c.label} style={{ fontWeight: 600, color: SLATE, padding: '4px 8px', textAlign: 'right', fontSize: 11 }}>
          {c.label}
          {c.sub && <div style={{ fontWeight: 400, fontSize: 10 }}>{c.sub}</div>}
        </div>
      ))}
      {/* Oil row */}
      <div style={{ fontWeight: 600, color: DARK, padding: '4px 0', fontSize: 11 }}>OIL</div>
      {cols.map((c) => (
        <div key={`oil-${c.label}`} style={{ textAlign: 'right', padding: '4px 8px', color: DARK }}>
          {c.oil != null ? `${formatNumber(c.oil)} BBL` : '\u2014'}
        </div>
      ))}
      {/* Gas row */}
      <div style={{ fontWeight: 600, color: DARK, padding: '4px 0', fontSize: 11 }}>GAS</div>
      {cols.map((c) => (
        <div key={`gas-${c.label}`} style={{ textAlign: 'right', padding: '4px 8px', color: DARK }}>
          {c.gas != null ? `${formatNumber(c.gas)} MCF` : '\u2014'}
        </div>
      ))}
    </div>
  );
}

export function OTCProductionSection({ apiNumber }: Props) {
  const { data, loading, error } = useAsyncData(
    () => fetchProductionSummary(apiNumber),
    [apiNumber],
  );

  return (
    <div style={{ marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: DARK }}>OTC Production</span>
        {data?.status && (() => {
          const s = STATUS_MAP[data.status] || { text: data.status, color: SLATE };
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: s.color }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
              {s.text}
            </span>
          );
        })()}
      </div>

      {loading && <SkeletonRows count={2} />}
      {error && <div style={{ color: '#dc2626', fontSize: 12, padding: 4 }}>Failed to load production data</div>}
      {data && !loading && (
        <>
          <ProductionGrid prod={data} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            {data.trend && (
              <span style={{ fontSize: 11, color: data.trend.direction === 'up' ? '#16a34a' : data.trend.direction === 'down' ? '#dc2626' : SLATE }}>
                {data.trend.direction === 'up' ? '\u2191' : data.trend.direction === 'down' ? '\u2193' : '\u2192'}
                {' '}{data.trend.yoyChange > 0 ? '+' : ''}{data.trend.yoyChange}% YoY
              </span>
            )}
            <Sparkline data={data.sparkline || []} months={data.sparklineMonths || []} />
          </div>
        </>
      )}
    </div>
  );
}
