import { useState, useMemo, useCallback } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchPoolingReport, fetchOperatorLookup } from '../../../api/intelligence';
import { useToast } from '../../../contexts/ToastContext';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { OperatorModal } from '../operators/OperatorModal';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { PoolingPropertyGroup, PoolingNearbyOrder, PoolingCountyAvg, PoolingReportData } from '../../../types/intelligence';

function csvEscape(s: string | null | undefined): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const exportBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: `1px solid ${BORDER}`,
  fontSize: 12, fontWeight: 600, color: TEXT_DARK, background: '#fff',
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};

function formatCurrency(v: number | null): string {
  if (v == null) return '—';
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

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
  const twpFmt = /[NSEW]$/i.test(twp) ? twp : twp + 'N';
  const rngFmt = /[NSEW]$/i.test(rng) ? rng : rng + 'W';
  return `${twpFmt}-${rngFmt}-${sec}`;
}

function distanceBadge(tier: number, desc: string) {
  if (tier === 0) return <Badge bg="#dcfce7" color="#166534" size="sm">Same Section</Badge>;
  if (tier === 1) return <Badge bg="#dbeafe" color="#1e40af" size="sm">Adjacent</Badge>;
  return <Badge bg="#f3f4f6" color="#374151" size="sm">{desc || 'Nearby'}</Badge>;
}

function formationName(f: { name: string } | string): string {
  return typeof f === 'string' ? f : f.name;
}

function bonusRange(opts: PoolingNearbyOrder['electionOptions']): string {
  if (!opts || opts.length === 0) return '—';
  const bonuses = opts.map(o => o.bonusPerAcre).filter((b): b is number => b != null && b > 0);
  if (bonuses.length === 0) return 'Participate';
  const min = Math.min(...bonuses);
  const max = Math.max(...bonuses);
  return min === max ? formatCurrency(min) + '/ac' : `${formatCurrency(min)}–${formatCurrency(max)}/ac`;
}

function fractionToDecimal(f: string): number {
  const parts = f.split('/');
  if (parts.length === 2) return parseInt(parts[0], 10) / parseInt(parts[1], 10);
  return parseFloat(f) || 0;
}

function royaltyRange(opts: PoolingNearbyOrder['electionOptions']): string {
  if (!opts || opts.length === 0) return '—';
  const fracs = opts.map(o => o.royaltyFraction).filter((f): f is string => f != null);
  if (fracs.length === 0) return '—';
  const unique = [...new Set(fracs)].sort((a, b) => fractionToDecimal(a) - fractionToDecimal(b));
  if (unique.length === 1) return unique[0];
  return `${unique[0]} – ${unique[unique.length - 1]}`;
}

export function PoolingReport() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [operatorModal, setOperatorModal] = useState<{ number: string; name: string } | null>(null);
  const { data, loading, error, refetch } = useReportData(fetchPoolingReport);

  const handleOperatorClick = useCallback((operatorName: string) => {
    fetchOperatorLookup(operatorName).then((result: { operator_number: string | null }) => {
      if (result.operator_number) {
        setOperatorModal({ number: result.operator_number, name: operatorName });
      }
    }).catch(() => {});
  }, []);

  if (loading) return <LoadingSkeleton columns={5} rows={6} />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { summary: s, byProperty, countyAverages, marketResearch } = data;
  const tabs = [
    { key: 'portfolio', label: 'My Portfolio', badge: byProperty.length },
    { key: 'markets', label: 'My Markets', badge: countyAverages.length },
    { key: 'research', label: 'Market Research' },
  ];

  return (
    <div>
      {/* HUD */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { value: String(s.totalNearbyOrders), label: 'Nearby Orders', detail: `${s.countyCount} counties` },
          { value: s.avgBonusPerAcre != null ? formatCurrency(s.avgBonusPerAcre) + '/ac' : '—', label: 'Avg Bonus', detail: s.bonusRange.min != null ? `${formatCurrency(s.bonusRange.min)}–${formatCurrency(s.bonusRange.max)}` : '' },
          { value: String(s.topOperators?.length || 0), label: 'Active Operators', detail: s.topOperators?.[0]?.name || '' },
          { value: String(s.countyCount), label: 'Your Counties', detail: s.dateRange?.latest ? `Latest: ${formatDate(s.dateRange.latest)}` : '' },
        ].map((b, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', background: BG_MUTED, borderRadius: 8,
            border: `1px solid ${BORDER}`, flex: '1 1 160px',
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: TEXT_DARK }}>{b.value}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK }}>{b.label}</div>
              <div style={{ fontSize: 11, color: SLATE }}>{b.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'portfolio' && <PortfolioTab properties={byProperty} onOperatorClick={handleOperatorClick} />}
      {activeTab === 'markets' && <MarketsTab counties={countyAverages} onOperatorClick={handleOperatorClick} />}
      {activeTab === 'research' && <ResearchTab data={marketResearch} onOperatorClick={handleOperatorClick} />}

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

function PortfolioTab({ properties, onOperatorClick }: { properties: PoolingPropertyGroup[]; onOperatorClick: (name: string) => void }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [countyFilter, setCountyFilter] = useState('');
  const [countySearch, setCountySearch] = useState('');
  const [countyDropdownOpen, setCountyDropdownOpen] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState('');
  const [sortBy, setSortBy] = useState('orders');

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
        p.nearbyOrders.some(o => (o.operator || o.applicant || '').toLowerCase().includes(q))
      );
    }

    if (countyFilter) {
      arr = arr.filter(p => p.county === countyFilter);
    }

    if (distanceFilter) {
      const tier = distanceFilter === 'same' ? 0 : distanceFilter === 'adjacent' ? 1 : 2;
      arr = arr.filter(p => p.nearbyOrders.some(o => o.distanceTier === tier));
    }

    const sorted = [...arr];
    switch (sortBy) {
      case 'orders': sorted.sort((a, b) => b.orderCount - a.orderCount); break;
      case 'bonus': sorted.sort((a, b) => (b.avgBonus ?? 0) - (a.avgBonus ?? 0)); break;
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

  const exportCsv = useCallback(() => {
    const header = 'Property,Property County,Order Date,Operator,Formation,Order Location,Distance,Max Bonus/Acre,Royalty Options,Case Number,Response Deadline';
    const rows: string[] = [];
    for (const prop of filtered) {
      for (const order of prop.nearbyOrders) {
        let maxBonus: number | null = null;
        const royaltyOpts: string[] = [];
        if (order.electionOptions?.length) {
          for (const opt of order.electionOptions) {
            if (opt.bonusPerAcre != null && (maxBonus === null || opt.bonusPerAcre > maxBonus)) maxBonus = opt.bonusPerAcre;
            if (opt.royaltyFraction) royaltyOpts.push(opt.royaltyFraction);
          }
        }
        const formations = (order.formations || []).map(f => formationName(f)).join('; ');
        rows.push([
          csvEscape(prop.propertyName),
          csvEscape(prop.county || ''),
          order.orderDate || '',
          csvEscape(order.operator || order.applicant || ''),
          csvEscape(formations),
          `${order.township}-${order.range}-${order.section}`,
          csvEscape(order.distanceDescription || ''),
          maxBonus != null ? String(maxBonus) : '',
          csvEscape([...new Set(royaltyOpts)].join('; ')),
          csvEscape(order.caseNumber || ''),
          order.responseDeadline || '',
        ].join(','));
      }
    }
    downloadCsv([header, ...rows].join('\n'), `pooling-rates-${new Date().toISOString().substring(0, 10)}.csv`);
    toast.success('CSV downloaded');
  }, [filtered, toast]);

  if (properties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No nearby pooling orders found.</div>;
  }

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 6,
    fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none',
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search properties, operators..."
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

        <select
          value={distanceFilter}
          onChange={(e) => setDistanceFilter(e.target.value)}
          style={inputStyle}
        >
          <option value="">All Distances</option>
          <option value="same">Same Section</option>
          <option value="adjacent">Adjacent</option>
          <option value="nearby">Within 2 Twp</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={inputStyle}
        >
          <option value="orders">Most Nearby Orders</option>
          <option value="bonus">Highest Avg Bonus</option>
          <option value="name">By Name</option>
          <option value="county">By County</option>
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: SLATE }}>{filtered.length} of {properties.length} properties</span>
          <button onClick={exportCsv} style={exportBtnStyle}>&#8615; Export CSV</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {filtered.map((prop) => (
        <div key={prop.propertyId} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
          {/* Property header — clickable */}
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
              <span style={{ fontWeight: 600 }}>{prop.orderCount} order{prop.orderCount !== 1 ? 's' : ''}</span>
              {prop.avgBonus != null && <span style={{ color: '#d97706', fontWeight: 600 }}>{formatCurrency(prop.avgBonus)}/ac</span>}
              {prop.sameSectionCount > 0 && <Badge bg="#dcfce7" color="#166534" size="sm">{prop.sameSectionCount} same section</Badge>}
              {prop.adjacentCount > 0 && <Badge bg="#dbeafe" color="#1e40af" size="sm">{prop.adjacentCount} adjacent</Badge>}
            </div>
          </button>

          {/* Expanded: order table */}
          {expanded.has(prop.propertyId) && (
            <div style={{ borderTop: `1px solid ${BORDER}`, padding: 12 }}>
              <OrdersTable orders={prop.nearbyOrders} onOperatorClick={onOperatorClick} />
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}

function OrdersTable({ orders, onOperatorClick }: { orders: PoolingNearbyOrder[]; onOperatorClick: (name: string) => void }) {
  const columns: Column<PoolingNearbyOrder>[] = useMemo(() => [
    {
      key: 'orderDate', label: 'Date', sortType: 'string', width: 'minmax(80px, 1fr)',
      render: (row) => <span style={{ fontSize: 12 }}>{formatDate(row.orderDate)}</span>,
    },
    {
      key: 'operator', label: 'Operator', sortType: 'string', width: 'minmax(100px, 1.5fr)',
      render: (row) => {
        const name = row.operator || row.applicant;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); onOperatorClick(name); }}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: 500, color: '#3b82f6', fontSize: 'inherit',
              textAlign: 'left',
            }}
          >
            {name}
          </button>
        );
      },
    },
    {
      key: '_formations', label: 'Formation', width: 'minmax(80px, 1.2fr)',
      getValue: (row) => row.formations?.length || 0,
      render: (row) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(row.formations || []).slice(0, 2).map((f, i) => (
            <Badge key={i} bg="#f1f5f9" color={SLATE} size="sm">{formationName(f)}</Badge>
          ))}
          {(row.formations || []).length > 2 && (
            <Badge bg="#f1f5f9" color={SLATE} size="sm">+{row.formations.length - 2}</Badge>
          )}
        </div>
      ),
    },
    {
      key: '_location', label: 'Location', sortType: 'string', width: 'minmax(80px, 1fr)',
      getValue: (row) => formatTRS(row.section, row.township, row.range),
      render: (row) => <span style={{ fontSize: 12, fontFamily: 'monospace', color: SLATE, whiteSpace: 'nowrap' }}>{formatTRS(row.section, row.township, row.range)}</span>,
    },
    {
      key: '_bonus', label: 'Bonus Range', width: 'minmax(90px, 1.2fr)',
      getValue: (row) => {
        const bonuses = (row.electionOptions || []).map(o => o.bonusPerAcre).filter((b): b is number => b != null && b > 0);
        return bonuses.length > 0 ? Math.max(...bonuses) : 0;
      },
      render: (row) => {
        const bonuses = (row.electionOptions || []).map(o => o.bonusPerAcre).filter((b): b is number => b != null && b > 0);
        const maxBonus = bonuses.length > 0 ? Math.max(...bonuses) : 0;
        const color = maxBonus >= 1500 ? '#ea580c' : maxBonus >= 500 ? '#d97706' : maxBonus > 0 ? '#ca8a04' : SLATE;
        return <span style={{ fontSize: 12, fontWeight: 600, color }}>{bonusRange(row.electionOptions)}</span>;
      },
    },
    {
      key: '_royalty', label: 'Royalty Range', width: 'minmax(70px, 1fr)',
      getValue: (row) => row.electionOptions?.[0]?.royaltyFraction || '',
      render: (row) => <span style={{ fontSize: 12 }}>{royaltyRange(row.electionOptions)}</span>,
    },
    {
      key: 'distanceTier', label: 'Distance', sortType: 'number', width: 'minmax(80px, 1fr)',
      render: (row) => distanceBadge(row.distanceTier, row.distanceDescription),
    },
  ], []);

  const renderExpanded = useCallback((row: PoolingNearbyOrder) => (
    <div style={{ padding: '8px 16px 12px' }}>
      {/* Order metadata */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 12, color: SLATE }}>
        <span><strong style={{ color: TEXT_DARK }}>Operator:</strong> {row.operator || row.applicant}</span>
        {row.caseNumber && <span><strong style={{ color: TEXT_DARK }}>Case:</strong> {row.caseNumber}</span>}
        <span><strong style={{ color: TEXT_DARK }}>Order Date:</strong> {formatDate(row.orderDate)}</span>
        {row.responseDeadline && <span><strong style={{ color: TEXT_DARK }}>Deadline:</strong> {formatDate(row.responseDeadline)}</span>}
        {row.wellType && <span><strong style={{ color: TEXT_DARK }}>Well Type:</strong> {row.wellType}</span>}
        {row.unitSizeAcres > 0 && <span><strong style={{ color: TEXT_DARK }}>Unit Size:</strong> {row.unitSizeAcres} acres</span>}
      </div>

      {/* Election options table */}
      {row.electionOptions && row.electionOptions.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
              <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: TEXT_DARK, fontSize: 12 }}>Option</th>
              <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: TEXT_DARK, fontSize: 12 }}>Type</th>
              <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 600, color: TEXT_DARK, fontSize: 12 }}>Bonus/Acre</th>
              <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: TEXT_DARK, fontSize: 12 }}>Royalty</th>
            </tr>
          </thead>
          <tbody>
            {row.electionOptions.map((opt, i) => (
              <tr key={i} style={{ borderBottom: i < row.electionOptions.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '6px 10px' }}>
                  <Badge bg="#e0e7ff" color="#3730a3" size="sm">{opt.optionNumber}</Badge>
                </td>
                <td style={{ padding: '6px 10px', color: TEXT_DARK }}>{opt.optionType}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: opt.bonusPerAcre && opt.bonusPerAcre > 0 ? '#d97706' : SLATE }}>
                  {opt.bonusPerAcre != null && opt.bonusPerAcre > 0 ? formatCurrency(opt.bonusPerAcre) : '—'}
                </td>
                <td style={{ padding: '6px 10px', color: TEXT_DARK }}>{opt.royaltyFraction || 'WI'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 13, color: SLATE }}>No election options available.</div>
      )}
    </div>
  ), []);

  return (
    <SortableTable
      columns={columns}
      data={orders}
      defaultSort={{ key: 'orderDate', dir: 'desc' }}
      rowKey={(row) => row.id || row.caseNumber}
      expandable
      renderExpandedRow={renderExpanded}
      emptyMessage="No orders"
    />
  );
}

function MarketsTab({ counties, onOperatorClick }: { counties: PoolingCountyAvg[]; onOperatorClick: (name: string) => void }) {
  const toast = useToast();

  const exportCsv = useCallback(() => {
    const header = 'County,Orders,Avg Bonus/Acre,Min Bonus,Max Bonus,Most Active Operator,Dominant Royalty,Formations';
    const rows = counties.map(ca => [
      csvEscape(ca.county),
      ca.orderCount || 0,
      ca.avgBonus != null ? ca.avgBonus : '',
      ca.minBonus != null ? ca.minBonus : '',
      ca.maxBonus != null ? ca.maxBonus : '',
      csvEscape(ca.mostActiveOperator || ''),
      csvEscape(ca.dominantRoyalty || ''),
      csvEscape((ca.formations || []).join('; ')),
    ].join(','));
    downloadCsv([header, ...rows].join('\n'), `pooling-markets-${new Date().toISOString().substring(0, 10)}.csv`);
    toast.success('CSV downloaded');
  }, [counties, toast]);

  if (counties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No county pooling data available.</div>;
  }

  // Global min/max for bonus range visualization
  const allBonuses = counties.flatMap(c => [c.minBonus, c.maxBonus]).filter((b): b is number => b != null);
  const globalMin = Math.min(...allBonuses, 0);
  const globalMax = Math.max(...allBonuses, 100);
  const globalRange = globalMax - globalMin || 1;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={exportCsv} style={exportBtnStyle}>&#8615; Export CSV</button>
      </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {counties.map((c) => {
        const rangeStart = c.minBonus != null ? ((c.minBonus - globalMin) / globalRange * 100) : 0;
        const rangeWidth = c.minBonus != null && c.maxBonus != null
          ? ((c.maxBonus - c.minBonus) / globalRange * 100) : 0;
        const avgPos = c.avgBonus != null ? ((c.avgBonus - globalMin) / globalRange * 100) : 50;
        const hasRange = c.minBonus != null && c.maxBonus != null;

        return (
          <div key={c.county} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK }}>{c.county}</span>
              <span style={{ fontSize: 12, color: SLATE }}>{c.orderCount} order{c.orderCount !== 1 ? 's' : ''}</span>
            </div>

            {/* Avg Bonus */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: SLATE }}>Avg Bonus/Acre</span>
              <span style={{ fontWeight: 600, color: TEXT_DARK }}>{c.avgBonus != null ? formatCurrency(c.avgBonus) : '—'}</span>
            </div>

            {/* Bonus range bar */}
            {hasRange && (
              <>
                <div style={{
                  position: 'relative', height: 6, borderRadius: 3,
                  background: '#e2e8f0', margin: '10px 0 6px', overflow: 'visible',
                }}>
                  {/* Range fill — gradient yellow to green */}
                  <div style={{
                    position: 'absolute', top: 0, height: '100%', borderRadius: 3,
                    background: 'linear-gradient(90deg, #fbbf24, #34d399)',
                    left: `${Math.max(rangeStart, 2)}%`,
                    width: `${Math.max(rangeWidth, 4)}%`,
                  }} />
                  {/* Average marker */}
                  <div style={{
                    position: 'absolute', top: -4,
                    left: `${avgPos}%`, transform: 'translateX(-50%)',
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#f59e0b', border: '2px solid #fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </div>
                {/* Min/max labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: SLATE, fontFamily: 'monospace', marginBottom: 10 }}>
                  <span>{formatCurrency(c.minBonus!)}</span>
                  <span>{formatCurrency(c.maxBonus!)}</span>
                </div>
              </>
            )}

            {/* Stats */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: SLATE }}>Most Active Operator</span>
              {c.mostActiveOperator ? (
                <button
                  onClick={() => onOperatorClick(c.mostActiveOperator!)}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontFamily: 'inherit', fontWeight: 600, color: '#3b82f6', fontSize: 'inherit',
                  }}
                >
                  {c.mostActiveOperator}
                </button>
              ) : (
                <span style={{ fontWeight: 600, color: TEXT_DARK }}>—</span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: SLATE }}>Dominant Royalty</span>
              <span style={{ fontWeight: 600, color: TEXT_DARK }}>{c.dominantRoyalty || '—'}</span>
            </div>

            {/* Formations */}
            {c.formations.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Active Formations</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {c.formations.slice(0, 3).map(f => (
                    <Badge key={f} bg="#f1f5f9" color={SLATE} size="sm">{f}</Badge>
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

function ResearchTab({ data, onOperatorClick }: { data: PoolingReportData['marketResearch'] | undefined; onOperatorClick: (name: string) => void }) {
  const toast = useToast();

  const exportCsv = useCallback(() => {
    if (!data) return;
    const header = 'Category,Name,Value,Detail';
    const rows: string[] = [];
    for (const f of (data.topFormations || [])) {
      rows.push(['Top Formation', csvEscape(f.name), String(f.avgBonus), 'Avg Bonus/Acre'].join(','));
    }
    for (const op of (data.topPayingOperators || [])) {
      rows.push(['Top Operator', csvEscape(op.name), String(op.avgBonus), `${op.orderCount} orders`].join(','));
    }
    for (const c of (data.hottestCounties || [])) {
      rows.push(['Hottest County', csvEscape(c.county), String(c.orderCount), 'orders (last 90 days)'].join(','));
    }
    downloadCsv([header, ...rows].join('\n'), `pooling-research-${new Date().toISOString().substring(0, 10)}.csv`);
    toast.success('CSV downloaded');
  }, [data, toast]);

  if (!data) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No statewide research data available.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={exportCsv} style={exportBtnStyle}>&#8615; Export CSV</button>
      </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {/* Top formations */}
      {data.topFormations?.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Top Formations by Bonus</h3>
          {data.topFormations.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.topFormations.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
              <span style={{ color: TEXT_DARK }}>{f.name}</span>
              <span style={{ fontWeight: 600, color: '#16a34a' }}>{formatCurrency(f.avgBonus)}/ac</span>
            </div>
          ))}
        </div>
      )}

      {/* Top paying operators */}
      {data.topPayingOperators?.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Top Paying Operators</h3>
          {data.topPayingOperators.map((o, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.topPayingOperators.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
              <button
                onClick={() => onOperatorClick(o.name)}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', color: '#3b82f6', fontSize: 'inherit', textAlign: 'left',
                }}
              >
                {o.name}
              </button>
              <span style={{ fontWeight: 600, color: '#16a34a' }}>{formatCurrency(o.avgBonus)}/ac</span>
            </div>
          ))}
        </div>
      )}

      {/* Hottest counties */}
      {data.hottestCounties?.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Hottest Counties (90 days)</h3>
          {data.hottestCounties.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.hottestCounties.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
              <span style={{ color: TEXT_DARK }}>{c.county}</span>
              <span style={{ fontWeight: 600, color: SLATE }}>{c.orderCount} orders</span>
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}

