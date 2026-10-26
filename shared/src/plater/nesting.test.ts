/**
 * The outline nesting (T-084): the arrangement both the browser and the headless server run. The
 * cases here are the ones the task names – an L part that nests closer than its bounding box, a
 * fixed hull, the fallback to the shelf layout, rotations off/on, determinism and the property that
 * an arranged plate passes the plate check with a skirt or a brim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeItems, packItems, packShelf, fillCount, type BedRect, type PackItem } from './packing.js';
import { arrangeMarginsOf, checkFootprints, type PlateRules } from './plateCheck.js';
import { boxHull, hullOfFlat, hullPenetration, type Hull } from './hull.js';

const BED: BedRect = { min: [0, 0], max: [250, 210] };
const RECT = [
  [0, 0],
  [250, 0],
  [250, 210],
  [0, 210],
] as Array<[number, number]>;

/**
 * An L bracket as the arrange sees it: the convex hull of a 40 mm square with a 40 mm corner cut
 * away. The sheet metal notch itself is concave, so the hull keeps the diagonal – and the free
 * space beside that diagonal is where a small part nests.
 */
const L_OUTLINE: Hull = [
  [0, 0],
  [40, 0],
  [40, 15],
  [15, 40],
  [0, 40],
];

const lItem = (id: string): PackItem => ({ id, width: 40, height: 40, hull: L_OUTLINE });
const cube = (id: string, size = 20): PackItem => ({ id, width: size, height: size });

/** Every item's outline as packed: the hull (turned when the packer did) around the packed centre. */
function hullsAt(items: PackItem[], packed: Array<{ id: string; x: number; y: number; rotated?: boolean; turn?: number }>): Hull[] {
  return packed.map((p) => {
    const item = items.find((i) => i.id === p.id);
    const base = item?.hull ?? boxHull(0, 0, item?.width ?? 0, item?.height ?? 0);
    // the quarter turns the caller then applies to the object, in the same order
    let points = base;
    for (let k = 0; k < (p.rotated ? (p.turn ?? 1) : 0); k++) points = points.map(([x, y]) => [-y, x] as [number, number]);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return points.map(([x, y]) => [p.x + x - cx, p.y + y - cy] as [number, number]);
  });
}

/** The plate footprints of packed items, for `checkFootprints`. */
function footprintsOf(items: PackItem[], packed: Array<{ id: string; x: number; y: number }>) {
  const hulls = hullsAt(items, packed);
  return items.map((item, i) => {
    const hull = hulls[i];
    return {
      objectId: item.id,
      objectName: item.id,
      instanceId: '0',
      minX: Math.min(...hull.map(([x]) => x)),
      minY: Math.min(...hull.map(([, y]) => y)),
      maxX: Math.max(...hull.map(([x]) => x)),
      maxY: Math.max(...hull.map(([, y]) => y)),
      maxZ: 10,
      hull,
    };
  });
}

test('packItems nests a cube into the notch of an L, which the shelf packer cannot (AC-1)', () => {
  const items = [lItem('l1'), cube('c1', 20)];
  const shelf = packShelf(items, BED, { spacing: 2 });
  const packed = packItems(items, BED, { spacing: 2 });
  assert.ok(shelf && packed);
  const spread = (p: Array<{ x: number; y: number }>) => Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x));
  // the cube lands in the 25 mm notch, so the block stays as wide as the L alone
  assert.ok(spread(packed) < spread(shelf), `nested ${spread(packed)} mm, shelf ${spread(shelf)} mm`);
  assert.ok(spread(packed) <= 40 + 1e-6, `nested spread ${spread(packed)} mm fits the notch`);
  // and the outlines really do not cut into each other
  const hulls = hullsAt(items, packed);
  assert.equal(hullPenetration(hulls[0], hulls[1]), 0);
});

test('packItems keeps the requested spacing between outlines and clear of a fixed hull (AC-1)', () => {
  const fixed = [{ id: 'fixed', width: 40, height: 40, x: 60, y: 105, hull: L_OUTLINE }];
  const packed = packItems([cube('a')], BED, { spacing: 6, fixed });
  assert.ok(packed);
  const [a] = packed;
  const fx = 60;
  // the cube is pushed beside the fixed L, never onto it
  assert.ok(a.x > fx + 30 || a.y > 105 + 30 || a.x < fx - 30 || a.y < 105 - 30, `overlap: ${a.x},${a.y}`);
  assert.ok(a.x >= 10 && a.x <= 240 && a.y >= 10 && a.y <= 200);
});

test('packItems falls back to the shelf layout only when the nesting places fewer (AC-1)', () => {
  // five parts the nesting cannot fit (its outline search is greedy) but the shelf rows can
  const boxes = [
    { id: 'i0', width: 23, height: 58 },
    { id: 'i1', width: 58, height: 32 },
    { id: 'i2', width: 25, height: 35 },
    { id: 'i3', width: 51, height: 40 },
    { id: 'i4', width: 26, height: 43 },
  ];
  const bed: BedRect = { min: [0, 0], max: [100, 100] };
  assert.equal(packItems(boxes, bed, { spacing: 0 }), undefined);
  const shelf = packShelf(boxes, bed, { spacing: 0 });
  assert.ok(shelf);
  assert.deepEqual(arrangeItems(boxes, bed, { spacing: 0 }), shelf, 'the shelf result stands in for the nesting');
});

test('packItems turns items only with rotations on, and marks them (AC-1)', () => {
  const items = [lItem('l1'), lItem('l2'), lItem('l3')];
  const plain = packItems(items, BED, { spacing: 6 });
  assert.ok(plain && plain.every((p) => p.rotated === undefined), 'no turn without the option');
  const turned = packItems(items, BED, { spacing: 6, rotations: true });
  assert.ok(turned);
  // the Ls pack into a narrow column instead of a long row once a turn is allowed
  const spreadX = (p: Array<{ x: number }>) => Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x));
  assert.ok(spreadX(turned) < spreadX(plain), `turned ${spreadX(turned)} mm, plain ${spreadX(plain)} mm`);
  // and every turn the packer took is marked on the item, with a quarter turn it can be given
  const marked = turned.filter((p) => p.rotated);
  assert.ok(marked.length > 0, 'at least one item is turned');
  for (const p of marked) assert.ok(p.turn === 1 || p.turn === 2 || p.turn === 3, `turn ${p.turn} on ${p.id}`);
});

test('packItems keeps the edge reserve free for the skirt or brim (AC-1)', () => {
  // a 20 mm cube on a 60 x 60 bed with a 10 mm reserve: the cube has to stay 10 mm off every border
  const small: BedRect = { min: [0, 0], max: [60, 60] };
  const packed = packItems([cube('a')], small, { edgeReserve: 10, alignment: 'corner' });
  assert.ok(packed);
  assert.equal(packed[0].x, 20);
  assert.equal(packed[0].y, 20);
  // without the reserve it sits in the corner
  assert.deepEqual(packItems([cube('a')], small, { alignment: 'corner' }), [{ id: 'a', x: 10, y: 10 }]);
});

test('an arranged plate passes the plate check for a skirt, a brim and sequential printing (AC-1)', () => {
  const cases: PlateRules[] = [
    { ...baseRules(), skirts: 1, skirtDistance: 6 },
    { ...baseRules(), skirts: 0, brimWidth: 5 },
    { ...baseRules(), skirts: 0, completeObjects: true, clearanceRadius: 20 },
  ];
  for (const rules of cases) {
    const margins = arrangeMarginsOf(rules);
    const items = [lItem('l1'), lItem('l2'), cube('c1', 30), cube('c2', 25)];
    const packed = packItems(items, BED, { spacing: margins.spacing, edgeReserve: margins.edgeReserve, bedPolygon: RECT });
    assert.ok(packed, `arranged with ${JSON.stringify(margins)}`);
    const issues = checkFootprints(footprintsOf(items, packed), rules);
    assert.deepEqual(
      issues.filter((i) => i.severity === 'block'),
      [],
      `blocking issues: ${issues.map((i) => i.message).join(', ')}`,
    );
  }
});

test('packItems is deterministic and independent of the list order (AC-1)', () => {
  const items = [cube('a', 30), lItem('b'), cube('c', 25), lItem('d'), cube('e', 15)];
  const once = packItems(items, BED, { spacing: 6, rotations: true });
  const twice = packItems([...items].reverse(), BED, { spacing: 6, rotations: true });
  assert.deepEqual(once, twice);
  assert.deepEqual(packItems(items, BED, { spacing: 6, rotations: true }), once);
});

test('fillCount still counts on the shelf layout (a fill picks a plain footprint)', () => {
  // the grid estimate of 9 x 8 copies on the 250 x 210 bed stays the answer, as before
  assert.equal(fillCount(26, 26, [], BED), 72);
});

/** The default plate rules of the test bed, without a skirt, brim or sequential printing. */
function baseRules(): PlateRules {
  return {
    bed: { min: [0, 0], max: [250, 210], points: RECT },
    maxHeight: 210,
    skirts: 0,
    skirtDistance: 0,
    firstLayerWidth: 0.4,
    brimWidth: 0,
    completeObjects: false,
    clearanceRadius: 0,
  };
}

test('packItems reads a hull from a flat vertex array, as both entry points do', () => {
  const hull = hullOfFlat([0, 0, 0, 40, 0, 0, 40, 15, 0, 15, 15, 0, 15, 40, 0, 0, 40, 0]);
  // the notch corner lies inside the L's outline, so the hull of the six outline points keeps five
  assert.equal(hull.length, 5);
  const packed = packItems([{ id: 'l', width: 40, height: 40, hull }, cube('c')], BED, { spacing: 2 });
  assert.ok(packed);
});
