import { useState, useEffect, useMemo } from 'react';
import { BORDER, SLATE } from '../../lib/constants';

interface LoadingSkeletonProps {
  columns: number;
  rows?: number;
  /** Optional message shown above the skeleton after a short delay */
  label?: string;
}

const PROGRESS_STAGES = [
  { after: 3, text: 'Loading data...' },
  { after: 8, text: 'Crunching the numbers...' },
  { after: 15, text: 'Almost there — large dataset...' },
];

export function LoadingSkeleton({ columns, rows = 8, label }: LoadingSkeletonProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const progressMsg = useMemo(() => {
    for (let i = PROGRESS_STAGES.length - 1; i >= 0; i--) {
      if (elapsed >= PROGRESS_STAGES[i].after) return PROGRESS_STAGES[i].text;
    }
    return null;
  }, [elapsed]);

  // Stable widths so they don't re-randomize on every render
  const headerWidths = useMemo(
    () => Array.from({ length: columns }, () => `${60 + Math.random() * 30}%`),
    [columns],
  );
  const cellWidths = useMemo(
    () => Array.from({ length: rows * columns }, () => `${40 + Math.random() * 50}%`),
    [rows, columns],
  );

  return (
    <div>
      {/* Progress message — appears after 3s */}
      {(progressMsg || label) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 12, padding: '0 2px',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
            <circle cx="8" cy="8" r="6" fill="none" stroke="#cbd5e1" strokeWidth="2" />
            <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 13, color: SLATE }}>
            {label ? `${label} — ` : ''}{progressMsg || 'Loading...'}
          </span>
          {elapsed >= 3 && (
            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
              {elapsed}s
            </span>
          )}
        </div>
      )}

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
          {headerWidths.map((w, i) => (
            <div key={i} style={{
              height: 12, borderRadius: 4, background: '#e2e8f0',
              width: w,
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
                width: cellWidths[row * columns + col],
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
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}
