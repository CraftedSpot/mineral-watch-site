import { useEffect } from 'react';
import { ORANGE, DARK, SLATE, GAP_COLOR, GREEN, BORDER } from '../../../lib/constants';
import type { TitleColors } from '../../../lib/title-colors';
import { formatDate, formatDecimal, truncate } from '../../../lib/helpers';
import type { FlatNode } from '../../../types/title-chain';

interface DetailDrawerProps {
  node: FlatNode | null;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  isMobile?: boolean;
  colors?: TitleColors;
}

const DRAWER_W = 380;

export function DetailDrawer({ node, onClose, onExpandStack, isMobile, colors: c }: DetailDrawerProps) {
  const isOpen = !!node;

  // Escape key closes drawer
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (isMobile) {
    return <MobileSheet node={node} onClose={onClose} onExpandStack={onExpandStack} colors={c} />;
  }

  // Desktop: right-side drawer
  return (
    <div style={{
      width: isOpen ? DRAWER_W : 0,
      transition: 'width 0.3s ease',
      overflow: 'hidden',
      flexShrink: 0,
      borderLeft: isOpen ? `1px solid ${c?.border || BORDER}` : 'none',
    }}>
      <div style={{
        width: DRAWER_W,
        height: '100%',
        overflowY: 'auto',
        background: c?.surface || '#fff',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {node && <DrawerContent node={node} onClose={onClose} onExpandStack={onExpandStack} colors={c} />}
      </div>
    </div>
  );
}

function MobileSheet({ node, onClose, onExpandStack, colors: c }: {
  node: FlatNode | null;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  colors?: TitleColors;
}) {
  const isOpen = !!node;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', zIndex: 999998,
          }}
        />
      )}
      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        maxHeight: '60vh',
        transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s ease',
        background: c?.surface || '#fff',
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
        zIndex: 999999,
        overflowY: 'auto',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {/* Drag handle */}
        <div style={{
          display: 'flex', justifyContent: 'center', padding: '8px 0 4px',
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: c?.border || '#d1d5db' }} />
        </div>
        {node && <DrawerContent node={node} onClose={onClose} onExpandStack={onExpandStack} colors={c} isMobile />}
      </div>
    </>
  );
}

function DrawerContent({ node, onClose, onExpandStack, colors: c, isMobile }: {
  node: FlatNode;
  onClose: () => void;
  onExpandStack: (id: string) => void;
  colors?: TitleColors;
  isMobile?: boolean;
}) {
  const pad = isMobile ? '14px 16px 24px' : '20px 24px';
  const fieldBg = c?.fieldBg || '#f8f9fb';

  const closeBtn = (
    <button onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: 'absolute', top: isMobile ? 12 : 16, right: isMobile ? 12 : 16,
        background: 'none', border: 'none',
        fontSize: isMobile ? 22 : 18, color: c?.textMuted || SLATE, cursor: 'pointer',
        lineHeight: 1, padding: isMobile ? 8 : 4,
        minWidth: 44, minHeight: 44,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {'\u00D7'}
    </button>
  );

  if (node.type === 'gap') {
    return (
      <div style={{ padding: pad, position: 'relative' }}>
        {closeBtn}
        <div style={{ borderLeft: `3px solid ${GAP_COLOR}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: GAP_COLOR, textTransform: 'uppercase', letterSpacing: 1 }}>
            Gap in Chain
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK, marginTop: 4 }}>
            {'\u26A0'} Missing Documents
          </div>
        </div>
        <div style={{ fontSize: 13, color: c?.text || DARK, marginBottom: 12, lineHeight: 1.6 }}>
          {node.description}
        </div>
        <div style={{ fontSize: 12, color: c?.textMuted || SLATE, marginBottom: 16 }}>
          Period: {node.dateRange}
        </div>
        {node.suggestion && (
          <div style={{
            fontSize: 12, color: c?.text || DARK, padding: '12px 16px',
            background: fieldBg, borderRadius: 8, lineHeight: 1.5,
          }}>
            <strong>Suggestion:</strong> {node.suggestion}
          </div>
        )}
      </div>
    );
  }

  if (node.type === 'current') {
    return (
      <div style={{ padding: pad, position: 'relative' }}>
        {closeBtn}
        <div style={{ borderLeft: `3px solid ${GREEN}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: 1 }}>
            Current Owner
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK, marginTop: 4 }}>
            {node.owner}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <FieldBlock label="Interest" value={node.interest || '\u2014'} colors={c} />
          <FieldBlock label="Type" value={node.interestType || '\u2014'} colors={c} valueColor={ORANGE} bold />
        </div>
        <div style={{
          background: fieldBg, borderRadius: 10, padding: '14px 18px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Decimal Interest
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: c?.text || DARK, fontFamily: "'JetBrains Mono', monospace" }}>
            {formatDecimal(node.interestDecimal)}
          </div>
        </div>
        {node.acquiredDate && (
          <div style={{ fontSize: 12, color: c?.textMuted || SLATE }}>
            <strong style={{ color: c?.text || DARK }}>Acquired:</strong> {node.acquiredDate}
          </div>
        )}
      </div>
    );
  }

  if (node.type === 'stack') {
    const docs = node.docs || [];
    return (
      <div style={{ padding: pad, position: 'relative' }}>
        {closeBtn}
        <div style={{ borderLeft: `3px solid ${ORANGE}`, paddingLeft: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1 }}>
            Stacked Documents
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK, marginTop: 4 }}>
            {node.label}
          </div>
          <div style={{ fontSize: 12, color: c?.textMuted || SLATE, marginTop: 2 }}>
            {docs.length} documents recorded {formatDate(node.date)}
          </div>
        </div>
        {docs.map((doc) => (
          <div key={doc.id} style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 8,
            background: fieldBg, border: `1px solid ${c?.border || BORDER}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: c?.text || DARK }}>{doc.docType}</span>
              <span style={{ fontSize: 10, color: c?.textMuted || SLATE }}>{formatDate(doc.date)}</span>
            </div>
            <div style={{ fontSize: 11, color: c?.textMuted || SLATE, marginTop: 4 }}>
              {truncate(doc.grantor, 30)} {'\u2192'} {truncate(doc.grantee, 28)}
            </div>
            {doc.interestConveyed && (
              <div style={{ fontSize: 10, color: c?.textMuted || SLATE, marginTop: 2 }}>
                {doc.interestConveyed}
              </div>
            )}
          </div>
        ))}
        <button onClick={(e) => { e.stopPropagation(); onExpandStack(node.id); }}
          style={{
            width: '100%', background: fieldBg, color: c?.text || DARK,
            border: `1px solid ${c?.border || BORDER}`,
            borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginTop: 4,
          }}>
          Expand Stack on Canvas
        </button>
      </div>
    );
  }

  // Document
  return (
    <div style={{ padding: pad, position: 'relative' }}>
      {closeBtn}
      <div style={{ borderLeft: `3px solid ${ORANGE}`, paddingLeft: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1 }}>
          Document
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: c?.text || DARK, marginTop: 4 }}>
          {node.docType}
        </div>
        <div style={{ fontSize: 12, color: c?.textMuted || SLATE, marginTop: 2 }}>
          {formatDate(node.date)}
        </div>
      </div>
      <FieldBlock label="Grantor" value={node.grantor || '\u2014'} colors={c} large />
      <div style={{ marginBottom: 12 }}>
        <FieldBlock label="Grantee" value={node.grantee || '\u2014'} colors={c} large />
      </div>
      {node.interestConveyed && (
        <div style={{
          fontSize: 12, color: c?.text || DARK, padding: '12px 16px',
          background: fieldBg, borderRadius: 8, lineHeight: 1.5, marginBottom: 12,
        }}>
          <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Interest Conveyed
          </div>
          {node.interestConveyed}
        </div>
      )}
      {node.recordingInfo && (
        <div style={{ fontSize: 11, color: c?.textMuted || SLATE, marginTop: 8 }}>
          <strong style={{ color: c?.text || DARK }}>Recording:</strong> {node.recordingInfo}
        </div>
      )}
    </div>
  );
}

function FieldBlock({ label, value, colors: c, valueColor, bold, large }: {
  label: string;
  value: string;
  colors?: TitleColors;
  valueColor?: string;
  bold?: boolean;
  large?: boolean;
}) {
  return (
    <div style={{ marginBottom: large ? 0 : 8 }}>
      <div style={{ fontSize: 9, color: c?.textMuted || SLATE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{
        fontSize: large ? 15 : 13, color: valueColor || (c?.text || DARK),
        fontWeight: bold ? 700 : 600,
      }}>
        {value}
      </div>
    </div>
  );
}
