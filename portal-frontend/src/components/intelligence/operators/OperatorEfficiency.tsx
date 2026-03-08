import { useState, useMemo, useCallback } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchOperatorEfficiency } from '../../../api/intelligence';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { OperatorEfficiencyEntry } from '../../../types/intelligence';

function pctColor(pct: number): string {
  if (pct > 80) return '#16a34a';
  if (pct > 60) return '#f59e0b';
  return '#dc2626';
}

export function OperatorEfficiency() {
  const [search, setSearch] = useState('');
  const [minWells, setMinWells] = useState(10);
  const fetchFn = useCallback(() => fetchOperatorEfficiency(minWells), [minWells]);
  const { data, loading, error, refetch } = useReportData(fetchFn, { key: 'operator-efficiency', deps: [minWells] });

  const filtered = useMemo(() => {
    if (!data) return [];
    const arr = Array.isArray(data) ? data : [];
    if (!search.trim()) return arr;
    const q = search.toLowerCase();
    return arr.filter(o =>
      o.operator_name.toLowerCase().includes(q)
    );
  }, [data, search]);

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const headers = ['Operator', 'Wells', 'Deduction %', 'PCRR', 'Net Value Return', 'Primary County'];
    const rows = filtered.map(o => [
      o.operator_name, o.well_count, o.deduction_pct != null ? o.deduction_pct.toFixed(1) : '',
      o.pcrr != null ? o.pcrr.toFixed(1) : '', o.net_value_return.toFixed(0),
      o.primary_county || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'operator-efficiency.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSkeleton columns={5} rows={6} />;
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
      key: 'operator_name', label: 'Operator', sortType: 'string', width: 200,
      render: (row) => <span style={{ fontWeight: 500 }}>{row.operator_name}</span>,
    },
    { key: 'well_count', label: 'Wells', sortType: 'number', width: 70 },
    {
      key: 'deduction_pct', label: 'Deduction %', sortType: 'number', width: 100,
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
      key: 'pcrr', label: 'PCRR', sortType: 'number', width: 80,
      render: (row) => <span style={{ fontSize: 12, fontWeight: 600 }}>{row.pcrr != null ? row.pcrr.toFixed(1) + '%' : '—'}</span>,
    },
    {
      key: 'net_value_return', label: 'Net Value', sortType: 'number', width: 100,
      render: (row) => {
        const val = row.net_value_return;
        const color = val >= 0 ? '#16a34a' : '#dc2626';
        const formatted = Math.abs(val) >= 1_000_000
          ? '$' + (val / 1_000_000).toFixed(1) + 'M'
          : Math.abs(val) >= 1_000
          ? '$' + (val / 1_000).toFixed(0) + 'K'
          : '$' + Math.round(val).toLocaleString();
        return <span style={{ fontSize: 12, fontWeight: 600, color }}>{formatted}</span>;
      },
    },
    {
      key: '_county', label: 'County', sortType: 'string', width: 100,
      getValue: (row) => row.primary_county || '',
      render: (row) => row.primary_county
        ? <Badge bg="#f1f5f9" color={SLATE} size="sm">{row.primary_county}</Badge>
        : <span style={{ color: SLATE }}>—</span>,
    },
    {
      key: '_purchaser', label: 'Purchaser', width: 130,
      getValue: (row) => row.primary_purchaser_name || '',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <span style={{ color: SLATE }}>{row.primary_purchaser_name || '—'}</span>
          {row.is_affiliated && <Badge bg="#fef3c7" color="#92400e" size="sm">Aff</Badge>}
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
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
              <option key={n} value={n}>{n}</option>
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

      <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
        {filtered.length} operator{filtered.length !== 1 ? 's' : ''}
      </div>

      <SortableTable
        columns={columns}
        data={filtered}
        defaultSort={{ key: 'deduction_pct', dir: 'desc' }}
        rowKey={(row) => row.operator_number}
        emptyMessage="No operators match your filters"
      />
    </div>
  );
}
