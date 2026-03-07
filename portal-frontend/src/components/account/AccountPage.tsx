import { BORDER, ERROR_RED, TEXT_DARK } from '../../lib/constants';
import { hasOrgFeatures } from '../../lib/plan-config';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAccountData } from '../../hooks/useAccountData';
import { ProfileCard } from './ProfileCard';
import { SubscriptionCard } from './SubscriptionCard';
import { AlertPreferencesCard } from './AlertPreferencesCard';
import { OrganizationCard } from './OrganizationCard';
import { PlanFeaturesCard } from './PlanFeaturesCard';

export function AccountPage() {
  const { user, organization, propertyCount, wellCount, loading, error, refetchOrg, refetchUser } = useAccountData();
  const isMobile = useIsMobile();

  if (loading) {
    return (
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '30px 25px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: TEXT_DARK, margin: '0 0 20px' }}>Account</h2>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 60, color: '#64748b',
        }}>
          <div style={{
            width: 24, height: 24, border: `3px solid ${BORDER}`, borderTopColor: '#C05621',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ marginLeft: 10, fontSize: 13 }}>Loading account...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '30px 25px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: TEXT_DARK, margin: '0 0 20px' }}>Account</h2>
        <div style={{
          textAlign: 'center', padding: 40, color: ERROR_RED, fontSize: 14,
        }}>
          {error || 'Unable to load account data. Please try refreshing.'}
        </div>
      </div>
    );
  }

  const plan = user.plan || 'Free';
  const showOrg = hasOrgFeatures(plan) && organization;

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: '30px 25px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: TEXT_DARK, margin: '0 0 20px' }}>Account</h2>

      {/* 2-column grid: Profile + Subscription side by side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: 20,
      }}>
        <ProfileCard user={user} />
        <SubscriptionCard user={user} propertyCount={propertyCount} wellCount={wellCount} />
      </div>

      {/* Full-width cards below */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20 }}>
        <AlertPreferencesCard user={user} onSaved={refetchUser} />

        {showOrg && (
          <OrganizationCard
            user={user}
            organization={organization}
            onMutated={refetchOrg}
          />
        )}

        <PlanFeaturesCard plan={plan} />
      </div>
    </div>
  );
}
