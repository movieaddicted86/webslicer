/**
 * Picking in the scene, shared by the mouse click path and the touch gestures: which scene objects a
 * ray may hit, the ray itself, and a hit test that tolerates a finger.
 *
 * The tolerance is what a thumb needs: a tap lands a few pixels beside the model, so the ray of the
 * tap point alone would miss. `pickAt` casts the tap point and a small ring around it and keeps the
 * hit closest to the centre, so the nearest object under the finger wins – the same object a precise
 * click would have hit.
 */
import * as THREE from 'three';
import type { SceneRefs } from './types';

/** The visible instance bodies and their volumes – what a click or tap can select. */
export function pickablesOf(refs: SceneRefs): THREE.Object3D[] {
  const pickables: THREE.Object3D[] = [];
  for (const n of refs.nodes.values()) {
    if (!n.group.visible) continue;
    for (const inst of n.instances.values()) {
      if (!inst.group.visible) continue;
      pickables.push(inst.mesh, ...inst.volumes.values());
    }
  }
  return pickables;
}

/** Point the raycaster at a client point of the canvas. */
export function aimAt(refs: SceneRefs, clientX: number, clientY: number): void {
  const rect = refs.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  refs.raycaster.setFromCamera(ndc, refs.camera);
}

/** The first hit along the ray of a client point. */
export function hitAt(refs: SceneRefs, clientX: number, clientY: number): THREE.Intersection | undefined {
  aimAt(refs, clientX, clientY);
  return refs.raycaster.intersectObjects(pickablesOf(refs), false)[0];
}

/**
 * The hit under a point with a tolerance in CSS pixels: the closest hit of the point and a ring
 * around it, measured from the point the user touched. A tolerance of 0 is a plain hit test.
 */
export function pickAt(refs: SceneRefs, clientX: number, clientY: number, tolerance = 0): THREE.Intersection | undefined {
  const offsets: Array<[number, number]> = [[0, 0]];
  if (tolerance > 0) {
    const r = tolerance / 2;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      offsets.push([dx * r, dy * r], [dx * tolerance, dy * tolerance]);
    }
  }
  const pickables = pickablesOf(refs);
  let best: THREE.Intersection | undefined;
  let bestDistance = Infinity;
  for (const [dx, dy] of offsets) {
    aimAt(refs, clientX + dx, clientY + dy);
    const hit = refs.raycaster.intersectObjects(pickables, false)[0];
    if (!hit) continue;
    const away = Math.hypot(dx, dy);
    if (away < bestDistance) {
      best = hit;
      bestDistance = away;
    }
  }
  return best;
}

/** Where a ray from a client point meets a horizontal plane at `z` (undefined when it looks away). */
export function planePointAt(refs: SceneRefs, clientX: number, clientY: number, z: number): THREE.Vector3 | undefined {
  aimAt(refs, clientX, clientY);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  return refs.raycaster.ray.intersectPlane(plane, new THREE.Vector3()) || undefined;
}
