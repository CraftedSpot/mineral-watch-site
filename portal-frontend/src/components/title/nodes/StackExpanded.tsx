import { ORANGE, ORANGE_LIGHT, DARK, SLATE, BORDER, EXPANDED_CARD_H, EXPANDED_CARD_H_SIMPLE, EXPANDED_CARD_GAP } from '../../../lib/constants';
import type { ViewMode } from '../../../lib/layout-engine';
import type { TitleColors } from '../../../lib/title-colors';
import { formatDate, truncate } from '../../../lib/helpers';
import { PinRing } from './PinRing';
import type { FlatNode, FlatStackDoc, NodePosition } from '../../../types/title-chain';

interface StackExpandedProps {
  node: FlatNode;
  pos: NodePosition;
  hoveredId: string | null;
  selectedNodeId: string | null;
  viewMode?: ViewMode;
  colors?: TitleColors;
  onHover: (id: string) => void;
  onLeave: () => void;
  onCardClick: (doc: FlatStackDoc) => void;
  onCollapse: () => void;
}

export function StackExpanded({ node, pos, hoveredId, selectedNodeId, viewMode = 'detailed', colors: c, onHover, onLeave, onCardClick, onCollapse }: StackExpandedProps) {
  const docs = node.docs || [];
  const isSimple = viewMode === 'simple';
  const cardH = isSimple ? EXPANDED_CARD_H_SIMPLE : EXPANDED_CARD_H;
  const totalH = docs.length * (cardH + EXPANDED_CARD_GAP) + 36;

  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      {/* Backdrop */}
      <rect width={pos.w + 16} height={totalH} x={-8} y={-8} rx={12}
        fill={c?.stackBg || 'rgba(248,249,251,0.95)'} stroke={ORANGE} strokeWidth={1.5} />
      {/* Header */}
      <text x={4} y={14} fontSize={10} fontWeight={700} fill={ORANGE}
        fontFamily="'DM Sans', sans-serif">{node.label}</text>
      <g onClick={(e) => { e.stopPropagation(); onCollapse(); }} style={{ cursor: 'pointer' }}>
        <rect x={pos.w - 68} y={2} width={64} height={18} rx={4} fill="rgba(128,128,128,0.08)" />
        <text x={pos.w - 36} y={14} textAnchor="middle" fontSize={9} fill={c?.textMuted || SLATE}
          fontFamily="'DM Sans', sans-serif">{'\u2715'} collapse</text>
      </g>
      {/* Individual cards */}
      {docs.map((doc, i) => {
        const cy = 28 + i * (cardH + EXPANDED_CARD_GAP);
        const isHov = hoveredId === doc.id;
        const isPin = selectedNodeId === doc.id;
        const hl = isHov || isPin;
        return (
          <g key={doc.id} transform={`translate(0, ${cy})`}
            onMouseEnter={() => onHover(doc.id)}
            onMouseLeave={onLeave}
            onClick={(e) => { e.stopPropagation(); onCardClick(doc); }}
            style={{ cursor: 'pointer' }}>
            {isPin && <PinRing x={0} y={0} w={pos.w} h={cardH} color={ORANGE} />}
            <rect width={pos.w} height={cardH} rx={6}
              fill={hl ? (c?.cardHover || ORANGE_LIGHT) : (c?.card || '#fff')}
              stroke={hl ? ORANGE : (c?.cardStroke || BORDER)}
              strokeWidth={hl ? 2 : 1} />
            <rect width={3} height={cardH} rx={1.5} fill={hl ? ORANGE : (c?.textMuted || SLATE)} />
            <text x={12} y={16} fontSize={9} fontWeight={700}
              fill={hl ? ORANGE : (c?.text || DARK)} fontFamily="'DM Sans', sans-serif">{doc.docType}</text>
            <text x={pos.w - 8} y={16} textAnchor="end" fontSize={8}
              fill={c?.textMuted || SLATE} fontFamily="'DM Sans', sans-serif">{formatDate(doc.date)}</text>
            {!isSimple && (
              <>
                <text x={12} y={32} fontSize={9} fill={c?.text || DARK}
                  fontFamily="'DM Sans', sans-serif">{truncate(doc.grantor, 32)}</text>
                <text x={12} y={46} fontSize={9} fill={c?.textMuted || SLATE}
                  fontFamily="'DM Sans', sans-serif">{'\u2192'} {truncate(doc.grantee, 30)}</text>
                {doc.interestConveyed && (
                  <text x={12} y={64} fontSize={8} fill={c?.textMuted || SLATE}
                    fontFamily="'DM Sans', sans-serif">{truncate(doc.interestConveyed, 38)}</text>
                )}
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}
