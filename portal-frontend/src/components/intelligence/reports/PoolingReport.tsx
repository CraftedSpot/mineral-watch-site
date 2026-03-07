import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchPoolingReport } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { PoolingPropertyGroup, PoolingNearbyOrder, PoolingCountyAvg, PoolingReportData } from '../../../types/intelligence';

function formatCurrency(v: number | null): string {
  if (v == null) return '—';
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return d; }
}

function distanceBadge(tier: number, desc: string) {
  if (tier === 0) return <Badge bg="#dcfce7" color="#166534" size="sm">Same Section</Badge>;
  if (tier === 1) return <Badge bg="#dbeafe" color="#1e40af" size="sm">Adjacent</Badge>;
  return <Badge bg="#f3f4f6" color="#374151" size="sm">{desc || 'Nearby'}</Badge>;
}

function formationName(f: { name: string } | string): string {
  return typeof f === 'string' ? f : f.name;
}

function bonusRange(opts: PoolingNearbyOrder['electionOptions']): string {
  if (!opts || opts.length === 0) return '—';
  const bonuses = opts.map(o => o.bonusPerAcre).filter((b): b is number => b != null && b > 0);
  if (bonuses.length === 0) return 'Participate';
  const min = Math.min(...bonuses);
  const max = Math.max(...bonuses);
  return min === max ? formatCurrency(min) + '/ac' : `${formatCurrency(min)}–${formatCurrency(max)}/ac`;
}

function royaltyRange(opts: PoolingNearbyOrder['electionOptions']): string {
  if (!opts || opts.length === 0) return '—';
  const fracs = opts.map(o => o.royaltyFraction).filter((f): f is string => f != null);
  if (fracs.length === 0) return '—';
  const unique = [...new Set(fracs)];
  return unique.join(', ');
}

export function PoolingReport() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const { data, loading, error, refetch } = useReportData(fetchPoolingReport);

  if (loading) return <LoadingSkeleton columns={5} rows={6} />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { summary: s, byProperty, countyAverages, marketResearch } = data;
  const tabs = [
    { key: 'portfolio', label: 'My Portfolio', badge: byProperty.length },
    { key: 'markets', label: 'My Markets', badge: countyAverages.length },
    { key: 'research', label: 'Market Research' },
  ];

  return (
    <div>
      {/* HUD */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { value: String(s.totalNearbyOrders), label: 'Nearby Orders', detail: `${s.countyCount} counties` },
          { value: s.avgBonusPerAcre != null ? formatCurrency(s.avgBonusPerAcre) + '/ac' : '—', label: 'Avg Bonus', detail: s.bonusRange.min != null ? `${formatCurrency(s.bonusRange.min)}–${formatCurrency(s.bonusRange.max)}` : '' },
          { value: String(s.topOperators?.length || 0), label: 'Active Operators', detail: s.topOperators?.[0]?.name || '' },
          { value: String(s.countyCount), label: 'Your Counties', detail: s.dateRange?.latest ? `Latest: ${formatDate(s.dateRange.latest)}` : '' },
        ].map((b, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', background: BG_MUTED, borderRadius: 8,
            border: `1px solid ${BORDER}`, flex: '1 1 160px',
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: TEXT_DARK }}>{b.value}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK }}>{b.label}</div>
              <div style={{ fontSize: 11, color: SLATE }}>{b.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'portfolio' && <PortfolioTab properties={byProperty} />}
      {activeTab === 'markets' && <MarketsTab counties={countyAverages} />}
      {activeTab === 'research' && <ResearchTab data={marketResearch} />}
    </div>
  );
}

function PortfolioTab({ properties }: { properties: PoolingPropertyGroup[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (properties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No nearby pooling orders found.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {properties.map((prop) => (
        <div key={prop.propertyId} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
          {/* Property header — clickable */}
          <button
            onClick={() => toggle(prop.propertyId)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={SLATE} strokeWidth="2"
                style={{ width: 14, height: 14, transition: 'transform 0.15s', transform: expanded.has(prop.propertyId) ? 'rotate(90deg)' : '' }}>
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>
                {prop.propertyName || `Sec ${prop.section}-${prop.township}-${prop.range}`}
              </span>
              <Badge bg="#f1f5f9" color={SLATE} size="sm">{prop.county}</Badge>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: SLATE }}>
              <span>{prop.orderCount} order{prop.orderCount !== 1 ? 's' : ''}</span>
              {prop.avgBonus != null && <span>Avg {formatCurrency(prop.avgBonus)}/ac</span>}
            </div>
          </button>

          {/* Expanded: order table */}
          {expanded.has(prop.propertyId) && (
            <div style={{ borderTop: `1px solid ${BORDER}`, padding: 12 }}>
              <OrdersTable orders={prop.nearbyOrders} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function OrdersTable({ orders }: { orders: PoolingNearbyOrder[] }) {
  const columns: Column<PoolingNearbyOrder>[] = useMemo(() => [
    {
      key: 'orderDate', label: 'Date', sortType: 'string', width: 90,
      render: (row) => <span style={{ fontSize: 12 }}>{formatDate(row.orderDate)}</span>,
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: 150,
      render: (row) => <span style={{ fontWeight: 500 }}>{row.operator || row.applicant}</span>,
    },
    {
      key: '_formations', label: 'Formations', width: 140,
      getValue: (row) => row.formations?.length || 0,
      render: (row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(row.formations || []).slice(0, 2).map((f, i) => (
            <Badge key={i} bg="#f1f5f9" color={SLATE} size="sm">{formationName(f)}</Badge>
          ))}
          {(row.formations || []).length > 2 && (
            <Badge bg="#f1f5f9" color={SLATE} size="sm">+{row.formations.length - 2}</Badge>
          )}
        </div>
      ),
    },
    {
      key: '_location', label: 'Location', sortType: 'string', width: 100,
      getValue: (row) => `${row.section}-${row.township}-${row.range}`,
      render: (row) => <span style={{ fontSize: 12, color: SLATE }}>{row.section}-{row.township}-{row.range}</span>,
    },
    {
      key: '_bonus', label: 'Bonus', width: 110,
      getValue: (row) => row.electionOptions?.[0]?.bonusPerAcre ?? 0,
      render: (row) => <span style={{ fontSize: 12, fontWeight: 600 }}>{bonusRange(row.electionOptions)}</span>,
    },
    {
      key: '_royalty', label: 'Royalty', width: 80,
      getValue: (row) => row.electionOptions?.[0]?.royaltyFraction || '',
      render: (row) => <span style={{ fontSize: 12 }}>{royaltyRange(row.electionOptions)}</span>,
    },
    {
      key: 'distanceTier', label: 'Distance', sortType: 'number', width: 100,
      render: (row) => distanceBadge(row.distanceTier, row.distanceDescription),
    },
  ], []);

  return (
    <SortableTable
      columns={columns}
      data={orders}
      defaultSort={{ key: 'orderDate', dir: 'desc' }}
      rowKey={(row) => row.id || row.caseNumber}
      emptyMessage="No orders"
    />
  );
}

function MarketsTab({ counties }: { counties: PoolingCountyAvg[] }) {
  if (counties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No county pooling data available.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {counties.map((c) => (
        <div key={c.county} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, marginBottom: 8 }}>{c.county}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 10 }}>
            <div>
              <div style={{ color: SLATE, marginBottom: 2 }}>Avg Bonus</div>
              <div style={{ fontWeight: 600, color: TEXT_DARK }}>{formatCurrency(c.avgBonus)}/ac</div>
            </div>
            <div>
              <div style={{ color: SLATE, marginBottom: 2 }}>Orders</div>
              <div style={{ fontWeight: 600, color: TEXT_DARK }}>{c.orderCount}</div>
            </div>
            <div>
              <div style={{ color: SLATE, marginBottom: 2 }}>Range</div>
              <div style={{ fontWeight: 600, color: TEXT_DARK }}>
                {c.minBonus != null && c.maxBonus != null ? `${formatCurrency(c.minBonus)}–${formatCurrency(c.maxBonus)}` : '—'}
              </div>
            </div>
            <div>
              <div style={{ color: SLATE, marginBottom: 2 }}>Dominant Royalty</div>
              <div style={{ fontWeight: 600, color: TEXT_DARK }}>{c.dominantRoyalty || '—'}</div>
            </div>
          </div>
          {c.mostActiveOperator && (
            <div style={{ fontSize: 12, color: SLATE, marginBottom: 6 }}>
              Most active: <span style={{ fontWeight: 600, color: TEXT_DARK }}>{c.mostActiveOperator}</span>
            </div>
          )}
          {c.formations.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {c.formations.slice(0, 3).map(f => (
                <Badge key={f} bg="#f1f5f9" color={SLATE} size="sm">{f}</Badge>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ResearchTab({ data }: { data: PoolingReportData['marketResearch'] | undefined }) {
  if (!data) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No statewide research data available.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {/* Top formations */}
      {data.topFormations?.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Top Formations by Bonus</h3>
          {data.topFormations.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.topFormations.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
              <span style={{ color: TEXT_DARK }}>{f.name}</span>
              <span style={{ fontWeight: 600, color: '#16a34a' }}>{formatCurrency(f.avgBonus)}/ac</span>
            </div>
          ))}
        </div>
      )}

      {/* Top paying operators */}
      {data.topPayingOperators?.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Top Paying Operators</h3>
          {data.topPayingOperators.map((o, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.topPayingOperators.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
              <span style={{ color: TEXT_DARK }}>{o.name}</span>
              <span style={{ fontWeight: 600, color: '#16a34a' }}>{formatCurrency(o.avgBonus)}/ac</span>
            </div>
          ))}
        </div>
      )}

      {/* Hottest counties */}
      {data.hottestCounties?.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Hottest Counties (90 days)</h3>
          {data.hottestCounties.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.hottestCounties.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
              <span style={{ color: TEXT_DARK }}>{c.county}</span>
              <span style={{ fontWeight: 600, color: SLATE }}>{c.orderCount} orders</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

