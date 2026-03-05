import { useModal } from '../../contexts/ModalContext';
import { MODAL_TYPES, OIL_NAVY, BORDER, TEXT_MUTED, TEXT_FAINT } from '../../lib/constants';
import { ModalShell } from '../ui/ModalShell';
import { Button } from '../ui/Button';

interface Props {
  onClose: () => void;
  modalId: string;
  isLifetimeTier?: boolean;
  resetDate?: string;
}

function formatResetDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
}

export function OutOfCreditsModal({ onClose, isLifetimeTier, resetDate }: Props) {
  const modal = useModal();

  const message = isLifetimeTier
    ? "You've used all your free trial credits. Upgrade to a paid plan to continue processing documents."
    : "You've used all your available credits this month. Purchase a credit pack or wait for your monthly reset.";

  return (
    <ModalShell onClose={onClose} showHeader={false} maxWidth={450} bodyBg="#fff" bodyPadding="32px 28px 28px">
      {/* Warning icon */}
      <div style={{
        width: 64, height: 64, background: '#FEE2E2', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px',
      }}>
        <svg width={32} height={32} fill="none" stroke="#DC2626" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>

      {/* Title */}
      <h2 style={{
        margin: '0 0 8px', fontFamily: "'Merriweather', serif",
        fontSize: 20, color: OIL_NAVY, textAlign: 'center',
      }}>
        You&rsquo;re Out of Credits
      </h2>

      {/* Message */}
      <p style={{ margin: '0 0 24px', color: TEXT_MUTED, fontSize: 14, lineHeight: 1.5, textAlign: 'center' }}>
        {message}
      </p>

      {/* Actions */}
      <div style={{
        background: '#F9FAFB', borderRadius: 8, padding: 16, marginBottom: 24, textAlign: 'left',
      }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: OIL_NAVY }}>
          Get More Credits
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Buy Credit Pack */}
          <button
            type="button"
            onClick={() => modal.open(MODAL_TYPES.CREDIT_PACK)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', background: '#fff',
              border: `1px solid ${BORDER}`, borderRadius: 6,
              color: OIL_NAVY, cursor: 'pointer', width: '100%',
              font: 'inherit', textAlign: 'left',
            }}
          >
            <svg width={20} height={20} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div style={{ fontWeight: 500 }}>Buy Credit Pack</div>
              <div style={{ fontSize: 12, color: TEXT_MUTED }}>One-time purchase, never expires</div>
            </div>
          </button>

          {/* Upgrade Plan */}
          <a
            href="/portal/account"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', background: '#fff',
              border: `1px solid ${BORDER}`, borderRadius: 6,
              textDecoration: 'none', color: OIL_NAVY,
            }}
          >
            <svg width={20} height={20} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            <div>
              <div style={{ fontWeight: 500 }}>Upgrade Plan</div>
              <div style={{ fontSize: 12, color: TEXT_MUTED }}>More monthly credits + bonus</div>
            </div>
          </a>
        </div>
      </div>

      {/* Close */}
      <div style={{ textAlign: 'center' }}>
        <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
      </div>

      {/* Reset date info */}
      {!isLifetimeTier && resetDate && (
        <p style={{ margin: '16px 0 0', fontSize: 12, color: TEXT_FAINT, textAlign: 'center' }}>
          Credits reset on {formatResetDate(resetDate)}
        </p>
      )}
    </ModalShell>
  );
}
