import { Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useImpersonation } from '../../hooks/useImpersonation';
import { NavHeader } from './NavHeader';
import { ImpersonationBanner } from './ImpersonationBanner';

export function AppShell() {
  const { user, loading } = useAuth();
  const impersonation = useImpersonation();

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: "'DM Sans', sans-serif", color: '#64748b',
      }}>
        <div style={{
          width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#C05621',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ marginLeft: 12 }}>Loading...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return null; // Redirecting to login

  return (
    <div style={{ paddingTop: impersonation ? 42 : 0 }}>
      {impersonation && <ImpersonationBanner info={impersonation} />}
      <NavHeader user={user} />
      <Outlet />
    </div>
  );
}
