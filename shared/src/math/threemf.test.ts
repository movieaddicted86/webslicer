/**
 * The 3MF transform pair (R-3, ported from `server/src/slicer/threemf.test.ts`).
 *
 * `M -> transformTo3mf -> transformFrom3mf -> M` has to hold for every instance matrix: the writer
 * and the reader are the two halves of one convention (row-major 4x3, translation last), and a
 * project re-imported after an export must not move.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, type Matrix4 } from './matrix.js';
import { transformFrom3mf, transformTo3mf } from './threemf.js';

const closeTo = (a: number[], b: number[], tol = 1e-6) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${i}: ${v} != ${b[i]}`));
};

/** three.js Matrix4.elements of a rotation of `deg` about Z plus the translation (x, y, z). */
function rotZ(deg: number, x = 0, y = 0, z = 0): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // column-major: [m00,m10,m20,m30, m01,m11,m21,m31, m02,m12,m22,m32, m03,m13,m23,m33]
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

test('3MF transform string is row-major with translation last', () => {
  assert.equal(transformTo3mf(IDENTITY), '1 0 0 0 1 0 0 0 1 0 0 0');
  assert.equal(transformTo3mf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]), '1 0 0 0 1 0 0 0 1 10 20 30');
});

test('3MF transform parser handles arbitrary row-major strings', () => {
  // m00 m01 m02 | m10 m11 m12 | m20 m21 m22 | m30 m31 m32  (row-major, translation in the last row)
  // three.js elements are the transpose: the 3x3 block maps straight across, translation -> e12-14
  closeTo(transformFrom3mf('0 1 0 -1 0 0 0 0 1 7 8 9'), [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1]);
  closeTo(transformFrom3mf('1 0 0 0 1 0 0 0 1 2 3 4'), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1]);
  closeTo(transformFrom3mf('  '), IDENTITY);
  closeTo(transformFrom3mf(''), IDENTITY);
});

test('3MF transform round trip M -> string -> M is the identity for rotated, mirrored and scaled matrices', () => {
  // The pair has to be an exact inverse of itself, or a project re-imported after an export silently
  // moves every instance. The cases below are the ones the writer's row-major 4x3 form can get wrong:
  // a 90 degree rotation (R versus R^T, the P1.3 bug), a mirror with a non-uniform scale (negative
  // determinant, so the sign must survive the swap of rows and columns) and a plain scale + offset.
  const cases: Array<[string, Matrix4]> = [
    ['identity', IDENTITY],
    ['90 deg about Z', rotZ(90, 5, 0, 1)],
    ['mirror + non-uniform scale', [0, 1.5, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 10, 20, 0, 1]],
    ['non-uniform scale + offset', [2, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 3, 0, -4, 7, 2, 1]],
  ];
  for (const [name, m] of cases) {
    // the writer prints 6 decimals, so the round trip is exact to that precision and no further
    const back = transformFrom3mf(transformTo3mf(m));
    assert.deepEqual(
      back.map((v, i) => Math.abs(v - m[i]) <= 1e-5),
      back.map(() => true),
      name,
    );
  }
  // The round trip alone cannot see a writer and a reader that are transposed together, so pin the
  // convention as well: row-major 4x3, translation last. R(90 deg about Z) has the rows (0,1,0),
  // (-1,0,0), (0,0,1) – written as such, and read back as a matrix that maps +X to +Y.
  assert.equal(transformTo3mf(rotZ(90, 5, 0, 1)), '0 1 0 -1 0 0 0 0 1 5 0 1');
  const roundTrip = transformFrom3mf(transformTo3mf(rotZ(90, 5, 0, 1)));
  closeTo([roundTrip[0], roundTrip[1], roundTrip[2]], [0, 1, 0], 1e-5);
  closeTo(roundTrip.slice(12), [5, 0, 1, 1], 1e-5);
  assert.equal(transformTo3mf([0, 1.5, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 10, 20, 0, 1]), '0 1.5 0 1 0 0 0 0 2 10 20 0');
});
