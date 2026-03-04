import { ORANGE, BORDER } from '../../lib/constants';

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
      <button
        onClick={onClear}
        style={{
          background: 'none', border: `1px solid ${BORDER}`,
          borderRadius: 4, padding: '4px 10px', fontSize: 12,
          color: '#64748b', cursor: 'pointer',
        }}
      >
        Clear
      </button>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
