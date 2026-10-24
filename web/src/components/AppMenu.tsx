import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { importFiles } from '../importFiles';
import { api, downloadBlob } from '../api';
import type { Mode } from '../api';
import { Icon } from '../icons/Icon';
import './AppMenu.css';

/** The three visibility modes, in the order the old select box listed them. */
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'expert', label: 'Expert' },
];

/**
 * The slim top bar's menu (layout 3.0, L-1): every action the old, wide top bar carried in one
 * dropdown – Import, Import presets, Open from library, Save project, the Export list, the visibility
 * mode and the dialogs. The rail keeps Library, Printers and About as well; the two entry points do
 * the same thing.
 *
 * Behaviour follows the app's other dropdowns: click to open, Esc closes (the submenu first, the menu
 * second) and returns the focus to the trigger, a click outside closes, and the items are ordinary
 * buttons in DOM order so Tab reaches them.
 */
export function AppMenu() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const objects = useStore((s) => s.objects);
  const job = useStore((s) => s.job);
  const openDialog = useStore((s) => s.openDialog);
  const [open, setOpen] = useState(false);
  /** the open submenu; the menu closes it before itself on Esc */
  const [sub, setSub] = useState<'export' | 'mode'>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // the import shortcut the old top bar owned: it belongs to the action, not to the button
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I' || e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        fileRef.current?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    // capture phase: Esc closes the menu and must not also reach the plater (clear the selection)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (sub) setSub(undefined);
      else close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, sub]);

  function close() {
    setOpen(false);
    setSub(undefined);
    // the keyboard user does not lose their place: the focus goes back to the trigger
    trigger.current?.focus();
  }

  /** Run an action and close the menu: an open dropdown over its own dialog would cover it. */
  const run = (action: () => void) => () => {
    setOpen(false);
    setSub(undefined);
    action();
  };

  const exportProject = async () => {
    const st = useStore.getState();
    if (!st.objects.length) return st.toast('error', 'Nothing to export');
    const req = st.buildSliceRequest();
    if (!req.objects.length) return st.toast('error', 'Models are still uploading');
    try {
      const blob = await api.export3mf(req);
      downloadBlob(blob, `${req.outputName || 'project'}.3mf`);
    } catch (e) {
      st.toast('error', (e as Error).message);
    }
  };
  const exportConfig = async () => {
    const st = useStore.getState();
    try {
      downloadBlob(await api.exportConfig(st.buildSliceRequest()), 'config.ini');
    } catch (e) {
      st.toast('error', (e as Error).message);
    }
  };
  const exportPresetBundle = async () => {
    try {
      downloadBlob(await api.exportBundle(), 'WebSlicer config bundle.ini');
    } catch (e) {
      useStore.getState().toast('error', (e as Error).message);
    }
  };

  return (
    <div className="app-menu" ref={root}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".stl,.obj,.3mf,.amf,.step,.stp"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        ref={trigger}
        className={open ? 'app-menu-trigger active' : 'app-menu-trigger'}
        title="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        data-testid="menu"
      >
        <Icon name="menu" size={18} />
        <span className="app-menu-name">Menu</span>
      </button>

      {open && (
        <div className="app-menu-panel" role="menu" aria-label="Main menu" data-testid="menu-panel">
          <button role="menuitem" onClick={run(() => fileRef.current?.click())} title="Import STL/OBJ/3MF/AMF/STEP (Ctrl+I)">
            <Icon name="import" size={16} /> Import models…
            <kbd>Ctrl+I</kbd>
          </button>
          <button
            role="menuitem"
            onClick={run(() => openDialog('importPresets'))}
            title="Import user presets from a config bundle or a G-code file"
          >
            <Icon name="importPresets" size={16} /> Import presets…
          </button>
          <button
            role="menuitem"
            onClick={run(() => openDialog('library', 'open'))}
            title="Open models, projects and G-code from the server library"
          >
            <Icon name="open" size={16} /> Open from library…
          </button>
          <button
            role="menuitem"
            onClick={run(() => openDialog('library', 'saveProject'))}
            disabled={!objects.length}
            title="Save the plater as a 3MF project in the library"
          >
            <Icon name="save" size={16} /> Save project to library…
          </button>

          <div className="app-menu-sep" role="separator" />
          <div className="app-menu-sub" onMouseEnter={() => setSub('export')}>
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub === 'export'}
              onClick={() => setSub(sub === 'export' ? undefined : 'export')}
              data-testid="menu-export"
            >
              <Icon name="export" size={16} /> Export
              <span className="app-menu-caret" aria-hidden="true">
                ▸
              </span>
            </button>
            {sub === 'export' && (
              <div className="app-menu-flyout" role="menu" aria-label="Export">
                <button role="menuitem" onClick={run(exportProject)} disabled={!objects.length}>
                  Export project as 3MF
                </button>
                <button role="menuitem" onClick={run(exportConfig)}>
                  Export current settings (.ini)
                </button>
                <button
                  role="menuitem"
                  onClick={run(exportPresetBundle)}
                  title="All user presets and physical printers as a PrusaSlicer-compatible bundle (no credentials)"
                >
                  Export presets (.ini bundle)
                </button>
                <button
                  role="menuitem"
                  disabled={!job || job.status !== 'done'}
                  onClick={run(() => job && (location.href = api.gcodeUrl(job.id, true)))}
                >
                  Export G-code
                </button>
                <button role="menuitem" onClick={run(() => openDialog('library', 'saveProject'))} disabled={!objects.length}>
                  Save project to library…
                </button>
                <button role="menuitem" disabled={!job || job.status !== 'done'} onClick={run(() => openDialog('library', 'saveGcode'))}>
                  Save G-code to library…
                </button>
              </div>
            )}
          </div>

          <div className="app-menu-sub" onMouseEnter={() => setSub('mode')}>
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub === 'mode'}
              onClick={() => setSub(sub === 'mode' ? undefined : 'mode')}
              title="Settings visibility in the Print / Filament / Printer tabs"
              data-testid="menu-mode"
            >
              <Icon name="settings" size={16} /> Mode: {MODES.find((m) => m.id === mode)?.label}
              <span className="app-menu-caret" aria-hidden="true">
                ▸
              </span>
            </button>
            {sub === 'mode' && (
              <div className="app-menu-flyout" role="menu" aria-label="Mode">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    role="menuitemradio"
                    aria-checked={mode === m.id}
                    className={mode === m.id ? 'checked' : undefined}
                    onClick={run(() => setMode(m.id))}
                  >
                    <span className="app-menu-check" aria-hidden="true">
                      {mode === m.id ? '✓' : ''}
                    </span>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="app-menu-sep" role="separator" />
          <button role="menuitem" onClick={run(() => openDialog('physicalPrinters'))} title="Physical printers (print hosts)">
            <Icon name="printers" size={16} /> Printers…
          </button>
          <button role="menuitem" onClick={run(() => openDialog('about'))}>
            <Icon name="about" size={16} /> About
          </button>
        </div>
      )}
    </div>
  );
}
