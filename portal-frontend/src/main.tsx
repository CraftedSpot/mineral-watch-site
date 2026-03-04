import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setupImpersonation } from './hooks/useImpersonation';
import { App } from './App';
import './styles/global.css';

// Patch fetch for impersonation BEFORE React renders
setupImpersonation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
