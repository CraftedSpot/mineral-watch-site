import { Link, useLocation } from 'react-router-dom';
import { OIL_NAVY } from '../../lib/constants';
import type { AuthUser } from '../../hooks/useAuth';

interface NavHeaderProps {
  user: AuthUser;
}

const NAV_ITEMS = [
  { href: '/portal/react', label: 'Dashboard', react: true },
  { href: '/portal/title', label: 'Title', react: true },
  { href: '/portal/map', label: 'Map', react: false },
  { href: '/portal/intelligence', label: 'Intelligence', react: false },
  { href: '/portal/account', label: 'Account', react: false },
  { href: '/portal/learn', label: 'Learn', react: false },
];

export function NavHeader({ user }: NavHeaderProps) {
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    window.location.href = '/portal/login';
  };

  return (
    <header style={{
      background: OIL_NAVY,
      fontFamily: "'Inter', 'DM Sans', sans-serif",
    }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto', padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56,
      }}>
        <a href="/" style={{
          fontFamily: "'Merriweather', serif", fontWeight: 900,
          fontSize: 20, color: '#fff', textDecoration: 'none',
        }}>
          Mineral Watch
        </a>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {NAV_ITEMS.map(({ href, label, react: isReactRoute }) => {
            const isActive = href === '/portal/react'
              ? location.pathname === '/portal/react' || location.pathname === '/portal'
              : location.pathname.startsWith(href);
            const style: React.CSSProperties = {
              fontSize: 14, fontWeight: 500,
              color: isActive ? '#fff' : 'rgba(255,255,255,0.8)',
              textDecoration: 'none',
            };
            if (isReactRoute) {
              return <Link key={href} to={href} style={style}>{label}</Link>;
            }
            return <a key={href} href={href} style={style}>{label}</a>;
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {user.isSuperAdmin && (
            <>
              <a href="/portal/admin" style={{
                background: 'rgba(239,68,68,0.2)', color: '#fca5a5',
                border: '1px solid rgba(239,68,68,0.4)', padding: '5px 12px',
                borderRadius: 4, fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
                textDecoration: 'none',
              }}>Admin</a>
              <a href="/portal/marketing" style={{
                background: 'rgba(139,92,246,0.2)', color: '#c4b5fd',
                border: '1px solid rgba(139,92,246,0.4)', padding: '5px 12px',
                borderRadius: 4, fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
                textDecoration: 'none',
              }}>Marketing</a>
            </>
          )}
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{user.name}</span>
          <button onClick={handleLogout} style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4, padding: '6px 14px', fontSize: 13,
            color: '#fff', cursor: 'pointer',
          }}>
            Log Out
          </button>
        </div>
      </div>
    </header>
  );
}
