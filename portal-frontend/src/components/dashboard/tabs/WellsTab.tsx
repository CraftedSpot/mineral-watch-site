import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWells } from '../../../hooks/useWells';
import { useModal } from '../../../contexts/ModalContext';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { formatTRS, formatPhone, getWellStatusColor, formatDecimal } from '../../../lib/helpers';
import { formatProdMonth, computeDataHorizon, getProductionStatus } from '../../../lib/production-utils';
import { discoverWellsPreview } from '../../../api/matching';
import { DiscoverWellsModal } from '../../modals/DiscoverWellsModal';
import { WellLinkCounts } from '../../ui/LinkCounts';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { EmptyState } from '../../ui/EmptyState';
import { BulkActionBar } from '../../ui/BulkActionBar';
import { MODAL_TYPES, BORDER, SLATE, DARK, TEAL } from '../../../lib/constants';
import type { WellRecord } from '../../../types/dashboard';
import type { DiscoverWellsPreviewResponse } from '../../../api/matching';

// Estimated row height for collapsed row (3 lines + padding)
const ROW_H = 80;
const VIRTUAL_THRESHOLD = 100;

// CSS grid columns: checkbox | well info | operator | links
const GRID_COLS = '40px 1fr 1fr 140px';
const GRID_COLS_MOBILE = '36px 1fr';

// Status filter options (matches vanilla dashboard-shell.html)
const FILTER_OPTIONS = [
  { value: 'all', label: 'All Wells' },
  { value: 'active', label: 'Producing' },
  { value: 'idle', label: 'Idle' },
  { value: 'no_data', label: 'No Production Data' },
];

// Sort options (matches vanilla dashboard-shell.html exactly)
const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Well Name' },
  { value: 'legal-asc', label: 'Legal Description' },
  { value: 'operator-asc', label: 'Operator' },
  { value: 'formation-asc', label: 'Formation' },
  { value: 'direction-asc', label: 'Direction (H/V)' },
  { value: 'boe-desc', label: 'Lifetime BOE' },
  { value: 'lastprod-desc', label: 'Last Reported' },
  { value: 'properties-desc', label: 'Properties' },
  { value: 'documents-desc', label: 'Documents' },
  { value: 'filings-desc', label: 'OCC Filings' },
  { value: 'date-desc', label: 'Recently Added' },
  { value: 'nri-desc', label: 'NRI Decimal' },
];

/** Parse township: "09N" → { num: 9, dir: 'n' } */
function parseTwp(twp: string | undefined): { num: number; dir: string } {
  const m = (twp || '').match(/T?(\d+)([NS])?/i);
  return m ? { num: parseInt(m[1]), dir: (m[2] || '').toLowerCase() } : { num: 0, dir: '' };
}

/** Parse range: "05W" → { num: 5, dir: 'w' } */
function parseRng(rng: string | undefined): { num: number; dir: string } {
  const m = (rng || '').match(/R?(\d+)([EW])?/i);
  return m ? { num: parseInt(m[1]), dir: (m[2] || '').toLowerCase() } : { num: 0, dir: '' };
}

function isHorizontal(w: WellRecord): boolean {
  return !!(w.lateral_length && Number(w.lateral_length) > 0);
}

function wellBoe(w: WellRecord): number {
  return (w.otc_total_oil || 0) + ((w.otc_total_gas || 0) / 6);
}

/** Sort comparator matching vanilla sortWells exactly */
function compareWells(a: WellRecord, b: WellRecord, field: string, direction: 'asc' | 'desc'): number {
  const mul = direction === 'asc' ? 1 : -1;
  switch (field) {
    case 'name': {
      const av = (a.well_name || '').toLowerCase();
      const bv = (b.well_name || '').toLowerCase();
      return av < bv ? -1 * mul : av > bv ? 1 * mul : 0;
    }
    case 'legal': {
      const ac = (a.county || '').toLowerCase(), bc = (b.county || '').toLowerCase();
      if (ac !== bc) return ac < bc ? -1 * mul : 1 * mul;
      const at = parseTwp(a.township), bt = parseTwp(b.township);
      if (at.num !== bt.num) return (at.num - bt.num) * mul;
      if (at.dir !== bt.dir) return at.dir < bt.dir ? -1 * mul : 1 * mul;
      const ar = parseRng(a.range), br = parseRng(b.range);
      if (ar.num !== br.num) return (ar.num - br.num) * mul;
      if (ar.dir !== br.dir) return ar.dir < br.dir ? -1 * mul : 1 * mul;
      return ((parseInt(a.section) || 0) - (parseInt(b.section) || 0)) * mul;
    }
    case 'operator': {
      const av = (a.operator || '').toLowerCase(), bv = (b.operator || '').toLowerCase();
      return av < bv ? -1 * mul : av > bv ? 1 * mul : 0;
    }
    case 'formation': {
      const av = (a.formation_canonical || a.formation_name || '').toLowerCase();
      const bv = (b.formation_canonical || b.formation_name || '').toLowerCase();
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return av < bv ? -1 * mul : av > bv ? 1 * mul : 0;
    }
    case 'direction': {
      const ah = isHorizontal(a) ? 0 : 1, bh = isHorizontal(b) ? 0 : 1;
      if (ah !== bh) return (ah - bh) * mul;
      return (a.well_name || '').toLowerCase() < (b.well_name || '').toLowerCase() ? -1 : 1;
    }
    case 'boe':
      return (wellBoe(a) - wellBoe(b)) * mul;
    case 'lastprod':
      return ((a.otc_last_prod_month || '') < (b.otc_last_prod_month || '') ? -1 : 1) * mul;
    case 'properties':
      return ((a._linkCounts?.properties || 0) - (b._linkCounts?.properties || 0)) * mul;
    case 'documents':
      return ((a._linkCounts?.documents || 0) - (b._linkCounts?.documents || 0)) * mul;
    case 'filings':
      return ((a._linkCounts?.filings || 0) - (b._linkCounts?.filings || 0)) * mul;
    case 'date':
      return ((a.createdTime || '') < (b.createdTime || '') ? -1 : 1) * mul;
    case 'nri':
      return ((a.ri_nri || 0) - (b.ri_nri || 0)) * mul;
    default:
      return 0;
  }
}

export function WellsTab() {
  const { data: wells, loading, reload } = useWells();
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();
  const isMobile = useIsMobile();

  const [search, setSearch] = useState('');
  const [filterValue, setFilterValue] = useState('all');
  const [sortValue, setSortValue] = useState('name-asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);
  const lastClickedRef = useRef<number>(-1);

  // Discover Wells state
  const [discoverState, setDiscoverState] = useState<'idle' | 'scanning'>('idle');
  const [discoverModalOpen, setDiscoverModalOpen] = useState(false);
  const [discoverData, setDiscoverData] = useState<DiscoverWellsPreviewResponse | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup scan interval on unmount
  useEffect(() => {
    return () => { if (scanIntervalRef.current) clearInterval(scanIntervalRef.current); };
  }, []);

  // Compute data horizon for production status
  const dataHorizon = useMemo(() => computeDataHorizon(wells), [wells]);

  // Filter
  const filteredData = useMemo(() => {
    let data = wells;

    // Status filter
    if (filterValue !== 'all') {
      data = data.filter((w) => getProductionStatus(w, dataHorizon) === filterValue);
    }

    // Search
    if (search) {
      const term = search.toLowerCase();
      data = data.filter((w) => {
        const searchable = [
          w.well_name || '',
          w.operator || '',
          w.apiNumber || '',
          w.county || '',
          w.user_well_code || '',
        ].join(' ').toLowerCase();
        return searchable.includes(term);
      });
    }

    return data;
  }, [wells, filterValue, search, dataHorizon]);

  // Sort
  const sortedData = useMemo(() => {
    const dash = sortValue.lastIndexOf('-');
    const field = sortValue.substring(0, dash);
    const dir = sortValue.substring(dash + 1) as 'asc' | 'desc';
    return [...filteredData].sort((a, b) => compareWells(a, b, field, dir));
  }, [filteredData, sortValue]);

  // Virtualizer — uses measureElement for dynamic row heights (expanded rows)
  const useVirtual = sortedData.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: sortedData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  const handleAddWell = useCallback(() => {
    modal.open(MODAL_TYPES.ADD_WELL, {
      onComplete: () => reload(),
    });
  }, [modal, reload]);

  const handleDiscover = useCallback(async () => {
    setDiscoverState('scanning');
    setScanElapsed(0);
    scanIntervalRef.current = setInterval(() => setScanElapsed((s) => s + 1), 1000);
    try {
      const res = await discoverWellsPreview();
      if (res.wells.length === 0) {
        toast.info('No new wells found at your property locations');
      } else {
        setDiscoverData(res);
        setDiscoverModalOpen(true);
      }
    } catch {
      toast.error('Discovery scan failed. Please try again.');
    } finally {
      setDiscoverState('idle');
      if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
      setScanElapsed(0);
    }
  }, [toast]);

  const handleDiscoverComplete = useCallback(() => {
    toast.success('Wells added and linked to your properties');
    setDiscoverModalOpen(false);
    setDiscoverData(null);
    reload();
  }, [toast, reload]);

  const openWellModal = useCallback((w: WellRecord) => {
    modal.open(MODAL_TYPES.WELL, {
      wellId: w.id,
      apiNumber: w.apiNumber,
      wellName: w.well_name,
    });
  }, [modal]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent, index: number, id: string) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedRef.current !== -1) {
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);
      const next = new Set(selected);
      const adding = !selected.has(id);
      for (let i = start; i <= end; i++) {
        const rowId = sortedData[i].id;
        if (adding) next.add(rowId);
        else next.delete(rowId);
      }
      setSelected(next);
    } else {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelected(next);
    }
    lastClickedRef.current = index;
  }, [selected, sortedData]);

  const handleSelectAll = useCallback(() => {
    if (selected.size === sortedData.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedData.map((w) => w.id)));
    }
  }, [selected.size, sortedData]);

  const handleBulkDelete = useCallback(async () => {
    const count = selected.size;
    if (!count) return;
    const ok = await confirm(`Delete ${count} well${count === 1 ? '' : 's'}? This cannot be undone.`, { destructive: true, icon: 'trash' });
    if (!ok) return;
    try {
      const res = await fetch('/api/wells/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`Deleted ${count} well${count === 1 ? '' : 's'}`);
      setSelected(new Set());
      reload();
    } catch {
      toast.error('Failed to delete wells');
    }
  }, [selected, confirm, toast, reload]);

  if (loading) return <LoadingSkeleton columns={3} />;

  const gridCols = isMobile ? GRID_COLS_MOBILE : GRID_COLS;

  // Build row items — virtual or plain
  const vRows = useVirtual
    ? virtualizer.getVirtualItems()
    : sortedData.map((_, i) => ({ index: i, start: i * ROW_H, size: ROW_H, key: i }));

  return (
    <div style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      {/* Toolbar */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search wells..."
            style={{
              width: '100%', padding: '8px 12px',
              border: `1px solid ${BORDER}`, borderRadius: 6,
              fontSize: 13, outline: 'none',
              fontFamily: "'Inter', 'DM Sans', sans-serif",
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
              style={{ ...dropdownStyle, flex: 1, minWidth: 0 }}>
              {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={sortValue} onChange={(e) => setSortValue(e.target.value)}
              style={{ ...dropdownStyle, flex: 1, minWidth: 0 }}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: SLATE }}>
              {(search || filterValue !== 'all') ? `${sortedData.length} of ${wells.length}` : `${wells.length} wells`}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={handleDiscover}
                disabled={discoverState === 'scanning'}
                style={{
                  padding: '8px 12px', fontSize: 13, fontWeight: 500,
                  border: `1px solid ${BORDER}`, borderRadius: 6,
                  background: '#fff', color: '#374151',
                  cursor: discoverState === 'scanning' ? 'wait' : 'pointer',
                  fontFamily: "'Inter', 'DM Sans', sans-serif",
                  whiteSpace: 'nowrap',
                  opacity: discoverState === 'scanning' ? 0.7 : 1,
                }}
              >
                {discoverState === 'scanning'
                  ? `Scanning...${scanElapsed >= 3 ? ` (${scanElapsed}s)` : ''}`
                  : 'Discover'}
              </button>
              <button onClick={handleAddWell} style={{
                background: TEAL, color: '#fff', border: 'none',
                borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'Inter', 'DM Sans', sans-serif",
                whiteSpace: 'nowrap',
              }}>
                + Add Well
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search wells by name, operator, API, or county..."
            style={{
              flex: 1, maxWidth: 320, padding: '8px 12px',
              border: `1px solid ${BORDER}`, borderRadius: 6,
              fontSize: 13, outline: 'none',
              fontFamily: "'Inter', 'DM Sans', sans-serif",
            }}
          />
          <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)} style={dropdownStyle}>
            {FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={sortValue} onChange={(e) => setSortValue(e.target.value)} style={dropdownStyle}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {(search || filterValue !== 'all') && (
            <span style={{ fontSize: 12, color: SLATE }}>
              {sortedData.length} of {wells.length}
            </span>
          )}
          <button
            onClick={handleDiscover}
            disabled={discoverState === 'scanning'}
            style={{
              marginLeft: 'auto', padding: '8px 14px', fontSize: 13, fontWeight: 500,
              border: `1px solid ${BORDER}`, borderRadius: 6,
              background: '#fff', color: '#374151',
              cursor: discoverState === 'scanning' ? 'wait' : 'pointer',
              fontFamily: "'Inter', 'DM Sans', sans-serif",
              whiteSpace: 'nowrap',
              opacity: discoverState === 'scanning' ? 0.7 : 1,
            }}
          >
            {discoverState === 'scanning'
              ? `Scanning...${scanElapsed >= 3 ? ` (${scanElapsed}s)` : ''}`
              : 'Discover Wells'}
          </button>
          {discoverState === 'scanning' && (
            <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>
              This may take a moment...
            </span>
          )}
          <button
            onClick={handleAddWell}
            style={{
              background: TEAL, color: '#fff', border: 'none',
              borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'Inter', 'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            + Add Well
          </button>
        </div>
      )}

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <button
            onClick={handleBulkDelete}
            style={{
              background: '#dc2626', color: '#fff', border: 'none',
              padding: '6px 14px', borderRadius: 4, fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Delete Selected
          </button>
        </BulkActionBar>
      )}

      {sortedData.length === 0 ? (
        <EmptyState
          title={search || filterValue !== 'all' ? 'No results found' : 'No wells yet'}
          description={search ? `No matches for "${search}"` : 'Add your first well API to start monitoring.'}
        />
      ) : (
        <div
          ref={parentRef}
          style={{
            borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'auto',
            maxHeight: useVirtual ? 'calc(100vh - 300px)' : undefined,
          }}
        >
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: gridCols,
            background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1,
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === sortedData.length}
                onChange={handleSelectAll}
                style={{ cursor: 'pointer' }}
              />
            </div>
            {isMobile ? (
              <div style={thStyle}>Well</div>
            ) : (
              <>
                <div style={thStyle}>Well Information</div>
                <div style={thStyle}>Operator Contact</div>
                <div style={{ ...thStyle, textAlign: 'right' }}>Links</div>
              </>
            )}
          </div>

          {/* Body */}
          <div style={useVirtual ? {
            height: virtualizer.getTotalSize(), position: 'relative',
          } : undefined}>
            {vRows.map((vRow) => {
              const w = sortedData[vRow.index];
              const isSelected = selected.has(w.id);
              const formation = w.formation_canonical || w.formation_name || '';
              const hz = isHorizontal(w);
              const lastProd = w.otc_last_prod_month ? formatProdMonth(w.otc_last_prod_month) : '';
              const status = w.well_status || '\u2014';
              const statusColor = getWellStatusColor(status);
              const county = (w.county || '').replace(/^\d+-/, '');
              const location = county
                ? (w.section && w.township && w.range
                  ? `${county} \u2022 ${formatTRS(w.section, w.township, w.range)}`
                  : county)
                : '';

              // Extra detail parts (formation, last prod, direction)
              const extras: string[] = [];
              if (lastProd) extras.push(`Last: ${lastProd}`);
              if (formation) extras.push(formation);
              if (hz) extras.push('Horizontal');
              else if (w.measured_total_depth || w.true_vertical_depth || w.well_type) extras.push('Vertical');

              return (
                <div
                  key={w.id}
                  data-index={vRow.index}
                  ref={useVirtual ? virtualizer.measureElement : undefined}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? '#f0f9ff' : vRow.index % 2 === 0 ? '#fff' : '#fafbfc',
                    borderBottom: `1px solid ${BORDER}`,
                    fontSize: 13,
                    ...(useVirtual ? {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vRow.start}px)`,
                    } : {}),
                  }}
                >
                  <div
                    style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'start' }}
                    onClick={() => openWellModal(w)}
                  >
                    {/* Checkbox */}
                    <div
                      style={{ padding: '10px 8px', display: 'flex', alignItems: 'start', justifyContent: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(e) => handleCheckboxClick(e as unknown as React.MouseEvent, vRow.index, w.id)}
                        onChange={() => {}}
                        style={{ cursor: 'pointer' }}
                      />
                    </div>

                    {isMobile ? (
                      /* Mobile: merged single column */
                      <div style={{ padding: '10px 12px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <strong style={{ color: DARK, fontSize: 14 }}>{w.well_name || 'Unknown'}</strong>
                          {w.tracking_source === 'discovered' && (
                            <span style={{
                              fontSize: 10, background: '#dbeafe', color: '#1e40af',
                              padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                            }}>Auto</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
                          {w.apiNumber && <><span>{w.apiNumber}</span> &middot; </>}
                          <span style={{ color: statusColor, fontWeight: 600 }}>{status}</span>
                          {location && <> &middot; <span>{location}</span></>}
                        </div>
                        {extras.length > 0 && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                            {extras.map((ex, i) => (
                              <span key={i}>
                                {i > 0 && ' \u2022 '}
                                <span style={ex === 'Horizontal' ? { color: '#2563eb' } : undefined}>{ex}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {w.operator && (
                          <div style={{ fontSize: 12, color: SLATE, marginTop: 3 }}>
                            Op: <strong style={{ color: DARK }}>{w.operator}</strong>
                          </div>
                        )}
                        {w.ri_nri != null && (
                          <div style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>
                            <span style={{ fontWeight: 600 }}>NRI</span>{' '}
                            <span style={{ fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace", fontSize: 11 }}>
                              {formatDecimal(w.ri_nri)}
                            </span>
                          </div>
                        )}
                        <div style={{ marginTop: 4 }}>
                          <WellLinkCounts counts={w._linkCounts} />
                        </div>
                      </div>
                    ) : (
                      /* Desktop: 3 separate columns */
                      <>
                        {/* Well Information */}
                        <div style={{ padding: '8px 12px', minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong style={{ color: DARK }}>{w.well_name || 'Unknown'}</strong>
                            {w.tracking_source === 'discovered' && (
                              <span style={{
                                fontSize: 10, background: '#dbeafe', color: '#1e40af',
                                padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                              }}>
                                Auto-discovered
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
                            {w.apiNumber && <><span>{w.apiNumber}</span> &middot; </>}
                            <span style={{ color: statusColor, fontWeight: 600 }}>{status}</span>
                            {location && <> &middot; <span>{location}</span></>}
                          </div>
                          {extras.length > 0 && (
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                              {extras.map((ex, i) => (
                                <span key={i}>
                                  {i > 0 && ' \u2022 '}
                                  <span style={ex === 'Horizontal' ? { color: '#2563eb' } : undefined}>{ex}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          {w.ri_nri != null && (
                            <div style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>
                              <span style={{ fontWeight: 600 }}>NRI</span>{' '}
                              <span style={{ fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace", fontSize: 11 }}>
                                {formatDecimal(w.ri_nri)}
                              </span>
                              {w.wi_nri != null && (
                                <span style={{ color: '#94a3b8', marginLeft: 6 }}>
                                  WI {formatDecimal(w.wi_nri)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Operator Contact */}
                        <div style={{ padding: '8px 12px', minWidth: 0 }}>
                          <strong style={{ color: DARK }}>{w.operator || '\u2014'}</strong>
                          {(w.operator_phone || w.operator_contact) && (
                            <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
                              {w.operator_phone && formatPhone(w.operator_phone)}
                              {w.operator_phone && w.operator_contact && ' \u2022 '}
                              {w.operator_contact}
                            </div>
                          )}
                        </div>

                        {/* Links */}
                        <div style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <WellLinkCounts counts={w._linkCounts} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Discover Wells Modal */}
      {discoverModalOpen && discoverData && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
            onClick={() => { setDiscoverModalOpen(false); setDiscoverData(null); }}
          />
          <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 'calc(100vw - 40px)', padding: '0 20px', boxSizing: 'border-box', display: 'flex', justifyContent: 'center' }}>
            <DiscoverWellsModal
              data={discoverData}
              onClose={() => { setDiscoverModalOpen(false); setDiscoverData(null); }}
              onComplete={handleDiscoverComplete}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left',
  fontWeight: 600, color: '#475569', fontSize: 11,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  userSelect: 'none', whiteSpace: 'nowrap',
};

const dropdownStyle: React.CSSProperties = {
  padding: '8px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, fontFamily: "'Inter', 'DM Sans', sans-serif",
  background: '#fff', cursor: 'pointer', minWidth: 160,
};
