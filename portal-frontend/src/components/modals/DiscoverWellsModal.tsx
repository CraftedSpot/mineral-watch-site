import { useState, useMemo } from 'react';
import { ModalShell } from '../ui/ModalShell';
import { useIsMobile } from '../../hooks/useIsMobile';
import { discoverWellsCommit } from '../../api/matching';
import { formatTRS } from '../../lib/helpers';
import { BORDER, SLATE, DARK, TEAL } from '../../lib/constants';
import { getMethodLabel } from '../../lib/match-styles';
import type { DiscoverWellPreview, DiscoverWellsPreviewResponse } from '../../api/matching';

interface DiscoverWellsModalProps {
  data: DiscoverWellsPreviewResponse;
  onClose: () => void;
  onComplete: () => void;
}

function MethodBadge({ method }: { method: string }) {
  const m = getMethodLabel(method);
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
      background: m.bg, color: m.color, whiteSpace: 'nowrap',
    }}>
      {m.label}
    </span>
  );
}

export function DiscoverWellsModal({ data, onClose, onComplete }: DiscoverWellsModalProps) {
  const isMobile = useIsMobile();
  const maxSelectable = data.planCheck.wouldExceedLimit
    ? Math.max(0, data.planCheck.limit - data.planCheck.current)
    : data.wells.length;

  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (let i = 0; i < data.wells.length && initial.size < maxSelectable; i++) {
      initial.add(data.wells[i].api_number);
    }
    return initial;
  });
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group wells by match method, sorted within groups by property desc then well name
  const grouped = useMemo(() => {
    const groups = new Map<string, DiscoverWellPreview[]>();
    const methodOrder = ['surface_section', 'lateral_path', 'bottom_hole', 'adjacent_bh', 'adjacent_surface'];

    for (const w of data.wells) {
      const key = w.match_method || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(w);
    }

    // Sort within each group
    for (const wells of groups.values()) {
      wells.sort((a, b) => {
        const propCmp = (a.matched_property_desc || '').localeCompare(b.matched_property_desc || '');
        if (propCmp !== 0) return propCmp;
        return (a.well_name || '').localeCompare(b.well_name || '');
      });
    }

    // Return in canonical method order
    const ordered: [string, DiscoverWellPreview[]][] = [];
    for (const m of methodOrder) {
      if (groups.has(m)) ordered.push([m, groups.get(m)!]);
    }
    // Add any methods not in the order list
    for (const [m, wells] of groups) {
      if (!methodOrder.includes(m)) ordered.push([m, wells]);
    }
    return ordered;
  }, [data.wells]);

  function toggleWell(apiNumber: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(apiNumber)) {
        next.delete(apiNumber);
      } else if (next.size < maxSelectable) {
        next.add(apiNumber);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === Math.min(data.wells.length, maxSelectable)) {
      setSelected(new Set());
    } else {
      const next = new Set<string>();
      for (let i = 0; i < data.wells.length && next.size < maxSelectable; i++) {
        next.add(data.wells[i].api_number);
      }
      setSelected(next);
    }
  }

  async function handleCommit() {
    setCommitting(true);
    setError(null);
    try {
      const res = await discoverWellsCommit(Array.from(selected));
      if (!res.success) {
        setError(res.stats.errors?.[0] || 'Failed to add wells');
        return;
      }
      onComplete();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add wells');
    } finally {
      setCommitting(false);
    }
  }

  const allSelected = selected.size === Math.min(data.wells.length, maxSelectable);

  return (
    <ModalShell
      onClose={onClose}
      title="Discover Wells"
      subtitle={`Found ${data.total} well${data.total === 1 ? '' : 's'} at your property locations`}
      headerBg="linear-gradient(135deg, #0f766e, #14b8a6)"
      maxWidth={isMobile ? '100%' : 680}
      bodyPadding="0"
      footer={
        <>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', fontSize: 13, border: `1px solid ${BORDER}`,
              borderRadius: 6, background: '#fff', color: '#374151', cursor: 'pointer',
              fontFamily: "'Inter', 'DM Sans', sans-serif",
            }}
          >
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleCommit}
            disabled={selected.size === 0 || committing}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, border: 'none',
              borderRadius: 6, background: selected.size === 0 || committing ? '#94a3b8' : TEAL,
              color: '#fff', cursor: selected.size === 0 || committing ? 'not-allowed' : 'pointer',
              fontFamily: "'Inter', 'DM Sans', sans-serif",
            }}
          >
            {committing ? 'Adding...' : `Add ${selected.size} Well${selected.size === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {/* Plan limit warning */}
      {data.planCheck.wouldExceedLimit && (
        <div style={{
          padding: '10px 16px', background: '#fef3c7', borderBottom: `1px solid #fcd34d`,
          fontSize: 13, color: '#92400e',
        }}>
          Adding all wells would exceed your <strong>{data.planCheck.plan}</strong> plan limit
          ({data.planCheck.current}/{data.planCheck.limit}).
          You can select up to <strong>{maxSelectable}</strong> well{maxSelectable === 1 ? '' : 's'}.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '10px 16px', background: '#fee2e2', borderBottom: `1px solid #fca5a5`,
          fontSize: 13, color: '#991b1b',
        }}>
          {error}
        </div>
      )}

      {/* Select all bar */}
      <div style={{
        padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, background: '#f8fafc',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <input
          type="checkbox"
          checked={allSelected && data.wells.length > 0}
          onChange={toggleAll}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 13, color: DARK, fontWeight: 500 }}>
          Select All ({Math.min(data.wells.length, maxSelectable)})
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: SLATE }}>
          {selected.size} selected
        </span>
      </div>

      {/* Well list grouped by match method */}
      <div style={{ maxHeight: isMobile ? 'calc(100vh - 320px)' : 420, overflowY: 'auto' }}>
        {grouped.map(([method, wells]) => (
          <div key={method}>
            {/* Group header */}
            <div style={{
              padding: '8px 16px', background: '#f1f5f9',
              fontSize: 11, fontWeight: 600, color: '#475569',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              borderBottom: `1px solid ${BORDER}`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <MethodBadge method={method} />
              <span>{wells.length} well{wells.length === 1 ? '' : 's'}</span>
            </div>

            {/* Wells in group */}
            {wells.map((w) => {
              const isChecked = selected.has(w.api_number);
              const atLimit = !isChecked && selected.size >= maxSelectable;
              return (
                <div
                  key={w.api_number}
                  onClick={() => !atLimit && toggleWell(w.api_number)}
                  style={{
                    padding: '8px 16px', borderBottom: `1px solid ${BORDER}`,
                    display: 'flex', alignItems: 'start', gap: 10,
                    cursor: atLimit ? 'not-allowed' : 'pointer',
                    background: isChecked ? '#f0fdfa' : '#fff',
                    opacity: atLimit ? 0.5 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={atLimit}
                    onChange={() => toggleWell(w.api_number)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: atLimit ? 'not-allowed' : 'pointer', marginTop: 2, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ color: DARK, fontSize: 13 }}>{w.well_name || 'Unknown'}</strong>
                      {w.is_horizontal && (
                        <span style={{
                          fontSize: 10, background: '#dbeafe', color: '#1e40af',
                          padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                        }}>H</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: SLATE, marginTop: 1 }}>
                      {w.api_number}
                      {w.county && <> &middot; {w.county}</>}
                      {w.section && w.township && w.range && (
                        <> &middot; {formatTRS(w.section, w.township, w.range)}</>
                      )}
                    </div>
                    {w.operator && (
                      <div style={{ fontSize: 12, color: SLATE, marginTop: 1 }}>
                        Op: {w.operator}
                      </div>
                    )}
                    {w.matched_property_desc && (
                      <div style={{ fontSize: 11, color: '#0d9488', marginTop: 2 }}>
                        Matches: {w.matched_property_desc}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
