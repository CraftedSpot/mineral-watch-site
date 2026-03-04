import { FocusTrap } from './FocusTrap';
import { DARK, ERROR_RED, WARNING_AMBER, BORDER } from '../../lib/constants';

export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  icon?: 'trash' | 'warning' | 'info';
  destructive?: boolean;
}

interface ConfirmDialogProps {
  message: string;
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

const ICON_MAP = {
  trash: { bg: 'rgba(239,68,68,0.1)', color: ERROR_RED, char: '\uD83D\uDDD1\uFE0F' },
  warning: { bg: 'rgba(245,158,11,0.1)', color: WARNING_AMBER, char: '\u26A0\uFE0F' },
  info: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', char: '\u2139\uFE0F' },
};

export function ConfirmDialog({ message, options, onConfirm, onCancel }: ConfirmDialogProps) {
  const { title, confirmText = 'Confirm', cancelText = 'Cancel', icon, destructive } = options;
  const iconData = icon ? ICON_MAP[icon] : null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
    >
      <FocusTrap active>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: 12, padding: 24,
            maxWidth: 420, width: '90%',
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
            fontFamily: "'Inter', 'DM Sans', sans-serif",
          }}
        >
          {iconData && (
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: iconData.bg, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 22, marginBottom: 16,
            }}>
              {iconData.char}
            </div>
          )}
          {title && (
            <div style={{ fontSize: 16, fontWeight: 700, color: DARK, marginBottom: 8 }}>
              {title}
            </div>
          )}
          <div style={{ fontSize: 14, color: '#475569', lineHeight: '1.5', marginBottom: 24 }}>
            {message}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onCancel}
              style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: `1px solid ${BORDER}`, background: '#fff', color: '#64748b',
                cursor: 'pointer',
              }}
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer', color: '#fff',
                background: destructive ? ERROR_RED : '#1D6F5C',
              }}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
