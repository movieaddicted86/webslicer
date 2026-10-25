/**
 * Which content the context panel shows (layout 3.0, step L-3, completed by L-4). The mode is derived
 * from what is open and selected – never stored – so closing a tool or clearing the selection switches
 * the panel back on its own, with no second copy of the state to keep in step.
 *
 * The precedence is the design's: an open tool wins over everything (its controls are the work in
 * progress), then the preview, then a selection, and the plate is the idle mode.
 *
 * Only a tool with a panel can be "open" in this sense: move, rotate and scale are modes of the
 * transform gizmo, and a panel for them would have nothing to show. A tool id of theirs never turns
 * the column into tool mode.
 */
import { toolById, type ToolId } from '../tools/registry';

/** The four modes of the context panel, in precedence order. */
export type ContextMode = 'tool' | 'preview' | 'object' | 'plate';

/** The store fields the mode is read from. A structural type keeps the selector pure and testable. */
export interface ContextModeInput {
  /** the open tool, if any */
  activeTool?: string;
  view: string;
  selectedIds: readonly string[];
  objects: ReadonlyArray<{ id: string }>;
}

/** Whether a tool id names a tool the context panel can show (the registry gives it a panel). */
export function toolHasPanel(id: string | undefined): boolean {
  return !!toolById(id as ToolId | undefined)?.panel;
}

/**
 * The mode of the context panel: tool > preview > object > plate. A selection only counts while it
 * names an object that is still on the plater, so a removal cannot leave the panel in object mode.
 */
export function contextMode({ activeTool, view, selectedIds, objects }: ContextModeInput): ContextMode {
  if (activeTool && toolHasPanel(activeTool)) return 'tool';
  if (view === 'preview') return 'preview';
  return objects.some((o) => selectedIds.includes(o.id)) ? 'object' : 'plate';
}
