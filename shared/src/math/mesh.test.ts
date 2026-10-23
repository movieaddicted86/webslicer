/**
 * T-042: the measurements of the object info and the merge maths. The cube cases are the ones the
 * task names: 8 cm³ for a 20 mm cube, 4 open edges for a cube with one missing face, and a merge that
 * leaves every part where it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, invert, multiply, placementFromMatrix, placementMatrix } from './matrix.js';
import { mergedVolume, meshStats, meshVolume, openEdgeCount, soupBounds, transformSoup } from './mesh.js';

/**
 * Axis-aligned cube as a non-indexed triangle soup with outward (CCW) faces, optionally without its
 * +Z face – the open box `openEdgeCount` is measured on.
 */
function cube(size: number, at: [number, number, number] = [0, 0, 0], withoutTop = false): Float64Array {
  const [x, y, z] = at;
  const s = size;
  const p = (i: number, j: number, k: number): number[] => [x + i * s, y + j * s, z + k * s];
  const quads: number[][] = [
    [...p(0, 0, 1), ...p(1, 0, 1), ...p(1, 1, 1), ...p(0, 1, 1)], // +Z
    [...p(0, 0, 0), ...p(0, 1, 0), ...p(1, 1, 0), ...p(1, 0, 0)], // -Z
    [...p(1, 0, 0), ...p(1, 1, 0), ...p(1, 1, 1), ...p(1, 0, 1)], // +X
    [...p(0, 0, 0), ...p(0, 0, 1), ...p(0, 1, 1), ...p(0, 1, 0)], // -X
    [...p(0, 1, 0), ...p(0, 1, 1), ...p(1, 1, 1), ...p(1, 1, 0)], // +Y
    [...p(0, 0, 0), ...p(1, 0, 0), ...p(1, 0, 1), ...p(0, 0, 1)], // -Y
  ];
  const faces = withoutTop ? quads.slice(1) : quads;
  const out: number[] = [];
  for (const [ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz] of faces) {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
  }
  return Float64Array.from(out);
}

test('the volume of a 20 mm cube is 8 cm³', () => {
  assert.equal(meshVolume(cube(20)), 8000);
  assert.ok(Math.abs(meshStats(cube(20)).volume / 1000 - 8) < 1e-9);
});

test('the volume does not depend on where the cube sits', () => {
  assert.equal(meshVolume(cube(20, [100, -50, 30])), 8000);
});

test('an inverted (inside-out) soup has a negative volume', () => {
  const soup = cube(10);
  for (let t = 0; t + 8 < soup.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const tmp = soup[t + 3 + k];
      soup[t + 3 + k] = soup[t + 6 + k];
      soup[t + 6 + k] = tmp;
    }
  }
  assert.equal(meshVolume(soup), -1000);
});

test('a closed cube has no open edges, a cube with one missing face has four', () => {
  assert.equal(openEdgeCount(cube(20)), 0);
  assert.equal(openEdgeCount(cube(20, [0, 0, 0], true)), 4);
});

test('a merge keeps the world position of every vertex', () => {
  // the target sits rotated and moved; the source sits somewhere else and is scaled
  const target = placementMatrix({ position: [10, 20, 0], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 1] });
  const source = placementMatrix({ position: [-30, 5, 2], rotation: [0.3, 0, 0], scale: [2, 2, 2] });
  const mesh = cube(10);
  const volume = mergedVolume(target, source, mesh);
  assert.ok(volume);
  // the volume mesh, placed by its own transform inside the target, is the source in the world
  const placed = transformSoup(volume.vertices, multiply(target, placementMatrix(volume.placement)));
  const sourceWorld = transformSoup(mesh, source);
  for (let i = 0; i < volume.vertices.length; i += 3) {
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(placed[i + a] - sourceWorld[i + a]) < 1e-6, `vertex ${i / 3}.${a}`);
  }
  // and the merged part is centred in the target's frame, ready to be a volume there
  const box = soupBounds(volume.vertices);
  assert.ok(Math.abs((box.min[0] + box.max[0]) / 2) < 1e-9);
  assert.ok(Math.abs((box.min[1] + box.max[1]) / 2) < 1e-9);
  assert.ok(Math.abs((box.min[2] + box.max[2]) / 2) < 1e-9);
});

test('mergedVolume returns undefined for a singular target', () => {
  assert.equal(mergedVolume(placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 1, 1] }), IDENTITY, cube(1)), undefined);
});

test('invert undoes a placement matrix', () => {
  const m = placementMatrix({ position: [3, -4, 5], rotation: [0.2, 0.4, -0.7], scale: [2, 0.5, 1.5] });
  const back = invert(m);
  assert.ok(back);
  const product = multiply(m, back);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(product[i] - IDENTITY[i]) < 1e-9, `entry ${i}`);
  assert.equal(invert(placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 1, 1] })), undefined);
});

test('placementFromMatrix is the inverse of placementMatrix for the merged placement', () => {
  const target = placementMatrix({ position: [10, 20, 0], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 1] });
  const source = placementMatrix({ position: [-30, 5, 2], rotation: [0.3, 0, 0], scale: [2, 2, 2] });
  const volume = mergedVolume(target, source, cube(10));
  assert.ok(volume);
  const m = placementMatrix(volume.placement);
  const back = placementFromMatrix(m);
  assert.deepEqual(
    back.position.map((v) => Math.round(v * 1e6) / 1e6),
    volume.placement.position.map((v) => Math.round(v * 1e6) / 1e6),
  );
});
