import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchShutInDetector, fetchShutInMarkets } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { DonutChart } from '../DonutChart';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { IntelligenceTier, ShutInWell, ShutInOperatorPattern } from '../../../types/intelligence';

interface Props {
  tier: IntelligenceTier;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatMonth(yyyymm: string | null): string {
  if (!yyyymm || yyyymm.length < 6) return yyyymm || '—';
  const month = parseInt(yyyymm.substring(4, 6), 10);
  return MONTH_ABBR[month - 1] + " '" + yyyymm.substring(2, 4);
}

function idleStatusBadge(months: number | null) {
  if (months == null || months >= 999) return <Badge bg="#f3f4f6" color="#374151" size="sm">Unknown</Badge>;
  if (months < 6) return <Badge bg="#fef3c7" color="#92400e" size="sm">Idle 3-6mo</Badge>;
  if (months < 12) return <Badge bg="#fed7aa" color="#9a3412" size="sm">Extended 6-12mo</Badge>;
  return <Badge bg="#fee2e2" color="#991b1b" size="sm">Long-Term 12+mo</Badge>;
}

export function ShutInDetectorReport({ tier }: Props) {
  const [activeTab, setActiveTab] = useState('overview');
  const { data, loading, error, refetch } = useReportData(fetchShutInDetector);
  const { data: marketsData, loading: marketsLoading } = useReportData(fetchShutInMarkets, { enabled: activeTab === 'markets' });

  if (loading) return <LoadingSkeleton columns={5} rows={6} />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { summary: s, operatorPatterns, idleWells } = data;
  const tabs = [
    { key: 'overview', label: 'Overview', badge: s.idleWells },
    { key: 'wells', label: 'Idle Wells', badge: idleWells.length },
    { key: 'markets', label: 'My Markets' },
  ];

  return (
    <div>
      {/* HUD */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { value: String(s.totalWells), label: 'Total Wells', detail: `${s.idleWells} idle` },
          { value: String(s.recentlyIdle), label: 'Recently Idle', detail: '3-5 months' },
          { value: String(s.hbpRiskWells), label: 'HBP Risk', detail: 'Near expiration' },
          { value: String(s.suddenStopWells), label: 'Sudden Stops', detail: 'Recent decline' },
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

      {activeTab === 'overview' && <OverviewTab idleWells={idleWells} operatorPatterns={operatorPatterns} summary={s} />}
      {activeTab === 'wells' && <WellsTab wells={idleWells} />}
      {activeTab === 'markets' && (
        marketsLoading ? <LoadingSkeleton columns={4} rows={5} />
        : <MarketsTabContent data={marketsData} />
      )}
    </div>
  );
}

function OverviewTab({ idleWells, operatorPatterns, summary }: {
  idleWells: ShutInWell[];
  operatorPatterns: ShutInOperatorPattern[];
  summary: { idleWells: number; hbpRiskWells: number };
}) {
  // Donut segments
  const idle3to6 = idleWells.filter(w => w.monthsSinceProduction != null && w.monthsSinceProduction < 6).length;
  const idle6to12 = idleWells.filter(w => w.monthsSinceProduction != null && w.monthsSinceProduction >= 6 && w.monthsSinceProduction < 12).length;
  const idle12plus = idleWells.filter(w => w.monthsSinceProduction != null && w.monthsSinceProduction >= 12).length;
  const unknown = idleWells.length - idle3to6 - idle6to12 - idle12plus;

  const segments = [
    { label: 'Idle (3-6 mo)', value: idle3to6, color: '#f59e0b' },
    { label: 'Extended (6-12 mo)', value: idle6to12, color: '#ea580c' },
    { label: 'Long-Term (12+ mo)', value: idle12plus, color: '#dc2626' },
    ...(unknown > 0 ? [{ label: 'Unknown', value: unknown, color: '#94a3b8' }] : []),
  ];

  return (
    <div>
      {/* Donut + legend */}
      <div style={{
        padding: 20, background: '#fff', borderRadius: 8,
        border: `1px solid ${BORDER}`, marginBottom: 20,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <DonutChart
          segments={segments}
          centerValue={summary.idleWells}
          centerLabel="idle wells"
          size={160}
        />
        {summary.hbpRiskWells > 0 && (
          <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
            {summary.hbpRiskWells} well{summary.hbpRiskWells !== 1 ? 's' : ''} flagged for potential HBP risk
          </div>
        )}
      </div>

      {/* Operator patterns */}
      {operatorPatterns.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Operator Patterns</h3>
          <OperatorPatternsTable patterns={operatorPatterns} />
        </div>
      )}
    </div>
  );
}

function OperatorPatternsTable({ patterns }: { patterns: ShutInOperatorPattern[] }) {
  const columns: Column<ShutInOperatorPattern>[] = useMemo(() => [
    { key: 'operator', label: 'Operator', sortType: 'string', width: 200 },
    { key: 'wellCount', label: 'Wells', sortType: 'number', width: 70 },
    { key: 'idleCount', label: 'Idle', sortType: 'number', width: 70 },
    {
      key: 'idleRate', label: 'Idle Rate', sortType: 'number', width: 100,
      render: (row) => {
        const pct = Math.round(row.idleRate * 100);
        const color = pct > 60 ? '#dc2626' : pct > 40 ? '#f59e0b' : '#16a34a';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 12, color, fontWeight: 600, width: 36, textAlign: 'right' }}>{pct}%</span>
          </div>
        );
      },
    },
    {
      key: 'flag', label: 'Flag', sortType: 'number', width: 60,
      getValue: (row) => row.flag ? 1 : 0,
      render: (row) => row.flag ? <Badge bg="#fee2e2" color="#991b1b" size="sm">!</Badge> : null,
    },
  ], []);

  return (
    <SortableTable
      columns={columns}
      data={patterns}
      defaultSort={{ key: 'idleRate', dir: 'desc' }}
      rowKey={(row) => row.operator}
    />
  );
}

function WellsTab({ wells }: { wells: ShutInWell[] }) {
  const columns: Column<ShutInWell>[] = useMemo(() => [
    {
      key: 'wellName', label: 'Well', sortType: 'string', width: 180,
      render: (row) => <span style={{ fontWeight: 500 }}>{row.wellName}</span>,
    },
    { key: 'operator', label: 'Operator', sortType: 'string', width: 130 },
    { key: 'county', label: 'County', sortType: 'string', width: 100 },
    {
      key: 'monthsSinceProduction', label: 'Mo. Idle', sortType: 'number', width: 80,
      render: (row) => <span>{row.monthsSinceProduction != null && row.monthsSinceProduction < 999 ? row.monthsSinceProduction : '—'}</span>,
    },
    {
      key: '_status', label: 'Status', width: 120,
      getValue: (row) => row.monthsSinceProduction,
      render: (row) => idleStatusBadge(row.monthsSinceProduction),
    },
    {
      key: 'lastProdMonth', label: 'Last Prod', sortType: 'string', width: 80,
      render: (row) => <span style={{ fontSize: 12, color: SLATE }}>{formatMonth(row.lastProdMonth)}</span>,
    },
    {
      key: '_flags', label: 'Risk Flags', width: 160,
      getValue: (row) => (row.hbpExpiredFlag ? 3 : 0) + (row.suddenStopFlag ? 2 : 0) + (row.flaggedOperatorFlag ? 1 : 0),
      render: (row) => {
        const flags: React.ReactNode[] = [];
        if (row.hbpExpiredFlag) flags.push(<Badge key="hbp" bg="#fee2e2" color="#991b1b" size="sm">HBP Risk</Badge>);
        if (row.suddenStopFlag) flags.push(<Badge key="stop" bg="#fed7aa" color="#9a3412" size="sm">Sudden Stop</Badge>);
        if (row.flaggedOperatorFlag) flags.push(<Badge key="op" bg="#dbeafe" color="#1e40af" size="sm">Op Pattern</Badge>);
        if (flags.length === 0) return <span style={{ color: SLATE }}>—</span>;
        return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{flags}</div>;
      },
    },
  ], []);

  return (
    <SortableTable
      columns={columns}
      data={wells}
      defaultSort={{ key: 'monthsSinceProduction', dir: 'desc' }}
      rowKey={(row) => row.apiNumber}
      emptyMessage="No idle wells detected"
    />
  );
}

interface ShutInCountyMarket {
  county: string;
  userIdleRate?: number;
  countyIdleRate?: number;
  userWellCount?: number;
  totalWells?: number;
}

function MarketsTabContent({ data }: { data: { counties?: ShutInCountyMarket[] } | null }) {
  if (!data || !data.counties || data.counties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No county benchmark data available.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {data.counties.map((c) => {
        const userRate = c.userIdleRate ?? 0;
        const countyRate = c.countyIdleRate ?? 0;
        const delta = userRate - countyRate;
        const color = delta > 5 ? '#dc2626' : delta < -5 ? '#16a34a' : SLATE;
        const icon = delta > 5 ? '▲' : delta < -5 ? '▼' : '≈';
        const text = delta > 5 ? `Concern: ${delta.toFixed(1)}% higher idle rate`
          : delta < -5 ? `Healthier: ${Math.abs(delta).toFixed(1)}% lower idle rate`
          : 'Tracking county idle rate';

        return (
          <div key={c.county} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, marginBottom: 8 }}>{c.county}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 13, color }}>
              <span>{icon}</span><span>{text}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div>
                <div style={{ color: SLATE, marginBottom: 2 }}>Your Idle Rate</div>
                <div style={{ fontWeight: 600, color: TEXT_DARK }}>{userRate.toFixed(1)}%</div>
              </div>
              <div>
                <div style={{ color: SLATE, marginBottom: 2 }}>County Idle Rate</div>
                <div style={{ fontWeight: 600, color: TEXT_DARK }}>{countyRate.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
