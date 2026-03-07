import { OIL_NAVY, SLATE_BLUE, ORANGE } from '../../lib/constants';

export function UpgradeBanner() {
  return (
    <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', padding: '60px 24px' }}>
      <div style={{
        width: 64, height: 64, background: '#EBF8FF', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px',
      }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" style={{ width: 32, height: 32 }}>
          <path d="M12 15V3m0 0l-4 4m4-4l4 4M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.878a2 2 0 0 0 1.94-1.515L22 17" />
        </svg>
      </div>
      <h2 style={{ color: OIL_NAVY, fontSize: 24, fontWeight: 700, margin: '0 0 12px' }}>
        Intelligence Reports
      </h2>
      <p style={{ color: SLATE_BLUE, fontSize: 16, lineHeight: 1.6, margin: '0 0 32px' }}>
        Upgrade to Standard or above to unlock portfolio analytics — production decline tracking,
        shut-in detection, deduction audits, well risk profiles, and more.
      </p>
      <a
        href="/pricing"
        style={{
          display: 'inline-block', background: ORANGE, color: 'white',
          padding: '14px 32px', textDecoration: 'none', borderRadius: 6,
          fontWeight: 600, fontSize: 16,
        }}
      >
        View Plans &rarr;
      </a>
    </div>
  );
}
