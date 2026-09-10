import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './hooks/useAuth';
import { SettingsProvider } from './hooks/useSettings';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root-element niet gevonden.');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Settings sits above auth: the sign-in and unlock screens need a theme
          too, and someone on light mode should not get a dark login screen. */}
      <SettingsProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>,
);
