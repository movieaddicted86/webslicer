/**
 * Server-side projects: a plater without a browser (moved here from `plater/project.ts`, R-9).
 *
 * A project is a small JSON file in `data/projects/<uuid>.json` holding the preset names plus the
 * overrides the caller changed, and the objects with their instance matrices. The meshes live in the
 * model directory like any uploaded model (`saveModel`), so slicing reuses the existing path
 * (`build3mfForRequest` → `createJob`). Projects expire 24 h after their last use; their models are
 * kept alive until then and removed afterwards.
 *
 * Deliberately stored instead of in memory: an MCP client may slice minutes after it built the
 * project, and the server may have restarted in between.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { envNumberAtLeast } from '../env.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { resolveInsideLibrary } from './library.js';
import { deleteModel, saveModel, setModelLifecycleHooks } from './models.js';
import { stripServerOnly } from './serverOnly.js';
import { readJson, writeJson } from '../storage/jsonStore.js';
import { defaultPresetName, resolvePreset } from '../slicer/presets.js';
import { loadModelFile } from '../plater/meshes.js';
import { copiesSchema, type ProjectPresetRef } from '../validation/projects.js';
import { createJob } from '../jobs.js';
import { validateConfigLimits, validatePlate, validateSliceRequest } from './slice.js';
import {
  arrangementSpacing,
  bedShapeOf,
  instanceBounds,
  meshBounds,
  multiply,
  normalize,
  packShelf,
  translate,
  type Bounds,
  type CustomGcode,
  type JobRecord,
  type Matrix4,
  type PackAlignment,
  type PresetType,
  type Schema,
  type SliceRequest,
} from '@webslicer/shared';

/** The arrange knobs a headless caller has – the same ones as the browser's Arrange settings (T-043). */
export interface ArrangeOptions {
  /** clearance in mm; default: the print preset's arrangement spacing */
  spacing?: number;
  /** try every instance turned by 90° when the plain layout does not fit */
  rotations?: boolean;
  /** where the packed block sits in the bed; default `center`, as before */
  alignment?: PackAlignment;
}

/** Quarter turn around Z, column-major – `Rz(90°)` in the browser's placement convention. */
const QUARTER_TURN: Matrix4 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** hours a project stays alive after its last use */
export const PROJECT_TTL_HOURS = envNumberAtLeast('PROJECT_TTL_HOURS', 1, 24);

/** A preset slot of a project (declared with its schema, so the validation ↔ service cycle is gone). */
export type { ProjectPresetRef };

/** An object of a *stored server project* (not the 3MF `ProjectObject` of `@webslicer/shared`). */
export interface StoredProjectObject {
  id: string;
  /** model in the model directory (the normalised mesh) */
  modelId: string;
  name: string;
  /** bounds of the normalised mesh (centred in X/Y, minimum Z on the bed) */
  bounds: Bounds;
  /** instance matrices (column-major 4x4, includes the first) */
  instances: Matrix4[];
}

export interface Project {
  id: string;
  /** owner of the project – prepares per-user MCP tokens (phase 1); 'admin' until then */
  owner: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  printer: ProjectPresetRef;
  print: ProjectPresetRef;
  filaments: ProjectPresetRef[];
  objects: StoredProjectObject[];
  customGcodes?: CustomGcode[];
}

/** Absolute path of a preset slot; the name is validated against the schema by `resolveSlot`. */
function resolveSlot(schema: Schema, type: PresetType, slot: ProjectPresetRef): ProjectPresetRef {
  if (!slot || typeof slot.name !== 'string' || !slot.name.trim()) throw new ValidationError(`${type} preset name required`);
  const preset = resolvePreset(schema, type, slot.name);
  if (!preset) throw new ValidationError(`Unknown ${type} preset "${slot.name}"`);
  // the server-only keys are stripped here as well as in `mergeConfigs` (SEC-1): a project that never
  // stores them cannot hand them to any other reader of its config either
  return { name: preset.name, config: stripServerOnly({ ...preset.config, ...(slot.config || {}) }) };
}

/** Printer, print and filament configs of a project, with its overrides applied. */
export function resolvedConfigs(
  project: Project,
  schema: Schema,
): { printer: ProjectPresetRef; print: ProjectPresetRef; filaments: ProjectPresetRef[] } {
  const filaments = (project.filaments.length ? project.filaments : [{ name: defaultPresetName('filament'), config: {} }]).map((f) =>
    resolveSlot(schema, 'filament', f),
  );
  return { printer: resolveSlot(schema, 'printer', project.printer), print: resolveSlot(schema, 'print', project.print), filaments };
}

/** A `SliceRequest` the existing slicing path accepts (`validateSliceRequest`, `createJob`). */
export function toSliceRequest(project: Project, schema: Schema): SliceRequest {
  if (!project.objects.length) throw new ValidationError('Project has no objects');
  const cfg = resolvedConfigs(project, schema);
  const first = project.objects[0].name.replace(/\.[^.]+$/, '');
  return {
    objects: project.objects.map((o) => ({
      modelId: o.modelId,
      name: o.name,
      transform: o.instances[0],
      instances: o.instances.length > 1 ? o.instances : undefined,
    })),
    print: cfg.print,
    filaments: cfg.filaments,
    printer: cfg.printer,
    outputName: project.objects.length > 1 ? `${first}_and_${project.objects.length - 1}_more` : first,
    customGcodes: project.customGcodes?.length ? project.customGcodes : undefined,
  };
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

export function projectFile(id: string): string {
  return path.join(config.projectsDir, `${path.basename(id)}.json`);
}

/**
 * B7: the per-project write chain. Loading, changing and saving a project spans several `await`s, so
 * two concurrent MCP calls could both load the same file and the second save would drop the first
 * one's objects. Every caller that changes a project runs its load → modify → save through
 * `withProjectLock(id, …)` – the same promise-chain pattern as `services/printers.ts` `update()`.
 */
const projectLocks = new Map<string, Promise<unknown>>();

export function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const key = String(id);
  const previous = projectLocks.get(key) ?? Promise.resolve();
  // the next call waits for this one – even when it failed; errors stay with their own caller
  const run = previous.then(fn, fn);
  const tail = run.catch(() => undefined);
  projectLocks.set(key, tail);
  // the chain is the only state: once it is the last one queued, nobody waits on it any more
  void tail.then(() => {
    if (projectLocks.get(key) === tail) projectLocks.delete(key);
  });
  return run;
}

export async function saveProject(project: Project): Promise<Project> {
  // B7: temp + rename; a crash mid-write cannot leave a half project that the next start drops
  await writeJson(projectFile(project.id), project);
  return project;
}

function stamp(project: Project): Project {
  const now = new Date();
  project.updatedAt = now.toISOString();
  project.expiresAt = new Date(now.getTime() + PROJECT_TTL_HOURS * 3600_000).toISOString();
  return project;
}

/**
 * Mark a project as used and push its expiry out by the TTL. Under the project's lock and on the
 * file as it is *now*: a touch that arrives after a concurrent change must not write that change
 * away (B7). A caller that already holds the lock uses `saveTouched` instead – see the note there.
 */
export async function touchProject(project: Project): Promise<Project> {
  return withProjectLock(project.id, async () => {
    // the file now, not the caller's copy: a touch may arrive after a concurrent change
    const current = (await loadProject(project.id)) ?? project;
    const saved = await saveTouched(current);
    project.expiresAt = saved.expiresAt;
    project.updatedAt = saved.updatedAt;
    return saved;
  });
}

/** Stamp and save a project whose read-modify-write already runs under `withProjectLock`. */
async function saveTouched(project: Project): Promise<Project> {
  return saveProject(stamp(project));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return undefined;
  // B7: an unparseable project is set aside (*.corrupt-<ts>) and logged instead of silently vanishing
  const { value: p } = await readJson<Project>(projectFile(id));
  return p?.id ? p : undefined;
}

export async function listProjects(): Promise<Project[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(config.projectsDir);
  } catch {
    return [];
  }
  const loaded = await Promise.all(names.filter((f) => f.endsWith('.json')).map((f) => loadProject(f.slice(0, -5))));
  return loaded.filter((p): p is Project => p !== undefined);
}

/** Delete a project and the models only it referenced. */
export async function deleteProject(id: string): Promise<boolean> {
  const project = await loadProject(id);
  if (!project) return false;
  try {
    await fs.unlink(projectFile(project.id));
  } catch {
    /* ignore */
  }
  const stillUsed = await keepModelIds();
  for (const o of project.objects) {
    if (stillUsed.has(o.modelId)) continue;
    await deleteModel(o.modelId);
  }
  return true;
}

export async function createProject(opts: {
  schema: Schema;
  printer: ProjectPresetRef;
  print: ProjectPresetRef;
  filaments?: ProjectPresetRef[];
  owner?: string;
}): Promise<Project> {
  // resolve here already: a project that cannot be sliced should not be created (fail fast)
  const printer = resolveSlot(opts.schema, 'printer', opts.printer);
  const print = resolveSlot(opts.schema, 'print', opts.print);
  const filaments = (opts.filaments?.length ? opts.filaments : [{ name: defaultPresetName('filament'), config: {} }]).map((f) =>
    resolveSlot(opts.schema, 'filament', f),
  );
  const now = new Date();
  // The *stored* config keeps only the overrides, but they are the resolved ones: `resolveSlot`
  // strips the server-only keys (SEC-1), and the project body is still copied verbatim here on
  // purpose – a second filter over the same input would be a place for the two to drift apart.
  const project: Project = {
    id: randomUUID(),
    owner: String(opts.owner || 'admin').slice(0, 64) || 'admin',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROJECT_TTL_HOURS * 3600_000).toISOString(),
    printer: { name: printer.name, config: stripServerOnly(opts.printer.config) },
    print: { name: print.name, config: stripServerOnly(opts.print.config) },
    filaments: filaments.map((f, i) => ({ name: f.name, config: stripServerOnly(opts.filaments?.[i]?.config) })),
    objects: [],
  };
  return saveProject(project);
}

/**
 * Add every model of a library file to the project. The mesh is normalised like the browser does
 * (centre X/Y, minimum Z on the bed) and stored in the model directory; `copies` repeats the
 * instance set of each model (an STL with `copies: 3` becomes one object with three instances).
 */
export async function addModelFromLibrary(project: Project, libraryPath: string, copies = 1): Promise<Project> {
  return withProjectLock(project.id, async () => {
    // B7: the caller loaded the project before the lock, so a queued call must start from the file's
    // state – otherwise 20 parallel adds all append to the same stale copy and 19 are lost
    const current = (await loadProject(project.id)) ?? project;
    const saved = await addModelToProject(current, libraryPath, copies);
    // the caller's object follows the saved state as well (a caller may keep using it)
    if (current !== project) Object.assign(project, saved);
    return saved;
  });
}

/**
 * `addModelFromLibrary` for a caller that already holds the project's lock (the routes and the MCP
 * tools): it changes the project the caller loaded *inside* the lock and saves it (B7).
 */
export async function addModelToProject(project: Project, libraryPath: string, copies = 1): Promise<Project> {
  const n = Math.floor(Number(copies));
  // the range rule lives in `validation/projects.ts`; this is the same rule at the store's end
  if (!copiesSchema.safeParse(n).success) throw new ValidationError('copies must be an integer between 1 and 1000');
  const abs = await resolveInsideLibrary(libraryPath); // rejects escapes and symlink escapes (S10)
  let isFile = false;
  try {
    isFile = (await fs.stat(abs)).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) throw new NotFoundError('library file not found');
  const models = await loadModelFile(abs);
  for (const m of models) {
    const norm = normalize(m.mesh.vertices, m.instances);
    const stored = await saveModel({ vertices: norm.vertices, indices: m.mesh.indices }, m.name);
    const instances: Matrix4[] = [];
    for (let c = 0; c < n; c++) instances.push(...norm.instances);
    if (instances.length > 1000) throw new ValidationError('more than 1000 instances');
    // keep the mesh bounds in the project: arranging needs them and must not re-read every model
    project.objects.push({
      id: `obj-${project.objects.length + 1}`,
      modelId: stored.id,
      name: m.name,
      bounds: meshBounds(norm.vertices),
      instances,
    });
  }
  return saveTouched(project);
}

/**
 * Arrange every instance with the shared shelf packing (`@webslicer/shared`, the algorithm the
 * browser uses as well):
 * footprints, largest first, then each instance is moved so its centre lands on the packed centre
 * and its minimum Z on the bed. `options` carry the same spacing/rotations/alignment the browser's
 * Arrange settings offer (T-043); the defaults reproduce the old layout.
 */
export async function arrange(project: Project, schema: Schema, options: ArrangeOptions = {}): Promise<Project> {
  return withProjectLock(project.id, async () => {
    // same as `addModelFromLibrary`: the file's state, not the copy the caller loaded before the lock
    const current = (await loadProject(project.id)) ?? project;
    const saved = await arrangeLockedProject(current, schema, options);
    if (current !== project) Object.assign(project, saved);
    return saved;
  });
}

/** `arrange` for a caller that already holds the lock: the project it loaded, laid out and saved (B7). */
export async function arrangeLockedProject(project: Project, schema: Schema, options: ArrangeOptions = {}): Promise<Project> {
  if (!project.objects.length) throw new ValidationError('Project has no objects');
  const cfg = resolvedConfigs(project, schema);
  const bed = bedShapeOf(cfg.printer.config);
  const spacing = options.spacing ?? arrangementSpacing(cfg.print.config);
  const items = project.objects.flatMap((o) =>
    o.instances.map((m, i) => ({ o, index: i, key: `${o.id}:${i}`, box: instanceBounds(o.bounds, m) })),
  );
  const packed = packShelf(
    items.map((it) => ({ id: it.key, width: it.box.max[0] - it.box.min[0], height: it.box.max[1] - it.box.min[1] })),
    bed,
    { spacing, rotations: options.rotations, alignment: options.alignment },
  );
  if (!packed) throw new ValidationError('Not all objects fit on the bed');
  const byKey = new Map(items.map((it) => [it.key, it]));
  for (const p of packed) {
    const it = byKey.get(p.id);
    if (!it) continue;
    // a turned item is rotated around its own footprint centre first, then placed as usual
    const m = p.rotated ? quarterTurn(it.o.bounds, it.o.instances[it.index]) : it.o.instances[it.index];
    const box = instanceBounds(it.o.bounds, m);
    const dx = p.x - (box.min[0] + box.max[0]) / 2;
    const dy = p.y - (box.min[1] + box.max[1]) / 2;
    const dz = -box.min[2];
    it.o.instances[it.index] = multiply(translate(dx, dy, dz), m);
  }
  return saveTouched(project);
}

/** Turn an instance by 90° around Z through its footprint centre, so it stays where it is. */
function quarterTurn(bounds: Bounds, m: Matrix4): Matrix4 {
  const box = instanceBounds(bounds, m);
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  return multiply(translate(cx, cy, 0), multiply(QUARTER_TURN, multiply(translate(-cx, -cy, 0), m)));
}

// ---------------------------------------------------------------------------
// life cycle
// ---------------------------------------------------------------------------

/** Model ids that live projects still reference. */
export async function keepModelIds(): Promise<Set<string>> {
  const keep = new Set<string>();
  for (const p of await listProjects()) for (const o of p.objects) keep.add(o.modelId);
  return keep;
}

/** Remove projects whose TTL ran out, together with the models only they used. */
export async function pruneProjects(): Promise<void> {
  const now = Date.now();
  for (const p of await listProjects()) {
    const expires = Date.parse(p.expiresAt || '');
    if (Number.isFinite(expires) && expires > now) continue;
    await deleteProject(p.id);
  }
}

/**
 * Register the project store as the model life cycle of `services/models.ts`: the pruning there has
 * to know which models a live project still needs, and an expired project has to take its models with
 * it. Both directions are async, so the whole pass stays on `fs/promises` (N-7).
 *
 * Explicit instead of a module side effect (W3): `index.ts` calls it while booting, and so does a
 * test that exercises the pruning. Importing `projects.ts` alone no longer silently changes the model
 * retention of whatever process happens to load it.
 */
export function registerProjectLifecycle(): void {
  setModelLifecycleHooks({
    keepModelIds,
    pruneProjects,
  });
}

/**
 * Slice a stored project: the request built from its resolved presets, with the two overrides the
 * route accepts (`binaryGcode`, `outputName`), validated and queued like a REST slice.
 *
 * A project settings typo faces the same global limits as a REST slice, on the merged config – the
 * config issues travel with the job. The project is touched only after it was queued.
 */
export async function sliceProject(
  project: Project,
  schema: Schema,
  overrides: { binaryGcode?: boolean; outputName?: string } = {},
): Promise<JobRecord> {
  const request = toSliceRequest(project, schema);
  if (overrides.binaryGcode !== undefined) request.binaryGcode = overrides.binaryGcode;
  if (overrides.outputName !== undefined) request.outputName = overrides.outputName;
  // no thumbnails here: rendering them needs a browser (concept §3.5, rasterizer comes in phase 3)
  validateSliceRequest(request);
  const configIssues = validateConfigLimits(request, schema);
  await validatePlate(request);
  const job = await createJob(request, schema, configIssues);
  await touchProject(project);
  return job;
}
