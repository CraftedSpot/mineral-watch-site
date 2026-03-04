import { ORANGE, DARK, SLATE, GAP_COLOR, GREEN, BORDER } from '../../../lib/constants';
import { formatDecimal, truncate } from '../../../lib/helpers';
import type { FlatNode } from '../../../types/title-chain';

interface HoverTooltipProps {
  node: FlatNode | null;
  pos: { x: number; y: number };
}

export function HoverTooltip({ node, pos }: HoverTooltipProps) {
  if (!node) return null;

  const style: React.CSSProperties = {
    position: 'absolute', left: pos.x, top: pos.y, background: '#fff',
    border: `1px solid ${BORDER}`, borderRadius: 8, padding: '8px 12px', maxWidth: 220,
    boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 150,
    fontFamily: "'DM Sans', sans-serif", pointerEvents: 'none', fontSize: 11,
  };

  const hint = (
    <div style={{ color: SLATE, fontSize: 10, marginTop: 6, borderTop: `1px solid ${BORDER}`, paddingTop: 6 }}>
      Click to pin details
    </div>
  );

  if (node.type === 'stack') {
    return (
      <div style={style}>
        <div style={{ fontWeight: 700, color: ORANGE, marginBottom: 4 }}>{node.label}</div>
        <div style={{ color: SLATE, fontSize: 10 }}>{(node.docs || []).length} documents</div>
        <div style={{ color: SLATE, fontSize: 10, marginTop: 6, borderTop: `1px solid ${BORDER}`, paddingTop: 6 }}>
          Click to expand
        </div>
      </div>
    );
  }

  if (node.type === 'gap') {
    return (
      <div style={style}>
        <div style={{ fontWeight: 700, color: GAP_COLOR, marginBottom: 2 }}>Gap: {node.dateRange}</div>
        <div style={{ color: SLATE, fontSize: 10 }}>{node.description}</div>
        {hint}
      </div>
    );
  }

  if (node.type === 'current') {
    return (
      <div style={style}>
        <div style={{ fontWeight: 700, color: GREEN, marginBottom: 2 }}>{node.owner}</div>
        <div style={{ color: DARK, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600 }}>
          {formatDecimal(node.interestDecimal)}
        </div>
        <div style={{ color: SLATE, fontSize: 10 }}>{node.interest || ''}</div>
        {hint}
      </div>
    );
  }

  // Document
  return (
    <div style={style}>
      <div style={{ fontWeight: 700, color: ORANGE, marginBottom: 2 }}>{node.docType}</div>
      <div style={{ color: DARK }}>{truncate(node.grantor, 28)} {'\u2192'} {truncate(node.grantee, 26)}</div>
      {node.interestConveyed && (
        <div style={{ color: SLATE, fontSize: 10, marginTop: 2 }}>{node.interestConveyed}</div>
      )}
      {hint}
    </div>
  );
}
