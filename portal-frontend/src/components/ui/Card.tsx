import { BORDER } from '../../lib/constants';

interface CardProps {
  children: React.ReactNode;
  padding?: number | string;
  bg?: string;
  style?: React.CSSProperties;
}

export function Card({ children, padding = 16, bg = '#fff', style }: CardProps) {
  return (
    <div style={{
      background: bg, border: `1px solid ${BORDER}`, borderRadius: 8, padding,
      ...style,
    }}>
      {children}
    </div>
  );
}
