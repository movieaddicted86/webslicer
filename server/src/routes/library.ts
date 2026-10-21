/**
 * REST surface of the file library (`services/library.ts` does the file work).
 *
 * The library is a mounted directory with models (STL/OBJ/3MF/AMF), projects (3MF) and G-code, so
 * users can pick files that were copied in via NAS/SMB without a browser upload and store projects
 * and sliced G-code next to them.
 */
import express from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { getJob, jobOutputPath } from '../jobs.js';
import { build3mfForRequest } from '../services/slice.js';
import { mergeConfigs } from '../services/configMerge.js';
import { activeSchema } from '../services/schema.js';
import { libraryGcodeSchema, libraryMkdirSchema, libraryProjectSchema } from '../validation/library.js';
import { firstIssueMessage } from '../validation/common.js';
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

/** The routes of this router are `async` throughout: Express 5 answers a rejected promise itself. */
export function libraryRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });
  const raw = express.raw({ type: () => true, limit: config.maxUploadBytes });

  r.get('/', async (req, res) => {
    res.json({ root: config.libraryDir, ...(await listLibrary(String(req.query.path || ''))) });
  });

  r.get('/file', async (req, res) => {
    const abs = await resolveLibraryFile(String(req.query.path || ''));
    if (req.query.download !== undefined)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(abs))}"`);
    res.type('application/octet-stream').sendFile(abs);
  });

  // upload from the browser into the library (raw body)
  r.put('/file', raw, async (req, res) => {
    const buf = req.body as Buffer;
    if (!buf || !buf.length) return res.status(400).json({ error: 'empty body' });
    res.json({ ok: true, ...(await writeLibraryFile(String(req.query.path || ''), buf)) });
  });

  r.post('/mkdir', json, async (req, res) => {
    const body = libraryMkdirSchema.parse(req.body ?? {});
    res.json({ ok: true, ...(await makeLibraryDir(body.path, body.name)) });
  });

  r.delete('/file', async (req, res) => {
    await deleteLibraryEntry(String(req.query.path || ''));
    res.json({ ok: true });
  });

  // save the current plater as a 3MF project into the library
  r.post('/project', json, async (req, res) => {
    const parsed = libraryProjectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: firstIssueMessage(parsed.error, 'no objects') });
    const body = req.body as SliceRequest;
    const buf = await build3mfForRequest(body, mergeConfigs(await activeSchema(), body, { forProject: true }));
    const target = libraryTarget(String(req.query.path || ''), String(req.query.name || 'project'), '.3mf');
    res.json({ ok: true, ...(await writeLibraryData(target, buf)) });
  });

  // copy a job's output (G-code) into the library
  r.post('/gcode', json, async (req, res) => {
    const body = libraryGcodeSchema.parse(req.body ?? {});
    const job = getJob(body.jobId);
    if (!job || job.status !== 'done') return res.status(404).json({ error: 'job output not available' });
    const target = libraryTarget(body.path, body.name || job.outputName, path.extname(job.outputName));
    res.json({ ok: true, ...(await copyIntoLibrary(jobOutputPath(job), target)) });
  });

  return r;
}
