import { ORANGE, ORANGE_LIGHT, DARK, SLATE, BORDER, STACK_H } from '../../../lib/constants';
import { formatDate } from '../../../lib/helpers';
import { PinRing } from './PinRing';
import type { FlatNode, NodePosition } from '../../../types/title-chain';

interface StackCollapsedProps {
  node: FlatNode;
  pos: NodePosition;
  isHovered: boolean;
  isPinned: boolean;
  onHover: (id: string) => void;
  onLeave: () => void;
  onClick: (node: FlatNode) => void;
  onExpand: (id: string) => void;
}

export function StackCollapsed({ node, pos, isHovered, isPinned, onHover, onLeave, onClick, onExpand }: StackCollapsedProps) {
  const docs = node.docs || [];
  const primaryDoc = docs[0];
  const hl = isHovered || isPinned;
  const h = STACK_H - 8;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onExpand(node.id); }}
      style={{ cursor: 'pointer' }}
    >
      {isPinned && <PinRing x={0} y={0} w={pos.w} h={h} color={ORANGE} />}
      {/* Shadow cards */}
      <rect width={pos.w} height={h} rx={8} fill="#f1f5f9" stroke={BORDER} strokeWidth={1} x={6} y={6} />
      <rect width={pos.w} height={h} rx={8} fill="#f8fafc" stroke={BORDER} strokeWidth={1} x={3} y={3} />
      {/* Main card */}
      <rect width={pos.w} height={h} rx={8}
        fill={hl ? ORANGE_LIGHT : '#fff'} stroke={hl ? ORANGE : BORDER} strokeWidth={hl ? 2 : 1} />
      <rect width={4} height={h} rx={2} fill={ORANGE} />
      {/* Badge */}
      <rect x={pos.w - 40} y={-8} width={36} height={18} rx={9} fill={ORANGE} />
      <text x={pos.w - 22} y={5} textAnchor="middle" fontSize={10} fontWeight={700}
        fill="#fff" fontFamily="'DM Sans', sans-serif">{docs.length}</text>
      {/* Content */}
      <text x={14} y={18} fontSize={10} fontWeight={700} fill={ORANGE}
        fontFamily="'DM Sans', sans-serif">{primaryDoc?.docType || node.docType}</text>
      <foreignObject x={10} y={22} width={pos.w - 20} height={46}>
        <div style={{
          fontSize: 10, fontFamily: "'DM Sans', sans-serif",
          lineHeight: '14px', overflow: 'hidden',
        }}>
          <div style={{ color: DARK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {primaryDoc?.grantor || node.grantor}
          </div>
          <div style={{ color: SLATE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {'\u2192'} {primaryDoc?.grantee || node.grantee}
          </div>
          {(primaryDoc?.interestConveyed || node.interestConveyed) && (
            <div style={{ color: SLATE, fontSize: 9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {primaryDoc?.interestConveyed || node.interestConveyed}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
}
