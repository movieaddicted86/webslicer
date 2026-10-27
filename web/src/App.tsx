import { useEffect, useRef } from 'react';
import { useStore } from './state/store';
import { startSession } from './state/session';
import { AppShell } from './components/AppShell';
import { HostRefusalScreen } from './components/HostRefusalScreen';
import { Toasts } from './components/Toasts';
import { Dialogs } from './components/dialogs/Dialogs';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { isHostRefusal } from './hostRefusal';
import { reportUiError } from './errorReport';

export function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const fatalStatus = useStore((s) => s.fatalStatus);
  const sessionStarted = useRef(false);

  useEffect(() => {
    // `init` loads the schema and presets; a failure lands in `fatal` inside the action, so there is
    // nothing left for this effect to report
    void init();
  }, [init]);

  // The last session comes back on its own (T-035) – once the presets are loaded, so the restored
  // project settings meet the same store a click on "Restore" did.
  useEffect(() => {
    if (!ready || sessionStarted.current) return;
    sessionStarted.current = true;
    void startSession();
  }, [ready]);

  if (fatal) {
    // A refused Host is not "the server is down": nothing can load until the address is allowed, and
    // the panel says which address and how – Retry alone could never succeed.
    if (isHostRefusal(fatalStatus)) return <HostRefusalScreen />;
    return (
      <div className="splash">
        <h1>WebSlicer</h1>
        <p className="error">Could not connect to the server: {fatal}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="splash">
        <h1>WebSlicer</h1>
        <p>Loading slicer configuration…</p>
      </div>
    );
  }
  return (
    <>
      <AppShell />
      {/* P-7: a broken dialog must not take the plater with it – the card sits where the dialog was */}
      <ErrorBoundary region="Dialogs" placement="overlay" onError={(e) => reportUiError(e, 'Dialogs')}>
        <Dialogs />
      </ErrorBoundary>
      <Toasts />
    </>
  );
}
