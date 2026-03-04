import { BORDER } from '../../lib/constants';

interface LoadingSkeletonProps {
  columns: number;
  rows?: number;
}

export function LoadingSkeleton({ columns, rows = 8 }: LoadingSkeletonProps) {
  return (
    <div style={{ borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 12,
        padding: '12px 16px',
        background: '#f8fafc',
        borderBottom: `1px solid ${BORDER}`,
      }}>
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} style={{
            height: 12, borderRadius: 4, background: '#e2e8f0',
            width: `${60 + Math.random() * 30}%`,
            animation: 'shimmer 1.5s ease-in-out infinite',
          }} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 12,
          padding: '14px 16px',
          borderBottom: row < rows - 1 ? `1px solid ${BORDER}` : 'none',
        }}>
          {Array.from({ length: columns }).map((_, col) => (
            <div key={col} style={{
              height: 10, borderRadius: 4, background: '#f1f5f9',
              width: `${40 + Math.random() * 50}%`,
              animation: 'shimmer 1.5s ease-in-out infinite',
              animationDelay: `${(row * columns + col) * 0.05}s`,
            }} />
          ))}
        </div>
      ))}
      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
