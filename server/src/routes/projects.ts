/**
 * REST surface of the server-side plater (`plater/project.ts`). Phase 0 of the MCP integration
 * (`docs/MCP-Concept.md` §3): an agent (and, later, the MCP tools) can build and slice a plater
 * without a browser. The browser UI does not use these routes.
 *
 *   POST /api/projects                create a project
 *   GET  /api/projects/:id            read it
 *   POST /api/projects/:id/models     add a model from the library  { libraryPath, copies? }
 *   POST /api/projects/:id/arrange    arrange the instances on the bed
 *   POST /api/projects/:id/slice      slice it -> job record (like POST /api/slice)
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { createJob, type SliceRequest } from '../jobs.js';
import { loadBundles } from '../slicer/bundles.js';
import { getSchema, type Schema } from '../slicer/schema.js';
import type { IniSection } from '../slicer/ini.js';
import { addModelFromLibrary, arrange, createProject, toSliceRequest, touchProject, loadProject, type ProjectPresetRef } from '../plater/project.js';
import { validateSliceRequest } from './api.js';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/** Input errors carry a status; anything else is a bug and stays a 500. */
function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * A preset slot is either a bare name ("MK4S") or `{ name, config }` – agents usually send names and
 * only the overrides they changed.
 */
function presetRef(value: unknown, label: string): ProjectPresetRef {
  if (typeof value === 'string') return { name: value.trim(), config: {} };
  if (value && typeof value === 'object') {
    const v = value as { name?: unknown; config?: unknown };
    if (v.config !== undefined && (typeof v.config !== 'object' || v.config === null || Array.isArray(v.config))) throw fail(`${label}.config must be an object`, 400);
    return { name: String(v.name ?? '').trim(), config: (v.config as IniSection) || {} };
  }
  throw fail(`${label} must be a preset name or { name, config }`, 400);
}

export function projectsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '8mb' });
  let schema: Schema | undefined;
  const schemaOf = async () => {
    if (!schema) schema = await getSchema(loadBundles().keys);
    return schema;
  };

  /** Load a project or answer 404. */
  const withProject = async (req: Request, res: Response): Promise<{ project: NonNullable<ReturnType<typeof loadProject>>; schema: Schema } | undefined> => {
    const project = loadProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'project not found' });
      return undefined;
    }
    return { project, schema: await schemaOf() };
  };

  r.post(
    '/',
    json,
    asyncHandler(async (req, res) => {
      const body = (req.body || {}) as Record<string, unknown>;
      const s = await schemaOf();
      const filaments = body.filaments === undefined ? undefined : Array.isArray(body.filaments) ? body.filaments : null;
      if (filaments === null) throw fail('filaments must be an array', 400);
      const project = createProject({
        schema: s,
        printer: presetRef(body.printer, 'printer'),
        print: presetRef(body.print, 'print'),
        filaments: filaments?.map((f, i) => presetRef(f, `filaments[${i}]`)),
        owner: body.owner === undefined ? undefined : String(body.owner),
      });
      res.status(201).json(project);
    }),
  );

  r.get('/:id', (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    res.json(project);
  });

  r.post(
    '/:id/models',
    json,
    asyncHandler(async (req, res) => {
      const found = await withProject(req, res);
      if (!found) return;
      const body = (req.body || {}) as { libraryPath?: unknown; copies?: unknown };
      if (typeof body.libraryPath !== 'string' || !body.libraryPath.trim()) throw fail('libraryPath required', 400);
      const copies = body.copies === undefined ? 1 : Number(body.copies);
      res.json(await addModelFromLibrary(found.project, body.libraryPath, copies));
    }),
  );

  r.post(
    '/:id/arrange',
    json,
    asyncHandler(async (req, res) => {
      const found = await withProject(req, res);
      if (!found) return;
      res.json(arrange(found.project, found.schema));
    }),
  );

  r.post(
    '/:id/slice',
    json,
    asyncHandler(async (req, res) => {
      const found = await withProject(req, res);
      if (!found) return;
      const body = (req.body || {}) as { binaryGcode?: unknown; outputName?: unknown };
      const request: SliceRequest = toSliceRequest(found.project, found.schema);
      if (body.binaryGcode !== undefined) request.binaryGcode = !!body.binaryGcode;
      if (typeof body.outputName === 'string' && body.outputName.trim()) request.outputName = body.outputName.trim();
      // no thumbnails here: rendering them needs a browser (concept §3.5, rasterizer comes in phase 3)
      validateSliceRequest(request);
      const job = createJob(request, found.schema);
      touchProject(found.project);
      res.status(202).json(job);
    }),
  );

  return r;
}
