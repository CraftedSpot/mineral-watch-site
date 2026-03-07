import { useState, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BORDER, SLATE, BG_MUTED, TABLE_ROW_HEIGHT, VIRTUAL_THRESHOLD } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';
import { LoadingSkeleton } from './LoadingSkeleton';
import { EmptyState } from './EmptyState';
import { BulkActionBar } from './BulkActionBar';
import { Select } from './FormField';
import type { ColumnDef, DataTableProps } from './DataTableTypes';

interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

/** Build CSS grid-template-columns from column defs + selectable flag */
function buildGridTemplate<T>(columns: ColumnDef<T>[], selectable: boolean, mobile: boolean): string {
  const colWidths = columns.map((col) => {
    const w = mobile && col.mobileWidth != null ? col.mobileWidth : col.width;
    if (w) return typeof w === 'number' ? `${w}px` : w;
    if (col.minWidth) return `minmax(${col.minWidth}px, 1fr)`;
    return '1fr';
  });
  return selectable ? `40px ${colWidths.join(' ')}` : colWidths.join(' ');
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  rowHeight = TABLE_ROW_HEIGHT,
  virtualThreshold = VIRTUAL_THRESHOLD,
  onRowClick,
  getRowId,
  selectable = false,
  selectedIds: externalSelected,
  onSelectionChange,
  searchable = false,
  searchPlaceholder = 'Search...',
  defaultSort,
  sortDropdown,
  filterDropdown,
  customComparators,
  emptyTitle,
  emptyDescription,
  emptyAction,
  bulkActions,
  transformData,
  getRowStyle,
  toolbarActions,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(defaultSort || null);
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);
  const lastClickedRef = useRef<number>(-1);
  const isMobile = useIsMobile();

  const selected = externalSelected ?? internalSelected;
  const setSelected = onSelectionChange ?? setInternalSelected;

  // Filter columns for mobile — hide columns marked hideOnMobile
  const visibleColumns = useMemo(
    () => isMobile ? columns.filter(c => !c.hideOnMobile) : columns,
    [columns, isMobile]
  );

  const gridTemplate = useMemo(() => buildGridTemplate(visibleColumns, selectable, isMobile), [visibleColumns, selectable, isMobile]);

  // Filter — use ALL columns for search (even hidden ones)
  const filteredData = useMemo(() => {
    if (!search) return data;
    const term = search.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        if (!col.searchable) return false;
        const val = col.getValue
          ? col.getValue(row)
          : String((row as Record<string, unknown>)[col.key] ?? '');
        return val.toLowerCase().includes(term);
      })
    );
  }, [data, search, columns]);

  // Sort
  const sortedData = useMemo(() => {
    if (!sort) return filteredData;
    const col = columns.find((c) => c.key === sort.key || c.sortKey === sort.key);
    const customCmp = customComparators?.[sort.key];
    return [...filteredData].sort((a, b) => {
      let cmp: number;
      if (col?.compare) {
        cmp = col.compare(a, b);
      } else if (customCmp) {
        cmp = customCmp(a, b);
      } else {
        const aVal = col?.getValue
          ? col.getValue(a)
          : String((a as Record<string, unknown>)[sort.key] ?? '');
        const bVal = col?.getValue
          ? col.getValue(b)
          : String((b as Record<string, unknown>)[sort.key] ?? '');
        cmp = aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
      }
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sort, columns, customComparators]);

  // Transform (e.g. grouping) — runs after search+sort, before render
  const displayData = useMemo(() => {
    return transformData ? transformData(sortedData) : sortedData;
  }, [sortedData, transformData]);

  // Virtual
  const useVirtual = displayData.length > virtualThreshold;
  const virtualizer = useVirtualizer({
    count: displayData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  // Toggle sort
  const toggleSort = useCallback((col: ColumnDef<T>) => {
    const key = col.sortKey || col.key;
    setSort((prev) => {
      if (prev?.key === key) {
        return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
      }
      return { key, direction: 'asc' };
    });
  }, []);

  // Shift+click selection
  const handleCheckboxClick = useCallback((e: React.MouseEvent, index: number, id: string) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedRef.current !== -1) {
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);
      const next = new Set(selected);
      const adding = !selected.has(id);
      for (let i = start; i <= end; i++) {
        const rowId = getRowId(displayData[i]);
        if (adding) next.add(rowId);
        else next.delete(rowId);
      }
      setSelected(next);
    } else {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    }
    lastClickedRef.current = index;
  }, [selected, setSelected, displayData, getRowId]);

  // Select all
  const handleSelectAll = useCallback(() => {
    if (selected.size === displayData.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(displayData.map(getRowId)));
    }
  }, [selected.size, displayData, getRowId, setSelected]);

  // Sort indicator
  const sortIndicator = (col: ColumnDef<T>) => {
    const key = col.sortKey || col.key;
    if (sort?.key !== key) return null;
    return <span style={{ marginLeft: 4, fontSize: 10 }}>{sort.direction === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  };

  if (loading) {
    return <LoadingSkeleton columns={visibleColumns.length} />;
  }

  const cellPadding = isMobile ? '8px 10px' : '10px 16px';

  const vRows = useVirtual
    ? virtualizer.getVirtualItems()
    : displayData.map((_, i) => ({ index: i, start: i * rowHeight, size: rowHeight, key: i }));

  return (
    <div style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      {/* Search + Dropdowns */}
      {isMobile ? (
        /* Mobile toolbar: stacked layout */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {searchable && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                width: '100%', padding: '8px 12px',
                border: `1px solid ${BORDER}`, borderRadius: 6,
                fontSize: 13, outline: 'none',
                fontFamily: "'Inter', 'DM Sans', sans-serif",
              }}
            />
          )}
          {filterDropdown && (
            <Select
              value={filterDropdown.value}
              onChange={(e) => filterDropdown.onChange(e.target.value)}
              style={{ width: '100%', fontSize: 13 }}
            >
              {filterDropdown.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          )}
          {sortDropdown && (
            <Select
              value={sortDropdown.value}
              onChange={(e) => {
                const val = e.target.value;
                sortDropdown.onChange(val);
                const dash = val.lastIndexOf('-');
                if (dash > 0) {
                  const key = val.substring(0, dash);
                  const dir = val.substring(dash + 1) as 'asc' | 'desc';
                  setSort({ key, direction: dir });
                }
              }}
              style={{ width: '100%', fontSize: 13 }}
            >
              {sortDropdown.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: SLATE, whiteSpace: 'nowrap' }}>
              {search ? `${displayData.length} of ${data.length}` : `${data.length} ${data.length === 1 ? 'record' : 'records'}`}
            </span>
            {toolbarActions}
          </div>
        </div>
      ) : (
        /* Desktop toolbar: horizontal row */
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
          {searchable && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                flex: 1, maxWidth: 240, padding: '8px 12px',
                border: `1px solid ${BORDER}`, borderRadius: 6,
                fontSize: 13, outline: 'none',
                fontFamily: "'Inter', 'DM Sans', sans-serif",
              }}
            />
          )}
          {filterDropdown && (
            <Select
              value={filterDropdown.value}
              onChange={(e) => filterDropdown.onChange(e.target.value)}
              style={{ minWidth: 160, fontSize: 13 }}
            >
              {filterDropdown.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          )}
          {sortDropdown && (
            <Select
              value={sortDropdown.value}
              onChange={(e) => {
                const val = e.target.value;
                sortDropdown.onChange(val);
                const dash = val.lastIndexOf('-');
                if (dash > 0) {
                  const key = val.substring(0, dash);
                  const dir = val.substring(dash + 1) as 'asc' | 'desc';
                  setSort({ key, direction: dir });
                }
              }}
              style={{ minWidth: 160, fontSize: 13 }}
            >
              {sortDropdown.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          )}
          <span style={{ fontSize: 12, color: SLATE, whiteSpace: 'nowrap' }}>
            {search ? `${displayData.length} of ${data.length}` : `${data.length} ${data.length === 1 ? 'record' : 'records'}`}
          </span>
          {toolbarActions}
        </div>
      )}

      {selected.size > 0 && bulkActions && (
        <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
          {bulkActions}
        </BulkActionBar>
      )}

      {displayData.length === 0 ? (
        <EmptyState
          title={search ? 'No results found' : emptyTitle}
          description={search ? `No matches for "${search}"` : emptyDescription}
          action={search ? undefined : emptyAction}
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
            display: 'grid', gridTemplateColumns: gridTemplate,
            background: BG_MUTED, position: 'sticky', top: 0, zIndex: 1,
            borderBottom: `1px solid ${BORDER}`,
          }}>
            {selectable && (
              <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === displayData.length}
                  onChange={handleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </div>
            )}
            {visibleColumns.map((col) => (
              <div
                key={col.key}
                onClick={col.sortable ? () => toggleSort(col) : undefined}
                style={{
                  padding: cellPadding, textAlign: col.headerAlign || 'left',
                  fontWeight: 600, color: '#475569', fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  cursor: col.sortable ? 'pointer' : 'default',
                  userSelect: 'none', whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                {col.label}{sortIndicator(col)}
              </div>
            ))}
          </div>

          {/* Body */}
          <div style={useVirtual ? {
            height: virtualizer.getTotalSize(), position: 'relative',
          } : undefined}>
            {vRows.map((vRow) => {
              const row = displayData[vRow.index];
              const id = getRowId(row);
              const isSelected = selected.has(id);

              return (
                <div
                  key={id}
                  data-index={vRow.index}
                  ref={useVirtual ? virtualizer.measureElement : undefined}
                  onClick={() => onRowClick?.(row)}
                  style={{
                    display: 'grid', gridTemplateColumns: gridTemplate,
                    alignItems: 'center',
                    cursor: onRowClick ? 'pointer' : 'default',
                    background: isSelected ? '#f0f9ff' : vRow.index % 2 === 0 ? '#fff' : '#fafbfc',
                    borderBottom: `1px solid ${BORDER}`,
                    ...(useVirtual ? {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vRow.start}px)`,
                    } : {}),
                    ...(getRowStyle?.(row, vRow.index) || {}),
                  }}
                >
                  {selectable && (
                    <div style={{ padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(e) => handleCheckboxClick(e as unknown as React.MouseEvent, vRow.index, id)}
                        onChange={() => {}}
                        style={{ cursor: 'pointer' }}
                      />
                    </div>
                  )}
                  {visibleColumns.map((col) => (
                    <div
                      key={col.key}
                      style={{
                        padding: cellPadding,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', color: '#1a2332',
                        textAlign: col.headerAlign || 'left',
                      }}
                    >
                      {col.render
                        ? col.render(row, vRow.index)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
