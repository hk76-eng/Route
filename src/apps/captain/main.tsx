import '../../lib/safeStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { CaptainApp } from './CaptainApp';
import '../../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CaptainApp />
  </React.StrictMode>
);
