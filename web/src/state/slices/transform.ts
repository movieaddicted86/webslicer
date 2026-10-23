/**
 * The plater's transforms (q4-web-store): the gizmo mode, "place on face", drop to bed, arrangement
 * and its settings. Split out of `plater.ts`; `createPlaterSlice` spreads this creator into itself.
 */
import * as THREE from 'three';
import { bedShapeOf } from '@webslicer/shared';
import type { Vec3 } from '../../api';
import { arrangePlan, packOptionsOf, withPlacements, type ArrangeSettings } from '../../plater/arrangement';
import { loadArrangeSettings, saveArrangeSettings } from '../../plater/arrangeSettings';
import { instanceBounds, pickedInstanceId, selectedInstance } from '../../plater/objects';
import type { State, SlicePart } from '../types';

export interface TransformSlice {
  transformMode: 'translate' | 'rotate' | 'scale';
  setTransformMode: (m: State['transformMode']) => void;
  /** rotate an object so that the given world-space face normal points down (-Z) */
  placeObjectOnFace: (id: string, worldNormal: Vec3) => void;
  dropToBed: (id: string) => void;
  /** arrange every instance on the bed; false (and no change) when they do not all fit */
  arrange: () => boolean;
  /** arrange only the selected instances around the others (Shift+A); false when it does not fit */
  arrangeSelection: () => boolean;
  /** the Arrange settings from the gear popover (T-043), remembered per browser */
  arrangeSettings: ArrangeSettings;
  setArrangeSettings: (patch: Partial<ArrangeSettings>) => void;
}

/** The instances Shift+A moves: the picked one when there is one, else every instance of the selection. */
function movingInstanceKeys(s: State): Set<string> {
  const keys = new Set<string>();
  for (const o of s.objects) {
    if (!s.selectedIds.includes(o.id)) continue;
    const picked = pickedInstanceId(s, o);
    for (const inst of o.instances) if (!picked || inst.id === picked) keys.add(`${o.id}:${inst.id}`);
  }
  return keys;
}

export const createTransformSlice: SlicePart<TransformSlice> = (set, get) => ({
  transformMode: 'translate',
  arrangeSettings: loadArrangeSettings(),
  setTransformMode: (transformMode) => set({ transformMode }),
  placeObjectOnFace: (id, worldNormal) => {
    const o = get().objects.find((x) => x.id === id);
    if (!o) return;
    get().recordHistory();
    const n = new THREE.Vector3(...worldNormal).normalize();
    if (n.lengthSq() < 0.5) return;
    const down = new THREE.Vector3(0, 0, -1);
    const q = new THREE.Quaternion().setFromUnitVectors(n, down);
    const inst = selectedInstance(get(), o);
    const cur = new THREE.Quaternion().setFromEuler(new THREE.Euler(inst.rotation[0], inst.rotation[1], inst.rotation[2], 'XYZ'));
    const next = q.multiply(cur);
    const e = new THREE.Euler().setFromQuaternion(next, 'XYZ');
    get().updateInstance(id, inst.id, { rotation: [e.x, e.y, e.z] });
    get().dropToBed(id);
    // placing is the whole job of the tool: the next click picks normally again
    get().closeTool();
  },
  dropToBed: (id) => {
    const s = get();
    const o = s.objects.find((x) => x.id === id);
    if (!o) return;
    const inst = selectedInstance(s, o);
    const box = instanceBounds(o, inst);
    if (Math.abs(box.min.z) > 1e-6)
      get().updateInstance(id, inst.id, { position: [inst.position[0], inst.position[1], inst.position[2] - box.min.z] });
  },
  arrange: () => {
    const s = get();
    const updates = arrangePlan(s.objects, bedShapeOf(s.presets.printer.current), packOptionsOf(s.presets, s.arrangeSettings));
    if (!updates) {
      // nothing fits: report it and leave the plater untouched (checked before recording history)
      s.toast('error', 'Not all objects fit on the bed');
      return false;
    }
    get().recordHistory();
    set((st) => ({ objects: withPlacements(st.objects, updates), sliceDirty: true }));
    return true;
  },
  arrangeSelection: () => {
    const s = get();
    const moving = movingInstanceKeys(s);
    if (!moving.size) {
      s.toast('info', 'Select the objects to arrange first');
      return false;
    }
    const updates = arrangePlan(s.objects, bedShapeOf(s.presets.printer.current), packOptionsOf(s.presets, s.arrangeSettings), moving);
    if (!updates) {
      s.toast('error', 'The selected objects do not fit on the bed');
      return false;
    }
    get().recordHistory();
    set((st) => ({ objects: withPlacements(st.objects, updates), sliceDirty: true }));
    return true;
  },
  setArrangeSettings: (patch) => {
    set((s) => ({ arrangeSettings: { ...s.arrangeSettings, ...patch } }));
    saveArrangeSettings(get().arrangeSettings);
  },
});
