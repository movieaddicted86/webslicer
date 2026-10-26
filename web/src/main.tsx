import React from 'react';
import { createRoot } from 'react-dom/client';
// The global layer first: component sheets are imported along with their components, and the
// element-level rules of `styles.css` (buttons, inputs) must still lose against them.
import './styles.css';
import { App } from './App';
import { useStore } from './state/store';
import { installAutosave } from './state/autosave';
import { installToolGuard } from './state/toolGuard';
import { reportUiError } from './errorReport';

// Debug hook: inspect or drive the application state from the browser console.
(window as unknown as { webslicer: typeof useStore }).webslicer = useStore;

installAutosave();
// A tool whose object or selection went away closes, so the panel never sits in an empty tool mode.
installToolGuard(useStore, () => useStore.getState().closeTool());

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root, {
  // P-7: a throw that escapes the tree (no boundary caught it) goes to the same log/toast path as the
  // region boundaries, so it is visible to the user and named in the console with its stack.
  onUncaughtError: (error, info) =>
    reportUiError(error, `uncaught${info.componentStack ? ` (${info.componentStack.split('\n')[1]?.trim()})` : ''}`),
  onCaughtError: (error, info) =>
    reportUiError(error, `caught${info.componentStack ? ` (${info.componentStack.split('\n')[1]?.trim()})` : ''}`),
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
