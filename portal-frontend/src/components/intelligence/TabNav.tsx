import { BORDER, TEXT_DARK, SLATE } from '../../lib/constants';

interface Tab {
  key: string;
  label: string;
  badge?: number | string;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (key: string) => void;
}

export function TabNav({ tabs, activeTab, onChange }: TabNavProps) {
  return (
    <div style={{
      display: 'flex', gap: 0, borderBottom: `2px solid ${BORDER}`,
      marginBottom: 16, overflowX: 'auto',
    }}>
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              padding: '10px 16px', fontSize: 13, fontWeight: active ? 600 : 400,
              color: active ? TEXT_DARK : SLATE,
              background: 'none', border: 'none', borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
              marginBottom: -2, cursor: 'pointer', whiteSpace: 'nowrap',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            {tab.badge != null && (
              <span style={{
                background: active ? '#dbeafe' : '#f1f5f9',
                color: active ? '#1d4ed8' : SLATE,
                fontSize: 11, fontWeight: 600, padding: '1px 6px',
                borderRadius: 10,
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
