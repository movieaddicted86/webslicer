/**
 * The user-preset payload as a zod schema (R-10).
 *
 * One payload, one schema: `PUT /api/presets/:type/:name` is the only route that writes a user preset,
 * so this is where the rule "a config is an object of string values" is declared instead of in the
 * route. The message is pinned by `routes/http.test.ts`.
 */
import { z } from 'zod';
import { invalidConfigKeyMessage } from '@webslicer/shared';
import { invalidKeyOf } from './config.js';
import type { IniSection } from '../slicer/ini.js';

/**
 * The body of `PUT /api/presets/:type/:name`.
 *
 * `config` must be there and be an object – *any* object, an array included, as the route allowed. The
 * values, however, are read as INI strings: a key whose value is not a string is dropped, exactly as
 * the route dropped it. Unknown keys survive (`inherits`, and whatever else a client sends).
 *
 * The *keys* are a rule since SEC-2: a config key becomes a line of the preset INI, so a key that is
 * not `^[a-z][a-z0-9_]*$` (a newline, `=`, whitespace, …) is a 400 naming the key.
 */
export const presetBodySchema = z.looseObject({
  config: z
    .unknown()
    .refine((v) => !!v && typeof v === 'object', { error: () => 'config required' })
    .superRefine((v, ctx) => {
      const key = invalidKeyOf(v);
      if (key !== undefined) ctx.addIssue({ code: 'custom', message: invalidConfigKeyMessage(key) });
    })
    .transform((v) => {
      const cfg: IniSection = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') cfg[k] = val;
      return cfg;
    }),
  inherits: z.string().optional(),
});

/**
 * The body of `POST /api/presets/:type/list` – the context a compatibility flag is computed against.
 *
 * Every field is optional and is only a *request*: a missing `printerConfig` is resolved from
 * `printerName` by the route. `all` is read as a flag.
 */
export const presetListSchema = z.looseObject({
  printerName: z.string().optional(),
  printerConfig: z.record(z.string(), z.unknown()).optional(),
  printName: z.string().optional(),
  printConfig: z.record(z.string(), z.unknown()).optional(),
  all: z
    .unknown()
    .optional()
    .transform((v) => !!v),
});
