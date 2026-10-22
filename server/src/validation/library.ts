/**
 * The file-library payloads as zod schemas (R-10).
 *
 * `routes/library.ts` read these bodies by hand (`String(body.path || '')` and friends); the shapes are
 * declared here instead, so the route only decides what to do with them. Everything is optional and
 * every value is read as a string: a library path is a path, and a missing one already means "the
 * root", exactly as before.
 */
import { z } from 'zod';
import { invalidConfigKeyMessage } from '@webslicer/shared';
import { invalidKeyInRequest } from './config.js';

/** A string field of a library body: `String(value || '')`, the way the routes read them by hand. */
const text = () =>
  z
    .unknown()
    .optional()
    .transform((v) => (v ? String(v) : ''));

/** `POST /api/library/mkdir`: where the new folder goes and what it is called. */
export const libraryMkdirSchema = z.looseObject({
  path: text(),
  // the folder name was read as `String(name ?? '')`, so `0` is a name and `null` is not
  name: z
    .unknown()
    .optional()
    .transform((v) => String(v ?? '')),
});

/** `POST /api/library/gcode`: the job whose output is copied, and where it lands. */
export const libraryGcodeSchema = z.looseObject({
  jobId: text(),
  path: text(),
  name: text(),
});

/**
 * `POST /api/library/project`: the plater state that is stored as a 3MF.
 *
 * Only the object list is a rule – the rest of the body is a slice request that `build3mfForRequest`
 * reads, so the schema keeps it. A body without objects is the route's 400 `no objects`. Since SEC-2
 * the config keys of the request are validated here too: they become the project config and the
 * per-object metadata of the 3MF, the same keys a slice validates.
 */
export const libraryProjectSchema = z
  .looseObject({
    objects: z.array(z.unknown(), { error: () => 'no objects' }).min(1, 'no objects'),
  })
  .superRefine((body, ctx) => {
    const key = invalidKeyInRequest(body as Parameters<typeof invalidKeyInRequest>[0]);
    if (key !== undefined) ctx.addIssue({ code: 'custom', message: invalidConfigKeyMessage(key) });
  });
