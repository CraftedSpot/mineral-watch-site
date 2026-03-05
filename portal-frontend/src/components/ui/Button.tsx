import { OIL_NAVY, DARK, BORDER, SLATE, ERROR_RED, INFO_BLUE } from '../../lib/constants';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'link';
  size?: 'sm' | 'md';
  /** Override the default primary color */
  color?: string;
  /** Render as full-width */
  block?: boolean;
  icon?: React.ReactNode;
}

const VARIANT_STYLES: Record<string, (color: string) => React.CSSProperties> = {
  primary: (c) => ({ background: c, color: '#fff', border: 'none' }),
  secondary: (c) => ({ background: '#fff', color: c, border: `1px solid ${BORDER}` }),
  destructive: () => ({ background: ERROR_RED, color: '#fff', border: 'none' }),
  ghost: (c) => ({ background: 'transparent', color: c, border: `1px solid ${BORDER}` }),
  link: () => ({ background: 'none', color: INFO_BLUE, border: 'none', padding: 0 }),
};

const SIZE_STYLES: Record<string, React.CSSProperties> = {
  md: { padding: '10px 16px', fontSize: 13 },
  sm: { padding: '6px 12px', fontSize: 12 },
};

export function Button({
  variant = 'primary',
  size = 'md',
  color,
  block,
  icon,
  children,
  style,
  ...rest
}: ButtonProps) {
  const resolvedColor = color || (variant === 'secondary' ? DARK : variant === 'ghost' ? SLATE : OIL_NAVY);
  const variantStyle = (VARIANT_STYLES[variant] || VARIANT_STYLES.primary)(resolvedColor);
  const sizeStyle = SIZE_STYLES[size] || SIZE_STYLES.md;

  return (
    <button
      {...rest}
      style={{
        borderRadius: 6, fontWeight: 600, cursor: 'pointer',
        fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', gap: 6, textAlign: 'center',
        ...(variant === 'link' ? {} : sizeStyle),
        ...variantStyle,
        ...(block ? { width: '100%' } : {}),
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}
