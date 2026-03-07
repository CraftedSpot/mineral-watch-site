import type { ImpersonationInfo } from '../../hooks/useImpersonation';
import { useIsMobile } from '../../hooks/useIsMobile';

interface ImpersonationBannerProps {
  info: ImpersonationInfo;
}

export function ImpersonationBanner({ info }: ImpersonationBannerProps) {
  const isMobile = useIsMobile();

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#f59e0b', color: '#000',
      padding: isMobile ? '8px 12px' : '10px 16px',
      textAlign: 'center', fontWeight: 600,
      fontSize: isMobile ? 12 : 14,
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {isMobile
        ? <>{info.name} [{info.plan}]</>
        : <>Viewing as: {info.name} ({info.email}) — {info.orgName} [{info.plan}]</>
      }
      <a href={window.location.pathname} style={{
        marginLeft: isMobile ? 8 : 16, color: '#000', textDecoration: 'underline', fontWeight: 700,
      }}>
        Exit
      </a>
    </div>
  );
}
