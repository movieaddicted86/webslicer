/**
 * The keyboard shortcuts of the viewer in one table: the key handler matches against it and the About
 * dialog renders its shortcut line from it, so the two cannot drift apart (CONVENTIONS.md §4 asks for
 * exactly that – a new shortcut used to have to be added in `Viewer.tsx` *and* in `Dialogs.tsx`).
 *
 * The order of `SHORTCUTS` is the handler's order and is significant: the chain is an `else if`, so
 * `Ctrl+A` reaches `selectAll` before the plain `A` branch, while `Cmd+A` (no `ctrlKey`) falls through
 * to `arrange` – both as before.
 */
import { viewByKey } from '../../plater/camera';

/**
 * The Ctrl/Cmd guard a branch of the original handler carried. It was not uniform, so the four
 * spellings are kept apart instead of normalised into one rule.
 */
type CtrlGuard =
  /** `!e.ctrlKey && !e.metaKey` – the camera keys */
  | 'no-mod'
  /** `e.ctrlKey || e.metaKey` – undo/redo */
  | 'ctrl-or-meta'
  /** `e.ctrlKey` – select all */
  | 'ctrl'
  /** `!e.ctrlKey`, `metaKey` not looked at – the plain `A` branch that `Cmd+A` falls through to */
  | 'no-ctrl';

interface Shortcut {
  id: string;
  /** the keys as they read in the UI; two entries with `range` are the ends of a range (`0`…`6`) */
  keys: string[];
  /** `KeyboardEvent.key` values that trigger it (the handler accepted both cases, e.g. `M` and `m`) */
  match?: string[];
  /** `KeyboardEvent.code` values for keys whose `key` is layout-dependent (the numpad) */
  codes?: string[];
  /** the keys read as a range rather than as one combination */
  range?: boolean;
  /** the Ctrl/Cmd guard of that branch; `undefined` means the branch did not look at Ctrl */
  ctrl?: CtrlGuard;
  /** when set, `Shift` must have exactly this state; `undefined` leaves it unconstrained */
  shift?: boolean;
  /** one-line description, PrusaSlicer wording */
  label: string;
  /** position in the About dialog's shortcut line, or `undefined` when the dialog does not list it */
  aboutAt?: number;
}

/** Every shortcut, in the order the handler tests them. */
export const SHORTCUTS: Shortcut[] = [
  { id: 'views', keys: ['0', '6'], range: true, ctrl: 'no-mod', label: 'views', aboutAt: 9 },
  { id: 'projection', keys: ['K'], match: ['k', 'K'], ctrl: 'no-mod', label: 'perspective/ortho', aboutAt: 10 },
  { id: 'zoom', keys: ['Z'], match: ['z', 'Z'], ctrl: 'no-mod', label: 'zoom to selection', aboutAt: 11 },
  { id: 'delete', keys: ['Del'], match: ['Delete', 'Backspace'], label: 'delete', aboutAt: 7 },
  { id: 'addInstance', keys: ['+'], match: ['+', '='], codes: ['NumpadAdd'], label: 'add instance', aboutAt: 5 },
  { id: 'removeInstance', keys: ['−'], match: ['-', '_'], codes: ['NumpadSubtract'], label: 'remove instance', aboutAt: 6 },
  { id: 'paintSupports', keys: ['L'], match: ['l', 'L'], label: 'paint supports' },
  { id: 'paintSeam', keys: ['P'], match: ['p', 'P'], label: 'paint seam' },
  { id: 'placeOnFace', keys: ['F'], match: ['f', 'F'], label: 'place on face' },
  { id: 'rename', keys: ['F2'], match: ['F2'], label: 'rename' },
  { id: 'move', keys: ['M'], match: ['m', 'M'], label: 'move', aboutAt: 1 },
  { id: 'rotate', keys: ['R'], match: ['r', 'R'], label: 'rotate', aboutAt: 2 },
  { id: 'scale', keys: ['S'], match: ['s', 'S'], label: 'scale', aboutAt: 3 },
  { id: 'undo', keys: ['Ctrl', 'Z'], match: ['z', 'Z'], ctrl: 'ctrl-or-meta', shift: false, label: 'undo' },
  { id: 'redo', keys: ['Ctrl', 'Shift', 'Z'], match: ['z', 'Z'], ctrl: 'ctrl-or-meta', shift: true, label: 'redo' },
  { id: 'redo', keys: ['Ctrl', 'Y'], match: ['y', 'Y'], ctrl: 'ctrl-or-meta', label: 'redo' },
  { id: 'selectAll', keys: ['Ctrl', 'A'], match: ['a'], ctrl: 'ctrl', label: 'select all', aboutAt: 8 },
  { id: 'arrange', keys: ['A'], match: ['a', 'A'], ctrl: 'no-ctrl', label: 'arrange', aboutAt: 4 },
  { id: 'escape', keys: ['Esc'], match: ['Escape'], label: 'cancel' },
];

/**
 * The one guard every shortcut runs through (B10). A modal dialog owns the keyboard while it is
 * open, and a focused input/textarea/select/contenteditable keeps its keys – otherwise typing a
 * preset name in the save dialog would delete the selected object behind it. It lives here, next to
 * the table, so a new shortcut cannot forget it.
 */
export function shortcutsBlocked(e: KeyboardEvent, dialogOpen: boolean): boolean {
  if (dialogOpen) return true;
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !!t.isContentEditable);
}

/** The entries the About dialog lists, in the order it prints them. */
export const aboutShortcuts = (): Shortcut[] =>
  SHORTCUTS.filter((s) => s.aboutAt !== undefined).sort((a, b) => (a.aboutAt as number) - (b.aboutAt as number));

/**
 * True when `e` presses one of the keys of `id`. An id may appear more than once (the two spellings of
 * redo), so any matching entry counts.
 */
export function matchesShortcut(e: KeyboardEvent, id: string): boolean {
  return SHORTCUTS.some((s) => {
    if (s.id !== id) return false;
    if (!ctrlHolds(s.ctrl, e)) return false;
    if (s.shift !== undefined && s.shift !== e.shiftKey) return false;
    if (s.range) return !!viewByKey(e.key);
    return (!!s.match && s.match.includes(e.key)) || (!!s.codes && s.codes.includes(e.code));
  });
}

function ctrlHolds(guard: CtrlGuard | undefined, e: KeyboardEvent): boolean {
  switch (guard) {
    case 'no-mod':
      return !e.ctrlKey && !e.metaKey;
    case 'ctrl-or-meta':
      return e.ctrlKey || e.metaKey;
    case 'ctrl':
      return e.ctrlKey;
    case 'no-ctrl':
      return !e.ctrlKey;
    default:
      return true;
  }
}
