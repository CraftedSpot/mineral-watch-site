interface PinRingProps {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export function PinRing({ x, y, w, h, color }: PinRingProps) {
  return (
    <rect
      x={x - 3} y={y - 3}
      width={w + 6} height={h + 6}
      rx={10} fill="none"
      stroke={color} strokeWidth={1}
      strokeDasharray="4 3" opacity={0.5}
    />
  );
}
