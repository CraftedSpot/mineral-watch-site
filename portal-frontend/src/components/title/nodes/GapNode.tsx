import { GAP_COLOR, GAP_BG, SLATE, ORANGE, GAP_H, GAP_H_SIMPLE } from '../../../lib/constants';
import type { ViewMode } from '../../../lib/layout-engine';
import type { TitleColors } from '../../../lib/title-colors';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface GapNodeProps {
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

export function GapNode({ node, pos, isHovered, isPinned, isDimmed, viewMode = 'detailed', colors: c, onHover, onLeave, onClick }: GapNodeProps) {
  const hl = isHovered || isPinned;
  const isSimple = viewMode === 'simple';
  const h = isSimple ? GAP_H_SIMPLE : GAP_H;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(node); }}
      style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
      opacity={isDimmed ? 0.5 : 1}
      filter={isHovered ? 'url(#glow-red)' : undefined}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={h} color={GAP_COLOR} />}
      <rect width={pos.w} height={h} rx={isSimple ? 6 : 8}
        fill={hl ? (c?.gapBgHover || '#fee2e2') : (c?.gapBg || GAP_BG)} stroke={GAP_COLOR} strokeWidth={2} strokeDasharray="6 4" />
      <text x={pos.w / 2} y={isSimple ? 16 : 20} textAnchor="middle" fontSize={isSimple ? 10 : 11} fontWeight={700}
        fill={GAP_COLOR} fontFamily="'DM Sans', sans-serif">{'\u26A0'} GAP IN CHAIN</text>
      <text x={pos.w / 2} y={isSimple ? 32 : 36} textAnchor="middle" fontSize={isSimple ? 9 : 10} fill={c?.textMuted || SLATE}
        fontFamily="'DM Sans', sans-serif">{node.dateRange}</text>
      {!isSimple && (
        <text x={pos.w / 2} y={54} textAnchor="middle" fontSize={9} fill={ORANGE}
          fontWeight={600} fontFamily="'DM Sans', sans-serif">Search County Records {'\u2192'}</text>
      )}
    </g>
  );
}
