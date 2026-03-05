import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { ModalProvider } from './contexts/ModalContext';
import { DashboardDataProvider } from './contexts/DashboardDataContext';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { TitlePage } from './components/title/TitlePage';

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <DashboardDataProvider>
        <ModalProvider>
          <Routes>
            <Route path="/portal" element={<AppShell />}>
              <Route path="react" element={<DashboardPage />} />
              <Route path="title" element={<TitlePage />} />
            </Route>
            {/* Fallback: redirect to React dashboard (not /portal which is vanilla) */}
            <Route path="*" element={<Navigate to="/portal/react" replace />} />
          </Routes>
        </ModalProvider>
        </DashboardDataProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
