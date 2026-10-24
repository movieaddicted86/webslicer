/**
 * The object commands of the tool strip (layout 3.0, L-4). They act on the selection like the tools
 * do, but they have no panel and no active state; the strip shows them with the same tooltips as the
 * object list used to, including why a disabled one is disabled.
 *
 * The rules and the texts live here, once, so the strip, the object list and the unit tests read the
 * same table. Everything is a pure function of three counts, so a paint stroke (which writes the
 * objects on every sample) does not re-render the strip: the counts stay the same.
 */
import type { State } from '../state/types';
import type { IconName } from '../icons/table';

/** The object commands of the strip. `arrangeSettings` opens the gear's popover. */
export type StripCommand = 'arrange' | 'arrangeSettings' | 'addInstance' | 'removeInstance' | 'deleteSelection';

/** The plain name of a command; the tooltip adds the shortcut. */
export const COMMAND_LABELS: Record<StripCommand, string> = {
  deleteSelection: 'Delete selection',
  addInstance: 'Add instance',
  removeInstance: 'Remove instance',
  arrange: 'Arrange',
  arrangeSettings: 'Arrange settings',
};

/** The shortcut a command answers to, as the UI writes it (the same keys the key handler matches). */
export const COMMAND_KEYS: Record<StripCommand, string> = {
  deleteSelection: 'Del',
  addInstance: '+',
  removeInstance: '−',
  arrange: 'A',
  arrangeSettings: '',
};

/** One function, one icon: the pictures the object list used for the same actions. */
export const COMMAND_ICONS: Record<StripCommand, IconName> = {
  deleteSelection: 'delete',
  addInstance: 'addInstance',
  removeInstance: 'removeInstance',
  arrange: 'arrange',
  arrangeSettings: 'arrangeSettings',
};

/** The counts every rule reads: the selection, its instances and the plate. */
export interface CommandFacts {
  /** how many objects are selected */
  selected: number;
  /** the instances of the one selected object (0 without a selection) */
  instances: number;
  /** the objects on the plate */
  objects: number;
}

/** The counts of a state – what the strip subscribes to, so it does not follow every store write. */
export function commandFacts(state: Pick<State, 'objects' | 'selectedIds'>): CommandFacts {
  const picked = state.objects.filter((o) => state.selectedIds.includes(o.id));
  return {
    selected: picked.length,
    instances: picked.length === 1 ? picked[0].instances.length : 0,
    objects: state.objects.length,
  };
}

/** Whether each command can run right now. */
export function commandDisabled(facts: CommandFacts): Record<StripCommand, boolean> {
  const one = facts.selected === 1;
  return {
    deleteSelection: facts.selected === 0,
    addInstance: !one,
    removeInstance: !one || facts.instances <= 1,
    arrange: facts.objects === 0,
    arrangeSettings: facts.objects === 0,
  };
}

/** Why a command is disabled (`''` when it can run) – the tail of its tooltip. */
export function commandReason(command: StripCommand, facts: CommandFacts): string {
  if (!commandDisabled(facts)[command]) return '';
  if (command === 'arrange' || command === 'arrangeSettings') return 'load an object first';
  if (facts.selected === 0) return 'select an object first';
  // the remaining rules need exactly one object; with several selected none of them can run
  if (facts.selected > 1) return 'select one object';
  return 'the object has one instance';
}

/**
 * The tooltip of a command: its name, the shortcut, and – when it cannot run – the reason why. One
 * function, so the strip, the object list and the tests cannot drift apart.
 */
export function commandTitle(command: StripCommand, facts: CommandFacts): string {
  const key = COMMAND_KEYS[command];
  const base = key ? `${COMMAND_LABELS[command]} (${key})` : COMMAND_LABELS[command];
  const reason = commandReason(command, facts);
  return reason ? `${base}: ${reason}` : base;
}
