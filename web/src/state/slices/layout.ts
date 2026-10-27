/**
 * The layout slice (layout 3.0): the bit of shell state the app needs – whether the side panels are
 * shown, the width and collapse state of the left column (the object list) and which of its cards
 * the user folded away.
 *
 * The choices are remembered per browser. `localStorage` may be unavailable (private window, blocked
 * storage), so every access is wrapped: the defaults are back after a reload.
 */
import type { StateCreator } from 'zustand';
import type { State } from '../types';

/** Where the hide-panels choice is remembered. */
const PANELS_KEY = 'webslicer.panelsHidden';
/** The user's width of the left column in px. */
const LEFT_WIDTH_KEY = 'webslicer.leftWidth';
/** The user's fold/unfold choice of the left column; absent means "follow the window width". */
const LEFT_COLLAPSED_KEY = 'webslicer.leftCollapsed';
/** The folded cards of the left column, as a JSON object of `card key → true`. */
const LEFT_CARDS_KEY = 'webslicer.leftCards';

/** The left card's default and allowed width: the mockup's 276 px, draggable between 220 and 420. */
export const LEFT_COLUMN_DEFAULT_WIDTH = 276;
export const LEFT_COLUMN_MIN_WIDTH = 220;
export const LEFT_COLUMN_MAX_WIDTH = 420;
/** The width of the folded card: its header row with the title, the count and the chevron. */
export const LEFT_COLUMN_COLLAPSED_WIDTH = 148;
/** From this window width on the card is open unless the user says otherwise. */
export const LEFT_COLUMN_OPEN_MIN_WINDOW = 1280;

const clampWidth = (value: number): number =>
  Number.isFinite(value) ? Math.min(LEFT_COLUMN_MAX_WIDTH, Math.max(LEFT_COLUMN_MIN_WIDTH, Math.round(value))) : LEFT_COLUMN_DEFAULT_WIDTH;

/** The stored folded cards, or `{}` for anything that is not a plain object of booleans. */
export function parseLeftCards(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')) as Record<
      string,
      boolean
    >;
  } catch {
    return {};
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: the choice works for this page, it just does not survive the reload */
  }
}

function loadLeftCollapsed(): boolean | undefined {
  const stored = read(LEFT_COLLAPSED_KEY);
  return stored === 'on' ? true : stored === 'off' ? false : undefined;
}

function loadCards(): Record<string, boolean> {
  return parseLeftCards(read(LEFT_CARDS_KEY));
}

/**
 * The three positions of the phone's context sheet (Layout-3.0 §4): `peek` leaves the Slice footer
 * visible alone, `half` shows the upper part of the card, `full` the whole card. The sheet starts at
 * `peek`: the plate and its model keep the scene, and the Slice button is in the footer's line; one
 * tap on the handle brings the presets and the settings up.
 */
export type SheetState = 'peek' | 'half' | 'full';

/** The order a tap on the drag handle walks: full when it was at peek or half, back to peek from full. */
export function nextSheetState(state: SheetState): SheetState {
  return state === 'full' ? 'peek' : state === 'peek' ? 'half' : 'full';
}

export interface LayoutSlice {
  /** true hides the side panels so the 3D view fills the window; visible by default */
  panelsHidden: boolean;
  setPanelsHidden: (hidden: boolean) => void;
  togglePanels: () => void;
  /** the width of the open left column in px, kept between 220 and 420 */
  leftWidth: number;
  setLeftWidth: (width: number) => void;
  /** the user's fold choice of the left column; `undefined` follows the window width */
  leftCollapsed?: boolean;
  setLeftCollapsed: (collapsed: boolean) => void;
  /** the folded cards of the left column, keyed by card (`objects`, `slicedInfo`, `legend`) */
  leftCards: Record<string, boolean>;
  toggleLeftCard: (key: string) => void;
  /** the phone drawer: open only while asked for, never persisted */
  leftDrawerOpen: boolean;
  toggleLeftDrawer: () => void;
  setLeftDrawerOpen: (open: boolean) => void;
  /**
   * How far the phone's context sheet is pulled up: `peek` shows the Slice footer alone, `half` the
   * card's upper half, `full` the whole card. A session choice, not stored.
   */
  sheetState: SheetState;
  setSheetState: (state: SheetState) => void;
  /** forget every stored layout choice and return to the defaults (the Preferences dialog) */
  resetLayout: () => void;
}

export const createLayoutSlice: StateCreator<State, [], [], LayoutSlice> = (set, get) => ({
  panelsHidden: read(PANELS_KEY) === 'on',
  setPanelsHidden: (hidden) => {
    set({ panelsHidden: hidden });
    write(PANELS_KEY, hidden ? 'on' : 'off');
  },
  togglePanels: () => get().setPanelsHidden(!get().panelsHidden),
  leftWidth: clampWidth(Number(read(LEFT_WIDTH_KEY)) || LEFT_COLUMN_DEFAULT_WIDTH),
  setLeftWidth: (width) => {
    const next = clampWidth(width);
    set({ leftWidth: next });
    write(LEFT_WIDTH_KEY, String(next));
  },
  leftCollapsed: loadLeftCollapsed(),
  setLeftCollapsed: (collapsed) => {
    set({ leftCollapsed: collapsed });
    write(LEFT_COLLAPSED_KEY, collapsed ? 'on' : 'off');
  },
  leftCards: loadCards(),
  toggleLeftCard: (key) => {
    const next = { ...get().leftCards, [key]: !get().leftCards[key] };
    set({ leftCards: next });
    write(LEFT_CARDS_KEY, JSON.stringify(next));
  },
  leftDrawerOpen: false,
  toggleLeftDrawer: () => get().setLeftDrawerOpen(!get().leftDrawerOpen),
  setLeftDrawerOpen: (open) => set({ leftDrawerOpen: open }),
  sheetState: 'peek',
  setSheetState: (state) => set({ sheetState: state }),
  resetLayout: () => {
    // every stored choice goes, so a reload starts like a first visit; the in-memory state follows so
    // the change is visible without one
    for (const key of [PANELS_KEY, LEFT_WIDTH_KEY, LEFT_COLLAPSED_KEY, LEFT_CARDS_KEY]) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* private window: the state resets for this page anyway */
      }
    }
    set({
      panelsHidden: false,
      leftWidth: LEFT_COLUMN_DEFAULT_WIDTH,
      leftCollapsed: undefined,
      leftCards: {},
      leftDrawerOpen: false,
      sheetState: 'peek',
    });
  },
});
