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
}

const REASON_LABELS: Record<string, { label: string; hint: string }> = {
  no_parties: { label: 'No parties extracted', hint: 'Add party names to link this document into the chain.' },
  no_match: { label: 'Names don\u2019t match', hint: 'Edit party names to match other documents in the chain.' },
  unknown: { label: 'Unlinked', hint: 'This document could not be connected to the chain.' },
};

export function OrphanCard({ node, isSelected, isMobile, colors: c, onClick }: OrphanCardProps) {
  const reason = REASON_LABELS[node.reason || 'unknown'] || REASON_LABELS.unknown;

  return (
    <div
      onClick={() => onClick(node)}
      style={{
        padding: isMobile ? '12px 14px' : '10px 14px',
        borderRadius: 8,
        border: `1px solid ${isSelected ? WARNING_AMBER : (c?.border || BORDER)}`,
        background: isSelected ? 'rgba(245,158,11,0.08)' : (c?.card || '#fff'),
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
            fontSize: 10, fontWeight: 700, color: WARNING_AMBER,
            fontFamily: "'DM Sans', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {node.docType || 'Document'}
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

        {/* Reason badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6,
          padding: '2px 8px', borderRadius: 4,
          background: 'rgba(245,158,11,0.1)', fontSize: 10,
          color: '#92400e', fontFamily: "'DM Sans', sans-serif",
        }}>
          <span style={{ fontSize: 11 }}>{'\u26A0'}</span>
          {reason.label}
        </div>
      </div>
    </div>
  );
}
