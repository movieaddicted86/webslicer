import { useSyncExternalStore } from 'react';

/**
 * A CSS media query as React state (layout 3.0): the left column follows the window width, and the
 * decision has to be made in the component that renders the grid. `matchMedia` is read through
 * `useSyncExternalStore`, so the first render already has the right answer and a resize re-renders
 * without a one-frame flash.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // no window during a server render; the app is client-only and the value never leaves the render
    () => false,
  );
}

/** The window widths the layout switches at – the same numbers as `AppShell.css`. */
export const LEFT_COLUMN_COLLAPSE_QUERY = '(max-width: 1099px)';
export const PHONE_QUERY = '(max-width: 639px)';
