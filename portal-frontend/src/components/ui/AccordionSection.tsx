import { useState } from 'react';
import { BORDER, SLATE, BG_FIELD } from '../../lib/constants';
import { Badge } from './Badge';

// Inject pulse keyframes once
const styleId = 'accordion-pulse-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = '@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }';
  document.head.appendChild(style);
}

interface AccordionSectionProps {
  title: string;
  count?: number | null;  // null = loading, undefined = no badge
  defaultOpen?: boolean;
  maxHeight?: number;  // optional scroll cap on content
  children: React.ReactNode;
}

export function AccordionSection({ title, count, defaultOpen = false, maxHeight, children }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ margin: '8px 0', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', cursor: 'pointer', userSelect: 'none',
          background: BG_FIELD, borderRadius: open ? '8px 8px 0 0' : 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-block', fontSize: 10, color: SLATE,
            transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0)',
          }}>
            &#9654;
          </span>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{title}</span>
        </div>
        {count !== undefined && (
          count === null ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: BORDER, padding: '2px 10px', borderRadius: 12, fontSize: 11, color: '#6b7280',
            }}>
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: '#3b82f6', animation: 'pulse 1.2s ease-in-out infinite',
              }} />
              Loading
            </span>
          ) : (
            <Badge
              bg={count > 0 ? '#dbeafe' : BORDER}
              color={count > 0 ? '#1e40af' : '#9ca3af'}
              shape="pill"
            >
              {count}
            </Badge>
          )
        )}
      </div>
      {open && (
        <div style={{
          padding: '0 16px 16px',
          ...(maxHeight ? { maxHeight, overflowY: 'auto' as const } : {}),
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
