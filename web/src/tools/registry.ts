/**
 * The tool registry (T-046): one definition per tool of the plater. The left tool bar, the keyboard
 * shortcut table (`three/viewer/shortcuts.ts`) and the About dialog derive everything from this list,
 * so a new tool is one entry here – no component, shortcut or help line has to be edited.
 *
 * A definition carries its icon, its group, its shortcut, its availability and the panel it opens.
 * Entering/leaving goes through the tools slice (`activateTool`/`exitTool`), which calls `onEnter`/
 * `onExit` with the store, so this module stays free of store code and can be unit tested.
 */
import type { State } from '../state/types';
import type { IconName } from '../icons/table';
import { defaultCutSettings } from '../plater/cut';

export type ToolId = 'move' | 'rotate' | 'scale' | 'placeOnFace' | 'cut' | 'paintSupports' | 'paintSeam' | 'paintMmu' | 'layerHeight';

/** The panels the context panel renders in tool mode; the kind names the component in `components/tools/panels/`. */
export type ToolPanelKind = 'cut' | 'paint' | 'placeOnFace' | 'layerHeight';

/** The groups of the tool strip, left to right (PrusaSlicer's order: transform, paint, cut, layers). */
export type ToolGroup = 'transform' | 'paint' | 'cut' | 'layer';

/** The mouse button or gesture a hint names; it picks the icon from the table (`mouse_left`, …). */
export type HintMouse = 'left' | 'right' | 'wheel' | 'drag';

/**
 * One row of a tool's key-hint block (I-3): what the user can do inside the open tool, written from
 * the behaviour that actually exists in the gizmo/painting code. Rendered by `ToolHints`.
 */
export interface ToolHint {
  /** key chips in front of the mouse, e.g. `['Shift']` for Shift + left */
  keys?: string[];
  mouse?: HintMouse;
  /** one line: the effect of the interaction */
  text: string;
}

/** Whether a tool can be used right now; `reason` becomes the disabled button's tooltip. */
export interface ToolAvailability {
  ok: boolean;
  reason?: string;
}

/** The key that opens a tool, in the form the shortcut table matches. */
export interface ToolShortcut {
  /** the keys as they read in the UI (`['Ctrl', 'C']`); the tooltip shows the last one */
  keys: string[];
  /** `KeyboardEvent.key` values */
  match: string[];
  /** `!e.ctrlKey && !e.metaKey`, for keys that must not collide with browser shortcuts */
  noMod?: boolean;
}

/** What `onEnter`/`onExit` get: the store as it is at that moment. */
export interface ToolContext {
  state: State;
}

export interface ToolDefinition {
  id: ToolId;
  /** the name of the tool panel and of its bar button */
  title: string;
  /** the short name the bar shows next to the icon when labels are on (T-055) */
  label: string;
  icon: IconName;
  group: ToolGroup;
  /** the panel the context panel shows in tool mode; absent for the transform tools (gizmo only) */
  panel?: ToolPanelKind;
  /** the rows of the key-hint block at the end of the tool's panel (I-3) */
  hints?: ToolHint[];
  shortcut?: ToolShortcut;
  /** position in the About dialog's shortcut line; without it the tool is not listed there */
  aboutAt?: number;
  /** whether the tool can be used; the reason is shown as the tooltip of a disabled button */
  isAvailable: (state: State) => ToolAvailability;
  /** called when the tool opens (after availability passed, before it counts as active) */
  onEnter?: (ctx: ToolContext) => void;
  /** called when another tool opens or the tool is closed */
  onExit?: (ctx: ToolContext) => void;
}

/** The single selected object, for the tools that work on one. */
function oneSelected(state: State) {
  return state.selectedIds.length === 1 ? state.objects.find((o) => o.id === state.selectedIds[0]) : undefined;
}

/** The availability of a tool that needs exactly one selected object. */
function needsOneObject(state: State): ToolAvailability {
  return oneSelected(state) ? { ok: true } : { ok: false, reason: 'Select one object' };
}

/** The availability of a transform tool: nothing selected, nothing to move. */
function needsObjects(state: State): ToolAvailability {
  return state.objects.length ? { ok: true } : { ok: false, reason: 'Load an object first' };
}

/** The groups of the strip, in the order it shows them. */
export const TOOL_GROUPS: ToolGroup[] = ['transform', 'paint', 'cut', 'layer'];

/** Every tool, in the order the strip shows them. */
export const TOOLS: ToolDefinition[] = [
  {
    id: 'move',
    label: 'Move',
    title: 'Move',
    icon: 'move',
    group: 'transform',
    shortcut: { keys: ['M'], match: ['m', 'M'] },
    aboutAt: 1,
    isAvailable: needsObjects,
    onEnter: ({ state }) => state.setTransformMode('translate'),
  },
  {
    id: 'rotate',
    label: 'Rotate',
    title: 'Rotate',
    icon: 'rotate',
    group: 'transform',
    shortcut: { keys: ['R'], match: ['r', 'R'] },
    aboutAt: 2,
    isAvailable: needsObjects,
    onEnter: ({ state }) => state.setTransformMode('rotate'),
  },
  {
    id: 'scale',
    label: 'Scale',
    title: 'Scale',
    icon: 'scale',
    group: 'transform',
    shortcut: { keys: ['S'], match: ['s', 'S'] },
    aboutAt: 3,
    isAvailable: needsObjects,
    onEnter: ({ state }) => state.setTransformMode('scale'),
  },
  {
    id: 'placeOnFace',
    label: 'Place on face',
    title: 'Place on face',
    icon: 'placeOnFace',
    group: 'transform',
    panel: 'placeOnFace',
    shortcut: { keys: ['F'], match: ['f', 'F'] },
    aboutAt: 14,
    isAvailable: needsObjects,
    hints: [
      { mouse: 'left', text: 'Click the face that should lie flat on the bed' },
      { keys: ['Esc'], text: 'Leave the tool' },
    ],
  },
  {
    id: 'cut',
    label: 'Cut',
    title: 'Cut',
    icon: 'cut',
    group: 'cut',
    panel: 'cut',
    shortcut: { keys: ['C'], match: ['c', 'C'], noMod: true },
    aboutAt: 13,
    isAvailable: (s) => {
      const o = oneSelected(s);
      if (!o) return { ok: false, reason: 'Select one object' };
      return o.volumes.length ? { ok: false, reason: 'Remove modifiers and parts first' } : { ok: true };
    },
    onEnter: ({ state }) => {
      const o = oneSelected(state);
      if (o) state.setCutSettings(defaultCutSettings(o.size[2]));
    },
    hints: [
      { mouse: 'left', text: 'Turn the object in the 3D view; the plane follows the sliders' },
      { mouse: 'wheel', text: 'Zoom in or out of the object' },
      { keys: ['Esc'], text: 'Leave the tool without cutting' },
    ],
  },
  {
    id: 'paintSupports',
    label: 'Paint supports',
    title: 'Paint supports',
    icon: 'paintSupports',
    group: 'paint',
    panel: 'paint',
    shortcut: { keys: ['L'], match: ['l', 'L'] },
    aboutAt: 15,
    isAvailable: needsOneObject,
    onEnter: ({ state }) => {
      const o = oneSelected(state);
      if (o) void state.startPaint(o.id, 'supports');
    },
    // the brush is the left button, a right drag paints a blocker any time, Shift+left erases
    hints: [
      { mouse: 'left', text: 'Paint with the selected brush tool' },
      { mouse: 'right', text: 'Paint a blocker (any time)' },
      { keys: ['Shift'], mouse: 'left', text: 'Erase the paint' },
      { keys: ['Esc'], text: 'Finish painting' },
    ],
  },
  {
    id: 'paintSeam',
    label: 'Paint seam',
    title: 'Paint seam',
    icon: 'paintSeam',
    group: 'paint',
    panel: 'paint',
    shortcut: { keys: ['P'], match: ['p', 'P'] },
    aboutAt: 16,
    isAvailable: needsOneObject,
    onEnter: ({ state }) => {
      const o = oneSelected(state);
      if (o) void state.startPaint(o.id, 'seam');
    },
    hints: [
      { mouse: 'left', text: 'Paint an enforcer: the seam is pulled here' },
      { mouse: 'right', text: 'Paint a blocker: the seam avoids this area' },
      { keys: ['Shift'], mouse: 'left', text: 'Erase the paint' },
      { keys: ['Esc'], text: 'Finish painting' },
    ],
  },
  {
    id: 'paintMmu',
    label: 'Paint extruder',
    title: 'Paint extruder',
    icon: 'paintMmu',
    group: 'paint',
    panel: 'paint',
    isAvailable: (s) => {
      const one = needsOneObject(s);
      if (!one.ok) return one;
      return s.extruderCount() > 1 ? { ok: true } : { ok: false, reason: 'Needs a multi-extruder printer' };
    },
    onEnter: ({ state }) => {
      const o = oneSelected(state);
      if (o) void state.startPaint(o.id, 'mmu');
    },
    hints: [
      { mouse: 'left', text: 'Paint with the selected extruder' },
      { mouse: 'right', text: 'Reset to the object extruder' },
      { keys: ['Shift'], mouse: 'left', text: 'Reset to the object extruder' },
      { keys: ['Esc'], text: 'Finish painting' },
    ],
  },
  {
    id: 'layerHeight',
    label: 'Layer height',
    title: 'Variable layer height',
    icon: 'layerHeight',
    group: 'layer',
    panel: 'layerHeight',
    shortcut: { keys: ['V'], match: ['v', 'V'] },
    aboutAt: 17,
    isAvailable: needsOneObject,
    hints: [
      { mouse: 'drag', text: 'Drag in the chart to raise or lower the layer height' },
      { keys: ['Esc'], text: 'Leave the tool' },
    ],
  },
];

/** The definition of one tool id. */
export function toolById(id: ToolId | undefined): ToolDefinition | undefined {
  return id ? TOOLS.find((t) => t.id === id) : undefined;
}

/** The tool whose shortcut `e` presses. */
export function toolForShortcut(e: KeyboardEvent, tools: ToolDefinition[] = TOOLS): ToolDefinition | undefined {
  return tools.find((t) => {
    const s = t.shortcut;
    if (!s) return false;
    if (s.noMod && (e.ctrlKey || e.metaKey)) return false;
    return s.match.includes(e.key);
  });
}

/** One entry of the shortcut table, built from a tool definition. */
export interface ToolShortcutEntry {
  id: ToolId;
  keys: string[];
  match: string[];
  noMod?: boolean;
  label: string;
  aboutAt?: number;
}

/** The shortcut entries of the tools, in bar order – `shortcuts.ts` spreads them into its table. */
export function toolShortcutEntries(tools: ToolDefinition[] = TOOLS): ToolShortcutEntry[] {
  return tools.flatMap((t) => {
    const s = t.shortcut;
    return s ? [{ id: t.id, keys: s.keys, match: s.match, noMod: s.noMod, label: t.title.toLowerCase(), aboutAt: t.aboutAt }] : [];
  });
}

/** The About dialog's line, built from the tool definitions that carry an `aboutAt`. */
export function aboutToolEntries(tools: ToolDefinition[] = TOOLS): ToolShortcutEntry[] {
  return toolShortcutEntries(tools)
    .filter((t) => t.aboutAt !== undefined)
    .sort((a, b) => (a.aboutAt as number) - (b.aboutAt as number));
}

/** The tools of one group, in registry order. */
export function toolsInGroup(group: ToolGroup, tools: ToolDefinition[] = TOOLS): ToolDefinition[] {
  return tools.filter((t) => t.group === group);
}

/**
 * The tooltip of a tool's strip button: "Name (Key)", and – when the tool cannot be used – the
 * reason after it ("Cut (C): Select one object"). One function, so the strip and its tests build the
 * same text from the same table.
 */
export function toolTitle(title: string, keys?: string[], reason?: string): string {
  const key = keys?.length ? keys[keys.length - 1] : undefined;
  const base = key ? `${title} (${key})` : title;
  return reason ? `${base}: ${reason}` : base;
}

/**
 * Whether a tool shows as active: the open panel tool, or – while no panel is open – the transform
 * tool whose mode the gizmo is in.
 */
export function isToolActive(tool: ToolDefinition, state: Pick<State, 'activeTool' | 'transformMode'>): boolean {
  if (state.activeTool) return state.activeTool === tool.id;
  return tool.group === 'transform' && state.transformMode === (tool.id === 'move' ? 'translate' : tool.id);
}
