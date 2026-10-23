/**
 * The history slice: the undo/redo stacks over the plater's object list, and the snapshot the
 * other actions record before they change it.
 */
import type { StateCreator } from 'zustand';
import { mergeUploadState } from '../../plater/objects';
import type { PlaterObject, State } from '../types';

/**
 * Paint arrays that a history snapshot still shares with the live object (B3/N6). Copying every
 * paint array into every snapshot made fifty drags allocate fifty fresh copies per painted object;
 * instead a snapshot keeps the array it saw, and the *next* mutation copies it (copy-on-write):
 * `paintForEdit` hands the brush or a paint action a private array, and the snapshots keep theirs.
 */
const sharedPaint = new WeakSet<Uint8Array>();

/** The array to mutate: the shared one when nothing else looks at it, a copy otherwise. */
export function paintForEdit(arr: Uint8Array): Uint8Array {
  if (!sharedPaint.has(arr)) return arr;
  const copy = arr.slice();
  sharedPaint.delete(arr);
  return copy;
}

/**
 * A history snapshot (B3, N6). Everything in a `PlaterObject` is replaced, not mutated – except the
 * paint arrays, which the brush writes in place. The snapshot marks those arrays as shared instead of
 * duplicating them; `paintForEdit` copies before the first write, so no snapshot can follow a stroke.
 */
function snapshotObject(o: PlaterObject): PlaterObject {
  const paint = o.paint;
  if (!paint) return o;
  for (const arr of [paint.supports, paint.seam, paint.mmu]) if (arr) sharedPaint.add(arr);
  return { ...o, paint: { ...paint } };
}

/** A copy of the plater for the undo stack; the array and the object records are new. */
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
