/**
 * The layout slice (layout 3.0, L-1): the only bit of shell state the app needs today – whether the
 * side panels (the right context column and, from L-2, the left object list) are shown.
 *
 * The choice is remembered per browser. `localStorage` may be unavailable (private window, blocked
 * storage), so every access is wrapped: the panels are simply visible again after a reload.
 */
import type { StateCreator } from 'zustand';
import type { State } from '../types';

/** Where the hide-panels choice is remembered; only this one flag lives here. */
const PANELS_KEY = 'webslicer.panelsHidden';

function loadPanelsHidden(): boolean {
  try {
    return localStorage.getItem(PANELS_KEY) === 'on';
  } catch {
    return false;
  }
}

function savePanelsHidden(hidden: boolean): void {
  try {
    localStorage.setItem(PANELS_KEY, hidden ? 'on' : 'off');
  } catch {
    /* private window: the toggle works for this page, it just does not survive the reload */
  }
}

export interface LayoutSlice {
  /** true hides the side panels so the 3D view fills the window; visible by default */
  panelsHidden: boolean;
  setPanelsHidden: (hidden: boolean) => void;
  togglePanels: () => void;
}

export const createLayoutSlice: StateCreator<State, [], [], LayoutSlice> = (set, get) => ({
  panelsHidden: loadPanelsHidden(),
  setPanelsHidden: (hidden) => {
    set({ panelsHidden: hidden });
    savePanelsHidden(hidden);
  },
  togglePanels: () => get().setPanelsHidden(!get().panelsHidden),
});
