import { useStore, type View } from '../state/store';
import { AppMenu } from './AppMenu';
import { Icon } from '../icons/Icon';
import { useLeftColumn } from './left/useLeftColumn';
import './TopBar.css';

/**
 * The slim top bar of the 3.0 layout (L-1). Everything the wide bar carried as one button per action
 * has moved: the actions into the `Menu` dropdown (`AppMenu`), Library/Printers/About onto the rail,
 * the update notice onto the rail's About item. What stays is what a user reaches constantly and
 * without a second click – undo/redo, the hide-panels toggle, the project name and the view tabs – so
 * the bar is one 46 px row at any width.
 *
 * The tabs are the Plater and the Preview only. The three settings views open from the cog in their
 * preset row (as in PrusaSlicer), so the bar no longer carries them; the tabs move into the tool strip
 * of the next layout step.
 *
 * On a phone the object list is a drawer instead of a column, so the bar carries the button that
 * opens it; on a wide window the column's own chevron does that job.
 */
export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const objects = useStore((s) => s.objects);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const togglePanels = useStore((s) => s.togglePanels);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const { phone, hidden: drawerHidden, toggle: toggleObjects } = useLeftColumn();

  // the settings views are not tabs: their one door is the cog in the preset row (the Plater and the
  // Preview keep theirs until the tool strip takes them)
  const tabs: Array<{ id: View; label: string }> = [
    { id: 'plater', label: 'Plater' },
    { id: 'preview', label: 'Preview' },
  ];
  // the settings views are a page without side panels: there is nothing for the toggle to hide
  const hideable = view === 'plater' || view === 'preview';
  const settings = view === 'print' || view === 'filament' || view === 'printer';

  // The app has no project name yet (one plater per session); the first object names it as well as
  // anything can, and the bar says "Untitled" while the plater is empty.
  const projectName = objects[0]?.name.replace(/\.[^.]+$/, '') || 'Untitled';

  return (
    <header className="topbar" data-testid="top-bar">
      <AppMenu />
      {phone && !settings && (
        <button
          className="topbar-icon"
          title={drawerHidden ? 'Show the object list' : 'Hide the object list'}
          aria-label={drawerHidden ? 'Show the object list' : 'Hide the object list'}
          aria-pressed={!drawerHidden}
          onClick={toggleObjects}
          data-testid="objects-drawer-toggle"
        >
          <Icon name="objects" size={16} />
        </button>
      )}
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
          </button>
        ))}
      </nav>
    </header>
  );
}
