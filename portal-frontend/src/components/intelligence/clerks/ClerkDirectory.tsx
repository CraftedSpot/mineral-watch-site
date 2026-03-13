import { useState, useMemo, useCallback } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchClerkDirectory } from '../../../api/intelligence';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { ClerkDetailModule } from './ClerkDetailModule';
import { BORDER, TEXT_DARK, SLATE } from '../../../lib/constants';
import type { Column } from '../SortableTable';

export interface ClerkOffice {
  id: number;
  county: string;
  county_code?: number;
  office_type: string;
  office_name: string;
  physical_address?: string;
  mailing_address?: string;
  phone?: string;
  email?: string;
  office_hours?: string;
  website?: string;
  uses_okcountyrecords?: number;
  earliest_digitized_records?: string;
  notes?: string;
  verification_status?: string;
  last_verified_date?: string;
}

export function ClerkDirectory() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'County Clerk' | 'Court Clerk'>('all');
  const [selectedOffice, setSelectedOffice] = useState<ClerkOffice | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const fetchFn = useCallback(() => fetchClerkDirectory(), []);
  const { data, loading, error, refetch } = useReportData(fetchFn, { key: 'clerk-directory' });

  const allOffices: ClerkOffice[] = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : [];
  }, [data]);

  const filtered = useMemo(() => {
    let result = allOffices;
    if (typeFilter !== 'all') {
      result = result.filter(o => o.office_type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(o =>
        o.county.toLowerCase().includes(q) ||
        o.office_name.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allOffices, search, typeFilter]);

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const headers = ['County Code', 'County', 'Office Type', 'Office Name', 'Phone', 'Email', 'Physical Address', 'Mailing Address', 'Office Hours', 'Uses OKCountyRecords', 'Earliest Digitized Records', 'Notes'];
    const rows = filtered.map(o => [
      o.county_code ? String(o.county_code).padStart(2, '0') : '',
      o.county, o.office_type, o.office_name,
      o.phone || '', o.email || '', o.physical_address || '', o.mailing_address || '',
      o.office_hours || '', o.uses_okcountyrecords ? 'Yes' : 'No',
      o.earliest_digitized_records || '', o.notes || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'county-clerk-directory.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSkeleton columns={4} rows={6} label="County Clerk Directory" />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load data.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const columns: Column<ClerkOffice>[] = [
    {
      key: 'county', label: 'County', sortType: 'string', width: '1fr',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 500, color: '#3b82f6' }}>
            {row.county_code ? <span style={{ color: SLATE, fontWeight: 400, fontSize: 11, marginRight: 4 }}>{String(row.county_code).padStart(2, '0')}</span> : null}
            {row.county}
          </div>
          <div style={{ fontSize: 11, color: SLATE }}>{row.office_type}</div>
        </div>
      ),
    },
    {
      key: 'phone', label: 'Phone', width: '1fr',
      getValue: (row) => row.phone || '',
      render: (row) => {
        if (!row.phone) return <span style={{ color: SLATE }}>—</span>;
        return (
          <a href={`tel:${row.phone}`} onClick={(e) => e.stopPropagation()}
            style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 13 }}>
            {row.phone}
          </a>
        );
      },
    },
    {
      key: 'physical_address', label: 'Address', width: '1.5fr', hideOnMobile: true,
      getValue: (row) => row.physical_address || '',
      render: (row) => {
        if (!row.physical_address) return <span style={{ color: SLATE }}>—</span>;
        return <span style={{ fontSize: 12, color: SLATE, lineHeight: 1.5 }}>{row.physical_address}</span>;
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
          placeholder="Search by county..."
          style={{
            padding: '8px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
            fontSize: 13, flex: '1 1 200px', maxWidth: 300, minWidth: 140, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SLATE }}>
          <span>Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
            style={{
              padding: '6px 8px', border: `1px solid ${BORDER}`, borderRadius: 6,
              fontSize: 13, fontFamily: 'inherit', background: '#fff',
            }}
          >
            <option value="all">All</option>
            <option value="County Clerk">County Clerk</option>
            <option value="Court Clerk">Court Clerk</option>
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
        {filtered.length} office{filtered.length !== 1 ? 's' : ''}
        <span style={{ margin: '0 6px', color: BORDER }}>|</span>
        <span
          onClick={() => setShowExplainer(!showExplainer)}
          style={{ color: '#3b82f6', cursor: 'pointer' }}
        >
          {showExplainer ? 'Hide' : 'County Clerk vs Court Clerk?'}
        </span>
      </div>

      {showExplainer && (
        <div style={{
          background: '#f0f9ff', border: `1px solid #bae6fd`, borderRadius: 8,
          padding: '10px 14px', marginBottom: 12, fontSize: 13, lineHeight: 1.6, color: TEXT_DARK,
        }}>
          <strong style={{ color: '#0369a1' }}>County Clerks</strong> handle land records, deeds, mortgages, and oil & gas leases — this is where you research title chains.{' '}
          <strong style={{ color: '#92400e' }}>Court Clerks</strong> handle probate, estates, and civil cases — relevant when ownership transfers through inheritance or litigation.
        </div>
      )}

      <SortableTable
        columns={columns}
        data={filtered}
        defaultSort={{ key: 'county', dir: 'asc' }}
        rowKey={(row) => String(row.id)}
        onRowClick={(row) => setSelectedOffice(row)}
        emptyMessage="No offices match your filters"
      />

      {selectedOffice && (
        <ClerkDetailModule
          office={selectedOffice}
          allOffices={allOffices}
          onClose={() => setSelectedOffice(null)}
          onSwitchOffice={(office) => setSelectedOffice(office)}
        />
      )}
    </div>
  );
}
