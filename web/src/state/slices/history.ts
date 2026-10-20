/**
 * The history slice: the undo/redo stacks over the plater's object list, and the snapshot the
 * other actions record before they change it.
 */
import type { StateCreator } from 'zustand';
import { mergeUploadState } from '../../plater/objects';
import type { PlaterObject, State } from '../types';

export interface HistorySlice {
  undoStack: PlaterObject[][];
  redoStack: PlaterObject[][];
  recordHistory: (snapshot?: PlaterObject[]) => void;
  undo: () => void;
  redo: () => void;
}

export const createHistorySlice: StateCreator<State, [], [], HistorySlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],
  recordHistory: (snapshot) => {
    const s = get();
    const snap = snapshot ?? s.objects;
    if (s.undoStack[s.undoStack.length - 1] === snap) return;
    set({ undoStack: [...s.undoStack.slice(-49), snap], redoStack: [] });
  },
  undo: () => {
    const s = get();
    const snap = s.undoStack[s.undoStack.length - 1];
    if (!snap) return;
    const restored = mergeUploadState(snap, s.objects);
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, s.objects],
      objects: restored,
      selectedIds: s.selectedIds.filter((id) => restored.some((o) => o.id === id)),
      selectedVolumeId: undefined,
      sliceDirty: true,
    });
  },
  redo: () => {
    const s = get();
    const snap = s.redoStack[s.redoStack.length - 1];
    if (!snap) return;
    const restored = mergeUploadState(snap, s.objects);
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, s.objects],
      objects: restored,
      selectedIds: s.selectedIds.filter((id) => restored.some((o) => o.id === id)),
      selectedVolumeId: undefined,
      sliceDirty: true,
    });
  },
});
