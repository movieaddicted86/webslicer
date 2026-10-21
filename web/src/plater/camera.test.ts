import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  VIEWS,
  fitFrame,
  orthoExtents,
  orthoFitDistance,
  orthoFrustumHeight,
  viewBasis,
  viewByKey,
  viewDef,
  viewDirection,
  type CameraView,
} from './camera';

const FOV = 45;
const ASPECT = 16 / 9;

const box = (min: [number, number, number], max: [number, number, number]) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

/** Every corner of the box has to sit inside the frustum of the frame, with `shrink` of the distance. */
function cornersInside(b: THREE.Box3, frame: { target: THREE.Vector3; position: THREE.Vector3; up: THREE.Vector3 }, shrink = 0): boolean {
  const basis = viewBasis(frame.position.clone().sub(frame.target), frame.up);
  const distance = frame.position.distanceTo(frame.target) * (1 - shrink);
  const tanY = Math.tan((FOV * Math.PI) / 360);
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(frame.target);
    const depth = distance - corner.dot(basis.dir);
    if (Math.abs(corner.dot(basis.up)) > depth * tanY + 1e-9) return false;
    if (Math.abs(corner.dot(basis.right)) > depth * tanY * ASPECT + 1e-9) return false;
  }
  return true;
}

test('the seven standard views carry PrusaSlicer’s keys and directions', () => {
  assert.deepEqual(
    VIEWS.map((v) => v.key),
    ['0', '1', '2', '3', '4', '5', '6'],
  );
  assert.deepEqual(
    VIEWS.map((v) => v.id),
    ['iso', 'top', 'bottom', 'front', 'rear', 'left', 'right'],
  );
  const dir = (id: CameraView) => viewDirection(id).dir;
  assert.ok(dir('top').equals(new THREE.Vector3(0, 0, 1)));
  assert.ok(dir('bottom').equals(new THREE.Vector3(0, 0, -1)));
  assert.ok(dir('front').equals(new THREE.Vector3(0, -1, 0)));
  assert.ok(dir('rear').equals(new THREE.Vector3(0, 1, 0)));
  assert.ok(dir('left').equals(new THREE.Vector3(-1, 0, 0)));
  assert.ok(dir('right').equals(new THREE.Vector3(1, 0, 0)));
  // iso comes from the front right above, like PrusaSlicer's default view
  const iso = dir('iso');
  assert.ok(iso.x > 0 && iso.y < 0 && iso.z > 0, `iso ${iso.toArray()}`);
  assert.ok(Math.abs(iso.length() - 1) < 1e-9);
});

test('every view has an orthonormal basis that keeps the world upright', () => {
  for (const v of VIEWS) {
    const b = viewBasis(v.dir, v.up);
    assert.ok(Math.abs(b.dir.length() - 1) < 1e-9, `${v.id} dir`);
    assert.ok(Math.abs(b.up.length() - 1) < 1e-9, `${v.id} up`);
    assert.ok(Math.abs(b.right.length() - 1) < 1e-9, `${v.id} right`);
    assert.ok(Math.abs(b.dir.dot(b.up)) < 1e-9, `${v.id} dir·up`);
    assert.ok(Math.abs(b.dir.dot(b.right)) < 1e-9, `${v.id} dir·right`);
    assert.ok(Math.abs(b.up.dot(b.right)) < 1e-9, `${v.id} up·right`);
    // no roll: for every view but the two vertical ones the right vector stays horizontal, and the
    // vertical ones look straight down, so the world +Y is up on screen there
    if (v.id === 'top' || v.id === 'bottom') assert.ok(Math.abs(b.up.dot(new THREE.Vector3(0, 1, 0)) - 1) < 1e-9, `${v.id} is not upright`);
    else assert.ok(Math.abs(b.right.z) < 1e-9, `${v.id} is rolled: ${b.right.toArray()}`);
  }
  // left/right/front/rear keep +X or -X to the right, top has +X right and +Y up
  assert.ok(viewBasis(viewDef('top').dir, viewDef('top').up).right.equals(new THREE.Vector3(1, 0, 0)));
  assert.ok(viewBasis(viewDef('front').dir, viewDef('front').up).right.equals(new THREE.Vector3(1, 0, 0)));
  assert.ok(viewBasis(viewDef('left').dir, viewDef('left').up).right.equals(new THREE.Vector3(0, -1, 0)));
  assert.ok(viewBasis(viewDef('rear').dir, viewDef('rear').up).right.equals(new THREE.Vector3(-1, 0, 0)));
  assert.equal(viewByKey('3'), 'front');
  assert.equal(viewByKey('k'), undefined);
});

test('fitFrame centres the box and puts the camera at the tightest distance that fits it', () => {
  const b = box([-50, -50, -50], [50, 50, 50]);
  for (const v of VIEWS) {
    const frame = fitFrame(b, v.dir, v.up, FOV, ASPECT);
    assert.ok(frame.target.equals(new THREE.Vector3(0, 0, 0)), `${v.id} target`);
    assert.ok(cornersInside(b, frame), `${v.id}: a corner is outside the frustum`);
    // 8 % margin, so 10 % closer must cut the box
    assert.ok(!cornersInside(b, frame, 0.12), `${v.id}: the frame is far too wide`);
  }
  // the distance follows the direction: closer from the front of a flat box than from above it
  const flat = box([-100, -100, 0], [100, 100, 2]);
  const top = fitFrame(flat, viewDef('top').dir, viewDef('top').up, FOV, ASPECT);
  const front = fitFrame(flat, viewDef('front').dir, viewDef('front').up, FOV, ASPECT);
  assert.ok(top.distance > front.distance, `${top.distance} <= ${front.distance}`);
  // a wider viewport needs a shorter distance (the cube is limited by the vertical frustum, so the
  // comparison uses an aspect below 1 as well)
  const wide = fitFrame(b, viewDef('front').dir, viewDef('front').up, FOV, 2);
  const narrow = fitFrame(b, viewDef('front').dir, viewDef('front').up, FOV, 0.5);
  assert.ok(wide.distance < narrow.distance, `${wide.distance} >= ${narrow.distance}`);
  // a bigger margin moves the camera away, a smaller one closer
  const loose = fitFrame(b, viewDef('front').dir, viewDef('front').up, FOV, ASPECT, 0.5);
  const tight = fitFrame(b, viewDef('front').dir, viewDef('front').up, FOV, ASPECT, 0);
  assert.ok(loose.distance > tight.distance, `${loose.distance} <= ${tight.distance}`);
});

test('an offset box is framed around its own centre', () => {
  const b = box([100, 100, 0], [120, 140, 10]);
  const frame = fitFrame(b, viewDef('iso').dir, viewDef('iso').up, FOV, ASPECT);
  assert.ok(frame.target.equals(new THREE.Vector3(110, 120, 5)), frame.target.toArray().join(','));
  assert.ok(cornersInside(b, frame));
});

test('the orthographic frustum shows the same area as the perspective view at the same distance', () => {
  const distance = 400;
  const height = orthoFrustumHeight(distance, FOV);
  assert.ok(Math.abs(height - 2 * distance * Math.tan((FOV * Math.PI) / 360)) < 1e-9);
  // round trip: the frustum and the distance that produces it
  assert.ok(Math.abs(orthoFitDistance(height, FOV) - distance) < 1e-9);
  // frustum of 90° is twice the distance, of 0° zero
  assert.ok(Math.abs(orthoFrustumHeight(100, 90) - 200) < 1e-9);
  assert.ok(Math.abs(orthoFrustumHeight(100, 0)) < 1e-9);
  const extents = orthoExtents(height, ASPECT);
  assert.ok(Math.abs(extents.halfHeight - height / 2) < 1e-9);
  assert.ok(Math.abs(extents.halfWidth - (height / 2) * ASPECT) < 1e-9);
});

test('a box fitted for the perspective camera also fits the orthographic frustum it switches to', () => {
  const b = box([0, 0, 0], [250, 210, 90]);
  for (const v of VIEWS) {
    const frame = fitFrame(b, v.dir, v.up, FOV, ASPECT);
    const { halfHeight, halfWidth } = orthoExtents(orthoFrustumHeight(frame.distance, FOV), ASPECT);
    const basis = viewBasis(frame.position.clone().sub(frame.target), frame.up);
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(frame.target);
      // an ortho camera shows the whole frustum at any depth, so the depth plays no part
      assert.ok(Math.abs(corner.dot(basis.up)) <= halfHeight + 1e-9, `${v.id} vertical`);
      assert.ok(Math.abs(corner.dot(basis.right)) <= halfWidth + 1e-9, `${v.id} horizontal`);
    }
  }
});
