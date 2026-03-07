import { useState, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Select } from '../ui/FormField';
import { SLATE, TEXT_DARK, BORDER } from '../../lib/constants';
import { ToggleSwitch } from './ToggleSwitch';
import { saveAlertPreferences } from '../../api/account';
import { useToast } from '../../contexts/ToastContext';
import type { AccountUser, AlertPreferences } from '../../types/account';

interface AlertPreferencesCardProps {
  user: AccountUser;
  onSaved: () => void;
}

const NOTIFICATION_MODES = [
  { value: 'Use Org Default', label: 'Use Organization Default', orgOnly: true },
  { value: 'Daily + Weekly', label: 'Daily + Weekly (Recommended)' },
  { value: 'Daily Digest', label: 'Daily Digest' },
  { value: 'Weekly Report', label: 'Weekly Report' },
  { value: 'None', label: 'None' },
];

const EXPIRATION_DAYS = [7, 14, 30, 60, 90];

function getNotificationHint(mode: string, orgDefault: string | null): string {
  if (mode === 'Use Org Default') {
    return `Your organization default: ${orgDefault || 'Daily + Weekly'}`;
  }
  if (mode === 'None') return 'You will not receive any alert notifications.';
  if (mode === 'Daily + Weekly') return 'Morning email with your property alerts plus a weekly report with regional activity.';
  if (mode === 'Daily Digest') return 'Morning email with your property alerts. No weekly report.';
  if (mode === 'Weekly Report') return 'All alerts bundled into a weekly report with regional activity every Sunday.';
  return '';
}

const ALERT_TYPES = [
  { key: 'alertPermits' as const, label: 'Drilling Permits', desc: 'New drilling permits filed near your properties' },
  { key: 'alertCompletions' as const, label: 'Well Completions', desc: 'Completion reports for wells in your area' },
  { key: 'alertStatusChanges' as const, label: 'Status Changes', desc: 'Well status changes (active, inactive, plugged)' },
  { key: 'alertExpirations' as const, label: 'Permit Expirations', desc: 'Permits approaching expiration date' },
  { key: 'alertOperatorTransfers' as const, label: 'Operator Transfers', desc: 'Operator changes on wells near your properties' },
];

export function AlertPreferencesCard({ user, onSaved }: AlertPreferencesCardProps) {
  const hasOrg = !!user.organizationId;
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  // Form state initialized from user data
  const initialMode = (() => {
    if (hasOrg) return user.notificationOverride || 'Use Org Default';
    if (user.notificationOverride && user.notificationOverride !== 'Use Org Default') return user.notificationOverride;
    return 'Daily + Weekly';
  })();

  const [mode, setMode] = useState(initialMode);
  const [permits, setPermits] = useState(user.alertPermits);
  const [completions, setCompletions] = useState(user.alertCompletions);
  const [statusChanges, setStatusChanges] = useState(user.alertStatusChanges);
  const [expirations, setExpirations] = useState(user.alertExpirations);
  const [transfers, setTransfers] = useState(user.alertOperatorTransfers);
  const [expirationDays, setExpirationDays] = useState(user.expirationWarningDays || 30);

  const toggleState: Record<string, { value: boolean; set: (v: boolean) => void }> = {
    alertPermits: { value: permits, set: setPermits },
    alertCompletions: { value: completions, set: setCompletions },
    alertStatusChanges: { value: statusChanges, set: setStatusChanges },
    alertExpirations: { value: expirations, set: setExpirations },
    alertOperatorTransfers: { value: transfers, set: setTransfers },
  };

  // Dirty check
  const isDirty = useMemo(() => {
    return mode !== initialMode
      || permits !== user.alertPermits
      || completions !== user.alertCompletions
      || statusChanges !== user.alertStatusChanges
      || expirations !== user.alertExpirations
      || transfers !== user.alertOperatorTransfers
      || expirationDays !== (user.expirationWarningDays || 30);
  }, [mode, permits, completions, statusChanges, expirations, transfers, expirationDays,
      initialMode, user]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const prefs: AlertPreferences = {
        alertPermits: permits,
        alertCompletions: completions,
        alertStatusChanges: statusChanges,
        alertExpirations: expirations,
        alertOperatorTransfers: transfers,
        expirationWarningDays: expirationDays,
        notificationOverride: mode,
      };
      await saveAlertPreferences(prefs);
      toast.success('Alert preferences saved!');
      onSaved();
    } catch {
      toast.error('Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding={20}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 16px' }}>
        Alert Preferences
      </h3>

      {/* Notification Delivery Mode */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600, display: 'block', marginBottom: 6 }}>
          Notification Delivery Mode
        </label>
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ width: '100%', maxWidth: 320 }}
        >
          {NOTIFICATION_MODES.filter((m) => !m.orgOnly || hasOrg).map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
        <p style={{ fontSize: 12, color: SLATE, margin: '6px 0 0', lineHeight: 1.4 }}>
          {getNotificationHint(mode, user.orgDefaultNotificationMode)}
        </p>
      </div>

      {/* Alert Type Toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ALERT_TYPES.map((alert) => {
          const state = toggleState[alert.key];
          return (
            <div key={alert.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', background: '#f8fafc', borderRadius: 6,
              border: `1px solid ${BORDER}`,
            }}>
              <div>
                <div style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600 }}>{alert.label}</div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{alert.desc}</div>
              </div>
              <ToggleSwitch checked={state.value} onChange={state.set} />
            </div>
          );
        })}
      </div>

      {/* Expiration warning days */}
      <div style={{
        marginTop: 12, padding: '10px 12px', background: '#f8fafc', borderRadius: 6,
        border: `1px solid ${BORDER}`,
        opacity: expirations ? 1 : 0.5,
        transition: 'opacity 0.2s',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600 }}>Expiration Warning Period</div>
            <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>How early to alert before permit expiration</div>
          </div>
          <Select
            value={expirationDays}
            onChange={(e) => setExpirationDays(Number(e.target.value))}
            disabled={!expirations}
            style={{ width: 100 }}
          >
            {EXPIRATION_DAYS.map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Save button */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          variant="primary"
          size="sm"
          color="#C05621"
          onClick={handleSave}
          disabled={!isDirty || saving}
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </Card>
  );
}
