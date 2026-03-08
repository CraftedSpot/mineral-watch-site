import { useState, useMemo, useCallback } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchShutInDetector, fetchShutInMarkets, fetchShutInResearch } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { DonutChart } from '../DonutChart';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED, MODAL_TYPES } from '../../../lib/constants';
import { useModal } from '../../../contexts/ModalContext';
import { useToast } from '../../../contexts/ToastContext';
import { OperatorLink } from '../../ui/OperatorLink';
import type { Column } from '../SortableTable';
import type {
  IntelligenceTier,
  ShutInWell,
  ShutInDetectorData,
  ShutInMarketCounty,
  ShutInMarketsData,
  ShutInResearchData,
  ShutInResearchOperator,
  ShutInResearchCounty,
} from '../../../types/intelligence';

interface Props {
  tier: IntelligenceTier;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatMonth(yyyymm: string | null): string {
  if (!yyyymm || yyyymm.length < 6) return '—';
  const month = parseInt(yyyymm.substring(4, 6), 10);
  return MONTH_ABBR[month - 1] + " '" + yyyymm.substring(2, 4);
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    recently_idle: { bg: '#fef3c7', color: '#92400e', label: 'Idle' },
    extended_idle: { bg: '#fed7aa', color: '#9a3412', label: 'Extended Idle' },
    no_recent_production: { bg: '#fee2e2', color: '#991b1b', label: 'Long-Term Idle' },
    no_data: { bg: '#f3f4f6', color: '#374151', label: 'No Data' },
  };
  const s = map[status] || map.no_data;
  return <Badge bg={s.bg} color={s.color} size="sm">{s.label}</Badge>;
}

function riskFlagBadge(flag: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    'HBP Risk': { bg: '#fee2e2', color: '#991b1b', label: 'HBP Risk' },
    'Sudden Stop': { bg: '#fed7aa', color: '#9a3412', label: 'Sudden Stop' },
    'Operator Pattern': { bg: '#dbeafe', color: '#1e40af', label: 'Op Pattern' },
  };
  const s = map[flag] || { bg: '#f3f4f6', color: '#374151', label: flag };
  return <Badge bg={s.bg} color={s.color} size="sm">{s.label}</Badge>;
}

function idleRateColor(rate: number): string {
  if (rate >= 75) return '#dc2626';
  if (rate >= 50) return '#ea580c';
  if (rate >= 20) return '#f59e0b';
  return '#16a34a';
}

function classifyNoDataWell(w: ShutInWell): 'ceased' | 'pre_data' | 'unlinked' {
  if (w.taxPeriodActive === false) return 'ceased';
  if (w.taxPeriodActive === true) return 'pre_data';
  return 'unlinked';
}

function noDataSubLabel(w: ShutInWell): string {
  const cls = classifyNoDataWell(w);
  if (cls === 'ceased') {
    const year = w.taxPeriodEnd ? w.taxPeriodEnd.substring(0, 4) : '';
    return year ? `Ceased (${year})` : 'Ceased';
  }
  if (cls === 'pre_data') {
    const year = w.taxPeriodStart ? w.taxPeriodStart.substring(0, 4) : '';
    return year ? `No Prod Data (est. ${year})` : 'No Production Data';
  }
  return 'No OTC Link';
}

export function ShutInDetectorReport({ tier }: Props) {
  const [activeTab, setActiveTab] = useState('portfolio');
  const { data, loading, error, refetch } = useReportData(fetchShutInDetector);
  const { data: marketsData, loading: marketsLoading } = useReportData(fetchShutInMarkets, { enabled: activeTab === 'markets' });
  const { data: researchData, loading: researchLoading } = useReportData(fetchShutInResearch, { enabled: activeTab === 'research' });

  if (loading) return <LoadingSkeleton columns={5} rows={6} label="Shut-In Detector" />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { summary: s, wells } = data;
  const idleWells = wells.filter(w => w.status !== 'no_data');
  const noDataWells = wells.filter(w => w.status === 'no_data');

  const tabs = [
    { key: 'portfolio', label: 'My Portfolio', badge: s.totalIdle },
    { key: 'markets', label: 'My Markets', badge: marketsData ? marketsData.counties.length : undefined },
    { key: 'research', label: 'Market Research' },
  ];

  // Donut segments
  const segments = [
    { label: 'Idle (3-6 mo)', value: s.recentlyIdle, color: '#f59e0b' },
    { label: 'Extended (6-12 mo)', value: s.extendedIdle, color: '#f97316' },
    { label: 'Long-Term (12+ mo)', value: s.noRecentProd, color: '#ef4444' },
  ].filter(seg => seg.value > 0);

  return (
    <div>
      {/* Report subtitle */}
      <div style={{ fontSize: 13, color: SLATE, marginBottom: 4 }}>
        Wells with no reported production in 3+ months
      </div>
      <div style={{ fontSize: 12, color: SLATE, marginBottom: 16 }}>
        {s.totalIdle} idle wells detected · {s.noData} with no OTC data
        <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          Based on OTC production data, updated daily at 8am CT
        </span>
      </div>

      {/* Donut chart */}
      {s.totalIdle > 0 && (
        <div style={{
          padding: 20, background: '#fff', borderRadius: 8,
          border: `1px solid ${BORDER}`, marginBottom: 16,
        }}>
          <DonutChart
            segments={segments}
            centerValue={s.totalIdle}
            centerLabel="idle wells"
            size={160}
          />
          {s.hbpRisk > 0 && (
            <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginTop: 12 }}>
              {s.hbpRisk} well{s.hbpRisk !== 1 ? 's' : ''} flagged for potential HBP risk
            </div>
          )}
        </div>
      )}

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'portfolio' && <PortfolioTab idleWells={idleWells} noDataWells={noDataWells} />}
      {activeTab === 'markets' && (
        marketsLoading ? <LoadingSkeleton columns={4} rows={5} />
        : marketsData ? <MarketsTab data={marketsData} />
        : <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>Could not load markets data.</div>
      )}
      {activeTab === 'research' && (
        researchLoading ? <LoadingSkeleton columns={4} rows={5} />
        : researchData ? <ResearchTab data={researchData} />
        : <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>Could not load research data.</div>
      )}
    </div>
  );
}

// ─── Portfolio Tab ───

function PortfolioTab({ idleWells, noDataWells }: { idleWells: ShutInWell[]; noDataWells: ShutInWell[] }) {
  const modal = useModal();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [countyFilter, setCountyFilter] = useState('all');

  const counties = useMemo(() => {
    const set = new Set(idleWells.map(w => w.county));
    return Array.from(set).sort();
  }, [idleWells]);

  const filtered = useMemo(() => {
    return idleWells.filter(w => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false;
      if (riskFilter !== 'all' && !w.riskFlags.includes(riskFilter)) return false;
      if (countyFilter !== 'all' && w.county !== countyFilter) return false;
      return true;
    });
  }, [idleWells, statusFilter, riskFilter, countyFilter]);

  const exportCsv = useCallback(() => {
    const header = 'Well Name,API Number,Operator,County,Status,Months Idle,Last Production,Risk Flags';
    const rows = filtered.map(w => [
      `"${w.wellName}"`,
      w.apiNumber,
      `"${w.operator}"`,
      w.county,
      w.status.replace(/_/g, ' '),
      w.monthsIdle >= 999 ? '' : String(w.monthsIdle),
      w.lastProdMonth ? formatMonth(w.lastProdMonth) : '',
      `"${w.riskFlags.join(', ')}"`,
    ].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shut-in-detector-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  }, [filtered, toast]);

  const openWell = useCallback((w: ShutInWell) => {
    modal.open(MODAL_TYPES.WELL, {
      wellId: w.clientWellId || w.apiNumber,
      apiNumber: w.apiNumber,
      wellName: w.wellName,
      operator: w.operator,
      county: w.county,
    });
  }, [modal]);

  // Sort priority: HBP Risk first, Sudden Stop next, Operator Pattern next, then monthsIdle
  const sortPriorityValue = useCallback((w: ShutInWell) => {
    if (w.riskFlags.includes('HBP Risk')) return 0;
    if (w.riskFlags.includes('Sudden Stop')) return 1;
    if (w.riskFlags.includes('Operator Pattern')) return 2;
    return 3;
  }, []);

  const columns: Column<ShutInWell>[] = useMemo(() => [
    {
      key: 'wellName', label: 'Well', sortType: 'string', width: '22%',
      render: (row) => (
        <span
          onClick={(e) => { e.stopPropagation(); openWell(row); }}
          style={{ fontWeight: 500, color: '#7c3aed', cursor: 'pointer' }}
        >
          {row.wellName}
        </span>
      ),
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: '18%',
      render: (row) => <OperatorLink name={row.operator} fontSize={13} />,
    },
    { key: 'county', label: 'County', sortType: 'string', width: '11%' },
    {
      key: 'status', label: 'Status', width: '13%',
      getValue: (row) => {
        const order = { recently_idle: 1, extended_idle: 2, no_recent_production: 3, no_data: 4 };
        return order[row.status as keyof typeof order] ?? 4;
      },
      render: (row) => statusBadge(row.status),
    },
    {
      key: 'monthsIdle', label: 'Mo. Idle', sortType: 'number', width: '8%',
      render: (row) => <span>{row.monthsIdle != null && row.monthsIdle < 999 ? row.monthsIdle : '—'}</span>,
    },
    {
      key: 'lastProdMonth', label: 'Last Prod', sortType: 'string', width: '10%',
      render: (row) => {
        if (row.lastProdMonth) return <span style={{ fontSize: 12, color: SLATE }}>{formatMonth(row.lastProdMonth)}</span>;
        if (row.taxPeriodStart) {
          const year = row.taxPeriodStart.substring(0, 4);
          return <span style={{ fontSize: 12, color: SLATE }}>Since {year}</span>;
        }
        return <span style={{ color: SLATE }}>—</span>;
      },
    },
    {
      key: '_flags', label: 'Risk Flags', width: '18%',
      getValue: (row) => sortPriorityValue(row),
      render: (row) => {
        if (row.riskFlags.length === 0) return <span style={{ color: SLATE }}>—</span>;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {row.riskFlags.map(f => <span key={f}>{riskFlagBadge(f)}</span>)}
          </div>
        );
      },
    },
  ], [openWell, sortPriorityValue]);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          <option value="recently_idle">Idle (3-6 mo)</option>
          <option value="extended_idle">Extended Idle (6-12 mo)</option>
          <option value="no_recent_production">Long-Term Idle (12+ mo)</option>
        </select>
        <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} style={selectStyle}>
          <option value="all">All Risk Flags</option>
          <option value="HBP Risk">HBP Risk</option>
          <option value="Sudden Stop">Sudden Stop</option>
          <option value="Operator Pattern">Operator Pattern</option>
        </select>
        <select value={countyFilter} onChange={e => setCountyFilter(e.target.value)} style={selectStyle}>
          <option value="all">All Counties</option>
          {counties.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={exportCsv} style={exportBtnStyle}>Export CSV</button>
      </div>

      <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
        Showing {filtered.length} of {idleWells.length} idle wells
      </div>

      <SortableTable
        columns={columns}
        data={filtered}
        defaultSort={{ key: '_flags', dir: 'asc' }}
        rowKey={(row) => row.apiNumber}
        emptyMessage="No idle wells match your filters"
      />

      {/* No Data Wells collapsible section */}
      {noDataWells.length > 0 && <NoDataSection wells={noDataWells} onOpenWell={openWell} />}
    </div>
  );
}

// ─── No Data Collapsible Section ───

function NoDataSection({ wells, onOpenWell }: { wells: ShutInWell[]; onOpenWell: (w: ShutInWell) => void }) {
  const [expanded, setExpanded] = useState(false);

  const ceased = wells.filter(w => classifyNoDataWell(w) === 'ceased').length;
  const preData = wells.filter(w => classifyNoDataWell(w) === 'pre_data').length;
  const unlinked = wells.filter(w => classifyNoDataWell(w) === 'unlinked').length;

  const columns: Column<ShutInWell>[] = useMemo(() => [
    {
      key: 'wellName', label: 'Well', sortType: 'string', width: '25%',
      render: (row) => (
        <span
          onClick={(e) => { e.stopPropagation(); onOpenWell(row); }}
          style={{ fontWeight: 500, color: '#7c3aed', cursor: 'pointer' }}
        >
          {row.wellName}
        </span>
      ),
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: '20%',
      render: (row) => <OperatorLink name={row.operator} fontSize={13} />,
    },
    { key: 'county', label: 'County', sortType: 'string', width: '15%' },
    {
      key: '_noDataStatus', label: 'Status', width: '25%',
      getValue: (row) => {
        const cls = classifyNoDataWell(row);
        return cls === 'ceased' ? 0 : cls === 'pre_data' ? 1 : 2;
      },
      render: (row) => {
        const label = noDataSubLabel(row);
        const cls = classifyNoDataWell(row);
        const colors = {
          ceased: { bg: '#f1f5f9', color: '#64748b' },
          pre_data: { bg: '#ede9fe', color: '#6d28d9' },
          unlinked: { bg: '#f3f4f6', color: '#94a3b8' },
        };
        const c = colors[cls];
        return <Badge bg={c.bg} color={c.color} size="sm">{label}</Badge>;
      },
    },
    {
      key: '_flags', label: 'Risk Flags', width: '15%',
      getValue: (row) => row.riskFlags.length,
      render: (row) => {
        if (row.riskFlags.length === 0) return <span style={{ color: SLATE }}>—</span>;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {row.riskFlags.map(f => <span key={f}>{riskFlagBadge(f)}</span>)}
          </div>
        );
      },
    },
  ], [onOpenWell]);

  return (
    <div style={{ marginTop: 16 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '10px 16px', background: BG_MUTED, borderRadius: 8,
          border: `1px solid ${BORDER}`,
        }}
      >
        <span style={{ fontSize: 10, color: SLATE, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>
          &#9654;
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>
          Historical / No OTC Data ({wells.length})
        </span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {ceased > 0 && <Badge bg="#f1f5f9" color="#64748b" size="sm">Ceased {ceased}</Badge>}
          {preData > 0 && <Badge bg="#ede9fe" color="#6d28d9" size="sm">No Prod Data {preData}</Badge>}
          {unlinked > 0 && <Badge bg="#f3f4f6" color="#94a3b8" size="sm">No OTC Link {unlinked}</Badge>}
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          <SortableTable
            columns={columns}
            data={wells}
            defaultSort={{ key: '_noDataStatus', dir: 'asc' }}
            rowKey={(row) => row.apiNumber}
          />
        </div>
      )}
    </div>
  );
}

// ─── Markets Tab ───

function MarketsTab({ data }: { data: ShutInMarketsData }) {
  const toast = useToast();
  const [sortBy, setSortBy] = useState<'performance' | 'wells' | 'name'>('performance');

  const { counties } = data;

  const healthier = counties.filter(c => (c.userVsCountyDelta ?? 0) < -5).length;
  const tracking = counties.filter(c => Math.abs(c.userVsCountyDelta ?? 0) <= 5).length;
  const concern = counties.filter(c => (c.userVsCountyDelta ?? 0) > 5).length;

  const sorted = useMemo(() => {
    return [...counties].sort((a, b) => {
      if (sortBy === 'performance') return (a.userVsCountyDelta ?? 0) - (b.userVsCountyDelta ?? 0);
      if (sortBy === 'wells') return b.userWellCount - a.userWellCount;
      return a.county.localeCompare(b.county);
    });
  }, [counties, sortBy]);

  const exportCsv = useCallback(() => {
    const header = 'County,Your Wells,Your Idle Wells,Your Idle Rate %,County Idle Rate %,Delta vs County,County Total Wells,County Idle Wells';
    const rows = sorted.map(c => [
      c.county,
      c.userWellCount,
      c.userIdleWells,
      c.userIdleRate.toFixed(1),
      c.idleRate.toFixed(1),
      c.userVsCountyDelta != null ? c.userVsCountyDelta.toFixed(1) : '',
      c.totalWells,
      c.idleWells,
    ].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shut-in-markets-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  }, [sorted, toast]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: SLATE }}>
          How your idle rates compare to county averages
        </div>
        <button onClick={exportCsv} style={exportBtnStyle}>Export CSV</button>
      </div>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {healthier > 0 && <Badge bg="#dcfce7" color="#166534" size="sm">{healthier} healthier</Badge>}
        {tracking > 0 && <Badge bg="#f0f9ff" color="#1e40af" size="sm">{tracking} tracking</Badge>}
        {concern > 0 && <Badge bg="#fee2e2" color="#991b1b" size="sm">{concern} concern</Badge>}
      </div>

      {/* Sort controls */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['performance', 'wells', 'name'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            style={{
              padding: '4px 12px', fontSize: 12, fontWeight: sortBy === s ? 600 : 400,
              border: `1px solid ${sortBy === s ? '#3b82f6' : BORDER}`,
              borderRadius: 6, background: sortBy === s ? '#eff6ff' : '#fff',
              color: sortBy === s ? '#1d4ed8' : SLATE, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {s === 'performance' ? 'Performance' : s === 'wells' ? 'Well Count' : 'Name'}
          </button>
        ))}
      </div>

      {/* County cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {sorted.map(c => <MarketCountyCard key={c.county} county={c} />)}
      </div>

      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 16 }}>
        Idle = no production in 3+ months based on OTC data
      </div>
    </div>
  );
}

function MarketCountyCard({ county: c }: { county: ShutInMarketCounty }) {
  const delta = c.userVsCountyDelta ?? 0;
  const color = delta > 5 ? '#dc2626' : delta < -5 ? '#16a34a' : SLATE;
  const icon = delta > 5 ? '▲' : delta < -5 ? '▼' : '≈';
  const text = delta > 5 ? `Concern: ${delta.toFixed(1)}% higher idle rate`
    : delta < -5 ? `Healthier: ${Math.abs(delta).toFixed(1)}% lower idle rate`
    : 'Tracking county idle rate';

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK }}>{c.county}</span>
        <span style={{ fontSize: 12, color: SLATE }}>{c.userWellCount} wells</span>
      </div>

      {/* Delta indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13, color }}>
        <span>{icon}</span><span>{text}</span>
      </div>

      {/* Rates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
        <div>
          <div style={{ color: SLATE, marginBottom: 2 }}>Your Idle Rate</div>
          <div style={{ fontWeight: 600, color: TEXT_DARK, fontFamily: 'monospace' }}>
            {c.userIdleRate.toFixed(1)}% <span style={{ fontWeight: 400, color: SLATE }}>({c.userIdleWells}/{c.userWellCount})</span>
          </div>
        </div>
        <div>
          <div style={{ color: SLATE, marginBottom: 2 }}>County Idle Rate</div>
          <div style={{ fontWeight: 600, color: TEXT_DARK, fontFamily: 'monospace' }}>
            {c.idleRate.toFixed(1)}% <span style={{ fontWeight: 400, color: SLATE }}>({c.idleWells}/{c.totalWells})</span>
          </div>
        </div>
      </div>

      {/* Top operators by idle wells */}
      {c.topOperators.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: SLATE, marginBottom: 6 }}>Top Operators by Idle Wells</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {c.topOperators.slice(0, 5).map((op, i) => {
              const opColor = op.idleRate > 60 ? '#dc2626' : op.idleRate > 40 ? '#f59e0b' : '#16a34a';
              const opBg = op.idleRate > 60 ? '#fee2e2' : op.idleRate > 40 ? '#fef3c7' : '#dcfce7';
              return (
                <span key={i} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  background: opBg, color: opColor, fontWeight: 500,
                }}>
                  <OperatorLink name={op.operator} fontSize={11} fontWeight={500} style={{ color: opColor }} /> {op.idleWells}/{op.totalWells} ({Math.round(op.idleRate)}%)
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Research Tab ───

function ResearchTab({ data }: { data: ShutInResearchData }) {
  const toast = useToast();
  const [view, setView] = useState<'byCount' | 'byRate' | 'counties'>('byCount');
  const [countySort, setCountySort] = useState<'rate' | 'count' | 'name'>('rate');

  const { summary: s } = data;

  const exportCsv = useCallback(() => {
    const lines: string[] = [];
    // Operators by count
    lines.push('--- Most Idle Wells ---');
    lines.push('Operator,Total Wells,Idle Wells,Recently Idle,Idle Rate %');
    data.operatorsByCount.forEach(op => {
      lines.push(`"${op.operator}",${op.totalWells},${op.idleWells},${op.recentlyIdle},${op.idleRatePct.toFixed(1)}`);
    });
    lines.push('');
    // Operators by rate
    lines.push('--- Highest Idle Rate ---');
    lines.push('Operator,Total Wells,Idle Wells,Recently Idle,Idle Rate %');
    data.operatorsByRate.forEach(op => {
      lines.push(`"${op.operator}",${op.totalWells},${op.idleWells},${op.recentlyIdle},${op.idleRatePct.toFixed(1)}`);
    });
    lines.push('');
    // Counties
    lines.push('--- County Idle Rates ---');
    lines.push('County,Total Wells,Idle Wells,Idle Rate %,Top Idle Operator');
    data.counties.forEach(c => {
      const county = c.county.includes('-') ? c.county.split('-').slice(1).join('-') : c.county;
      lines.push(`"${county}",${c.totalWells},${c.idleWells},${c.idleRatePct.toFixed(1)},"${c.topIdleOperator || ''}"`);
    });

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shut-in-research-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  }, [data, toast]);

  const sortedCounties = useMemo(() => {
    return [...data.counties].sort((a, b) => {
      if (countySort === 'rate') return b.idleRatePct - a.idleRatePct;
      if (countySort === 'count') return b.idleWells - a.idleWells;
      return a.county.localeCompare(b.county);
    });
  }, [data.counties, countySort]);

  return (
    <div>
      {/* HUD Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <HudCard
          value={`${s.idleRatePct.toFixed(1)}%`}
          valueColor={idleRateColor(s.idleRatePct)}
          label="Statewide Idle Rate"
          detail={`${s.idlePuns.toLocaleString()} of ${s.totalPuns.toLocaleString()} PUNs idle (3+ months)`}
        />
        <HudCard
          value={s.newlyIdle6mo.toLocaleString()}
          valueColor="#f59e0b"
          label="Recently Gone Idle"
          detail={`Went idle within 6 months of ${formatMonth(s.dataHorizon)}`}
        />
        <HudCard
          value={s.longTermIdle.toLocaleString()}
          valueColor="#94a3b8"
          label="Long-Term Idle"
          detail="No production for 12+ months"
        />
      </div>

      {/* Data footnote */}
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>
        Data as of {formatMonth(s.dataHorizon)}. Of {s.totalPuns.toLocaleString()} total wells tracked, {s.unassignedWells.toLocaleString()} have no assigned operator.
      </div>

      {/* Toolbar: view toggle + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 0, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          {([
            { key: 'byCount', label: 'Most Idle Wells' },
            { key: 'byRate', label: 'Highest Idle Rate' },
            { key: 'counties', label: 'County Idle Rates' },
          ] as const).map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: view === v.key ? 600 : 400,
                border: 'none', borderRight: `1px solid ${BORDER}`,
                background: view === v.key ? '#eff6ff' : '#fff',
                color: view === v.key ? '#1d4ed8' : SLATE,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button onClick={exportCsv} style={exportBtnStyle}>Export CSV</button>
      </div>

      {/* View content */}
      {view === 'byCount' && <OperatorTable operators={data.operatorsByCount} />}
      {view === 'byRate' && <OperatorTable operators={data.operatorsByRate} />}
      {view === 'counties' && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['rate', 'count', 'name'] as const).map(s => (
              <button
                key={s}
                onClick={() => setCountySort(s)}
                style={{
                  padding: '4px 12px', fontSize: 12, fontWeight: countySort === s ? 600 : 400,
                  border: `1px solid ${countySort === s ? '#3b82f6' : BORDER}`,
                  borderRadius: 6, background: countySort === s ? '#eff6ff' : '#fff',
                  color: countySort === s ? '#1d4ed8' : SLATE, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {s === 'rate' ? 'Idle Rate' : s === 'count' ? 'Well Count' : 'Name'}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {sortedCounties.map(c => <ResearchCountyCard key={c.county} county={c} />)}
          </div>
        </>
      )}
    </div>
  );
}

function HudCard({ value, valueColor, label, detail }: { value: string; valueColor: string; label: string; detail: string }) {
  return (
    <div style={{
      padding: '14px 16px', background: '#fff', borderRadius: 8,
      border: `1px solid ${BORDER}`,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: valueColor, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: SLATE }}>{detail}</div>
    </div>
  );
}

function OperatorTable({ operators }: { operators: ShutInResearchOperator[] }) {
  const columns: Column<ShutInResearchOperator>[] = useMemo(() => [
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: '28%',
      render: (row) => <OperatorLink name={row.operator} fontSize={13} />,
    },
    {
      key: 'totalWells', label: 'Total', sortType: 'number', width: '12%',
      render: (row) => <span style={{ fontFamily: 'monospace' }}>{row.totalWells.toLocaleString()}</span>,
    },
    {
      key: 'idleWells', label: 'Idle', sortType: 'number', width: '12%',
      render: (row) => <span style={{ fontFamily: 'monospace' }}>{row.idleWells.toLocaleString()}</span>,
    },
    {
      key: 'recentlyIdle', label: 'Recently Idle', sortType: 'number', width: '12%',
      render: (row) => <span style={{ fontFamily: 'monospace' }}>{row.recentlyIdle.toLocaleString()}</span>,
    },
    {
      key: '_trend', label: 'Trend', width: '16%',
      getValue: (row) => row.idleWells > 0 ? row.recentlyIdle / row.idleWells : 0,
      render: (row) => {
        if (row.idleWells === 0) return <span style={{ color: SLATE }}>—</span>;
        const ratio = row.recentlyIdle / row.idleWells;
        if (ratio >= 0.3) return <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 12 }}>↑ {row.recentlyIdle} new</span>;
        if (ratio >= 0.15) return <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: 12 }}>↗ {row.recentlyIdle} new</span>;
        return <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 12 }}>→ Stable</span>;
      },
    },
    {
      key: 'idleRatePct', label: 'Idle Rate', sortType: 'number', width: '20%',
      render: (row) => {
        const color = idleRateColor(row.idleRatePct);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 60, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(row.idleRatePct, 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 12, color, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>
              {row.idleRatePct.toFixed(1)}%
            </span>
          </div>
        );
      },
    },
  ], []);

  return (
    <SortableTable
      columns={columns}
      data={operators}
      defaultSort={{ key: 'idleWells', dir: 'desc' }}
      rowKey={(row) => row.operator + (row.operatorNumber || '')}
      emptyMessage="No operator data available"
    />
  );
}

function ResearchCountyCard({ county: c }: { county: ShutInResearchCounty }) {
  const countyName = c.county.includes('-') ? c.county.split('-').slice(1).join('-') : c.county;
  const activePct = c.totalWells > 0 ? ((c.totalWells - c.idleWells) / c.totalWells) * 100 : 0;
  const idlePct = c.totalWells > 0 ? (c.idleWells / c.totalWells) * 100 : 0;
  const rateColor = idleRateColor(c.idleRatePct);

  return (
    <div style={{
      padding: 14, background: '#fff', borderRadius: 8,
      border: `1px solid ${BORDER}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>{countyName}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: rateColor }}>{c.idleRatePct.toFixed(1)}%</span>
      </div>

      {/* Stacked bar */}
      <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ width: `${activePct}%`, background: '#16a34a', borderRadius: '4px 0 0 4px' }} />
          <div style={{ width: `${idlePct}%`, background: rateColor }} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: SLATE, marginBottom: 4 }}>
        {c.idleWells.toLocaleString()} idle of {c.totalWells.toLocaleString()} wells
      </div>
      {c.topIdleOperator && (
        <div style={{ fontSize: 11, color: SLATE }}>
          Top idle: <OperatorLink name={c.topIdleOperator} fontSize={11} fontWeight={500} />
        </div>
      )}
    </div>
  );
}

// ─── Shared Styles ───

const selectStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13, border: `1px solid ${BORDER}`,
  borderRadius: 6, background: '#fff', color: TEXT_DARK, fontFamily: 'inherit',
  cursor: 'pointer',
};

const exportBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600,
  border: `1px solid ${BORDER}`, borderRadius: 6, background: '#fff',
  color: TEXT_DARK, cursor: 'pointer', fontFamily: 'inherit',
};
