import { useState, useMemo, useCallback } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchProductionDecline, fetchDeclineMarkets, fetchDeclineResearch } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { TrendChart } from '../TrendChart';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED, MODAL_TYPES } from '../../../lib/constants';
import { useModal } from '../../../contexts/ModalContext';
import { useToast } from '../../../contexts/ToastContext';
import { OperatorLink } from '../../ui/OperatorLink';
import type { Column } from '../SortableTable';
import type { IntelligenceTier, DeclineWell, DeclineCountyAggregate, DeclineResearchData } from '../../../types/intelligence';

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

  if (loading) return <LoadingSkeleton columns={5} rows={6} label="Production Decline Analysis" />;
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

  const declineColor = (s.wellsSteepDecline ?? 0) > 0 ? '#dc2626' : (s.wellsInDecline ?? 0) > 0 ? '#f59e0b' : TEXT_DARK;
  const declineSubtext = (s.wellsSteepDecline ?? 0) > 0
    ? `${s.wellsSteepDecline} steep (>20% YoY)`
    : (s.wellsInDecline ?? 0) > 0 ? 'Modest decline rates' : 'Portfolio holding steady';

  const fmtK = (v: number) => v >= 1000 ? `${Math.round(v / 1000)}K` : v.toLocaleString();

  return (
    <div>
      {/* HUD metrics */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <HudBadge value={String(s.activeWells ?? 0)} label="Active Wells" detail={`${s.idleWells ?? 0} idle`} />
        <HudBadge value={fmtK(s.portfolioOilBBL ?? 0)} label="Oil (BBL)" detail={`${formatMonth(latestDataMonth)} production`} valueColor="#f59e0b" />
        <HudBadge value={fmtK(s.portfolioGasMCF ?? 0)} label="Gas (MCF)" detail={`${formatMonth(latestDataMonth)} production`} valueColor="#10b981" />
        <HudBadge value={String(s.wellsInDecline ?? 0)} label="Wells Declining" detail={declineSubtext} valueColor={declineColor} />
      </div>

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'portfolio' && <PortfolioTab wells={wells} monthlyTotals={data.monthlyTotals} />}
      {activeTab === 'markets' && <MarketsTab data={marketsData} loading={marketsLoading} />}
      {activeTab === 'research' && <ResearchTab data={researchData} loading={researchLoading} />}
    </div>
  );
}

function HudBadge({ value, label, detail, valueColor }: { value: string; label: string; detail: string; valueColor?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', background: BG_MUTED, borderRadius: 8,
      border: `1px solid ${BORDER}`, flex: '1 1 calc(50% - 8px)', minWidth: 0,
    }}>
      <span style={{ fontSize: 20, fontWeight: 700, color: valueColor || TEXT_DARK }}>{value}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: 11, color: SLATE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
      </div>
    </div>
  );
}

function PortfolioTab({ wells, monthlyTotals }: { wells: DeclineWell[]; monthlyTotals?: Array<{ yearMonth: string; totalOil: number; totalGas: number; totalBoe: number }> }) {
  const modal = useModal();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [countyFilter, setCountyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Unique counties for dropdown
  const counties = useMemo(() => {
    const set = new Set(wells.map((w) => w.county).filter(Boolean));
    return Array.from(set).sort();
  }, [wells]);

  // Filtered wells
  const filteredWells = useMemo(() => {
    const q = search.toLowerCase();
    return wells.filter((w) => {
      if (countyFilter && w.county !== countyFilter) return false;
      if (statusFilter && w.status !== statusFilter) return false;
      if (q) {
        const fields = [w.wellName, w.operator, w.county, w.formation, w.apiNumber]
          .filter(Boolean).map((s) => s.toLowerCase());
        if (!fields.some((f) => f.includes(q))) return false;
      }
      return true;
    });
  }, [wells, search, countyFilter, statusFilter]);

  // Build portfolio trend data for chart
  const chartData = useMemo(() => {
    if (!monthlyTotals || monthlyTotals.length === 0) return [];
    return monthlyTotals
      .slice()
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
      .slice(-18)
      .map((m) => ({ label: formatMonth(m.yearMonth), value: (m as any).totalBOE ?? m.totalBoe ?? 0 }));
  }, [monthlyTotals]);

  // CSV export
  const exportCsv = useCallback(() => {
    const esc = (s: string | null | undefined) => {
      if (!s) return '';
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = 'Well Name,API Number,Operator,County,Formation,Type,Last Reported,Oil (BBL),Gas (MCF),BOE,YoY Change %,Status';
    const rows = filteredWells.map((w) => [
      esc(w.wellName), esc(w.apiNumber), esc(w.operator), esc(w.county), esc(w.formation),
      w.isHorizontal ? 'Horizontal' : 'Vertical',
      w.lastReportedMonth || '',
      w.recentOilBBL ?? '', w.recentGasMCF ?? '', w.recentBOE || '',
      w.yoyChangePct != null ? w.yoyChangePct : '',
      w.status,
    ].join(','));

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `production-decline-${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  }, [filteredWells, toast]);

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
      render: (row) => <OperatorLink name={row.operator} fontSize={13} />,
    },
    {
      key: 'county', label: 'County', sortType: 'string', width: 'minmax(80px, 1fr)', hideOnMobile: true,
    },
    {
      key: 'status', label: 'Status', sortType: 'string', width: 'minmax(80px, 0.9fr)',
      render: (row) => statusBadge(row.status),
    },
    {
      key: 'wellType', label: 'Type', sortType: 'string', width: 'minmax(40px, 0.4fr)', hideOnMobile: true,
      render: (row) => (
        <Badge bg={row.isHorizontal ? '#dbeafe' : '#f3f4f6'} color={row.isHorizontal ? '#1e40af' : '#374151'} size="sm">
          {row.isHorizontal ? 'H' : 'V'}
        </Badge>
      ),
    },
    {
      key: 'recentOilBBL', label: 'Oil (BBL)', sortType: 'number', width: 'minmax(70px, 0.8fr)', hideOnMobile: true,
      render: (row) => <span style={{ fontSize: 12 }}>{row.recentOilBBL != null ? Math.round(row.recentOilBBL).toLocaleString() : '—'}</span>,
    },
    {
      key: 'recentGasMCF', label: 'Gas (MCF)', sortType: 'number', width: 'minmax(70px, 0.8fr)', hideOnMobile: true,
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
      key: 'lastReportedMonth', label: 'Last Rpt', sortType: 'string', width: 'minmax(60px, 0.7fr)', hideOnMobile: true,
      render: (row) => <span style={{ fontSize: 12, color: SLATE }}>{row.lastReportedMonth ? formatMonth(row.lastReportedMonth) : '—'}</span>,
    },
  ], [modal]);

  const selectStyle: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: `1px solid ${BORDER}`,
    fontSize: 12, color: TEXT_DARK, background: '#fff', cursor: 'pointer',
    fontFamily: 'inherit',
  };

  return (
    <div>
      {/* Trend chart */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 20, padding: 16, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>Portfolio Production Trend</span>
            <span style={{ fontSize: 11, color: SLATE }}>Total BOE (last 18 months)</span>
          </div>
          <TrendChart data={chartData} type="line" height={140} color="#0d9488" />
        </div>
      )}

      {/* Search + filters + export */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: SLATE, fontSize: 14, pointerEvents: 'none' }}>&#8981;</span>
          <input
            type="text"
            placeholder="Search wells, operators..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px 6px 30px', borderRadius: 6,
              border: `1px solid ${BORDER}`, fontSize: 12, color: TEXT_DARK,
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <select value={countyFilter} onChange={(e) => setCountyFilter(e.target.value)} style={selectStyle}>
          <option value="">All Counties</option>
          {counties.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="idle">Idle</option>
        </select>
        <button
          onClick={exportCsv}
          style={{
            padding: '6px 14px', borderRadius: 6, border: `1px solid ${BORDER}`,
            fontSize: 12, fontWeight: 600, color: TEXT_DARK, background: '#fff',
            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}
        >
          &#8615; Export CSV
        </button>
      </div>

      {/* Well count */}
      <div style={{ fontSize: 11, color: SLATE, marginBottom: 8 }}>
        Showing {filteredWells.length} of {wells.length} wells
      </div>

      <SortableTable
        columns={columns}
        data={filteredWells}
        defaultSort={{ key: 'yoyChangePct', dir: 'asc' }}
        rowKey={(row) => row.apiNumber}
        emptyMessage="No wells match your filters"
      />

      <div style={{ fontSize: 11, color: SLATE, marginTop: 8 }}>
        YoY calculated using 24-month production history
      </div>
    </div>
  );
}

function MarketsTab({ data, loading }: { data: { counties: DeclineCountyAggregate[] } | null; loading: boolean }) {
  const toast = useToast();
  const [sortBy, setSortBy] = useState<'performance' | 'wells' | 'name'>('performance');

  if (loading) return <LoadingSkeleton columns={4} rows={5} />;
  if (!data || !data.counties || data.counties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No county benchmark data available.</div>;
  }

  const { counties } = data;

  // Summary counts
  const outperforming = counties.filter((c) => c.userVsCountyDelta != null && c.userVsCountyDelta > 2).length;
  const tracking = counties.filter((c) => c.userVsCountyDelta != null && c.userVsCountyDelta >= -2 && c.userVsCountyDelta <= 2).length;
  const underperforming = counties.filter((c) => c.userVsCountyDelta != null && c.userVsCountyDelta < -2).length;
  const inactive = counties.filter((c) => c.userVsCountyDelta == null).length;

  const best = counties.filter((c) => c.userVsCountyDelta != null).sort((a, b) => (b.userVsCountyDelta ?? 0) - (a.userVsCountyDelta ?? 0))[0];
  const worst = counties.filter((c) => c.userVsCountyDelta != null).sort((a, b) => (a.userVsCountyDelta ?? 0) - (b.userVsCountyDelta ?? 0))[0];

  // Sort counties
  const sorted = [...counties].sort((a, b) => {
    if (sortBy === 'performance') {
      if (a.userVsCountyDelta == null && b.userVsCountyDelta == null) return 0;
      if (a.userVsCountyDelta == null) return 1;
      if (b.userVsCountyDelta == null) return -1;
      return b.userVsCountyDelta - a.userVsCountyDelta;
    }
    if (sortBy === 'wells') return b.userWellCount - a.userWellCount;
    return a.county.localeCompare(b.county);
  });

  // CSV export
  const exportCsv = () => {
    const esc = (s: string) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    const header = 'County,Your Wells,Your Median YoY %,Your Avg YoY %,County Median YoY %,Delta vs County,Active Wells,Idle Wells,Top Formations';
    const rows = sorted.map((c) => [
      esc(c.county), c.userWellCount,
      c.userMedianYoyPct != null ? c.userMedianYoyPct.toFixed(1) : '',
      c.userAvgYoyPct != null ? c.userAvgYoyPct.toFixed(1) : '',
      c.medianYoyChangePct != null ? c.medianYoyChangePct.toFixed(1) : '',
      c.userVsCountyDelta != null ? c.userVsCountyDelta.toFixed(1) : '',
      c.activeWells, c.idleWells,
      c.topFormations.map((f) => f.formation).join('; '),
    ].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decline-markets-${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  };

  const fmtYoY = (v: number | null) => {
    if (v == null) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
  };
  const yoyValColor = (v: number | null) => {
    if (v == null) return SLATE;
    if (v > 0) return '#059669';
    if (v > -10) return '#d97706';
    return '#dc2626';
  };

  const pillStyle = (bg: string, color: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 11, fontWeight: 600, background: bg, color,
  });

  const sortBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 6, border: `1px solid ${BORDER}`,
    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
    background: active ? TEXT_DARK : '#fff', color: active ? '#fff' : TEXT_DARK,
  });

  return (
    <div>
      {/* Intro + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, color: SLATE }}>
          Compare your wells' YoY production change against county-wide benchmarks.
        </span>
        <button onClick={exportCsv} style={{
          padding: '6px 14px', borderRadius: 6, border: `1px solid ${BORDER}`,
          fontSize: 12, fontWeight: 600, color: TEXT_DARK, background: '#fff',
          cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}>
          &#8615; Export CSV
        </button>
      </div>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {outperforming > 0 && <span style={pillStyle('rgba(16, 185, 129, 0.1)', '#059669')}>{outperforming} outperforming</span>}
        {tracking > 0 && <span style={pillStyle('#f3f4f6', '#6b7280')}>{tracking} tracking</span>}
        {underperforming > 0 && <span style={pillStyle('rgba(239, 68, 68, 0.1)', '#dc2626')}>{underperforming} underperforming</span>}
        {inactive > 0 && <span style={pillStyle('#f9fafb', '#9ca3af')}>{inactive} inactive</span>}
        {best && <span style={{ fontSize: 11, color: SLATE, marginLeft: 4 }}>Best: <b style={{ color: '#059669' }}>{best.county} ({fmtYoY(best.userVsCountyDelta)})</b></span>}
        {worst && worst.county !== best?.county && <span style={{ fontSize: 11, color: SLATE }}>Needs attention: <b style={{ color: '#dc2626' }}>{worst.county} ({fmtYoY(worst.userVsCountyDelta)})</b></span>}
      </div>

      {/* Sort controls */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: SLATE }}>Sort by:</span>
        <button style={sortBtnStyle(sortBy === 'performance')} onClick={() => setSortBy('performance')}>Performance</button>
        <button style={sortBtnStyle(sortBy === 'wells')} onClick={() => setSortBy('wells')}>Well Count</button>
        <button style={sortBtnStyle(sortBy === 'name')} onClick={() => setSortBy('name')}>Name</button>
      </div>

      {/* County cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {sorted.map((c) => {
          const delta = c.userVsCountyDelta;
          const isInactive = delta == null;
          const deltaIcon = isInactive ? '⏸' : delta > 2 ? '▲' : delta < -2 ? '▼' : '≈';
          const deltaBg = isInactive ? '#f9fafb' : delta > 2 ? 'rgba(16, 185, 129, 0.1)' : delta < -2 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(107, 114, 128, 0.08)';
          const deltaColor = isInactive ? '#9ca3af' : delta > 2 ? '#059669' : delta < -2 ? '#dc2626' : '#6b7280';
          const deltaText = isInactive ? 'No recent production data'
            : delta > 2 ? `Outperforming county median by ${delta.toFixed(1)}%`
            : delta < -2 ? `Underperforming county median by ${Math.abs(delta).toFixed(1)}%`
            : 'Tracking county median';

          return (
            <div key={c.county} style={{
              border: isInactive ? `1px dashed ${BORDER}` : `1px solid ${BORDER}`,
              borderRadius: 10, background: '#fff', overflow: 'hidden',
              opacity: isInactive ? 0.75 : 1,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              transition: 'box-shadow 0.2s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}
            >
              {/* Header */}
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: TEXT_DARK }}>{c.county}</span>
                <span style={{ fontSize: 12, color: SLATE }}>{c.userWellCount} wells</span>
              </div>

              {/* Body */}
              <div style={{ padding: '12px 16px' }}>
                {/* Delta indicator */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  borderRadius: 6, background: deltaBg, color: deltaColor,
                  fontSize: 12, fontWeight: 600, marginBottom: 12,
                  fontStyle: isInactive ? 'italic' : 'normal',
                }}>
                  <span>{deltaIcon}</span>
                  <span>{deltaText}</span>
                </div>

                {/* Stats rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <StatRow label="Your Wells YoY Change" value={fmtYoY(c.userMedianYoyPct)} valueColor={yoyValColor(c.userMedianYoyPct)} />
                  <StatRow label="County Median YoY Change" value={fmtYoY(c.medianYoyChangePct)} valueColor={yoyValColor(c.medianYoyChangePct)} />
                  {c.weightedAvgYoyPct != null && (
                    <StatRow label="County Weighted Avg (by BOE)" value={fmtYoY(c.weightedAvgYoyPct)} valueColor={yoyValColor(c.weightedAvgYoyPct)} />
                  )}
                  <StatRow label="County Wells" value={`${c.activeWells} active / ${c.idleWells} idle`} subtle />
                </div>

                {/* Formations */}
                {c.topFormations.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: SLATE, marginBottom: 4, fontWeight: 600 }}>Top Formations</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {c.topFormations.slice(0, 5).map((f) => {
                        const fColor = f.avgYoyChangePct == null ? { bg: '#f1f5f9', text: SLATE }
                          : f.avgYoyChangePct > 0 ? { bg: 'rgba(16, 185, 129, 0.1)', text: '#047857' }
                          : f.avgYoyChangePct > -10 ? { bg: 'rgba(217, 119, 6, 0.1)', text: '#b45309' }
                          : { bg: 'rgba(239, 68, 68, 0.1)', text: '#b91c1c' };
                        return (
                          <span key={f.formation} style={{
                            display: 'inline-flex', gap: 3, alignItems: 'baseline',
                            padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                            background: fColor.bg, color: fColor.text,
                          }}>
                            {f.formation}
                            {f.avgYoyChangePct != null && (
                              <span style={{ fontSize: 10, opacity: 0.85 }}>{fmtYoY(f.avgYoyChangePct)}</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatRow({ label, value, valueColor, subtle }: { label: string; value: string; valueColor?: string; subtle?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 0', borderBottom: `1px solid ${BORDER}`,
      opacity: subtle ? 0.7 : 1,
    }}>
      <span style={{ fontSize: 12, color: SLATE }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: valueColor || TEXT_DARK, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

// ── Research Tab ──

function declineColor(rate: number): string {
  if (rate > -10) return '#10b981';
  if (rate > -35) return '#f59e0b';
  if (rate > -60) return '#f97316';
  return '#ef4444';
}

function ResearchTab({ data, loading }: { data: DeclineResearchData | null; loading: boolean }) {
  const toast = useToast();
  const [view, setView] = useState<'decliners' | 'growers' | 'counties'>('decliners');
  const [countySort, setCountySort] = useState<'rate' | 'count' | 'name'>('rate');

  if (loading) return <LoadingSkeleton columns={3} rows={6} />;
  if (!data) return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No research data available.</div>;

  const { summary: s, operatorsByDecline, operatorsByGrowth, counties } = data;

  // Sort counties
  const sortedCounties = [...counties].sort((a, b) => {
    if (countySort === 'rate') return a.avgDecline - b.avgDecline;
    if (countySort === 'count') return b.activeWells - a.activeWells;
    return a.county.localeCompare(b.county);
  });

  // CSV export
  const exportCsv = () => {
    const esc = (str: string) => str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    const lines: string[] = ['Section,Rank,Name,Active Wells,Avg Decline %'];
    operatorsByDecline.forEach((op, i) => {
      lines.push(`Steepest Decliners,${i + 1},${esc(op.operator)},${op.activeWells},${op.avgDecline}`);
    });
    operatorsByGrowth.forEach((op, i) => {
      lines.push(`Top Growers,${i + 1},${esc(op.operator)},${op.activeWells},${op.avgDecline}`);
    });
    lines.push('');
    lines.push('County,Active Wells,Avg Decline %,Declining Wells,Growing Wells');
    counties.forEach((c) => {
      lines.push(`${esc(c.county)},${c.activeWells},${c.avgDecline},${c.decliningWells},${c.growingWells}`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decline-research-${new Date().toISOString().substring(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  };

  const viewBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 6, border: `1px solid ${BORDER}`,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    background: active ? TEXT_DARK : '#fff', color: active ? '#fff' : TEXT_DARK,
  });

  return (
    <div>
      {/* Intro + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, color: SLATE }}>Statewide production decline intelligence using BOE-equivalent year-over-year analysis.</span>
        <button onClick={exportCsv} style={{
          padding: '6px 14px', borderRadius: 6, border: `1px solid ${BORDER}`,
          fontSize: 12, fontWeight: 600, color: TEXT_DARK, background: '#fff',
          cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}>&#8615; Export CSV</button>
      </div>

      {/* HUD summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <HudBadge
          value={`${s.avgDecline}%`}
          label="Statewide Avg Decline"
          detail={`${(s.activePuns ?? 0).toLocaleString()} active PUNs`}
          valueColor={declineColor(s.avgDecline)}
        />
        <HudBadge
          value={String(s.steepDecline ?? 0)}
          label="Steep Decline (>25%)"
          detail="Wells declining rapidly"
          valueColor="#f97316"
        />
        <HudBadge
          value={String(s.growingWells ?? 0)}
          label="Growing Production"
          detail={`${s.flatWells ?? 0} flat wells`}
          valueColor="#10b981"
        />
      </div>

      {/* Data attribution */}
      <div style={{ fontSize: 11, color: SLATE, fontStyle: 'italic', marginBottom: 16, lineHeight: 1.6 }}>
        {s.dataHorizon && <>Data through {formatMonth(s.dataHorizon)}. </>}
        BOE year-over-year change comparing 3-month windows. Active wells only (produced within 3 months of data horizon).
        Min 20 wells per operator. Operators listed as "OTC/OCC NOT ASSIGNED" are excluded.
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={viewBtnStyle(view === 'decliners')} onClick={() => setView('decliners')}>Steepest Declining Operators</button>
        <button style={viewBtnStyle(view === 'growers')} onClick={() => setView('growers')}>Top Growing Operators</button>
        <button style={viewBtnStyle(view === 'counties')} onClick={() => setView('counties')}>County Production Trends</button>
      </div>

      {/* Views */}
      {view === 'decliners' && (
        <div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 10 }}>Operators with steepest average production decline (minimum 20 active wells)</div>
          <OperatorDeclineTable operators={operatorsByDecline} />
        </div>
      )}

      {view === 'growers' && (
        <div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 10 }}>Operators maintaining or growing production (minimum 20 active wells)</div>
          <OperatorDeclineTable operators={operatorsByGrowth} />
        </div>
      )}

      {view === 'counties' && (
        <div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 10 }}>Average decline rates across Oklahoma counties (minimum 10 active wells)</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: SLATE }}>Sort:</span>
            {(['rate', 'count', 'name'] as const).map((s) => (
              <button key={s} onClick={() => setCountySort(s)} style={{
                padding: '4px 10px', borderRadius: 6, border: `1px solid ${BORDER}`,
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                background: countySort === s ? TEXT_DARK : '#fff',
                color: countySort === s ? '#fff' : TEXT_DARK,
              }}>
                {s === 'rate' ? 'Decline Rate' : s === 'count' ? 'Well Count' : 'Name'}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {sortedCounties.map((c) => {
              const total = c.decliningWells + c.growingWells;
              const growPct = total > 0 ? Math.round(100 * c.growingWells / total) : 0;
              return (
                <div key={c.county} style={{
                  border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, background: '#fff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{c.county}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: declineColor(c.avgDecline) }}>{c.avgDecline > 0 ? '+' : ''}{c.avgDecline}%</span>
                  </div>
                  <div style={{ fontSize: 11, color: SLATE, marginBottom: 6 }}>{c.activeWells} active wells</div>
                  {/* Stacked bar */}
                  <div style={{ height: 4, borderRadius: 2, background: '#fee2e2', overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ height: '100%', width: `${growPct}%`, background: '#bbf7d0', borderRadius: 2 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: SLATE }}>
                    <span>{c.growingWells} growing</span>
                    <span>{c.decliningWells} declining</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function OperatorDeclineTable({ operators }: { operators: DeclineResearchData['operatorsByDecline'] }) {
  if (operators.length === 0) return <div style={{ padding: 24, color: SLATE, textAlign: 'center', fontSize: 13 }}>No operators meet the minimum well threshold.</div>;

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 140px', background: BG_MUTED, borderBottom: `1px solid ${BORDER}`, padding: '8px 12px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: SLATE }}>Operator</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: SLATE, textAlign: 'right' }}>Active Wells</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: SLATE, textAlign: 'right' }}>Avg Decline (YoY)</span>
      </div>
      {/* Rows */}
      {operators.map((op, i) => {
        const barWidth = Math.min(Math.abs(op.avgDecline), 100);
        const color = declineColor(op.avgDecline);
        const sign = op.avgDecline >= 0 ? '+' : '';
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '1fr 100px 140px',
            padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, alignItems: 'center',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <OperatorLink name={op.operator} fontSize={13} />
            </span>
            <span style={{ fontSize: 13, color: TEXT_DARK, textAlign: 'right' }}>{op.activeWells.toLocaleString()}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <div style={{ width: 60, height: 8, borderRadius: 4, background: '#f3f4f6', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${barWidth}%`, background: color, borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 48, textAlign: 'right', fontFamily: 'monospace' }}>{sign}{op.avgDecline}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
