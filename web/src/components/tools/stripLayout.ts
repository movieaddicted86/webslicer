/**
 * The tool strip's table (layout 3.0, L-4) and how much of it fits.
 *
 * The strip floats over the top of the scene, so the room it has is the scene's width, not the
 * window's. Its groups keep PrusaSlicer's order – the selection's object command, the instance pair,
 * the transform tools with arrange and its settings, the paint tools, cut and the layer tools. When the
 * pill does not fit, the trailing groups move into an overflow menu ("⋯") that lists the same entries;
 * the strip itself never wraps.
 *
 * The widths are estimates of the rendered controls (an icon button is a square, a label adds its
 * text), so the fit is a pure function of the room, the label mode and the table, and can be unit
 * tested. A little slack is built in: the strip may end short, never clipped. The estimates only
 * decide which groups show – the real widths come from the stylesheet.
 */
import { TOOLS, type ToolDefinition } from '../../tools/registry';
import { COMMAND_LABELS, type StripCommand } from '../../tools/stripCommands';

/** One entry of the strip. */
export type StripItem = { kind: 'tool'; tool: ToolDefinition } | { kind: 'command'; command: StripCommand };

/** A group of the strip: the registry's tool groups plus the two object groups. */
export type StripGroupId = 'selection' | 'instance' | 'transform' | 'paint' | 'cut' | 'layer';

/** The groups left to right, in PrusaSlicer's order. */
export const STRIP_GROUPS: StripGroupId[] = ['selection', 'instance', 'transform', 'paint', 'cut', 'layer'];

/** Where the commands sit: the object groups hold only commands, the transform group appends arrange. */
const COMMANDS: Partial<Record<StripGroupId, StripCommand[]>> = {
  selection: ['deleteSelection'],
  instance: ['addInstance', 'removeInstance'],
  transform: ['arrange', 'arrangeSettings'],
};

/** An icon button, in px (the square every strip button has). */
const ICON_BUTTON = 28;
/** The gap between two buttons of a group. */
const INNER_GAP = 2;
/** A thin divider between groups: its line, its margins and the two gaps around it. */
export const SEPARATOR = 10;
/** The pill's padding, left + right. */
export const PILL_PADDING = 8;
/** The margin the strip keeps to the scene's edges on each side. */
export const STRIP_EDGE = 12;
/** The Prepare | Preview switch, icon only. */
export const SWITCH_ICON_WIDTH = 54;
/** The same switch with its two names, as on a wide window. */
export const SWITCH_TEXT_WIDTH = 166;
/** The overflow button; its room is only taken when groups are hidden. */
export const OVERFLOW_WIDTH = 28;
/** Average label character width at 12 px, plus the button's inner gaps. */
const LABEL_CHAR = 6.6;
const LABEL_INSET = 12;
/** The safety margin between the pill's estimate and the scene's edge. */
const SLACK = 8;

/** The registry tools of one strip group, in registry order (the object groups have none). */
export function toolsOfGroup(group: StripGroupId, tools: ToolDefinition[] = TOOLS): ToolDefinition[] {
  // the two object groups are not registry groups, so the filter leaves them empty by itself
  return tools.filter((t) => t.group === group);
}

/** The entries of one group, in strip order: its tools, then its commands. */
export function itemsOfGroup(group: StripGroupId, tools: ToolDefinition[] = TOOLS): StripItem[] {
  return [
    ...toolsOfGroup(group, tools).map((tool): StripItem => ({ kind: 'tool', tool })),
    ...(COMMANDS[group] ?? []).map((command): StripItem => ({ kind: 'command', command })),
  ];
}

/** The plain name of an entry, before a shortcut is added. */
export function itemName(item: StripItem): string {
  return item.kind === 'tool' ? item.tool.label : COMMAND_LABELS[item.command];
}

/** The estimated width of one group, with labels when they are on. */
export function groupWidth(group: StripGroupId, labels: boolean, tools: ToolDefinition[] = TOOLS): number {
  const items = itemsOfGroup(group, tools);
  if (!items.length) return 0;
  const each = items.map((item) => (labels ? ICON_BUTTON + LABEL_INSET + Math.round(itemName(item).length * LABEL_CHAR) : ICON_BUTTON));
  return each.reduce((a, b) => a + b, 0) + (items.length - 1) * INNER_GAP;
}

/**
 * The room the groups have when the scene is `sceneWidth` px wide: the scene's edge margins, the
 * pill's padding, the switch and the safety slack. Each group's own divider is added by `fitGroups`.
 */
export function stripRoom(sceneWidth: number, switchText: boolean): number {
  const fixed = 2 * STRIP_EDGE + PILL_PADDING + (switchText ? SWITCH_TEXT_WIDTH : SWITCH_ICON_WIDTH) + SLACK;
  return sceneWidth - fixed;
}

/**
 * Which groups fit into `room` px. The first group is always kept, so a very narrow scene still shows
 * the selection command; the rest move into the overflow menu as soon as a group – or the overflow
 * button that the hidden ones need – would not fit.
 */
export function fitGroups(
  room: number,
  labels: boolean,
  tools: ToolDefinition[] = TOOLS,
): { visible: StripGroupId[]; hidden: StripGroupId[] } {
  const visible: StripGroupId[] = [];
  let used = 0;
  for (let i = 0; i < STRIP_GROUPS.length; i++) {
    const group = STRIP_GROUPS[i];
    // every group stands behind a divider, and the overflow button behind one too
    const width = groupWidth(group, labels, tools) + SEPARATOR;
    const overflow = STRIP_GROUPS.length - i - 1 ? OVERFLOW_WIDTH + SEPARATOR : 0;
    // the first group always stays, so a narrow scene still shows the selection command
    if (visible.length && used + width + overflow > room) return { visible, hidden: STRIP_GROUPS.slice(i) };
    used += width;
    visible.push(group);
  }
  return { visible, hidden: [] };
}

/** Whether the whole strip fits – the rule that lets the names appear by themselves. */
export function stripFits(room: number, labels: boolean, tools: ToolDefinition[] = TOOLS): boolean {
  return fitGroups(room, labels, tools).hidden.length === 0;
}

/** The entries the overflow menu lists: everything of the hidden groups, in strip order. */
export function hiddenItems(hidden: StripGroupId[], tools: ToolDefinition[] = TOOLS): StripItem[] {
  return hidden.flatMap((g) => itemsOfGroup(g, tools));
}

/** From this window width on the switch shows the names Prepare and Preview next to its icons. */
export const SWITCH_TEXT_QUERY = '(min-width: 1400px)';

/** Below this window width the strip becomes a horizontally scrollable pill instead of an overflow menu. */
export const COMPACT_QUERY = '(max-width: 900px)';
