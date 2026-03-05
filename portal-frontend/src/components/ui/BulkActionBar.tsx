import { ORANGE, BORDER } from '../../lib/constants';
import { Button } from './Button';

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}

export function BulkActionBar({ count, onClear, children }: BulkActionBarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 16px', marginBottom: 8,
      background: '#FEF3EC', border: `1px solid ${ORANGE}`,
      borderRadius: 8,
      fontFamily: "'Inter', 'DM Sans', sans-serif",
      fontSize: 13,
    }}>
      <span style={{ fontWeight: 600, color: ORANGE }}>
        {count} selected
      </span>
      <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
