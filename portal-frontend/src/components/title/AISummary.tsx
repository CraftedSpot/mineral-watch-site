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

  const cardBorder = darkMode ? '1px solid rgba(255,255,255,0.08)' : 'none';

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a2332 0%, #2d3a4a 100%)',
      borderRadius: 10, padding: isMobile ? '8px 12px' : '8px 20px', color: '#fff',
      fontFamily: "'DM Sans', sans-serif", border: cardBorder,
    }}>
      {/* Single-row summary: icon + text + expand button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: 'linear-gradient(135deg, #C05621 0%, #e87040 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
        }}>{'\u2726'}</div>
        <span style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.9, flex: 1 }}>
          <span style={{ color: '#F59E0B', fontWeight: 700 }}>{stats.totalDocs} docs</span>
          {dateRange && <> from {dateRange}</>}
          {' \u2022 '}
          <span style={{ color: '#FCA5A5', fontWeight: 700 }}>
            {stats.gapCount} gap{stats.gapCount !== 1 ? 's' : ''}
          </span>
          {' \u2022 '}
          <span style={{ color: '#86EFAC', fontWeight: 700 }}>
            {stats.ownerCount} owner{stats.ownerCount !== 1 ? 's' : ''}
          </span>
        </span>
        <button onClick={() => setExpanded(!expanded)}
          style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff', borderRadius: 5, padding: '3px 10px', flexShrink: 0,
            fontSize: 10, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
          }}>
          {expanded ? 'Less' : 'More'}
        </button>
      </div>

      {/* Expanded analysis */}
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.12)',
          fontSize: 12, lineHeight: 1.7, opacity: 0.85 }}>
          <div style={{ marginBottom: 4 }}>
            {'\u2022'} {stats.linkedDocs} of {stats.totalDocs} documents linked into tree ({stats.stackedGroups} stacked groups)
          </div>
          {stats.gapCount > 0 && (
            <div style={{ marginBottom: 4, color: '#FCA5A5' }}>
              {'\u2022'} {stats.gapCount} gap{stats.gapCount !== 1 ? 's' : ''} detected — search county records to fill
            </div>
          )}
          {(tree.orphanDocs?.length || tree.orphanDocIds?.length || 0) > 0 && (() => {
            const orphans = tree.orphanDocs || [];
            const total = orphans.length || tree.orphanDocIds?.length || 0;
            if (orphans.length === 0) {
              return <div style={{ marginBottom: 4 }}>{'\u2022'} {total} orphan document{total !== 1 ? 's' : ''} not yet linked</div>;
            }
            const noParties = orphans.filter(o => o.reason === 'no_parties').length;
            const noMatch = orphans.filter(o => o.reason === 'no_match').length;
            return (
              <>
                {noMatch > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    {'\u2022'} {noMatch} document{noMatch !== 1 ? 's' : ''} with unmatched party names — edit names to link
                  </div>
                )}
                {noParties > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    {'\u2022'} {noParties} document{noParties !== 1 ? 's' : ''} with no extracted parties — add parties to link
                  </div>
                )}
              </>
            );
          })()}
          {currentOwners.length > 0 && (
            <div style={{ marginTop: 8, padding: '6px 12px', background: 'rgba(255,255,255,0.08)', borderRadius: 6, fontSize: 11 }}>
              <strong style={{ color: '#86EFAC' }}>Current Owners:</strong>{' '}
              {currentOwners.map(o => o.owner_name).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
