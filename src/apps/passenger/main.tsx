import '../../lib/safeStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PassengerApp } from './PassengerApp';
import '../../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PassengerApp />
  </React.StrictMode>
);
