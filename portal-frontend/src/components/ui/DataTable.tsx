import { useState, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BORDER, SLATE, TABLE_ROW_HEIGHT, VIRTUAL_THRESHOLD } from '../../lib/constants';
import { LoadingSkeleton } from './LoadingSkeleton';
import { EmptyState } from './EmptyState';
import { BulkActionBar } from './BulkActionBar';
import type { ColumnDef, DataTableProps } from './DataTableTypes';

interface SortState {
  key: string;
  direction: 'asc' | 'desc';
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
  emptyTitle,
  emptyDescription,
  emptyAction,
  bulkActions,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(defaultSort || null);
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);
  const lastClickedRef = useRef<number>(-1);

  const selected = externalSelected ?? internalSelected;
  const setSelected = onSelectionChange ?? setInternalSelected;

  // Filter
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
    return [...filteredData].sort((a, b) => {
      const aVal = col?.getValue
        ? col.getValue(a)
        : String((a as Record<string, unknown>)[sort.key] ?? '');
      const bVal = col?.getValue
        ? col.getValue(b)
        : String((b as Record<string, unknown>)[sort.key] ?? '');
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sort, columns]);

  // Virtual
  const useVirtual = sortedData.length > virtualThreshold;
  const virtualizer = useVirtualizer({
    count: sortedData.length,
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
        const rowId = getRowId(sortedData[i]);
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
  }, [selected, setSelected, sortedData, getRowId]);

  // Select all
  const handleSelectAll = useCallback(() => {
    if (selected.size === sortedData.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedData.map(getRowId)));
    }
  }, [selected.size, sortedData, getRowId, setSelected]);

  // Sort indicator
  const sortIndicator = (col: ColumnDef<T>) => {
    const key = col.sortKey || col.key;
    if (sort?.key !== key) return null;
    return <span style={{ marginLeft: 4, fontSize: 10 }}>{sort.direction === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  };

  if (loading) {
    return <LoadingSkeleton columns={columns.length} />;
  }

  return (
    <div style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      {/* Search + Bulk Actions */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        {searchable && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            style={{
              flex: 1, maxWidth: 320, padding: '8px 12px',
              border: `1px solid ${BORDER}`, borderRadius: 6,
              fontSize: 13, outline: 'none',
              fontFamily: "'Inter', 'DM Sans', sans-serif",
            }}
          />
        )}
        {search && (
          <span style={{ fontSize: 12, color: SLATE }}>
            {sortedData.length} result{sortedData.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {selected.size > 0 && bulkActions && (
        <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
          {bulkActions}
        </BulkActionBar>
      )}

      {sortedData.length === 0 ? (
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
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontSize: 13, position: 'relative',
          }}>
            <thead>
              <tr style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>
                {selectable && (
                  <th style={{ width: 40, padding: '10px 8px', borderBottom: `1px solid ${BORDER}` }}>
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === sortedData.length}
                      onChange={handleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={col.sortable ? () => toggleSort(col) : undefined}
                    style={{
                      padding: '10px 12px', textAlign: 'left',
                      fontWeight: 600, color: '#475569', fontSize: 11,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      borderBottom: `1px solid ${BORDER}`,
                      width: col.width, minWidth: col.minWidth,
                      cursor: col.sortable ? 'pointer' : 'default',
                      userSelect: 'none', whiteSpace: 'nowrap',
                    }}
                  >
                    {col.label}{sortIndicator(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={useVirtual ? { height: virtualizer.getTotalSize(), position: 'relative', display: 'block' } : undefined}>
              {(useVirtual ? virtualizer.getVirtualItems() : sortedData.map((_, i) => ({ index: i, start: i * rowHeight, size: rowHeight }))).map((vRow) => {
                const row = sortedData[vRow.index];
                const id = getRowId(row);
                const isSelected = selected.has(id);

                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    style={{
                      cursor: onRowClick ? 'pointer' : 'default',
                      background: isSelected ? '#f0f9ff' : vRow.index % 2 === 0 ? '#fff' : '#fafbfc',
                      borderBottom: `1px solid ${BORDER}`,
                      ...(useVirtual ? {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: rowHeight,
                        transform: `translateY(${vRow.start}px)`,
                        display: 'table',
                        tableLayout: 'fixed',
                      } : {}),
                    }}
                  >
                    {selectable && (
                      <td style={{ width: 40, padding: '8px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => handleCheckboxClick(e as unknown as React.MouseEvent, vRow.index, id)}
                          onChange={() => {}}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          padding: '8px 12px',
                          width: col.width, minWidth: col.minWidth,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', color: '#1a2332',
                        }}
                      >
                        {col.render
                          ? col.render(row, vRow.index)
                          : String((row as Record<string, unknown>)[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
