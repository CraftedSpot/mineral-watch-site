import { ORANGE, DARK, SLATE, GAP_COLOR, GREEN, BORDER } from '../../../lib/constants';
import { formatDate, formatDecimal, truncate } from '../../../lib/helpers';
import type { FlatNode } from '../../../types/title-chain';

interface PinnedDetailProps {
  node: FlatNode;
  position: { x: number; y: number };
  onClose: (id: string) => void;
  onExpandStack: (id: string) => void;
}

export function PinnedDetail({ node, position, onClose, onExpandStack }: PinnedDetailProps) {
  const base: React.CSSProperties = {
    position: 'absolute', left: position.x, top: position.y,
    background: '#fff', borderRadius: 12, padding: '18px 22px', width: 310,
    boxShadow: '0 16px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05)',
    zIndex: 200, fontFamily: "'DM Sans', sans-serif",
  };

  const closeBtn = (
    <button onClick={(e) => { e.stopPropagation(); onClose(node.id); }}
      style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none',
        fontSize: 16, color: SLATE, cursor: 'pointer', lineHeight: 1, padding: 4 }}>
      {'\u00D7'}
    </button>
  );

  if (node.type === 'gap') {
    return (
      <div style={{ ...base, borderTop: `3px solid ${GAP_COLOR}` }}>
        {closeBtn}
        <div style={{ fontSize: 12, fontWeight: 700, color: GAP_COLOR, marginBottom: 8 }}>
          {'\u26A0'} Gap in Chain of Title
        </div>
        <div style={{ fontSize: 13, color: DARK, marginBottom: 6 }}>{node.description}</div>
        <div style={{ fontSize: 12, color: SLATE, marginBottom: 12 }}>Period: {node.dateRange}</div>
        {node.suggestion && (
          <div style={{ fontSize: 11, color: SLATE, marginBottom: 12, padding: '8px 12px', background: '#f8f9fb', borderRadius: 8 }}>
            <strong style={{ color: DARK }}>Suggestion:</strong> {node.suggestion}
          </div>
        )}
      </div>
    );
  }

  if (node.type === 'current') {
    return (
      <div style={{ ...base, borderTop: `3px solid ${GREEN}` }}>
        {closeBtn}
        <div style={{ fontSize: 12, fontWeight: 700, color: GREEN, marginBottom: 4 }}>Current Owner</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: DARK, marginBottom: 12 }}>{node.owner}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>Interest</div>
            <div style={{ fontSize: 12, color: DARK, fontWeight: 600 }}>{node.interest || '\u2014'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>Type</div>
            <div style={{ fontSize: 12, color: ORANGE, fontWeight: 700 }}>{node.interestType || '\u2014'}</div>
          </div>
        </div>
        <div style={{ background: '#f8f9fb', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Decimal Interest</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: DARK, fontFamily: "'JetBrains Mono', monospace" }}>
            {formatDecimal(node.interestDecimal)}
          </div>
        </div>
        {node.acquiredDate && (
          <div style={{ fontSize: 11, color: SLATE }}>
            <strong style={{ color: DARK }}>Acquired:</strong> {node.acquiredDate}
          </div>
        )}
      </div>
    );
  }

  if (node.type === 'stack') {
    const docs = node.docs || [];
    return (
      <div style={{ ...base, borderTop: `3px solid ${ORANGE}` }}>
        {closeBtn}
        <div style={{ fontSize: 12, fontWeight: 700, color: ORANGE, marginBottom: 4 }}>{node.label}</div>
        <div style={{ fontSize: 11, color: SLATE, marginBottom: 12 }}>
          {docs.length} documents recorded {formatDate(node.date)}
        </div>
        {docs.map((doc) => (
          <div key={doc.id}
            style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 6, background: '#f8f9fb',
              border: `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: DARK }}>{doc.docType}</span>
            </div>
            <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>
              {truncate(doc.grantor, 26)} {'\u2192'} {truncate(doc.grantee, 24)}
            </div>
          </div>
        ))}
        <button onClick={(e) => { e.stopPropagation(); onExpandStack(node.id); }}
          style={{ width: '100%', background: '#f8f9fb', color: DARK, border: `1px solid ${BORDER}`,
            borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif", marginTop: 4 }}>
          Expand Stack on Canvas
        </button>
      </div>
    );
  }

  // Document
  return (
    <div style={{ ...base, borderTop: `3px solid ${ORANGE}` }}>
      {closeBtn}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: ORANGE }}>{node.docType}</span>
        <span style={{ fontSize: 11, color: SLATE }}>{formatDate(node.date)}</span>
      </div>
      <div style={{ fontSize: 9, color: SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Grantor</div>
      <div style={{ fontSize: 14, color: DARK, fontWeight: 600, marginBottom: 8 }}>{node.grantor || '\u2014'}</div>
      <div style={{ fontSize: 9, color: SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Grantee</div>
      <div style={{ fontSize: 14, color: DARK, fontWeight: 600, marginBottom: 12 }}>{node.grantee || '\u2014'}</div>
      {node.interestConveyed && (
        <div style={{ fontSize: 11, color: SLATE, marginBottom: 12, padding: '8px 12px', background: '#f8f9fb', borderRadius: 8 }}>
          {node.interestConveyed}
        </div>
      )}
    </div>
  );
}
