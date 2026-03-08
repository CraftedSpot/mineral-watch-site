import { useState, useMemo, useCallback } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchOperatorEfficiency } from '../../../api/intelligence';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { OperatorModal } from './OperatorModal';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { OperatorEfficiencyEntry } from '../../../types/intelligence';

const GAS_PROFILE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  'Primarily Lean Gas': { bg: '#dbeafe', color: '#1e40af', label: 'Lean Gas' },
  'Primarily Rich Gas': { bg: '#dcfce7', color: '#166534', label: 'Rich Gas' },
  'Mixed Portfolio': { bg: '#f3f4f6', color: '#374151', label: 'Mixed' },
};

function fmtDollar(v: number): string {
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'K';
  return '$' + Math.round(v).toLocaleString();
}

function netReturnColor(val: number): string {
  if (val >= 0) return '#16a34a';
  if (val > -1_000_000) return TEXT_DARK;
  if (val > -10_000_000) return '#f97316';
  return '#dc2626';
}

function netReturnBg(val: number): string {
  if (val >= 0) return '#dcfce7';
  if (val > -1_000_000) return '#f3f4f6';
  if (val > -10_000_000) return '#fff7ed';
  return '#fee2e2';
}

function pctColor(pct: number): string {
  if (pct > 80) return '#16a34a';
  if (pct > 60) return '#f59e0b';
  return '#dc2626';
}

function csvEscape(s: string | number | null | undefined): string {
  const str = String(s ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

export function OperatorEfficiency() {
  const [search, setSearch] = useState('');
  const [minWells, setMinWells] = useState(10);
  const [modal, setModal] = useState<{ number: string; name: string } | null>(null);
  const fetchFn = useCallback(() => fetchOperatorEfficiency(minWells), [minWells]);
  const { data, loading, error, refetch } = useReportData(fetchFn, { key: 'operator-efficiency', deps: [minWells] });

  const filtered = useMemo(() => {
    if (!data) return [];
    const arr = Array.isArray(data) ? data : [];
    if (!search.trim()) return arr;
    const q = search.toLowerCase();
    return arr.filter(o =>
      o.operator_name.toLowerCase().includes(q) || o.operator_number.includes(q)
    );
  }, [data, search]);

  // Distribution counts for legend
  const distCounts = useMemo(() => {
    const all = Array.isArray(data) ? data : [];
    let positive = 0, neutral = 0, warning = 0, danger = 0;
    for (const o of all) {
      const v = o.net_value_return;
      if (v >= 0) positive++;
      else if (v > -1_000_000) neutral++;
      else if (v > -10_000_000) warning++;
      else danger++;
    }
    return { positive, neutral, warning, danger, total: all.length };
  }, [data]);

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const headers = ['Operator Number','Operator Name','Status','Primary County','Wells','Total Gross','Deductions','Deduction %','NGL Returned','Net Return','PCRR %','Gas Purchaser','Purchaser Type','Gas Profile'];
    const rows = filtered.map(o => [
      o.operator_number, csvEscape(o.operator_name), o.status || '',
      o.primary_county || '', o.well_count,
      o.total_gross.toFixed(0), o.residue_deductions.toFixed(0),
      o.deduction_pct != null ? o.deduction_pct.toFixed(1) : '',
      o.pcrr_value.toFixed(0), o.net_value_return.toFixed(0),
      o.pcrr != null ? o.pcrr.toFixed(1) : '',
      csvEscape(o.primary_purchaser_name || ''),
      o.is_affiliated ? 'Affiliated' : o.primary_purchaser_name ? 'Third Party' : '',
      o.gas_profile || '',
    ].join(','));
    const csv = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operator-efficiency-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSkeleton columns={5} rows={6} label="Operator Efficiency Index" />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load data.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const columns: Column<OperatorEfficiencyEntry>[] = [
    {
      key: 'operator_name', label: 'Operator', sortType: 'string', width: 'minmax(150px, 2fr)',
      render: (row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); setModal({ number: row.operator_number, name: row.operator_name }); }}
            style={{ fontWeight: 500, color: '#3b82f6', cursor: 'pointer' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
          >
            {row.operator_name}
          </span>
          <span style={{ fontSize: 10, color: SLATE, fontFamily: 'monospace' }}>#{row.operator_number}</span>
          {row.is_affiliated && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fef3c7', color: '#92400e' }}>Affiliated</span>
          )}
          {row.gas_profile && (() => {
            const gp = GAS_PROFILE_STYLES[row.gas_profile!] || GAS_PROFILE_STYLES['Mixed Portfolio'];
            return <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: gp.bg, color: gp.color }}>{gp.label}</span>;
          })()}
        </span>
      ),
    },
    { key: 'well_count', label: 'Wells', sortType: 'number', width: 'minmax(50px, 0.4fr)' },
    {
      key: 'deduction_pct', label: 'Deduction %', sortType: 'number', width: 'minmax(90px, 0.8fr)',
      render: (row) => {
        const pct = row.deduction_pct ?? 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pctColor(100 - pct), borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: pct > 40 ? '#dc2626' : TEXT_DARK, width: 40, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
          </div>
        );
      },
    },
    {
      key: 'pcrr', label: 'PCRR', sortType: 'number', width: 'minmax(55px, 0.5fr)',
      render: (row) => {
        if (row.pcrr == null) return <span style={{ color: SLATE }}>—</span>;
        const c = row.pcrr >= 100 ? '#16a34a' : row.pcrr >= 30 ? TEXT_DARK : '#f59e0b';
        return <span style={{ fontSize: 12, fontWeight: 600, color: c }}>{row.pcrr.toFixed(1)}%</span>;
      },
    },
    {
      key: 'net_value_return', label: 'Net Return', sortType: 'number', width: 'minmax(85px, 0.7fr)',
      render: (row) => (
        <span style={{
          fontSize: 12, fontWeight: 600,
          padding: '2px 8px', borderRadius: 4,
          background: netReturnBg(row.net_value_return),
          color: netReturnColor(row.net_value_return),
        }}>
          {fmtDollar(row.net_value_return)}
        </span>
      ),
    },
    {
      key: '_county', label: 'County', sortType: 'string', width: 'minmax(70px, 0.6fr)',
      getValue: (row) => row.primary_county || '',
      render: (row) => row.primary_county
        ? <Badge bg="#f1f5f9" color={SLATE} size="sm">{row.primary_county}</Badge>
        : <span style={{ color: SLATE }}>—</span>,
    },
    {
      key: '_purchaser', label: 'Purchaser', width: 'minmax(100px, 1fr)',
      getValue: (row) => row.primary_purchaser_name || '',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <span style={{ color: TEXT_DARK }}>{row.primary_purchaser_name || '—'}</span>
          {row.is_affiliated && <Badge bg="#fef3c7" color="#92400e" size="sm">Aff</Badge>}
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search operators..."
          style={{
            padding: '8px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
            fontSize: 13, width: 240, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SLATE }}>
          <span>Min wells:</span>
          <select
            value={minWells}
            onChange={(e) => setMinWells(Number(e.target.value))}
            style={{
              padding: '6px 8px', border: `1px solid ${BORDER}`, borderRadius: 6,
              fontSize: 13, fontFamily: 'inherit', background: '#fff',
            }}
          >
            {[5, 10, 20, 50, 100].map(n => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </div>
        <button
          onClick={exportCsv}
          style={{
            marginLeft: 'auto', padding: '6px 14px', border: `1px solid ${BORDER}`,
            borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#fff',
            color: TEXT_DARK, fontFamily: 'inherit',
          }}
        >
          Export CSV
        </button>
      </div>

      {/* Distribution legend + count */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: SLATE }}>{filtered.length} operator{filtered.length !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 11, color: SLATE }}>6-month analysis</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', fontSize: 11 }}>
          {[
            { label: 'Positive', count: distCounts.positive, bg: '#dcfce7', color: '#16a34a' },
            { label: 'Neutral', count: distCounts.neutral, bg: '#f3f4f6', color: '#374151' },
            { label: 'Warning', count: distCounts.warning, bg: '#fff7ed', color: '#f97316' },
            { label: 'Danger', count: distCounts.danger, bg: '#fee2e2', color: '#dc2626' },
          ].filter(d => d.count > 0).map(d => (
            <span key={d.label} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4, background: d.bg, color: d.color, fontWeight: 600,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.color }} />
              {d.count} {d.label}
            </span>
          ))}
        </div>
      </div>

      <SortableTable
        columns={columns}
        data={filtered}
        defaultSort={{ key: 'net_value_return', dir: 'desc' }}
        rowKey={(row) => row.operator_number}
        emptyMessage="No operators match your filters"
        onRowClick={(row) => setModal({ number: row.operator_number, name: row.operator_name })}
      />

      {modal && (
        <OperatorModal
          operatorNumber={modal.number}
          operatorName={modal.name}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
