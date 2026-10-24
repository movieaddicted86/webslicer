/**
 * The menu's open/close state machine, kept out of the component so the rules can be tested without a
 * DOM: one submenu open at a time, the pointer leaving an item and its flyout closes it after a short
 * grace, another top-level item takes the submenu immediately, a click never fights the hover, and
 * Escape closes the submenu first and the menu second.
 *
 * Keyboard and touch are the same rules seen through different events: ArrowRight enters a submenu,
 * ArrowLeft and Escape leave it, and a tap opens it until something else is tapped.
 */

/** The submenu an item carries; `undefined` for a plain item. */
export type SubmenuId = string;

export interface MenuState {
  open: boolean;
  /** the one open submenu */
  sub?: SubmenuId;
}

export type MenuEvent =
  | { type: 'toggle' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'hoverItem'; sub?: SubmenuId }
  | { type: 'leave' }
  | { type: 'clickItem'; sub?: SubmenuId }
  | { type: 'escape' }
  | { type: 'arrowRight'; sub?: SubmenuId }
  | { type: 'arrowLeft' };

export const CLOSED: MenuState = { open: false };

/**
 * The next state for an event. Pure, so the unit test can walk every rule of the task without a
 * browser:
 *
 * - `hoverItem` with a submenu opens it at once (the pointer lands on it); without a submenu it closes
 *   the open one – the pointer moved to a plain item.
 * - `leave` is the grace timer that fired: an open submenu closes; the menu itself stays open, because
 *   the pointer may only be crossing the gap between items.
 * - `clickItem` on a submenu keeps it open (hover may already have opened it – no toggle fight); on a
 *   plain item the host runs the action and closes the whole menu.
 * - `escape` closes the submenu first, the menu second.
 */
/** An open menu, with the submenu only when there is one: the shape the test compares against. */
const opened = (sub?: SubmenuId): MenuState => (sub ? { open: true, sub } : { open: true });

export function menuReducer(state: MenuState, event: MenuEvent): MenuState {
  switch (event.type) {
    case 'toggle':
      return state.open ? CLOSED : opened();
    case 'open':
      return opened(state.sub);
    case 'close':
      return CLOSED;
    case 'hoverItem':
      if (!state.open) return state;
      return opened(event.sub);
    case 'leave':
      return state.sub ? opened() : state;
    case 'clickItem':
      return event.sub ? opened(event.sub) : CLOSED;
    case 'escape':
      return state.sub ? opened() : CLOSED;
    case 'arrowRight':
      return event.sub ? opened(event.sub) : state;
    case 'arrowLeft':
      return state.sub ? opened() : state;
  }
}

/** How long the pointer may take to cross from an item into its flyout, in ms. */
export const SUBMENU_GRACE_MS = 150;
