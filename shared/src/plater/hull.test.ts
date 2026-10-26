/**
 * The hull geometry of the plate checks (T-078): the convex hull of a mesh's bed projection, the
 * containment and clearance tests and the SAT penetration the conflict rule reads. The cases are the
 * ones the task names – a box (the same verdicts the bounding box gave), a part turned 45° in the L
 * bed's cut corner, two interlocking outlines that do not penetrate – plus the primitives they use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxHull,
  convexHull2D,
  hullArea,
  hullBox,
  hullClearanceToPolygon,
  hullGap,
  hullInsidePolygon,
  hullOfFlat,
  hullPenetration,
  pointInPolygon,
  unionHull,
  type Point2,
} from './hull.js';
import { rectInsidePolygon } from './plateCheck.js';

const close = (actual: number, expected: number, eps = 1e-6) => Math.abs(actual - expected) <= eps;

const RECT: Point2[] = [
  [0, 0],
  [250, 0],
  [250, 210],
  [0, 210],
];
/** UAT-05's L-shaped bed: the cut corner at the back left is not printable. */
const L_BED: Point2[] = [
  [0, 0],
  [200, 0],
  [200, 200],
  [100, 200],
  [0, 120],
];

/** The corners of a `width` × `height` box turned `angleDeg` around its centre. */
function rotatedBox(width: number, height: number, angleDeg: number, cx = 0, cy = 0): Point2[] {
  const a = (angleDeg * Math.PI) / 180;
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ].map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)] as Point2);
}

/** The flat xyz vertices of a box 0…size in every direction. */
function boxVertices(size: number): number[] {
  const out: number[] = [];
  for (const x of [0, size]) for (const y of [0, size]) for (const z of [0, size]) out.push(x, y, z);
  return out;
}

test('convexHull2D of a box is its four corners, counter-clockwise, without collinear points', () => {
  const hull = convexHull2D([...boxHull(0, 0, 20, 20), [5, 5], [10, 0], [10, 10]]);
  assert.deepEqual(hull, [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ]);
  assert.ok(close(hullArea(hull), 400));
});

test('hullOfFlat projects the XY vertices and ignores Z', () => {
  assert.deepEqual(hullOfFlat(boxVertices(20)), [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ]);
});

test('a rotated box keeps its area and its corners move onto the axes', () => {
  const hull = convexHull2D(rotatedBox(20, 20, 45));
  assert.equal(hull.length, 4);
  assert.ok(close(hullArea(hull), 400), 'a rotation does not change the area');
  // a turned square stands on its diagonal: one corner on each axis, 10·√2 from the centre
  for (const [x, y] of hull)
    assert.ok(
      (close(Math.abs(x), 10 * Math.SQRT2, 1e-6) && close(y, 0, 1e-6)) || (close(Math.abs(y), 10 * Math.SQRT2, 1e-6) && close(x, 0, 1e-6)),
    );
});

test('the hull of an arc is a half disc, clearly smaller than its bounding box', () => {
  // a cable-holder-like arc: the ring slice of radius 20 … 24 over a half turn (-90° … 90°)
  const arc: Point2[] = [];
  for (const r of [20, 24])
    for (let d = -90; d <= 90; d += 5) arc.push([r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180)]);
  const hull = convexHull2D(arc);
  const box = hullBox(hull);
  const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY);
  assert.ok(close(box.minX, 0, 1e-6) && close(box.maxX, 24, 1e-6), 'the arc is only half a ring wide');
  // 5° chords cut a sliver off the half disc: within a few mm² of π·24²/2
  assert.ok(close(hullArea(hull), (Math.PI * 24 * 24) / 2, 6), 'the empty middle of the ring is not in the hull');
  assert.ok(hullArea(hull) < 0.8 * boxArea, 'the hull is smaller than the box');
});

test('hullInsidePolygon: on the border is inside, an edge that crosses the bed is not', () => {
  assert.equal(hullInsidePolygon(boxHull(0, 0, 20, 20), RECT), true);
  assert.equal(hullInsidePolygon(boxHull(230, 190, 250, 210), RECT), true, 'the far corner, on the border');
  assert.equal(hullInsidePolygon(boxHull(-0.001, 0, 20, 20), RECT), false);
  assert.equal(hullInsidePolygon(boxHull(20, 160, 40, 180), L_BED), false, 'sits in the cut corner');
  assert.equal(hullInsidePolygon(boxHull(20, 130, 40, 150), L_BED), false, 'straddles the cut edge');
  assert.equal(hullInsidePolygon(boxHull(20, 90, 40, 110), L_BED), true);
});

test('a part turned 45° fits under the L bed’s diagonal edge where its bounding box does not', () => {
  // a 20 × 20 mm square turned 45° is a diamond with its four points on the axes, half-diagonal 10·√2;
  // place its top point exactly on the bed edge from (0, 120) to (100, 200)
  const centre: Point2 = [60, 120 + 0.8 * 60 - 10 * Math.SQRT2];
  const diamond = convexHull2D(rotatedBox(20, 20, 45, centre[0], centre[1]));
  assert.equal(hullInsidePolygon(diamond, L_BED), true, 'the diamond stays under the edge');
  const box = hullBox(diamond);
  assert.equal(hullInsidePolygon(boxHull(box.minX, box.minY, box.maxX, box.maxY), L_BED), false, 'its box crosses the edge');
  assert.equal(rectInsidePolygon(box.minX, box.minY, box.maxX, box.maxY, L_BED), false, 'so the old box check rejected it');
});

test('an L-shaped part yields the pentagon around its notch – conservative on purpose', () => {
  const l: Point2[] = [
    [0, 0],
    [40, 0],
    [40, 20],
    [20, 20],
    [20, 40],
    [0, 40],
  ];
  const hull = convexHull2D(l);
  assert.equal(hull.length, 5, 'the inner corner (20, 20) lies inside the hull and is dropped');
  assert.ok(close(hullArea(hull), 1400), 'the pentagon: 200 mm² more than the L itself (1200)');
});

test('two diagonal bars overlap by their boxes but not by their hulls', () => {
  // two 40 × 8 mm bars turned 45°, 10 mm apart across their width: their hulls leave a 2 mm gap,
  // their bounding boxes (~34 × 34 each) overlap by more than 20 mm per axis
  const a = convexHull2D(rotatedBox(40, 8, 45, 50, 50));
  const across = 10 / Math.SQRT2;
  const b = convexHull2D(rotatedBox(40, 8, 45, 50 - across, 50 + across));
  const boxA = hullBox(a);
  const boxB = hullBox(b);
  assert.ok(Math.min(boxA.maxX, boxB.maxX) - Math.max(boxA.minX, boxB.minX) > 20, 'boxes overlap in x');
  assert.ok(Math.min(boxA.maxY, boxB.maxY) - Math.max(boxA.minY, boxB.minY) > 20, 'boxes overlap in y');
  assert.equal(hullPenetration(a, b), 0, 'the bars do not touch');
  assert.ok(close(hullGap(a, b), 2, 0.01), 'they are 2 mm apart, across their width');
});

test('the hull of a concave part covers its opening – conservative, as documented', () => {
  // a U-shaped wall and a bar inside its opening: the wall's hull is the solid rectangle
  const wall = unionHull([boxHull(0, 0, 20, 10), boxHull(0, 10, 4, 40), boxHull(16, 10, 20, 40)]);
  const bar = boxHull(6, 12, 14, 38);
  assert.equal(hullPenetration(wall, bar), 8, 'the bar lies inside the hull of the U');
  assert.equal(hullPenetration(bar, wall), 8, 'the measure is symmetric');
});

test('hullPenetration is the depth of the smallest push, as the box intersection was', () => {
  const a = boxHull(10, 10, 30, 30);
  assert.ok(close(hullPenetration(a, boxHull(29, 10, 49, 30)), 1), '1 mm side by side');
  assert.equal(hullPenetration(a, boxHull(30, 10, 50, 30)), 0, 'touching is no penetration');
  assert.ok(close(hullPenetration(a, boxHull(25, 25, 45, 45)), 5), 'the shallow axis wins (5 mm, not 15)');
  assert.equal(hullPenetration(a, boxHull(50, 50, 60, 60)), 0, 'apart');
  // a turned square pushed into a box penetrates, measured along its own edges too
  assert.ok(hullPenetration(a, convexHull2D(rotatedBox(20, 20, 45, 25, 25))) > 0);
});

test('hullGap between two diagonal outlines is the true distance', () => {
  const a = boxHull(0, 0, 10, 10);
  assert.ok(close(hullGap(a, boxHull(13, 14, 20, 20)), 5), '3-4-5 triangle between the corners');
  assert.equal(hullGap(a, boxHull(5, 5, 15, 15)), 0, 'overlapping is 0');
});

test('hullClearanceToPolygon measures the room left for a skirt or a brim', () => {
  assert.ok(close(hullClearanceToPolygon(boxHull(3, 3, 20, 20), RECT), 3));
  assert.equal(hullClearanceToPolygon(boxHull(0, 0, 20, 20), RECT), 0, 'touching the border');
  assert.equal(hullClearanceToPolygon(boxHull(20, 130, 40, 150), L_BED), 0, 'an edge crossing the border');
});

test('hullInsidePolygon with a margin is the room the skirt or brim needs', () => {
  const inner = boxHull(3, 3, 20, 20);
  assert.equal(hullInsidePolygon(inner, RECT, 3), true, 'exactly the margin is enough');
  assert.equal(hullInsidePolygon(inner, RECT, 3.5), false);
  assert.equal(hullInsidePolygon(boxHull(0, 0, 20, 20), RECT, 1), false, 'touching the border leaves no room');
});

test('pointInPolygon treats the border as inside (the bed and a hull share the rule)', () => {
  assert.equal(pointInPolygon(0, 0, L_BED), true, 'corner');
  assert.equal(pointInPolygon(0, 120, L_BED), true, 'corner of the cut');
  assert.equal(pointInPolygon(30, 170, L_BED), false, 'in the cut corner');
});
