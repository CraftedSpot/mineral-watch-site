import { SUCCESS_GREEN, ERROR_RED, WARNING_AMBER, INFO_BLUE } from '../../lib/constants';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onDismiss: () => void;
}

const COLORS: Record<ToastType, string> = {
  success: SUCCESS_GREEN,
  error: ERROR_RED,
  warning: WARNING_AMBER,
  info: INFO_BLUE,
};

const ICONS: Record<ToastType, string> = {
  success: '\u2713',
  error: '\u2715',
  warning: '!',
  info: 'i',
};

export function Toast({ message, type, onDismiss }: ToastProps) {
  const color = COLORS[type];

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 1100000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 20px',
        borderRadius: 8,
        background: '#fff',
        border: `1px solid ${color}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        fontFamily: "'Inter', 'DM Sans', sans-serif",
        fontSize: 13,
        fontWeight: 400,
        color: '#1a2332',
        maxWidth: 400,
        animation: 'toastSlideIn 0.25s ease-out',
      }}
    >
      <span style={{
        width: 22, height: 22, borderRadius: '50%', background: color,
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>
        {ICONS[type]}
      </span>
      {message}
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
