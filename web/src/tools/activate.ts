/**
 * In and out of a tool (T-046). The tools slice calls these; the bar, the shortcut handler and the
 * panel host only name a tool id. One function each for "open", "close" and "toggle", so the
 * lifecycle (`onExit` of the old tool, `onEnter` of the new one) exists once.
 */
import type { State } from '../state/types';
import { toolById, type ToolContext, type ToolId } from './registry';

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
 * Open a tool. A tool that is already open toggles off (the bar and the shortcut both close that
 * way); an unavailable tool stays closed and returns its reason, which the bar shows as a tooltip.
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
  // the tool's own state (paint kind, cut settings) before it counts as open, so the panel mounts
  // with everything it needs
  tool.onEnter?.({ state: host.getState() });
  host.setState({ activeTool: id });
  return { ok: true };
}

/** Close the open tool; nothing happens when no tool is open. */
export function exitTool(host: ToolHost): void {
  if (!host.getState().activeTool) return;
  exitCurrent(host);
}
