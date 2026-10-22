/**
 * Model storage: uploaded meshes and the meshes of server-side projects live in the model
 * directory as `<id>.stl` plus a small `<id>.json` with the counts, so the browser upload and the
 * headless plater use the same path.
 *
 * The lifetime of those files has two owners: the retention (`pruneModels`, older than
 * `MODEL_RETENTION_DAYS`) and the live projects, which register their referenced ids through
 * `setModelKeepHook` – a project model is never pruned, however old it is.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { ValidationError } from '../errors.js';
import { parseStlFile, writeBinaryStl, type Mesh } from '../slicer/threemf/index.js';

export interface StoredModel {
  id: string;
  name: string;
  triangles: number;
  vertices: number;
  createdAt: string;
}

/** Model ids that must never be pruned (live server-side projects). */
export interface ModelLifecycleHooks {
  /** model ids live projects still reference – those files are never pruned */
  keepModelIds: () => Promise<Set<string>>;
  /** remove projects whose TTL ran out, together with their models */
  pruneProjects: () => Promise<void>;
}

let hooks: ModelLifecycleHooks | undefined;

/**
 * The server-side plater (`services/projects.ts`) owns server-side projects and their models; it
 * registers here so the model life cycle stays in one place and this module does not have to know it.
 */
export function setModelLifecycleHooks(next: ModelLifecycleHooks | undefined): void {
  hooks = next;
}

/**
 * Store a model from an already written STL file (S7: it was streamed to disk, so it is not buffered
 * here either). The binary faces are read in chunks just to learn the counts; the bytes are moved.
 */
export async function saveModelFile(file: string, name: string, bytes: number): Promise<StoredModel> {
  const id = randomUUID();
  const [mesh] = parseStlFile(file, bytes);
  if (!mesh.indices.length) throw new ValidationError('mesh has no triangles');
  const info: StoredModel = {
    id,
    name,
    triangles: mesh.indices.length / 3,
    vertices: mesh.vertices.length / 3,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(config.modelsDir, { recursive: true });
  await fs.copyFile(file, path.join(config.modelsDir, `${id}.stl`));
  await fs.writeFile(path.join(config.modelsDir, `${id}.json`), JSON.stringify(info));
  return info;
}

/** Store a mesh in the model directory (what `POST /api/models` and the plater use). */
export async function saveModel(mesh: Mesh, name: string): Promise<StoredModel> {
  const id = randomUUID();
  const info: StoredModel = {
    id,
    name,
    triangles: mesh.indices.length / 3,
    vertices: mesh.vertices.length / 3,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(config.modelsDir, { recursive: true });
  await fs.writeFile(path.join(config.modelsDir, `${id}.stl`), writeBinaryStl(mesh));
  await fs.writeFile(path.join(config.modelsDir, `${id}.json`), JSON.stringify(info));
  return info;
}

/** Delete a model and its metadata; a missing file is not an error. */
export async function deleteModel(id: string): Promise<void> {
  for (const ext of ['.stl', '.json']) {
    try {
      await fs.unlink(path.join(config.modelsDir, `${path.basename(id)}${ext}`));
    } catch {
      /* ignore */
    }
  }
}

/** Remove uploaded model files that are older than MODEL_RETENTION_DAYS (default 7). */
export async function pruneModels(): Promise<void> {
  // Projects first: an expired project takes its models with it, and only what is left afterwards is
  // measured against the model retention – the same order as on `main` (`pruneProjects`, then keep).
  await hooks?.pruneProjects();
  const days = Number(process.env.MODEL_RETENTION_DAYS || 7);
  const cutoff = Date.now() - days * 86400_000;
  const keep = (await hooks?.keepModelIds()) ?? new Set<string>();
  let names: string[];
  try {
    names = await fs.readdir(config.modelsDir);
  } catch {
    return;
  }
  for (const f of names) {
    const id = f.replace(/\.(stl|json)$/, '');
    if (keep.has(id)) continue; // a live project still needs this model, whatever its age
    const p = path.join(config.modelsDir, f);
    try {
      if ((await fs.stat(p)).mtimeMs < cutoff) await fs.unlink(p);
    } catch {
      /* ignore */
    }
  }
}
