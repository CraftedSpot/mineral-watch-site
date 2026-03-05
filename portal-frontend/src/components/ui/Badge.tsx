interface BadgeProps {
  children: React.ReactNode;
  bg?: string;
  color?: string;
  /** 'pill' = borderRadius 12 (counts, groups), 'tag' = borderRadius 4 (status, labels) */
  shape?: 'pill' | 'tag';
  /** 'sm' = 2px 6px / 10px, 'md' = 2px 8px / 12px, 'lg' = 4px 10px / 12px */
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
}

const SIZE_MAP: Record<string, { padding: string; fontSize: number }> = {
  sm: { padding: '2px 6px', fontSize: 10 },
  md: { padding: '2px 8px', fontSize: 12 },
  lg: { padding: '4px 10px', fontSize: 12 },
};

export function Badge({
  children,
  bg = '#DEF7EC',
  color = '#03543F',
  shape = 'tag',
  size = 'md',
  style,
}: BadgeProps) {
  const sizeStyle = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <span style={{
      display: 'inline-block',
      padding: sizeStyle.padding,
      fontSize: sizeStyle.fontSize,
      fontWeight: 600,
      borderRadius: shape === 'pill' ? 12 : 4,
      background: bg,
      color,
      ...style,
    }}>
      {children}
    </span>
  );
}
