import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { OIL_NAVY } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { AuthUser } from '../../hooks/useAuth';

interface NavHeaderProps {
  user: AuthUser;
}

const NAV_ITEMS = [
  { href: '/portal/react', label: 'Dashboard', react: true },
  { href: '/portal/title', label: 'Title', react: true },
  { href: '/portal/map', label: 'Map', react: false },
  { href: '/portal/intelligence', label: 'Intelligence', react: true },
  { href: '/portal/account', label: 'Account', react: false },
  { href: '/portal/learn', label: 'Learn', react: false },
];

export function NavHeader({ user }: NavHeaderProps) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Close menus on navigation
  useEffect(() => { setMenuOpen(false); setUserMenuOpen(false); }, [location.pathname]);

  // Close user dropdown on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-user-menu]')) setUserMenuOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [userMenuOpen]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    window.location.href = '/portal/login';
  };

  const isActive = (href: string) =>
    href === '/portal/react'
      ? location.pathname === '/portal/react' || location.pathname === '/portal'
      : location.pathname.startsWith(href);

  const navLinkStyle = (href: string): React.CSSProperties => ({
    fontSize: isMobile ? 15 : 14,
    fontWeight: 400,
    color: isActive(href) ? '#fff' : 'rgba(255,255,255,0.8)',
    textDecoration: 'none',
  });

  const renderNavLink = (item: typeof NAV_ITEMS[0]) => {
    if (item.react) {
      return (
        <Link key={item.href} to={item.href}
          onClick={() => setMenuOpen(false)}
          style={{
            ...navLinkStyle(item.href),
            ...(isMobile ? {
              display: 'block', padding: '12px 0', minHeight: 44,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            } : {}),
          }}
        >{item.label}</Link>
      );
    }
    return (
      <a key={item.href} href={item.href}
        style={{
          ...navLinkStyle(item.href),
          ...(isMobile ? {
            display: 'block', padding: '12px 0', minHeight: 44,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          } : {}),
        }}
      >{item.label}</a>
    );
  };

  const adminBtnStyle: React.CSSProperties = {
    background: 'rgba(239,68,68,0.2)', color: '#fca5a5',
    border: '1px solid rgba(239,68,68,0.4)', padding: '5px 12px',
    borderRadius: 4, fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
    textDecoration: 'none',
  };

  const marketingBtnStyle: React.CSSProperties = {
    background: 'rgba(139,92,246,0.2)', color: '#c4b5fd',
    border: '1px solid rgba(139,92,246,0.4)', padding: '5px 12px',
    borderRadius: 4, fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
    textDecoration: 'none',
  };

  return (
    <header style={{
      background: OIL_NAVY,
      fontFamily: "'Inter', 'DM Sans', sans-serif",
      position: isMobile ? 'sticky' : undefined,
      top: isMobile ? 0 : undefined,
      zIndex: isMobile ? 1000 : undefined,
    }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto',
        padding: isMobile ? '0 16px' : '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56,
      }}>
        <a href="/" style={{
          fontFamily: "'Merriweather', serif", fontWeight: 700,
          fontSize: 20, color: '#fff', textDecoration: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          Mineral Watch
          <span style={{
            fontSize: 9, fontWeight: 700, fontFamily: "'Inter', sans-serif",
            background: 'rgba(59,130,246,0.25)', color: '#93c5fd',
            padding: '2px 6px', borderRadius: 4, letterSpacing: 0.5,
            lineHeight: 1.2,
          }}>REACT</span>
        </a>

        {!isMobile && (
          <nav style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {NAV_ITEMS.map(renderNavLink)}
          </nav>
        )}

        {!isMobile && (
          <div data-user-menu style={{ position: 'relative' }}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, color: 'rgba(255,255,255,0.8)',
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 0',
              }}
            >
              {user.name} <span style={{ fontSize: 10, opacity: 0.7 }}>{userMenuOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {userMenuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                minWidth: 180, overflow: 'hidden', zIndex: 100,
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', fontSize: 14, color: '#374151', fontWeight: 600 }}>
                  {user.name}
                </div>
                {user.isSuperAdmin && (
                  <>
                    <a href="/portal/admin" style={{ display: 'block', padding: '10px 16px', fontSize: 14, color: '#dc2626', textDecoration: 'none' }}>Admin</a>
                    <a href="/portal/marketing" style={{ display: 'block', padding: '10px 16px', fontSize: 14, color: '#7c3aed', textDecoration: 'none', borderBottom: '1px solid #e5e7eb' }}>Marketing</a>
                  </>
                )}
                <button onClick={handleLogout} style={{
                  display: 'block', width: '100%', padding: '10px 16px', fontSize: 14,
                  background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
                  color: '#374151', fontFamily: 'inherit',
                }}>Log Out</button>
              </div>
            )}
          </div>
        )}

        {isMobile && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 8, minWidth: 44, minHeight: 44, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              {menuOpen
                ? <path d="M6 6l12 12M6 18L18 6" />
                : <path d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        )}
      </div>

      {/* Mobile dropdown menu */}
      {isMobile && (
        <div
          className={`nav-mobile-menu${menuOpen ? ' open' : ''}`}
          style={{ background: OIL_NAVY, borderTop: '1px solid rgba(255,255,255,0.1)' }}
        >
          <div style={{ padding: '8px 16px' }}>
            {NAV_ITEMS.map(renderNavLink)}

            {user.isSuperAdmin && (
              <div style={{ paddingTop: 8, display: 'flex', gap: 8 }}>
                <a href="/portal/admin" style={adminBtnStyle}>Admin</a>
                <a href="/portal/marketing" style={marketingBtnStyle}>Marketing</a>
              </div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 0 8px', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 8,
            }}>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{user.name}</span>
              <button onClick={handleLogout} style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4, padding: '6px 14px', fontSize: 13,
                color: '#fff', cursor: 'pointer',
              }}>Log Out</button>
            </div>
          </div>
        </div>
      )}

      {/* Backdrop to close menu on outside tap */}
      {isMobile && menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 }}
        />
      )}
    </header>
  );
}
