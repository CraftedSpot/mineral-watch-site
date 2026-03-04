import { useState } from 'react';
import { BORDER, DARK, SLATE } from '../../lib/constants';

interface AccordionSectionProps {
  title: string;
  count?: number | null;  // null = loading, undefined = no badge
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function AccordionSection({ title, count, defaultOpen = false, children }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-block', fontSize: 10, color: SLATE,
            transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0)',
          }}>
            &#9654;
          </span>
          <span style={{ fontWeight: 600, fontSize: 13, color: DARK }}>{title}</span>
        </div>
        {count !== undefined && (
          count === null ? (
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: SLATE, animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ) : (
            <span style={{
              background: '#f1f5f9', color: SLATE, fontSize: 11, fontWeight: 600,
              padding: '2px 8px', borderRadius: 10,
            }}>
              {count}
            </span>
          )
        )}
      </div>
      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${BORDER}` }}>
          {children}
        </div>
      )}
    </div>
  );
}
