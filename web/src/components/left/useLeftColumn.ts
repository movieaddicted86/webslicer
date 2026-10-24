import { useSyncExternalStore } from 'react';
import { useStore } from '../../state/store';
import { LEFT_COLUMN_OPEN_MIN_WINDOW } from '../../state/slices/layout';

/**
 * A CSS media query as React state (layout 3.0): the cards follow the window width, and the answer is
 * needed while the frame renders. `matchMedia` is read through `useSyncExternalStore`, so the first
 * render already has the right value and a resize re-renders without a one-frame flash. The server
 * snapshot is `false`; the app is client-only.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The window width below which the object list card starts folded (the same number as in the design). */
const NARROW_QUERY = `(max-width: ${LEFT_COLUMN_OPEN_MIN_WINDOW - 1}px)`;
/** The width below which the object list card becomes a drawer over the scene. */
export const PHONE_QUERY = '(max-width: 899px)';

/**
 * The state of the object list card in one place: whether it is folded and how it is shown. The user's
 * fold choice wins; without one the card is open on a wide window and folded below
 * `LEFT_COLUMN_OPEN_MIN_WINDOW`. Below `PHONE_QUERY` it is a drawer instead of a card: it covers the
 * left part of the scene and is only shown while the top bar's toggle opened it.
 */
export function useLeftColumn() {
  const choice = useStore((s) => s.leftCollapsed);
  const drawerOpen = useStore((s) => s.leftDrawerOpen);
  const setCollapsed = useStore((s) => s.setLeftCollapsed);
  const setDrawerOpen = useStore((s) => s.setLeftDrawerOpen);
  const phone = useMediaQuery(PHONE_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const folded = !phone && (choice ?? narrow);

  return {
    phone,
    /** a narrow window with the drawer closed shows nothing of the card */
    hidden: phone && !drawerOpen,
    folded,
    toggle: () => (phone ? setDrawerOpen(!drawerOpen) : setCollapsed(!folded)),
    closeDrawer: () => setDrawerOpen(false),
  };
}
