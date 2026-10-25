import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { importFiles } from '../importFiles';
import { setImportOpener } from '../importTrigger';
import { Icon } from '../icons/Icon';
import { MENU_ENTRIES, MENU_SUBMENUS, type NavEntry, type NavSubmenu } from '../nav/navMap';
import { runNavAction } from '../nav/actions';
import { useMenuState } from './menu/useMenuState';
import type { SubmenuId } from './menu/menuState';
import './AppMenu.css';

/**
 * The slim top bar's menu (layout 3.0): import models and presets, then two flyouts – Settings and
 * Export – and nothing that has a home elsewhere. The rail owns Library, Printers, Preferences and
 * About; the settings flyout is the stated exception (the three settings views also open from their
 * preset row), rendered from the same `SETTINGS_ENTRIES` table as the rows.
 *
 * Behaviour: one submenu at a time, opened by hover or click; it closes when the pointer leaves the
 * item and the flyout (with a short grace, so the pointer can cross the gap), and another top-level
 * item takes it at once. A click on a submenu keeps it open, a click on an action closes everything.
 * Escape closes the submenu first, the menu second, and the focus goes back to the trigger.
 */
export function AppMenu() {
  const objects = useStore((s) => s.objects);
  const job = useStore((s) => s.job);
  const menu = useMenuState();
  const { state } = menu;
  const root = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** the trigger of each flyout, by submenu id: Escape and ArrowLeft hand the focus back to it */
  const subTriggers = useRef<Record<SubmenuId, HTMLButtonElement | null>>({});
  const flyoutRef = useRef<HTMLDivElement>(null);

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

  // the menu owns the one file input; other hosts (the empty object list) ask for it here
  useEffect(() => {
    setImportOpener(() => fileRef.current?.click());
    return () => setImportOpener(undefined);
  }, []);

  // a click outside closes; the pointer leaving the whole menu starts the grace, which the flyout's
  // own `mouseenter` can still cancel
  useEffect(() => {
    if (!state.open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) menu.close();
    };
    // capture phase: Escape closes the menu and must not also reach the plater (clear the selection)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const hadSubmenu = !!menu.state.sub;
      if (!menu.escape()) return;
      e.stopPropagation();
      // leaving the flyout with Escape puts the focus back on its item, not on the page body
      const sub = menu.state.sub;
      if (hadSubmenu && sub) requestAnimationFrame(() => subTriggers.current[sub]?.focus());
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [state.open, menu]);

  /** Run an entry and close the menu: an open dropdown over its own dialog would cover it. */
  const run = (entry: NavEntry) => async () => {
    menu.close({ focus: false });
    const wantsImport = await runNavAction(entry.action);
    if (wantsImport) fileRef.current?.click();
  };

  /** The export submenu's items and their enabled state: they act on the plate and the last job. */
  const disabled = (entry: NavEntry) =>
    entry.id === 'exportProject' || entry.id === 'saveProjectToLibrary'
      ? !objects.length
      : entry.id === 'exportGcode' || entry.id === 'saveGcodeToLibrary'
        ? !job || job.status !== 'done'
        : false;

  /** A click on a flyout's trigger opens it and keeps it: hover may already have done so. */
  const submenuItem = (sub: NavSubmenu) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    menu.clickItem(sub.id);
  };

  /** Move the focus to the first or last enabled item, after the panel has rendered. */
  const focusEdge = (edge: 'first' | 'last') => {
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
      if (items?.length) (edge === 'first' ? items[0] : items[items.length - 1]).focus();
    });
  };

  /** ArrowDown/ArrowUp on the trigger open the panel (or move into it) – the keyboard's way in. */
  const triggerKeys = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    // `open` and not `toggle`: a click that has just opened the menu must not be undone by the
    // first arrow key before React has re-rendered the trigger's closure
    menu.open();
    focusEdge(e.key === 'ArrowDown' ? 'first' : 'last');
  };

  /** ArrowRight enters the flyout: wait for it to render, then put the focus on its first action. */
  const focusFlyout = () => {
    requestAnimationFrame(() => {
      const first = flyoutRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
      first?.focus();
    });
  };

  /**
   * ArrowUp/ArrowDown walk the panel's items in DOM order, Home/End jump – the same model as a native
   * menu, and the focus stays where Tab or the arrows put it otherwise.
   */
  const panelKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'));
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : e.key === 'ArrowDown'
            ? (at + 1) % items.length
            : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div className="app-menu" ref={root} onMouseLeave={() => (state.open ? menu.leavePanel() : undefined)} data-nav-id="menu">
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
        ref={menu.trigger}
        className={state.open ? 'app-menu-trigger active' : 'app-menu-trigger'}
        title="Menu"
        aria-haspopup="menu"
        aria-expanded={state.open}
        onClick={menu.toggle}
        onKeyDown={triggerKeys}
        data-testid="menu"
      >
        <Icon name="menu" size={18} />
        <span className="app-menu-name">Menu</span>
      </button>

      {state.open && (
        <div
          className="app-menu-panel"
          role="menu"
          aria-label="Main menu"
          data-testid="menu-panel"
          onMouseEnter={menu.enterSubmenu}
          onKeyDown={panelKeys}
        >
          {MENU_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              role="menuitem"
              onClick={() => void run(entry)()}
              onMouseEnter={() => menu.hoverItem()}
              title={entry.id === 'importModels' ? 'Import STL/OBJ/3MF/AMF/STEP (Ctrl+I)' : undefined}
              data-nav-id={entry.id}
            >
              <Icon name={entry.icon} size={16} /> {entry.label}
              {entry.id === 'importModels' && <kbd>Ctrl+I</kbd>}
            </button>
          ))}

          <div className="app-menu-sep" role="separator" />
          {MENU_SUBMENUS.map((sub) => (
            <div className="app-menu-sub" key={sub.id} onMouseEnter={() => menu.hoverItem(sub.id)} onMouseLeave={() => menu.leaveSubmenu()}>
              <button
                ref={(el) => {
                  subTriggers.current[sub.id] = el;
                }}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={state.sub === sub.id}
                onClick={submenuItem(sub)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    menu.arrowRight(sub.id);
                    focusFlyout();
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    menu.arrowLeft();
                  }
                }}
                data-testid={sub.testId}
                data-nav-id={sub.id}
              >
                <Icon name={sub.icon} size={16} /> {sub.label}
                <span className="app-menu-caret" aria-hidden="true">
                  ▸
                </span>
              </button>
              {state.sub === sub.id && (
                <div
                  ref={flyoutRef}
                  className="app-menu-flyout"
                  role="menu"
                  aria-label={sub.ariaLabel}
                  onMouseEnter={menu.enterSubmenu}
                  onKeyDown={(e) => {
                    // ArrowLeft leaves the flyout and hands the focus back to its item
                    if (e.key !== 'ArrowLeft') return;
                    e.preventDefault();
                    e.stopPropagation();
                    menu.arrowLeft();
                    requestAnimationFrame(() => subTriggers.current[sub.id]?.focus());
                  }}
                >
                  {sub.items.map((entry) => (
                    <button
                      key={entry.id}
                      role="menuitem"
                      disabled={disabled(entry)}
                      onClick={() => void run(entry)()}
                      data-nav-id={entry.id}
                    >
                      <Icon name={entry.icon} size={16} /> {entry.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
