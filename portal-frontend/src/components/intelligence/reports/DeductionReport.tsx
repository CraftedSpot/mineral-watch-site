import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchDeductionReport, fetchOperatorComparison, fetchDeductionResearch } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type {
  IntelligenceTier,
  DeductionReportData,
  DeductionWell,
  OperatorComparisonData,
  OperatorComparisonEntry,
  DeductionResearchData,
} from '../../../types/intelligence';

interface Props {
  tier: IntelligenceTier;
  initialTab?: string;
}

const PRODUCT_NAMES: Record<string, string> = {
  '1': 'Oil', '3': 'NGL / Condensate', '5': 'Residue Gas', '6': 'Casinghead Gas',
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatMonth(yyyymm: string): string {
  if (!yyyymm || yyyymm.length < 6) return yyyymm || '';
  const month = parseInt(yyyymm.substring(4, 6), 10);
  return MONTH_ABBR[month - 1] + ' ' + yyyymm.substring(0, 4);
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return '$' + Math.round(amount).toLocaleString('en-US');
}

function cleanCounty(county: string): string {
  return (county || '').replace(/^\d{3}-/, '');
}

function getPcrrMetrics(well: DeductionWell) {
  const prod5 = well.products.find(p => p.product_code === '5');
  const prod6 = well.products.find(p => p.product_code === '6');
  const residue = prod5 ? prod5.market_deduction : 0;
  const ngl = prod6 ? prod6.gross_value : 0;
  const netReturn = ngl - residue;
  const pcrr = residue > 0 ? Math.round((ngl / residue) * 1000) / 10 : null;
  return { residue, ngl, netReturn, pcrr };
}

function deductionColor(pct: number): string {
  if (pct >= 50) return '#dc2626';
  if (pct >= 25) return '#f59e0b';
  return TEXT_DARK;
}

export function DeductionReport({ tier, initialTab }: Props) {
  const [activeTab, setActiveTab] = useState(initialTab || 'portfolio');
  const { data, loading, error, refetch } = useReportData(fetchDeductionReport);
  const { data: opData } = useReportData(fetchOperatorComparison, { enabled: tier === 'full' });
  const { data: researchData, loading: researchLoading } = useReportData(
    fetchDeductionResearch,
    { enabled: activeTab === 'research' }
  );

  if (loading) return <LoadingSkeleton columns={5} rows={6} />;

  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>
          {error || 'Could not load the deduction report.'}
        </p>
        <button onClick={refetch} style={{
          background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
          padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Retry
        </button>
      </div>
    );
  }

  const { flaggedWells, portfolio, statewide, summary } = data;
  const highCount = flaggedWells.filter(w => w.agg_deduction_pct > 50).length;

  const tabs = [
    { key: 'portfolio', label: 'My Portfolio', badge: summary.flagged_count || 0 },
    { key: 'markets', label: 'My Markets', badge: opData?.operators?.length ?? '—' },
    { key: 'research', label: 'Market Research' },
  ];

  return (
    <div>
      {/* HUD Metrics */}
      <HudMetrics portfolio={portfolio} statewide={statewide} summary={summary} highCount={highCount} />

      {/* Tabs */}
      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === 'portfolio' && (
        <PortfolioTab data={data} />
      )}
      {activeTab === 'markets' && (
        <MarketsTab data={opData} tier={tier} />
      )}
      {activeTab === 'research' && (
        <ResearchTab data={researchData} loading={researchLoading} />
      )}

      {/* Footer */}
      <div style={{ padding: '16px 0', fontSize: 12, color: SLATE, borderTop: `1px solid ${BORDER}`, marginTop: 24 }}>
        Data sourced from Oklahoma Tax Commission gross production reports.
        Analysis date: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  );
}

// ── HUD Metrics Bar ──

function HudMetrics({ portfolio, statewide, summary, highCount }: {
  portfolio: DeductionReportData['portfolio'];
  statewide: DeductionReportData['statewide'];
  summary: DeductionReportData['summary'];
  highCount: number;
}) {
  const statewideText = statewide?.avg_deduction_pct != null
    ? `vs ${statewide.avg_deduction_pct}% statewide` : 'Deduction rate';

  const badges = [
    { value: `${portfolio.avg_deduction_pct}%`, label: 'Portfolio Avg', detail: statewideText },
    { value: String(highCount), label: 'High (>50%)', detail: `${summary.flagged_count} total shown` },
    { value: String(portfolio.total_wells_analyzed), label: 'Wells Analyzed', detail: summary.analysis_period },
  ];

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      {badges.map((b, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', background: BG_MUTED, borderRadius: 8,
          border: `1px solid ${BORDER}`, flex: '1 1 180px',
        }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: TEXT_DARK }}>{b.value}</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK }}>{b.label}</div>
            <div style={{ fontSize: 11, color: SLATE }}>{b.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Portfolio Tab ──

function PortfolioTab({ data }: { data: DeductionReportData }) {
  const { flaggedWells, portfolio, statewide, summary } = data;

  if (flaggedWells.length === 0) {
    return (
      <div style={{ padding: 24, background: BG_MUTED, borderRadius: 8, border: `1px solid ${BORDER}` }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Summary</h3>
        <p style={{ fontSize: 13, color: SLATE, margin: 0, lineHeight: 1.6 }}>
          <strong>{portfolio.total_wells_analyzed} wells</strong> with OTC financial data were analyzed
          over the past {summary.analysis_period}. No wells exceeded the 25% aggregate deduction threshold.
          Your portfolio average is <strong>{portfolio.avg_deduction_pct}%</strong>
          {statewide?.avg_deduction_pct != null && ` (vs ${statewide.avg_deduction_pct}% statewide)`}.
        </p>
      </div>
    );
  }

  const columns: Column<DeductionWell>[] = useMemo(() => [
    {
      key: 'well_name', label: 'Well', sortType: 'string', width: 180,
      render: (row) => (
        <span style={{ fontWeight: 500 }}>
          {row.well_name}
          {row.lean_gas_expected && (
            <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4, padding: '1px 4px', background: '#f3f4f6', borderRadius: 3 }} title="Lean gas — high deductions expected">
              Expected
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: 140,
      render: (row) => <span title={row.operator}>{row.operator || '—'}</span>,
    },
    {
      key: 'agg_deduction_pct', label: 'Ded %', sortType: 'number', width: 80,
      render: (row) => (
        <span style={{ color: row.lean_gas_expected ? TEXT_DARK : deductionColor(row.agg_deduction_pct), fontWeight: 600 }}>
          {row.agg_deduction_pct}%
        </span>
      ),
    },
    {
      key: '_pcrr', label: 'PCRR %', sortType: 'number', width: 80,
      title: 'Post-Production Cost Recovery Ratio: NGL ÷ Deductions',
      getValue: (row) => getPcrrMetrics(row).pcrr,
      render: (row) => {
        const { pcrr } = getPcrrMetrics(row);
        if (pcrr == null) return <span style={{ color: SLATE }}>—</span>;
        const c = row.lean_gas_expected ? TEXT_DARK : pcrr >= 100 ? '#16a34a' : pcrr >= 30 ? TEXT_DARK : '#f59e0b';
        return <span style={{ color: c }}>{pcrr}%</span>;
      },
    },
    {
      key: '_net_return', label: 'Net Return', sortType: 'number', width: 100,
      getValue: (row) => getPcrrMetrics(row).netReturn,
      render: (row) => {
        const { netReturn } = getPcrrMetrics(row);
        const c = row.lean_gas_expected ? TEXT_DARK : netReturn >= 0 ? '#16a34a' : '#dc2626';
        return <span style={{ color: c }}>{formatCurrency(netReturn)}</span>;
      },
    },
    {
      key: 'variance_points', label: 'Variance', sortType: 'number', width: 85,
      title: 'Points above county average',
      render: (row) => {
        if (row.variance_points == null) return <span style={{ color: SLATE }}>—</span>;
        const c = row.lean_gas_expected ? TEXT_DARK : row.variance_points > 15 ? '#dc2626' : row.variance_points > 8 ? '#f59e0b' : TEXT_DARK;
        return <span style={{ color: c }}>+{row.variance_points} pts</span>;
      },
    },
    {
      key: 'county', label: 'County', sortType: 'string', width: 100,
      getValue: (row) => cleanCounty(row.county),
      render: (row) => <span>{cleanCounty(row.county)}</span>,
    },
    {
      key: 'county_avg_pct', label: 'County Avg', sortType: 'number', width: 90,
      render: (row) => <span>{row.county_avg_pct != null ? `${row.county_avg_pct}%` : '—'}</span>,
    },
    {
      key: 'total_gross', label: 'Total Gross', sortType: 'number', width: 100,
      render: (row) => <span>{formatCurrency(row.total_gross)}</span>,
    },
  ], []);

  const renderExpanded = (row: DeductionWell) => (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK, marginBottom: 8 }}>Product Breakdown</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {row.products.map((p) => (
          <div key={p.product_code} style={{
            padding: '8px 12px', background: '#fff', borderRadius: 6,
            border: `1px solid ${BORDER}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: SLATE, marginBottom: 4 }}>
              {PRODUCT_NAMES[p.product_code] || `Product ${p.product_code}`}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: SLATE }}>Gross</span>
              <span style={{ color: TEXT_DARK }}>{formatCurrency(p.gross_value)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: SLATE }}>Deductions</span>
              <span style={{ color: p.deduction_pct > 50 ? '#dc2626' : TEXT_DARK }}>{formatCurrency(p.market_deduction)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600 }}>
              <span style={{ color: SLATE }}>Rate</span>
              <span style={{ color: p.deduction_pct > 50 ? '#dc2626' : TEXT_DARK }}>{p.deduction_pct}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Monthly trend */}
      {row.monthly && row.monthly.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK, marginBottom: 8 }}>Monthly Trend</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {row.monthly.map((m) => (
              <div key={m.year_month} style={{
                padding: '4px 8px', background: '#fff', borderRadius: 4,
                border: `1px solid ${BORDER}`, fontSize: 11, textAlign: 'center',
              }}>
                <div style={{ color: SLATE }}>{formatMonth(m.year_month)}</div>
                <div style={{ color: deductionColor(m.deduction_pct), fontWeight: 600 }}>{m.deduction_pct}%</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div>
      {/* Summary card */}
      <div style={{ padding: 16, background: BG_MUTED, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 6px' }}>Summary</h3>
        <p style={{ fontSize: 13, color: SLATE, margin: 0, lineHeight: 1.6 }}>
          Based on analysis of <strong>{portfolio.total_wells_analyzed}</strong> wells,{' '}
          <strong>{summary.flagged_count}</strong> ha{summary.flagged_count !== 1 ? 've' : 's'} aggregate
          deductions above 25%. The highest rate is <strong>{summary.worst_deduction_pct}%</strong>.
          Portfolio average: <strong>{portfolio.avg_deduction_pct}%</strong>.
          {summary.latest_month && (
            <span style={{ color: SLATE }}> Data through {formatMonth(summary.latest_month)}.</span>
          )}
        </p>
      </div>

      {/* Flagged wells table */}
      <SortableTable
        columns={columns}
        data={flaggedWells}
        defaultSort={{ key: 'agg_deduction_pct', dir: 'desc' }}
        rowKey={(row) => row.api_number}
        expandable
        renderExpandedRow={renderExpanded}
      />
    </div>
  );
}

// ── Markets Tab ──

function formatCurrencyShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v < 0 ? '-' : '') + '$' + (abs / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (v < 0 ? '-' : '') + '$' + Math.round(abs / 1_000).toLocaleString() + 'K';
  return '$' + Math.round(v).toLocaleString();
}

function MarketsTab({ data, tier }: { data: OperatorComparisonData | null; tier: IntelligenceTier }) {
  if (tier !== 'full') {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: SLATE }}>
        <p style={{ fontSize: 14, marginBottom: 8 }}>Operator comparison requires a Business plan.</p>
        <a href="/pricing" style={{ color: '#3b82f6', fontSize: 14 }}>View Plans</a>
      </div>
    );
  }

  if (!data) return <LoadingSkeleton columns={4} rows={4} />;

  const { operators, statewide } = data;
  const criticalOps = operators.filter(op => op.deduction_ratio > 40 && op.your_wells > 20);
  const criticalNames = new Set(criticalOps.map(op => op.operator_name));

  const columns: Column<OperatorComparisonEntry>[] = [
    {
      key: 'operator_name', label: 'Operator', sortType: 'string', width: 'minmax(140px, 2fr)',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500 }}>{row.operator_name}</span>
          {criticalNames.has(row.operator_name) && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fef2f2', color: '#dc2626' }}>High Impact</span>
          )}
          {row.is_affiliated ? (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fef3c7', color: '#92400e' }}>Affiliated</span>
          ) : (
            <span style={{ fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3, background: '#f1f5f9', color: SLATE }}>Third Party</span>
          )}
        </span>
      ),
    },
    {
      key: 'your_wells', label: 'Your Wells', sortType: 'number', width: 85,
      render: (row) => <span style={{ fontWeight: row.your_wells > 0 ? 600 : 400 }}>{row.your_wells}</span>,
    },
    {
      key: 'total_wells', label: 'Total Wells', sortType: 'number', width: 85,
      render: (row) => <span>{row.total_wells}</span>,
    },
    {
      key: 'total_gross', label: 'Total Gross', sortType: 'number', width: 100,
      render: (row) => <span>{formatCurrency(row.total_gross)}</span>,
    },
    {
      key: 'residue_deductions', label: 'Deductions', sortType: 'number', width: 100,
      render: (row) => <span>{formatCurrency(row.residue_deductions)}</span>,
    },
    {
      key: 'deduction_ratio', label: 'Ded %', sortType: 'number', width: 75,
      render: (row) => {
        const v = row.deduction_ratio;
        if (v == null) return <span style={{ color: SLATE }}>—</span>;
        return <span style={{ color: deductionColor(v), fontWeight: 600 }}>{v.toFixed(1)}%</span>;
      },
    },
    {
      key: 'liquids_returned', label: 'NGL Returned', sortType: 'number', width: 100,
      render: (row) => <span>{formatCurrency(row.liquids_returned)}</span>,
    },
    {
      key: '_net_return', label: 'Net Return', sortType: 'number', width: 100,
      getValue: (row) => (row.liquids_returned || 0) - (row.residue_deductions || 0),
      render: (row) => {
        const net = (row.liquids_returned || 0) - (row.residue_deductions || 0);
        const color = net <= -5_000_000 ? '#ef4444' : net <= -1_000_000 ? '#f97316' : net >= 0 ? '#16a34a' : TEXT_DARK;
        return <span style={{ color, fontWeight: 600 }}>{formatCurrencyShort(net)}</span>;
      },
    },
    {
      key: '_pcrr', label: 'PCRR', sortType: 'number', width: 70,
      title: 'Post-Production Cost Recovery Ratio: NGL ÷ Deductions',
      getValue: (row) => row.residue_deductions > 0 ? Math.round((row.liquids_returned / row.residue_deductions) * 1000) / 10 : -Infinity,
      render: (row) => {
        const pcrr = row.residue_deductions > 0 ? Math.round((row.liquids_returned / row.residue_deductions) * 1000) / 10 : null;
        if (pcrr == null) return <span style={{ color: SLATE }}>—</span>;
        const color = pcrr >= 100 ? '#16a34a' : pcrr >= 30 ? TEXT_DARK : '#f59e0b';
        return <span style={{ color }}>{pcrr}%</span>;
      },
    },
    {
      key: 'gas_profile', label: 'Gas Profile', sortType: 'string', width: 90,
      render: (row) => {
        if (!row.gas_profile) return <span style={{ color: SLATE }}>Mixed</span>;
        const colors: Record<string, { bg: string; color: string; label: string }> = {
          lean: { bg: '#dbeafe', color: '#1e40af', label: 'Lean Gas' },
          rich: { bg: '#dcfce7', color: '#166534', label: 'Rich Gas' },
        };
        const c = colors[row.gas_profile] || { bg: '#f3f4f6', color: '#374151', label: 'Mixed' };
        return (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: c.bg, color: c.color }}>
            {c.label}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      {/* High-Impact Operator callout */}
      {criticalOps.length > 0 && (
        <div style={{
          padding: 16, marginBottom: 16, borderRadius: 8,
          background: '#fef2f2', borderLeft: '4px solid #dc2626',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#dc2626', margin: '0 0 8px' }}>
            High-Impact Operator{criticalOps.length > 1 ? 's' : ''} Detected
          </h3>
          <p style={{ fontSize: 13, color: TEXT_DARK, margin: 0, lineHeight: 1.7 }}>
            {criticalOps.map((op, i) => {
              const net = (op.liquids_returned || 0) - (op.residue_deductions || 0);
              const pcrr = op.residue_deductions > 0 ? Math.round((op.liquids_returned / op.residue_deductions) * 1000) / 10 : null;
              const aboveAvg = statewide?.deduction_ratio != null ? ` — significantly above the statewide average of ${statewide.deduction_ratio}%` : '';
              const dollarDetail = op.residue_deductions > 0
                ? `. Across all their wells, deductions totaled ${formatCurrencyShort(op.residue_deductions)} with ${formatCurrencyShort(op.liquids_returned)} in NGL returned${pcrr != null ? ` (${pcrr}% PCRR)` : ''}`
                : '';
              return (
                <span key={op.operator_number}>
                  {i > 0 && '. '}
                  <strong>{op.operator_name}</strong> manages {op.your_wells} of your wells with a {op.deduction_ratio}% deduction ratio{aboveAvg}{dollarDetail}
                </span>
              );
            })}
            . Operators with high deduction ratios across a large number of your wells have an outsized impact on your net revenue. Consider reviewing these deductions closely.
            {criticalOps.some(op => op.is_affiliated) && (
              <span> {criticalOps.filter(op => op.is_affiliated).map(op => `${op.operator_name} pays processing deductions to affiliated companies.`).join(' ')}</span>
            )}
          </p>
        </div>
      )}

      {/* About This Data */}
      <div style={{
        padding: 16, marginBottom: 16, borderRadius: 8,
        background: BG_MUTED, border: `1px solid ${BORDER}`,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 6px' }}>About This Data</h3>
        <p style={{ fontSize: 13, color: SLATE, margin: 0, lineHeight: 1.7 }}>
          This report shows deduction ratios and NGL recovery ratios for operators associated with your wells.{' '}
          <strong>Deduction Ratio</strong> = Residue Gas deductions as a percentage of total gross value.{' '}
          <strong>NGL Recovery Ratio</strong> = NGL/Casinghead value returned as a percentage of Residue Gas deductions.{' '}
          Higher NGL recovery means more value returned relative to processing costs.{' '}
          NGL Recovery Ratios above 100% indicate the operator is returning more NGL value than they are deducting in processing costs, which is a positive outcome.
        </p>
      </div>

      {/* Statewide context */}
      {statewide && (
        <div style={{ padding: 12, background: BG_MUTED, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 16, fontSize: 13, color: SLATE }}>
          Statewide average: <strong style={{ color: TEXT_DARK }}>{statewide.deduction_ratio?.toFixed(1) ?? '—'}%</strong> deduction
          {' / '}<strong style={{ color: TEXT_DARK }}>{statewide.ngl_recovery_ratio?.toFixed(1) ?? '—'}%</strong> NGL recovery
          <span style={{ marginLeft: 8, fontSize: 12 }}>({statewide.operator_count} operators)</span>
        </div>
      )}

      <SortableTable
        columns={columns}
        data={operators}
        defaultSort={{ key: 'deduction_ratio', dir: 'desc' }}
        rowKey={(row) => row.operator_number}
        emptyMessage="No operator data available"
      />

      {/* Gas profile classification footnote */}
      <div style={{ fontSize: 12, color: SLATE, marginTop: 20, lineHeight: 1.7, maxWidth: 900 }}>
        <strong style={{ color: TEXT_DARK }}>&#9432; About gas profile classifications</strong><br />
        Each operator is classified by the Gas-Oil Ratio (GOR) of their well portfolio:{' '}
        <strong>Lean Gas</strong> (&gt;70% of wells GOR &gt;15,000) = low NGL expected;{' '}
        <strong>Rich Gas</strong> (&gt;70% of wells GOR &lt;3,000) = NGL recovery expected;{' '}
        <strong>Mixed</strong> = transitional portfolio.{' '}
        Operators tagged "Primarily Lean Gas" may legitimately show high deductions with low PCRR.{' '}
        Operators tagged "Primarily Rich Gas" with low PCRR may warrant closer review.
      </div>
    </div>
  );
}

// ── Research Tab ──

function ResearchTab({ data, loading }: { data: DeductionResearchData | null; loading: boolean }) {
  if (loading) return <LoadingSkeleton columns={3} rows={5} />;
  if (!data) return <div style={{ padding: 32, textAlign: 'center', color: SLATE }}>No research data available</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {/* Top Deduction Counties */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', background: BG_MUTED, borderBottom: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>
          Highest Deduction Counties
        </div>
        {(data.topDeductionCounties || []).map((c, i) => (
          <div key={i} style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: TEXT_DARK }}>{cleanCounty(c.county)}</span>
            <span style={{ color: deductionColor(c.avg_deduction_pct ?? 0), fontWeight: 600 }}>
              {c.avg_deduction_pct?.toFixed(1) ?? '—'}% <span style={{ color: SLATE, fontWeight: 400 }}>({c.well_count} wells)</span>
            </span>
          </div>
        ))}
      </div>

      {/* Top PCRR Operators */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', background: BG_MUTED, borderBottom: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>
          Most Efficient (PCRR)
        </div>
        {(data.topOperatorsByPcrr || []).map((op, i) => (
          <div key={i} style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: TEXT_DARK }}>{op.operator_name}</span>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>
              {op.pcrr?.toFixed(0) ?? '—'}% <span style={{ color: SLATE, fontWeight: 400 }}>({op.well_count} wells)</span>
            </span>
          </div>
        ))}
      </div>

      {/* Top Net Return Operators */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', background: BG_MUTED, borderBottom: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>
          Highest Net Return
        </div>
        {(data.topOperatorsByNetReturn || []).map((op, i) => (
          <div key={i} style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: TEXT_DARK }}>{op.operator_name}</span>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>
              {formatCurrency(op.net_value_return)} <span style={{ color: SLATE, fontWeight: 400 }}>({op.well_count} wells)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
