interface StatusBadgeProps {
  label: string;
  color?: string;
  background?: string;
  style?: React.CSSProperties;
}

export function StatusBadge({ label, color = '#374151', background = '#f3f4f6', style }: StatusBadgeProps) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, lineHeight: '18px',
      color, background,
      ...style,
    }}>
      {label}
    </span>
  );
}
