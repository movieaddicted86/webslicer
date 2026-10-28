/**
 * Applying one touch gesture step to the viewer's cameras (T-092): the pure maths of `cameraTouch` is
 * applied here, so `useTouch` only says "orbit by these pixels" or "pinch by this ratio".
 *
 * Both cameras are kept in step – the pose of the perspective one and the frustum of the
 * orthographic one describe the same view – so switching the projection after a gesture keeps the
 * framing, exactly as a mouse orbit does through OrbitControls.
 */
import * as THREE from 'three';
import { FOV, orthoHeightOf, setOrthoFrustum } from './camera';
import { orthoFrustumHeight } from './cameraMath';
import { clampDistance, orbitStep, pinchStep, worldPerPixel } from './cameraTouch';
import type { SceneRefs } from './types';

/** The orthographic camera's zoom stays inside this: a pinch cannot lose the model entirely. */
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 2000;

const activeCamera = (refs: SceneRefs): THREE.PerspectiveCamera | THREE.OrthographicCamera =>
  refs.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Put both cameras at the same pose and hand the target to the orbit controls. */
function setPose(refs: SceneRefs, target: THREE.Vector3, position: THREE.Vector3, up: THREE.Vector3) {
  refs.persp.position.copy(position);
  refs.persp.up.copy(up);
  refs.ortho.position.copy(position);
  refs.ortho.up.copy(up);
  refs.controls.target.copy(target);
  refs.controls.update();
}

/** One finger orbit: `dx`/`dy` are the finger's movement in CSS pixels. */
export function orbitByTouch(refs: SceneRefs, dx: number, dy: number): void {
  const cam = activeCamera(refs);
  const target = refs.controls.target.clone();
  const position = orbitStep(target, cam.position, cam.up, dx, dy);
  setPose(refs, target, position, cam.up);
}

/**
 * What one CSS pixel covers at the orbit target: the height the active camera shows there divided by
 * the canvas height, so a two-finger pan moves the model with the fingers.
 */
export function millimetresPerPixel(refs: SceneRefs): number {
  const cam = activeCamera(refs);
  const distance = cam.position.distanceTo(refs.controls.target);
  const shown = cam === refs.ortho ? orthoHeightOf(refs.ortho) : 2 * distance * Math.tan((FOV * Math.PI) / 360);
  return worldPerPixel(shown, refs.renderer.domElement.clientHeight);
}

/** One pinch step: the fingers' distance ratio (zoom) and their midpoint's movement (pan). */
export function pinchByTouch(refs: SceneRefs, ratio: number, dx: number, dy: number): void {
  const cam = activeCamera(refs);
  const orthoActive = cam === refs.ortho;
  const target = refs.controls.target.clone();
  const next = pinchStep(target, cam.position, cam.up, ratio, dx, dy, millimetresPerPixel(refs));
  setPose(refs, next.target, next.position, cam.up);
  if (orthoActive) {
    // the orthographic camera does not move to zoom: its frustum does
    refs.ortho.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, refs.ortho.zoom * ratio));
    refs.ortho.updateProjectionMatrix();
  } else {
    // keep the orthographic view showing what this perspective view shows, for the K switch
    const distance = clampDistance(next.position.distanceTo(next.target));
    setOrthoFrustum(refs.ortho, orthoFrustumHeight(distance, FOV), refs.persp.aspect || 1);
  }
}
