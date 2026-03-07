import { useState, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../lib/constants';

export interface Column<T> {
  key: string;
  label: string;
  title?: string;
  width?: number | string;
  sticky?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
  getValue?: (row: T) => string | number | null | undefined;
  sortType?: 'string' | 'number';
}

interface SortableTableProps<T> {
  columns: Column<T>[];
  data: T[];
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  rowKey: (row: T) => string;
  rowHeight?: number;
  expandable?: boolean;
  renderExpandedRow?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

function getSortValue<T>(row: T, col: Column<T>): string | number | null {
  if (col.getValue) {
    const v = col.getValue(row);
    return v ?? null;
  }
  const v = (row as Record<string, unknown>)[col.key];
  if (v == null) return null;
  return v as string | number;
}

export function SortableTable<T>({
  columns,
  data,
  defaultSort,
  rowKey,
  rowHeight = 44,
  expandable,
  renderExpandedRow,
  onRowClick,
  emptyMessage = 'No data available',
}: SortableTableProps<T>) {
  const [sort, setSort] = useState(defaultSort || { key: columns[0]?.key || '', dir: 'desc' as const });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

  const handleSort = useCallback((key: string) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      const col = columns.find((c) => c.key === key);
      return { key, dir: col?.sortType === 'string' ? 'asc' : 'desc' };
    });
  }, [columns]);

  const sortedData = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;

    return [...data].sort((a, b) => {
      const aVal = getSortValue(a, col);
      const bVal = getSortValue(b, col);

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sort.dir === 'asc' ? 1 : -1;
      if (bVal == null) return sort.dir === 'asc' ? -1 : 1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sort.dir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [data, sort, columns]);

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Use dynamic measurement for expandable rows, fixed for non-expandable
  const virtualizer = useVirtualizer({
    count: sortedData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  if (data.length === 0) {
    return (
      <div style={{
        padding: 32, textAlign: 'center', color: SLATE, fontSize: 14,
        border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff',
      }}>
        {emptyMessage}
      </div>
    );
  }

  const gridTemplate = columns.map((c) => c.width ? (typeof c.width === 'number' ? `${c.width}px` : c.width) : '1fr').join(' ');

  const renderSortArrow = (key: string) => {
    const active = sort.key === key;
    return (
      <span style={{ marginLeft: 4, fontSize: 9, opacity: active ? 1 : 0.3, display: 'inline-flex', flexDirection: 'column', lineHeight: 1 }}>
        <span style={{ color: active && sort.dir === 'asc' ? TEXT_DARK : SLATE }}>&#9650;</span>
        <span style={{ color: active && sort.dir === 'desc' ? TEXT_DARK : SLATE }}>&#9660;</span>
      </span>
    );
  };

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      {/* Fixed header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: gridTemplate,
        background: BG_MUTED, borderBottom: `1px solid ${BORDER}`,
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        {columns.map((col) => (
          <div
            key={col.key}
            onClick={() => handleSort(col.key)}
            title={col.title}
            style={{
              padding: '10px 12px', fontSize: 12, fontWeight: 600, color: SLATE,
              cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center',
            }}
          >
            {col.label}
            {renderSortArrow(col.key)}
          </div>
        ))}
      </div>

      {/* Virtual scroll body */}
      <div
        ref={parentRef}
        style={{ maxHeight: 600, overflow: 'auto' }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = sortedData[virtualRow.index];
            const key = rowKey(row);
            const isExpanded = expandedKeys.has(key);

            return (
              <div
                key={key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  onClick={() => {
                    if (expandable) toggleExpand(key);
                    onRowClick?.(row);
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: gridTemplate,
                    borderBottom: `1px solid ${BORDER}`,
                    cursor: expandable || onRowClick ? 'pointer' : 'default',
                    minHeight: rowHeight,
                    alignItems: 'center',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  {columns.map((col, colIdx) => (
                    <div
                      key={col.key}
                      style={{
                        padding: '8px 12px', fontSize: 13, color: TEXT_DARK,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      {colIdx === 0 && expandable && (
                        <span style={{
                          fontSize: 10, color: SLATE, transition: 'transform 0.15s',
                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          display: 'inline-block', marginRight: 4, flexShrink: 0,
                        }}>
                          &#9654;
                        </span>
                      )}
                      {col.render ? col.render(row, virtualRow.index) : String(getSortValue(row, col) ?? '—')}
                    </div>
                  ))}
                </div>

                {/* Expanded row */}
                {expandable && isExpanded && renderExpandedRow && (
                  <div style={{
                    padding: '12px 16px', background: '#fafbfc',
                    borderBottom: `1px solid ${BORDER}`,
                  }}>
                    {renderExpandedRow(row)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
