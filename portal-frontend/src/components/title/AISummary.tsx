import { useState } from 'react';
import { GAP_COLOR, GREEN } from '../../lib/constants';
import type { TitleColors } from '../../lib/title-colors';
import type { TitleTree } from '../../types/title-chain';

interface AISummaryProps {
  tree: TitleTree;
  propertyLegal: string;
  isMobile?: boolean;
  darkMode?: boolean;
  colors?: TitleColors;
}

export function AISummary({ tree, propertyLegal, isMobile, darkMode, colors: c }: AISummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const { stats, gaps, currentOwners } = tree;

  // Compute date range from first root
  const firstDate = tree.roots[0]?.date;
  const dateRange = firstDate ? `${firstDate.slice(0, 4)}\u2013present` : '';

  // AISummary is always dark-styled (dark gradient card), so it stays consistent
  // Only adjust the outer border/shadow to blend with light vs dark page
  const cardBorder = darkMode ? '1px solid rgba(255,255,255,0.08)' : 'none';

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a2332 0%, #2d3a4a 100%)',
      borderRadius: 12, padding: isMobile ? '12px 14px' : '16px 24px', color: '#fff',
      fontFamily: "'DM Sans', sans-serif", border: cardBorder,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, #C05621 0%, #e87040 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}>{'\u2726'}</div>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>
            Title Assistant
          </span>
        </div>
        <button onClick={() => setExpanded(!expanded)}
          style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', borderRadius: 6, padding: isMobile ? '8px 14px' : '4px 12px',
            fontSize: 11, cursor: 'pointer', minHeight: 44,
            fontFamily: "'DM Sans', sans-serif" }}>
          {expanded ? 'Collapse' : 'Expand Analysis'}
        </button>
      </div>
      <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, opacity: 0.9 }}>
        Chain covers{' '}
        <span style={{ color: '#FBD38D', fontWeight: 700 }}>{stats.totalDocs} documents</span>{' '}
        {dateRange && <>from {dateRange} </>}with{' '}
        <span style={{ color: GAP_COLOR, fontWeight: 700 }}>
          {stats.gapCount} gap{stats.gapCount !== 1 ? 's' : ''}
        </span>.{' '}
        Resolves to{' '}
        <span style={{ color: '#68D391', fontWeight: 700 }}>
          {stats.ownerCount} current owner{stats.ownerCount !== 1 ? 's' : ''}
        </span>.
      </div>
      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.15)',
          fontSize: 12, lineHeight: 1.7, opacity: 0.85 }}>
          <div style={{ fontWeight: 700, color: '#FBD38D', marginBottom: 8, fontSize: 11,
            textTransform: 'uppercase', letterSpacing: 1 }}>Summary</div>
          <div style={{ marginBottom: 6 }}>
            {'\u2022'} {stats.linkedDocs} of {stats.totalDocs} documents linked into tree ({stats.stackedGroups} stacked groups)
          </div>
          {stats.gapCount > 0 && (
            <div style={{ marginBottom: 6, color: GAP_COLOR }}>
              {'\u2022'} {stats.gapCount} gap{stats.gapCount !== 1 ? 's' : ''} detected — search county records to fill
            </div>
          )}
          {(tree.orphanDocs?.length || tree.orphanDocIds?.length || 0) > 0 && (() => {
            const orphans = tree.orphanDocs || [];
            const total = orphans.length || tree.orphanDocIds?.length || 0;
            if (orphans.length === 0) {
              // Cached tree with old format — just show count
              return <div style={{ marginBottom: 6 }}>{'\u2022'} {total} orphan document{total !== 1 ? 's' : ''} not yet linked</div>;
            }
            const noParties = orphans.filter(o => o.reason === 'no_parties').length;
            const noMatch = orphans.filter(o => o.reason === 'no_match').length;
            return (
              <>
                {noMatch > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {'\u2022'} {noMatch} document{noMatch !== 1 ? 's' : ''} with unmatched party names — edit names to link
                  </div>
                )}
                {noParties > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {'\u2022'} {noParties} document{noParties !== 1 ? 's' : ''} with no extracted parties — add parties to link
                  </div>
                )}
              </>
            );
          })()}
          {currentOwners.length > 0 && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 11 }}>
              <strong style={{ color: GREEN }}>Current Owners:</strong>{' '}
              {currentOwners.map(o => o.owner_name).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
