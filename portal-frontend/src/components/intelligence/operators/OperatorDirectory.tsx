import { useState, useMemo, useCallback } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchOperatorDirectory } from '../../../api/intelligence';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { OperatorModal } from './OperatorModal';
import { BORDER, TEXT_DARK, SLATE } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { OperatorDirectoryEntry } from '../../../types/intelligence';

export function OperatorDirectory() {
  const [search, setSearch] = useState('');
  const [minWells, setMinWells] = useState(20);
  const [selectedOp, setSelectedOp] = useState<OperatorDirectoryEntry | null>(null);
  const fetchFn = useCallback(() => fetchOperatorDirectory(minWells), [minWells]);
  const { data, loading, error, refetch } = useReportData(fetchFn, { key: 'operator-directory', deps: [minWells] });

  const filtered = useMemo(() => {
    if (!data) return [];
    const arr = Array.isArray(data) ? data : [];
    if (!search.trim()) return arr;
    const q = search.toLowerCase();
    return arr.filter(o =>
      o.operator_name.toLowerCase().includes(q) ||
      o.counties.some(c => c.toLowerCase().includes(q))
    );
  }, [data, search]);

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const headers = ['Operator', 'Wells', 'Counties', 'Phone', 'Address', 'City', 'State', 'ZIP'];
    const rows = filtered.map(o => [
      o.operator_name, o.well_count, o.counties.join('; '),
      o.phone || '', o.address || '', o.city || '', o.state || '', o.zip || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'operator-directory.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSkeleton columns={4} rows={6} label="Operator Directory" />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load data.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const columns: Column<OperatorDirectoryEntry>[] = [
    {
      key: 'operator_name', label: 'Operator', sortType: 'string', width: '2fr',
      render: (row) => (
        <button
          onClick={() => setSelectedOp(row)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'left', lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 500, color: '#3b82f6' }}>{row.operator_name}</div>
          <div style={{ fontSize: 11, color: SLATE }}>
            #{row.operator_number}
            {row.status === 'OPEN' && <span style={{ marginLeft: 6, color: '#16a34a', fontWeight: 500 }}>Active</span>}
            {row.status === 'CLOSED' && <span style={{ marginLeft: 6, color: '#dc2626', fontWeight: 500 }}>Inactive</span>}
          </div>
        </button>
      ),
    },
    { key: 'well_count', label: 'Wells', sortType: 'number', width: 70 },
    {
      key: '_contact', label: 'Contact', width: '1fr',
      getValue: (row) => row.contact_name || row.phone || '',
      render: (row) => {
        if (!row.contact_name && !row.phone) return <span style={{ color: SLATE }}>—</span>;
        return (
          <div style={{ lineHeight: 1.5 }}>
            {row.contact_name && <div style={{ fontSize: 13, color: TEXT_DARK }}>{row.contact_name}</div>}
            {row.phone && (
              <div style={{ fontSize: 12, color: SLATE }}>
                <a href={`tel:${row.phone}`} onClick={(e) => e.stopPropagation()} style={{ color: '#3b82f6', textDecoration: 'none' }}>
                  {row.phone}
                </a>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: '_address', label: 'Mailing Address', width: '1.5fr',
      getValue: (row) => row.address || row.city || '',
      render: (row) => {
        if (!row.address && !row.city) return <span style={{ color: SLATE }}>—</span>;
        const cityStateZip = [row.city, row.state].filter(Boolean).join(', ') + (row.zip ? ' ' + row.zip : '');
        return (
          <div style={{ fontSize: 12, color: SLATE, lineHeight: 1.5 }}>
            {row.address && <div>{row.address}</div>}
            {cityStateZip.trim() && <div>{cityStateZip.trim()}</div>}
          </div>
        );
      },
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
        defaultSort={{ key: 'well_count', dir: 'desc' }}
        rowKey={(row) => row.operator_number}
        emptyMessage="No operators match your filters"
      />

      {selectedOp && (
        <OperatorModal
          operatorNumber={selectedOp.operator_number}
          operatorName={selectedOp.operator_name}
          subtitle={`${selectedOp.well_count} wells across ${selectedOp.counties.length} counties`}
          onClose={() => setSelectedOp(null)}
        />
      )}
    </div>
  );
}

