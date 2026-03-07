import { useEffect, useState } from 'react';
import { useDashboardCounts } from '../../hooks/useDashboardCounts';
import { apiFetch } from '../../api/client';
import { BORDER, OIL_NAVY, SLATE_BLUE, ORANGE, PLAN_LIMITS } from '../../lib/constants';
import { Badge } from '../ui/Badge';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { AuthUser } from '../layout/AppShell';

interface Props {
  activeTab: string;
  user: AuthUser;
}

interface ActivityStats {
  lastAlert: string | null;
  thisMonth: number;
  thisYear: number;
}

function formatLastAlert(iso: string | null): string {
  if (!iso) return 'No alerts yet';
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
}

export function DashboardHeader({ activeTab, user }: Props) {
  const { data: counts } = useDashboardCounts();
  const [activityStats, setActivityStats] = useState<ActivityStats | null>(null);
  const isMobile = useIsMobile();

  const limits = PLAN_LIMITS[user.plan] || { properties: 1, wells: 1 };
  const propertyCount = counts?.properties ?? 0;

  useEffect(() => {
    apiFetch<ActivityStats>('/api/activity/stats')
      .then(setActivityStats)
      .catch(() => {});
  }, []);

  return (
    <div style={{ padding: isMobile ? '16px 16px 0' : '24px 24px 0', maxWidth: 1400, margin: '0 auto' }}>
      {/* Title row */}
      <div style={{ marginBottom: isMobile ? 12 : 16 }}>
        <h1 style={{
          margin: 0, fontSize: isMobile ? 22 : 28, fontWeight: 700, color: OIL_NAVY, lineHeight: 1.2,
          fontFamily: "'Merriweather', serif",
        }}>
          My Monitoring
        </h1>
      </div>

      {/* Plan info card */}
      <div style={{
        background: '#fff', borderRadius: 8,
        padding: isMobile ? '10px 14px' : '14px 20px', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16, flexWrap: 'wrap',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <Badge bg="#DEF7EC" color="#03543F" shape="pill" size="lg"
          style={{ textTransform: 'uppercase', fontWeight: 700, padding: '4px 12px', borderRadius: 20 }}>
          {user.plan || 'Free'}
        </Badge>

        <div style={{
          display: 'flex', gap: isMobile ? 12 : 20, alignItems: 'center',
          fontSize: isMobile ? 13 : 14, color: SLATE_BLUE, flexWrap: 'wrap',
        }}>
          <UsageStat count={propertyCount} limit={limits.properties} label="Properties" />
          {!isMobile && <span style={{ color: SLATE_BLUE }}>|</span>}
          <UsageStat count={counts?.wells ?? 0} limit={limits.wells} label="Wells" />
          {counts?.documents != null && (
            <>
              {!isMobile && <span style={{ color: SLATE_BLUE }}>|</span>}
              <span>
                <span style={{ fontWeight: 700, color: OIL_NAVY }}>{counts.documents}</span> Documents
              </span>
            </>
          )}
        </div>

        {!['Business', 'Enterprise 1K'].includes(user.plan) && (
          <a href="/portal/upgrade" style={{
            marginLeft: isMobile ? 0 : 'auto', color: ORANGE, textDecoration: 'none',
            fontSize: 14, fontWeight: 600,
          }}>
            Upgrade &rarr;
          </a>
        )}
      </div>

      {/* Thin stats bar */}
      <div style={{
        background: '#fff', borderRadius: 8,
        padding: isMobile ? '8px 14px' : '8px 24px', marginBottom: isMobile ? 12 : 20,
        display: 'flex', alignItems: 'center',
        justifyContent: isMobile ? 'flex-start' : 'center',
        gap: isMobile ? 16 : 32,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        height: isMobile ? 'auto' : 40,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={statLabelStyle}>Last Alert</span>
          <span style={statValueStyle}>{activityStats ? formatLastAlert(activityStats.lastAlert) : '\u2014'}</span>
        </div>
        {!isMobile && <div style={{ width: 1, height: 20, background: BORDER }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={statLabelStyle}>This Month</span>
          <span style={statValueStyle}>{activityStats?.thisMonth ?? '\u2014'}</span>
        </div>
        {!isMobile && <div style={{ width: 1, height: 20, background: BORDER }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={statLabelStyle}>This Year</span>
          <span style={statValueStyle}>{activityStats?.thisYear ?? '\u2014'}</span>
        </div>
      </div>
    </div>
  );
}

function UsageStat({ count, limit, label }: { count: number; limit: number; label: string }) {
  return (
    <span>
      <span style={{ fontWeight: 700, color: OIL_NAVY }}>{count}</span>
      <span style={{ color: SLATE_BLUE }}> / {limit === Infinity ? '\u221E' : limit}</span>
      {' '}{label}
    </span>
  );
}

const statLabelStyle: React.CSSProperties = {
  fontSize: 11, color: SLATE_BLUE, textTransform: 'uppercase', letterSpacing: '0.5px',
};

const statValueStyle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: ORANGE, fontFamily: "'Merriweather', serif",
};
