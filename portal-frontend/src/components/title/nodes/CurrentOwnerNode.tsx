import { GREEN, DARK, SLATE, ORANGE, CURRENT_H, CURRENT_H_SIMPLE } from '../../../lib/constants';
import type { ViewMode } from '../../../lib/layout-engine';
import type { TitleColors } from '../../../lib/title-colors';
import { formatDecimal } from '../../../lib/helpers';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface CurrentOwnerNodeProps {
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

export function CurrentOwnerNode({ node, pos, isHovered, isPinned, isDimmed, viewMode = 'detailed', colors: c, onHover, onLeave, onClick }: CurrentOwnerNodeProps) {
  const hl = isHovered || isPinned;
  const isSimple = viewMode === 'simple';
  const h = isSimple ? CURRENT_H_SIMPLE : CURRENT_H;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(node); }}
      style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
      opacity={isDimmed ? 0.5 : 1}
      filter={isHovered ? 'url(#glow-green)' : undefined}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={h} color={GREEN} />}
      <rect width={pos.w} height={h} rx={isSimple ? 6 : 8}
        fill={hl ? (c?.ownerBgHover || '#f0fdf4') : (c?.ownerBg || '#f8fffe')} stroke={GREEN} strokeWidth={2} />
      <circle cx={16} cy={isSimple ? 16 : 18} r={isSimple ? 4 : 5} fill={GREEN} />
      <foreignObject x={26} y={isSimple ? 6 : 8} width={pos.w - 36} height={isSimple ? 20 : 24}>
        <div style={{
          fontSize: isSimple ? 10 : 11, fontWeight: 700, color: c?.text || DARK,
          fontFamily: "'DM Sans', sans-serif",
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: isSimple ? '18px' : '22px',
        }}>
          {node.owner}
        </div>
      </foreignObject>
      {isSimple ? (
        <text x={16} y={40} fontSize={9} fontWeight={600} fill={c?.text || DARK}
          fontFamily="'JetBrains Mono', monospace">
          {formatDecimal(node.interestDecimal)}
        </text>
      ) : (
        <>
          <foreignObject x={12} y={30} width={pos.w - 24} height={16}>
            <div style={{
              fontSize: 10, color: c?.textMuted || SLATE, fontFamily: "'DM Sans', sans-serif",
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {node.interest || ''}
            </div>
          </foreignObject>
          <g>
            <rect x={10} y={50} width={pos.w - 20} height={18} rx={4} fill={c?.ownerBgHover || '#f0fdf4'} />
            <text x={16} y={63} fontSize={9} fontWeight={600} fill={c?.text || DARK}
              fontFamily="'JetBrains Mono', monospace">
              {formatDecimal(node.interestDecimal)}
            </text>
            <text x={pos.w - 16} y={63} textAnchor="end" fontSize={9} fontWeight={700}
              fill={ORANGE} fontFamily="'DM Sans', sans-serif">
              {node.interestType || ''}
            </text>
          </g>
          {node.acquiredDate && (
            <text x={16} y={82} fontSize={8} fill={c?.textMuted || SLATE}
              fontFamily="'DM Sans', sans-serif">Acquired {node.acquiredDate}</text>
          )}
        </>
      )}
    </g>
  );
}
