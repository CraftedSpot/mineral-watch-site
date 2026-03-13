import { GAP_COLOR } from '../../../lib/constants';
import type { NodePosition } from '../../../types/title-chain';

interface EdgeProps {
  from: string;
  to: string;
  positions: Record<string, NodePosition>;
  isGap: boolean;
  darkMode?: boolean;
}

export function Edge({ from, to, positions, isGap, darkMode }: EdgeProps) {
  const fp = positions[from], tp = positions[to];
  if (!fp || !tp) return null;
  const x1 = fp.x + fp.w / 2, y1 = fp.y;
  const x2 = tp.x + tp.w / 2, y2 = tp.y + tp.h;
  const midY = (y1 + y2) / 2;
  return (
    <path
      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
      fill="none"
      stroke={isGap ? GAP_COLOR : (darkMode ? '#94A3B8' : '#cbd5e1')}
      strokeWidth={isGap ? 2 : 1.5}
      strokeDasharray={isGap ? '6 4' : 'none'}
    />
  );
}
