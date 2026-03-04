import { ORANGE, BORDER, SLATE } from '../../lib/constants';

interface TabBarProps {
  tabs: readonly string[];
  active: string;
  onChange: (tab: string) => void;
}

const TAB_LABELS: Record<string, string> = {
  properties: 'Properties',
  wells: 'Wells',
  documents: 'Documents',
  activity: 'Activity',
  tools: 'Tools',
};

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div style={{
      borderBottom: `1px solid ${BORDER}`, background: '#fff',
      padding: '0 24px',
      fontFamily: "'Inter', 'DM Sans', sans-serif",
    }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto',
        display: 'flex', gap: 0,
      }}>
        {tabs.map((tab) => {
          const isActive = tab === active;
          return (
            <button
              key={tab}
              onClick={() => onChange(tab)}
              style={{
                padding: '12px 20px',
                fontSize: 13, fontWeight: isActive ? 700 : 500,
                color: isActive ? ORANGE : SLATE,
                background: 'none', border: 'none',
                borderBottom: isActive ? `2px solid ${ORANGE}` : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: "'Inter', 'DM Sans', sans-serif",
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {TAB_LABELS[tab] || tab}
            </button>
          );
        })}
      </div>
    </div>
  );
}
