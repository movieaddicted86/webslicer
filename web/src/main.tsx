import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useStore } from './state/store';

// Debug hook: inspect or drive the application state from the browser console.
(window as unknown as { webslicer: typeof useStore }).webslicer = useStore;


createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
