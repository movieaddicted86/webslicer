import { useEffect, useRef } from 'react';
import { useStore } from './state/store';
import { startSession } from './state/session';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { SettingsView } from './components/SettingsView';
import { Viewer } from './three/Viewer';
import { Toasts } from './components/Toasts';
import { Dialogs } from './components/dialogs/Dialogs';
import { DropZone } from './components/DropZone';

export function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const view = useStore((s) => s.view);
  const sessionStarted = useRef(false);

  useEffect(() => {
    init();
  }, [init]);

  // The last session comes back on its own (T-035) – once the presets are loaded, so the restored
  // project settings meet the same store a click on "Restore" did.
  useEffect(() => {
    if (!ready || sessionStarted.current) return;
    sessionStarted.current = true;
    void startSession();
  }, [ready]);

  if (fatal) {
    return (
      <div className="splash">
        <h1>WebSlicer</h1>
        <p className="error">Could not connect to the server: {fatal}</p>
        <button onClick={() => location.reload()}>Retry</button>
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
  const settings = view === 'print' || view === 'filament' || view === 'printer';
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        {settings ? (
          <SettingsView />
        ) : (
          <>
            <DropZone>
              <Viewer />
            </DropZone>
            <Sidebar />
          </>
        )}
      </div>
      <Dialogs />
      <Toasts />
    </div>
  );
}
