/**
 * The store (R-6): one `useStore` composed from the six slice creators, plus the module state that
 * belongs to the store as a whole – the autosave subscription below.
 *
 * Components keep importing everything from here: `useStore`, the selectors and helpers
 * (`selectedInstance`, `pickedInstanceId`, `instanceBounds`, `isModified`, `VOLUME_LABELS`, …), the
 * domain types and `window.webslicer`. Those now live in `./types`, `./slices/*` and
 * `../plater/objects`; this file re-exports them, so no component had to change.
 */
import { create } from 'zustand';
import { createUiSlice } from './slices/ui';
import { createPresetSlice, isModified } from './slices/preset';
import { createPlaterSlice } from './slices/plater';
import { createJobSlice } from './slices/job';
import { createPreviewSlice } from './slices/preview';
import { createHistorySlice } from './slices/history';
import type { State } from './types';

export * from './types';
export { instanceBounds, objectBounds, pickedInstanceId, selectedInstance } from '../plater/objects';
export { isModified } from './slices/preset';
export { geometryToStl } from '../three/geometry';
export { clientId } from './client';

export const useStore = create<State>()((...a) => ({
  ...createUiSlice(...a),
  ...createPresetSlice(...a),
  ...createPlaterSlice(...a),
  ...createJobSlice(...a),
  ...createPreviewSlice(...a),
  ...createHistorySlice(...a),
}));

// Autosave: debounce after plater or settings changes while objects exist.
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let lastAutosaveKey = '';
useStore.subscribe((s, prev) => {
  if (!s.ready) return;
  if (s.objects === prev.objects && s.presets === prev.presets) return;
  if (!s.objects.length) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const st = useStore.getState();
    if (!st.objects.length || st.objects.some((o) => !o.modelId && !o.uploadError)) return;
    // cheap change key: object ids/transforms/config + preset names + modified state
    const key = JSON.stringify([
      st.objects.map((o) => [o.id, o.instances.map((i) => [i.id, i.position, i.rotation, i.scale]), o.config, o.extruder, o.visible, o.volumes.map((v) => [v.id, v.type, v.position, v.rotation, v.scale, v.config])]),
      st.presets.print.name,
      st.customGcodes,
      st.presets.printer.name,
      st.presets.filament.map((f) => f.name),
      isModified(st.presets.print),
      isModified(st.presets.printer),
      st.presets.filament.map(isModified),
    ]);
    if (key === lastAutosaveKey) return;
    lastAutosaveKey = key;
    st.autosaveNow();
  }, 8000);
});
