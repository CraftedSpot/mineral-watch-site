import { useState, useEffect } from 'react';
import { fetchChainProperties, fetchTitleChain } from '../../api/title-chain';
import { SLATE, GAP_COLOR } from '../../lib/constants';
import type { ChainProperty, TitleChainResponse } from '../../types/title-chain';
import { PropertySelector } from './PropertySelector';
import { ChainTreeView } from './ChainTreeView';
import { AISummary } from './AISummary';

export function TitlePage() {
  const [properties, setProperties] = useState<ChainProperty[]>([]);
  const [propsLoading, setPropsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chainData, setChainData] = useState<TitleChainResponse | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load properties on mount
  useEffect(() => {
    fetchChainProperties()
      .then((res) => {
        setProperties(res.properties);
        // Auto-select first property
        if (res.properties.length > 0) {
          setSelectedId(res.properties[0].airtableRecordId);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setPropsLoading(false));
  }, []);

  // Load chain data when selection changes
  useEffect(() => {
    if (!selectedId) return;
    setChainLoading(true);
    setError(null);
    fetchTitleChain(selectedId)
      .then((res) => setChainData(res))
      .catch((err) => setError(err.message))
      .finally(() => setChainLoading(false));
  }, [selectedId]);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Toolbar */}
      <div style={{
        padding: '12px 24px', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#fff',
      }}>
        <PropertySelector
          properties={properties}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={propsLoading}
        />
        {chainData?.property && (
          <div style={{ fontSize: 12, color: SLATE, display: 'flex', gap: 16 }}>
            <span>{chainData.documents.length} documents</span>
            {chainData.tree && (
              <>
                <span style={{ color: GAP_COLOR }}>{chainData.tree.stats.gapCount} gaps</span>
                <span>{chainData.tree.stats.ownerCount} current owners</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div style={{
        padding: '8px 24px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#92400E',
      }}>
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        AI-interpreted chain of title — not a legal opinion. Documents shown are those uploaded to your account.
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: '16px 24px', color: '#dc2626', fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {/* Loading state */}
      {chainLoading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '60px 24px', color: SLATE,
        }}>
          <div style={{
            width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#C05621',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ marginLeft: 12, fontSize: 14 }}>Loading chain of title...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Tree view */}
      {!chainLoading && chainData?.tree && (
        <>
          <div style={{ padding: '12px 24px' }}>
            <AISummary tree={chainData.tree} propertyLegal={chainData.property.legal} />
          </div>
          <ChainTreeView tree={chainData.tree} />
        </>
      )}

      {/* No tree data */}
      {!chainLoading && chainData && !chainData.tree && (
        <div style={{
          padding: '60px 24px', textAlign: 'center', color: SLATE, fontSize: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83C\uDF33'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No tree data available</div>
          <div>Upload chain-of-title documents for this property to see the tree view.</div>
        </div>
      )}

      {/* No properties */}
      {!propsLoading && properties.length === 0 && (
        <div style={{
          padding: '60px 24px', textAlign: 'center', color: SLATE, fontSize: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83D\uDCDC'}</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No chain-of-title documents found</div>
          <div>Upload documents marked as chain-of-title to begin building your title tree.</div>
        </div>
      )}
    </div>
  );
}
