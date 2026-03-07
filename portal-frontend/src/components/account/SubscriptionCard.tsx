import { useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SLATE, TEXT_DARK, ORANGE } from '../../lib/constants';
import { getPlanConfig } from '../../lib/plan-config';
import { createBillingSession } from '../../api/account';
import { useToast } from '../../contexts/ToastContext';
import type { AccountUser } from '../../types/account';

interface SubscriptionCardProps {
  user: AccountUser;
  propertyCount: number;
  wellCount: number;
}

const labelStyle: React.CSSProperties = {
  fontSize: 13, color: SLATE, fontWeight: 400,
};

const valueStyle: React.CSSProperties = {
  fontSize: 13, color: TEXT_DARK, fontWeight: 400,
};

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 0',
};

export function SubscriptionCard({ user, propertyCount, wellCount }: SubscriptionCardProps) {
  const plan = user.plan || 'Free';
  const config = getPlanConfig(plan);
  const toast = useToast();
  const [billingLoading, setBillingLoading] = useState(false);

  const isFreeNoBilling = plan === 'Free' && !user.hasBillingHistory;
  const isFreeWithBilling = plan === 'Free' && user.hasBillingHistory;
  const isPaid = plan !== 'Free';
  const isEnterprise = plan.startsWith('Enterprise');

  const handleManageBilling = async () => {
    setBillingLoading(true);
    try {
      const url = await createBillingSession();
      window.location.href = url;
    } catch {
      toast.error('Error connecting to billing.');
      setBillingLoading(false);
    }
  };

  return (
    <Card padding={20}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>
        Subscription
      </h3>

      <div style={rowStyle}>
        <span style={labelStyle}>Plan</span>
        <Badge
          bg={plan === 'Free' ? '#f3f4f6' : '#dbeafe'}
          color={plan === 'Free' ? '#6b7280' : '#1e40af'}
          size="md"
        >
          {plan}
        </Badge>
      </div>

      <div style={{ ...rowStyle, borderTop: '1px solid #f1f5f9' }}>
        <span style={labelStyle}>Properties</span>
        <span style={valueStyle}>{propertyCount} / {config.properties}</span>
      </div>

      <div style={{ ...rowStyle, borderTop: '1px solid #f1f5f9' }}>
        <span style={labelStyle}>Wells</span>
        <span style={valueStyle}>{wellCount} / {config.wells}</span>
      </div>

      <div style={{ ...rowStyle, borderTop: '1px solid #f1f5f9' }}>
        <span style={labelStyle}>Status</span>
        <span style={valueStyle}>{user.status || 'Active'}</span>
      </div>

      {/* Billing actions — hidden for Free users with no billing history */}
      {!isFreeNoBilling && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Change plan link — hidden for Enterprise */}
          {!isEnterprise && (
            <a
              href="/portal/upgrade"
              style={{
                display: 'block', textAlign: 'center', fontSize: 13,
                color: ORANGE, fontWeight: 600, textDecoration: 'none',
              }}
            >
              {isFreeWithBilling ? 'Upgrade Plan' : 'Change Plan'}
            </a>
          )}

          {/* Manage billing button */}
          <Button
            variant="secondary"
            size="sm"
            block
            onClick={handleManageBilling}
            disabled={billingLoading}
          >
            {billingLoading
              ? 'Opening...'
              : isPaid
                ? 'Manage Billing or Cancel Subscription'
                : 'Manage Billing'}
          </Button>

          {isPaid && !isEnterprise && (
            <p style={{ fontSize: 11, color: SLATE, margin: 0, textAlign: 'center' }}>
              Change your plan, update payment method, or cancel your subscription
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
