import { GAP_COLOR, GAP_BG, SLATE, ORANGE, GAP_H } from '../../../lib/constants';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface GapNodeProps {
  node: FlatNode;
  pos: NodePosition;
  isHovered: boolean;
  isPinned: boolean;
  onHover: (id: string) => void;
  onLeave: () => void;
  onClick: (node: FlatNode) => void;
}

export function GapNode({ node, pos, isHovered, isPinned, onHover, onLeave, onClick }: GapNodeProps) {
  const hl = isHovered || isPinned;
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(node); }}
      style={{ cursor: 'pointer' }}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={GAP_H} color={GAP_COLOR} />}
      <rect width={pos.w} height={GAP_H} rx={8}
        fill={hl ? '#fee2e2' : GAP_BG} stroke={GAP_COLOR} strokeWidth={2} strokeDasharray="6 4" />
      <text x={pos.w / 2} y={20} textAnchor="middle" fontSize={11} fontWeight={700}
        fill={GAP_COLOR} fontFamily="'DM Sans', sans-serif">{'\u26A0'} GAP IN CHAIN</text>
      <text x={pos.w / 2} y={36} textAnchor="middle" fontSize={10} fill={SLATE}
        fontFamily="'DM Sans', sans-serif">{node.dateRange}</text>
      <text x={pos.w / 2} y={54} textAnchor="middle" fontSize={9} fill={ORANGE}
        fontWeight={600} fontFamily="'DM Sans', sans-serif">Search County Records {'\u2192'}</text>
    </g>
  );
}
