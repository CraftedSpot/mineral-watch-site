import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SLATE, TEXT_DARK, BORDER } from '../../lib/constants';
import { inviteMember } from '../../api/account';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { OrgMember } from '../../types/account';

interface MemberRowProps {
  member: OrgMember;
  isAdmin: boolean;
  isSelf: boolean;
  onChangeRole: (member: OrgMember) => void;
  onRemove: (member: OrgMember) => void;
}

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  Admin: { bg: '#dbeafe', color: '#1e40af' },
  Editor: { bg: '#dcfce7', color: '#166534' },
  Viewer: { bg: '#f3f4f6', color: '#6b7280' },
};

export function MemberRow({ member, isAdmin, isSelf, onChangeRole, onRemove }: MemberRowProps) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const [resending, setResending] = useState(false);

  const roleStyle = ROLE_COLORS[member.role] || ROLE_COLORS.Viewer;

  const handleResend = async () => {
    setResending(true);
    try {
      await inviteMember(member.email, member.role, member.name);
      toast.success(`Invitation resent to ${member.email}`);
    } catch {
      toast.error('Failed to resend invitation. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: isMobile ? 'flex-start' : 'center',
      padding: '12px 0',
      borderBottom: `1px solid ${BORDER}`,
      gap: isMobile ? 8 : 0,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: TEXT_DARK, fontWeight: 600 }}>
          {member.name || member.email}
          {isSelf && <span style={{ fontWeight: 400, color: SLATE }}> (you)</span>}
        </span>
        <span style={{ fontSize: 12, color: SLATE }}>{member.email}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge bg={roleStyle.bg} color={roleStyle.color} size="sm">{member.role}</Badge>

        {isAdmin && !isSelf && (
          <>
            <Button variant="link" size="sm" onClick={handleResend} disabled={resending}
              style={{ fontSize: 11 }}>
              {resending ? 'Sending...' : 'Resend Invitation'}
            </Button>
            <Button variant="link" size="sm" onClick={() => onChangeRole(member)}
              style={{ fontSize: 11 }}>
              Change Role
            </Button>
            <Button variant="link" size="sm" onClick={() => onRemove(member)}
              style={{ fontSize: 11, color: '#dc2626' }}>
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
