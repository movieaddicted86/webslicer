/**
 * The rules of a list selection (the object list and the file library): what a click with Ctrl, Cmd
 * or Shift does, and which group actions a multi-selection allows. Pure functions, so both lists run
 * the same rules and the unit tests can drive every combination without a browser.
 *
 * The lists keep only their *anchor* – the row the last plain or Ctrl click landed on – as local UI
 * state; the selection itself is the store's `selectedIds` (object list) or the dialog's row list.
 * `order` is the visible order of the rows: a Shift range follows what the user sees, never the
 * insertion order of the model.
 */

/** A click with its modifier keys; Cmd counts as Ctrl (the Mac spelling of a toggle). */
export interface ClickMods {
  ctrl: boolean;
  shift: boolean;
}

/** The selection after a click, and the anchor the next Shift click ranges from. */
export interface SelectionResult {
  ids: string[];
  anchor: string;
}

/** The modifier state of a mouse or keyboard event, with Cmd folded into Ctrl. */
export function modsOf(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): ClickMods {
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
}

/**
 * The selection after a click on `clicked`:
 * - plain: only that row;
 * - Ctrl/Cmd: the row is toggled, the rest stays;
 * - Shift: the range from the anchor to the row, both included; without an anchor (or one that left
 *   the list) it behaves like a plain click.
 * The anchor becomes the clicked row for plain and Ctrl clicks and stays for a Shift range, so the
 * next Shift click extends the same range. An id the list no longer shows changes nothing.
 */
export function selectionAfterClick(
  order: readonly string[],
  selected: readonly string[],
  anchor: string | null | undefined,
  clicked: string,
  mods: ClickMods,
): SelectionResult {
  if (!order.includes(clicked)) return { ids: [...selected], anchor: anchor ?? clicked };
  if (mods.shift && anchor && order.includes(anchor)) {
    const from = order.indexOf(anchor);
    const to = order.indexOf(clicked);
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return { ids: order.slice(lo, hi + 1), anchor };
  }
  if (mods.ctrl) {
    return { ids: selected.includes(clicked) ? selected.filter((id) => id !== clicked) : [...selected, clicked], anchor: clicked };
  }
  return { ids: [clicked], anchor: clicked };
}

/** The rows a Shift range covers – the same slice `selectionAfterClick` returns. */
export function rangeBetween(order: readonly string[], anchor: string, clicked: string): string[] {
  return selectionAfterClick(order, [], anchor, clicked, { ctrl: false, shift: true }).ids;
}

/** What the group actions of the object list need to know about the selection. */
export interface MergeRule {
  /** true when the selection can be merged into one object */
  ok: boolean;
  /** why not (`''` when it can) – the tail of the button's tooltip */
  reason: string;
}

/**
 * Merge needs two or more objects with a single instance each: a merge unions the instances of one
 * object with the geometry of the others, and one world position per object is the assumption.
 * The object list's toolbar and the context panel read the same rule, so their tooltips cannot drift.
 */
export function mergeRule(selected: ReadonlyArray<{ instances: readonly unknown[] }>): MergeRule {
  const single = selected.filter((o) => o.instances.length === 1);
  if (selected.length > 1 && single.length === selected.length) return { ok: true, reason: '' };
  return {
    ok: false,
    reason:
      selected.length > 1
        ? 'Only objects with a single instance can be merged'
        : 'Merge: select two or more objects with a single instance',
  };
}

/** Whether every selected object is visible – the state a Hide/Show toggle starts from. */
export function allVisible(selected: ReadonlyArray<{ visible: boolean }>): boolean {
  return selected.length > 0 && selected.every((o) => o.visible);
}

/** The title of the bulk visibility button: hide them all, or bring them all back. */
export function visibilityTitle(selected: ReadonlyArray<{ visible: boolean }>): string {
  return allVisible(selected) ? 'Hide the selected objects' : 'Show the selected objects';
}
