import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchOccFilingActivity } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import { OperatorLink } from '../../ui/OperatorLink';
import type { Column } from '../SortableTable';
import type { OccFiling, OccFilingProperty, OccFilingData } from '../../../types/intelligence';

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const yy = String(dt.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  } catch { return d; }
}

function formatTRS(section: string, township: string, range: string): string {
  if (!section && !township && !range) return '—';
  const sec = (section || '').padStart(2, '0');
  const twp = township || '';
  const rng = range || '';
  // Add N/S and E/W if not already present
  const twpFmt = /[NSEW]$/i.test(twp) ? twp : twp + 'N';
  const rngFmt = /[NSEW]$/i.test(rng) ? rng : rng + 'W';
  return `${twpFmt}-${rngFmt}-${sec}`;
}

function reliefBadge(type: string) {
  const t = (type || '').toLowerCase();
  if (t.includes('pooling')) return <Badge bg="#dbeafe" color="#1e40af" size="sm">{type}</Badge>;
  if (t.includes('multi-unit horizontal') || t.includes('multi unit')) return <Badge bg="#d1fae5" color="#065f46" size="sm">{type}</Badge>;
  if (t.includes('horizontal')) return <Badge bg="#dcfce7" color="#166534" size="sm">{type}</Badge>;
  if (t.includes('spacing')) return <Badge bg="#e0e7ff" color="#3730a3" size="sm">{type}</Badge>;
  if (t.includes('increased density')) return <Badge bg="#fef3c7" color="#92400e" size="sm">{type}</Badge>;
  if (t.includes('location exception')) return <Badge bg="#fce7f3" color="#9d174d" size="sm">{type}</Badge>;
  if (t.includes('change of operator')) return <Badge bg="#ede9fe" color="#5b21b6" size="sm">{type}</Badge>;
  if (t.includes('dissolution')) return <Badge bg="#fef2f2" color="#991b1b" size="sm">{type}</Badge>;
  if (t.includes('well transfer')) return <Badge bg="#f0fdf4" color="#15803d" size="sm">{type}</Badge>;
  if (t.includes('vacuum')) return <Badge bg="#fff7ed" color="#c2410c" size="sm">{type}</Badge>;
  if (t.includes('disposal')) return <Badge bg="#fefce8" color="#854d0e" size="sm">{type}</Badge>;
  return <Badge bg="#f3f4f6" color="#374151" size="sm">{type}</Badge>;
}

function distanceBadge(tier: number, desc: string) {
  if (tier === 0) return <Badge bg="#fee2e2" color="#991b1b" size="sm">Same Section</Badge>;
  if (tier === 1) return <Badge bg="#fed7aa" color="#9a3412" size="sm">Adjacent</Badge>;
  return <Badge bg="#f3f4f6" color="#374151" size="sm">{desc || 'Nearby'}</Badge>;
}

export function OccFilingReport() {
  const [activeTab, setActiveTab] = useState('properties');
  const { data, loading, error, refetch } = useReportData(fetchOccFilingActivity);

  if (loading) return <LoadingSkeleton columns={5} rows={6} label="OCC Filing Activity" />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { summary: s, byProperty, byCounty, marketResearch } = data;
  const tabs = [
    { key: 'properties', label: 'My Properties', badge: byProperty.length },
    { key: 'counties', label: 'My Markets', badge: byCounty.length },
    { key: 'research', label: 'Market Research' },
  ];

  return (
    <div>
      {/* HUD */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { value: String(s.totalFilings), label: 'Total Filings', detail: 'Near your properties' },
          { value: String(s.sameSectionFilings), label: 'On Your Sections', detail: 'Direct impact', highlight: s.sameSectionFilings > 0 },
          { value: String(s.topApplicants?.length || 0), label: 'Active Operators', detail: s.topApplicants?.[0]?.name || '' },
          { value: String(s.propertiesWithActivity), label: 'Properties Active', detail: `of ${byProperty.length} total` },
        ].map((b, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', background: BG_MUTED, borderRadius: 8,
            border: `1px solid ${BORDER}`, flex: '1 1 calc(50% - 8px)', minWidth: 0,
          }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: b.highlight ? '#dc2626' : TEXT_DARK }}>{b.value}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</div>
              <div style={{ fontSize: 11, color: SLATE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filing types summary strip */}
      {s.filingTypes && Object.keys(s.filingTypes).length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: SLATE, fontWeight: 600, marginRight: 4 }}>Filing Types</span>
          {Object.entries(s.filingTypes).sort(([, a], [, b]) => b - a).slice(0, 6).map(([type, count]) => (
            <span key={type}>{reliefBadge(`${type} (${count})`)}</span>
          ))}
        </div>
      )}

      {/* Most Active Filers strip */}
      {s.topApplicants && s.topApplicants.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: SLATE, fontWeight: 600, marginRight: 4 }}>Most Active Filers</span>
          {s.topApplicants.slice(0, 5).map((op, i) => (
            <Badge key={i} bg="#f1f5f9" color={TEXT_DARK} size="sm">
              <OperatorLink name={op.name} fontSize={12} /> <span style={{ fontWeight: 700, color: '#3b82f6', marginLeft: 4 }}>{op.count}</span>
            </Badge>
          ))}
        </div>
      )}

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'properties' && <PropertiesTab properties={byProperty} summary={s} />}
      {activeTab === 'counties' && <CountiesTab counties={byCounty} />}
      {activeTab === 'research' && <ResearchTab data={marketResearch} />}
    </div>
  );
}

function PropertiesTab({ properties, summary }: { properties: OccFilingProperty[]; summary: OccFilingData['summary'] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [countyFilter, setCountyFilter] = useState('');
  const [countySearch, setCountySearch] = useState('');
  const [countyDropdownOpen, setCountyDropdownOpen] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState('');
  const [sortBy, setSortBy] = useState('filings');

  const allCounties = useMemo(() => {
    const set = new Set(properties.map(p => p.county));
    return [...set].sort();
  }, [properties]);

  const filteredCounties = useMemo(() => {
    if (!countySearch.trim()) return allCounties;
    const q = countySearch.toLowerCase();
    return allCounties.filter(c => c.toLowerCase().includes(q));
  }, [allCounties, countySearch]);

  const filtered = useMemo(() => {
    let arr = properties;

    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(p =>
        (p.propertyName || '').toLowerCase().includes(q) ||
        p.county.toLowerCase().includes(q) ||
        p.filings.some(f => (f.applicant || '').toLowerCase().includes(q) || (f.caseNumber || '').toLowerCase().includes(q))
      );
    }

    if (countyFilter) {
      arr = arr.filter(p => p.county === countyFilter);
    }

    if (distanceFilter) {
      const tier = distanceFilter === 'same' ? 0 : distanceFilter === 'adjacent' ? 1 : 2;
      arr = arr.filter(p => p.filings.some(f => f.distanceTier === tier));
    }

    const sorted = [...arr];
    switch (sortBy) {
      case 'filings': sorted.sort((a, b) => b.filingCount - a.filingCount); break;
      case 'onsection': sorted.sort((a, b) => b.sameSectionCount - a.sameSectionCount); break;
      case 'name': sorted.sort((a, b) => (a.propertyName || '').localeCompare(b.propertyName || '')); break;
      case 'county': sorted.sort((a, b) => a.county.localeCompare(b.county)); break;
    }

    return sorted;
  }, [properties, search, countyFilter, distanceFilter, sortBy]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(['Property', 'County', 'Date', 'Type', 'Applicant', 'Case #', 'Status', 'Location', 'Distance', 'Source URL']);
    for (const p of filtered) {
      for (const f of p.filings) {
        rows.push([
          p.propertyName, p.county, f.docketDate || '', f.reliefType, f.applicant,
          f.caseNumber, f.status || '', formatTRS(f.section, f.township, f.range),
          f.distanceDescription, f.sourceUrl || '',
        ]);
      }
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'occ-filing-activity.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (properties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No OCC filing activity near your properties.</div>;
  }

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
    fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none',
  };

  // Derive date range text
  const dateRangeText = summary.dateRange?.earliest && summary.dateRange?.latest
    ? `${formatDate(summary.dateRange.earliest)} – ${formatDate(summary.dateRange.latest)}`
    : 'Last 12 months';

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search applicants, cases..."
          style={{ ...inputStyle, width: 200 }}
        />

        {/* Searchable county dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setCountyDropdownOpen(!countyDropdownOpen)}
            style={{
              ...inputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              minWidth: 140, color: countyFilter ? TEXT_DARK : SLATE,
            }}
          >
            <span style={{ flex: 1, textAlign: 'left' }}>{countyFilter || 'All Counties'}</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>{countyDropdownOpen ? '\u25B4' : '\u25BE'}</span>
          </button>
          {countyDropdownOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => { setCountyDropdownOpen(false); setCountySearch(''); }} />
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 51,
                background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 180, overflow: 'hidden',
              }}>
                <div style={{ padding: 6 }}>
                  <input
                    type="text"
                    value={countySearch}
                    onChange={(e) => setCountySearch(e.target.value)}
                    placeholder="Search counties..."
                    autoFocus
                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontSize: 12 }}
                  />
                </div>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  <button
                    onClick={() => { setCountyFilter(''); setCountyDropdownOpen(false); setCountySearch(''); }}
                    style={{
                      display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                      background: !countyFilter ? BG_MUTED : 'transparent', cursor: 'pointer',
                      fontSize: 13, textAlign: 'left', fontFamily: 'inherit', color: TEXT_DARK,
                    }}
                  >
                    All Counties
                  </button>
                  {filteredCounties.map(c => (
                    <button
                      key={c}
                      onClick={() => { setCountyFilter(c); setCountyDropdownOpen(false); setCountySearch(''); }}
                      style={{
                        display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                        background: countyFilter === c ? BG_MUTED : 'transparent', cursor: 'pointer',
                        fontSize: 13, textAlign: 'left', fontFamily: 'inherit', color: TEXT_DARK,
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <select value={distanceFilter} onChange={(e) => setDistanceFilter(e.target.value)} style={inputStyle}>
          <option value="">All Distances</option>
          <option value="same">Same Section</option>
          <option value="adjacent">Adjacent</option>
          <option value="nearby">Within 2 Twp</option>
        </select>

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={inputStyle}>
          <option value="filings">Most Filings</option>
          <option value="onsection">Most On-Section</option>
          <option value="name">By Name</option>
          <option value="county">By County</option>
        </select>

        <button onClick={exportCsv} style={{
          marginLeft: 'auto', padding: '6px 14px', border: `1px solid ${BORDER}`,
          borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#fff',
          color: TEXT_DARK, fontFamily: 'inherit',
        }}>
          Export CSV
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: SLATE }}>
          {filtered.length} of {properties.length} properties
        </span>
        <span style={{ fontSize: 11, color: SLATE }}>
          {dateRangeText}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((prop) => (
          <div key={prop.propertyId} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
            <button
              onClick={() => toggle(prop.propertyId)}
              style={{
                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke={SLATE} strokeWidth="2"
                  style={{ width: 14, height: 14, transition: 'transform 0.15s', transform: expanded.has(prop.propertyId) ? 'rotate(90deg)' : '' }}>
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>
                  {prop.propertyName || `Sec ${prop.section}-${prop.township}-${prop.range}`}
                </span>
                <Badge bg="#f1f5f9" color={SLATE} size="sm">{prop.county}</Badge>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: SLATE, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{prop.filingCount} filing{prop.filingCount !== 1 ? 's' : ''}</span>
                {prop.sameSectionCount > 0 && (
                  <Badge bg="#fee2e2" color="#991b1b" size="sm">{prop.sameSectionCount} on section</Badge>
                )}
              </div>
            </button>

            {expanded.has(prop.propertyId) && (
              <div style={{ borderTop: `1px solid ${BORDER}`, padding: 12 }}>
                <FilingsTable filings={prop.filings} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilingsTable({ filings }: { filings: OccFiling[] }) {
  const columns: Column<OccFiling>[] = useMemo(() => [
    {
      key: 'docketDate', label: 'Date', sortType: 'string', width: 'minmax(75px, 0.8fr)',
      render: (row) => <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(row.docketDate)}</span>,
    },
    {
      key: 'reliefType', label: 'Type', sortType: 'string', width: 'minmax(100px, 1.5fr)',
      render: (row) => reliefBadge(row.reliefType),
    },
    {
      key: 'applicant', label: 'Applicant', sortType: 'string', width: 'minmax(110px, 1.5fr)',
      render: (row) => <OperatorLink name={row.applicant} fontSize={13} fontWeight={500} />,
    },
    {
      key: 'caseNumber', label: 'Case #', sortType: 'string', width: 'minmax(90px, 1fr)', hideOnMobile: true,
      render: (row) => row.sourceUrl && /^https?:\/\//.test(row.sourceUrl) ? (
        <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ color: '#3b82f6', fontSize: 12, textDecoration: 'none' }}>{row.caseNumber}</a>
      ) : <span style={{ fontSize: 12 }}>{row.caseNumber || '—'}</span>,
    },
    {
      key: '_location', label: 'Location', sortType: 'string', width: 'minmax(90px, 1fr)', hideOnMobile: true,
      getValue: (row) => formatTRS(row.section, row.township, row.range),
      render: (row) => <span style={{ fontSize: 12, fontFamily: 'monospace', color: SLATE, whiteSpace: 'nowrap' }}>{formatTRS(row.section, row.township, row.range)}</span>,
    },
    {
      key: 'status', label: 'Status', sortType: 'string', width: 'minmax(70px, 0.8fr)', hideOnMobile: true,
      render: (row) => <span style={{ fontSize: 12, color: SLATE }}>{row.status || '—'}</span>,
    },
    {
      key: 'distanceTier', label: 'Distance', sortType: 'number', width: 'minmax(90px, 1fr)',
      render: (row) => distanceBadge(row.distanceTier, row.distanceDescription),
    },
  ], []);

  return (
    <SortableTable
      columns={columns}
      data={filings}
      defaultSort={{ key: 'docketDate', dir: 'desc' }}
      rowKey={(row) => row.caseNumber || row.docketDate}
      emptyMessage="No filings"
    />
  );
}

function CountiesTab({ counties }: { counties: OccFilingData['byCounty'] }) {
  if (counties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No county data available.</div>;
  }

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(['County', 'Filings', 'Latest Date', 'Top Filers', 'Filing Types']);
    for (const c of counties) {
      const filers = (c.topApplicants || []).map(a => `${a.name} (${a.count})`).join('; ');
      const types = Object.entries(c.filingTypes || {}).sort(([, a], [, b]) => b - a).map(([t, n]) => `${t} (${n})`).join('; ');
      rows.push([c.county, String(c.filingCount), c.latestDate || '', filers, types]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'occ-filings-by-county.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={exportCsv} style={{
          padding: '6px 14px', border: `1px solid ${BORDER}`, borderRadius: 6,
          fontSize: 13, cursor: 'pointer', background: '#fff', color: TEXT_DARK, fontFamily: 'inherit',
        }}>Export CSV</button>
      </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 12 }}>
      {counties.map((c) => {
        const topTypes = Object.entries(c.filingTypes || {}).sort(([, a], [, b]) => b - a).slice(0, 4);

        return (
          <div key={c.county} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK }}>{c.county}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{c.filingCount} filings</span>
            </div>

            {c.topApplicants?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Top Filers</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {c.topApplicants.slice(0, 3).map((a, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <OperatorLink name={a.name} fontSize={13} />
                      <span style={{ color: SLATE, fontSize: 12 }}>{a.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {topTypes.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Filing Types</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {topTypes.map(([type, count]) => (
                    <span key={type}>{reliefBadge(`${type} (${count})`)}</span>
                  ))}
                </div>
              </div>
            )}

            {c.latestDate && (
              <div style={{ fontSize: 11, color: SLATE, marginTop: 8 }}>
                Latest: {formatDate(c.latestDate)}
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}

function ResearchTab({ data }: { data: OccFilingData['marketResearch'] }) {
  if (!data) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No statewide research data available.</div>;
  }

  const maxCounty = Math.max(...(data.hottestCounties || []).map(c => c.count), 1);
  const maxFiler = Math.max(...(data.topFilers || []).map(f => f.count), 1);
  const filingTypes = Object.entries(data.filingTypeBreakdown || {}).sort(([, a], [, b]) => b - a);
  const maxType = filingTypes.length > 0 ? filingTypes[0][1] : 1;

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(['Category', 'Name', 'Count', 'Percentage']);
    for (const c of (data.hottestCounties || [])) {
      rows.push(['Hottest County', c.county, String(c.count), '']);
    }
    for (const f of (data.topFilers || [])) {
      rows.push(['Top Filer', f.applicant, String(f.count), '']);
    }
    for (const [type, count] of filingTypes) {
      const pct = data.totalStatewideFilings90d > 0 ? (count / data.totalStatewideFilings90d * 100).toFixed(1) + '%' : '';
      rows.push(['Filing Type', type, String(count), pct]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'occ-filings-research.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {data.totalStatewideFilings90d > 0 && (
          <span style={{ fontSize: 13, color: SLATE }}>
            {data.totalStatewideFilings90d.toLocaleString()} statewide filings in the last 90 days
          </span>
        )}
        <button onClick={exportCsv} style={{
          padding: '6px 14px', border: `1px solid ${BORDER}`, borderRadius: 6,
          fontSize: 13, cursor: 'pointer', background: '#fff', color: TEXT_DARK, fontFamily: 'inherit', marginLeft: 'auto',
        }}>Export CSV</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
        {/* Hottest counties */}
        {data.hottestCounties?.length > 0 && (
          <ResearchCard accent="#f59e0b" title="Hottest Counties" subtitle="90 days" col1="County" col2="Filings">
            {data.hottestCounties.map((c, i) => (
              <ResearchRow key={i} label={c.county} value={c.count} max={maxCounty} color="#f59e0b" />
            ))}
          </ResearchCard>
        )}

        {/* Top filers */}
        {data.topFilers?.length > 0 && (
          <ResearchCard accent="#3b82f6" title="Most Active Filers" subtitle="90 days" col1="Operator" col2="Filings">
            {data.topFilers.map((f, i) => (
              <ResearchRow key={i} label={f.applicant} value={f.count} max={maxFiler} color="#3b82f6"
                labelNode={<OperatorLink name={f.applicant} fontSize={13} />} />
            ))}
          </ResearchCard>
        )}

        {/* Filing type breakdown */}
        {filingTypes.length > 0 && (
          <ResearchCard accent="#8b5cf6" title="Filing Types" subtitle="90 days" col1="Type" col2="Count">
            {filingTypes.map(([type, count]) => {
              const pct = data.totalStatewideFilings90d > 0 ? Math.round(count / data.totalStatewideFilings90d * 100) : 0;
              return <ResearchRow key={type} label={type} value={count} max={maxType} color="#8b5cf6" suffix={`${pct}%`} />;
            })}
          </ResearchCard>
        )}
      </div>
    </div>
  );
}

function ResearchCard({ accent, title, subtitle, col1, col2, children }: {
  accent: string; title: string; subtitle: string; col1: string; col2: string; children: React.ReactNode;
}) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, background: `linear-gradient(135deg, ${accent}08, ${accent}04)` }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: accent, margin: 0 }}>{title}</h3>
        <span style={{ fontSize: 11, color: SLATE }}>{subtitle}</span>
      </div>
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 6px', borderBottom: `1px solid ${BORDER}` }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: SLATE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{col1}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: SLATE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{col2}</span>
        </div>
        {children}
      </div>
      <div style={{ height: 8 }} />
    </div>
  );
}

function ResearchRow({ label, value, max, color, suffix, labelNode }: {
  label: string; value: number; max: number; color: string; suffix?: string; labelNode?: React.ReactNode;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: TEXT_DARK }}>{labelNode || label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: TEXT_DARK }}>
          {value.toLocaleString()}
          {suffix && <span style={{ fontWeight: 400, fontSize: 11, color: SLATE, marginLeft: 4 }}>{suffix}</span>}
        </span>
      </div>
      <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, opacity: 0.5, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}
