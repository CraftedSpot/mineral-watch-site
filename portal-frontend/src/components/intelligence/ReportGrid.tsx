import { BORDER, TEXT_DARK, SLATE, OIL_NAVY } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { IntelligenceTier, ReportType } from '../../types/intelligence';

interface ReportGridProps {
  tier: IntelligenceTier;
  onOpenReport: (type: ReportType, initialTab?: string) => void;
}

interface CardDef {
  type: ReportType;
  title: string;
  description: string;
  requiredTier: 'portfolio' | 'full';
  iconBg?: string;
  iconStroke?: string;
  icon: React.ReactNode;
  initialTab?: string;
}

const REPORT_CARDS: CardDef[] = [
  {
    type: 'deduction',
    title: 'Residue Gas Deduction Audit',
    description: 'Identify wells with high deduction ratios and compare against county averages',
    requiredTier: 'portfolio',
    icon: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  },
  {
    type: 'production-decline',
    title: 'Production Decline Analysis',
    description: 'Track well-by-well production trends, YoY changes, and county benchmarks',
    requiredTier: 'portfolio',
    icon: <><path d="M3 3v18h18" /><path d="M7 16l4-4 4 2 5-6" /></>,
  },
  {
    type: 'pooling',
    title: 'Pooling Rate Comparison',
    description: 'See bonus rates and royalty options from OCC pooling orders near your properties',
    requiredTier: 'full',
    icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18" /></>,
  },
  {
    type: 'shut-in',
    title: 'Shut-In Detector',
    description: 'Identify idle wells and assess HBP risk, sudden stops, and operator patterns',
    requiredTier: 'portfolio',
    iconBg: '#fef2f2',
    iconStroke: '#dc2626',
    icon: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  },
  {
    type: 'occ-filing',
    title: 'OCC Filing Activity',
    description: 'All OCC filings on and near your sections — pooling, spacing, horizontal wells, and more',
    requiredTier: 'portfolio',
    iconBg: '#eff6ff',
    iconStroke: '#2563eb',
    icon: <><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></>,
  },
  {
    type: 'well-risk',
    title: 'Well Risk Profile',
    description: 'Breakeven analysis for your actively producing wells at current oil prices',
    requiredTier: 'portfolio',
    iconBg: '#fef3c7',
    iconStroke: '#d97706',
    icon: <path d="M12 9v2m0 4h.01M5.07 19h13.86c1.63 0 2.44-1.97 1.29-3.14L13.29 3.86c-.56-.56-1.47-.56-2.03 0L4.34 15.86C3.19 17.03 4 19 5.63 19z" />,
  },
];

const RESEARCH_CARDS: CardDef[] = [
  {
    type: 'operator-efficiency',
    title: 'Operator Efficiency Index',
    description: 'Compare deductions, NGL returns, and PCRR efficiency metrics across Oklahoma operators',
    requiredTier: 'full',
    initialTab: 'research',
    icon: <><path d="M3 3v18h18" /><path d="M18 9l-5 5-4-4-3 3" /></>,
  },
  {
    type: 'operator-directory',
    title: 'Operator Directory',
    description: 'Look up operator contact information, counties of operation, and well counts',
    requiredTier: 'portfolio',
    icon: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  },
];

function isLocked(tier: IntelligenceTier, requiredTier: 'portfolio' | 'full'): boolean {
  if (requiredTier === 'full' && tier === 'portfolio') return true;
  return false;
}

function ReportCard({ card, tier, onClick }: { card: CardDef; tier: IntelligenceTier; onClick: () => void }) {
  const locked = isLocked(tier, card.requiredTier);

  return (
    <div
      onClick={locked ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: 16, background: '#fff', borderRadius: 8,
        border: `1px solid ${BORDER}`, cursor: locked ? 'default' : 'pointer',
        transition: 'box-shadow 0.15s',
        opacity: locked ? 0.45 : 1,
        pointerEvents: locked ? 'none' : 'auto',
        position: 'relative',
      }}
      onMouseEnter={(e) => { if (!locked) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 8,
        background: card.iconBg || '#f0fdf4',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg viewBox="0 0 24 24" fill="none" stroke={card.iconStroke || 'currentColor'} strokeWidth="1.5"
          style={{ width: 20, height: 20 }}>
          {card.icon}
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 2px' }}>
          {card.title}
        </h3>
        <p style={{ fontSize: 12, color: SLATE, margin: 0, lineHeight: 1.4 }}>
          {card.description}
        </p>
      </div>
      {!locked && (
        <svg viewBox="0 0 24 24" fill="none" stroke={SLATE} strokeWidth="2"
          style={{ width: 16, height: 16, flexShrink: 0 }}>
          <path d="M9 5l7 7-7 7" />
        </svg>
      )}
      {locked && (
        <span style={{
          position: 'absolute', top: 12, right: 12,
          background: OIL_NAVY, color: '#fff', fontSize: 11, fontWeight: 600,
          padding: '3px 8px', borderRadius: 4, letterSpacing: 0.3,
        }}>
          Business
        </span>
      )}
    </div>
  );
}

export function ReportGrid({ tier, onOpenReport }: ReportGridProps) {
  const isMobile = useIsMobile();

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
    gap: 12,
    marginBottom: 24,
  };

  return (
    <>
      {/* Reports */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: TEXT_DARK, margin: 0 }}>Reports</h2>
          <span style={{ fontSize: 12, color: SLATE }}>Analyze your mineral portfolio</span>
        </div>
        <div style={gridStyle}>
          {REPORT_CARDS.map((card) => (
            <ReportCard
              key={card.type}
              card={card}
              tier={tier}
              onClick={() => onOpenReport(card.type, card.initialTab)}
            />
          ))}
        </div>
      </div>

      {/* Research Tools */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: TEXT_DARK, margin: 0 }}>Research Tools</h2>
          <span style={{ fontSize: 12, color: SLATE }}>Statewide operator data and benchmarking</span>
        </div>
        <div style={gridStyle}>
          {RESEARCH_CARDS.map((card) => (
            <ReportCard
              key={card.type}
              card={card}
              tier={tier}
              onClick={() => onOpenReport(card.type, card.initialTab)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
