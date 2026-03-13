import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchChainProperties, fetchTitleChain } from '../../api/title-chain';
import { ORANGE, TITLE_CHAIN_ALLOWED_ORGS } from '../../lib/constants';
import { getTitleColors } from '../../lib/title-colors';
import type { ViewMode } from '../../lib/layout-engine';
import { useAuth } from '../../hooks/useAuth';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ChainProperty, TitleChainResponse } from '../../types/title-chain';
import { PropertySelector } from './PropertySelector';
import { ChainTreeView } from './ChainTreeView';
import { AISummary } from './AISummary';

// Module-level cache — survives React navigation (component unmount/remount)
let _cachedProperties: ChainProperty[] | null = null;
let _cachedSelectedId: string | null = null;
let _cachedChainData: Record<string, TitleChainResponse> = {};

export function TitlePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Org gate: only allowed orgs can see title page
  useEffect(() => {
    if (user && !user.isSuperAdmin && !TITLE_CHAIN_ALLOWED_ORGS.includes(user.organizationId || '')) {
      navigate('/portal', { replace: true });
    }
  }, [user, navigate]);
  const [properties, setProperties] = useState<ChainProperty[]>(_cachedProperties || []);
  const [propsLoading, setPropsLoading] = useState(!_cachedProperties);
  const [selectedId, setSelectedId] = useState<string | null>(_cachedSelectedId);
  const [chainData, setChainData] = useState<TitleChainResponse | null>(
    _cachedSelectedId ? _cachedChainData[_cachedSelectedId] || null : null,
  );
  const [chainLoading, setChainLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem('mmw_titleChainViewMode') as ViewMode) || 'simple',
  );
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('mmw_titleDarkMode') === '1');
  const isMobile = useIsMobile();
  const colors = useMemo(() => getTitleColors(darkMode), [darkMode]);

  useEffect(() => { localStorage.setItem('mmw_titleChainViewMode', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('mmw_titleDarkMode', darkMode ? '1' : '0'); }, [darkMode]);

  // Load properties on mount (use cache if available, refresh in background)
  useEffect(() => {
    if (_cachedProperties && _cachedProperties.length > 0) {
      // Already have cached data — just background refresh
      fetchChainProperties()
        .then((res) => {
          _cachedProperties = res.properties;
          setProperties(res.properties);
        })
        .catch(() => {}); // silent — cached data still showing
    } else {
      fetchChainProperties()
        .then((res) => {
          _cachedProperties = res.properties;
          setProperties(res.properties);
          if (res.properties.length > 0 && !_cachedSelectedId) {
            const firstId = res.properties[0].airtableRecordId;
            _cachedSelectedId = firstId;
            setSelectedId(firstId);
          }
        })
        .catch((err) => setError(err.message))
        .finally(() => setPropsLoading(false));
    }
  }, []);

  // Load chain data when selection changes (use cache, refresh in background)
  useEffect(() => {
    if (!selectedId) return;
    _cachedSelectedId = selectedId;
    const cached = _cachedChainData[selectedId];
    if (cached) {
      setChainData(cached);
      // Background refresh
      fetchTitleChain(selectedId)
        .then((res) => {
          _cachedChainData[selectedId] = res;
          setChainData(res);
        })
        .catch(() => {});
    } else {
      setChainLoading(true);
      setError(null);
      fetchTitleChain(selectedId)
        .then((res) => {
          _cachedChainData[selectedId] = res;
          setChainData(res);
        })
        .catch((err) => setError(err.message))
        .finally(() => setChainLoading(false));
    }
  }, [selectedId]);

  // Silent refetch after correction save/undo (no loading spinner)
  const handleRefreshChain = useCallback(() => {
    if (!selectedId) return;
    fetchTitleChain(selectedId)
      .then((res) => {
        _cachedChainData[selectedId] = res;
        setChainData(res);
      })
      .catch(() => {}); // silent — tree just stays stale if refetch fails
  }, [selectedId]);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: colors.bg, minHeight: '100vh', overflowX: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        padding: isMobile ? '8px 12px' : '8px 24px', borderBottom: `1px solid ${colors.border}`,
        display: 'flex', alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 6 : 0,
        background: colors.surface,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12 }}>
          <PropertySelector
            properties={properties}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={propsLoading}
            isMobile={isMobile}
            darkMode={darkMode}
            colors={colors}
          />
          {!isMobile && (
            <span style={{ fontSize: 10, color: colors.textMuted, opacity: 0.6, whiteSpace: 'nowrap' }}>
              AI-interpreted — not a legal opinion
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16 }}>
          {/* Simple / Detailed toggle */}
          <div style={{
            display: 'flex', borderRadius: 6, overflow: 'hidden',
            border: `1px solid ${colors.border}`, fontSize: 11, fontWeight: 600,
          }}>
            {(['simple', 'detailed'] as const).map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                style={{
                  padding: '6px 14px', border: 'none', cursor: 'pointer',
                  background: viewMode === mode ? ORANGE : colors.surface,
                  color: viewMode === mode ? '#fff' : colors.textMuted,
                  fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600,
                }}>
                {mode === 'simple' ? 'Simple' : 'Detailed'}
              </button>
            ))}
          </div>
          {/* Dark mode toggle */}
          <button onClick={() => setDarkMode((d) => !d)}
            style={{
              padding: '6px 10px', border: `1px solid ${colors.border}`, borderRadius: 6,
              background: colors.surface, cursor: 'pointer', fontSize: 14, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            {darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19'}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: '16px 24px', color: '#dc2626', fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {/* Loading state — only show spinner if no tree yet (initial load) */}
      {chainLoading && !chainData?.tree && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '60px 24px', color: colors.textMuted,
        }}>
          <div style={{
            width: 32, height: 32, border: `3px solid ${colors.border}`, borderTopColor: '#C05621',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ marginLeft: 12, fontSize: 14 }}>Loading chain of title...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Tree view — stays mounted during property switches to preserve fullscreen */}
      {chainData?.tree && (
        <>
          <div style={{ padding: isMobile ? '8px 12px 6px' : '8px 24px 6px' }}>
            <AISummary tree={chainData.tree} propertyLegal={chainData.property.legal} isMobile={isMobile} darkMode={darkMode} colors={colors} />
          </div>
          <ChainTreeView tree={chainData.tree} propertyId={selectedId ?? undefined} isMobile={isMobile} viewMode={viewMode} darkMode={darkMode} colors={colors} onRefresh={handleRefreshChain} properties={properties} selectedPropertyId={selectedId} onPropertySelect={setSelectedId} propsLoading={propsLoading} chainLoading={chainLoading} isSuperAdmin={user?.isSuperAdmin ?? false} />
        </>
      )}

      {/* No tree data */}
      {!chainLoading && chainData && !chainData.tree && (
        <div style={{
          padding: '60px 24px', textAlign: 'center', color: colors.textMuted, fontSize: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83C\uDF33'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: colors.text }}>No tree data available</div>
          <div>Upload chain-of-title documents for this property to see the tree view.</div>
        </div>
      )}

      {/* No properties */}
      {!propsLoading && properties.length === 0 && (
        <div style={{
          padding: '60px 24px', textAlign: 'center', color: colors.textMuted, fontSize: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83D\uDCDC'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: colors.text }}>No chain-of-title documents found</div>
          <div>Upload documents marked as chain-of-title to begin building your title tree.</div>
        </div>
      )}
    </div>
  );
}
