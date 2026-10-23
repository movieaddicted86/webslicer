/**
 * The store (R-6): one `useStore` composed from the six slice creators. The autosave lifecycle that
 * used to live here (the debounce subscription) is `./autosave.ts` now. The module state that
 * belongs to the store as a whole lives in the slices.
 *
 * Components keep importing everything from here: `useStore`, the selectors and helpers
 * (`selectedInstance`, `pickedInstanceId`, `instanceBounds`, `isModified`, `VOLUME_LABELS`, …), the
 * domain types and `window.webslicer`. Those now live in `./types`, `./slices/*` and
 * `../plater/objects`; this file re-exports them, so no component had to change.
 */
import { create } from 'zustand';
import { createUiSlice } from './slices/ui';
import { createPresetSlice } from './slices/preset';
import { createPlaterSlice } from './slices/plater';
import { createJobSlice } from './slices/job';
import { createPreviewSlice } from './slices/preview';
import { createHistorySlice } from './slices/history';
import { createToolsSlice } from './slices/tools';
import type { State } from './types';

export * from './types';
export { instanceBounds, pickedInstanceId, selectedInstance } from '../plater/objects';
export { isModified } from './slices/preset';
export { clientId } from './client';

export const useStore = create<State>()((...a) => ({
  ...createUiSlice(...a),
  ...createPresetSlice(...a),
  ...createPlaterSlice(...a),
  ...createJobSlice(...a),
  ...createPreviewSlice(...a),
  ...createHistorySlice(...a),
  ...createToolsSlice(...a),
}));
