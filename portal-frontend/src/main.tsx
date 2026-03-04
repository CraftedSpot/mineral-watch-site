import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { setupImpersonation } from './hooks/useImpersonation';
import { App } from './App';
import './styles/global.css';

// Patch fetch for impersonation BEFORE React renders
setupImpersonation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
