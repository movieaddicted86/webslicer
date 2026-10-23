/**
 * The config objects of the request payloads (SEC-2, T-033).
 *
 * A config is a flat `key → string` map that the server turns into lines of the `config.ini` the
 * slicer loads. The key is therefore part of the file format: `"x\npost_process = …"` is not a key
 * with a strange name, it is two lines, and the second one is a shell command. So the keys are
 * validated here – at every entry point – with the same pattern the INI writer guards with
 * (`isValidConfigKey`, `@webslicer/shared`), and the message names the offending key.
 *
 * Keys that are well-formed but unknown to the installed slicer are *not* a 400: the merge drops them
 * (`services/configKeys.ts`), so an old project still loads after an option was renamed.
 *
 * A **value** with a lone carriage return is a 400 as well (q6-preflight, N2): `\r` is a line end for
 * Marlin, so a value such as `G28\rM500` hides a command from anything that splits on `\n` only.
 */
import { z } from 'zod';
import { CONFIG_KEY_PATTERN, hasLoneCarriageReturn, isValidConfigKey } from '@webslicer/shared';

/** One config key; the message names the key as it was sent (quoted, so a newline stays visible as `\n`). */
export const configKeySchema = z.string({ error: () => 'config keys must be strings' }).regex(CONFIG_KEY_PATTERN, {
  error: (issue) => `invalid config key ${JSON.stringify(String((issue as unknown as { input: unknown }).input))}`,
});

/**
 * A config object: `z.record(configKey, z.string())`, as the task spells it.
 *
 * A config that is not an object at all (the older request rule accepted an empty array as "an
 * object") still passes here and reaches the merge empty – the key rule only inspects keys.
 */
export const configSchema = z.record(configKeySchema, z.string({ error: () => 'config values must be strings' }));

/** The first config of a slice request whose keys are malformed, or `undefined` (SEC-2). */
export function invalidKeyInRequest(request: {
  print?: { config?: unknown };
  printer?: { config?: unknown };
  filaments?: Array<{ config?: unknown }>;
  objects?: Array<{ config?: unknown; volumes?: Array<{ config?: unknown }>; ranges?: Array<{ config?: unknown }> }>;
}): string | undefined {
  for (const config of configsOf(request)) {
    const key = invalidKeyOf(config);
    if (key !== undefined) return key;
  }
  return undefined;
}

/** Every config object of a slice request, in the order the checks read them. */
function configsOf(request: {
  print?: { config?: unknown };
  printer?: { config?: unknown };
  filaments?: Array<{ config?: unknown }>;
  objects?: Array<{ config?: unknown; volumes?: Array<{ config?: unknown }>; ranges?: Array<{ config?: unknown }> }>;
}): unknown[] {
  const configs: unknown[] = [request.print?.config, request.printer?.config];
  for (const f of request.filaments ?? []) configs.push(f?.config);
  for (const o of request.objects ?? []) {
    configs.push(o?.config);
    for (const v of o?.volumes ?? []) configs.push(v?.config);
    for (const r of o?.ranges ?? []) configs.push(r?.config);
  }
  return configs;
}

/** The first key of a config object that is not well-formed, or `undefined`. */
export function invalidKeyOf(config: unknown): string | undefined {
  if (!config || typeof config !== 'object') return undefined;
  for (const key of Object.keys(config)) if (!isValidConfigKey(key)) return key;
  return undefined;
}

/**
 * The first key of a slice request whose *value* carries a lone carriage return, or `undefined`
 * (q6-preflight): a value like `G28\rM500` would hide a command behind `G28` on the printer.
 */
export function loneCarriageReturnInRequest(request: Parameters<typeof configsOf>[0]): string | undefined {
  for (const config of configsOf(request)) {
    const key = loneCarriageReturnOf(config);
    if (key !== undefined) return key;
  }
  return undefined;
}

/** The first key of a config object whose string value carries a lone `\r`, or `undefined`. */
export function loneCarriageReturnOf(config: unknown): string | undefined {
  if (!config || typeof config !== 'object') return undefined;
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && hasLoneCarriageReturn(value)) return key;
  }
  return undefined;
}
