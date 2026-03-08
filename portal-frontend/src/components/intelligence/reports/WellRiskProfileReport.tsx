import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchWellRiskProfile } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { DonutChart } from '../DonutChart';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import { OperatorLink } from '../../ui/OperatorLink';
import type { Column } from '../SortableTable';
import type { RiskProfileWell } from '../../../types/intelligence';

const RISK_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  comfortable: { bg: '#dcfce7', color: '#166534', label: 'Comfortable' },
  adequate: { bg: '#dbeafe', color: '#1e40af', label: 'Adequate' },
  tight: { bg: '#fef3c7', color: '#92400e', label: 'Tight' },
  at_risk: { bg: '#fee2e2', color: '#991b1b', label: 'At Risk' },
};

const SOURCE_LABELS: Record<string, { bg: string; color: string; label: string }> = {
  check_stub: { bg: '#dcfce7', color: '#166534', label: 'Stub' },
  operator_profile: { bg: '#dbeafe', color: '#1e40af', label: 'Op' },
  otc: { bg: '#f3f4f6', color: '#374151', label: 'OTC' },
  county_avg: { bg: '#f5f3ff', color: '#6d28d9', label: 'Cty' },
  default: { bg: '#f3f4f6', color: '#374151', label: 'Est' },
};

function riskBadge(level: string) {
  const r = RISK_COLORS[level] || RISK_COLORS.adequate;
  return <Badge bg={r.bg} color={r.color} size="sm">{r.label}</Badge>;
}

function sourceBadge(source: string) {
  const s = SOURCE_LABELS[source] || SOURCE_LABELS.default;
  return <Badge bg={s.bg} color={s.color} size="sm">{s.label}</Badge>;
}

function formatPrice(v: number | null): string {
  if (v == null) return '—';
  return '$' + v.toFixed(2);
}

function formatPct(v: number | null): string {
  if (v == null) return '—';
  return v.toFixed(1) + '%';
}

export function WellRiskProfileReport() {
  const [activeTab, setActiveTab] = useState('overview');
  const { data, loading, error, refetch } = useReportData(fetchWellRiskProfile);

  if (loading) return <LoadingSkeleton columns={5} rows={6} label="Well Risk Profiles" />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { summary: s, wells, wtiPrice, henryHubPrice, byFormation } = data;
  const tabs = [
    { key: 'overview', label: 'Risk Overview', badge: wells.length },
    { key: 'formation', label: 'By Formation', badge: byFormation?.length },
  ];

  return (
    <div>
      {/* Price banner */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b, #334155)',
        borderRadius: 8, padding: '14px 20px', marginBottom: 16,
        display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>WTI Crude</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{formatPrice(wtiPrice?.price)}</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{wtiPrice?.source} — {wtiPrice?.date ? new Date(wtiPrice.date).toLocaleDateString() : ''}</div>
        </div>
        {henryHubPrice && (
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Henry Hub</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{formatPrice(henryHubPrice.price)}</div>
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Portfolio Net-Back</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{formatPrice(s.portfolioNetBack)}</div>
        </div>
      </div>

      {/* HUD — donut + stat boxes */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ padding: 16, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
          <DonutChart
            segments={[
              { label: 'Comfortable', value: s.comfortableCount, color: '#22c55e' },
              { label: 'Adequate', value: s.adequateCount, color: '#3b82f6' },
              { label: 'Tight', value: s.tightCount, color: '#f59e0b' },
              { label: 'At Risk', value: s.atRiskCount, color: '#ef4444' },
            ]}
            centerValue={s.totalWells}
            centerLabel="wells"
            size={140}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          {[
            { value: s.atRiskCount, label: 'At Risk', detail: 'Below breakeven', color: '#ef4444' },
            { value: s.tightCount, label: 'Tight', detail: '0-10% margin', color: '#f59e0b' },
            { value: s.adequateCount, label: 'Adequate', detail: '10-25% margin', color: '#3b82f6' },
            { value: s.comfortableCount, label: 'Comfortable', detail: '>25% margin', color: '#22c55e' },
          ].map((b, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 16px', background: BG_MUTED, borderRadius: 8,
              border: `1px solid ${BORDER}`,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
              <span style={{ fontSize: 18, fontWeight: 700, color: TEXT_DARK, width: 30 }}>{b.value}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK }}>{b.label}</div>
                <div style={{ fontSize: 11, color: SLATE }}>{b.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Deduction data coverage note */}
      {s.wellsWithDeductionData < s.totalWells && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 16,
          background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 13, color: '#1e40af',
        }}>
          {s.wellsWithDeductionData} of {s.totalWells} wells have deduction data from check stubs or operator profiles.
          Upload revenue statements for more accurate risk assessment.
        </div>
      )}

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' && <OverviewTab wells={wells} wtiPrice={wtiPrice?.price} />}
      {activeTab === 'formation' && <FormationTab formations={byFormation} />}
    </div>
  );
}

// Map risk levels to numeric order: comfortable(best)=0 → at_risk(worst)=3
const RISK_ORDER: Record<string, number> = { comfortable: 0, adequate: 1, tight: 2, at_risk: 3 };

function OverviewTab({ wells, wtiPrice }: { wells: RiskProfileWell[]; wtiPrice?: number }) {
  const exportCsv = () => {
    const headers = ['Well', 'API Number', 'Operator', 'Formation', 'Breakeven', 'Deductions %', 'Deduction Source', 'Deduction Detail', 'Net-Back', 'Risk Level', 'Stressed At', 'Critical At'];
    const rows = wells.map(w => [
      `"${(w.wellName || '').replace(/"/g, '""')}"`,
      w.apiNumber || '', `"${(w.operator || '').replace(/"/g, '""')}"`,
      w.formationGroup || '', w.halfCycleBreakeven ?? '',
      w.totalDiscountPct ?? '', w.deductionSource || '',
      `"${(w.deductionSourceDetail || '').replace(/"/g, '""')}"`,
      w.netBackPrice ?? '', w.riskLevel || '',
      w.stressedAtWti ?? '', w.criticalAtWti ?? '',
    ].join(','));
    const csv = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'well-risk-profiles.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<RiskProfileWell>[] = useMemo(() => [
    {
      key: 'wellName', label: 'Well', sortType: 'string', width: 'minmax(100px, 1.5fr)',
      render: (row) => <span style={{ fontWeight: 500 }}>{row.wellName}</span>,
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: 'minmax(90px, 1.2fr)',
      render: (row) => <OperatorLink name={row.operator} fontSize={13} />,
    },
    {
      key: 'formationGroup', label: 'Formation', sortType: 'string', width: 'minmax(80px, 1fr)',
      render: (row) => <span style={{ fontSize: 12 }}>{row.formationGroup || '—'}</span>,
    },
    {
      key: 'halfCycleBreakeven', label: 'Breakeven', sortType: 'number', width: 'minmax(70px, 0.8fr)',
      render: (row) => <span style={{ fontSize: 12, fontWeight: 600 }}>{formatPrice(row.halfCycleBreakeven)}</span>,
    },
    {
      key: 'totalDiscountPct', label: 'Deductions', sortType: 'number', width: 'minmax(90px, 1fr)',
      render: (row) => {
        const isStub = row.deductionSource === 'check_stub';
        const isEstimate = row.deductionSource === 'county_avg' || row.deductionSource === 'default' || row.deductionSource === 'otc';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={row.deductionSourceDetail || undefined}>
            <span style={{
              fontSize: 12, fontWeight: isStub ? 700 : 400,
              fontStyle: isEstimate ? 'italic' : 'normal',
              color: TEXT_DARK,
            }}>
              {formatPct(row.totalDiscountPct)}
            </span>
            {sourceBadge(row.deductionSource)}
          </div>
        );
      },
    },
    {
      key: 'netBackPrice', label: 'Net-Back', sortType: 'number', width: 'minmax(70px, 0.8fr)',
      render: (row) => <span style={{ fontSize: 12, fontWeight: 600, color: row.riskLevel === 'at_risk' ? '#ef4444' : TEXT_DARK }}>{formatPrice(row.netBackPrice)}</span>,
    },
    {
      key: 'riskLevel', label: 'Status', width: 'minmax(80px, 0.9fr)',
      getValue: (row) => RISK_ORDER[row.riskLevel] ?? 2,
      render: (row) => riskBadge(row.riskLevel),
    },
    {
      key: 'stressedAtWti', label: 'Stressed At', sortType: 'number', width: 'minmax(70px, 0.8fr)',
      render: (row) => {
        if (row.stressedAtWti == null) return <span style={{ color: SLATE }}>—</span>;
        const isNear = wtiPrice && row.stressedAtWti >= wtiPrice - 15;
        return <span style={{ fontSize: 12, color: isNear ? '#ef4444' : SLATE, fontWeight: isNear ? 600 : 400 }}>{formatPrice(row.stressedAtWti)}</span>;
      },
    },
    {
      key: 'criticalAtWti', label: 'Critical At', sortType: 'number', width: 'minmax(70px, 0.8fr)',
      render: (row) => {
        if (row.criticalAtWti == null) return <span style={{ color: SLATE }}>—</span>;
        const isNear = wtiPrice && row.criticalAtWti >= wtiPrice - 10;
        return <span style={{ fontSize: 12, color: isNear ? '#ef4444' : SLATE, fontWeight: isNear ? 600 : 400 }}>{formatPrice(row.criticalAtWti)}</span>;
      },
    },
  ], [wtiPrice]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={exportCsv} style={{
          padding: '6px 14px', border: `1px solid ${BORDER}`, borderRadius: 6,
          fontSize: 13, cursor: 'pointer', background: '#fff', color: TEXT_DARK, fontFamily: 'inherit',
        }}>Export CSV</button>
      </div>
      <SortableTable
        columns={columns}
        data={wells}
        defaultSort={{ key: 'riskLevel', dir: 'desc' }}
        rowKey={(row) => row.clientWellId || row.apiNumber}
        emptyMessage="No wells to analyze"
      />
    </div>
  );
}

function FormationTab({ formations }: { formations: Array<{ formationGroup: string; wellCount: number; avgBreakeven: number | null; profileDistribution: Record<string, number>; atRiskCount: number }> | undefined }) {
  if (!formations || formations.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No formation data available.</div>;
  }

  const exportCsv = () => {
    const headers = ['Formation', 'Wells', 'Avg Breakeven', 'At Risk', 'Profile Distribution'];
    const rows = formations.map(f => [
      `"${(f.formationGroup || 'Unknown').replace(/"/g, '""')}"`,
      f.wellCount, f.avgBreakeven != null ? f.avgBreakeven.toFixed(2) : '',
      f.atRiskCount,
      `"${Object.entries(f.profileDistribution || {}).map(([k, v]) => `${k.replace(/-/g, ' ')}: ${v}`).join('; ')}"`,
    ].join(','));
    const csv = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'well-risk-by-formation.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const profileColors: Record<string, string> = {
    'scoop-stack-hz': '#3b82f6',
    'other-hz': '#8b5cf6',
    'deep-conventional': '#f59e0b',
    'conventional-vert': '#22c55e',
    'unknown-formation': '#94a3b8',
    'gas-weighted': '#06b6d4',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={exportCsv} style={{
          padding: '6px 14px', border: `1px solid ${BORDER}`, borderRadius: 6,
          fontSize: 13, cursor: 'pointer', background: '#fff', color: TEXT_DARK, fontFamily: 'inherit',
        }}>Export CSV</button>
      </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {formations.map((f) => {
        const total = f.wellCount || 1;
        const distEntries = Object.entries(f.profileDistribution || {});

        return (
          <div key={f.formationGroup} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK }}>{f.formationGroup || 'Unknown'}</span>
              <span style={{ fontSize: 12, color: SLATE }}>{f.wellCount} wells</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 10 }}>
              <div>
                <div style={{ color: SLATE, marginBottom: 2 }}>Avg Breakeven</div>
                <div style={{ fontWeight: 600, color: TEXT_DARK }}>{f.avgBreakeven != null ? formatPrice(f.avgBreakeven) : '—'}</div>
              </div>
              <div>
                <div style={{ color: SLATE, marginBottom: 2 }}>At Risk</div>
                <div style={{ fontWeight: 600, color: f.atRiskCount > 0 ? '#ef4444' : TEXT_DARK }}>{f.atRiskCount}</div>
              </div>
            </div>
            {/* Profile distribution bar */}
            {distEntries.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Profile Distribution</div>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9' }}>
                  {distEntries.map(([id, count]) => (
                    <div key={id} style={{
                      width: `${(count / total) * 100}%`,
                      background: profileColors[id] || '#94a3b8',
                      transition: 'width 0.3s',
                    }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {distEntries.map(([id, count]) => (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: profileColors[id] || '#94a3b8' }} />
                      <span style={{ color: SLATE }}>{id.replace(/-/g, ' ')} ({count})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
