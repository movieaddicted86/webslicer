/**
 * Binds the menu's state machine (`menuState.ts`) to the pointer and keyboard, and owns what the
 * machine cannot hold: the grace timer that lets the pointer travel from an item into its flyout, and
 * the focus that returns to the trigger when the menu closes.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { CLOSED, SUBMENU_GRACE_MS, menuReducer, type MenuState, type SubmenuId } from './menuState';

export interface MenuController {
  state: MenuState;
  /** the trigger: a click opens it, a second click closes it */
  toggle: () => void;
  /** the trigger's arrow keys: open the menu, and keep an open one open (no toggle race) */
  open: () => void;
  /** the pointer landed on a top-level item; `sub` opens that item's flyout at once */
  hoverItem: (sub?: SubmenuId) => void;
  /** the pointer left the panel: everything closes after the grace */
  leavePanel: () => void;
  /** the pointer left a submenu item and its flyout: the flyout closes after the grace */
  leaveSubmenu: () => void;
  /** entering a submenu cancels a pending leave of it */
  enterSubmenu: () => void;
  /** a click on a top-level item; a submenu keeps the menu open, a plain item closes it */
  clickItem: (sub?: SubmenuId) => void;
  /** ArrowRight: enter the item's flyout */
  arrowRight: (sub?: SubmenuId) => void;
  /** ArrowLeft: leave the flyout */
  arrowLeft: () => void;
  /** Escape: the flyout first, the menu second. `true` while there was something to close. */
  escape: () => boolean;
  /** close everything and hand the focus back to the trigger */
  close: (options?: { focus?: boolean }) => void;
  trigger: React.RefObject<HTMLButtonElement | null>;
}

export function useMenuState(): MenuController {
  const [state, dispatch] = useReducer(menuReducer, CLOSED);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearGrace = useCallback(() => {
    if (grace.current !== undefined) clearTimeout(grace.current);
    grace.current = undefined;
  }, []);

  const close = useCallback(
    (options?: { focus?: boolean }) => {
      clearGrace();
      dispatch({ type: 'close' });
      if (options?.focus !== false) trigger.current?.focus();
    },
    [clearGrace],
  );

  const toggle = useCallback(() => {
    clearGrace();
    if (state.open) {
      dispatch({ type: 'close' });
      trigger.current?.focus();
    } else {
      dispatch({ type: 'toggle' });
    }
  }, [clearGrace, state.open]);

  const open = useCallback(() => {
    clearGrace();
    dispatch({ type: 'open' });
  }, [clearGrace]);

  const hoverItem = useCallback(
    (sub?: SubmenuId) => {
      clearGrace();
      dispatch({ type: 'hoverItem', sub });
    },
    [clearGrace],
  );

  const enterSubmenu = useCallback(() => clearGrace(), [clearGrace]);

  /** Both leaves wait for the grace: the pointer may be crossing into the flyout. */
  const leaveAfterGrace = useCallback(
    (event: 'leave' | 'close') => {
      clearGrace();
      grace.current = setTimeout(() => {
        grace.current = undefined;
        dispatch({ type: event });
        if (event === 'close') trigger.current?.focus();
      }, SUBMENU_GRACE_MS);
    },
    [clearGrace],
  );

  const leavePanel = useCallback(() => leaveAfterGrace('close'), [leaveAfterGrace]);
  const leaveSubmenu = useCallback(() => leaveAfterGrace('leave'), [leaveAfterGrace]);

  const clickItem = useCallback(
    (sub?: SubmenuId) => {
      clearGrace();
      // a click on a submenu item never toggles: the hover may have opened it already
      if (!sub) trigger.current?.focus();
      dispatch({ type: 'clickItem', sub });
    },
    [clearGrace],
  );

  const arrowRight = useCallback(
    (sub?: SubmenuId) => {
      clearGrace();
      dispatch({ type: 'arrowRight', sub });
    },
    [clearGrace],
  );

  const arrowLeft = useCallback(() => {
    clearGrace();
    dispatch({ type: 'arrowLeft' });
  }, [clearGrace]);

  const escape = useCallback(() => {
    if (!state.open) return false;
    clearGrace();
    dispatch({ type: 'escape' });
    if (!state.sub) trigger.current?.focus();
    return true;
  }, [clearGrace, state.open, state.sub]);

  useEffect(() => () => clearGrace(), [clearGrace]);

  return useMemo(
    () => ({
      state,
      toggle,
      open,
      hoverItem,
      leavePanel,
      leaveSubmenu,
      enterSubmenu,
      clickItem,
      arrowRight,
      arrowLeft,
      escape,
      close,
      trigger,
    }),
    [state, toggle, open, hoverItem, leavePanel, leaveSubmenu, enterSubmenu, clickItem, arrowRight, arrowLeft, escape, close],
  );
}
