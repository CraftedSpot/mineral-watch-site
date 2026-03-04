import type { AuthUser } from '../../hooks/useAuth';

interface NavHeaderProps {
  user: AuthUser;
}

export function NavHeader({ user }: NavHeaderProps) {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    window.location.href = '/portal/login';
  };

  return (
    <header style={{
      background: '#fff', borderBottom: '1px solid #e2e8f0',
      fontFamily: "'Inter', 'DM Sans', sans-serif",
    }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto', padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56,
      }}>
        <a href="/" style={{
          fontFamily: "'Merriweather', serif", fontWeight: 900,
          fontSize: 18, color: '#1D6F5C',
        }}>
          Mineral Watch
        </a>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[
            { href: '/portal', label: 'Dashboard' },
            { href: '/portal/title', label: 'Title', active: true },
            { href: '/portal/map', label: 'Map' },
            { href: '/portal/intelligence', label: 'Intelligence' },
            { href: '/portal/account', label: 'Account' },
            { href: '/portal/learn', label: 'Learn' },
          ].map(({ href, label, active }) => (
            <a key={href} href={href} style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              color: active ? '#1D6F5C' : '#64748b',
              background: active ? '#f0fdf4' : 'transparent',
            }}>
              {label}
            </a>
          ))}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user.isSuperAdmin && (
            <>
              <a href="/portal/admin" style={{
                background: 'rgba(239,68,68,0.15)', color: '#f87171',
                border: '1px solid rgba(239,68,68,0.3)', padding: '6px 14px',
                borderRadius: 4, fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
              }}>Admin</a>
              <a href="/portal/marketing" style={{
                background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
                border: '1px solid rgba(139,92,246,0.3)', padding: '6px 14px',
                borderRadius: 4, fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
              }}>Marketing</a>
            </>
          )}
          <span style={{ fontSize: 13, color: '#1a2332', fontWeight: 500 }}>{user.name}</span>
          <button onClick={handleLogout} style={{
            background: 'transparent', border: '1px solid #e2e8f0',
            borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 500,
            color: '#64748b', cursor: 'pointer',
          }}>
            Log Out
          </button>
        </div>
      </div>
    </header>
  );
}
