import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { ToastProvider } from './contexts/ToastContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { ModalProvider } from './contexts/ModalContext';
import { DashboardDataProvider } from './contexts/DashboardDataContext';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { TitlePage } from './components/title/TitlePage';
import { AccountPage } from './components/account/AccountPage';
import { LearnPage } from './components/learn/LearnPage';
import { IntelligencePage } from './components/intelligence/IntelligencePage';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <ConfirmProvider>
        <DashboardDataProvider>
        <ModalProvider>
          <Routes>
            <Route path="/portal" element={<AppShell />}>
              <Route path="react" element={<DashboardPage />} />
              <Route path="title" element={<TitlePage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="learn" element={<LearnPage />} />
              <Route path="intelligence" element={<IntelligencePage />} />
            </Route>
            {/* Fallback: redirect to React dashboard (not /portal which is vanilla) */}
            <Route path="*" element={<Navigate to="/portal/react" replace />} />
          </Routes>
        </ModalProvider>
        </DashboardDataProvider>
      </ConfirmProvider>
    </ToastProvider>
    </QueryClientProvider>
  );
}
