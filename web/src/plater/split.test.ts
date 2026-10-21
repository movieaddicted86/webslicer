import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellPositions, signedVolume, splitShells } from './split.js';

/** Axis-aligned cube as a triangle soup: 6 faces, 2 triangles each, 12 triangles (36 vertices). */
function cube(size: number, at: [number, number, number] = [0, 0, 0], invert = false): number[] {
  const [x, y, z] = at;
  const s = size;
  const p = (i: number, j: number, k: number): number[] => [x + i * s, y + j * s, z + k * s];
  const quads: number[][] = [
    [...p(0, 0, 1), ...p(1, 0, 1), ...p(1, 1, 1), ...p(0, 1, 1)], // +Z (outward CCW seen from +Z)
    [...p(0, 0, 0), ...p(0, 1, 0), ...p(1, 1, 0), ...p(1, 0, 0)], // -Z
    [...p(1, 0, 0), ...p(1, 1, 0), ...p(1, 1, 1), ...p(1, 0, 1)], // +X
    [...p(0, 0, 0), ...p(0, 0, 1), ...p(0, 1, 1), ...p(0, 1, 0)], // -X
    [...p(0, 1, 0), ...p(0, 1, 1), ...p(1, 1, 1), ...p(1, 1, 0)], // +Y
    [...p(0, 0, 0), ...p(1, 0, 0), ...p(1, 0, 1), ...p(0, 0, 1)], // -Y
  ];
  const out: number[] = [];
  for (const quad of quads) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz] = quad;
    const tri = invert
      ? [ax, ay, az, cx, cy, cz, bx, by, bz, ax, ay, az, dx, dy, dz, cx, cy, cz]
      : [ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz];
    out.push(...tri);
  }
  return out;
}

const soup = (...parts: number[][]): Float32Array => Float32Array.from(parts.flat());

/** Vertices of a shell, welded so the count is independent of the triangle soup layout. */
function vertexCount(positions: Float32Array, tris: Uint32Array): number {
  const keys = new Set<string>();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      keys.add(positions.slice(o, o + 3).join(','));
    }
  }
  return keys.size;
}

test('splitShells finds the three disjoint cubes of a plate', () => {
  const positions = soup(cube(10, [0, 0, 0]), cube(10, [40, 0, 0]), cube(10, [0, 40, 0]));
  const shells = splitShells(positions);
  assert.equal(shells.length, 3);
  for (const s of shells) assert.equal(s.length, 12);
  for (const s of shells) assert.equal(vertexCount(positions, s), 8);
});

test('splitShells joins two cubes that touch along an edge into one shell', () => {
  const positions = soup(cube(10, [0, 0, 0]), cube(10, [10, 10, 0]));
  const shells = splitShells(positions);
  assert.equal(shells.length, 1);
  assert.equal(shells[0].length, 24);
});

test('two cubes that touch face to face weld at their shared corners into one shell', () => {
  // the touching faces share four corners, so the two cubes are one connected shell – the same
  // reading PrusaSlicer has; a plate of separate parts has gaps between them
  const positions = soup(cube(10, [0, 0, 0]), cube(10, [10, 0, 0]));
  const shells = splitShells(positions);
  assert.equal(shells.length, 1);
  assert.equal(shells[0].length, 24);
});

test('splitShells keeps a hollow cube together (inverted inner shell stays with its wall)', () => {
  const positions = soup(cube(20, [0, 0, 0]), cube(8, [6, 6, 6], true));
  const shells = splitShells(positions);
  assert.equal(shells.length, 1);
  assert.equal(shells[0].length, 24);
});

test('a hollow shell without an enclosing shell stays on its own', () => {
  // the inner cube is inverted, but nothing encloses it: it must not be dropped
  const positions = soup(cube(8, [0, 0, 0], true), cube(10, [40, 0, 0]));
  const shells = splitShells(positions);
  assert.equal(shells.length, 2);
});

test('splitShells sorts the shells by volume, largest first', () => {
  const positions = soup(cube(5, [0, 0, 0]), cube(20, [100, 0, 0]), cube(10, [200, 0, 0]));
  const shells = splitShells(positions);
  assert.equal(shells.length, 3);
  const volumes = shells.map((s) => signedVolume(positions, s));
  assert.ok(Math.abs(volumes[0] - 8000) < 1e-9, `largest first: ${volumes[0]}`);
  assert.ok(Math.abs(volumes[1] - 1000) < 1e-9);
  assert.ok(Math.abs(volumes[2] - 125) < 1e-9);
});

test('welding tolerance: vertices that differ by 1e-6 mm still connect', () => {
  const a = cube(10, [0, 0, 0]);
  const b = cube(10, [10, 0, 0]);
  for (let i = 0; i < b.length; i++) b[i] += 1e-6; // the whole second cube a hair along every axis
  const shells = splitShells(soup(a, b));
  assert.equal(shells.length, 1, 'a 1e-6 mm gap is inside the welding grid');
  assert.equal(shells[0].length, 24);
});

test('welding tolerance: a gap above the grid keeps the shells apart', () => {
  const a = cube(10, [0, 0, 0]);
  const b = cube(10, [10.001, 0, 0]); // 0.001 mm short of touching, ten times the grid
  assert.equal(splitShells(soup(a, b)).length, 2);
});

test('splitShells returns nothing for an empty mesh', () => {
  assert.deepEqual(splitShells(new Float32Array(0)), []);
  assert.equal(splitShells(new Float32Array(3)).length, 0, 'an incomplete vertex is not a triangle');
  assert.equal(splitShells(new Float32Array(9)).length, 1, 'a single triangle is one shell');
});

test('sign flips: a plate of three mirrored cubes is still three shells, largest first', () => {
  // a mirrored object is stored with negative scale on the instance, not in the geometry, but a
  // geometry that arrives inside-out must split the same way (negative signed volume, same groups)
  const positions = soup(cube(10, [0, 0, 0], true), cube(20, [40, 0, 0], true), cube(5, [80, 0, 0], true));
  const shells = splitShells(positions);
  assert.equal(shells.length, 3);
  const volumes = shells.map((s) => Math.abs(signedVolume(positions, s)));
  assert.ok(Math.abs(volumes[0] - 8000) < 1e-9, `largest first: ${volumes[0]}`);
});

test('shellPositions and signedVolume describe one shell of a soup', () => {
  const positions = soup(cube(10, [0, 0, 0]), cube(4, [50, 0, 0]));
  const shells = splitShells(positions);
  const first = shellPositions(positions, shells[0]);
  assert.equal(first.length, 12 * 9);
  assert.ok(
    Math.abs(
      signedVolume(
        first,
        Uint32Array.from({ length: 12 }, (_, i) => i),
      ) - 1000,
    ) < 1e-9,
  );
  assert.ok(Math.abs(signedVolume(positions, shells[1]) - 64) < 1e-9);
});
