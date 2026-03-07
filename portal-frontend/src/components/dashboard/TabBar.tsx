import { BORDER, OIL_NAVY, ORANGE } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';

interface TabBarProps {
  tabs: readonly string[];
  active: string;
  onChange: (tab: string) => void;
}

const TAB_CONFIG: Record<string, { label: string; icon: string }> = {
  properties: {
    label: 'Properties',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  },
  wells: {
    label: 'Wells',
    icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
  },
  documents: {
    label: 'Documents',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  activity: {
    label: 'Activity',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  },
  tools: {
    label: 'Tools',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
};

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  const isMobile = useIsMobile();

  return (
    <div style={{
      padding: isMobile ? '0 12px' : '0 24px',
      fontFamily: "'Inter', 'DM Sans', sans-serif",
    }}>
      <div
        className={isMobile ? 'mobile-tab-bar' : undefined}
        style={{
          maxWidth: 1400, margin: '0 auto',
          display: 'flex', gap: 4, marginBottom: 0,
          ...(isMobile ? {
            overflowX: 'auto' as const,
            overflowY: 'hidden' as const,
            WebkitOverflowScrolling: 'touch' as const,
            flexWrap: 'nowrap' as const,
          } : {}),
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab === active;
          const config = TAB_CONFIG[tab];
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              style={{
                padding: isMobile ? '10px 14px' : '12px 20px',
                borderRadius: '6px 6px 0 0',
                fontSize: isMobile ? 13 : 14, fontWeight: 600,
                color: isActive ? OIL_NAVY : '#94A3B8',
                background: isActive ? '#fff' : '#f8f9fa',
                border: isActive
                  ? `1px solid ${BORDER}`
                  : '1px solid #e9ecef',
                borderBottom: isActive ? '3px solid #3B82F6' : '1px solid #e9ecef',
                cursor: 'pointer',
                fontFamily: "'Inter', 'DM Sans', sans-serif",
                display: 'flex', alignItems: 'center', gap: 8,
                opacity: isActive ? 1 : 0.9,
                flexShrink: isMobile ? 0 : undefined,
                minHeight: isMobile ? 44 : undefined,
                whiteSpace: 'nowrap',
              }}
            >
              {!isMobile && config && (
                <svg
                  width={16} height={16} viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ opacity: isActive ? 1 : 0.7, color: isActive ? ORANGE : 'currentColor' }}
                >
                  <path d={config.icon} />
                </svg>
              )}
              {config?.label || tab}
            </button>
          );
        })}
      </div>
    </div>
  );
}
