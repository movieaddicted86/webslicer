/**
 * S7: uploads are streamed to disk instead of being held in RAM.
 *
 * `express.raw` buffered the whole body before the handler ran, so a 500 MiB upload cost 500 MiB of
 * heap (and two clients could exhaust the server). The upload routes now hand the request stream to
 * `receiveToFile`, which writes it to a temp file and enforces the size limit *while* streaming: the
 * first byte over the limit aborts the request with **413** and the partial file is removed.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request } from 'express';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

/** A request body that is too large (413) – the same status `express.raw` used to report. */
export class PayloadTooLargeError extends HttpError {
  constructor(limit: number) {
    super(413, `request body too large (limit ${limit} bytes)`);
  }
}

/** The byte limit of an upload; `Content-Length` is checked first, the stream is checked anyway. */
export function uploadLimit(): number {
  return config.maxUploadBytes;
}

/** Bytes actually received, or **413** as soon as the stream crosses the limit. */
async function pipeWithLimit(req: Request, out: fs.WriteStream, limit: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let received = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      req.resume(); // drain the rest so the socket can answer; the client sees the 413
      out.destroy();
      reject(err);
    };
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) fail(new PayloadTooLargeError(limit));
    });
    req.on('aborted', () => fail(new Error('upload aborted')));
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (!failed) resolve(received);
    });
    req.pipe(out);
  });
}

/**
 * Write the request body to `target` (a temp file next to the final one), enforcing `limit` while
 * streaming. Returns the number of bytes written; the caller renames the temp file into place.
 */
export async function receiveToFile(req: Request, target: string, limit = uploadLimit()): Promise<number> {
  const declared = Number(req.header('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) throw new PayloadTooLargeError(limit);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const out = fs.createWriteStream(target);
  try {
    return await pipeWithLimit(req, out, limit);
  } catch (e) {
    await fsp.rm(target, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** Write the request body into a temp file in `dir` and hand it to `use`; the file is always removed. */
export async function withReceivedFile<T>(req: Request, dir: string, use: (file: string, bytes: number) => Promise<T>): Promise<T> {
  const tmp = path.join(dir, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const bytes = await receiveToFile(req, tmp);
  try {
    return await use(tmp, bytes);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}
