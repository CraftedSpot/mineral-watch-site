import { useState } from 'react';
import { WARNING_AMBER, DARK, SLATE, BORDER } from '../../../lib/constants';
import type { TitleColors } from '../../../lib/title-colors';
import { formatDate } from '../../../lib/helpers';
import type { FlatNode } from '../../../types/title-chain';

interface OrphanCardProps {
  node: FlatNode;
  isSelected: boolean;
  isMobile?: boolean;
  colors?: TitleColors;
  onClick: (node: FlatNode) => void;
  onMarkRoot?: (docId: string) => void;
}

const REASON_LABELS: Record<string, { label: string; hint: string }> = {
  no_parties: { label: 'No parties extracted', hint: 'Add party names to link this document into the chain.' },
  no_match: { label: 'Names don\u2019t match', hint: 'Edit party names to match other documents in the chain.' },
  unknown: { label: 'Unlinked', hint: 'This document could not be connected to the chain.' },
};

export function OrphanCard({ node, isSelected, isMobile, colors: c, onClick, onMarkRoot }: OrphanCardProps) {
  const reason = REASON_LABELS[node.reason || 'unknown'] || REASON_LABELS.unknown;
  const diag = node.matchDiagnostic;
  const [diagExpanded, setDiagExpanded] = useState(false);
  const isDark = !!c && c.bg !== '#fff';

  // Dark-mode-aware accent colors
  const amberBadgeBg = isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.1)';
  const amberBadgeText = isDark ? '#fbbf24' : '#92400e';
  const mutedBadgeBg = isDark ? 'rgba(148,163,184,0.15)' : 'rgba(107,114,128,0.1)';
  const mutedBadgeText = isDark ? '#94a3b8' : '#6b7280';
  const blueBtnBg = isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.1)';
  const blueBtnText = isDark ? '#93c5fd' : '#1d4ed8';
  const diagBg = isDark ? 'rgba(96,165,250,0.08)' : 'rgba(59,130,246,0.05)';
  const diagHighlightBg = isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.1)';
  const diagHighlightText = isDark ? '#93c5fd' : '#1d4ed8';
  const diagBtnBorder = isDark ? 'rgba(96,165,250,0.3)' : 'rgba(59,130,246,0.3)';

  return (
    <div
      onClick={() => onClick(node)}
      style={{
        padding: isMobile ? '12px 14px' : '10px 14px',
        borderRadius: 8,
        border: `1px solid ${isSelected ? WARNING_AMBER : (c?.border || BORDER)}`,
        background: isSelected ? (isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)') : (c?.card || '#fff'),
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        minHeight: isMobile ? 44 : undefined,
      }}
    >
      {/* Amber left accent */}
      <div style={{
        width: 3, minHeight: 36, borderRadius: 2,
        background: WARNING_AMBER, flexShrink: 0, marginTop: 2,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top row: doc type + date */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: isDark ? '#fbbf24' : WARNING_AMBER,
            fontFamily: "'DM Sans', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {node.docType || 'Document'}
            {node.id?.startsWith('doc_') && (
              <span style={{ fontSize: 7, fontFamily: 'monospace', opacity: 0.5, marginLeft: 4, color: c?.textMuted || SLATE }}>
                #{node.id.slice(4, 10)}
              </span>
            )}
          </span>
          <span style={{
            fontSize: 9, color: c?.textMuted || SLATE,
            fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
          }}>
            {formatDate(node.date)}
          </span>
        </div>

        {/* Display name */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: c?.text || DARK,
          fontFamily: "'DM Sans', sans-serif", marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {node.displayName || node.grantor || 'Untitled'}
        </div>

        {/* Parties (if any) */}
        {(node.grantor || node.grantee) && (
          <div style={{
            fontSize: 10, color: c?.textMuted || SLATE,
            fontFamily: "'DM Sans', sans-serif", marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {node.grantor}{node.grantor && node.grantee ? ' \u2192 ' : ''}{node.grantee}
          </div>
        )}

        {/* Reason badge + hidden duplicates */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 4,
            background: amberBadgeBg, fontSize: 10,
            color: amberBadgeText, fontFamily: "'DM Sans', sans-serif",
          }}>
            <span style={{ fontSize: 11 }}>{'\u26A0'}</span>
            {reason.label}
          </div>
          {(node.hiddenDuplicates ?? 0) > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 4,
              background: mutedBadgeBg, fontSize: 10,
              color: mutedBadgeText, fontFamily: "'DM Sans', sans-serif",
            }}>
              +{node.hiddenDuplicates} duplicate{node.hiddenDuplicates === 1 ? '' : 's'}
            </div>
          )}
          {diag && node.reason === 'no_match' && (
            <button
              onClick={(e) => { e.stopPropagation(); setDiagExpanded(v => !v); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 8px', borderRadius: 4, border: 'none',
                background: blueBtnBg, fontSize: 10,
                color: blueBtnText, fontFamily: "'DM Sans', sans-serif",
                cursor: 'pointer',
              }}
            >
              {diagExpanded ? 'Hide' : 'Why?'}
            </button>
          )}
        </div>

        {/* Diagnostic detail */}
        {diagExpanded && diag && (
          <div style={{
            marginTop: 6, padding: '6px 8px', borderRadius: 4,
            background: diagBg, fontSize: 10,
            fontFamily: "'DM Sans', sans-serif", color: c?.text || DARK,
          }}>
            {diag.noEarlierDocs && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4,
                padding: '3px 6px', borderRadius: 3,
                background: diagHighlightBg, color: diagHighlightText,
                fontWeight: 600,
              }}>
                May be a chain root — no earlier documents found
                {onMarkRoot && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMarkRoot(node.id); }}
                    style={{
                      marginLeft: 'auto', padding: '1px 6px', borderRadius: 3,
                      border: `1px solid ${diagBtnBorder}`, background: diagHighlightBg,
                      fontSize: 9, fontWeight: 700, color: diagHighlightText, cursor: 'pointer',
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    Mark as root
                  </button>
                )}
              </div>
            )}
            {diag.nearMisses.length > 0 ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2, color: c?.textMuted || SLATE }}>Possible matches:</div>
                {diag.nearMisses.map((nm, i) => (
                  <div key={i} style={{ marginLeft: 4, marginTop: 2, lineHeight: 1.4 }}>
                    <span style={{ opacity: 0.7 }}>{nm.orphanName}</span>
                    {' \u2248 '}
                    <span style={{ fontWeight: 600 }}>{nm.candidateName}</span>
                    <span style={{ opacity: 0.5 }}>{' on '}{nm.candidateDisplayName}</span>
                  </div>
                ))}
              </div>
            ) : !diag.noEarlierDocs && (
              <div style={{ color: c?.textMuted || SLATE }}>
                Searched for: {diag.searchedNames.join(', ')} — no similar names found in earlier documents
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
