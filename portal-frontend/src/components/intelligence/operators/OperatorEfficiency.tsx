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
  const { data, loading, error, refetch } = useReportData(fetchFn, { deps: [minWells] });

  const filtered = useMemo(() => {
    if (!data) return [];
    const arr = Array.isArray(data) ? data : [];
    if (!search.trim()) return arr;
    const q = search.toLowerCase();
    return arr.filter(o =>
      o.company_name.toLowerCase().includes(q) ||
      o.counties.some(c => c.toLowerCase().includes(q))
    );
  }, [data, search]);

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const headers = ['Operator', 'Wells', '6M Net Return', 'PCRR', 'Deduction Ratio', 'NGL Recovery', 'Counties'];
    const rows = filtered.map(o => [
      o.company_name, o.well_count, o.net_return_6m.toFixed(1),
      o.pcrr.toFixed(3), o.deduction_ratio.toFixed(3),
      o.ngl_recovery_ratio.toFixed(3), o.counties.join('; '),
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
      key: 'company_name', label: 'Operator', sortType: 'string', width: 200,
      render: (row) => <span style={{ fontWeight: 500 }}>{row.company_name}</span>,
    },
    { key: 'well_count', label: 'Wells', sortType: 'number', width: 70 },
    {
      key: 'net_return_6m', label: '6M Net Return', sortType: 'number', width: 120,
      render: (row) => {
        const pct = row.net_return_6m * 100;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pctColor(pct), borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: pctColor(pct), width: 40, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
          </div>
        );
      },
    },
    {
      key: 'pcrr', label: 'PCRR', sortType: 'number', width: 80,
      render: (row) => <span style={{ fontSize: 12, fontWeight: 600 }}>{(row.pcrr * 100).toFixed(1)}%</span>,
    },
    {
      key: 'deduction_ratio', label: 'Deduction', sortType: 'number', width: 90,
      render: (row) => <span style={{ fontSize: 12, color: row.deduction_ratio > 0.4 ? '#dc2626' : TEXT_DARK }}>{(row.deduction_ratio * 100).toFixed(1)}%</span>,
    },
    {
      key: 'ngl_recovery_ratio', label: 'NGL Recovery', sortType: 'number', width: 100,
      render: (row) => <span style={{ fontSize: 12 }}>{(row.ngl_recovery_ratio * 100).toFixed(1)}%</span>,
    },
    {
      key: '_counties', label: 'Counties', width: 150,
      getValue: (row) => row.counties.join(', '),
      render: (row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.counties.slice(0, 3).map(c => (
            <Badge key={c} bg="#f1f5f9" color={SLATE} size="sm">{c}</Badge>
          ))}
          {row.counties.length > 3 && <Badge bg="#f1f5f9" color={SLATE} size="sm">+{row.counties.length - 3}</Badge>}
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
          placeholder="Search operators or counties..."
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
        defaultSort={{ key: 'net_return_6m', dir: 'desc' }}
        rowKey={(row) => row.operator_number}
        emptyMessage="No operators match your filters"
      />
    </div>
  );
}
