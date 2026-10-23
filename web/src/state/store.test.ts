/**
 * The plater store's behaviour, pinned before `store.ts` is split into slices (R-6): the actions the
 * browser suite (UAT) drives, asserted on the *resulting* state – instance positions (1e-9), counts,
 * selection, modified flags, toast texts – never on how the slices are wired.
 *
 * Node lacks `fetch` and `localStorage`, so the file installs a small fake server for
 * `/api/presets/*` and `/api/models` (the two endpoints the plater actions call) plus an in-memory
 * `localStorage`; nothing else of the store is stubbed. `init()` is deliberately not used: every
 * test starts by selecting the printer preset, which loads the print/filament presets through
 * `ensureCompatiblePresets` – the same path the real startup takes.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { useStore, isModified, pickedInstanceId, selectedInstance } from './store';
import type { Config, PresetType, ResolvedPreset } from '@webslicer/shared';

/** Bed of the printer preset below: 250 × 210 mm, the rectangle every arrange assertion works in. */
const BED = '0x0,250x0,250x210,0x210';
const PRINTER = 'Original Prusa i3 MK3S & MK3S+';

/** The presets the fake server hands out; `- default FFF -` is the empty fallback, as on the real one. */
function presetConfigs(): Record<PresetType, Record<string, Config>> {
  return {
    print: {
      '- default FFF -': { layer_height: '0.2', perimeters: '2' },
      '0.20mm NORMAL': { layer_height: '0.2', perimeters: '2' },
      '0.25mm DRAFT': { layer_height: '0.25', perimeters: '2' },
    },
    filament: { '- default FFF -': {}, 'Prusament PLA': { filament_colour: '#FF8000' } },
    printer: {
      '- default FFF -': { bed_shape: BED, nozzle_diameter: '0.4' },
      [PRINTER]: {
        bed_shape: BED,
        nozzle_diameter: '0.4',
        default_print_profile: '0.20mm NORMAL',
        default_filament_profile: 'Prusament PLA',
      },
    },
    // the plater handles no SLA presets; the schema's type union covers them
    sla_print: {},
    sla_material: {},
  };
}

/** Everything the fake server remembers between requests; `resetEnv` puts it back per test. */
const server = {
  presets: presetConfigs(),
  saved: {} as Record<string, Config>,
  deleted: [] as string[],
  uploads: 0,
};

function configOf(type: PresetType, name: string): Config {
  return server.saved[`${type}:${name}`] ?? server.presets[type][name] ?? {};
}

function resolved(type: PresetType, name: string, config: Config): ResolvedPreset {
  return { type, name, system: !server.saved[`${type}:${name}`], config, overrides: {} };
}

/** The routes the store uses; an unexpected request fails the test instead of hitting the network. */
async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const { pathname } = new URL(String(input), 'http://localhost');
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  // the model upload posts an ArrayBuffer, so only a JSON content type may be parsed
  const body = headers.get('Content-Type') === 'application/json' ? (JSON.parse(String(init.body)) as { config: Config }) : undefined;
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const match = /^\/api\/presets\/(print|filament|printer)(?:\/(.*))?$/.exec(pathname);
  if (match) {
    const type = match[1] as PresetType;
    const rest = match[2];
    const names = (): string[] =>
      [...Object.keys(server.presets[type]), ...Object.keys(server.saved).map((k) => k.split(':')[1])]
        .filter((n, i, all) => all.indexOf(n) === i)
        .filter((n) => !server.deleted.includes(`${type}:${n}`));
    if (rest === 'list') return json(names().map((name) => ({ type, name, system: !server.saved[`${type}:${name}`], compatible: true })));
    const name = decodeURIComponent(rest ?? '');
    if (method === 'PUT') {
      server.saved[`${type}:${name}`] = body?.config ?? {};
      return json(resolved(type, name, configOf(type, name)));
    }
    if (method === 'DELETE') {
      server.deleted.push(`${type}:${name}`);
      delete server.saved[`${type}:${name}`];
      return json({ ok: true });
    }
    return json(resolved(type, name, configOf(type, name)));
  }
  if (pathname === '/api/models' && method === 'POST') {
    server.uploads++;
    const filename = decodeURIComponent(headers.get('X-Filename') ?? '');
    return json({ id: `model-${server.uploads}`, name: filename, triangles: 12 });
  }
  throw new Error(`unexpected request: ${method} ${pathname}`);
}

const memory = new Map<string, string>();
const localStore = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
};

/** The state as it was before the first test: the store itself is a module singleton. */
const PRISTINE = useStore.getState();
const realSetTimeout = globalThis.setTimeout;

beforeEach(async () => {
  server.presets = presetConfigs();
  server.saved = {};
  server.deleted = [];
  server.uploads = 0;
  memory.clear();
  (globalThis as { fetch: unknown }).fetch = fakeFetch;
  (globalThis as { localStorage: unknown }).localStorage = localStore;
  // Timers keep their behaviour, but must not hold the test process open (toasts, reslice debounce).
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    const t = realSetTimeout(fn, ms);
    (t as { unref?: () => void }).unref?.();
    return t;
  }) as unknown as typeof setTimeout;
  useStore.setState(PRISTINE, true);
  // startup's own path: the printer preset brings the print and filament presets along
  await useStore.getState().selectPreset('printer', PRINTER);
});

const st = () => useStore.getState();

/** One cube as the loader hands it over: non-indexed, centred in X/Y, standing on Z = 0. */
function box(size = 10, at: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  g.translate(at[0], at[1], at[2]);
  return g;
}

/** Two separate cubes in one soup – what "Split to objects" gets to split. */
function twoCubes(gap = 30): THREE.BufferGeometry {
  const parts = [box(10), box(10, [gap, 0, 0])].map((g) => g.getAttribute('position').array as Float32Array);
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(all, 3));
}

function closePoint(actual: readonly number[], expected: readonly number[], what = ''): void {
  assert.equal(actual.length, expected.length, `${what}: ${actual.length} != ${expected.length}`);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= 1e-9, `${what}: [${actual}] != [${expected}]`));
}

/** The plater as data: ids, names, every instance transform (1e-9) and the volume ids. */
function snapshot() {
  return st().objects.map((o) => ({
    id: o.id,
    name: o.name,
    instances: o.instances.map((i) => ({ id: i.id, position: i.position, rotation: i.rotation, scale: i.scale })),
    volumes: o.volumes.map((v) => v.id),
  }));
}

const importOne = (geometry: THREE.BufferGeometry, name = 'cube.stl') => st().addObjects([{ name, geometry }]);

test('selecting the printer preset loads the compatible print and filament presets', async () => {
  assert.equal(st().presets.printer.name, PRINTER);
  assert.equal(st().presets.print.name, '0.20mm NORMAL');
  assert.deepEqual(
    st().presets.filament.map((f) => f.name),
    ['Prusament PLA'],
  );
  assert.equal(isModified(st().presets.print), false);
  assert.equal(st().sliceDirty, true);
  // the selection is what survives a reload
  assert.deepEqual(JSON.parse(memory.get('webslicer.selection') ?? '{}'), {
    print: '0.20mm NORMAL',
    filament: ['Prusament PLA'],
    printer: PRINTER,
    mode: 'advanced',
  });
});

test('addObjects imports a model onto the bed centre and uploads it', async () => {
  await importOne(box(10));
  const [o] = st().objects;
  assert.equal(st().objects.length, 1);
  assert.equal(o.name, 'cube.stl');
  assert.deepEqual(o.size, [10, 10, 10]);
  assert.equal(o.triangles, 12);
  assert.equal(o.instances.length, 1);
  closePoint(o.instances[0].position, [125, 105, 0], 'bed centre');
  closePoint(o.instances[0].scale, [1, 1, 1]);
  assert.deepEqual(st().selectedIds, [o.id]);
  assert.equal(st().selectedInstanceId, undefined);
  assert.equal(st().sliceDirty, true);
  // the mesh went to the server as binary STL: 84 byte header + 12 triangles × 50
  assert.equal(server.uploads, 1);
  assert.equal(o.modelId, 'model-1');
});

test('addObjects keeps a project import at its own instance transform', async () => {
  // a mesh whose own frame already stands on Z = 0, as a 3MF object's coordinates do
  await st().addObjects(
    [
      {
        name: 'project.3mf',
        geometry: box(10, [0, 0, 5]),
        instances: [{ position: [40, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      },
    ],
    { keepPositions: true },
  );
  const [o] = st().objects;
  // the build item's transform is kept instead of the bed centre, and no arrange rewrites it
  closePoint(o.instances[0].position, [40, 0, 0], 'project place');
  assert.equal(st().undoStack.length, 1, 'one undo step, recording the plater as it was');
  st().undo();
  assert.deepEqual(st().objects, [], 'undo puts the plater back');
});

test('select replaces the selection, additive adds to it, and picks the instance helpers', async () => {
  await importOne(box(10));
  await importOne(box(10), 'second.stl');
  const [a, b] = st().objects;
  st().select([a.id, b.id]);
  assert.deepEqual(st().selectedIds, [a.id, b.id]);
  st().select([a.id]);
  assert.equal(st().selectedIds.length, 1);
  st().select([b.id], true);
  assert.deepEqual(st().selectedIds, [a.id, b.id]);
  st().select([a.id], true);
  assert.deepEqual(st().selectedIds, [a.id, b.id], 'additive never selects twice');
  // selecting the object row alone picks no instance; selectInstance does
  st().select([a.id]);
  assert.equal(selectedInstance(st(), a).id, a.instances[0].id);
  assert.equal(pickedInstanceId({ ...st(), selectedIds: [a.id] }, a), undefined);
  st().addInstances(a.id, 1);
  const second = st().objects[0].instances[1].id;
  st().selectInstance(a.id, second);
  assert.equal(st().selectedInstanceId, second);
  assert.equal(pickedInstanceId({ ...st(), selectedIds: [a.id] }, st().objects[0]), second);
});

test('addInstances copies the selected instance and arranges the copies on the bed', async () => {
  await importOne(box(10));
  const o = st().objects[0];
  st().addInstances(o.id, 3);
  assert.equal(st().objects[0].instances.length, 4);
  assert.deepEqual(st().selectedIds, [o.id]);
  assert.equal(st().selectedInstanceId, st().objects[0].instances[1].id, 'the first copy is selected');
  // 4 × 16 mm footprints in one row, centred on the 250 × 210 bed
  const placed = st().objects[0].instances.map((i) => i.position);
  closePoint(placed[0], [101, 105, 0]);
  closePoint(placed[1], [117, 105, 0]);
  closePoint(placed[2], [133, 105, 0]);
  closePoint(placed[3], [149, 105, 0]);
  assert.equal(st().toasts.length, 0);
});

test('mirror flips the picked instance in place and keeps it on the bed', async () => {
  await importOne(box(10));
  st().mirror(0);
  const flipped = st().objects[0].instances[0];
  closePoint(flipped.scale, [-1, 1, 1]);
  closePoint(flipped.rotation, [0, 0, 0]);
  closePoint(flipped.position, [125, 105, 0], 'the position is the mirror plane');
  st().mirror(0);
  closePoint(st().objects[0].instances[0].scale, [1, 1, 1], 'mirroring twice is the original');
  assert.equal(st().objects[0].instances.length, 1);
});

test('splitToObjects turns the shells into objects that keep their place', async () => {
  await importOne(twoCubes(), 'pair.stl');
  const before = snapshot();
  const depth = st().undoStack.length;
  await st().splitToObjects(st().objects[0].id);
  const after = st().objects;
  assert.equal(after.length, 2);
  assert.deepEqual(
    after.map((o) => o.name),
    ['pair.stl (1)', 'pair.stl (2)'],
  );
  // the source spans x 0…40, is normalized by 20, and every shell is put back at its own centre
  closePoint(after[0].instances[0].position, [110, 105, 0]);
  closePoint(after[1].instances[0].position, [140, 105, 0]);
  assert.deepEqual(
    st().selectedIds,
    after.map((o) => o.id),
  );
  assert.deepEqual(
    after.map((o) => o.triangles),
    [12, 12],
  );
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Split into 2 objects');
  assert.equal(st().undoStack.length, depth + 1, 'the whole split is one undo step');
  st().undo();
  assert.deepEqual(snapshot(), before, 'one undo brings the original object back');
});

test('splitToParts keeps the largest shell and makes the rest ModelPart volumes', async () => {
  await importOne(twoCubes(), 'pair.stl');
  const o = st().objects[0];
  const before = snapshot();
  const depth = st().undoStack.length;
  await st().splitToParts(o.id);
  const after = st().objects[0];
  assert.equal(st().objects.length, 1);
  assert.equal(after.triangles, 12, 'the main shell only');
  assert.equal(after.volumes.length, 1);
  assert.equal(after.volumes[0].name, 'Part 2');
  assert.equal(after.volumes[0].type, 'ModelPart');
  assert.deepEqual(after.volumes[0].size, [10, 10, 10]);
  closePoint(after.volumes[0].position, [15, 0, 5]);
  assert.equal(after.modelId, 'model-2', 'the re-uploaded main mesh');
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Split into 1 object and 1 parts');
  assert.equal(st().undoStack.length, depth + 1, 'the whole split is one undo step');
  st().undo();
  assert.deepEqual(snapshot(), before);
});

test('arrange packs every instance and refuses without touching the plater', async () => {
  await importOne(box(10));
  await importOne(box(10), 'second.stl');
  assert.equal(st().arrange(), true);
  const placed = st().objects.flatMap((o) => o.instances.map((i) => i.position));
  closePoint(placed[0], [117, 105, 0]);
  closePoint(placed[1], [133, 105, 0]);
  await importOne(box(300), 'huge.stl');
  const before = snapshot();
  const depth = st().undoStack.length;
  assert.equal(st().arrange(), false, '300 mm does not fit a 250 mm bed');
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Not all objects fit on the bed');
  assert.deepEqual(snapshot(), before, 'the plater is left untouched');
  const huge = st().objects[2];
  closePoint(huge.instances[0].position, [125, 105, 0], 'still at the bed centre');
  assert.equal(st().undoStack.length, depth, 'the failed arrange records no undo step');
});

test('the arrange spacing setting changes the gap between the objects (AC-1)', async () => {
  await importOne(box(10));
  await importOne(box(10), 'second.stl');
  st().setArrangeSettings({ spacing: 20 });
  assert.equal(st().arrange(), true);
  const wide = st().objects.map((o) => o.instances[0].position[0]);
  assert.equal(Math.abs(wide[0] - wide[1]), 30, '10 mm cube plus 20 mm spacing');
  st().setArrangeSettings({ spacing: 2 });
  assert.equal(st().arrange(), true);
  const tight = st().objects.map((o) => o.instances[0].position[0]);
  assert.equal(Math.abs(tight[0] - tight[1]), 12, '10 mm cube plus 2 mm spacing');
});

test('the arrange settings are remembered per browser', () => {
  st().setArrangeSettings({ spacing: 20, rotations: true, alignment: 'corner' });
  assert.deepEqual(JSON.parse(memory.get('webslicer.arrange') ?? '{}'), { spacing: 20, rotations: true, alignment: 'corner' });
  // an empty spacing field means "use the print profile" and is stored as absent
  st().setArrangeSettings({ spacing: undefined });
  assert.deepEqual(JSON.parse(memory.get('webslicer.arrange') ?? '{}'), { rotations: true, alignment: 'corner' });
});

test('the rotations setting turns long bars so that they fit (AC-2)', async () => {
  // five bars of 120 × 40 mm: one per row without turning (5 * 46 = 230 > 210), one row turned
  for (let i = 0; i < 5; i++) await st().addObjects([{ name: `bar${i}.stl`, geometry: new THREE.BoxGeometry(120, 40, 40).toNonIndexed() }]);
  assert.equal(st().arrange(), false, 'the plain layout does not fit');
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Not all objects fit on the bed');
  st().setArrangeSettings({ rotations: true });
  assert.equal(st().arrange(), true);
  for (const o of st().objects) {
    const inst = o.instances[0];
    assert.ok(Math.abs(Math.abs(inst.rotation[2]) - Math.PI / 2) < 1e-9, `${o.name} is turned: ${inst.rotation}`);
    // the turned footprint is 40 mm across x and 120 mm across y, so the centre stays well inside
    assert.ok(inst.position[0] >= 20 - 1e-9 && inst.position[0] <= 230 + 1e-9, `x in bed: ${inst.position[0]}`);
    assert.ok(inst.position[1] >= 60 - 1e-9 && inst.position[1] <= 150 + 1e-9, `y in bed: ${inst.position[1]}`);
  }
});

test('arrangeSelection moves only the selection and keeps the others in place (AC-3)', async () => {
  await importOne(box(10));
  await importOne(box(10), 'second.stl');
  await importOne(box(10), 'third.stl');
  assert.equal(st().arrange(), true);
  const [first, second, third] = st().objects;
  const beforeFirst = [...first.instances[0].position];
  const kept = [second, third].map((o) => [...o.instances[0].position]);
  st().select([first.id]);
  st().selectInstance(first.id, first.instances[0].id);
  assert.equal(st().arrangeSelection(), true);
  closePoint(st().objects[1].instances[0].position, kept[0], 'the second object stays put');
  closePoint(st().objects[2].instances[0].position, kept[1], 'the third object stays put');
  const placed = st().objects.map((o) => o.instances[0].position);
  assert.notDeepEqual(placed[0], beforeFirst, 'the selected instance moved into the free space');
  for (let i = 0; i < placed.length; i++)
    for (let k = i + 1; k < placed.length; k++) {
      const dx = Math.abs(placed[i][0] - placed[k][0]);
      const dy = Math.abs(placed[i][1] - placed[k][1]);
      assert.ok(dx >= 10 - 1e-9 || dy >= 10 - 1e-9, `objects ${i}/${k} overlap`);
    }
  for (const p of placed) assert.ok(p[0] >= 5 && p[0] <= 245 && p[1] >= 5 && p[1] <= 205, `on the bed: ${p}`);
});

test('arrangeSelection without a selection reports it and changes nothing', () => {
  st().select([]);
  const depth = st().undoStack.length;
  assert.equal(st().arrangeSelection(), false);
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Select the objects to arrange first');
  assert.equal(st().undoStack.length, depth);
});

test('fillBedWithInstances fills the bed and reports a full one', async () => {
  await importOne(box(10));
  const o = st().objects[0];
  st().fillBedWithInstances(o.id);
  // 15 footprints of 16 mm per row, 13 rows in a 210 mm bed, minus the one already there
  assert.equal(st().objects[0].instances.length, 195);
  const placed = st().objects[0].instances.map((i) => i.position);
  closePoint(placed[14], [237, 9, 0], 'last copy of the first row');
  closePoint(placed[194], [237, 201, 0], 'last copy of the last row');
  assert.equal(st().toasts.length, 0);
  st().fillBedWithInstances(o.id);
  assert.equal(st().objects[0].instances.length, 195, 'nothing fits any more');
  assert.equal(st().toasts[st().toasts.length - 1].text, 'No room left for another copy');
});

test('removeInstance keeps the last copy, setInstanceCount adds and cuts from the end', async () => {
  await importOne(box(10));
  const o = st().objects[0];
  st().removeInstance(o.id);
  assert.equal(st().objects[0].instances.length, 1, 'AC-1.2: the last instance stays');
  st().addInstances(o.id, 2);
  assert.equal(st().objects[0].instances.length, 3);
  st().removeInstance(o.id, st().objects[0].instances[1].id);
  assert.equal(st().objects[0].instances.length, 2);
  st().setInstanceCount(o.id, 4);
  assert.equal(st().objects[0].instances.length, 4);
  st().setInstanceCount(o.id, 2);
  assert.equal(st().objects[0].instances.length, 2);
  st().setInstanceCount(o.id, 0);
  assert.equal(st().objects[0].instances.length, 2, 'AC-2.1: invalid input changes nothing');
});

test('removeObjects drops objects and their selection, undo brings both back', async () => {
  await importOne(box(10));
  await importOne(box(10), 'second.stl');
  const [a, b] = st().objects;
  st().select([a.id, b.id]);
  st().removeObjects([a.id]);
  assert.deepEqual(
    st().objects.map((o) => o.id),
    [b.id],
  );
  assert.deepEqual(st().selectedIds, [b.id]);
  assert.equal(st().sliceDirty, true);
  st().undo();
  assert.deepEqual(
    st().objects.map((o) => o.id),
    [a.id, b.id],
  );
  assert.deepEqual(st().selectedIds, [b.id], 'the selection is intersected with what came back');
  st().clearObjects();
  assert.deepEqual(st().objects, []);
  assert.deepEqual(st().selectedIds, []);
  assert.deepEqual(st().customGcodes, []);
  assert.equal(st().gcode, undefined);
});

test('undo and redo step through import, instances, arrange and mirror', async () => {
  await importOne(box(10));
  const id = st().objects[0].id;
  st().addInstances(id, 2);
  const afterInstances = snapshot();
  st().mirror(0);
  const afterMirror = snapshot();
  assert.equal(st().objects[0].instances.length, 3);
  // import (state before + arrange), the copies (before + arrange) and the mirror
  assert.equal(st().undoStack.length, 5);

  st().undo();
  assert.deepEqual(snapshot(), afterInstances, 'the mirror is undone');
  st().undo();
  assert.deepEqual(
    st().objects[0].instances.map((i) => i.position),
    [
      [125, 105, 0],
      [125, 105, 0],
      [125, 105, 0],
    ],
    'the arrange of the copies is undone, the copies stay',
  );
  st().undo();
  assert.equal(st().objects[0].instances.length, 1, 'the copies are undone');
  // the import itself and the arrange that followed it
  st().undo();
  st().undo();
  assert.deepEqual(snapshot(), [], 'the import is undone');
  assert.deepEqual(st().selectedIds, []);
  assert.equal(st().undoStack.length, 0);
  assert.equal(st().redoStack.length, 5);

  st().redo();
  assert.equal(st().objects.length, 1);
  assert.equal(st().objects[0].modelId, 'model-1', 'the upload bookkeeping survives the round trip');
  st().redo();
  st().redo();
  st().redo();
  st().redo();
  assert.deepEqual(snapshot(), afterMirror);
  assert.equal(st().redoStack.length, 0);
  assert.equal(st().undoStack.length, 5);
});

test('a preset switch with unsaved changes asks, transfer carries them onto the target', async () => {
  st().setOption('print', 'perimeters', '4');
  assert.equal(isModified(st().presets.print), true);
  await st().requestPresetSwitch('print', '0.25mm DRAFT');
  assert.equal(st().presets.print.name, '0.20mm NORMAL', 'the switch waits for the answer');
  assert.equal(st().dialog, 'unsavedChanges');
  assert.equal(st().pendingSwitch?.target, '0.25mm DRAFT');
  assert.equal(st().pendingSwitch?.source.current.perimeters, '4');

  await st().transferChanges();
  assert.equal(st().presets.print.name, '0.25mm DRAFT');
  assert.equal(st().presets.print.current.perimeters, '4', 'the change came over');
  assert.equal(st().presets.print.current.layer_height, '0.25', 'the target keeps its own values');
  assert.equal(isModified(st().presets.print), true);
  assert.equal(st().pendingSwitch, undefined);
  assert.equal(st().dialog, undefined);
  assert.equal(JSON.parse(memory.get('webslicer.selection') ?? '{}').print, '0.25mm DRAFT');
});

test('a preset switch answers with Save by storing the changed preset first', async () => {
  st().setOption('print', 'perimeters', '4');
  await st().requestPresetSwitch('print', '0.25mm DRAFT');
  await st().savePendingPreset('My print');
  assert.equal(server.saved['print:My print'].perimeters, '4');
  assert.equal(st().presets.print.name, '0.25mm DRAFT');
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Saved print preset "My print"');
  assert.equal(st().dialog, undefined);
});

test('a preset switch without changes goes straight through, discard resets the slot', async () => {
  await st().requestPresetSwitch('print', '0.25mm DRAFT');
  assert.equal(st().presets.print.name, '0.25mm DRAFT');
  assert.equal(st().dialog, undefined);
  st().setOption('print', 'fill_density', '40%');
  st().resetOption('print', 'fill_density');
  assert.equal(isModified(st().presets.print), false, 'reset writes the saved value back');
  st().setOption('print', 'fill_density', '40%');
  st().discardChanges('print');
  assert.equal(isModified(st().presets.print), false);
  assert.equal(st().presets.print.current.fill_density, undefined);
});

test('deletePreset removes the preset and falls back to a compatible one', async () => {
  await st().deletePreset('print', '0.20mm NORMAL');
  assert.deepEqual(server.deleted, ['print:0.20mm NORMAL']);
  assert.equal(st().presets.print.name, '0.25mm DRAFT', 'the next compatible print preset');
  assert.equal(
    st().presetLists.print.some((p) => p.name === '0.20mm NORMAL'),
    false,
  );
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Deleted print preset "0.20mm NORMAL"');
});

// ---------------------------------------------------------------------------
// B2: extruder indices after the extruder count shrinks
// ---------------------------------------------------------------------------

/** A minimal schema with the thrice-repeated per-extruder keys the real one has. */
const B2_SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: ['nozzle_diameter'], sla_print: [], sla_material: [] },
  options: { nozzle_diameter: { key: 'nozzle_diameter', label: 'Nozzle', tooltip: '', type: 'floats', default: '0.4', perExtruder: true } },
} as never;

test('B2: shrinking the extruder count clamps objects, volumes, MMU paint and the paint tool', async () => {
  await importOne(twoCubes());
  const o = st().objects[0];
  useStore.setState({ schema: B2_SCHEMA });
  st().setOption('printer', 'nozzle_diameter', '0.4,0.4,0.4');
  assert.equal(st().extruderCount(), 3);
  st().updateObject(o.id, { extruder: 3 });
  await st().addVolume(o.id, { name: 'part', type: 'ModelPart', geometry: box(5) });
  const volId = st().objects[0].volumes[0].id;
  st().updateVolume(o.id, volId, { extruder: 3 });
  st().updateObject(o.id, { paint: { mmu: Uint8Array.from([0, 3, 2, 1]) } });
  st().setPaintExtruder(3);
  assert.equal(st().paintExtruder, 3);

  st().setExtruderCount(1);
  const after = st().objects[0];
  assert.equal(st().extruderCount(), 1);
  assert.equal(after.extruder, 1, 'the object falls back to extruder 1');
  assert.equal(after.volumes[0].extruder, 1, 'so does its volume');
  assert.deepEqual([...(after.paint?.mmu ?? [])], [0, 1, 1, 1], 'MMU paint above the count becomes extruder 1');
  assert.equal(st().paintExtruder, 1, 'the paint tool cannot stay on a removed extruder');
  assert.equal(st().presets.filament.length, 1);
});

test('B2: the slot actions stay on a filament slot that still exists', async () => {
  useStore.setState({ schema: B2_SCHEMA });
  st().setExtruderCount(3);
  assert.equal(st().presets.filament.length, 3);
  st().setExtruderCount(1);
  // every one of these used to read `filament[2]` and throw
  assert.doesNotThrow(() => st().setOption('filament', 'filament_colour', '#00FF00', 2));
  assert.equal(st().presets.filament[0].current.filament_colour, '#00FF00', 'the edit lands on the last slot');
  assert.doesNotThrow(() => st().resetOption('filament', 'filament_colour', 2));
  assert.doesNotThrow(() => st().discardChanges('filament', 2));
  await assert.doesNotReject(() => st().savePresetAs('filament', 'B2 filament', 2));
  assert.ok(server.saved['filament:B2 filament'], 'saving from a removed slot works');
  assert.equal(st().presets.filament[0].name, 'B2 filament');
});

// ---------------------------------------------------------------------------
// B3: undo/redo keep the MMU paint (and the support/seam paint) of a stroke
// ---------------------------------------------------------------------------

test('B3: undo after a paint stroke restores exactly the previous paint', async () => {
  await importOne(box(10));
  const o = st().objects[0];
  st().updateObject(o.id, { paint: { supports: Uint8Array.from([1, 0, 0, 0]), mmu: Uint8Array.from([0, 2, 0, 0]) } });
  const before = { supports: [...(st().objects[0].paint?.supports ?? [])], mmu: [...(st().objects[0].paint?.mmu ?? [])] };

  st().beginPaintStroke(o.id);
  st().applyPaint(o.id, 'mmu', [1, 2], 3);
  st().applyPaint(o.id, 'supports', [2], 2);
  assert.deepEqual([...(st().objects[0].paint?.mmu ?? [])], [0, 3, 3, 0], 'the stroke painted');

  st().undo();
  const restored = st().objects[0].paint;
  assert.deepEqual([...(restored?.mmu ?? [])], before.mmu, 'undo keeps the MMU paint untouched before the stroke');
  assert.deepEqual([...(restored?.supports ?? [])], before.supports, 'and the support paint');

  // redo puts the stroke back – and a second undo still finds the original paint (no aliasing)
  st().redo();
  assert.deepEqual([...(st().objects[0].paint?.mmu ?? [])], [0, 3, 3, 0], 'redo repeats the stroke');
  st().undo();
  assert.deepEqual([...(st().objects[0].paint?.mmu ?? [])], before.mmu, 'the second undo is not aliased to the live arrays');
});

test('B3: a snapshot never shares paint arrays with the live objects', async () => {
  await importOne(box(10));
  const o = st().objects[0];
  st().updateObject(o.id, { paint: { mmu: Uint8Array.from([1, 1, 1, 0]) } });
  st().recordHistory();
  const snapshot = st().undoStack[st().undoStack.length - 1];
  // painting mutates the live array in place, so the snapshot must not be the same object
  st().applyPaint(o.id, 'mmu', [0, 1, 2], 0);
  assert.deepEqual([...(snapshot[0].paint?.mmu ?? [])], [1, 1, 1, 0], 'the recorded paint is a copy');
});
