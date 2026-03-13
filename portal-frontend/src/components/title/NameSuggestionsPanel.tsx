import { useState, useEffect, useCallback } from 'react';
import { fetchNameSuggestions, bulkCorrectNames, deleteNameMapping } from '../../api/title-chain';
import type { NameCluster, NameVariant, BulkCorrectRequest } from '../../types/title-chain';

interface Props {
  propertyId: string | null;
  onCorrectionsApplied: () => void;
  isMobile?: boolean;
  darkMode?: boolean;
}

export function NameSuggestionsPanel({ propertyId, onCorrectionsApplied, isMobile, darkMode }: Props) {
  const [clusters, setClusters] = useState<NameCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Track per-cluster state: selected variants + editable canonical
  const [clusterState, setClusterState] = useState<Record<string, {
    selected: Set<number>;  // partyRowIds selected for correction
    canonical: string;      // editable canonical name
  }>>({});

  const loadSuggestions = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNameSuggestions(propertyId);
      setClusters(res.clusters);
      // Initialize per-cluster state
      const state: typeof clusterState = {};
      for (const c of res.clusters) {
        const selected = new Set<number>();
        // Pre-check non-canonical, non-ambiguous variants
        for (const v of c.variants) {
          if (!v.isCanonical && !c.ambiguous) {
            for (const id of v.partyRowIds) selected.add(id);
          }
        }
        state[c.clusterId] = { selected, canonical: c.canonicalName };
      }
      setClusterState(state);
    } catch (e) {
      console.error('[NameSuggestions] Load failed:', e);
      setError('Failed to load name suggestions');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  if (!propertyId || loading || clusters.length === 0) return null;

  const toggleVariant = (clusterId: string, variant: NameVariant) => {
    setClusterState(prev => {
      const cs = prev[clusterId];
      if (!cs) return prev;
      const next = new Set(cs.selected);
      for (const id of variant.partyRowIds) {
        if (next.has(id)) next.delete(id); else next.add(id);
      }
      return { ...prev, [clusterId]: { ...cs, selected: next } };
    });
  };

  const setCanonical = (clusterId: string, name: string) => {
    setClusterState(prev => {
      const cs = prev[clusterId];
      if (!cs) return prev;
      return { ...prev, [clusterId]: { ...cs, canonical: name } };
    });
  };

  const mergeCluster = async (cluster: NameCluster) => {
    const cs = clusterState[cluster.clusterId];
    if (!cs || cs.selected.size === 0 || !propertyId) return;
    setMerging(true);
    setToast(null);
    try {
      // Build corrections: only for selected partyRowIds that aren't already canonical
      const corrections: BulkCorrectRequest['corrections'] = [];
      const mappings: BulkCorrectRequest['mappings'] = [];

      for (const v of cluster.variants) {
        if (v.isCanonical && v.originalName === cs.canonical) continue;
        const selectedIds = v.partyRowIds.filter(id => cs.selected.has(id));
        if (selectedIds.length === 0) continue;

        for (const id of selectedIds) {
          corrections.push({ partyRowId: id, correctedValue: cs.canonical });
        }

        // Add mapping for this variant
        if (v.originalName !== cs.canonical) {
          mappings.push({
            variantOriginal: v.originalName,
            variantNormalized: v.normalizedName,
            canonicalName: cs.canonical,
          });
        }
      }

      if (corrections.length === 0) {
        setToast('No corrections to apply');
        setMerging(false);
        return;
      }

      const res = await bulkCorrectNames(propertyId, { corrections, mappings });
      if (res.failedRowIds.length > 0) {
        setToast(`${res.correctedCount} corrected, ${res.failedRowIds.length} failed — retry?`);
      } else {
        setToast(`${res.correctedCount} names corrected`);
      }
      onCorrectionsApplied();
      // Reload suggestions
      await loadSuggestions();
    } catch (e) {
      console.error('[NameSuggestions] Merge failed:', e);
      setToast('Merge failed — try again');
    } finally {
      setMerging(false);
    }
  };

  const mergeAll = async () => {
    for (const cluster of clusters) {
      if (cluster.alreadyMapped) continue;
      const cs = clusterState[cluster.clusterId];
      if (!cs || cs.selected.size === 0) continue;
      await mergeCluster(cluster);
    }
  };

  const handleRemoveMapping = async (cluster: NameCluster) => {
    if (!propertyId || !cluster.mappingIds?.length) return;
    setMerging(true);
    setToast(null);
    try {
      for (const mappingId of cluster.mappingIds) {
        await deleteNameMapping(propertyId, mappingId);
      }
      setToast('Auto-correction rule removed');
      onCorrectionsApplied();
      await loadSuggestions();
    } catch (e) {
      console.error('[NameSuggestions] Remove mapping failed:', e);
      setToast('Failed to remove mapping');
    } finally {
      setMerging(false);
    }
  };

  const unmappedCount = clusters.filter(c => !c.alreadyMapped).length;
  const totalVariants = clusters.reduce((s, c) => s + c.variants.length - 1, 0);
  const cardBorder = darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid #e2e8f0';
  const bg = darkMode ? '#1e293b' : '#fffbf5';
  const textColor = darkMode ? '#e2e8f0' : '#1a202c';
  const mutedColor = darkMode ? '#94a3b8' : '#718096';
  const badgeBg = darkMode ? 'rgba(251,211,141,0.15)' : '#fef3ec';
  const badgeColor = darkMode ? '#FBD38D' : '#C05621';
  const amberBg = darkMode ? 'rgba(251,211,141,0.15)' : '#fefcbf';
  const amberColor = darkMode ? '#FBD38D' : '#744210';
  const greenBg = darkMode ? 'rgba(104,211,145,0.15)' : '#c6f6d5';
  const greenColor = darkMode ? '#68D391' : '#22543d';
  const blueBg = darkMode ? 'rgba(144,205,244,0.15)' : '#bee3f8';
  const blueColor = darkMode ? '#90cdf4' : '#2a4365';

  return (
    <div style={{
      padding: isMobile ? '8px 12px 6px' : '8px 24px 6px',
    }}>
      <div style={{
        background: bg, borderRadius: 10, padding: isMobile ? '8px 12px' : '8px 16px',
        border: cardBorder, fontFamily: "'DM Sans', sans-serif",
      }}>
        {/* Collapsed banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: badgeBg, color: badgeColor, borderRadius: 5,
            padding: '2px 8px', fontSize: 10, fontWeight: 700, flexShrink: 0,
          }}>
            {unmappedCount} variation{unmappedCount !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 12, color: textColor, flex: 1 }}>
            {totalVariants} possible name variation{totalVariants !== 1 ? 's' : ''} detected
          </span>
          <button onClick={() => setExpanded(!expanded)} style={{
            background: 'none', border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : '#e2e8f0'}`,
            color: badgeColor, borderRadius: 5, padding: '3px 10px',
            fontSize: 10, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
          }}>
            {expanded ? 'Hide' : 'Show'}
          </button>
          {expanded && unmappedCount > 1 && (
            <button onClick={mergeAll} disabled={merging} style={{
              background: badgeColor, border: 'none', color: darkMode ? '#1a202c' : '#fff', borderRadius: 5,
              padding: '3px 10px', fontSize: 10, cursor: merging ? 'not-allowed' : 'pointer',
              fontFamily: "'DM Sans', sans-serif", opacity: merging ? 0.6 : 1,
            }}>
              {merging ? 'Merging...' : 'Merge All'}
            </button>
          )}
        </div>

        {/* Toast notification */}
        {toast && (
          <div style={{
            marginTop: 6, padding: '4px 10px', borderRadius: 5, fontSize: 11,
            background: toast.includes('failed') ? '#fed7d7' : '#c6f6d5',
            color: toast.includes('failed') ? '#c53030' : '#22543d',
          }}>
            {toast}
            <button onClick={() => setToast(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              marginLeft: 8, fontSize: 11, color: 'inherit', opacity: 0.7,
            }}>dismiss</button>
          </div>
        )}

        {/* Expanded: one card per cluster */}
        {expanded && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clusters.map(cluster => {
              const cs = clusterState[cluster.clusterId];
              if (!cs) return null;
              const isResolved = cluster.alreadyMapped;

              return (
                <div key={cluster.clusterId} style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: darkMode ? 'rgba(255,255,255,0.04)' : '#fff',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`,
                  opacity: isResolved ? 0.6 : 1,
                }}>
                  {/* Canonical name header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <input
                      value={cs.canonical}
                      onChange={e => setCanonical(cluster.clusterId, e.target.value)}
                      disabled={isResolved}
                      style={{
                        flex: 1, fontSize: 13, fontWeight: 700, color: textColor,
                        background: 'transparent', border: 'none', borderBottom: isResolved ? 'none' : `1px dashed ${mutedColor}`,
                        padding: '2px 0', fontFamily: "'DM Sans', sans-serif",
                        outline: 'none',
                      }}
                    />
                    <span style={{
                      fontSize: 9, color: mutedColor, flexShrink: 0,
                    }}>
                      {cluster.canonicalSource === 'mapping' ? 'saved' :
                       cluster.canonicalSource === 'division_order' ? 'from DO' :
                       cluster.canonicalSource === 'frequency' ? 'most common' : 'most recent'}
                    </span>
                    {isResolved && (
                      <span style={{
                        fontSize: 9, background: greenBg, color: greenColor,
                        borderRadius: 4, padding: '1px 6px',
                      }}>Previously resolved</span>
                    )}
                    {cluster.ambiguous && (
                      <span style={{
                        fontSize: 9, background: amberBg, color: amberColor,
                        borderRadius: 4, padding: '1px 6px',
                      }}>Confirm?</span>
                    )}
                  </div>

                  {/* Variant rows */}
                  {cluster.variants.map(variant => {
                    if (variant.isCanonical) return null;
                    const allSelected = variant.partyRowIds.every(id => cs.selected.has(id));
                    const matchBadge = variant.matchType === 'exact_normalized' ? { label: 'exact', bg: greenBg, color: greenColor }
                      : variant.matchType === 'relaxed' ? { label: 'variation', bg: blueBg, color: blueColor }
                      : { label: 'typo', bg: amberBg, color: amberColor };

                    return (
                      <div key={variant.originalName} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
                        fontSize: 12, color: textColor,
                      }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => toggleVariant(cluster.clusterId, variant)}
                          disabled={isResolved || merging}
                          style={{ margin: 0, cursor: isResolved ? 'default' : 'pointer' }}
                        />
                        <span style={{ opacity: 0.85 }}>"{variant.originalName}"</span>
                        <span style={{ color: mutedColor, fontSize: 10 }}>
                          — {variant.docCount} doc{variant.docCount !== 1 ? 's' : ''}
                        </span>
                        <span style={{
                          fontSize: 9, borderRadius: 3, padding: '1px 5px',
                          background: matchBadge.bg, color: matchBadge.color,
                        }}>{matchBadge.label}</span>
                      </div>
                    );
                  })}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {!isResolved && (
                      <button onClick={() => mergeCluster(cluster)} disabled={merging || cs.selected.size === 0} style={{
                        background: cs.selected.size === 0 ? '#a0aec0' : badgeColor,
                        border: 'none', color: darkMode ? '#1a202c' : '#fff', borderRadius: 5,
                        padding: '4px 12px', fontSize: 10, cursor: cs.selected.size === 0 || merging ? 'not-allowed' : 'pointer',
                        fontFamily: "'DM Sans', sans-serif", opacity: merging ? 0.6 : 1,
                      }}>
                        {merging ? 'Merging...' : 'Merge Selected'}
                      </button>
                    )}
                    {isResolved && (
                      <button
                        onClick={() => handleRemoveMapping(cluster)}
                        disabled={merging || !cluster.mappingIds?.length}
                        title="Stop auto-correcting this name on future documents. Existing corrections are kept."
                        style={{
                          background: 'none', border: `1px solid ${mutedColor}`, color: mutedColor,
                          borderRadius: 5, padding: '3px 10px', fontSize: 10,
                          cursor: merging ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif",
                          opacity: merging ? 0.6 : 1,
                        }}
                      >
                        {merging ? 'Removing...' : 'Stop auto-correcting'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && <div style={{ color: '#e53e3e', fontSize: 11, marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  );
}
