import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchProductionDecline, fetchDeclineMarkets, fetchDeclineResearch } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { TrendChart } from '../TrendChart';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED, MODAL_TYPES } from '../../../lib/constants';
import { useModal } from '../../../contexts/ModalContext';
import type { Column } from '../SortableTable';
import type { IntelligenceTier, DeclineWell, DeclineCountyAggregate } from '../../../types/intelligence';

interface Props {
  tier: IntelligenceTier;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatMonth(yyyymm: string): string {
  if (!yyyymm || yyyymm.length < 6) return yyyymm || '';
  const month = parseInt(yyyymm.substring(4, 6), 10);
  return MONTH_ABBR[month - 1] + " '" + yyyymm.substring(2, 4);
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: '#dcfce7', color: '#166534', label: 'Active' },
    declining: { bg: '#fef3c7', color: '#92400e', label: 'Declining' },
    steep_decline: { bg: '#fee2e2', color: '#991b1b', label: 'Steep Decline' },
    idle: { bg: '#f3f4f6', color: '#374151', label: 'Idle' },
  };
  const s = map[status] || map.active;
  return <Badge bg={s.bg} color={s.color} size="sm">{s.label}</Badge>;
}

function yoyColor(pct: number | null): string {
  if (pct == null) return SLATE;
  if (pct > 0) return '#16a34a';
  if (pct > -20) return '#f59e0b';
  return '#dc2626';
}

export function ProductionDeclineReport({ tier }: Props) {
  const [activeTab, setActiveTab] = useState('portfolio');
  const { data, loading, error, refetch } = useReportData(fetchProductionDecline);
  const { data: marketsData, loading: marketsLoading } = useReportData(fetchDeclineMarkets, { enabled: activeTab === 'markets' });
  const { data: researchData, loading: researchLoading } = useReportData(fetchDeclineResearch, { enabled: activeTab === 'research' });

  if (loading) return <LoadingSkeleton columns={5} rows={6} />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { wells, summary: s, latestDataMonth } = data;
  const tabs = [
    { key: 'portfolio', label: 'My Portfolio', badge: s.totalWells },
    { key: 'markets', label: 'My Markets' },
    { key: 'research', label: 'Market Research' },
  ];

  return (
    <div>
      {/* HUD */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { value: `${s.activeWells ?? 0}`, label: 'Active Wells', detail: `${s.idleWells ?? 0} idle` },
          { value: (s.portfolioOilBBL ?? 0).toLocaleString(), label: 'Oil (BBL)', detail: 'Latest month' },
          { value: (s.portfolioGasMCF ?? 0).toLocaleString(), label: 'Gas (MCF)', detail: 'Latest month' },
          { value: `${(s.wellsInDecline ?? 0) + (s.wellsSteepDecline ?? 0)}`, label: 'Declining', detail: `${s.wellsSteepDecline ?? 0} steep` },
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

      {activeTab === 'portfolio' && <PortfolioTab wells={wells} monthlyTotals={data.monthlyTotals} />}
      {activeTab === 'markets' && <MarketsTab data={marketsData} loading={marketsLoading} />}
      {activeTab === 'research' && (
        researchLoading ? <LoadingSkeleton columns={3} rows={5} />
        : <div style={{ padding: 24, color: SLATE, textAlign: 'center', fontSize: 14 }}>
            {researchData ? 'Statewide research data loaded.' : 'No research data available.'}
          </div>
      )}
    </div>
  );
}

function PortfolioTab({ wells, monthlyTotals }: { wells: DeclineWell[]; monthlyTotals?: Array<{ yearMonth: string; totalOil: number; totalGas: number; totalBoe: number }> }) {
  const modal = useModal();

  // Build portfolio trend data for chart from pre-aggregated monthlyTotals
  const chartData = useMemo(() => {
    if (!monthlyTotals || monthlyTotals.length === 0) return [];
    return monthlyTotals
      .slice()
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
      .slice(-18)
      .map((m) => ({ label: formatMonth(m.yearMonth), value: m.totalBOE ?? m.totalBoe ?? 0 }));
  }, [monthlyTotals]);

  const columns: Column<DeclineWell>[] = useMemo(() => [
    {
      key: 'wellName', label: 'Well', sortType: 'string', width: 'minmax(100px, 1.5fr)',
      render: (row) => (
        <span
          style={{ fontWeight: 500, color: '#7c3aed', cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            modal.open(MODAL_TYPES.WELL, {
              wellId: row.wellId,
              apiNumber: row.apiNumber,
              wellName: row.wellName,
              operator: row.operator,
              county: row.county,
            });
          }}
        >
          {row.wellName}
        </span>
      ),
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: 'minmax(90px, 1.2fr)',
      render: (row) => <span title={row.operator}>{row.operator || '—'}</span>,
    },
    {
      key: 'county', label: 'County', sortType: 'string', width: 'minmax(80px, 1fr)',
    },
    {
      key: 'status', label: 'Status', sortType: 'string', width: 'minmax(80px, 0.9fr)',
      render: (row) => statusBadge(row.status),
    },
    {
      key: 'wellType', label: 'Type', sortType: 'string', width: 'minmax(40px, 0.4fr)',
      render: (row) => (
        <Badge bg={row.isHorizontal ? '#dbeafe' : '#f3f4f6'} color={row.isHorizontal ? '#1e40af' : '#374151'} size="sm">
          {row.isHorizontal ? 'H' : 'V'}
        </Badge>
      ),
    },
    {
      key: 'recentOilBBL', label: 'Oil (BBL)', sortType: 'number', width: 'minmax(70px, 0.8fr)',
      render: (row) => <span style={{ fontSize: 12 }}>{row.recentOilBBL != null ? Math.round(row.recentOilBBL).toLocaleString() : '—'}</span>,
    },
    {
      key: 'recentGasMCF', label: 'Gas (MCF)', sortType: 'number', width: 'minmax(70px, 0.8fr)',
      render: (row) => <span style={{ fontSize: 12 }}>{row.recentGasMCF != null ? Math.round(row.recentGasMCF).toLocaleString() : '—'}</span>,
    },
    {
      key: 'yoyChangePct', label: 'YoY', sortType: 'number', width: 'minmax(60px, 0.7fr)',
      render: (row) => {
        if (row.yoyChangePct == null) return <span style={{ color: SLATE }}>—</span>;
        const sign = row.yoyChangePct >= 0 ? '+' : '';
        return <span style={{ color: yoyColor(row.yoyChangePct), fontWeight: 600 }}>{sign}{row.yoyChangePct.toFixed(1)}%</span>;
      },
    },
    {
      key: 'lastReportedMonth', label: 'Last Rpt', sortType: 'string', width: 'minmax(60px, 0.7fr)',
      render: (row) => <span style={{ fontSize: 12, color: SLATE }}>{row.lastReportedMonth ? formatMonth(row.lastReportedMonth) : '—'}</span>,
    },
  ], []);

  return (
    <div>
      {/* Trend chart */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 20, padding: 16, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Portfolio Production Trend (BOE)</h3>
          <TrendChart data={chartData} type="bar" height={140} color="#3b82f6" />
        </div>
      )}

      <SortableTable
        columns={columns}
        data={wells}
        defaultSort={{ key: 'yoyChangePct', dir: 'asc' }}
        rowKey={(row) => row.apiNumber}
        emptyMessage="No production data available"
      />
    </div>
  );
}

function MarketsTab({ data, loading }: { data: { counties: DeclineCountyAggregate[] } | null; loading: boolean }) {
  if (loading) return <LoadingSkeleton columns={4} rows={5} />;
  if (!data || !data.counties || data.counties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No county benchmark data available.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {data.counties.map((county) => {
        const delta = county.userVsCountyDelta;
        const deltaColor = delta == null ? SLATE : delta > 5 ? '#16a34a' : delta < -5 ? '#dc2626' : SLATE;
        const deltaIcon = delta == null ? '—' : delta > 5 ? '▲' : delta < -5 ? '▼' : '≈';
        const deltaText = delta == null ? 'No comparison' : delta > 5 ? `Outperforming by ${delta.toFixed(1)}%` : delta < -5 ? `Underperforming by ${Math.abs(delta).toFixed(1)}%` : 'Tracking county median';

        return (
          <div key={county.county} style={{
            border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK }}>{county.county}</span>
              <span style={{ fontSize: 12, color: SLATE }}>{county.userWellCount} wells</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 13, color: deltaColor }}>
              <span>{deltaIcon}</span>
              <span>{deltaText}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div>
                <div style={{ color: SLATE, marginBottom: 2 }}>Your Median YoY</div>
                <div style={{ fontWeight: 600, color: TEXT_DARK }}>
                  {county.userMedianYoyPct != null ? `${county.userMedianYoyPct.toFixed(1)}%` : '—'}
                </div>
              </div>
              <div>
                <div style={{ color: SLATE, marginBottom: 2 }}>County Median YoY</div>
                <div style={{ fontWeight: 600, color: TEXT_DARK }}>
                  {county.medianYoyChangePct != null ? `${county.medianYoyChangePct.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>
            {county.topFormations.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                {county.topFormations.slice(0, 3).map((f) => (
                  <Badge key={f.formation} bg="#f1f5f9" color={SLATE} size="sm">
                    {f.formation} ({f.wellCount})
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
