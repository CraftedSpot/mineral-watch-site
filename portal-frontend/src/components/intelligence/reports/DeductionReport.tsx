import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchDeductionReport, fetchOperatorComparison, fetchDeductionResearch, fetchOperatorEfficiency } from '../../../api/intelligence';
import { useToast } from '../../../contexts/ToastContext';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { OperatorModal } from '../operators/OperatorModal';
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
  OperatorEfficiencyEntry,
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

// ── CSV Utilities ──

function csvEscape(s: string | number | null | undefined): string {
  if (s == null) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const exportBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: `1px solid ${BORDER}`,
  fontSize: 12, fontWeight: 600, color: TEXT_DARK, background: '#fff',
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};

// ── Gas Profile Badge ──

// Handles both well-level ('lean'/'rich'/'mixed') and operator-level ('Primarily Lean Gas'/etc.) keys
const GAS_PROFILE_STYLES: Record<string, { bg: string; color: string; label: string; title: string }> = {
  lean: { bg: '#dbeafe', color: '#1e40af', label: 'Lean Gas', title: 'Lean/dry gas (GOR > 15,000) — low NGL expected' },
  rich: { bg: '#dcfce7', color: '#166534', label: 'Rich Gas', title: 'Rich/wet gas (GOR < 3,000) — NGL recovery expected' },
  mixed: { bg: '#f3f4f6', color: '#374151', label: 'Mixed', title: 'Mixed gas profile (GOR 3,000–15,000)' },
  'Primarily Lean Gas': { bg: '#dbeafe', color: '#1e40af', label: 'Lean Gas', title: 'Lean/dry gas (>70% of wells GOR > 15,000)' },
  'Primarily Rich Gas': { bg: '#dcfce7', color: '#166534', label: 'Rich Gas', title: 'Rich/wet gas (>70% of wells GOR < 3,000)' },
  'Mixed Portfolio': { bg: '#f3f4f6', color: '#374151', label: 'Mixed', title: 'Mixed gas profile — transitional portfolio' },
};

function GasProfileBadge({ profile }: { profile: string | null }) {
  if (!profile) return null;
  const s = GAS_PROFILE_STYLES[profile] || GAS_PROFILE_STYLES.mixed;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: s.bg, color: s.color }} title={s.title}>
      {s.label}
    </span>
  );
}

export function DeductionReport({ tier, initialTab }: Props) {
  const [activeTab, setActiveTab] = useState(initialTab || 'portfolio');
  const [operatorModal, setOperatorModal] = useState<{ number: string; name: string } | null>(null);
  const { data, loading, error, refetch } = useReportData(fetchDeductionReport);
  const { data: opData } = useReportData(fetchOperatorComparison, { enabled: tier === 'full' });
  const { data: researchData, loading: researchLoading } = useReportData(
    fetchDeductionResearch,
    { enabled: activeTab === 'research' }
  );

  if (loading) return <LoadingSkeleton columns={5} rows={6} label="Deduction Audit" />;

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
        <PortfolioTab data={data} onOperatorClick={setOperatorModal} />
      )}
      {activeTab === 'markets' && (
        <MarketsTab data={opData} tier={tier} onOperatorClick={setOperatorModal} />
      )}
      {activeTab === 'research' && (
        <ResearchTab data={researchData} loading={researchLoading} onOperatorClick={setOperatorModal} />
      )}

      {/* Footer */}
      <div style={{ padding: '16px 0', fontSize: 12, color: SLATE, borderTop: `1px solid ${BORDER}`, marginTop: 24 }}>
        Data sourced from Oklahoma Tax Commission gross production reports.
        Analysis date: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </div>

      {/* Operator detail modal */}
      {operatorModal && (
        <OperatorModal
          operatorNumber={operatorModal.number}
          operatorName={operatorModal.name}
          onClose={() => setOperatorModal(null)}
        />
      )}
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

function PortfolioTab({ data, onOperatorClick }: { data: DeductionReportData; onOperatorClick: (op: { number: string; name: string }) => void }) {
  const { flaggedWells, portfolio, statewide, summary } = data;
  const toast = useToast();

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

  const worstWell = flaggedWells[0]; // sorted desc by agg_deduction_pct

  const handleExportCsv = () => {
    const headers = [
      'Well Name','Operator','API Number','County','Status',
      'Deduction %','PCRR %','Net Return','Variance Points','County Avg %',
      'Gas Purchaser','Purchaser ID','Affiliated','Gas Profile',
      'Total Gross','Deductions','NGL Returned',
      'Oil Gross','Oil Deductions','Residue Gas Gross','Residue Gas Deductions',
      'Casinghead Gross','Casinghead Deductions','NGL Gross','NGL Deductions',
    ];
    const rows = flaggedWells.map(w => {
      const m = getPcrrMetrics(w);
      const status = w.variance_points != null && w.variance_points > 15 ? 'High Priority' : 'Above Average';
      const prod = (code: string) => w.products.find(p => p.product_code === code);
      return [
        csvEscape(w.well_name), csvEscape(w.operator), w.api_number, csvEscape(cleanCounty(w.county)), status,
        w.agg_deduction_pct, m.pcrr ?? '', m.netReturn, w.variance_points ?? '', w.county_avg_pct ?? '',
        csvEscape(w.purchaser_name), w.purchaser_id ?? '', w.is_affiliated ? 'Yes' : w.purchaser_name ? 'No' : '',
        w.gas_profile ?? '',
        w.total_gross, m.residue, m.ngl,
        prod('1')?.gross_value ?? '', prod('1')?.market_deduction ?? '',
        prod('5')?.gross_value ?? '', prod('5')?.market_deduction ?? '',
        prod('6')?.gross_value ?? '', prod('6')?.market_deduction ?? '',
        prod('3')?.gross_value ?? '', prod('3')?.market_deduction ?? '',
      ].join(',');
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(headers.join(',') + '\n' + rows.join('\n'), `residue-gas-deduction-audit-${date}.csv`);
    toast.success('CSV downloaded');
  };

  const columns: Column<DeductionWell>[] = useMemo(() => [
    {
      key: 'well_name', label: 'Well', sortType: 'string', width: 'minmax(140px, 2fr)',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500 }}>{row.well_name}</span>
          {row.lean_gas_expected && (
            <span style={{ fontSize: 10, color: '#6b7280', padding: '1px 4px', background: '#f3f4f6', borderRadius: 3 }} title="Lean gas — high deductions expected">
              Expected
            </span>
          )}
          {row.oil_only_verify && (
            <span style={{ fontSize: 10, color: '#1e40af', padding: '1px 4px', background: '#dbeafe', borderRadius: 3 }} title="Oil-only well — minimal deductions expected, verify with operator">
              &#8505; Verify
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: 'minmax(120px, 1.5fr)', hideOnMobile: true,
      render: (row) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {row.operator_number ? (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onOperatorClick({ number: row.operator_number!, name: row.operator }); }}
              style={{ fontWeight: 500, color: '#3b82f6', cursor: 'pointer', textDecoration: 'none' }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
            >
              {row.operator || '—'}
            </span>
          ) : (
            <span style={{ fontWeight: 500 }}>{row.operator || '—'}</span>
          )}
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {row.is_affiliated && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fef3c7', color: '#92400e' }}>Affiliated</span>
            )}
            <GasProfileBadge profile={row.gas_profile} />
          </span>
        </span>
      ),
    },
    {
      key: 'agg_deduction_pct', label: 'Ded %', sortType: 'number', width: 'minmax(55px, 0.5fr)',
      render: (row) => {
        const isContextual = row.lean_gas_expected || row.oil_only_verify;
        return (
          <span style={{ color: isContextual ? TEXT_DARK : deductionColor(row.agg_deduction_pct), fontWeight: 600 }}>
            {row.agg_deduction_pct}%
          </span>
        );
      },
    },
    {
      key: '_pcrr', label: 'PCRR %', sortType: 'number', width: 'minmax(55px, 0.5fr)', hideOnMobile: true,
      title: 'Post-Production Cost Recovery Ratio: NGL ÷ Deductions. Over 100% is favorable.',
      getValue: (row) => getPcrrMetrics(row).pcrr,
      render: (row) => {
        const { pcrr } = getPcrrMetrics(row);
        if (pcrr == null) return <span style={{ color: SLATE }}>—</span>;
        const isContextual = row.lean_gas_expected || row.oil_only_verify;
        const c = isContextual ? TEXT_DARK : pcrr >= 100 ? '#16a34a' : pcrr >= 30 ? TEXT_DARK : '#f59e0b';
        return <span style={{ color: c }}>{pcrr}%</span>;
      },
    },
    {
      key: '_net_return', label: 'Net Return', sortType: 'number', width: 'minmax(70px, 0.7fr)',
      getValue: (row) => getPcrrMetrics(row).netReturn,
      render: (row) => {
        const { netReturn } = getPcrrMetrics(row);
        const isContextual = row.lean_gas_expected || row.oil_only_verify;
        const c = isContextual ? TEXT_DARK : netReturn >= 0 ? '#16a34a' : '#dc2626';
        return <span style={{ color: c }}>{formatCurrency(netReturn)}</span>;
      },
    },
    {
      key: 'variance_points', label: 'Variance', sortType: 'number', width: 'minmax(65px, 0.6fr)', hideOnMobile: true,
      title: 'Points above county average',
      render: (row) => {
        if (row.variance_points == null) return <span style={{ color: SLATE }}>—</span>;
        const isContextual = row.lean_gas_expected || row.oil_only_verify;
        const c = isContextual ? TEXT_DARK : row.variance_points > 15 ? '#dc2626' : row.variance_points > 8 ? '#f59e0b' : TEXT_DARK;
        return <span style={{ color: c }}>+{row.variance_points} pts</span>;
      },
    },
    {
      key: 'county', label: 'County', sortType: 'string', width: 'minmax(70px, 0.7fr)', hideOnMobile: true,
      getValue: (row) => cleanCounty(row.county),
      render: (row) => <span>{cleanCounty(row.county)}</span>,
    },
    {
      key: 'county_avg_pct', label: 'Cty Avg', sortType: 'number', width: 'minmax(55px, 0.5fr)', hideOnMobile: true,
      render: (row) => <span>{row.county_avg_pct != null ? `${row.county_avg_pct}%` : '—'}</span>,
    },
    {
      key: 'total_gross', label: 'Total Gross', sortType: 'number', width: 'minmax(70px, 0.7fr)', hideOnMobile: true,
      render: (row) => <span>{formatCurrency(row.total_gross)}</span>,
    },
    {
      key: '_residue_deductions', label: 'Deductions', sortType: 'number', width: 'minmax(75px, 0.7fr)', hideOnMobile: true,
      title: 'Product 5 — Residue Gas processing fees',
      getValue: (row) => getPcrrMetrics(row).residue,
      render: (row) => <span>{formatCurrency(getPcrrMetrics(row).residue)}</span>,
    },
    {
      key: '_ngl_returned', label: 'NGL Returned', sortType: 'number', width: 'minmax(75px, 0.7fr)', hideOnMobile: true,
      title: 'Product 6 — Value returned from plant',
      getValue: (row) => getPcrrMetrics(row).ngl,
      render: (row) => <span>{formatCurrency(getPcrrMetrics(row).ngl)}</span>,
    },
  ], []);

  const renderExpanded = (row: DeductionWell) => {
    const isContextual = row.lean_gas_expected || row.oil_only_verify;
    const prod5 = row.products.find(p => p.product_code === '5');
    const hasResidueGasNote = row.residueGasNote || (prod5 && prod5.deduction_pct > 80);

    return (
      <div style={{ padding: '4px 0' }}>
        {/* Purchaser info */}
        {row.purchaser_name && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: SLATE }}>Gas Purchaser:</span>
            <span style={{ fontWeight: 600, color: TEXT_DARK }}>{row.purchaser_name}</span>
            {row.is_affiliated ? (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fef3c7', color: '#92400e' }}>Affiliated</span>
            ) : (
              <span style={{ fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 3, background: '#f1f5f9', color: SLATE }}>Third Party</span>
            )}
            {row.is_affiliated && (
              <span style={{ fontSize: 12, color: '#92400e', fontStyle: 'italic' }}>
                — processing costs paid to affiliated company
              </span>
            )}
          </div>
        )}

        {/* Product Breakdown */}
        <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK, marginBottom: 8 }}>Product Breakdown — {row.well_name}</div>
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

        {/* Context notes */}
        {hasResidueGasNote && !isContextual && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 6, background: '#fafafa', borderLeft: '3px solid #d1d5db', fontSize: 12, color: SLATE, lineHeight: 1.6 }}>
            Residue Gas deductions over 80% are common when NGLs are extracted from the gas stream. The key metric is whether NGL value returned (Product 6) offsets the deductions — check PCRR above.
          </div>
        )}
        {row.gas_profile === 'lean' && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 6, background: '#f8fafc', borderLeft: '3px solid #94a3b8', fontSize: 12, color: SLATE, lineHeight: 1.6 }}>
            <strong>Lean Gas Well</strong> — GOR &gt; 15,000. Low NGL recovery is expected for lean/dry gas wells. High deduction rates are typical and may not indicate an issue.
          </div>
        )}
        {row.gas_profile === 'rich' && getPcrrMetrics(row).pcrr != null && (getPcrrMetrics(row).pcrr ?? 0) < 30 && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 6, background: '#fef2f2', borderLeft: '3px solid #ef4444', fontSize: 12, color: '#991b1b', lineHeight: 1.6 }}>
            <strong>Rich Gas Well — Low NGL Recovery</strong> — GOR &lt; 3,000 suggests this well should produce significant NGLs, but PCRR is below 30%. This may warrant closer review of gas processing terms.
          </div>
        )}
        {row.oil_only_verify && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 6, background: '#eff6ff', borderLeft: '3px solid #3b82f6', fontSize: 12, color: '#1e40af', lineHeight: 1.6 }}>
            <strong>Oil-Only Well</strong> — Minimal gas processing deductions expected. If deductions appear significant, verify with operator that charges are legitimate.
          </div>
        )}

        {/* Monthly Trend table */}
        {row.monthly && row.monthly.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK, marginBottom: 8 }}>Monthly Trend</div>
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px 1fr', background: BG_MUTED, borderBottom: `1px solid ${BORDER}`, fontSize: 11, fontWeight: 600, color: SLATE }}>
                <div style={{ padding: '6px 10px' }}>Month</div>
                <div style={{ padding: '6px 10px', textAlign: 'right' }}>Gross</div>
                <div style={{ padding: '6px 10px', textAlign: 'right' }}>Deductions</div>
                <div style={{ padding: '6px 10px', textAlign: 'right' }}>Rate</div>
                <div style={{ padding: '6px 10px', textAlign: 'right' }}>Net</div>
              </div>
              {row.monthly.map((m) => (
                <div key={m.year_month} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px 1fr', borderBottom: `1px solid ${BORDER}`, fontSize: 12 }}>
                  <div style={{ padding: '5px 10px', color: TEXT_DARK }}>{formatMonth(m.year_month)}</div>
                  <div style={{ padding: '5px 10px', textAlign: 'right', color: TEXT_DARK }}>{formatCurrency(m.gross_value)}</div>
                  <div style={{ padding: '5px 10px', textAlign: 'right', color: TEXT_DARK }}>{formatCurrency(m.market_deduction)}</div>
                  <div style={{ padding: '5px 10px', textAlign: 'right', color: deductionColor(m.deduction_pct), fontWeight: 600 }}>{m.deduction_pct}%</div>
                  <div style={{ padding: '5px 10px', textAlign: 'right', color: m.net_value >= 0 ? '#16a34a' : '#dc2626' }}>{formatCurrency(m.net_value)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Summary card + export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div style={{ padding: 16, background: BG_MUTED, borderRadius: 8, border: `1px solid ${BORDER}`, flex: 1 }}>
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
        <button onClick={handleExportCsv} style={exportBtnStyle} title="Export flagged wells to CSV">
          Export CSV
        </button>
      </div>

      {/* Deduction Rate Comparison chart */}
      <DeductionComparisonChart
        worstWell={worstWell}
        portfolioAvg={portfolio.avg_deduction_pct}
        countyAvg={worstWell.county_avg_pct}
      />

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

// ── Deduction Comparison Bar Chart ──

function DeductionComparisonChart({ worstWell, portfolioAvg, countyAvg }: {
  worstWell: DeductionWell;
  portfolioAvg: number;
  countyAvg: number | null;
}) {
  const maxPct = Math.max(worstWell.agg_deduction_pct, portfolioAvg, countyAvg || 0, 10);

  const bars: { label: string; pct: number; color: string }[] = [
    { label: worstWell.well_name, pct: worstWell.agg_deduction_pct, color: '#dc2626' },
    ...(countyAvg != null ? [{ label: `${cleanCounty(worstWell.county)} County Avg`, pct: countyAvg, color: '#f59e0b' }] : []),
    { label: 'Portfolio Average', pct: portfolioAvg, color: '#3b82f6' },
  ];

  return (
    <div style={{ padding: 16, background: BG_MUTED, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Deduction Rate Comparison</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bars.map((bar) => (
          <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: SLATE, width: 160, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bar.label}>
              {bar.label}
            </span>
            <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 20, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.max(Math.round((bar.pct / maxPct) * 100), 8)}%`,
                height: '100%', borderRadius: 4, background: bar.color,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6,
                transition: 'width 0.3s ease',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{bar.pct}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
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

function MarketsTab({ data, tier, onOperatorClick }: { data: OperatorComparisonData | null; tier: IntelligenceTier; onOperatorClick: (op: { number: string; name: string }) => void }) {
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
  const toast = useToast();

  const handleExportMarketsCsv = () => {
    const headers = ['Operator','Operator Number','Your Wells','Total Wells','Total Gross','Deductions','Ded %','NGL Returned','Net Return','PCRR','Gas Profile','Affiliated'];
    const rows = operators.map(op => {
      const net = (op.liquids_returned || 0) - (op.residue_deductions || 0);
      const pcrr = op.residue_deductions > 0 ? Math.round((op.liquids_returned / op.residue_deductions) * 1000) / 10 : '';
      return [
        csvEscape(op.operator_name), op.operator_number, op.your_wells, op.total_wells,
        op.total_gross, op.residue_deductions, op.deduction_ratio, op.liquids_returned,
        net, pcrr, op.gas_profile ?? '', op.is_affiliated ? 'Yes' : 'No',
      ].join(',');
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(headers.join(',') + '\n' + rows.join('\n'), `operator-comparison-${date}.csv`);
    toast.success('CSV downloaded');
  };

  const columns: Column<OperatorComparisonEntry>[] = [
    {
      key: 'operator_name', label: 'Operator', sortType: 'string', width: 'minmax(140px, 1.8fr)',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onOperatorClick({ number: row.operator_number, name: row.operator_name }); }}
            style={{ fontWeight: 500, color: '#3b82f6', cursor: 'pointer', textDecoration: 'none' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
          >
            {row.operator_name}
          </span>
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
      key: 'your_wells', label: 'Your Wells', sortType: 'number', width: 'minmax(65px, 0.6fr)', hideOnMobile: true,
      render: (row) => <span style={{ fontWeight: row.your_wells > 0 ? 600 : 400 }}>{row.your_wells}</span>,
    },
    {
      key: 'total_wells', label: 'Total Wells', sortType: 'number', width: 'minmax(65px, 0.6fr)', hideOnMobile: true,
      render: (row) => <span>{row.total_wells}</span>,
    },
    {
      key: 'total_gross', label: 'Total Gross', sortType: 'number', width: 'minmax(80px, 0.8fr)', hideOnMobile: true,
      render: (row) => <span>{formatCurrency(row.total_gross)}</span>,
    },
    {
      key: 'residue_deductions', label: 'Deductions', sortType: 'number', width: 'minmax(80px, 0.8fr)', hideOnMobile: true,
      render: (row) => <span>{formatCurrency(row.residue_deductions)}</span>,
    },
    {
      key: 'deduction_ratio', label: 'Ded %', sortType: 'number', width: 'minmax(55px, 0.5fr)',
      render: (row) => {
        const v = row.deduction_ratio;
        if (v == null) return <span style={{ color: SLATE }}>—</span>;
        return <span style={{ color: deductionColor(v), fontWeight: 600 }}>{v.toFixed(1)}%</span>;
      },
    },
    {
      key: 'liquids_returned', label: 'NGL Returned', sortType: 'number', width: 'minmax(80px, 0.8fr)', hideOnMobile: true,
      render: (row) => <span>{formatCurrency(row.liquids_returned)}</span>,
    },
    {
      key: '_net_return', label: 'Net Return', sortType: 'number', width: 'minmax(80px, 0.8fr)',
      getValue: (row) => (row.liquids_returned || 0) - (row.residue_deductions || 0),
      render: (row) => {
        const net = (row.liquids_returned || 0) - (row.residue_deductions || 0);
        const color = net <= -5_000_000 ? '#ef4444' : net <= -1_000_000 ? '#f97316' : net >= 0 ? '#16a34a' : TEXT_DARK;
        return <span style={{ color, fontWeight: 600 }}>{formatCurrencyShort(net)}</span>;
      },
    },
    {
      key: '_pcrr', label: 'PCRR', sortType: 'number', width: 'minmax(55px, 0.5fr)', hideOnMobile: true,
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
      key: 'gas_profile', label: 'Gas Profile', sortType: 'string', width: 'minmax(70px, 0.7fr)', hideOnMobile: true,
      render: (row) => {
        if (!row.gas_profile) return <span style={{ color: SLATE }}>—</span>;
        return <GasProfileBadge profile={row.gas_profile} />;
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

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={handleExportMarketsCsv} style={exportBtnStyle}>Export CSV</button>
      </div>

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

function ResearchTab({ data, loading, onOperatorClick }: {
  data: DeductionResearchData | null;
  loading: boolean;
  onOperatorClick: (op: { number: string; name: string }) => void;
}) {
  const [search, setSearch] = useState('');
  const { data: effData, loading: effLoading } = useReportData(
    () => fetchOperatorEfficiency(20),
    { enabled: true }
  );
  const toast = useToast();

  if (loading && !data) return <LoadingSkeleton columns={3} rows={5} />;

  const filteredOps = useMemo(() => {
    if (!effData) return [];
    if (!search.trim()) return effData;
    const q = search.toLowerCase();
    return effData.filter(op =>
      op.operator_name.toLowerCase().includes(q) || op.operator_number.includes(q)
    );
  }, [effData, search]);

  const effColumns: Column<OperatorEfficiencyEntry>[] = useMemo(() => [
    {
      key: 'operator_name', label: 'Operator', sortType: 'string', width: 'minmax(130px, 1.8fr)',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onOperatorClick({ number: row.operator_number, name: row.operator_name }); }}
            style={{ fontWeight: 500, color: '#3b82f6', cursor: 'pointer' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
          >
            {row.operator_name}
          </span>
          {row.is_affiliated && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fef3c7', color: '#92400e' }}>Affiliated</span>
          )}
          <GasProfileBadge profile={row.gas_profile} />
        </span>
      ),
    },
    {
      key: 'well_count', label: 'Wells', sortType: 'number', width: 'minmax(50px, 0.5fr)', hideOnMobile: true,
    },
    {
      key: 'deduction_pct', label: 'Ded %', sortType: 'number', width: 'minmax(55px, 0.5fr)',
      render: (row) => {
        const v = row.deduction_pct;
        if (v == null) return <span style={{ color: SLATE }}>—</span>;
        return <span style={{ color: deductionColor(v), fontWeight: 600 }}>{v.toFixed(1)}%</span>;
      },
    },
    {
      key: 'pcrr_value', label: 'NGL Returned', sortType: 'number', width: 'minmax(80px, 0.7fr)', hideOnMobile: true,
      render: (row) => <span>{formatCurrencyShort(row.pcrr_value)}</span>,
    },
    {
      key: 'net_value_return', label: 'Net Return', sortType: 'number', width: 'minmax(80px, 0.7fr)',
      render: (row) => {
        const c = row.net_value_return <= -5_000_000 ? '#ef4444' : row.net_value_return <= -1_000_000 ? '#f97316' : row.net_value_return >= 0 ? '#16a34a' : TEXT_DARK;
        return <span style={{ color: c, fontWeight: 600 }}>{formatCurrencyShort(row.net_value_return)}</span>;
      },
    },
    {
      key: 'pcrr', label: 'PCRR', sortType: 'number', width: 'minmax(55px, 0.5fr)', hideOnMobile: true,
      render: (row) => {
        if (row.pcrr == null) return <span style={{ color: SLATE }}>—</span>;
        const c = row.pcrr >= 100 ? '#16a34a' : row.pcrr >= 30 ? TEXT_DARK : '#f59e0b';
        return <span style={{ color: c }}>{row.pcrr.toFixed(0)}%</span>;
      },
    },
    {
      key: 'total_gross', label: 'Total Gross', sortType: 'number', width: 'minmax(80px, 0.7fr)', hideOnMobile: true,
      render: (row) => <span>{formatCurrencyShort(row.total_gross)}</span>,
    },
    {
      key: 'residue_deductions', label: 'Deductions', sortType: 'number', width: 'minmax(80px, 0.7fr)', hideOnMobile: true,
      render: (row) => <span>{formatCurrencyShort(row.residue_deductions)}</span>,
    },
    {
      key: 'primary_county', label: 'County', sortType: 'string', width: 'minmax(70px, 0.6fr)', hideOnMobile: true,
      render: (row) => <span>{row.primary_county || '—'}</span>,
    },
  ], [onOperatorClick]);

  const handleExportCsv = () => {
    const headers = ['Operator','Operator Number','Affiliated','Gas Profile','Wells','Ded %','NGL Returned','Net Return','PCRR %','Total Gross','Deductions','County','Status'];
    const rows = filteredOps.map(op => [
      csvEscape(op.operator_name), op.operator_number, op.is_affiliated ? 'Yes' : 'No',
      op.gas_profile ?? '', op.well_count, op.deduction_pct ?? '',
      op.pcrr_value, op.net_value_return, op.pcrr ?? '',
      op.total_gross, op.residue_deductions, op.primary_county ?? '', op.status,
    ].join(','));
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(headers.join(',') + '\n' + rows.join('\n'), `operator-efficiency-index-${date}.csv`);
    toast.success('CSV downloaded');
  };

  return (
    <div>
      {/* Top-5 insight cards */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
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
            {(data.topPcrrOperators || []).map((op, i) => (
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
            {(data.topNetReturnOperators || []).map((op, i) => (
              <div key={i} style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: TEXT_DARK }}>{op.operator_name}</span>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>
                  {formatCurrency(op.net_value_return)} <span style={{ color: SLATE, fontWeight: 400 }}>({op.well_count} wells)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operator Efficiency Index */}
      <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT_DARK, margin: '0 0 12px' }}>Operator Efficiency Index</h3>

      {effLoading && !effData && <LoadingSkeleton columns={5} rows={6} />}

      {effData && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search operators..."
              style={{
                padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
                fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none', width: 200,
              }}
            />
            <span style={{ fontSize: 12, color: SLATE }}>{filteredOps.length} operators (min 20 wells)</span>
            <button onClick={handleExportCsv} style={{ ...exportBtnStyle, marginLeft: 'auto' }}>Export CSV</button>
          </div>

          <SortableTable
            columns={effColumns}
            data={filteredOps}
            defaultSort={{ key: 'net_value_return', dir: 'desc' }}
            rowKey={(row) => row.operator_number}
            emptyMessage="No operators match your search"
          />
        </>
      )}
    </div>
  );
}
