import { ORANGE, ORANGE_LIGHT, DARK, SLATE, BORDER, STACK_H, STACK_H_SIMPLE } from '../../../lib/constants';
import type { ViewMode } from '../../../lib/layout-engine';
import type { TitleColors } from '../../../lib/title-colors';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface StackCollapsedProps {
  node: FlatNode;
  pos: NodePosition;
  isHovered: boolean;
  isPinned: boolean;
  isDimmed?: boolean;
  viewMode?: ViewMode;
  colors?: TitleColors;
  onHover: (id: string) => void;
  onLeave: () => void;
  onClick: (node: FlatNode) => void;
  onExpand: (id: string) => void;
}

export function StackCollapsed({ node, pos, isHovered, isPinned, isDimmed, viewMode = 'detailed', colors: c, onHover, onLeave, onClick, onExpand }: StackCollapsedProps) {
  const docs = node.docs || [];
  const primaryDoc = docs[0];
  const hl = isHovered || isPinned;
  const isSimple = viewMode === 'simple';
  const h = (isSimple ? STACK_H_SIMPLE : STACK_H) - 8;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onExpand(node.id); }}
      style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
      opacity={isDimmed ? 0.5 : 1}
      filter={isHovered ? 'url(#glow-orange)' : undefined}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={h} color={ORANGE} />}
      {/* Shadow cards */}
      <rect width={pos.w} height={h} rx={isSimple ? 6 : 8} fill={c?.shadowCard1 || '#f1f5f9'} stroke={c?.cardStroke || BORDER} strokeWidth={1} x={6} y={6} />
      <rect width={pos.w} height={h} rx={isSimple ? 6 : 8} fill={c?.shadowCard2 || '#f8fafc'} stroke={c?.cardStroke || BORDER} strokeWidth={1} x={3} y={3} />
      {/* Main card */}
      <rect width={pos.w} height={h} rx={isSimple ? 6 : 8}
        fill={hl ? (c?.cardHover || ORANGE_LIGHT) : (c?.card || '#fff')} stroke={hl ? ORANGE : (c?.cardStroke || BORDER)} strokeWidth={hl ? 2 : 1} />
      <rect width={isSimple ? 3 : 4} height={h} rx={isSimple ? 1.5 : 2} fill={ORANGE} />
      {/* Badge */}
      <rect x={pos.w - 40} y={-8} width={36} height={18} rx={9} fill={ORANGE} />
      <text x={pos.w - 22} y={5} textAnchor="middle" fontSize={10} fontWeight={700}
        fill="#fff" fontFamily="'DM Sans', sans-serif">{docs.length}</text>
      {/* Content */}
      <text x={isSimple ? 12 : 14} y={isSimple ? 24 : 18} fontSize={10} fontWeight={700} fill={ORANGE}
        fontFamily="'DM Sans', sans-serif">{primaryDoc?.docType || node.docType}</text>
      {!isSimple && (
        <foreignObject x={10} y={22} width={pos.w - 20} height={46}>
          <div style={{
            fontSize: 10, fontFamily: "'DM Sans', sans-serif",
            lineHeight: '14px', overflow: 'hidden',
          }}>
            <div style={{ color: c?.text || DARK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {primaryDoc?.grantor || node.grantor}
            </div>
            <div style={{ color: c?.textMuted || SLATE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {'\u2192'} {primaryDoc?.grantee || node.grantee}
            </div>
            {(primaryDoc?.interestConveyed || node.interestConveyed) && (
              <div style={{ color: c?.textMuted || SLATE, fontSize: 9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {primaryDoc?.interestConveyed || node.interestConveyed}
              </div>
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
}
