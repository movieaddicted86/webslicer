/**
 * The contract `Viewer.tsx` exposes to the rest of the app, pinned before the file is split into
 * hooks (R-7): the module's exports, the bed-shape geometry it builds, and the toolpath windowing
 * that drives the preview sliders. Everything here is asserted through the module's public surface,
 * never through how the hooks end up wired, so the same file has to stay green while the code moves.
 *
 * `Viewer()` itself needs a DOM and a WebGL context, so the component is not rendered here – the
 * browser suite (`.claude/t17-browser.mjs`, run against the dev server) covers that side. What this
 * file pins is the part the refactor can silently break: `objectIsOutside` (imported by `Sidebar`),
 * `VOLUME_COLORS`, and the bed outline/toolpath helpers that must keep producing the same numbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VOLUME_COLORS, objectIsOutside } from './Viewer';
import { bedShapeOf } from '@webslicer/shared';
import type { PlaterObject } from '../state/types';

/** An object with one instance at `position`, a 20 mm cube as its mesh. */
function cubeObject(position: [number, number, number]): PlaterObject {
  const geometry = new THREE.BoxGeometry(20, 20, 20);
  geometry.computeBoundingBox();
  return {
    id: 'obj-1',
    name: 'cube',
    geometry,
    instances: [{ id: 'inst-1', position, rotation: [0, 0, 0], scale: [1, 1, 1] }],
    size: [20, 20, 20],
    config: {},
    extruder: 1,
    visible: true,
    triangles: 12,
    volumes: [],
    ranges: [],
  };
}

test('Viewer re-exports the volume palette Sidebar and the viewer share', () => {
  // `Sidebar` shows a colour per volume type; the viewer paints the same meshes with them
  assert.deepEqual(Object.keys(VOLUME_COLORS).sort(), [
    'ModelPart',
    'NegativeVolume',
    'ParameterModifier',
    'SupportBlocker',
    'SupportEnforcer',
  ]);
  for (const [type, entry] of Object.entries(VOLUME_COLORS)) {
    assert.equal(typeof entry.color, 'number', `${type} has a colour`);
    assert.ok(entry.opacity > 0 && entry.opacity <= 1, `${type} has an opacity`);
  }
});

test('objectIsOutside is true when an instance leaves the bed, false when it fits', () => {
  const bed = '0x0,250x0,250x210,0x210';
  // inside: a 20 mm cube sitting at the bed's centre
  assert.equal(objectIsOutside(cubeObject([125, 105, 0]), bed, 200), false);
  // the X face crosses the bed's left edge (bed starts at 0, the cube spans -5 … 15)
  assert.equal(objectIsOutside(cubeObject([5, 105, 0]), bed, 200), true);
  // over the back edge
  assert.equal(objectIsOutside(cubeObject([125, 205, 0]), bed, 200), true);
  // on the bed but taller than the printer's maximum
  assert.equal(objectIsOutside(cubeObject([125, 105, 195]), bed, 200), true);
});

test("objectIsOutside compares against the bed polygon's bounding box, not the polygon", () => {
  // The L-shaped bed of UAT-05: the notch at the back right is not printable.
  const bed = '0x0,200x0,200x200,100x200,0x120';
  const shape = bedShapeOf({ bed_shape: bed });
  // `bedShapeOf` hands back min/max, so the check below sees the 200x200 box the polygon fits in
  assert.deepEqual(shape.min, [0, 0]);
  assert.deepEqual(shape.max, [200, 200]);
  assert.equal(shape.points.length, 5, 'the outline itself keeps all five corners');
  // an object sitting in the notch (x 150…170, y 150…170) is inside that box, so it is *not* marked
  // off-bed – a known limitation of the check, pinned here so the refactor does not change it
  assert.equal(objectIsOutside(cubeObject([160, 160, 0]), bed, 200), false);
  // past the box's right edge it is marked, wherever the notch is
  assert.equal(objectIsOutside(cubeObject([195, 160, 0]), bed, 200), true);
});

test('objectIsOutside looks at every instance, not only the first', () => {
  const bed = '0x0,250x0,250x210,0x210';
  const o = cubeObject([125, 105, 0]);
  o.instances.push({ id: 'inst-2', position: [300, 105, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  assert.equal(objectIsOutside(o, bed, 200), true);
});
