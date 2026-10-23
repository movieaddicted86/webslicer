/**
 * REST surface of the server-side plater (`services/projects.ts`). Phase 0 of the MCP integration
 * (`docs/MCP-Concept.md` §3): an agent (and, later, the MCP tools) can build and slice a plater
 * without a browser. The browser UI does not use these routes.
 *
 *   POST /api/projects                create a project
 *   GET  /api/projects/:id            read it
 *   POST /api/projects/:id/models     add a model from the library  { libraryPath, copies? }
 *   POST /api/projects/:id/arrange    arrange the instances on the bed
 *   POST /api/projects/:id/slice      slice it -> job record (like POST /api/slice)
 */
import express, { type Request, type Response } from 'express';
import {
  addModelToProject,
  arrangeLockedProject,
  createProject,
  loadProject,
  sliceProject,
  withProjectLock,
} from '../services/projects.js';
import { optionSchema } from '../services/meta.js';
import { ValidationError } from '../errors.js';
import { arrangeOptionsSchema, copiesOf, parseProjectCreate, projectModelsSchema, projectSliceSchema } from '../validation/projects.js';
import type { Schema } from '@webslicer/shared';
import { sendJson } from './common.js';

/** The routes of this router are `async` throughout: Express 5 answers a rejected promise itself. */
export function projectsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '8mb' });

  /** Load a project or answer 404. Every route here is `/…:id…`, so the param is a single string. */
  const withProject = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<{ project: Awaited<ReturnType<typeof loadProject>>; schema: Schema }> => {
    const project = await loadProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'project not found' });
      return { project: undefined, schema: await optionSchema() };
    }
    return { project, schema: await optionSchema() };
  };

  r.post('/', json, async (req, res) => {
    const body = parseProjectCreate(req.body);
    if (!body.ok) throw new ValidationError(body.message);
    const s = await optionSchema();
    const project = await createProject({
      schema: s,
      printer: body.printer,
      print: body.print,
      filaments: body.filaments,
      owner: body.owner,
    });
    sendJson(res, project, 201);
  });

  r.get('/:id', async (req, res) => {
    const project = await loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    sendJson(res, project);
  });

  r.post('/:id/models', json, async (req, res) => {
    const found = await withProject(req, res);
    if (!found.project) return;
    const body = projectModelsSchema.safeParse(req.body || {});
    if (!body.success) throw new ValidationError(body.error.issues[0]?.message || 'libraryPath required');
    // B7: load → modify → save under the project's lock; two concurrent calls must not both start
    // from the same file (the `withProject` above only answers the 404, the file is re-read here)
    const loaded = found.project;
    const project = await withProjectLock(req.params.id, async () =>
      addModelToProject((await loadProject(req.params.id)) ?? loaded, body.data.libraryPath, copiesOf(body.data.copies)),
    );
    sendJson(res, project);
  });

  r.post('/:id/arrange', json, async (req, res) => {
    const found = await withProject(req, res);
    if (!found.project) return;
    const options = arrangeOptionsSchema.parse(req.body || {});
    const loaded = found.project;
    const project = await withProjectLock(req.params.id, async () =>
      arrangeLockedProject((await loadProject(req.params.id)) ?? loaded, found.schema, options),
    );
    sendJson(res, project);
  });

  r.post('/:id/slice', json, async (req, res) => {
    const found = await withProject(req, res);
    if (!found.project) return;
    const body = projectSliceSchema.parse(req.body || {});
    const job = await sliceProject(found.project, found.schema, body);
    sendJson(res, job, 202);
  });

  return r;
}
