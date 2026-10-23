/**
 * The job event stream (SSE) as one use case: the route only wires `req`/`res` to it.
 *
 * A finished job answers the stored state and ends; a running one forwards the queue's events until
 * it ends (or the client goes away). A cancelled job is a status, not an error – the stream used to
 * replay it as `error`, which the browser showed as "Slicing failed" after a cancel (B6).
 */
import type { Request, Response } from 'express';
import { subscribe } from '../jobs.js';
import type { JobEvent, JobRecord } from '@webslicer/shared';

/** Stream the events of `job` to `res`. */
export function streamJobEvents(req: Request, res: Response, job: JobRecord): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (ev: JobEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  send({ type: 'status', job });
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    if (job.status === 'cancelled') send({ type: 'status', job });
    else send({ type: job.status === 'done' ? 'done' : 'error', job, message: job.error });
    res.end();
    return;
  }
  const unsub = subscribe(job.id, (ev) => {
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
}
