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
 */
import { z } from 'zod';
import { CONFIG_KEY_PATTERN, isValidConfigKey } from '@webslicer/shared';

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
  const configs: unknown[] = [request.print?.config, request.printer?.config];
  for (const f of request.filaments ?? []) configs.push(f?.config);
  for (const o of request.objects ?? []) {
    configs.push(o?.config);
    for (const v of o?.volumes ?? []) configs.push(v?.config);
    for (const r of o?.ranges ?? []) configs.push(r?.config);
  }
  for (const config of configs) {
    const key = invalidKeyOf(config);
    if (key !== undefined) return key;
  }
  return undefined;
}

/** The first key of a config object that is not well-formed, or `undefined`. */
export function invalidKeyOf(config: unknown): string | undefined {
  if (!config || typeof config !== 'object') return undefined;
  for (const key of Object.keys(config)) if (!isValidConfigKey(key)) return key;
  return undefined;
}
