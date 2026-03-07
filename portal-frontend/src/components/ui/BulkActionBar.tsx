import { ORANGE, BORDER } from '../../lib/constants';
import { Button } from './Button';
import { useIsMobile } from '../../hooks/useIsMobile';

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}

export function BulkActionBar({ count, onClear, children }: BulkActionBarProps) {
  const isMobile = useIsMobile();

  return (
    <div style={{
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center',
      gap: isMobile ? 8 : 12,
      padding: isMobile ? '10px 12px' : '8px 16px',
      marginBottom: 8,
      background: '#FEF3EC', border: `1px solid ${ORANGE}`,
      borderRadius: 8,
      fontFamily: "'Inter', 'DM Sans', sans-serif",
      fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, color: ORANGE }}>
          {count} selected
        </span>
        <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
      </div>
      <div style={{ marginLeft: isMobile ? 0 : 'auto', display: 'flex', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
