/**
 * Pins for the plate checks (T-034). Every rule was measured against PrusaSlicer 2.9.6 (the report
 * lists the CLI runs); the cases here are the same scenarios without the slicer: the border, brim
 * off/on, zero skirts, the notch of an L-shaped bed, two instances of one object and sequential
 * printing on/off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFootprints, plateRulesOf, pointInPolygon, rectInsidePolygon, type InstanceFootprint, type PlateRules } from './plateCheck.js';

const RECT = [
  [0, 0],
  [250, 0],
  [250, 210],
  [0, 210],
] as Array<[number, number]>;
/** UAT-05's L-shaped bed: the notch at the back right is not printable. */
const L_BED = [
  [0, 0],
  [200, 0],
  [200, 200],
  [100, 200],
  [0, 120],
] as Array<[number, number]>;

function rules(over: Partial<PlateRules> = {}): PlateRules {
  return {
    bed: { min: [0, 0], max: [250, 210], points: RECT },
    maxHeight: 210,
    skirts: 0,
    skirtDistance: 0,
    firstLayerWidth: 0.4,
    brimWidth: 0,
    completeObjects: false,
    clearanceRadius: 0,
    ...over,
  };
}

/** A 20 mm cube's footprint with its lower-left corner at (x, y). */
function fp(x: number, y: number, objectId = 'obj-1', size = 20, maxZ = 10): InstanceFootprint {
  return { objectId, objectName: objectId, instanceId: `inst-${objectId}`, minX: x, minY: y, maxX: x + size, maxY: y + size, maxZ };
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

test('pointInPolygon counts the boundary as inside and the notch of an L bed as outside', () => {
  assert.equal(pointInPolygon(125, 105, RECT), true);
  assert.equal(pointInPolygon(0, 0, RECT), true, 'corner');
  assert.equal(pointInPolygon(250, 105, RECT), true, 'edge');
  assert.equal(pointInPolygon(-1, 105, RECT), false);
  // the cut corner at the back left: (30, 170) is inside the bed's bounding box but not the polygon
  // (its boundary runs from (0, 120) to (100, 200), so at x = 30 the bed ends at y = 144)
  assert.equal(pointInPolygon(30, 170, L_BED), false);
  assert.equal(pointInPolygon(30, 130, L_BED), true);
  assert.equal(pointInPolygon(150, 170, L_BED), true, 'the same height is on the bed at x = 150');
});

test('rectInsidePolygon accepts a rectangle exactly on the border and rejects one that crosses it', () => {
  assert.equal(rectInsidePolygon(0, 0, 20, 20, RECT), true, 'touching the corner');
  assert.equal(rectInsidePolygon(230, 190, 250, 210, RECT), true, 'touching the far corner');
  assert.equal(rectInsidePolygon(-0.001, 0, 20, 20, RECT), false);
  assert.equal(rectInsidePolygon(20, 160, 40, 180, L_BED), false, 'sits in the cut corner');
  assert.equal(rectInsidePolygon(20, 130, 40, 150, L_BED), false, 'straddles the cut edge');
  assert.equal(rectInsidePolygon(20, 90, 40, 110, L_BED), true, 'below the cut edge is on the bed');
});

test('an object whose bounding box leaves the bed is blocked, exactly on the border is not', () => {
  assert.deepEqual(codes(checkFootprints([fp(0, 0)], rules())), []);
  assert.deepEqual(codes(checkFootprints([fp(-0.5, 100)], rules())), ['plate.outside']);
  assert.equal(checkFootprints([fp(-0.5, 100)], rules())[0].severity, 'block');
  // every instance counts: two cubes, one off the back edge
  assert.deepEqual(codes(checkFootprints([fp(10, 10), fp(100, 195)], rules())), ['plate.outside']);
});

test('an object in the notch of an L-shaped bed is outside (the polygon, not its bounding box)', () => {
  const r = rules({ bed: { min: [0, 0], max: [200, 200], points: L_BED } });
  assert.deepEqual(codes(checkFootprints([fp(20, 160)], r)), ['plate.outside']);
  assert.deepEqual(codes(checkFootprints([fp(130, 100)], r)), []);
  assert.deepEqual(codes(checkFootprints([fp(100, 120)], r)), []);
});

test('a too-tall object is blocked, at the limit it is not', () => {
  assert.deepEqual(codes(checkFootprints([fp(100, 100, 'obj-1', 20, 210)], rules())), []);
  assert.deepEqual(codes(checkFootprints([fp(100, 100, 'obj-1', 20, 210.5)], rules())), ['plate.too_tall']);
});

test('skirts: 0 gives no skirt issue, a skirt near the edge is blocked, away from it is clean', () => {
  // object 1 mm from the left edge, no skirt: the object itself is inside
  assert.deepEqual(codes(checkFootprints([fp(1, 100)], rules({ skirts: 0 }))), []);
  // skirt_distance 2 plus one 0.4 loop reaches 2.4 mm past the edge
  assert.deepEqual(codes(checkFootprints([fp(1, 100)], rules({ skirts: 1, skirtDistance: 2 }))), ['plate.skirt_outside']);
  // the same skirt with the object 3 mm in clears it
  assert.deepEqual(codes(checkFootprints([fp(3, 100)], rules({ skirts: 1, skirtDistance: 2 }))), []);
  // the skirt wraps all objects: the union box, not each object on its own
  assert.deepEqual(codes(checkFootprints([fp(60, 60), fp(100, 60)], rules({ skirts: 1, skirtDistance: 2 }))), []);
  // the last loop is 2 + loops × 0.4 out: 2.4 for one loop clears a 2.5 mm inset, 3.2 for three does not
  const one = checkFootprints([fp(2.5, 100)], rules({ skirts: 1, skirtDistance: 2 }));
  const three = checkFootprints([fp(2.5, 100)], rules({ skirts: 3, skirtDistance: 2 }));
  assert.deepEqual(codes(one), []);
  assert.deepEqual(codes(three), ['plate.skirt_outside']);
});

test('brim: off means no brim issue, on grows every instance by its width', () => {
  assert.deepEqual(codes(checkFootprints([fp(2, 100)], rules({ brimWidth: 0 }))), []);
  assert.deepEqual(codes(checkFootprints([fp(2, 100)], rules({ brimWidth: 5 }))), ['plate.brim_outside']);
  assert.deepEqual(codes(checkFootprints([fp(6, 100)], rules({ brimWidth: 5 }))), []);
  // exactly at the edge: the brim ends on the border
  assert.deepEqual(codes(checkFootprints([fp(5, 100)], rules({ brimWidth: 5 }))), []);
  // two instances of one object: one of them runs off
  const issues = checkFootprints([fp(50, 50), { ...fp(50, 50), instanceId: 'inst-2', minX: 1, maxX: 21 }], rules({ brimWidth: 5 }));
  assert.deepEqual(codes(issues), ['plate.brim_outside']);
  assert.deepEqual(issues[0].objectIds, ['obj-1']);
});

test('overlap: PrusaSlicer rejects toolpaths that collide by more than ~2 widths, so do we', () => {
  // side by side, no penetration
  assert.deepEqual(codes(checkFootprints([fp(10, 10, 'a'), fp(30, 10, 'b')], rules())), []);
  // 1 mm penetration (> 2 × 0.4 × 0.95 = 0.76) is refused, 0.5 mm is accepted (2.9 accepts 0.76)
  assert.deepEqual(codes(checkFootprints([fp(10, 10, 'a'), fp(29, 10, 'b')], rules())), ['plate.overlap']);
  assert.deepEqual(codes(checkFootprints([fp(10, 10, 'a'), fp(29.5, 10, 'b')], rules())), []);
  // a wider first layer widens the limit: 1 mm is then accepted, 1.5 mm is refused
  const wide = rules({ firstLayerWidth: 0.6 });
  assert.deepEqual(codes(checkFootprints([fp(10, 10, 'a'), fp(29, 10, 'b')], wide)), []);
  assert.deepEqual(codes(checkFootprints([fp(10, 10, 'a'), fp(28.5, 10, 'b')], wide)), ['plate.overlap']);
  // two instances of the same object can collide just as well
  const same = checkFootprints([fp(10, 10), { ...fp(10, 10), instanceId: 'inst-2', minX: 15, maxX: 35 }], rules());
  assert.deepEqual(codes(same), ['plate.overlap']);
  // stacking in Z does not help: PrusaSlicer still reports a conflict
  const stacked = checkFootprints([fp(10, 10, 'a'), fp(15, 10, 'b')], rules());
  assert.deepEqual(codes(stacked), ['plate.overlap']);
});

test('sequential printing: a tight pair warns, a far pair does not, and the severity is warn', () => {
  // 10 mm gap with a 20 mm clearance radius
  const tight = checkFootprints([fp(10, 10, 'a'), fp(40, 10, 'b')], rules({ completeObjects: true, clearanceRadius: 20 }));
  assert.deepEqual(codes(tight), ['plate.clearance']);
  assert.equal(tight[0].severity, 'warn', 'PrusaSlicer 2.9 slices it anyway');
  assert.deepEqual(codes(checkFootprints([fp(10, 10, 'a'), fp(60, 10, 'b')], rules({ completeObjects: true, clearanceRadius: 20 }))), []);
  // without sequential printing the same pair is fine
  assert.deepEqual(codes(checkFootprints([fp(10, 10, 'a'), fp(40, 10, 'b')], rules({ completeObjects: false, clearanceRadius: 20 }))), []);
});

test('blocking issues come first and carry the affected object ids', () => {
  const issues = checkFootprints(
    [fp(10, 10, 'a'), fp(40, 10, 'b')],
    rules({ completeObjects: true, clearanceRadius: 60, skirts: 1, skirtDistance: 20 }),
  );
  assert.equal(issues[0].severity, 'block');
  assert.equal(issues[issues.length - 1].severity, 'warn');
  assert.deepEqual(issues.find((i) => i.code === 'plate.skirt_outside')?.objectIds, ['a', 'b']);
});

test('plateRulesOf reads the widths and switches of the presets', () => {
  const r = plateRulesOf(
    { bed_shape: '0x0,250x0,250x210,0x210', max_print_height: '210', nozzle_diameter: '0.4,0.4' },
    {
      skirts: '3',
      skirt_distance: '2',
      brim_type: 'outer_only',
      brim_width: '5',
      complete_objects: '1',
      extruder_clearance_radius: '20',
    },
  );
  assert.deepEqual(r.bed.points, RECT);
  assert.equal(r.maxHeight, 210);
  assert.equal(r.skirts, 3);
  assert.equal(r.skirtDistance, 2);
  assert.equal(r.firstLayerWidth, 0.4, 'no first-layer width set: the nozzle width');
  assert.equal(r.brimWidth, 5);
  assert.equal(r.completeObjects, true);
  assert.equal(r.clearanceRadius, 20);
  // brim "none" is no brim, whatever brim_width says; an explicit first-layer width wins
  const off = plateRulesOf(
    { bed_shape: '', max_print_height: '200', nozzle_diameter: '0.6' },
    { brim_type: 'none', brim_width: '5', first_layer_extrusion_width: '0.8', skirts: '0' },
  );
  assert.equal(off.brimWidth, 0);
  assert.equal(off.firstLayerWidth, 0.8);
  assert.equal(off.skirts, 0);
  assert.equal(off.bed.points.length, 4, 'the default bed');

  // keys a preset leaves out fall back to PrusaSlicer's defaults: one skirt 6 mm out, no brim
  const defaults = plateRulesOf({ bed_shape: '', max_print_height: '200', nozzle_diameter: '0.4' }, { brim_width: '5' });
  assert.equal(defaults.skirts, 1);
  assert.equal(defaults.skirtDistance, 6);
  assert.equal(defaults.brimWidth, 5, 'brim_type defaults to outer_only, so brim_width applies');
  const brimOutside = plateRulesOf(
    { bed_shape: '', max_print_height: '200', nozzle_diameter: '0.4' },
    { brim_type: 'outer_only', brim_width: '5' },
  );
  assert.equal(brimOutside.brimWidth, 5);
  // a percentage first-layer width is a share of the layer height, like the slicer's "200%"
  const pct = plateRulesOf(
    { bed_shape: '', max_print_height: '200', nozzle_diameter: '0.4' },
    { first_layer_extrusion_width: '200%', first_layer_height: '0.2' },
  );
  assert.equal(pct.firstLayerWidth, 0.4);
});
