import { BORDER, BG_MUTED, DARK } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';

interface ModalShellProps {
  children: React.ReactNode;
  onClose: () => void;
  /** Header title text */
  title?: string;
  /** Header subtitle (smaller text below title) */
  subtitle?: string;
  /** Header background — solid color or gradient string */
  headerBg?: string;
  /** Header text color (default #fff for colored headers, DARK for plain) */
  headerColor?: string;
  /** Max width of the modal card (default 700) */
  maxWidth?: number | string;
  /** Body background (default BG_MUTED) */
  bodyBg?: string;
  /** Body padding (default '20px 24px') */
  bodyPadding?: string;
  /** Footer content — renders in a flex row with border-top */
  footer?: React.ReactNode;
  /** Custom header content (replaces default title/subtitle) */
  headerContent?: React.ReactNode;
  /** Whether to show the header at all (default true) */
  showHeader?: boolean;
  /** Custom close button style override */
  closeStyle?: React.CSSProperties;
}

const defaultCloseWhite: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16,
  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6, width: 32, height: 32, cursor: 'pointer',
  fontSize: 20, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10,
};

const defaultCloseGray: React.CSSProperties = {
  position: 'absolute', top: 12, right: 12,
  background: '#f3f4f6', border: `1px solid ${BORDER}`,
  borderRadius: 6, width: 32, height: 32, cursor: 'pointer',
  fontSize: 20, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10,
};

export function ModalShell({
  children,
  onClose,
  title,
  subtitle,
  headerBg,
  headerColor,
  maxWidth = 700,
  bodyBg = BG_MUTED,
  bodyPadding = '20px 24px',
  footer,
  headerContent,
  showHeader = true,
  closeStyle: closeStyleOverride,
}: ModalShellProps) {
  const isMobile = useIsMobile();
  const hasColoredHeader = !!headerBg;
  const resolvedHeaderColor = headerColor || (hasColoredHeader ? '#fff' : DARK);
  const resolvedCloseStyle = closeStyleOverride || (hasColoredHeader ? defaultCloseWhite : defaultCloseGray);

  const radius = isMobile ? 12 : 16;
  const resolvedBodyPadding = bodyPadding || (isMobile ? '16px 16px' : '20px 24px');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || undefined}
      style={{
        background: '#fff', borderRadius: radius,
        width: isMobile ? '100%' : maxWidth, maxWidth: '100%',
        maxHeight: isMobile ? 'calc(100vh - 48px)' : 'calc(100vh - 20px)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 30px rgba(0,0,0,0.15)', fontFamily: "'Inter', 'DM Sans', sans-serif",
        overflow: 'hidden', position: 'relative',
      }}
    >
      {/* Close button — always present */}
      <button onClick={onClose} style={resolvedCloseStyle} aria-label="Close">&times;</button>

      {/* Header */}
      {showHeader && (headerContent || title) && (
        <div style={{
          background: headerBg || 'transparent',
          color: resolvedHeaderColor,
          padding: isMobile ? '16px 16px' : '20px 24px',
          position: 'relative',
          flexShrink: 0,
        }}>
          {headerContent || (
            <>
              {title && (
                <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 700, fontFamily: "'Merriweather', serif" }}>
                  {title}
                </h2>
              )}
              {subtitle && (
                <div style={{ fontSize: isMobile ? 13 : 15, opacity: 0.9, marginTop: 2 }}>{subtitle}</div>
              )}
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{
        padding: resolvedBodyPadding, flex: 1, overflowY: 'auto', minHeight: 0,
        WebkitOverflowScrolling: 'touch', background: bodyBg, overflowX: 'hidden',
      }}>
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div style={{
          padding: isMobile ? '14px 16px' : '14px 24px', borderTop: `1px solid ${BORDER}`,
          display: 'flex', gap: 10, flexShrink: 0, background: '#fff',
          borderRadius: `0 0 ${radius}px ${radius}px`, alignItems: 'center',
        }}>
          {footer}
        </div>
      )}
    </div>
  );
}
