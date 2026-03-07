import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useReportData } from '../../../hooks/useReportData';
import { fetchOperatorDirectory } from '../../../api/intelligence';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { ModalShell } from '../../ui/ModalShell';
import { BORDER, TEXT_DARK, SLATE } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { OperatorDirectoryEntry } from '../../../types/intelligence';

export function OperatorDirectory() {
  const [search, setSearch] = useState('');
  const [minWells, setMinWells] = useState(20);
  const [selectedOp, setSelectedOp] = useState<OperatorDirectoryEntry | null>(null);
  const fetchFn = useCallback(() => fetchOperatorDirectory(minWells), [minWells]);
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
    const headers = ['Operator', 'Wells', 'Counties', 'Phone', 'Address', 'City', 'State', 'ZIP'];
    const rows = filtered.map(o => [
      o.company_name, o.well_count, o.counties.join('; '),
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

  if (loading) return <LoadingSkeleton columns={4} rows={6} />;
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
      key: 'company_name', label: 'Operator', sortType: 'string', width: 250,
      render: (row) => (
        <button
          onClick={() => setSelectedOp(row)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontWeight: 500, color: '#3b82f6', fontSize: 'inherit', fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          {row.company_name}
        </button>
      ),
    },
    { key: 'well_count', label: 'Wells', sortType: 'number', width: 70 },
    {
      key: '_counties', label: 'Counties', width: 200,
      getValue: (row) => row.counties.join(', '),
      render: (row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {row.counties.slice(0, 4).map(c => (
            <Badge key={c} bg="#f1f5f9" color={SLATE} size="sm">{c}</Badge>
          ))}
          {row.counties.length > 4 && <Badge bg="#f1f5f9" color={SLATE} size="sm">+{row.counties.length - 4}</Badge>}
        </div>
      ),
    },
    {
      key: '_contact', label: 'Contact', width: 120,
      getValue: (row) => row.phone || row.city || '',
      render: (row) => (
        <span style={{ fontSize: 12, color: SLATE }}>
          {row.phone || (row.city && row.state ? `${row.city}, ${row.state}` : '—')}
        </span>
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
        defaultSort={{ key: 'well_count', dir: 'desc' }}
        rowKey={(row) => row.operator_number}
        emptyMessage="No operators match your filters"
      />

      {selectedOp && (
        <OperatorModal operator={selectedOp} onClose={() => setSelectedOp(null)} />
      )}
    </div>
  );
}

function OperatorModal({ operator, onClose }: { operator: OperatorDirectoryEntry; onClose: () => void }) {
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 600, padding: '0 20px', boxSizing: 'border-box' }}>
        <ModalShell
          onClose={onClose}
          title={operator.company_name}
          subtitle={`${operator.well_count} wells across ${operator.counties.length} counties`}
          headerBg="linear-gradient(135deg, #6d28d9, #7c3aed)"
          maxWidth={600}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Contact info */}
            <div style={{ padding: 16, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Contact Information</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                {operator.phone && (
                  <div>
                    <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Phone</div>
                    <div style={{ color: TEXT_DARK }}>{operator.phone}</div>
                  </div>
                )}
                {operator.address && (
                  <div>
                    <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Address</div>
                    <div style={{ color: TEXT_DARK }}>{operator.address}</div>
                  </div>
                )}
                {operator.city && (
                  <div>
                    <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>City/State</div>
                    <div style={{ color: TEXT_DARK }}>{operator.city}, {operator.state} {operator.zip}</div>
                  </div>
                )}
              </div>
              {!operator.phone && !operator.address && !operator.city && (
                <div style={{ fontSize: 13, color: SLATE }}>No contact information available.</div>
              )}
            </div>

            {/* Counties */}
            <div style={{ padding: 16, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Active Counties</h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {operator.counties.map(c => (
                  <Badge key={c} bg="#f5f3ff" color="#6d28d9" size="sm">{c}</Badge>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div style={{ padding: 16, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Summary</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div>
                  <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Operator Number</div>
                  <div style={{ color: TEXT_DARK, fontFamily: 'monospace' }}>{operator.operator_number}</div>
                </div>
                <div>
                  <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Total Wells</div>
                  <div style={{ color: TEXT_DARK, fontWeight: 600 }}>{operator.well_count}</div>
                </div>
              </div>
            </div>
          </div>
        </ModalShell>
      </div>
    </div>,
    document.body,
  );
}
