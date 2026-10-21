/**
 * Server-side projects: the slice request they produce, the arrange layout and the TTL life cycle.
 * The schema is a stub – `resolvePreset` only needs the preset keys and the option defaults, and the
 * default presets resolve without a vendor bundle.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-plater-'));
process.env.DATA_DIR = DATA_DIR;

const { config, ensureDirs } = await import('../config.js');
const { validateSliceRequest } = await import('../services/slice.js');
const {
  keepModelIds,
  addModelFromLibrary,
  arrange,
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  pruneProjects,
  toSliceRequest,
  touchProject,
} = await import('./projects.js');
const { writeBinaryStl } = await import('../slicer/threemf.js');
const { saveModel } = await import('../services/models.js');
const { setActiveSchema } = await import('../services/schema.js');
const { IDENTITY, instanceBounds } = await import('@webslicer/shared');

const DEFAULT_PRINTER = '- default FFF -';
const DEFAULT_PRINT = '- default FFF -';

const schema = {
  slicerVersion: 'test',
  options: {},
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
} as never as import('../slicer/schema.js').Schema;

const CUBE = {
  vertices: Float32Array.from([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20]),
  indices: Uint32Array.from([
    0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3, 4, 6, 5, 4, 5, 7, 5, 6, 7, 6, 4, 7, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4,
    3, 4, 0,
  ]),
};

/** A library file with a cube, and the folder tree around it. */
function libraryFile(name: string, mesh = CUBE): string {
  const dir = path.join(config.libraryDir, 'models');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), writeBinaryStl(mesh));
  return `models/${name}`;
}

before(() => {
  ensureDirs();
  setActiveSchema(schema);
});
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const newProject = (overrides: Record<string, unknown> = {}) =>
  createProject({ schema, printer: { name: DEFAULT_PRINTER, config: {} }, print: { name: DEFAULT_PRINT, config: {} }, ...overrides });

test('createProject stores the presets and rejects unknown ones', async () => {
  const project = await newProject();
  assert.equal(project.printer.name, DEFAULT_PRINTER);
  assert.equal(project.objectCount, undefined); // no derived fields leak into the file
  assert.deepEqual(project.objects, []);
  assert.equal(project.owner, 'admin');
  assert.ok(Date.parse(project.expiresAt) > Date.now(), 'a fresh project is alive');
  assert.ok(await loadProject(project.id), 'the project is on disk');

  await assert.rejects(() => newProject({ printer: { name: 'No Such Printer', config: {} } }), /Unknown printer preset/);
  await assert.rejects(() => newProject({ print: { name: 'No Such Print', config: {} } }), /Unknown print preset/);
  await assert.rejects(() => newProject({ filaments: [{ name: 'No Such Filament', config: {} }] }), /Unknown filament preset/);
  await assert.rejects(() => newProject({ printer: { name: '  ', config: {} } }), /preset name required/);
});

test('addModelFromLibrary stores the mesh, normalises it and applies the copies', async () => {
  const project = await newProject();
  const file = libraryFile('cube20.stl');
  await addModelFromLibrary(project, file, 3);
  assert.equal(project.objects.length, 1);
  const o = project.objects[0];
  assert.equal(o.name, 'cube20');
  assert.equal(o.instances.length, 3);
  // the normalised mesh is centred in X/Y with the minimum Z on the bed
  assert.deepEqual(o.bounds.min, [-10, -10, 0]);
  assert.deepEqual(o.bounds.max, [10, 10, 20]);
  // the instance puts the copy back where the STL had it
  assert.deepEqual(o.instances[0], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 10, 0, 1]);
  assert.ok(fs.existsSync(path.join(config.modelsDir, `${o.modelId}.stl`)), 'the mesh is in the model directory');
  assert.ok(fs.existsSync(path.join(config.modelsDir, `${o.modelId}.json`)), 'with its metadata');

  const reloaded = (await loadProject(project.id))!;
  assert.equal(reloaded.objects.length, 1);
  assert.deepEqual(reloaded.objects[0].bounds, o.bounds);
});

test('addModelFromLibrary rejects escapes, missing files, bad copies and unknown formats', async () => {
  const project = await newProject();
  await assert.rejects(() => addModelFromLibrary(project, '../secrets.stl'), /invalid path/);
  await assert.rejects(() => addModelFromLibrary(project, 'models/nope.stl'), /library file not found/);
  await assert.rejects(() => addModelFromLibrary(project, 'models/nope.stl', 0), /copies must be an integer/);
  const obj = libraryFile('thing.obj');
  await assert.rejects(() => addModelFromLibrary(project, obj), /Unsupported model format/);
  assert.deepEqual(project.objects, [], 'nothing was added');
});

test('toSliceRequest produces a request the slicer accepts', async () => {
  const project = await newProject();
  await addModelFromLibrary(project, libraryFile('cube20.stl'), 2);
  await arrange(project, schema);
  const request = toSliceRequest(project, schema);
  assert.doesNotThrow(() => validateSliceRequest(request));
  assert.equal(request.objects.length, 1);
  assert.equal(request.objects[0].instances?.length, 2);
  assert.deepEqual(request.objects[0].transform, request.objects[0].instances![0], 'the legacy transform stays in sync');
  assert.equal(request.print.name, DEFAULT_PRINT);
  assert.equal(request.printer.name, DEFAULT_PRINTER);
  assert.equal(request.filaments.length, 1);
  assert.equal(request.outputName, 'cube20');
  assert.ok(request.printer.config.bed_shape, 'the resolved printer config carries the bed shape');
  assert.equal(request.thumbnails, undefined, 'no thumbnails in a headless slice');

  // two objects get a speaking output name, like the browser
  await addModelFromLibrary(project, libraryFile('cube20b.stl'), 1);
  assert.equal(toSliceRequest(project, schema).outputName, 'cube20_and_1_more');
});

test('an empty project cannot be sliced or arranged', async () => {
  const project = await newProject();
  assert.throws(() => toSliceRequest(project, schema), /no objects/);
  await assert.rejects(() => arrange(project, schema), /no objects/);
});

test('arrange packs the instances into the bed, on the bed and apart', async () => {
  const project = await newProject();
  await addModelFromLibrary(project, libraryFile('cube20.stl'), 4);
  const before = project.objects[0].instances.map((m) => [...m]);
  await arrange(project, schema);
  const placed = project.objects[0].instances;
  assert.equal(placed.length, 4);
  assert.notDeepEqual(placed[0], before[0], 'the instances moved');
  // every copy sits on the bed (min Z = 0) and inside the 200x200 default bed
  for (const m of placed) {
    const box = instanceBounds(project.objects[0].bounds, m);
    assert.ok(Math.abs(box.min[2]) < 1e-9, `copy on the bed, min Z = ${box.min[2]}`);
    // the matrix moves the mesh centre, so its translation is the copy's centre in X/Y
    assert.ok(m[12] >= 0 && m[12] <= 200 && m[13] >= 0 && m[13] <= 200, `inside the bed: ${m[12]}, ${m[13]}`);
  }
  // the packing keeps the copies apart (the cube is 20 mm wide plus 6 mm clearance)
  const xs = placed.map((m) => m[12]).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 26 - 1e-9, `apart: ${xs[i - 1]} -> ${xs[i]}`);
  // arranging is not cumulative: a second run gives the same layout
  const once = placed.map((m) => [...m]);
  await arrange(project, schema);
  assert.deepEqual(project.objects[0].instances, once);
});

test('arrange reports objects that do not fit on the bed', async () => {
  const tall = { vertices: Float32Array.from([0, 0, 0, 400, 0, 0, 0, 20, 0]), indices: Uint32Array.from([0, 1, 2]) };
  const project = await newProject();
  await addModelFromLibrary(project, libraryFile('wide.stl', tall as never), 1);
  await assert.rejects(() => arrange(project, schema), /Not all objects fit on the bed/);
});

test('the TTL cleanup drops expired projects and keeps the models of live ones', async () => {
  const live = await newProject();
  await addModelFromLibrary(live, libraryFile('cube20.stl'), 1);
  const liveModel = live.objects[0].modelId;

  const expired = await newProject();
  await addModelFromLibrary(expired, libraryFile('cube20.stl'), 1);
  const expiredModel = expired.objects[0].modelId;
  // age the project on disk, the way a stale file carries it
  const stale = (await loadProject(expired.id))!;
  stale.expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(config.projectsDir, `${stale.id}.json`), JSON.stringify(stale));

  const before = (await listProjects()).length;
  assert.ok((await keepModelIds()).has(liveModel), 'both are referenced before the cleanup');
  assert.ok((await keepModelIds()).has(expiredModel));

  await pruneProjects();
  assert.equal((await listProjects()).length, before - 1, 'exactly the expired project is gone');
  assert.ok(await loadProject(live.id), 'the live one stays');
  assert.ok(!(await loadProject(expired.id)));
  assert.ok(!fs.existsSync(path.join(config.modelsDir, `${expiredModel}.stl`)), 'the expired project took its model with it');
  assert.ok(fs.existsSync(path.join(config.modelsDir, `${liveModel}.stl`)), 'the live project keeps its model');
  // the garbage collection only ever protects models a live project references
  assert.ok((await keepModelIds()).has(liveModel));
  assert.ok(!(await keepModelIds()).has(expiredModel));
});

test('touchProject pushes the expiry out and deleteProject removes the models', async () => {
  const project = await newProject();
  await addModelFromLibrary(project, libraryFile('cube20.stl'), 1);
  const modelId = project.objects[0].modelId;
  project.expiresAt = new Date(Date.now() - 60_000).toISOString();
  await touchProject(project);
  assert.ok(Date.parse(project.expiresAt) > Date.now());
  assert.equal((await loadProject(project.id))!.expiresAt, project.expiresAt);

  assert.equal(await deleteProject(project.id), true);
  assert.equal(await loadProject(project.id), undefined);
  assert.ok(!fs.existsSync(path.join(config.modelsDir, `${modelId}.stl`)), 'the model went with the project');
  assert.equal(await deleteProject(project.id), false);
});

test('a second project keeps a shared model alive when the first one is deleted', async () => {
  const a = await newProject();
  await addModelFromLibrary(a, libraryFile('cube20.stl'), 1);
  const modelId = a.objects[0].modelId;
  const b = await newProject();
  b.objects.push({ ...a.objects[0], id: 'obj-1' });
  const { saveProject } = await import('./projects.js');
  await saveProject(b);

  await deleteProject(a.id);
  assert.ok(fs.existsSync(path.join(config.modelsDir, `${modelId}.stl`)), 'b still uses the model');
  await deleteProject(b.id);
  assert.ok(!fs.existsSync(path.join(config.modelsDir, `${modelId}.stl`)));
});

test('loadProject only accepts project ids', async () => {
  assert.equal(await loadProject(''), undefined);
  assert.equal(await loadProject('../../etc/passwd'), undefined);
  assert.equal(await loadProject('11111111-1111-1111-1111-111111111111'), undefined);
});

test('a project keeps its model through a pruneModels run', async () => {
  const { pruneModels } = await import('../services/models.js');
  const project = await newProject();
  await addModelFromLibrary(project, libraryFile('cube20.stl'), 1);
  const modelId = project.objects[0].modelId;
  // make both the project and the model old enough to be pruned
  const old = Date.now() - 30 * 86400_000;
  fs.utimesSync(path.join(config.modelsDir, `${modelId}.stl`), old / 1000, old / 1000);
  await pruneModels();
  assert.ok(fs.existsSync(path.join(config.modelsDir, `${modelId}.stl`)), 'a live project protects its model');
  assert.equal((await saveModel(CUBE as never, 'scratch')).triangles, CUBE.indices.length / 3, 'the model store itself still works');
});

test('IDENTITY is untouched by a project round trip', async () => {
  const project = await newProject();
  project.objects.push({
    id: 'obj-1',
    modelId: (await saveModel(CUBE as never, 'cube')).id,
    name: 'cube',
    bounds: { min: [-10, -10, 0], max: [10, 10, 20] },
    instances: [IDENTITY],
  });
  const request = toSliceRequest(project, schema);
  assert.doesNotThrow(() => validateSliceRequest(request));
  assert.equal(request.objects[0].instances, undefined, 'one instance stays the legacy field');
});
