import './lib/safeStorage';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

// Global uncaught error shields for Mobile APKs & WebViews & Maps Quota Defense
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.warn('[Motoride Mobile Global Error Handled]:', event.message, event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Motoride Mobile Promise Rejection Handled]:', event.reason);
  });

  (window as any).gm_authFailure = () => {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  };

  const origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (
      args.some(
        (a) =>
          typeof a === 'string' &&
          (a.includes('OverQuotaMapError') || a.includes('QuotaExceededError'))
      )
    ) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
    origErr(...args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

