/**
 * The tools slice (T-046): which tool is open. The tool bar, the shortcut handler and the panel host
 * name a tool id; availability, lifecycle and shortcuts come from the registry
 * (`tools/registry.ts`). The old ad-hoc flags (`paintMode`, `placeOnFace`, `cutOpen`) are gone:
 * `paintKindOf(activeTool)` is what the painting code reads, and `activeTool === 'placeOnFace'` is
 * the placement mode. Move/rotate/scale keep `transformMode` – they have no panel.
 */
import type { StateCreator } from 'zustand';
import type { ToolId } from '../../tools/registry';
import { activateTool, exitTool, type ToolHost } from '../../tools/activate';
import type { State } from '../types';

export interface ToolsSlice {
  /** the open tool panel; `undefined` when no tool is active */
  activeTool?: ToolId;
  /** open a tool (toggling the open one off); returns why an unavailable tool stayed closed */
  openTool: (id: ToolId) => { ok: boolean; reason?: string };
  /** close the open tool, if any */
  closeTool: () => void;
}

export const createToolsSlice: StateCreator<State, [], [], ToolsSlice> = (set, get) => {
  const host: ToolHost = { getState: get, setState: (partial) => set(partial) };
  return {
    openTool: (id) => activateTool(host, id),
    closeTool: () => exitTool(host),
  };
};
