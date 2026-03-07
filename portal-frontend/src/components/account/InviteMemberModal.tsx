import { useState } from 'react';
import { ModalShell } from '../ui/ModalShell';
import { TextInput, Select } from '../ui/FormField';
import { Button } from '../ui/Button';
import { SLATE, TEXT_DARK } from '../../lib/constants';
import { inviteMember } from '../../api/account';
import { useToast } from '../../contexts/ToastContext';
import { getPlanConfig } from '../../lib/plan-config';

interface InviteMemberModalProps {
  onClose: () => void;
  onInvited: () => void;
  plan: string;
  currentMemberCount: number;
}

export function InviteMemberModal({ onClose, onInvited, plan, currentMemberCount }: InviteMemberModalProps) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('Editor');
  const [submitting, setSubmitting] = useState(false);

  const config = getPlanConfig(plan);
  const atLimit = currentMemberCount >= config.members;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Please enter a valid email address');
      return;
    }
    if (atLimit) {
      toast.error(`Your ${plan} plan allows up to ${config.members} team member${config.members > 1 ? 's' : ''}. Please upgrade to add more members.`);
      return;
    }

    setSubmitting(true);
    try {
      await inviteMember(email.trim(), role, name.trim() || undefined);
      toast.success(`Invitation sent to ${email.trim()}`);
      onInvited();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invitation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <ModalShell
          onClose={onClose}
          title="Invite Team Member"
          maxWidth={440}
          bodyBg="#fff"
          footer={
            <>
              <div style={{ flex: 1 }} />
              <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" color="#C05621" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Sending...' : 'Send Invitation'}
              </Button>
            </>
          }
        >
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Email *
              </label>
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="team@example.com"
                required
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Name
              </label>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Role
              </label>
              <Select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }}>
                <option value="Editor">Editor</option>
                <option value="Viewer">Viewer</option>
              </Select>
              <p style={{ fontSize: 11, color: SLATE, margin: '4px 0 0' }}>
                Only organization owners can invite other Admins
              </p>
            </div>
          </form>
        </ModalShell>
      </div>
    </div>
  );
}
