import { useEffect } from 'react';
import { useAsyncData } from '../../hooks/useAsyncData';
import { fetchProductionSummary } from '../../api/wells';
import { formatNumber } from '../../lib/helpers';
import { SkeletonRows } from '../ui/SkeletonRows';
import { BORDER, SLATE } from '../../lib/constants';
import type { ProductionSummary } from '../../types/well-detail';

interface Props {
  apiNumber: string;
  onPunLoaded?: (pun: string) => void;
}

const OIL_NAVY = '#1C2B36';
const SLATE_BLUE = '#334E68';

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  active: { text: 'Active', color: '#22c55e' },
  recently_idle: { text: 'Recently Idle', color: '#f59e0b' },
  extended_idle: { text: 'Extended Idle', color: '#f97316' },
  no_recent_production: { text: 'No Recent Production', color: '#ef4444' },
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
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr', gap: 8, fontSize: 12 }}>
      {/* Header row */}
      <div />
      {cols.map((c) => (
        <div key={c.label} style={{
          fontWeight: 600, color: '#1e40af', padding: '4px 6px', textAlign: 'right', fontSize: 9,
          textTransform: 'uppercase', background: 'rgba(59,130,246,0.1)', borderRadius: 4,
          border: '1px solid rgba(59,130,246,0.2)',
        }}>
          {c.label}
          {c.sub && <div style={{ fontWeight: 400, fontSize: 9 }}>{c.sub}</div>}
        </div>
      ))}
      {/* Oil row */}
      <div style={{ fontWeight: 600, color: '#166534', padding: '4px 0', fontSize: 12 }}>OIL</div>
      {cols.map((c) => (
        <div key={`oil-${c.label}`} style={{ textAlign: 'right', padding: '4px 6px', color: OIL_NAVY }}>
          {c.oil != null ? `${formatNumber(c.oil)} BBL` : '\u2014'}
        </div>
      ))}
      {/* Gas row */}
      <div style={{ fontWeight: 600, color: '#dc2626', padding: '4px 0', fontSize: 12 }}>GAS</div>
      {cols.map((c) => (
        <div key={`gas-${c.label}`} style={{ textAlign: 'right', padding: '4px 6px', color: OIL_NAVY }}>
          {c.gas != null ? `${formatNumber(c.gas)} MCF` : '\u2014'}
        </div>
      ))}
    </div>
  );
}

export function OTCProductionSection({ apiNumber, onPunLoaded }: Props) {
  const { data, loading, error } = useAsyncData(
    () => fetchProductionSummary(apiNumber),
    [apiNumber],
  );

  useEffect(() => {
    if (data?.pun && onPunLoaded) onPunLoaded(data.pun);
  }, [data?.pun, onPunLoaded]);

  return (
    <div style={{ marginTop: 16, marginBottom: 16, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', padding: 16 }}>
      {/* Header row: title + PUN */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', color: OIL_NAVY }}>
          OTC Production
        </span>
        {data?.pun && (
          <span style={{
            background: 'rgba(22,101,52,0.1)', color: '#166534', padding: '3px 8px',
            borderRadius: 4, fontSize: 11, fontWeight: 600,
          }}>
            PUN: {data.pun}
          </span>
        )}
      </div>

      {/* Status + Last Reported + Months Produced */}
      {data && !loading && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          marginBottom: 12, padding: '8px 12px', background: '#f8fafc', borderRadius: 6,
        }}>
          {data.status && (() => {
            const s = STATUS_MAP[data.status] || { text: data.status, color: SLATE };
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.text}</span>
              </div>
            );
          })()}
          {data.production?.lastMonth && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: SLATE_BLUE }}>Last Reported</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: OIL_NAVY }}>{data.production.lastMonth.formatted}</div>
            </div>
          )}
          {data.production && data.production.monthsProduced > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: SLATE_BLUE }}>Months Produced</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: OIL_NAVY }}>{data.production.monthsProduced}</div>
            </div>
          )}
        </div>
      )}

      {loading && <SkeletonRows count={2} />}
      {error && <div style={{ color: '#dc2626', fontSize: 12, padding: 4 }}>Failed to load production data</div>}
      {data && !loading && (
        <>
          {/* Cumulative boxes */}
          {data.production?.lifetime && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{
                flex: 1, background: 'rgba(22,101,52,0.08)', padding: '6px 10px', borderRadius: 6,
                border: '1px solid rgba(22,101,52,0.15)', textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: SLATE_BLUE, textTransform: 'uppercase' }}>Cum Oil</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>
                  {formatNumber(data.production.lifetime.oil)} BBL
                </div>
              </div>
              <div style={{
                flex: 1, background: 'rgba(22,101,52,0.08)', padding: '6px 10px', borderRadius: 6,
                border: '1px solid rgba(22,101,52,0.15)', textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: SLATE_BLUE, textTransform: 'uppercase' }}>Cum Gas</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>
                  {formatNumber(data.production.lifetime.gas)} MCF
                </div>
              </div>
            </div>
          )}

          <ProductionGrid prod={data} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            {data.trend && (
              <span style={{ fontSize: 11, color: data.trend.direction === 'up' ? '#166534' : data.trend.direction === 'down' ? '#dc2626' : SLATE_BLUE }}>
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
