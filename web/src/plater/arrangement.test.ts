/**
 * The browser side of the arrangement (T-084): the plan the Arrange button applies, on the same
 * fixture the headless server arranges in `server/src/services/projects.test.ts` – two L brackets
 * and a cube. Both suites pin the same positions, which is what keeps the two entry points on one
 * algorithm.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '@webslicer/shared';
import { arrangePlan, packOptionsOf, type ArrangeSettings } from './arrangement.js';
import type { PlaterInstance, PlaterObject } from '../state/types';

/** The L bracket sample (40 × 40 × 10 mm, a quarter cut away) as a triangle soup, centred in X/Y. */
const L_OUTLINE: Array<[number, number]> = [
  [0, 0],
  [40, 0],
  [40, 15],
  [15, 40],
  [0, 40],
];

function lBracketSoup(): Float32Array {
  const out: number[] = [];
  const at = (x: number, y: number, z: number) => out.push(x - 20, y - 20, z);
  for (let i = 0; i < L_OUTLINE.length; i++) {
    const [ax, ay] = L_OUTLINE[i];
    const [bx, by] = L_OUTLINE[(i + 1) % L_OUTLINE.length];
    at(ax, ay, 0);
    at(bx, by, 0);
    at(bx, by, 10);
    at(ax, ay, 0);
    at(bx, by, 10);
    at(ax, ay, 10);
  }
  // the flat top and bottom, as the two boxes the L's arms describe
  for (const z of [0, 10]) {
    for (const [x0, y0, x1, y1] of [
      [0, 0, 15, 40],
      [15, 0, 40, 15],
    ]) {
      at(x0, y0, z);
      at(x1, y0, z);
      at(x1, y1, z);
      at(x0, y0, z);
      at(x1, y1, z);
      at(x0, y1, z);
    }
  }
  return Float32Array.from(out);
}

/** A 20 mm cube's triangle soup, centred in X/Y, standing on Z = 0. */
function cubeSoup(size = 20): Float32Array {
  const s = size / 2;
  const p = (i: number, j: number, k: number) => [i * s, j * s, k * size] as const;
  const quads: number[][] = [
    [...p(-1, -1, 1), ...p(1, -1, 1), ...p(1, 1, 1), ...p(-1, 1, 1)],
    [...p(-1, -1, 0), ...p(-1, 1, 0), ...p(1, 1, 0), ...p(1, -1, 0)],
    [...p(1, -1, 0), ...p(1, 1, 0), ...p(1, 1, 1), ...p(1, -1, 1)],
    [...p(-1, -1, 0), ...p(-1, -1, 1), ...p(-1, 1, 1), ...p(-1, 1, 0)],
    [...p(-1, 1, 0), ...p(-1, 1, 1), ...p(1, 1, 1), ...p(1, 1, 0)],
    [...p(-1, -1, 0), ...p(1, -1, 0), ...p(1, -1, 1), ...p(-1, -1, 1)],
  ];
  return Float32Array.from(
    quads.flatMap(([ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz]) => [
      ax,
      ay,
      az,
      bx,
      by,
      bz,
      cx,
      cy,
      cz,
      ax,
      ay,
      az,
      cx,
      cy,
      cz,
      dx,
      dy,
      dz,
    ]),
  );
}

/** A mesh the plater's readers can use: a position attribute and a bounding box they compute. */
function geometryOf(soup: Float32Array) {
  let box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null = null;
  return {
    get boundingBox() {
      return box;
    },
    computeBoundingBox() {
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (let i = 0; i < soup.length; i += 3) {
        for (const [axis, k] of [
          ['x', 0],
          ['y', 1],
          ['z', 2],
        ] as const) {
          min[axis] = Math.min(min[axis], soup[i + k]);
          max[axis] = Math.max(max[axis], soup[i + k]);
        }
      }
      box = { min, max };
    },
    getIndex: () => null,
    getAttribute: () => ({ count: soup.length / 3, array: soup }),
  };
}

function instance(id: string): PlaterInstance {
  return { id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

/** A plater object with one instance at the origin, traced from a geometry. */
function object(id: string, name: string, geometry: ReturnType<typeof geometryOf>, size: [number, number, number]): PlaterObject {
  return {
    id,
    name,
    geometry: geometry as unknown as PlaterObject['geometry'],
    instances: [instance(`inst-${id}`)],
    size,
    config: {},
    extruder: 0,
    visible: true,
    triangles: 20,
    volumes: [],
    ranges: [],
  } as unknown as PlaterObject;
}

/** The fixture: two L brackets and one cube, all at the origin before the arrange. */
function plate(): PlaterObject[] {
  return [
    object('obj-1', 'l_bracket', geometryOf(lBracketSoup()), [40, 40, 10]),
    object('obj-2', 'l_bracket', geometryOf(lBracketSoup()), [40, 40, 10]),
    object('obj-3', 'cube', geometryOf(cubeSoup()), [20, 20, 20]),
  ];
}

const PRINTER: Config = { bed_shape: '0x0,250x0,250x210,0x210', max_print_height: '210', nozzle_diameter: '0.4' };
const SETTINGS: ArrangeSettings = { rotations: false, alignment: 'center' };
const BED = { min: [0, 0] as [number, number], max: [250, 210] as [number, number], points: [] as Array<[number, number]> };

/** The footprint centres the plan moves each instance to. */
function centres(plan: Map<string, { position: [number, number, number] }>, objects: PlaterObject[]): Array<[number, number]> {
  return objects.flatMap((o) =>
    o.instances.map((i) => {
      const update = plan.get(`${o.id}:${i.id}`);
      assert.ok(update, `${o.id}:${i.id} placed`);
      // every instance stands at the origin with its mesh centred, so the position is the centre
      return [Math.round(update.position[0] * 10) / 10, Math.round(update.position[1] * 10) / 10] as [number, number];
    }),
  );
}

test('the browser arranges the L bracket fixture and the headless server agrees (AC-2)', () => {
  const options = packOptionsOf({ print: { current: {} }, printer: { current: PRINTER } }, SETTINGS);
  // the same margins the plate check uses: the default 6 mm plus one 6 mm skirt loop of 0.4 mm
  assert.equal(options.spacing, 6);
  assert.equal(options.edgeReserve, 6.4);
  const objects = plate();
  const plan = arrangePlan(objects, { ...BED, points: options.bedPolygon ?? [] }, options);
  assert.ok(plan, 'the fixture fits the 250 x 210 bed');
  assert.equal(plan.size, 3);
  assert.deepEqual(centres(plan, objects), [
    [89, 105],
    [135, 105],
    [171, 95],
  ]);
});
