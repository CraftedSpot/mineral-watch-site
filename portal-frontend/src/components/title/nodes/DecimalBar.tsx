import { DARK, SLATE } from '../../../lib/constants';
import { formatDecimal } from '../../../lib/helpers';

interface DecimalBarProps {
  x: number;
  y: number;
  w: number;
  decimal: number;
  interest?: string;
  bgColor?: string;
}

export function DecimalBar({ x, y, w, decimal, interest, bgColor }: DecimalBarProps) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={18} rx={4} fill={bgColor || '#f8f9fb'} />
      <text x={x + 6} y={y + 13} fontSize={9} fontWeight={600} fill={DARK}
        fontFamily="'JetBrains Mono', monospace">{formatDecimal(decimal)}</text>
      {interest && (
        <text x={x + w - 6} y={y + 13} textAnchor="end" fontSize={8} fill={SLATE}
          fontFamily="'DM Sans', sans-serif">{interest}</text>
      )}
    </g>
  );
}
