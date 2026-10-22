/**
 * The history slice: the undo/redo stacks over the plater's object list, and the snapshot the
 * other actions record before they change it.
 */
import type { StateCreator } from 'zustand';
import { mergeUploadState } from '../../plater/objects';
import type { PlaterObject, State } from '../types';

/**
 * A history snapshot with its own paint arrays (B3). The brush mutates the paint arrays in place
 * (`applyPaint`), so a snapshot that kept the same `Uint8Array`s would silently follow every later
 * stroke – undo restored the *current* paint, and an undo after a stroke wiped all MMU paint.
 * Everything else in a `PlaterObject` is replaced, not mutated, so only the paint needs copying;
 * a snapshot without paint keeps the object itself.
 */
function snapshotObject(o: PlaterObject): PlaterObject {
  if (!o.paint) return o;
  return {
    ...o,
    paint: {
      supports: o.paint.supports?.slice(),
      seam: o.paint.seam?.slice(),
      mmu: o.paint.mmu?.slice(),
    },
  };
}

/** A copy of the plater for the undo stack; the array and the paint of every object are new. */
export function snapshotObjects(objects: PlaterObject[]): PlaterObject[] {
  return objects.map(snapshotObject);
}

export interface HistorySlice {
  undoStack: PlaterObject[][];
  redoStack: PlaterObject[][];
  recordHistory: (snapshot?: PlaterObject[]) => void;
  undo: () => void;
  redo: () => void;
}

export const createHistorySlice: StateCreator<State, [], [], HistorySlice> = (set, get) => {
  // The live plater array the last snapshot was taken of. A second `recordHistory()` without a
  // change between the two (a keystroke in a field, a drag that ended where it started) therefore
  // adds no second undo step – the identity check the uncopied snapshot used to provide.
  let lastRecordedSource: PlaterObject[] | undefined;
  return {
    undoStack: [],
    redoStack: [],
    recordHistory: (snapshot) => {
      const s = get();
      const source = snapshot ?? s.objects;
      if (source === lastRecordedSource) return;
      lastRecordedSource = source;
      // every snapshot is copied: the brush mutates paint arrays in place, so a snapshot that kept
      // them would follow later strokes (B3)
      set({ undoStack: [...s.undoStack.slice(-49), snapshotObjects(source)], redoStack: [] });
    },
    undo: () => {
      const s = get();
      const snap = s.undoStack[s.undoStack.length - 1];
      if (!snap) return;
      const restored = mergeUploadState(snap, s.objects);
      lastRecordedSource = undefined;
      set({
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, snapshotObjects(s.objects)],
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
      lastRecordedSource = undefined;
      set({
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, snapshotObjects(s.objects)],
        objects: restored,
        selectedIds: s.selectedIds.filter((id) => restored.some((o) => o.id === id)),
        selectedVolumeId: undefined,
        sliceDirty: true,
      });
    },
  };
};
