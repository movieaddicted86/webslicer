/**
 * Camera geometry of the viewer (R-7): the projection preference, the frustum helpers and the
 * framing commands. Moved out of `Viewer.tsx` verbatim - the numbers and the order of the
 * assignments are what make a view key and its toolbar button frame the same.
 */
import * as THREE from 'three';
import { bedShapeOf } from '@webslicer/shared';
import {
  fitFrame,
  fitFrameInBand,
  orthoExtents,
  orthoFitDistance,
  orthoFrustumHeight,
  turnOffset,
  uprightUp,
  type FrameBand,
} from './cameraMath';
import { useStore, pickedInstanceId } from '../../state/store';
import type { ParsedGcode } from '../../gcode/types';
import type { SceneRefs } from './types';

export const FOV = 45;
export const DEFAULT_BED = '0x0,200x0,200x200,0x200';
/** Where the perspective/orthographic choice is remembered (see `viewer/cameraMath.ts`). */
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
 * `band` is the part of the canvas the phone's sheet leaves free; the box is centred there instead
 * of in the whole canvas.
 */
export function frameBox(refs: SceneRefs, box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3, band?: FrameBand) {
  const width = refs.renderer.domElement.clientWidth || 1;
  const height = refs.renderer.domElement.clientHeight || 1;
  const aspect = width / height;
  const frame =
    band && Number.isFinite(band.top) && Number.isFinite(band.bottom) && band.bottom - band.top > 80
      ? fitFrameInBand(box, dir, up, FOV, { ...band, width, height })
      : fitFrame(box, dir, up, FOV, aspect);
  refs.persp.position.copy(frame.position);
  refs.persp.up.copy(frame.up);
  refs.ortho.position.copy(frame.position);
  refs.ortho.up.copy(frame.up);
  setOrthoFrustum(refs.ortho, orthoFrustumHeight(frame.distance, FOV), aspect);
  refs.controls.target.copy(frame.target);
  refs.controls.update();
}

/**
 * Turn the camera around the world's vertical axis by quarter turns, keeping the orbit target, the
 * elevation and the distance: the phone's two turn buttons. Both cameras move, so switching the
 * projection afterwards keeps the framing. The up vector goes back to the world's vertical axis –
 * an orbit tilts it, and turning a tilted horizon around Z would keep the tilt (N-08).
 */
export function turnCamera(refs: SceneRefs, turns: number) {
  const target = refs.controls.target;
  for (const camera of [refs.persp, refs.ortho]) {
    const offset = camera.position.clone().sub(target);
    const up = uprightUp(offset, camera.up);
    camera.position.copy(target).add(turnOffset(offset, turns));
    camera.up.copy(up);
  }
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
  const box = new THREE.Box3(new THREE.Vector3(Infinity, Infinity, Infinity), new THREE.Vector3(-Infinity, -Infinity, -Infinity));
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

/**
 * The box a phone's automatic framing shows: the whole plate and every object on it, whatever the
 * selection. Unlike `focusBox` it never narrows to the selection – the user has to see the plate and
 * all parts in the room the sheet leaves.
 */
export function sceneBox(refs: SceneRefs, bedShape: string): THREE.Box3 {
  const box = bedBox(bedShape);
  const node = new THREE.Box3();
  for (const entry of refs.nodes.values()) {
    for (const inode of entry.instances.values()) {
      box.union(node.setFromObject(inode.mesh));
      for (const vm of inode.volumes.values()) box.union(node.setFromObject(vm));
    }
  }
  return box;
}

/**
 * The plate and the visible toolpaths: what a phone's Preview framing has to show above the sheet
 * (T-103). Once a result exists the objects are hidden, so `sceneBox` would frame the plate alone and
 * the part would hang at the edge of the picture.
 */
export function previewSceneBox(bedShape: string): THREE.Box3 {
  const st = useStore.getState();
  const box = bedBox(bedShape);
  const paths = st.gcode && st.previewLayerRange ? gcodeBox(st.gcode, st.previewLayerRange) : undefined;
  if (paths) box.union(paths);
  return box;
}

/** The width below which the sheet owns the lower part of the scene (the same as the stylesheet). */
const PHONE_QUERY = '(max-width: 640px)';

/** The room above the phone's sheet; nothing on a wide window, where the cards sit beside the scene. */
export function phoneBand(refs: SceneRefs): FrameBand | undefined {
  return window.matchMedia(PHONE_QUERY).matches ? visibleBandOf(refs) : undefined;
}

/** The part of the canvas a phone's bottom sheet leaves free: below the view row, above the sheet. */
export function visibleBandOf(refs: SceneRefs): FrameBand | undefined {
  const canvas = refs.renderer.domElement.getBoundingClientRect();
  if (!canvas.height) return undefined;
  const row = document.querySelector<HTMLElement>('[data-testid="viewer-view-row"]');
  const stack = document.querySelector<HTMLElement>('.context-stack');
  const top = row ? Math.max(0, row.getBoundingClientRect().bottom - canvas.top + 8) : 0;
  const bottom = stack ? Math.min(canvas.height, stack.getBoundingClientRect().top - canvas.top - 8) : canvas.height;
  if (!(bottom - top > 80)) return undefined;
  return { top, bottom, width: canvas.width, height: canvas.height };
}

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
