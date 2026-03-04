import { ORANGE, ORANGE_LIGHT, DARK, SLATE, BORDER, NODE_H } from '../../../lib/constants';
import { formatDate } from '../../../lib/helpers';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface DocNodeProps {
  node: FlatNode;
  pos: NodePosition;
  isHovered: boolean;
  isPinned: boolean;
  onHover: (id: string) => void;
  onLeave: () => void;
  onClick: (node: FlatNode) => void;
}

export function DocNode({ node, pos, isHovered, isPinned, onHover, onLeave, onClick }: DocNodeProps) {
  const hl = isHovered || isPinned;
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick(node); }}
      style={{ cursor: 'pointer' }}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={NODE_H} color={ORANGE} />}
      <rect width={pos.w} height={NODE_H} rx={8}
        fill={hl ? ORANGE_LIGHT : '#fff'} stroke={hl ? ORANGE : BORDER} strokeWidth={hl ? 2 : 1} />
      <rect width={4} height={NODE_H} rx={2} fill={ORANGE} />
      <text x={14} y={18} fontSize={10} fontWeight={700} fill={ORANGE}
        fontFamily="'DM Sans', sans-serif">{node.docType}</text>
      <text x={pos.w - 10} y={18} textAnchor="end" fontSize={9} fill={SLATE}
        fontFamily="'DM Sans', sans-serif">{formatDate(node.date)}</text>
      <foreignObject x={10} y={22} width={pos.w - 20} height={50}>
        <div style={{
          fontSize: 10, fontFamily: "'DM Sans', sans-serif",
          lineHeight: '14px', overflow: 'hidden',
        }}>
          <div style={{ color: DARK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {node.grantor}
          </div>
          <div style={{ color: SLATE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {'\u2192'} {node.grantee}
          </div>
          {node.interestConveyed && (
            <div style={{ color: SLATE, fontSize: 9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {node.interestConveyed}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
}
