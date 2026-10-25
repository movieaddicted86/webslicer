/**
 * In and out of a tool (T-046). The tools slice calls these; the bar, the shortcut handler and the
 * panel host only name a tool id. One function each for "open", "close" and "toggle", so the
 * lifecycle (`onExit` of the old tool, `onEnter` of the new one) exists once.
 *
 * Only a tool with a panel becomes the open tool: move, rotate and scale are modes of the gizmo and
 * set `transformMode` alone, so the context panel can never be in tool mode with nothing to show.
 * The same rule is checked again while a tool is open (`unshowableTool`): a panel whose precondition
 * disappeared – its object was deleted, the selection dropped to two objects – closes the tool.
 */
import type { State } from '../state/types';
import { toolById, type ToolContext, type ToolDefinition, type ToolId } from './registry';

/** The store calls a tool's lifecycle with; `state` is the store as it is at that moment. */
export interface ToolHost {
  getState: () => State;
  setState: (partial: Partial<State>) => void;
}

/** Run `onExit` of the open tool (if any) – the tool is no longer active afterwards. */
function exitCurrent(host: ToolHost): void {
  const current = toolById(host.getState().activeTool);
  host.setState({ activeTool: undefined });
  if (!current?.onExit) return;
  const ctx: ToolContext = { state: host.getState() };
  current.onExit(ctx);
}

/**
 * Whether the tool's panel can be shown right now: it has one, and the tool is available in this
 * state. A gizmo tool has none; a panel tool whose object is gone fails its availability.
 */
export function canShowPanel(tool: ToolDefinition | undefined, state: State): boolean {
  return !!tool?.panel && tool.isAvailable(state).ok;
}

/** The open tool that has no panel to show and therefore has to close; `undefined` when all is well. */
export function unshowableTool(state: State): ToolId | undefined {
  if (!state.activeTool) return undefined;
  return canShowPanel(toolById(state.activeTool), state) ? undefined : state.activeTool;
}

/**
 * Open a tool. A tool that is already open toggles off (the bar and the shortcut both close that
 * way); an unavailable tool stays closed and returns its reason, which the bar shows as a tooltip.
 * A tool without a panel (move/rotate/scale) only runs its `onEnter` – its mode is the tool.
 */
export function activateTool(host: ToolHost, id: ToolId): { ok: boolean; reason?: string } {
  const state = host.getState();
  if (state.activeTool === id) {
    exitTool(host);
    return { ok: true };
  }
  const tool = toolById(id);
  if (!tool) return { ok: false };
  const available = tool.isAvailable(state);
  if (!available.ok) return available;
  exitCurrent(host);
  // the tool counts as open before its `onEnter` runs: the enter action may open the same tool
  // itself (paint goes through the store's `startPaint`), and the toggle check then sees it open
  // instead of recursing
  host.setState({ activeTool: tool.panel ? id : undefined });
  tool.onEnter?.({ state: host.getState() });
  return { ok: true };
}

/** Close the open tool; nothing happens when no tool is open. */
export function exitTool(host: ToolHost): void {
  if (!host.getState().activeTool) return;
  exitCurrent(host);
}
