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
import { NotFoundError, ValidationError } from '../errors.js';
import { resolveLibraryPath } from './library.js';
import { deleteModel, saveModel, setModelLifecycleHooks } from './models.js';
import { stripServerOnly } from './serverOnly.js';
import { defaultPresetName, resolvePreset } from '../slicer/presets.js';
import type { IniSection } from '../slicer/ini.js';
import { loadModelFile } from '../plater/meshes.js';
import { copiesSchema } from '../validation/projects.js';
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
  type Matrix4,
  type PresetType,
  type Schema,
  type SliceRequest,
} from '@webslicer/shared';

/** hours a project stays alive after its last use */
export const PROJECT_TTL_HOURS = Math.max(1, Number(process.env.PROJECT_TTL_HOURS || 24));

export interface ProjectPresetRef {
  name: string;
  /** options that differ from the preset (merged over the resolved preset at slice time) */
  config: IniSection;
}

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

export async function saveProject(project: Project): Promise<Project> {
  await fs.mkdir(config.projectsDir, { recursive: true });
  await fs.writeFile(projectFile(project.id), JSON.stringify(project, null, 2));
  return project;
}

/** Mark a project as used and push its expiry out by the TTL. */
export async function touchProject(project: Project): Promise<Project> {
  const now = new Date();
  project.updatedAt = now.toISOString();
  project.expiresAt = new Date(now.getTime() + PROJECT_TTL_HOURS * 3600_000).toISOString();
  return saveProject(project);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return undefined;
  try {
    const p = JSON.parse(await fs.readFile(projectFile(id), 'utf8')) as Project;
    return p?.id ? p : undefined;
  } catch {
    return undefined;
  }
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
  const n = Math.floor(Number(copies));
  // the range rule lives in `validation/projects.ts`; this is the same rule at the store's end
  if (!copiesSchema.safeParse(n).success) throw new ValidationError('copies must be an integer between 1 and 1000');
  const abs = resolveLibraryPath(libraryPath); // rejects escapes with a ValidationError
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
  return touchProject(project);
}

/**
 * Arrange every instance with the shared shelf packing (`@webslicer/shared`, the algorithm the
 * browser uses as well):
 * footprints including the clearance, largest first, then each instance is moved so its centre
 * lands on the packed centre and its minimum Z on the bed.
 */
export async function arrange(project: Project, schema: Schema): Promise<Project> {
  if (!project.objects.length) throw new ValidationError('Project has no objects');
  const cfg = resolvedConfigs(project, schema);
  const bed = bedShapeOf(cfg.printer.config);
  const spacing = arrangementSpacing(cfg.print.config);
  const items = project.objects.flatMap((o) =>
    o.instances.map((m, i) => ({ o, index: i, key: `${o.id}:${i}`, box: instanceBounds(o.bounds, m) })),
  );
  const packed = packShelf(
    items.map((it) => ({ id: it.key, width: it.box.max[0] - it.box.min[0] + spacing, height: it.box.max[1] - it.box.min[1] + spacing })),
    bed,
  );
  if (!packed) throw new ValidationError('Not all objects fit on the bed');
  const byKey = new Map(items.map((it) => [it.key, it]));
  for (const p of packed) {
    const it = byKey.get(p.id)!;
    const dx = p.x - (it.box.min[0] + it.box.max[0]) / 2;
    const dy = p.y - (it.box.min[1] + it.box.max[1]) / 2;
    const dz = -it.box.min[2];
    it.o.instances[it.index] = multiply(translate(dx, dy, dz), it.o.instances[it.index]);
  }
  return touchProject(project);
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
 */
setModelLifecycleHooks({
  keepModelIds,
  pruneProjects,
});
