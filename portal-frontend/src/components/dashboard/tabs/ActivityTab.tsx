import { useState, useMemo, useCallback, useRef } from 'react';
import { useActivity } from '../../../hooks/useActivity';
import { useWells } from '../../../hooks/useWells';
import { useModal } from '../../../contexts/ModalContext';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import {
  normalizeActivityType, getFilterCategory, getActivityIcon,
  getAlertLevelStyle, ACTIVITY_FILTER_CATEGORIES,
} from '../../../lib/activity-utils';
import { addWell } from '../../../api/wells';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { EmptyState } from '../../ui/EmptyState';
import { BulkActionBar } from '../../ui/BulkActionBar';
import { MODAL_TYPES, BORDER, SLATE } from '../../../lib/constants';
import type { ActivityRecord } from '../../../types/dashboard';

// Activity types that should show "Track Well" button
const TRACKABLE_TYPES = new Set([
  'New Permit', 'New Drilling Permit', 'Well Completed',
  'Rework Permit', 'Application', 'Exception',
  'Pooling Application', 'Increased Density Application',
  'Spacing Unit Application', 'Location Exception',
  'Horizontal Well Application', 'OCC Filing',
  'Order Modification', 'Operator Change',
]);

// Activity types that should show "Analyze Order" button
const OCC_FILING_TYPES = new Set([
  'Pooling Application', 'Increased Density Application',
  'Spacing Unit Application', 'Location Exception',
  'Horizontal Well Application', 'OCC Filing', 'Order Modification',
]);

function shouldShowTrackButton(activityType: string): boolean {
  return TRACKABLE_TYPES.has(activityType) ||
    activityType.toLowerCase().includes('rework') ||
    activityType.includes('Application') ||
    activityType.includes('Exception');
}

function parseSTR(str: string): { section: string; township: string; range: string } | null {
  const m = str.match(/(\d+)-(\d+[NS])-(\d+[EW])/i) ||
            str.match(/S(\d+)\s+T(\d+[NS])\s+R(\d+[EW])/i);
  if (!m) return null;
  return { section: m[1], township: m[2], range: m[3] };
}

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
  const { data: wells, reload: reloadWells } = useWells();
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();
  const isMobile = useIsMobile();

  const [search, setSearch] = useState('');
  const [sortValue, setSortValue] = useState('date-desc');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [trackingApi, setTrackingApi] = useState<string | null>(null);
  const lastClickedRef = useRef<number>(-1);

  // Set of API numbers already tracked
  const trackedApis = useMemo(
    () => new Set(wells.map((w) => w.apiNumber).filter(Boolean)),
    [wells],
  );

  // Find tracked well record by API for map deep-link
  const findTrackedWell = useCallback(
    (api: string) => wells.find((w) => w.apiNumber === api),
    [wells],
  );

  const handleTrackWell = useCallback(async (apiNumber: string, wellName: string) => {
    if (trackingApi) return;
    setTrackingApi(apiNumber);
    try {
      await addWell(apiNumber);
      toast.success(`Tracking ${wellName || apiNumber}`);
      reloadWells();
    } catch {
      toast.error('Failed to track well');
    } finally {
      setTrackingApi(null);
    }
  }, [trackingApi, toast, reloadWells]);

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
        credentials: 'include',
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
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity..."
            style={{
              width: '100%', padding: '8px 12px',
              border: `1px solid ${BORDER}`, borderRadius: 6,
              fontSize: 13, outline: 'none',
              fontFamily: "'Inter', 'DM Sans', sans-serif",
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <select value={sortValue} onChange={(e) => setSortValue(e.target.value)}
              style={{ ...dropdownStyle, minWidth: 0 }}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {(search || filterCat) && (
              <span style={{ fontSize: 12, color: SLATE }}>
                {displayRecords.length} of {activity.length}
              </span>
            )}
          </div>
        </div>
      ) : (
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
      )}

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
                  display: 'flex', alignItems: 'flex-start', gap: isMobile ? 8 : 12,
                  padding: isMobile ? '10px 12px' : '14px 16px',
                  background: isSelected ? '#f0f9ff' : '#fff',
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
                  width: isMobile ? 30 : 36, height: isMobile ? 30 : 36,
                  borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: isMobile ? 14 : 16,
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
                  {/* Action buttons */}
                  <ActivityActions
                    activityType={activityType}
                    apiNumber={apiNumber}
                    str={f['Section-Township-Range']}
                    county={county}
                    occMapLink={f['OCC Map Link'] || f['Map Link']}
                    caseNumber={f['Case Number']}
                    wellName={f['Well Name'] || ''}
                    trackedApis={trackedApis}
                    findTrackedWell={findTrackedWell}
                    onTrack={handleTrackWell}
                    trackingApi={trackingApi}
                  />
                  {isMobile && date && (
                    <div style={{ fontSize: 11, color: SLATE, marginTop: 4 }}>{date}</div>
                  )}
                </div>

                {/* Date — desktop only */}
                {!isMobile && (
                  <div style={{ fontSize: 12, color: SLATE, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {date}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Action buttons row (MW Map, OCC Map, Track Well, Analyze Order)
function ActivityActions({
  activityType, apiNumber, str, county, occMapLink, caseNumber, wellName,
  trackedApis, findTrackedWell, onTrack, trackingApi,
}: {
  activityType: string;
  apiNumber?: string;
  str?: string;
  county: string;
  occMapLink?: string;
  caseNumber?: string;
  wellName: string;
  trackedApis: Set<string>;
  findTrackedWell: (api: string) => { id: string; county: string; section: string; township: string; range: string } | undefined;
  onTrack: (api: string, name: string) => void;
  trackingApi: string | null;
}) {
  // Build map link
  let mapHref: string | null = null;
  if (apiNumber) {
    const tracked = findTrackedWell(apiNumber);
    if (tracked) {
      const p = new URLSearchParams({
        well: tracked.id,
        county: tracked.county || county,
        section: tracked.section || '',
        township: tracked.township || '',
        range: tracked.range || '',
      });
      mapHref = `/portal/map?${p}`;
    }
  }
  if (!mapHref && str) {
    const parsed = parseSTR(str);
    if (parsed) {
      const p = new URLSearchParams({ section: parsed.section, township: parsed.township, range: parsed.range, county });
      mapHref = `/portal/map?${p}`;
    }
  }

  // OCC map — only use links with actual coordinates
  const validOccMap = occMapLink && occMapLink.includes('marker=') && /^https?:\/\//.test(occMapLink) ? occMapLink : null;

  // Track button
  const showTrack = apiNumber && shouldShowTrackButton(activityType);
  const isTracked = apiNumber ? trackedApis.has(apiNumber) : false;

  // Analyze order
  const showAnalyze = caseNumber && OCC_FILING_TYPES.has(activityType);

  if (!mapHref && !validOccMap && !showTrack && !showAnalyze) return null;

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      {mapHref && (
        <a
          href={mapHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={actionBtnStyle}
        >
          MW Map
        </a>
      )}
      {validOccMap && (
        <a
          href={validOccMap}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={actionBtnStyle}
        >
          OCC Map
        </a>
      )}
      {showTrack && (
        isTracked ? (
          <button style={{ ...actionBtnStyle, background: '#22C55E', color: '#fff', borderColor: '#22C55E', cursor: 'default' }} disabled>
            Added ✓
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onTrack(apiNumber!, wellName); }}
            disabled={trackingApi === apiNumber}
            style={{ ...actionBtnStyle, background: trackingApi === apiNumber ? '#94a3b8' : undefined }}
          >
            {trackingApi === apiNumber ? 'Adding...' : '+ Track Well'}
          </button>
        )
      )}
      {showAnalyze && (
        <button
          onClick={(e) => { e.stopPropagation(); /* TODO: implement analyze order */ }}
          style={{ ...actionBtnStyle, borderColor: '#C05621', color: '#C05621' }}
        >
          Analyze Order
        </button>
      )}
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
  border: `1px solid ${BORDER}`, background: '#fff', color: '#475569',
  cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

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
