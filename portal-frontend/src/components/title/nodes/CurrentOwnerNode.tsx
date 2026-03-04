import { GREEN, DARK, SLATE, ORANGE, CURRENT_H } from '../../../lib/constants';
import { formatDecimal } from '../../../lib/helpers';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface CurrentOwnerNodeProps {
  node: FlatNode;
  pos: NodePosition;
  isHovered: boolean;
  isPinned: boolean;
  onHover: (id: string) => void;
  onLeave: () => void;
  onClick: (node: FlatNode) => void;
}

export function CurrentOwnerNode({ node, pos, isHovered, isPinned, onHover, onLeave, onClick }: CurrentOwnerNodeProps) {
  const hl = isHovered || isPinned;
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(node); }}
      style={{ cursor: 'pointer' }}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={CURRENT_H} color={GREEN} />}
      <rect width={pos.w} height={CURRENT_H} rx={8}
        fill={hl ? '#f0fdf4' : '#f8fffe'} stroke={GREEN} strokeWidth={2} />
      <circle cx={16} cy={18} r={5} fill={GREEN} />
      <foreignObject x={26} y={8} width={pos.w - 36} height={24}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: DARK,
          fontFamily: "'DM Sans', sans-serif",
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: '22px',
        }}>
          {node.owner}
        </div>
      </foreignObject>
      <foreignObject x={12} y={30} width={pos.w - 24} height={16}>
        <div style={{
          fontSize: 10, color: SLATE, fontFamily: "'DM Sans', sans-serif",
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {node.interest || ''}
        </div>
      </foreignObject>
      <g>
        <rect x={10} y={50} width={pos.w - 20} height={18} rx={4} fill="#f0fdf4" />
        <text x={16} y={63} fontSize={9} fontWeight={600} fill={DARK}
          fontFamily="'JetBrains Mono', monospace">
          {formatDecimal(node.interestDecimal)}
        </text>
        <text x={pos.w - 16} y={63} textAnchor="end" fontSize={9} fontWeight={700}
          fill={ORANGE} fontFamily="'DM Sans', sans-serif">
          {node.interestType || ''}
        </text>
      </g>
      {node.acquiredDate && (
        <text x={16} y={82} fontSize={8} fill={SLATE}
          fontFamily="'DM Sans', sans-serif">Acquired {node.acquiredDate}</text>
      )}
    </g>
  );
}
