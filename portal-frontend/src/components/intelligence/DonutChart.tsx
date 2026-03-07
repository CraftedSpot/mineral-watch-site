interface Segment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: Segment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string | number;
}

export function DonutChart({
  segments,
  size = 160,
  strokeWidth = 24,
  centerLabel,
  centerValue,
}: DonutChartProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    return (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
        No data
      </div>
    );
  }

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let offset = 0;
  const arcs = segments.filter(s => s.value > 0).map((seg) => {
    const pct = seg.value / total;
    const dashLength = pct * circumference;
    const dashOffset = -offset * circumference;
    offset += pct;
    return { ...seg, dashLength, dashOffset, pct };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth} />
        {/* Segments */}
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc.dashLength} ${circumference - arc.dashLength}`}
            strokeDashoffset={arc.dashOffset}
            transform={`rotate(-90 ${center} ${center})`}
            style={{ transition: 'stroke-dasharray 0.3s' }}
          />
        ))}
        {/* Center text */}
        {centerValue != null && (
          <>
            <text x={center} y={center - 4} textAnchor="middle" style={{ fontSize: 22, fontWeight: 700, fill: '#374151' }}>
              {centerValue}
            </text>
            {centerLabel && (
              <text x={center} y={center + 14} textAnchor="middle" style={{ fontSize: 11, fill: '#94a3b8' }}>
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {arcs.map((arc, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: arc.color, flexShrink: 0 }} />
            <span style={{ color: '#374151' }}>{arc.label}</span>
            <span style={{ color: '#94a3b8', marginLeft: 'auto' }}>
              {arc.value} ({Math.round(arc.pct * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
