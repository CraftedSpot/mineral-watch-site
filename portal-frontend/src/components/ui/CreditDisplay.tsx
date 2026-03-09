import { Link } from 'react-router-dom';
import { useModal } from '../../contexts/ModalContext';
import { BORDER, ORANGE, MODAL_TYPES, TEXT_MUTED, TEXT_DARK, TEXT_FAINT } from '../../lib/constants';
import { Card } from './Card';
import type { UsageResponse } from '../../api/documents';

interface CreditDisplayProps {
  usage: UsageResponse | null;
  /** Compact inline mode (no card wrapper) */
  compact?: boolean;
}

function formatResetDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
}

function barClass(remaining: number, total: number): 'normal' | 'warning' | 'danger' {
  if (remaining === 0) return 'danger';
  if (total > 0 && remaining / total <= 0.2) return 'warning';
  return 'normal';
}

const BAR_COLORS = {
  normal: 'linear-gradient(90deg, #059669 0%, #10B981 100%)',
  warning: 'linear-gradient(90deg, #F59E0B 0%, #FBBF24 100%)',
  danger: 'linear-gradient(90deg, #DC2626 0%, #EF4444 100%)',
};

const ROLLING_COLORS = {
  normal: 'linear-gradient(90deg, #7C3AED 0%, #A855F7 100%)',
  warning: BAR_COLORS.warning,
  danger: BAR_COLORS.danger,
};

export function CreditDisplay({ usage, compact }: CreditDisplayProps) {
  const modal = useModal();
  if (!usage) return null;
  const { usage: u } = usage;

  const monthlyPct = u.monthly_limit > 0
    ? Math.min(100, Math.round((u.monthly_remaining / u.monthly_limit) * 100))
    : 0;
  const monthlyState = barClass(u.monthly_remaining, u.monthly_limit);

  const rollingCredits = (u.purchased_credits || 0) + (u.permanent_credits || 0);
  const rollingBaseline = Math.max(
    (u.total_credits_purchased || 0) + (u.permanent_credits || 0),
    rollingCredits,
  );
  const rollingPct = rollingBaseline > 0
    ? Math.min(100, Math.round((rollingCredits / rollingBaseline) * 100))
    : 0;
  const rollingState = barClass(rollingCredits, rollingBaseline);

  const content = (
    <>
      {/* Heading row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
        <span style={{ fontWeight: 400, color: TEXT_DARK }}>Credits:</span>
        <span style={{ fontWeight: 700, color: u.total_available > 0 ? '#059669' : '#DC2626', fontSize: 16 }}>
          {u.total_available.toLocaleString()}
        </span>
        <span style={{ color: TEXT_MUTED }}>available</span>
        <Link to="/portal/account" style={{
          color: '#3b82f6', fontSize: 12, textDecoration: 'none', fontWeight: 400, marginLeft: 4,
        }}>
          View details
        </Link>
        <span style={{ color: '#D1D5DB' }}>&middot;</span>
        <button
          onClick={() => modal.open(MODAL_TYPES.CREDIT_PACK)}
          style={{
            background: 'none', border: 'none', padding: 0,
            color: ORANGE, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', font: 'inherit',
          }}
        >
          Buy More
        </button>
      </div>

      {/* Credit rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
        {/* Monthly row */}
        <div style={rowStyle}>
          <span style={rowLabelStyle}>Monthly</span>
          <div style={barTrackStyle}>
            <div style={{ ...barFillBase, width: `${monthlyPct}%`, background: BAR_COLORS[monthlyState] }} />
          </div>
          <span style={rowCountStyle}>
            <strong>{u.monthly_remaining}</strong> remaining
            <span style={rowStatusInline}>
              {u.is_lifetime_tier ? 'Lifetime' : `Resets ${formatResetDate(u.reset_date)}`}
            </span>
          </span>
        </div>

        {/* Rolling row (only if user has rolling credits) */}
        {rollingCredits > 0 && (
          <div style={rowStyle}>
            <span style={rowLabelStyle}>Rolling</span>
            <div style={{ ...barTrackStyle, background: '#EDE9FE' }}>
              <div style={{ ...barFillBase, width: `${rollingPct}%`, background: ROLLING_COLORS[rollingState] }} />
            </div>
            <span style={rowCountStyle}>
              <strong>{rollingCredits.toLocaleString()}</strong> remaining
              <span style={rowStatusInline}>Never expire</span>
            </span>
          </div>
        )}
      </div>
    </>
  );

  if (compact) return <div>{content}</div>;

  return (
    <Card padding="12px 16px" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
      {content}
    </Card>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '55px 100px auto',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};

const rowLabelStyle: React.CSSProperties = {
  color: TEXT_MUTED,
  fontWeight: 400,
};

const barTrackStyle: React.CSSProperties = {
  height: 6,
  background: '#E5E7EB',
  borderRadius: 3,
  overflow: 'hidden',
};

const barFillBase: React.CSSProperties = {
  height: '100%',
  borderRadius: 3,
  transition: 'width 0.3s ease',
};

const rowCountStyle: React.CSSProperties = {
  color: TEXT_DARK,
  whiteSpace: 'nowrap',
};

const rowStatusInline: React.CSSProperties = {
  color: TEXT_FAINT,
  fontSize: 11,
  marginLeft: 6,
};
