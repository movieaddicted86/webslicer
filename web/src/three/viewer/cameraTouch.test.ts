/**
 * The touch camera maths: an orbit keeps the target and the distance, the pinch scales the distance
 * and pans in the camera's own plane, and both stay inside the viewer's bounds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAX_DISTANCE, MIN_DISTANCE, ORBIT_SPEED, cameraBasis, clampDistance, orbitStep, pinchStep, worldPerPixel } from './cameraTouch';

const target = () => new THREE.Vector3(125, 105, 0);
/** The base view of the plater: from the front right, above, looking at the bed's centre. */
const position = () => new THREE.Vector3(325, -145, 250);
const up = () => new THREE.Vector3(0, 0, 1);

test('a distance is kept between the viewer’s bounds', () => {
  assert.equal(clampDistance(1), MIN_DISTANCE);
  assert.equal(clampDistance(1e6), MAX_DISTANCE);
  assert.equal(clampDistance(300), 300);
});

test('an orbit turns the camera around the target and keeps both the target and the distance', () => {
  const t = target();
  const p = position();
  const u = up();
  const next = orbitStep(t, p, u, 100, 0);
  // the target does not move and the radius stays exactly
  assert.ok(next.distanceTo(t) - p.distanceTo(t) < 1e-9);
  assert.ok(next.distanceTo(p) > 1, 'the camera really moved');
  // 100 px at the orbit speed is that much of a turn around the world's up axis
  const before = Math.atan2(p.y - t.y, p.x - t.x);
  const after = Math.atan2(next.y - t.y, next.x - t.x);
  const turned = Math.abs(before - after);
  assert.ok(Math.abs(turned - 100 * ORBIT_SPEED) < 1e-6, `turned ${turned}`);
  // the height is only touched by the elevation, which this step did not do
  assert.ok(Math.abs(next.z - p.z) < 1e-9);
});

test('a vertical orbit lifts the camera and turns the up vector with it', () => {
  const t = target();
  const p = position();
  const u = up();
  const next = orbitStep(t, p, u, 0, 120);
  assert.ok(next.z > p.z, 'the camera went up');
  assert.ok(next.distanceTo(t) - p.distanceTo(t) < 1e-9);
  // the up vector is no longer the world's Z alone: the horizon follows the elevation
  assert.ok(u.distanceTo(new THREE.Vector3(0, 0, 1)) > 0.01);
  assert.ok(Math.abs(u.length() - 1) < 1e-9);
});

test('a pinch apart zooms in, a pinch together zooms out, and the target stays', () => {
  const t = target();
  const p = position();
  const u = up();
  const d0 = p.distanceTo(t);
  const closer = pinchStep(t, p, u, 2, 0, 0, 1);
  assert.ok(Math.abs(closer.position.distanceTo(closer.target) - d0 / 2) < 1e-9);
  const farther = pinchStep(t, p, u, 0.5, 0, 0, 1);
  assert.ok(Math.abs(farther.position.distanceTo(farther.target) - d0 * 2) < 1e-9);
  // no midpoint movement, no pan
  assert.ok(closer.target.distanceTo(t) < 1e-9);
});

test('a pinch stays inside the distance bounds', () => {
  const t = target();
  const p = position();
  const u = up();
  const closer = pinchStep(t, p, u, 1e6, 0, 0, 1);
  assert.ok(Math.abs(closer.position.distanceTo(closer.target) - MIN_DISTANCE) < 1e-9);
  const farther = pinchStep(t, p, u, 1e-6, 0, 0, 1);
  assert.ok(Math.abs(farther.position.distanceTo(farther.target) - MAX_DISTANCE) < 1e-9);
});

test('the midpoint pans in the camera’s own plane, by the millimetres per pixel', () => {
  const t = target();
  const p = position();
  const u = up();
  const basis = cameraBasis(t, p, u);
  const mm = 0.5;
  // a finger that moves right drags the model right, which moves the target to the camera's left
  const moved = pinchStep(t, p, u, 1, 20, -10, mm);
  const shift = moved.target.clone().sub(t);
  assert.ok(Math.abs(shift.dot(basis.right) + 20 * mm) < 1e-9, `right component ${shift.dot(basis.right)}`);
  assert.ok(Math.abs(shift.dot(basis.up) + 10 * mm) < 1e-9, `up component ${shift.dot(basis.up)}`);
  // and the camera follows the target, so the distance is unchanged
  assert.ok(Math.abs(moved.position.distanceTo(moved.target) - p.distanceTo(t)) < 1e-9);
});

test('millimetres per pixel follows the shown height and the viewport', () => {
  assert.equal(worldPerPixel(200, 400), 0.5);
  assert.equal(worldPerPixel(200, 0), 200);
});

test('the camera basis is orthonormal and looks straight at the target', () => {
  const t = target();
  const p = position();
  const { right, up: camUp } = cameraBasis(t, p, up());
  assert.ok(Math.abs(right.length() - 1) < 1e-9);
  assert.ok(Math.abs(camUp.length() - 1) < 1e-9);
  assert.ok(Math.abs(right.dot(camUp)) < 1e-9);
  assert.ok(Math.abs(right.dot(p.clone().sub(t).normalize())) < 1e-9);
});
