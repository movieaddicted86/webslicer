/**
 * The plater's packing, bed shape and arrangement spacing (R-4). These are the cases the browser
 * and the server each carried in their own copy of the suite, plus the ones only the two of them
 * together cover: the bed polygon the viewer draws, and the truthy spellings `arrangementSpacing`
 * gained by going through `toBool`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangementSpacing, bedShapeOf, fillCount, packShelf, type BedRect, type PackItem } from './packing.js';

// PrusaSlicer MK4S bed
const BED: BedRect = { min: [0, 0], max: [250, 210] };
const item = (id: string, w: number, h: number): PackItem => ({ id, width: w, height: h });

test('packShelf places a single item in the centre of the bed', () => {
  const packed = packShelf([item('a', 40, 40)], BED);
  assert.ok(packed);
  assert.deepEqual(packed, [{ id: 'a', x: 125, y: 105 }]);
});

test('packShelf keeps every item inside the bed and apart from the others', () => {
  const items = Array.from({ length: 12 }, (_, i) => item(`i${i}`, 26, 26));
  const packed = packShelf(items, BED);
  assert.ok(packed);
  assert.equal(packed.length, 12);
  for (const p of packed) {
    assert.ok(p.x - 13 >= BED.min[0] - 1e-9 && p.x + 13 <= BED.max[0] + 1e-9, `x in bed: ${p.x}`);
    assert.ok(p.y - 13 >= BED.min[1] - 1e-9 && p.y + 13 <= BED.max[1] + 1e-9, `y in bed: ${p.y}`);
  }
  // no two items overlap (centres at least one footprint apart on x or y)
  for (let i = 0; i < packed.length; i++) {
    for (let k = i + 1; k < packed.length; k++) {
      const dx = Math.abs(packed[i].x - packed[k].x);
      const dy = Math.abs(packed[i].y - packed[k].y);
      assert.ok(dx >= 26 - 1e-9 || dy >= 26 - 1e-9, `overlap ${packed[i].id}/${packed[k].id}`);
    }
  }
});

test('packShelf reports an item that is larger than the bed', () => {
  assert.equal(packShelf([item('big', 300, 50)], BED), undefined);
  assert.equal(packShelf([item('tall', 50, 300)], BED), undefined);
});

test('packShelf reports overflow when the items no longer fit', () => {
  const many = Array.from({ length: 100 }, (_, i) => item(`i${i}`, 26, 26));
  assert.equal(packShelf(many, BED), undefined);
});

test('packShelf rejects a degenerate bed', () => {
  assert.equal(packShelf([item('a', 10, 10)], { min: [0, 0], max: [0, 0] }), undefined);
});

test('fillCount fits a 20x20 footprint with 6 mm spacing on a 250x210 bed', () => {
  // footprint including the 6 mm clearance
  const n = fillCount(26, 26, [], BED);
  // grid estimate: floor(250/26) = 9 items per row, floor(210/26) = 8 rows
  assert.equal(n, 72);
});

test('fillCount leaves room for the items already on the bed', () => {
  const existing = [item('e0', 26, 26), item('e1', 26, 26)];
  assert.equal(fillCount(26, 26, existing, BED), fillCount(26, 26, [], BED) - 2);
});

test('fillCount returns 0 when nothing fits', () => {
  assert.equal(fillCount(300, 300, [], BED), 0);
  const full = Array.from({ length: 72 }, (_, i) => item(`i${i}`, 26, 26));
  assert.equal(fillCount(26, 26, full, BED), 0);
  assert.equal(fillCount(0, 20, [], BED), 0);
});

test('fillCount never exceeds the limit', () => {
  assert.equal(fillCount(26, 26, [], BED, 5), 5);
  assert.equal(fillCount(26, 26, [], BED, 1000), 72);
});

test('fillCount reserves the bed space of a larger item already placed', () => {
  const existing = [item('e0', 120, 120)];
  const n = fillCount(26, 26, existing, BED);
  assert.ok(n > 0 && n < 72, `expected fewer than 72 copies, got ${n}`);
  const copies = Array.from({ length: n }, (_, i) => item(`c${i}`, 26, 26));
  assert.ok(packShelf([...existing, ...copies], BED), 'the resulting layout still fits');
  assert.equal(packShelf([...existing, ...copies, item('more', 26, 26)], BED), undefined, 'one more does not fit');
});

test('bedShapeOf reads the bed rectangle of a printer preset', () => {
  const rect = (cfg: Record<string, string>) => {
    const { min, max } = bedShapeOf(cfg);
    return { min, max };
  };
  assert.deepEqual(rect({ bed_shape: '0x0,250x0,250x210,0x210' }), { min: [0, 0], max: [250, 210] });
  // a missing or broken shape falls back to 200x200 at the origin
  assert.deepEqual(rect({}), { min: [0, 0], max: [200, 200] });
  assert.deepEqual(rect({ bed_shape: 'nonsense' }), { min: [0, 0], max: [200, 200] });
});

test('bedShapeOf keeps the polygon the bed outline is drawn from', () => {
  // the browser draws the bed from `points`, the server only needs min/max – one return shape serves
  // both, so the corners come out as written instead of as a rectangle
  const shape = bedShapeOf({ bed_shape: '0x0,250x0,250x210,0x210' });
  assert.deepEqual(shape.points, [
    [0, 0],
    [250, 0],
    [250, 210],
    [0, 210],
  ]);
  // a point without both coordinates is dropped, and the polygon follows the surviving ones
  assert.deepEqual(bedShapeOf({ bed_shape: '0x0,250x0,broken,10x20' }).points, [
    [0, 0],
    [250, 0],
    [10, 20],
  ]);
});

test('arrangementSpacing uses the extruder clearance only with sequential printing', () => {
  assert.equal(arrangementSpacing({}), 6);
  assert.equal(arrangementSpacing({ extruder_clearance_radius: '20' }), 6);
  assert.equal(arrangementSpacing({ extruder_clearance_radius: '20', complete_objects: '1' }), 20);
  assert.equal(arrangementSpacing({ extruder_clearance_radius: '20', complete_objects: 'true' }), 20);
  assert.equal(arrangementSpacing({ extruder_clearance_radius: '0', complete_objects: '0' }), 6);
});

test('arrangementSpacing reads every spelling of a true preset value', () => {
  // the vendor presets write booleans as 1/true/yes/on, not just '1': a plain `=== '1'` check (the
  // server copy had one) arranged a sequential print as if the extruder had no clearance to keep
  for (const complete_objects of ['1', 'true', 'True', 'yes', 'YES', 'on', ' on ']) {
    assert.equal(arrangementSpacing({ extruder_clearance_radius: '20', complete_objects }), 20, complete_objects);
  }
  for (const complete_objects of ['0', 'false', 'no', 'off', '']) {
    assert.equal(arrangementSpacing({ extruder_clearance_radius: '20', complete_objects }), 6, complete_objects);
  }
  // a radius that is missing, zero or not a number always keeps the fixed gap
  assert.equal(arrangementSpacing({ complete_objects: '1' }), 6);
  assert.equal(arrangementSpacing({ extruder_clearance_radius: 'abc', complete_objects: '1' }), 6);
});
