/**
 * Slicing jobs: queue a request, list/read/cancel/delete jobs, stream their events (SSE), serve the
 * G-code and log, and send an output to a physical printer.
 */
import express from 'express';
import { cancelJobById, deleteJobById, jobById, jobLogOf, jobOutputPathOf, listJobRecords, submitSliceRequest } from '../services/jobs.js';
import { streamJobEvents } from '../services/jobEvents.js';
import { getPrinter } from '../services/printers.js';
import { sendJobOutput } from '../services/sendGate.js';
import { jobSendSchema } from '../validation/printers.js';
import { firstIssueMessage } from '../validation/common.js';
import { badRequest, resolveExistingFile, sendJson } from './common.js';
import type { JobRecord } from '@webslicer/shared';

/** The job routes of the REST surface. */
export function jobsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  r.post('/slice', json, async (req, res) => {
    sendJson<JobRecord>(res, await submitSliceRequest(req.body), 202);
  });

  r.get('/jobs', (_req, res) => sendJson<JobRecord[]>(res, listJobRecords()));

  r.get('/jobs/:id', (req, res) => {
    const j = jobById(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    sendJson<JobRecord>(res, j);
  });

  r.get('/jobs/:id/events', (req, res) => {
    const j = jobById(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    streamJobEvents(req, res, j);
  });

  r.get('/jobs/:id/gcode', async (req, res) => {
    const j = jobById(req.params.id);
    if (!j || j.status !== 'done') return res.status(404).json({ error: 'output not available' });
    const f = await resolveExistingFile(jobOutputPathOf(j));
    if (!f) return res.status(404).json({ error: 'output missing' });
    if (req.query.download !== undefined)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(j.outputName)}"`);
    res.type(j.outputName.endsWith('.gcode') ? 'text/plain' : 'application/octet-stream').sendFile(f);
  });

  r.get('/jobs/:id/log', async (req, res) => {
    const j = jobById(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    res.type('text/plain').send(await jobLogOf(j.id));
  });

  r.post('/jobs/:id/cancel', (req, res) => {
    if (!cancelJobById(req.params.id)) return res.status(404).json({ error: 'job not cancellable' });
    sendJson(res, { ok: true });
  });

  r.delete('/jobs/:id', async (req, res) => {
    if (!(await deleteJobById(req.params.id))) return res.status(404).json({ error: 'job not found' });
    sendJson(res, { ok: true });
  });

  r.post('/jobs/:id/send', json, async (req, res) => {
    const j = jobById(req.params.id);
    if (!j || j.status !== 'done') return res.status(404).json({ error: 'output not available' });
    const parsed = jobSendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, firstIssueMessage(parsed.error, 'invalid send request'));
    const body = parsed.data;
    const p = body.printerId ? await getPrinter(body.printerId) : undefined;
    if (!p) return badRequest(res, 'printerId required');
    const filename = (body.filename || j.outputName).replace(/[\\/]/g, '_');
    // S1-b: the job's printer preset has to be the one the host is set up for; a block is a 409 with
    // the issues, and only an override with a written reason gets past it (and into the audit log).
    const result = await sendJobOutput({
      job: j,
      printer: p,
      gcodePath: jobOutputPathOf(j),
      filename,
      startPrint: body.startPrint,
      override: body.override,
      reason: body.reason?.trim(),
    });
    sendJson(res, result, result.ok ? 200 : 502);
  });

  return r;
}
