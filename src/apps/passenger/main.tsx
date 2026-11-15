import '../../lib/safeStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PassengerApp } from './PassengerApp';
import '../../index.css';

if (typeof window !== 'undefined') {
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PassengerApp />
  </React.StrictMode>
);
