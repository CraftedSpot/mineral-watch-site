import { useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Select } from '../ui/FormField';
import { SLATE, TEXT_DARK, BORDER } from '../../lib/constants';
import { ToggleSwitch } from './ToggleSwitch';
import { MemberRow } from './MemberRow';
import { InviteMemberModal } from './InviteMemberModal';
import { ChangeRoleModal } from './ChangeRoleModal';
import { saveOrgSettings, removeMember } from '../../api/account';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { AccountUser, Organization, OrgMember } from '../../types/account';

interface OrganizationCardProps {
  user: AccountUser;
  organization: Organization;
  onMutated: () => void;
}

const ORG_NOTIFICATION_MODES = [
  { value: 'Daily + Weekly', label: 'Daily + Weekly (Recommended)' },
  { value: 'Daily Digest', label: 'Daily Digest' },
  { value: 'Weekly Report', label: 'Weekly Report' },
  { value: 'None', label: 'None' },
];

export function OrganizationCard({ user, organization, onMutated }: OrganizationCardProps) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const isMobile = useIsMobile();

  const currentMember = organization.members.find((m) => m.email === user.email);
  const isAdmin = currentMember?.role === 'Admin';

  // Modals
  const [showInvite, setShowInvite] = useState(false);
  const [roleTarget, setRoleTarget] = useState<OrgMember | null>(null);

  // Team notification settings (admin only)
  const [orgMode, setOrgMode] = useState(organization.defaultNotificationMode || 'Daily + Weekly');
  const [allowOverride, setAllowOverride] = useState(organization.allowUserOverride !== false);
  const [savingSettings, setSavingSettings] = useState(false);

  const handleSaveOrgSettings = async () => {
    setSavingSettings(true);
    try {
      await saveOrgSettings({
        defaultNotificationMode: orgMode,
        allowUserOverride: allowOverride,
      });
      toast.success('Team notification settings saved!');
    } catch {
      toast.error('Failed to save team settings. Please try again.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRemove = async (member: OrgMember) => {
    const confirmed = await confirm(
      `This will remove ${member.name || member.email} from ${organization.name}. They will lose access to shared organization data.`,
      {
        title: 'Remove Member',
        confirmText: 'Remove Member',
        icon: 'trash',
        destructive: true,
      }
    );
    if (!confirmed) return;

    try {
      await removeMember(member.id);
      toast.success(`${member.name || member.email} has been removed.`);
      onMutated();
    } catch {
      toast.error('Failed to remove member. Please try again.');
    }
  };

  return (
    <Card padding={20}>
      {/* Header */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        marginBottom: 16, gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: 0 }}>
            {organization.name}
          </h3>
          <Badge bg="#dbeafe" color="#1e40af" size="sm">{organization.plan}</Badge>
          <span style={{ fontSize: 12, color: SLATE }}>
            {organization.members.length} member{organization.members.length !== 1 ? 's' : ''}
          </span>
        </div>

        {isAdmin && (
          <Button variant="primary" size="sm" color="#C05621" onClick={() => setShowInvite(true)}>
            Invite Member
          </Button>
        )}
      </div>

      {/* Members list */}
      <div>
        {organization.members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isAdmin={isAdmin}
            isSelf={member.email === user.email}
            onChangeRole={(m) => setRoleTarget(m)}
            onRemove={handleRemove}
          />
        ))}
      </div>

      {/* Team Notification Settings — admin only */}
      {isAdmin && (
        <div style={{
          marginTop: 24, paddingTop: 20,
          borderTop: `1px solid ${BORDER}`,
        }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 4px' }}>
            Team Notification Settings
          </h4>
          <p style={{ fontSize: 12, color: SLATE, margin: '0 0 16px' }}>
            Configure how team members receive alert notifications. Members can override this if allowed.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Default Notification Mode
              </label>
              <Select value={orgMode} onChange={(e) => setOrgMode(e.target.value)} style={{ maxWidth: 320 }}>
                {ORG_NOTIFICATION_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </Select>
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', background: '#f8fafc', borderRadius: 6,
              border: `1px solid ${BORDER}`,
            }}>
              <div>
                <div style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600 }}>Allow Member Override</div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>
                  Let members choose their own notification mode
                </div>
              </div>
              <ToggleSwitch checked={allowOverride} onChange={setAllowOverride} />
            </div>

            <Button
              variant="primary"
              size="sm"
              color="#C05621"
              onClick={handleSaveOrgSettings}
              disabled={savingSettings}
              style={{ alignSelf: 'flex-start' }}
            >
              {savingSettings ? 'Saving...' : 'Save Team Settings'}
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showInvite && (
        <InviteMemberModal
          onClose={() => setShowInvite(false)}
          onInvited={onMutated}
          plan={organization.plan}
          currentMemberCount={organization.members.length}
        />
      )}
      {roleTarget && (
        <ChangeRoleModal
          member={roleTarget}
          onClose={() => setRoleTarget(null)}
          onChanged={onMutated}
        />
      )}
    </Card>
  );
}
