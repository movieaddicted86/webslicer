/**
 * Slicing jobs: queue a request, list/read/cancel/delete jobs, stream their events (SSE), serve the
 * G-code and log, and send an output to a physical printer.
 */
import express from 'express';
import { activeSchema } from '../services/schema.js';
import { validateConfigLimits, validateSliceRequest } from '../services/slice.js';
import { createJob, getJob, listJobs, subscribe, cancelJob, deleteJob, jobOutputPath, readJobLog } from '../jobs.js';
import { getPrinter } from '../services/printers.js';
import { sendJobOutput } from '../services/sendGate.js';
import { jobSendSchema } from '../validation/printers.js';
import { firstIssueMessage } from '../validation/common.js';
import { badRequest, resolveExistingFile, sendJson } from './common.js';
import type { JobRecord, SliceRequest } from '@webslicer/shared';

/** The job routes of the REST surface. */
export function jobsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  r.post('/slice', json, async (req, res) => {
    const body = req.body as SliceRequest;
    try {
      validateSliceRequest(body);
    } catch (e) {
      return badRequest(res, (e as Error).message);
    }
    // S1-d/N3: a typo in a temperature, a nozzle or the layer height is a 400 with its issues; the
    // check runs on the merged config the slicer receives, so a value from a print or printer preset
    // is caught as well. A soft range only warns and travels with the job.
    const s = await activeSchema();
    const configIssues = validateConfigLimits(body, s);
    const job = await createJob(body, s, configIssues);
    res.status(202).json(job);
  });

  r.get('/jobs', (_req, res) => sendJson<JobRecord[]>(res, listJobs()));

  r.get('/jobs/:id', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    sendJson<JobRecord>(res, j);
  });

  r.get('/jobs/:id/events', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'status', job: j });
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
      // a cancelled job is a status, not an error – the stream used to replay it as `error`, which the
      // browser showed as "Slicing failed" after a cancel (B6)
      if (j.status === 'cancelled') send({ type: 'status', job: j });
      else send({ type: j.status === 'done' ? 'done' : 'error', job: j, message: j.error });
      res.end();
      return;
    }
    const unsub = subscribe(j.id, (ev) => {
      send(ev);
      if (ev.type === 'done' || ev.type === 'error' || (ev.type === 'status' && ev.job?.status === 'cancelled')) {
        unsub();
        res.end();
      }
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  r.get('/jobs/:id/gcode', async (req, res) => {
    const j = getJob(req.params.id);
    if (!j || j.status !== 'done') return res.status(404).json({ error: 'output not available' });
    const f = await resolveExistingFile(jobOutputPath(j));
    if (!f) return res.status(404).json({ error: 'output missing' });
    if (req.query.download !== undefined)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(j.outputName)}"`);
    res.type(j.outputName.endsWith('.gcode') ? 'text/plain' : 'application/octet-stream').sendFile(f);
  });

  r.get('/jobs/:id/log', async (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    res.type('text/plain').send(await readJobLog(j.id));
  });

  r.post('/jobs/:id/cancel', (req, res) => {
    if (!cancelJob(req.params.id)) return res.status(404).json({ error: 'job not cancellable' });
    res.json({ ok: true });
  });

  r.delete('/jobs/:id', async (req, res) => {
    if (!(await deleteJob(req.params.id))) return res.status(404).json({ error: 'job not found' });
    res.json({ ok: true });
  });

  r.post('/jobs/:id/send', json, async (req, res) => {
    const j = getJob(req.params.id);
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
      gcodePath: jobOutputPath(j),
      filename,
      startPrint: body.startPrint,
      override: body.override,
      reason: body.reason?.trim(),
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  return r;
}
