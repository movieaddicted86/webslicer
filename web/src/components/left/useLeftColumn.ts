import { useSyncExternalStore } from 'react';
import { useStore } from '../../state/store';
import { LEFT_COLUMN_COLLAPSED_WIDTH, LEFT_COLUMN_OPEN_MIN_WINDOW } from '../../state/slices/layout';

/**
 * A CSS media query as React state (layout 3.0): the left column follows the window width, and the
 * answer is needed while the frame renders the grid. `matchMedia` is read through
 * `useSyncExternalStore`, so the first render already has the right value and a resize re-renders
 * without a one-frame flash. The server snapshot is `false`; the app is client-only.
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

/** The window width below which the left column starts folded (the same number as in the design). */
const NARROW_QUERY = `(max-width: ${LEFT_COLUMN_OPEN_MIN_WINDOW - 1}px)`;
/** The phone width; the column becomes a drawer there. */
export const PHONE_QUERY = '(max-width: 639px)';

/**
 * The state of the left column in one place: the frame needs its width for the grid track, the column
 * needs to know how it is shown. The user's fold choice wins; without one the column is open on a wide
 * window and folded below `LEFT_COLUMN_OPEN_MIN_WINDOW`. On a phone it is a drawer instead of a grid
 * track: it takes no width and is only mounted while the top bar's toggle opened it.
 */
export function useLeftColumn() {
  const choice = useStore((s) => s.leftCollapsed);
  const width = useStore((s) => s.leftWidth);
  const drawerOpen = useStore((s) => s.leftDrawerOpen);
  const setCollapsed = useStore((s) => s.setLeftCollapsed);
  const setDrawerOpen = useStore((s) => s.setLeftDrawerOpen);
  const phone = useMediaQuery(PHONE_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const folded = !phone && (choice ?? narrow);

  return {
    phone,
    /** a phone with the drawer closed shows nothing of the column */
    hidden: phone && !drawerOpen,
    folded,
    width,
    /** the width the column takes in the grid; a phone draws it over the scene instead */
    track: phone ? 0 : folded ? LEFT_COLUMN_COLLAPSED_WIDTH : width,
    toggle: () => (phone ? setDrawerOpen(!drawerOpen) : setCollapsed(!folded)),
    closeDrawer: () => setDrawerOpen(false),
  };
}
