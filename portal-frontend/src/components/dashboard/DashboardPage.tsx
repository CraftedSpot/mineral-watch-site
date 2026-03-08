import { useEffect, useRef } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import { updateSearchParam } from '../../lib/helpers';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { TabBar } from './TabBar';
import { DashboardHeader } from './DashboardHeader';
import { PropertiesTab } from './tabs/PropertiesTab';
import { WellsTab } from './tabs/WellsTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { ActivityTab } from './tabs/ActivityTab';
import { SLATE } from '../../lib/constants';
import type { AuthUser } from '../layout/AppShell';

const TABS = ['properties', 'wells', 'documents', 'activity', 'tools'] as const;
type TabId = (typeof TABS)[number];

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useOutletContext<{ user: AuthUser }>();
  const toast = useToast();
  const purchaseHandled = useRef(false);
  const activeTab = (searchParams.get('tab') as TabId) || 'properties';

  // Handle Stripe checkout return (?purchase=success or ?purchase=cancelled)
  useEffect(() => {
    const purchase = searchParams.get('purchase');
    if (!purchase || purchaseHandled.current) return;
    purchaseHandled.current = true;

    // Clean the URL — remove purchase and session_id params
    const cleaned = new URLSearchParams(searchParams);
    cleaned.delete('purchase');
    cleaned.delete('session_id');
    window.history.replaceState({}, '', `${window.location.pathname}?${cleaned.toString()}`);

    if (purchase === 'success') {
      setTimeout(() => {
        toast.success('Credit pack purchased successfully! Credits have been added to your account.', 6000);
      }, 500);
    } else if (purchase === 'cancelled') {
      toast.info('Purchase cancelled');
    }
  }, [searchParams, toast]);

  const isMobile = useIsMobile();

  const setTab = (tab: string) => {
    setSearchParams(updateSearchParam('tab', tab), { replace: true });
  };

  return (
    <div style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      <DashboardHeader activeTab={activeTab} user={user} />
      <TabBar tabs={TABS} active={activeTab} onChange={setTab} />

      <div style={{ padding: isMobile ? '12px' : '24px', maxWidth: 1600, margin: '0 auto' }}>
        {activeTab === 'properties' && <PropertiesTab />}
        {activeTab === 'wells' && <WellsTab />}
        {activeTab === 'documents' && <DocumentsTab />}
        {activeTab === 'activity' && <ActivityTab />}
        {activeTab === 'tools' && <ToolsPlaceholder />}
      </div>
    </div>
  );
}

function ToolsPlaceholder() {
  return (
    <div style={{
      padding: '60px 24px', textAlign: 'center',
      border: '2px dashed #e2e8f0', borderRadius: 12,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2332', marginBottom: 8 }}>
        Tools
      </div>
      <div style={{ fontSize: 14, color: SLATE, maxWidth: 500, margin: '0 auto' }}>
        Revenue estimator, production analysis, and OCC filing viewer.
      </div>
      <div style={{
        marginTop: 16, fontSize: 12, color: '#94a3b8',
        background: '#f8fafc', display: 'inline-block', padding: '6px 16px',
        borderRadius: 6,
      }}>
        Phase 2d implementation pending
      </div>
    </div>
  );
}
