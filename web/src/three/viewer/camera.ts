/**
 * Camera geometry of the viewer (R-7): the projection preference, the frustum helpers and the
 * framing commands. Moved out of `Viewer.tsx` verbatim - the numbers and the order of the
 * assignments are what make a view key and its toolbar button frame the same.
 */
import * as THREE from 'three';
import { bedShapeOf } from '@webslicer/shared';
import { fitFrame, orthoExtents, orthoFitDistance, orthoFrustumHeight, viewDirection } from '../../plater/camera';
import { useStore, pickedInstanceId } from '../../state/store';
import type { ParsedGcode } from '../../gcode/types';
import type { SceneRefs } from './types';

export const FOV = 45;
export const DEFAULT_BED = '0x0,200x0,200x200,0x200';
/** Where the perspective/orthographic choice is remembered (see `plater/camera.ts`). */
const ORTHO_KEY = 'webslicer.camera.ortho';

export function readOrthoPref(): boolean {
  try {
    return localStorage.getItem(ORTHO_KEY) === 'ortho';
  } catch {
    return false;
  }
}

export function writeOrthoPref(ortho: boolean) {
  try {
    localStorage.setItem(ORTHO_KEY, ortho ? 'ortho' : 'persp');
  } catch {
    /* private window or blocked storage: the choice just is not remembered */
  }
}

/** Height of the area an ortho camera shows, including its wheel zoom. */
export const orthoHeightOf = (cam: THREE.OrthographicCamera) => (cam.top - cam.bottom) / cam.zoom;

/** Give the ortho camera the frustum of a perspective view that shows `height` mm at the target. */
export function setOrthoFrustum(cam: THREE.OrthographicCamera, height: number, aspect: number, zoom = 1) {
  const { halfHeight, halfWidth } = orthoExtents(height, aspect);
  cam.top = halfHeight;
  cam.bottom = -halfHeight;
  cam.left = -halfWidth;
  cam.right = halfWidth;
  cam.zoom = zoom;
  cam.updateProjectionMatrix();
}

/**
 * Frame `box`: both cameras are moved to the same place and the ortho frustum is set to the area
 * the perspective view shows at that distance, so switching the camera never changes the framing.
 */
export function frameBox(refs: SceneRefs, box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3) {
  const aspect = refs.persp.aspect || 1;
  const frame = fitFrame(box, dir, up, FOV, aspect);
  refs.persp.position.copy(frame.position);
  refs.persp.up.copy(frame.up);
  refs.ortho.position.copy(frame.position);
  refs.ortho.up.copy(frame.up);
  setOrthoFrustum(refs.ortho, orthoFrustumHeight(frame.distance, FOV), aspect);
  refs.controls.target.copy(frame.target);
  refs.controls.update();
}

/** The whole print bed, the fallback target of every camera command. */
export function bedBox(bedShape: string): THREE.Box3 {
  const bed = bedShapeOf({ bed_shape: bedShape || DEFAULT_BED });
  return new THREE.Box3(new THREE.Vector3(bed.min[0], bed.min[1], 0), new THREE.Vector3(bed.max[0], bed.max[1], 0));
}

/** World bounds of the toolpaths of the visible layers (undefined when the range is empty). */
export function gcodeBox(g: ParsedGcode, range: [number, number]): THREE.Box3 | undefined {
  const lo = Math.max(0, Math.min(range[0], g.layerCount - 1));
  const hi = Math.max(lo, Math.min(range[1], g.layerCount - 1));
  const from = g.layerStart[lo] * 6;
  const to = g.layerStart[hi + 1] * 6;
  const box = new THREE.Box3(
    new THREE.Vector3(Infinity, Infinity, Infinity),
    new THREE.Vector3(-Infinity, -Infinity, -Infinity),
  );
  for (let i = from; i < to; i += 3) {
    box.min.x = Math.min(box.min.x, g.positions[i]);
    box.min.y = Math.min(box.min.y, g.positions[i + 1]);
    box.min.z = Math.min(box.min.z, g.positions[i + 2]);
    box.max.x = Math.max(box.max.x, g.positions[i]);
    box.max.y = Math.max(box.max.y, g.positions[i + 1]);
    box.max.z = Math.max(box.max.z, g.positions[i + 2]);
  }
  return box.isEmpty() ? undefined : box;
}

/**
 * What a camera command frames (PrusaSlicer's "zoom to selection"): in the preview the visible
 * toolpaths, in the plater the selected instances (the picked one, or all of them when the object
 * row is selected) and otherwise the whole bed.
 */
export function focusBox(refs: SceneRefs, bedShape: string): THREE.Box3 {
  const st = useStore.getState();
  if (st.view === 'preview') {
    const box = st.gcode && st.previewLayerRange ? gcodeBox(st.gcode, st.previewLayerRange) : undefined;
    return box || bedBox(bedShape);
  }
  const box = new THREE.Box3();
  for (const id of st.selectedIds) {
    const node = refs.nodes.get(id);
    const o = st.objects.find((x) => x.id === id);
    if (!node || !o) continue;
    const picked = st.selectedIds.length === 1 ? pickedInstanceId(st, o) : undefined;
    for (const [iid, inode] of node.instances) {
      if (picked && iid !== picked) continue;
      box.union(new THREE.Box3().setFromObject(inode.mesh));
      for (const vm of inode.volumes.values()) box.union(new THREE.Box3().setFromObject(vm));
    }
  }
  return box.isEmpty() ? bedBox(bedShape) : box;
}

/** Move the controls, the picking ray and the gizmo onto the other camera, keeping the framing. */
export function switchCamera(refs: SceneRefs, ortho: boolean) {
  const from = refs.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const to = ortho ? refs.ortho : refs.persp;
  if (from === to) return;
  const target = refs.controls.target;
  const offset = from.position.clone().sub(target);
  const distance = offset.length() || 1;
  to.up.copy(from.up);
  if (ortho) {
    // the same distance, with the ortho frustum showing what the perspective view showed
    to.position.copy(from.position);
    setOrthoFrustum(refs.ortho, orthoFrustumHeight(distance, FOV), refs.persp.aspect || 1);
  } else {
    // the ortho frustum's area is what a perspective camera shows at this distance
    refs.persp.position.copy(target).addScaledVector(offset.normalize(), orthoFitDistance(orthoHeightOf(refs.ortho), FOV));
  }
  refs.camera = to;
  refs.controls.object = to;
  refs.transform.camera = to;
  refs.controls.update();
}
