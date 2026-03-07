import { Card } from '../ui/Card';
import { SLATE, TEXT_DARK } from '../../lib/constants';
import type { AccountUser } from '../../types/account';

interface ProfileCardProps {
  user: AccountUser;
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

export function ProfileCard({ user }: ProfileCardProps) {
  return (
    <Card padding={20}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>
        Profile
      </h3>
      <div style={rowStyle}>
        <span style={labelStyle}>Name</span>
        <span style={valueStyle}>{user.name || '—'}</span>
      </div>
      <div style={{ ...rowStyle, borderTop: '1px solid #f1f5f9' }}>
        <span style={labelStyle}>Email</span>
        <span style={valueStyle}>{user.email}</span>
      </div>
    </Card>
  );
}
