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
import { ToolsTab } from './tabs/ToolsTab';
import { ErrorBoundary } from '../ui/ErrorBoundary';
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
        {activeTab === 'properties' && <ErrorBoundary label="Properties"><PropertiesTab /></ErrorBoundary>}
        {activeTab === 'wells' && <ErrorBoundary label="Wells"><WellsTab /></ErrorBoundary>}
        {activeTab === 'documents' && <ErrorBoundary label="Documents"><DocumentsTab /></ErrorBoundary>}
        {activeTab === 'activity' && <ErrorBoundary label="Activity"><ActivityTab /></ErrorBoundary>}
        {activeTab === 'tools' && <ErrorBoundary label="Tools"><ToolsTab /></ErrorBoundary>}
      </div>
    </div>
  );
}
