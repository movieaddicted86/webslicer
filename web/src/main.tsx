import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useStore } from './state/store';

// Debug hook: inspect or drive the application state from the browser console.
(window as unknown as { webslicer: typeof useStore }).webslicer = useStore;

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
