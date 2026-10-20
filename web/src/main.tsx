import React from 'react';
import { createRoot } from 'react-dom/client';
import { SHARED_PACKAGE_NAME } from '@webslicer/shared';
import { App } from './App';
import './styles.css';
import { useStore } from './state/store';

// Debug hook: inspect or drive the application state from the browser console.
(window as unknown as { webslicer: typeof useStore }).webslicer = useStore;

// The workspace package is aliased to `shared/src` in dev (Vite) and bundled for production; this
// line only reports that the wiring is live.
if (import.meta.env.DEV) console.log(`[webslicer] ${SHARED_PACKAGE_NAME} loaded`);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
