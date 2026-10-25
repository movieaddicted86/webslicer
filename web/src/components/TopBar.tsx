import { useStore } from '../state/store';
import { AppMenu } from './AppMenu';
import { UpdateChip } from './UpdateChip';
import { Icon } from '../icons/Icon';
import { useLeftColumn } from './left/useLeftColumn';
import { VIEW_SWITCH_ENTRIES } from '../nav/navMap';
import './TopBar.css';

/**
 * The 48 px top bar of the visual pass. Everything the wide bar carried as one button per action has
 * moved: the actions into the `Menu` dropdown (`AppMenu`), Library/Printers/About onto the rail. What
 * stays is what a user reaches constantly and without a second click – undo/redo, the hide-panels
 * toggle, the project name with its unsaved state – and the Prepare | Preview switch, centred in the
 * bar as the mockup shows it. The update notice keeps the bar's right edge, where the mockup draws it;
 * the About dialog carries the same notice as a row.
 *
 * The switch is a radiogroup rendered from the navigation map (`VIEW_SWITCH_ENTRIES`), so the bar keeps
 * the one home of the two views; the tool strip below carries the tools only. The settings views never
 * were tabs – they open from the menu's Settings flyout and from the button in their preset row.
 *
 * On a phone the object list is a drawer instead of a card, so the bar carries the button that opens
 * it; on a wider window the card's own chevron does that job.
 */
export function TopBar() {
  const view = useStore((s) => s.view);
  const objects = useStore((s) => s.objects);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const togglePanels = useStore((s) => s.togglePanels);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const setView = useStore((s) => s.setView);
  const autosaveState = useStore((s) => s.autosaveState);
  const { phone, hidden: drawerHidden, toggle: toggleObjects } = useLeftColumn();

  // the settings views are a page without side panels: there is nothing for the toggle to hide
  const hideable = view === 'plater' || view === 'preview';
  const settings = view === 'print' || view === 'filament' || view === 'printer';

  // The app has no project name yet (one plater per session); the first object names it as well as
  // anything can, and the bar says "Untitled" while the plater is empty.
  const projectName = objects[0]?.name.replace(/\.[^.]+$/, '') || 'Untitled';
  // the "unsaved" word follows the autosave: a clean plater has nothing pending, a failed save says so
  const unsaved = autosaveState === 'saving' ? 'saving…' : autosaveState === 'error' ? 'not saved' : objects.length ? 'saved' : 'unsaved';

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
          <Icon name="objects" size={18} />
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
          <Icon name="undo" size={18} />
        </button>
        <button
          className="topbar-icon"
          title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
          aria-label="Redo"
          onClick={redo}
          disabled={!canRedo}
          data-testid="redo-button"
        >
          <Icon name="redo" size={18} />
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
          <Icon name="hidePanels" size={18} />
        </button>
      </div>
      {!settings && (
        <span className="project-name" title="The project on the plater">
          <b>{projectName}</b> · <span className="project-state">{unsaved}</span>
        </span>
      )}
      {!settings && (
        <div
          className="view-switch"
          role="radiogroup"
          aria-label="View"
          data-testid="view-switch"
          onKeyDown={(event) => {
            // a radiogroup answers the arrow keys: they move the choice, not only the focus
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = view === 'plater' ? 'preview' : 'plater';
            setView(next);
            event.currentTarget.querySelector<HTMLElement>(`[data-nav-id="view${next === 'plater' ? 'Plater' : 'Preview'}"]`)?.focus();
          }}
        >
          {VIEW_SWITCH_ENTRIES.map((entry) => {
            const target = entry.action.kind === 'view' ? entry.action.view : 'plater';
            const checked = view === target;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={entry.label}
                title={`${entry.label} view`}
                tabIndex={checked ? 0 : -1}
                className={checked ? 'on' : ''}
                onClick={() => setView(target)}
                data-testid={entry.testId}
                data-nav-id={entry.id}
              >
                <Icon name={entry.icon} size={16} />
                <span className="view-switch-label">{entry.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* the server's update answer, as the quiet chip of T-058; it renders nothing while current */}
      <div className="topbar-update">
        <UpdateChip />
      </div>
    </header>
  );
}
