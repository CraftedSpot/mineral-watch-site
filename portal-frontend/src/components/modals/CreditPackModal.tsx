import { useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { CREDIT_PACKS, purchaseCreditPack } from '../../lib/credit-packs';
import type { CreditPack } from '../../lib/credit-packs';
import { OIL_NAVY, BORDER, TEXT_MUTED, TEXT_FAINT } from '../../lib/constants';
import { ModalShell } from '../ui/ModalShell';
import { Badge } from '../ui/Badge';

interface Props {
  onClose: () => void;
  modalId: string;
}

export function CreditPackModal({ onClose }: Props) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);

  const handlePurchase = async (pack: CreditPack) => {
    setLoading(true);
    try {
      await purchaseCreditPack(pack.slug);
      // If we get here, redirect is about to happen — no cleanup needed
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout');
      setLoading(false);
    }
  };

  return (
    <ModalShell onClose={onClose} showHeader={false} bodyBg="#fff" bodyPadding="0">
      {/* Header */}
      <div style={{ textAlign: 'center', padding: '28px 24px 0' }}>
        <h2 style={{
          margin: '0 0 8px', fontFamily: "'Merriweather', serif",
          fontSize: 22, color: OIL_NAVY,
        }}>
          Buy Credit Pack
        </h2>
        <p style={{ margin: 0, color: TEXT_MUTED, fontSize: 14 }}>
          One-time purchase. Credits never expire.
        </p>
      </div>

      {/* Pack grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
        gap: isMobile ? 12 : 16, padding: isMobile ? '16px' : '24px',
        pointerEvents: loading ? 'none' : 'auto',
        opacity: loading ? 0.6 : 1,
        transition: 'opacity 0.2s',
      }}>
        {CREDIT_PACKS.map((pack) => (
          <PackCard key={pack.slug} pack={pack} onClick={() => handlePurchase(pack)} />
        ))}
      </div>

      {/* Footer info */}
      <div style={{
        textAlign: 'center', padding: '16px 24px 24px',
        borderTop: `1px solid ${BORDER}`,
      }}>
        <p style={{ margin: 0, fontSize: 13, color: TEXT_FAINT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <svg width={14} height={14} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Purchased credits are used after your monthly credits, before bonus credits.
        </p>
      </div>
    </ModalShell>
  );
}

function PackCard({ pack, onClick }: { pack: CreditPack; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `2px solid ${hovered ? '#3B82F6' : BORDER}`,
        borderRadius: 12, padding: 20, cursor: 'pointer',
        background: '#fff', transition: 'all 0.2s',
        boxShadow: hovered ? '0 4px 12px rgba(59,130,246,0.15)' : 'none',
      }}
    >
      {/* Name + badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: OIL_NAVY }}>
          {pack.name}
        </h3>
        {pack.badge && (
          <Badge bg={pack.badge.bg} color={pack.badge.color} shape="pill" size="sm">
            {pack.badge.label}
          </Badge>
        )}
      </div>

      {/* Credit count */}
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: OIL_NAVY }}>
          {pack.credits.toLocaleString()}
        </span>
        <span style={{ fontSize: 14, color: TEXT_MUTED }}> credits</span>
      </div>

      {/* Price */}
      <div style={{ fontSize: 20, fontWeight: 600, color: OIL_NAVY, marginBottom: 4 }}>
        ${pack.price.toLocaleString()}
      </div>

      {/* Per credit */}
      <div style={{ fontSize: 12, color: TEXT_MUTED }}>
        {pack.perCredit} per credit
      </div>
    </div>
  );
}
