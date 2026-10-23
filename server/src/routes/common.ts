/**
 * Helpers shared by the resource routers: the one error body, a typed JSON answer, the file
 * existence check the file routes need and the disconnect signal of the long-running tools.
 */
import fs from 'node:fs/promises';
import type { Response } from 'express';

/** Answer a client error as the API always has: `{ error: message }` with status 400. */
export function badRequest(res: Response, msg: string): void {
  res.status(400).json({ error: msg });
}

/**
 * Answer a typed JSON body. The explicit type parameter is what makes the compiler check the body:
 * `sendJson<JobRecord>(res, job)` fails when the job shape drifts from the contract. `status`
 * defaults to 200.
 */
export function sendJson<T>(res: Response, body: T, status = 200): void {
  res.status(status).json(body);
}

/**
 * The path, if it exists as a file – `sendFile` would throw ENOENT otherwise, and the routes need to
 * answer 404 with their own message first.
 */
export async function resolveExistingFile(file: string): Promise<string | undefined> {
  try {
    return (await fs.stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A signal that aborts when the client goes away before the answer is sent (AC-3, q2-slicer-cli):
 * the STEP/cut process is killed and its temp directory removed instead of running on for nobody.
 * `req.on('close')` is no good here – it fires once the body has been read.
 */
export function disconnectSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
