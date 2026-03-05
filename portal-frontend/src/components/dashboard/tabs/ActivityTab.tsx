import { useState, useMemo, useCallback, useRef } from 'react';
import { useActivity } from '../../../hooks/useActivity';
import { useModal } from '../../../contexts/ModalContext';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import {
  normalizeActivityType, getFilterCategory, getActivityIcon,
  getAlertLevelStyle, ACTIVITY_FILTER_CATEGORIES,
} from '../../../lib/activity-utils';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { EmptyState } from '../../ui/EmptyState';
import { BulkActionBar } from '../../ui/BulkActionBar';
import { MODAL_TYPES, BORDER, SLATE } from '../../../lib/constants';
import type { ActivityRecord } from '../../../types/dashboard';

// Sort options (matches vanilla dashboard-shell.html)
const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest First' },
  { value: 'date-asc', label: 'Oldest First' },
  { value: 'type', label: 'Type' },
  { value: 'county', label: 'County' },
  { value: 'operator', label: 'Operator' },
];

function sortActivity(records: ActivityRecord[], sortBy: string): ActivityRecord[] {
  return [...records].sort((a, b) => {
    const fa = a.fields, fb = b.fields;
    switch (sortBy) {
      case 'date-asc':
        return new Date(fa['Detected At'] || 0).getTime() - new Date(fb['Detected At'] || 0).getTime();
      case 'type':
        return normalizeActivityType(fa['Activity Type']).localeCompare(normalizeActivityType(fb['Activity Type']));
      case 'county':
        return (fa['County'] || '').localeCompare(fb['County'] || '');
      case 'operator':
        return (fa['Operator'] || '').localeCompare(fb['Operator'] || '');
      case 'date-desc':
      default:
        return new Date(fb['Detected At'] || 0).getTime() - new Date(fa['Detected At'] || 0).getTime();
    }
  });
}

export function ActivityTab() {
  const { data: activity, loading, reload } = useActivity();
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [search, setSearch] = useState('');
  const [sortValue, setSortValue] = useState('date-desc');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<number>(-1);

  // Compute category counts for filter chips
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activity.forEach((r) => {
      const type = normalizeActivityType(r.fields['Activity Type']);
      const cat = getFilterCategory(type);
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [activity]);

  const showChips = Object.keys(categoryCounts).length >= 2;

  // Filter + search + sort
  const displayRecords = useMemo(() => {
    let records = activity;

    // Category filter
    if (filterCat) {
      records = records.filter((r) => {
        const type = normalizeActivityType(r.fields['Activity Type']);
        return getFilterCategory(type) === filterCat;
      });
    }

    // Search
    if (search) {
      const term = search.toLowerCase();
      records = records.filter((r) => {
        const f = r.fields;
        return (f['Well Name'] || '').toLowerCase().includes(term) ||
          (f['Operator'] || '').toLowerCase().includes(term) ||
          (f['County'] || '').toLowerCase().includes(term) ||
          (f['Case Number'] || '').toLowerCase().includes(term) ||
          (f['API Number'] || '').toLowerCase().includes(term) ||
          (f['Activity Type'] || '').toLowerCase().includes(term) ||
          (f['Section-Township-Range'] || '').toLowerCase().includes(term);
      });
    }

    return sortActivity(records, sortValue);
  }, [activity, filterCat, search, sortValue]);

  const handleCheckbox = useCallback((e: React.MouseEvent, index: number, id: string) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedRef.current !== -1) {
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);
      const next = new Set(selected);
      const adding = !selected.has(id);
      for (let i = start; i <= end; i++) {
        const rid = String(displayRecords[i].id);
        if (adding) next.add(rid); else next.delete(rid);
      }
      setSelected(next);
    } else {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelected(next);
    }
    lastClickedRef.current = index;
  }, [selected, displayRecords]);

  const handleBulkDelete = useCallback(async () => {
    const count = selected.size;
    if (!count) return;
    const ok = await confirm(`Delete ${count} activit${count === 1 ? 'y' : 'ies'}? This cannot be undone.`, { destructive: true, icon: 'trash' });
    if (!ok) return;
    try {
      const res = await fetch('/api/activity/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`Deleted ${count} activit${count === 1 ? 'y' : 'ies'}`);
      setSelected(new Set());
      reload();
    } catch {
      toast.error('Failed to delete activity');
    }
  }, [selected, confirm, toast, reload]);

  if (loading) return <LoadingSkeleton columns={3} />;

  return (
    <div style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by well, operator, county, case..."
          style={{
            flex: 1, maxWidth: 320, padding: '8px 12px',
            border: `1px solid ${BORDER}`, borderRadius: 6,
            fontSize: 13, outline: 'none',
            fontFamily: "'Inter', 'DM Sans', sans-serif",
          }}
        />
        <select value={sortValue} onChange={(e) => setSortValue(e.target.value)} style={dropdownStyle}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(search || filterCat) && (
          <span style={{ fontSize: 12, color: SLATE }}>
            {displayRecords.length} of {activity.length}
          </span>
        )}
      </div>

      {/* Filter chips */}
      {showChips && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          <FilterChip label={`All (${activity.length})`} active={!filterCat} onClick={() => setFilterCat(null)} />
          {ACTIVITY_FILTER_CATEGORIES.map((cat) => {
            const count = categoryCounts[cat];
            if (!count) return null;
            return (
              <FilterChip
                key={cat}
                label={`${cat} (${count})`}
                active={filterCat === cat}
                onClick={() => setFilterCat(filterCat === cat ? null : cat)}
              />
            );
          })}
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

      {/* Activity List */}
      {displayRecords.length === 0 ? (
        <EmptyState
          title={search || filterCat ? 'No results found' : 'No activity recorded yet'}
          description={search
            ? `No matches for "${search}"`
            : 'When wells on your properties have status changes, they\u2019ll appear here.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {displayRecords.map((r, idx) => {
            const f = r.fields;
            const activityType = normalizeActivityType(f['Activity Type']);
            const alertLevel = f['Alert Level'] || 'YOUR PROPERTY';
            const icon = getActivityIcon(activityType);
            const levelStyle = getAlertLevelStyle(alertLevel);
            const date = f['Detected At'] ? new Date(f['Detected At']).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            }) : '';
            const id = String(r.id);
            const isSelected = selected.has(id);

            // Build change text
            let changeText = '';
            if (f['Previous Value'] && f['New Value']) {
              changeText = activityType.includes('Transfer')
                ? `${f['Previous Value']} \u2192 ${f['New Value']}`
                : `Status: ${f['Previous Value']} \u2192 ${f['New Value']}`;
            }

            const county = (f['County'] || '').replace(/^\d+-/, '');
            const apiNumber = f['API Number'];

            return (
              <div
                key={id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '14px 16px', background: isSelected ? '#f0f9ff' : '#fff',
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                {/* Checkbox */}
                <div onClick={(e) => e.stopPropagation()} style={{ paddingTop: 2 }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => handleCheckbox(e as unknown as React.MouseEvent, idx, id)}
                    onChange={() => {}}
                    style={{ cursor: 'pointer' }}
                  />
                </div>

                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 16,
                  background: '#f1f5f9', flexShrink: 0,
                }}>
                  {icon}
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#1a2332' }}>{activityType}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                      background: levelStyle.bg, color: levelStyle.color, letterSpacing: '0.05em',
                    }}>
                      {levelStyle.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#1a2332', marginTop: 2 }}>
                    {apiNumber ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          modal.open(MODAL_TYPES.WELL, { apiNumber, wellName: f['Well Name'] || '' });
                        }}
                        style={{
                          background: 'none', border: 'none', padding: 0, font: 'inherit',
                          color: '#1a2332', borderBottom: '1px dashed #CBD5E1', cursor: 'pointer',
                        }}
                      >
                        {f['Well Name'] || 'Unknown Well'}
                      </button>
                    ) : (
                      f['Well Name'] || 'Unknown Well'
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
                    {f['Operator'] && <>{f['Operator']} &middot; </>}
                    {f['Section-Township-Range'] && <>{f['Section-Township-Range']} &middot; </>}
                    {county}
                  </div>
                  {f['Case Number'] && (
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                      Case: {f['Case Number']}
                    </div>
                  )}
                  {changeText && (
                    <div style={{
                      fontSize: 12, color: '#C05621', fontWeight: 500, marginTop: 4,
                      padding: '2px 8px', background: '#FEF3EC', borderRadius: 4, display: 'inline-block',
                    }}>
                      {changeText}
                    </div>
                  )}
                </div>

                {/* Date */}
                <div style={{ fontSize: 12, color: SLATE, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {date}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
        border: `1px solid ${active ? '#C05621' : BORDER}`,
        background: active ? '#FEF3EC' : '#fff',
        color: active ? '#C05621' : SLATE,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const dropdownStyle: React.CSSProperties = {
  padding: '8px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
  fontSize: 13, fontFamily: "'Inter', 'DM Sans', sans-serif",
  background: '#fff', cursor: 'pointer', minWidth: 140,
};
