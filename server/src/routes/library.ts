/**
 * REST surface of the file library (`services/library.ts` does the file work).
 *
 * The library is a mounted directory with models (STL/OBJ/3MF/AMF), projects (3MF) and G-code, so
 * users can pick files that were copied in via NAS/SMB without a browser upload and store projects
 * and sliced G-code next to them.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { getJob, jobOutputPath } from '../jobs.js';
import { build3mfForRequest } from '../services/slice.js';
import { mergeConfigs } from '../services/configMerge.js';
import { activeSchema } from '../services/schema.js';
import {
  copyIntoLibrary,
  deleteLibraryEntry,
  libraryTarget,
  listLibrary,
  makeLibraryDir,
  resolveLibraryFile,
  writeLibraryData,
  writeLibraryFile,
} from '../services/library.js';
import type { SliceRequest } from '@webslicer/shared';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function libraryRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });
  const raw = express.raw({ type: () => true, limit: config.maxUploadBytes });

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json({ root: config.libraryDir, ...(await listLibrary(String(req.query.path || ''))) });
    }),
  );

  r.get(
    '/file',
    asyncHandler(async (req, res) => {
      const abs = await resolveLibraryFile(String(req.query.path || ''));
      if (req.query.download !== undefined)
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(abs))}"`);
      res.type('application/octet-stream').sendFile(abs);
    }),
  );

  // upload from the browser into the library (raw body)
  r.put(
    '/file',
    raw,
    asyncHandler(async (req, res) => {
      const buf = req.body as Buffer;
      if (!buf || !buf.length) return res.status(400).json({ error: 'empty body' });
      res.json({ ok: true, ...(await writeLibraryFile(String(req.query.path || ''), buf)) });
    }),
  );

  r.post(
    '/mkdir',
    json,
    asyncHandler(async (req, res) => {
      const body = (req.body || {}) as { path?: unknown; name?: unknown };
      res.json({ ok: true, ...(await makeLibraryDir(String(body.path || ''), String(body.name ?? ''))) });
    }),
  );

  r.delete(
    '/file',
    asyncHandler(async (req, res) => {
      await deleteLibraryEntry(String(req.query.path || ''));
      res.json({ ok: true });
    }),
  );

  // save the current plater as a 3MF project into the library
  r.post(
    '/project',
    json,
    asyncHandler(async (req, res) => {
      const body = req.body as SliceRequest;
      if (!body?.objects?.length) return res.status(400).json({ error: 'no objects' });
      const buf = await build3mfForRequest(body, mergeConfigs(await activeSchema(), body, { forProject: true }));
      const target = libraryTarget(String(req.query.path || ''), String(req.query.name || 'project'), '.3mf');
      res.json({ ok: true, ...(await writeLibraryData(target, buf)) });
    }),
  );

  // copy a job's output (G-code) into the library
  r.post(
    '/gcode',
    json,
    asyncHandler(async (req, res) => {
      const body = (req.body || {}) as { jobId?: unknown; path?: unknown; name?: unknown };
      const job = getJob(String(body.jobId || ''));
      if (!job || job.status !== 'done') return res.status(404).json({ error: 'job output not available' });
      const target = libraryTarget(String(body.path || ''), String(body.name || job.outputName), path.extname(job.outputName));
      res.json({ ok: true, ...(await copyIntoLibrary(jobOutputPath(job), target)) });
    }),
  );

  return r;
}
