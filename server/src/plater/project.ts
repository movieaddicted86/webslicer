/**
 * Server-side projects: a plater without a browser.
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
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { resolveLibraryPath } from '../routes/library.js';
import { saveModel, setPlaterHooks } from '../jobs.js';
import { defaultPresetName, resolvePreset } from '../slicer/presets.js';
import type { IniSection } from '../slicer/ini.js';
import { loadModelFile } from './meshes.js';
import { arrangementSpacing, bedShapeOf, packShelf } from './packing.js';
import { instanceBounds, meshBounds, multiplyMatrix, normalize, translateMatrix, type Matrix4 } from './normalize.js';
import type { Bounds, CustomGcode, PresetType, Schema, SliceRequest } from '@webslicer/shared';

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

function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Absolute path of a preset slot; the name is validated against the schema by `resolveSlot`. */
function resolveSlot(schema: Schema, type: PresetType, slot: ProjectPresetRef): ProjectPresetRef {
  if (!slot || typeof slot.name !== 'string' || !slot.name.trim()) throw fail(`${type} preset name required`, 400);
  const preset = resolvePreset(schema, type, slot.name);
  if (!preset) throw fail(`Unknown ${type} preset "${slot.name}"`, 400);
  return { name: preset.name, config: { ...preset.config, ...(slot.config || {}) } };
}

/** Printer, print and filament configs of a project, with its overrides applied. */
export function resolvedConfigs(project: Project, schema: Schema): { printer: ProjectPresetRef; print: ProjectPresetRef; filaments: ProjectPresetRef[] } {
  const filaments = (project.filaments.length ? project.filaments : [{ name: defaultPresetName('filament'), config: {} }]).map((f) =>
    resolveSlot(schema, 'filament', f),
  );
  return { printer: resolveSlot(schema, 'printer', project.printer), print: resolveSlot(schema, 'print', project.print), filaments };
}

/** A `SliceRequest` the existing slicing path accepts (`validateSliceRequest`, `createJob`). */
export function toSliceRequest(project: Project, schema: Schema): SliceRequest {
  if (!project.objects.length) throw fail('Project has no objects', 400);
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

export function saveProject(project: Project): Project {
  fs.mkdirSync(config.projectsDir, { recursive: true });
  fs.writeFileSync(projectFile(project.id), JSON.stringify(project, null, 2));
  return project;
}

/** Mark a project as used and push its expiry out by the TTL. */
export function touchProject(project: Project): Project {
  const now = new Date();
  project.updatedAt = now.toISOString();
  project.expiresAt = new Date(now.getTime() + PROJECT_TTL_HOURS * 3600_000).toISOString();
  return saveProject(project);
}

export function loadProject(id: string): Project | undefined {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return undefined;
  const f = projectFile(id);
  if (!fs.existsSync(f)) return undefined;
  try {
    const p = JSON.parse(fs.readFileSync(f, 'utf8')) as Project;
    return p?.id ? p : undefined;
  } catch {
    return undefined;
  }
}

export function listProjects(): Project[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(config.projectsDir);
  } catch {
    return [];
  }
  const out: Project[] = [];
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    const p = loadProject(f.slice(0, -5));
    if (p) out.push(p);
  }
  return out;
}

/** Delete a project and the models only it referenced. */
export function deleteProject(id: string): boolean {
  const project = loadProject(id);
  if (!project) return false;
  try {
    fs.unlinkSync(projectFile(project.id));
  } catch {
    /* ignore */
  }
  const stillUsed = keepModelIds();
  for (const o of project.objects) {
    if (stillUsed.has(o.modelId)) continue;
    for (const ext of ['.stl', '.json']) {
      try {
        fs.unlinkSync(path.join(config.modelsDir, `${o.modelId}${ext}`));
      } catch {
        /* ignore */
      }
    }
  }
  return true;
}

export function createProject(opts: {
  schema: Schema;
  printer: ProjectPresetRef;
  print: ProjectPresetRef;
  filaments?: ProjectPresetRef[];
  owner?: string;
}): Project {
  // resolve here already: a project that cannot be sliced should not be created (fail fast)
  const printer = resolveSlot(opts.schema, 'printer', opts.printer);
  const print = resolveSlot(opts.schema, 'print', opts.print);
  const filaments = (opts.filaments?.length ? opts.filaments : [{ name: defaultPresetName('filament'), config: {} }]).map((f) =>
    resolveSlot(opts.schema, 'filament', f),
  );
  const now = new Date();
  const project: Project = {
    id: randomUUID(),
    owner: String(opts.owner || 'admin').slice(0, 64) || 'admin',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PROJECT_TTL_HOURS * 3600_000).toISOString(),
    printer: { name: printer.name, config: opts.printer.config || {} },
    print: { name: print.name, config: opts.print.config || {} },
    filaments: filaments.map((f, i) => ({ name: f.name, config: opts.filaments?.[i]?.config || {} })),
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
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw fail('copies must be an integer between 1 and 1000', 400);
  const abs = resolveLibraryPath(libraryPath); // rejects escapes with status 400
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw fail('library file not found', 404);
  const models = await loadModelFile(abs);
  for (const m of models) {
    const norm = normalize(m.mesh.vertices, m.instances);
    const stored = saveModel({ vertices: norm.vertices, indices: m.mesh.indices }, m.name);
    const instances: Matrix4[] = [];
    for (let c = 0; c < n; c++) instances.push(...norm.instances);
    if (instances.length > 1000) throw fail('more than 1000 instances', 400);
    // keep the mesh bounds in the project: arranging needs them and must not re-read every model
    project.objects.push({ id: `obj-${project.objects.length + 1}`, modelId: stored.id, name: m.name, bounds: meshBounds(norm.vertices), instances });
  }
  return touchProject(project);
}

/**
 * Arrange every instance with the browser's shelf packing (same algorithm, see `packing.ts`):
 * footprints including the clearance, largest first, then each instance is moved so its centre
 * lands on the packed centre and its minimum Z on the bed.
 */
export function arrange(project: Project, schema: Schema): Project {
  if (!project.objects.length) throw fail('Project has no objects', 400);
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
  if (!packed) throw fail('Not all objects fit on the bed', 400);
  const byKey = new Map(items.map((it) => [it.key, it]));
  for (const p of packed) {
    const it = byKey.get(p.id)!;
    const dx = p.x - (it.box.min[0] + it.box.max[0]) / 2;
    const dy = p.y - (it.box.min[1] + it.box.max[1]) / 2;
    const dz = -it.box.min[2];
    it.o.instances[it.index] = multiplyMatrix(translateMatrix(dx, dy, dz), it.o.instances[it.index]);
  }
  return touchProject(project);
}

// ---------------------------------------------------------------------------
// life cycle
// ---------------------------------------------------------------------------

/** Model ids that live projects still reference. */
export function keepModelIds(): Set<string> {
  const keep = new Set<string>();
  for (const p of listProjects()) for (const o of p.objects) keep.add(o.modelId);
  return keep;
}

/** Remove projects whose TTL ran out, together with the models only they used. */
export function pruneProjects(): void {
  const now = Date.now();
  for (const p of listProjects()) {
    const expires = Date.parse(p.expiresAt || '');
    if (Number.isFinite(expires) && expires > now) continue;
    deleteProject(p.id);
  }
}

setPlaterHooks({ keepModelIds, pruneProjects });
