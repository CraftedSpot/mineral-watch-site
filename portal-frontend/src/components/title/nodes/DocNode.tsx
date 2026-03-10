import { ORANGE, ORANGE_LIGHT, DARK, SLATE, BORDER, NODE_H, NODE_H_SIMPLE } from '../../../lib/constants';
import type { ViewMode } from '../../../lib/layout-engine';
import type { TitleColors } from '../../../lib/title-colors';
import { formatDate } from '../../../lib/helpers';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface DocNodeProps {
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
}

export function DocNode({ node, pos, isHovered, isPinned, isDimmed, viewMode = 'detailed', colors: c, onHover, onLeave, onClick }: DocNodeProps) {
  const hl = isHovered || isPinned;
  const isSimple = viewMode === 'simple';
  const h = isSimple ? NODE_H_SIMPLE : NODE_H;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(node); }}
      style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
      opacity={isDimmed ? 0.5 : 1}
      filter={isHovered ? 'url(#glow-orange)' : undefined}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={h} color={ORANGE} />}
      <rect width={pos.w} height={h} rx={isSimple ? 6 : 8}
        fill={hl ? (c?.cardHover || ORANGE_LIGHT) : (c?.card || '#fff')}
        stroke={hl ? ORANGE : (c?.cardStroke || BORDER)} strokeWidth={hl ? 2 : 1} />
      <rect width={isSimple ? 3 : 4} height={h} rx={isSimple ? 1.5 : 2} fill={ORANGE} />
      <text x={isSimple ? 12 : 14} y={isSimple ? 22 : 18} fontSize={10} fontWeight={700} fill={ORANGE}
        fontFamily="'DM Sans', sans-serif">
        {node.docType}
        {node.id?.startsWith('doc_') && (
          <tspan fontSize={7} fill={c?.textMuted || SLATE} fontFamily="monospace" opacity={0.5}>{' '}#{node.id.slice(4, 10)}</tspan>
        )}
      </text>
      <text x={pos.w - 10} y={isSimple ? 22 : 18} textAnchor="end" fontSize={9} fill={c?.textMuted || SLATE}
        fontFamily="'DM Sans', sans-serif">{formatDate(node.date)}</text>
      {!isSimple && (
        <foreignObject x={10} y={22} width={pos.w - 20} height={50}>
          <div style={{
            fontSize: 10, fontFamily: "'DM Sans', sans-serif",
            lineHeight: '14px', overflow: 'hidden',
          }}>
            <div style={{ color: c?.text || DARK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {node.grantor}
            </div>
            <div style={{ color: c?.textMuted || SLATE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {'\u2192'} {node.grantee}
            </div>
            {node.interestConveyed && (
              <div style={{ color: c?.textMuted || SLATE, fontSize: 9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.interestConveyed}
              </div>
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
}
