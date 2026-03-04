import type { ImpersonationInfo } from '../../hooks/useImpersonation';

interface ImpersonationBannerProps {
  info: ImpersonationInfo;
}

export function ImpersonationBanner({ info }: ImpersonationBannerProps) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#f59e0b', color: '#000', padding: '10px 16px',
      textAlign: 'center', fontWeight: 600, fontSize: 14,
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      Viewing as: {info.name} ({info.email}) — {info.orgName} [{info.plan}]
      <a href={window.location.pathname} style={{
        marginLeft: 16, color: '#000', textDecoration: 'underline', fontWeight: 700,
      }}>
        Exit
      </a>
    </div>
  );
}
