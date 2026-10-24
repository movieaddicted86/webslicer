/**
 * Which content the context panel shows (layout 3.0, step L-3). The mode is derived from what is
 * open and selected – never stored – so closing a tool or clearing the selection switches the panel
 * back on its own, with no second copy of the state to keep in step.
 *
 * The precedence is the design's: an open tool wins over everything (its controls are the work in
 * progress), then the preview, then a selection, and the plate is the idle mode.
 */

/** The four modes of the context panel, in precedence order. */
export type ContextMode = 'tool' | 'preview' | 'object' | 'plate';

/** The store fields the mode is read from. A structural type keeps the selector pure and testable. */
export interface ContextModeInput {
  /** the open tool panel, if any */
  activeTool?: string;
  view: string;
  selectedIds: readonly string[];
  objects: ReadonlyArray<{ id: string }>;
}

/**
 * The mode of the context panel: tool > preview > object > plate. A selection only counts while it
 * names an object that is still on the plater, so a removal cannot leave the panel in object mode.
 */
export function contextMode({ activeTool, view, selectedIds, objects }: ContextModeInput): ContextMode {
  if (activeTool) return 'tool';
  if (view === 'preview') return 'preview';
  return objects.some((o) => selectedIds.includes(o.id)) ? 'object' : 'plate';
}

/**
 * The mode the panel renders while tool mode has no panel of its own yet (the tool dock is still next
 * to the bar until the tool strip step): the same selection rule, without the tool.
 */
export function baseMode(input: ContextModeInput): 'preview' | 'object' | 'plate' {
  // the tool is the only mode the panel cannot render yet, so it is read as if no tool were open
  const mode = contextMode({ ...input, activeTool: undefined });
  if (mode === 'preview') return 'preview';
  return mode === 'object' ? 'object' : 'plate';
}
