import { useState } from 'react';
import { ModalShell } from '../ui/ModalShell';
import { Select } from '../ui/FormField';
import { Button } from '../ui/Button';
import { SLATE, TEXT_DARK } from '../../lib/constants';
import { changeMemberRole } from '../../api/account';
import { useToast } from '../../contexts/ToastContext';
import type { OrgMember } from '../../types/account';

interface ChangeRoleModalProps {
  member: OrgMember;
  onClose: () => void;
  onChanged: () => void;
}

export function ChangeRoleModal({ member, onClose, onChanged }: ChangeRoleModalProps) {
  const toast = useToast();
  const [role, setRole] = useState(member.role === 'Admin' ? 'Editor' : member.role);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await changeMemberRole(member.id, role);
      toast.success(`Role updated to ${role}`);
      onChanged();
      onClose();
    } catch {
      toast.error('Failed to update role. Please try again.');
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
          title="Change Role"
          maxWidth={400}
          bodyBg="#fff"
          footer={
            <>
              <div style={{ flex: 1 }} />
              <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" color="#C05621" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Updating...' : 'Update Role'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: SLATE, margin: 0 }}>
              Change role for <strong>{member.name || member.email}</strong>
            </p>
            <p style={{ fontSize: 12, color: SLATE, margin: 0 }}>
              Current role: {member.role}
            </p>
            <div>
              <label style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                New Role
              </label>
              <Select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%' }}>
                <option value="Editor">Editor</option>
                <option value="Viewer">Viewer</option>
              </Select>
            </div>
          </div>
        </ModalShell>
      </div>
    </div>
  );
}
