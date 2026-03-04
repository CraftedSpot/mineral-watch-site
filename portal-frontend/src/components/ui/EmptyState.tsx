import { SLATE } from '../../lib/constants';

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title = 'No data', description, action }: EmptyStateProps) {
  return (
    <div style={{
      padding: '60px 24px',
      textAlign: 'center',
      fontFamily: "'Inter', 'DM Sans', sans-serif",
    }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.6 }}>{'\uD83D\uDCC2'}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2332', marginBottom: 4 }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 13, color: SLATE, maxWidth: 400, margin: '0 auto 16px' }}>
          {description}
        </div>
      )}
      {action}
    </div>
  );
}
