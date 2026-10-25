/**
 * The tool strip's table (layout 3.0, L-4; visual pass) and how much of it fits.
 *
 * The strip floats over the top of the scene, between the two floating cards (the object list on the
 * left, the context panel on the right), centred in that band. The room it has is that band, not the
 * window: folding a card gives the strip more space, hiding the panels gives it the whole scene. Its groups keep
 * PrusaSlicer's order – the selection's object command, the instance pair, the transform tools with
 * arrange and its settings, the paint tools, cut and the layer tools. When the pill does not fit, the
 * trailing groups move into an overflow menu ("⋯") that lists the same entries; the strip itself never
 * wraps.
 *
 * The widths are estimates of the rendered controls (an icon button is a square, a label adds its
 * text), so the fit is a pure function of the room, the label mode and the table, and can be unit
 * tested. The estimate uses the largest button size of the stylesheet, so the real pill is never wider
 * than the number it was fitted with. The estimates only decide which groups show – the real widths
 * come from the stylesheet.
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
const ICON_BUTTON = 34;
/** The gap between two buttons of a group. */
const INNER_GAP = 2;
/** A thin divider between groups: its 1 px line and its 3 px margins on each side. */
export const SEPARATOR = 7;
/** The pill's padding left + right and its two 1 px borders. */
export const PILL_PADDING = 12;
/** The overflow button and the divider's margin before it; its room is only taken when groups are hidden. */
export const OVERFLOW_WIDTH = 37;
/** Average label character width at 12 px, plus the button's inner gaps and padding. */
const LABEL_CHAR = 6.5;
const LABEL_INSET = 8;
/** The safety margin between the pill's estimate and the band's edge: its own 1 px borders and a pixel. */
const SLACK = 2;

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

/**
 * The estimated width of one group, with labels when they are on: its divider, its buttons and the gap
 * between every pair of its children (the divider is one of them).
 */
export function groupWidth(group: StripGroupId, labels: boolean, tools: ToolDefinition[] = TOOLS): number {
  const items = itemsOfGroup(group, tools);
  if (!items.length) return 0;
  const each = items.map((item) => (labels ? ICON_BUTTON + LABEL_INSET + Math.round(itemName(item).length * LABEL_CHAR) : ICON_BUTTON));
  return SEPARATOR + each.reduce((a, b) => a + b, 0) + items.length * INNER_GAP;
}

/**
 * The room the groups have in a band `band` px wide: the pill's padding and the safety slack. The
 * band is the part of the scene the floating cards leave free – the strip's own layer measures it
 * (`ToolStrip`), so folding a card gives the pill more room at the same window size.
 */
export function stripRoom(band: number): number {
  return band - PILL_PADDING - SLACK;
}

/**
 * Which groups fit into `room` px. The first group is always kept, so a very narrow band still shows
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
    // the group's width includes its own divider; the overflow button stands beside the last group
    const width = groupWidth(group, labels, tools);
    const overflow = STRIP_GROUPS.length - i - 1 ? OVERFLOW_WIDTH : 0;
    // the first group always stays, so a narrow band still shows the selection command
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

/** Below this window width the strip becomes a horizontally scrollable pill instead of an overflow menu. */
export const COMPACT_QUERY = '(max-width: 900px)';
