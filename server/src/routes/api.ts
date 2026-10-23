/**
 * The REST surface: one router per resource, mounted in the order the routes have always had.
 *
 * Order matters in two places: `/projects/parse` (in `exports`) has to be mounted **before**
 * `projectsRouter`, whose `/:id` would otherwise catch it; and the host guard in `app.ts` stays in
 * front of all of them. A route only validates, calls one service and answers – the logic lives in
 * `server/src/services/`.
 */
import express from 'express';
import { metaRouter } from './meta.js';
import { presetsRouter } from './presets.js';
import { modelsRouter } from './models.js';
import { exportsRouter } from './exports.js';
import { jobsRouter } from './jobs.js';
import { printersRouter } from './printers.js';
import { autosaveRouter } from './autosave.js';
import { libraryRouter } from './library.js';
import { projectsRouter } from './projects.js';

/**
 * The routers of the REST API.
 *
 * The async handlers are plain `async` functions: Express 5 forwards a rejected promise to the error
 * handler, so the `asyncHandler` wrapper every route used to be passed through is gone (T-023). What
 * the wrapper also did – widen `req.params` values to `string | string[]` – is handled by the router
 * types now, which read a single `:id` as the `string` it is.
 */
export function apiRouter(): express.Router {
  const r = express.Router();
  r.use(metaRouter());
  r.use(presetsRouter());
  r.use(modelsRouter());
  // before `/projects`: keeps `POST /api/projects/parse` its own route
  r.use(exportsRouter());
  r.use(jobsRouter());
  r.use(printersRouter());
  r.use('/library', libraryRouter());
  r.use('/projects', projectsRouter());
  r.use(autosaveRouter());
  return r;
}
