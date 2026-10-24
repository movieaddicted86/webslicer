import { useStore, isModified, type View } from '../state/store';
import { AppMenu } from './AppMenu';
import { Icon } from '../icons/Icon';
import './TopBar.css';

/**
 * The slim top bar of the 3.0 layout (L-1). Everything the wide bar carried as one button per action
 * has moved: the actions into the `Menu` dropdown (`AppMenu`), Library/Printers/About onto the rail,
 * the update notice onto the rail's About item. What stays is what a user reaches constantly and
 * without a second click – undo/redo, the hide-panels toggle, the project name and the view tabs – so
 * the bar is one 46 px row at any width.
 *
 * The tabs are the old ones, unchanged: the Plater and the Preview, then the three settings views (the
 * rail's Preferences opens the same place). A modified preset keeps its dot.
 */
export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const presets = useStore((s) => s.presets);
  const objects = useStore((s) => s.objects);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const togglePanels = useStore((s) => s.togglePanels);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);

  const tabs: Array<{ id: View; label: string; dot?: boolean }> = [
    { id: 'plater', label: 'Plater' },
    { id: 'preview', label: 'Preview' },
    { id: 'print', label: 'Print Settings', dot: isModified(presets.print) },
    { id: 'filament', label: 'Filament Settings', dot: presets.filament.some(isModified) },
    { id: 'printer', label: 'Printer Settings', dot: isModified(presets.printer) },
  ];
  // the settings views are a page without side panels: there is nothing for the toggle to hide
  const hideable = view === 'plater' || view === 'preview';

  // The app has no project name yet (one plater per session); the first object names it as well as
  // anything can, and the bar says "Untitled" while the plater is empty.
  const projectName = objects[0]?.name.replace(/\.[^.]+$/, '') || 'Untitled';

  return (
    <header className="topbar" data-testid="top-bar">
      <AppMenu />
      <div className="topbar-group">
        <button
          className="topbar-icon"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          onClick={undo}
          disabled={!canUndo}
          data-testid="undo-button"
        >
          <Icon name="undo" size={16} />
        </button>
        <button
          className="topbar-icon"
          title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
          aria-label="Redo"
          onClick={redo}
          disabled={!canRedo}
          data-testid="redo-button"
        >
          <Icon name="redo" size={16} />
        </button>
        <button
          className={`topbar-icon ${panelsHidden ? 'active' : ''}`}
          title={panelsHidden ? 'Show the side panels' : 'Hide the side panels – the 3D view fills the window'}
          aria-label={panelsHidden ? 'Show the side panels' : 'Hide the side panels'}
          aria-pressed={panelsHidden}
          onClick={togglePanels}
          disabled={!hideable}
          data-testid="hide-panels"
        >
          <Icon name="hidePanels" size={16} />
        </button>
      </div>
      <span className="project-name" title="The project on the plater">
        {projectName}
      </span>
      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={view === t.id ? 'active' : ''}
            aria-current={view === t.id ? 'page' : undefined}
            onClick={() => setView(t.id)}
          >
            {t.label}
            {t.dot && <span className="dot" title="modified" />}
          </button>
        ))}
      </nav>
    </header>
  );
}
