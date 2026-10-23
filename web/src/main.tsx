import React from 'react';
import { createRoot } from 'react-dom/client';
// The global layer first: component sheets are imported along with their components, and the
// element-level rules of `styles.css` (buttons, inputs) must still lose against them.
import './styles.css';
import { App } from './App';
import { useStore } from './state/store';
import { installAutosave } from './state/autosave';

// Debug hook: inspect or drive the application state from the browser console.
(window as unknown as { webslicer: typeof useStore }).webslicer = useStore;

installAutosave();

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
