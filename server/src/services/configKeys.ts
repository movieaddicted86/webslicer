/**
 * Which config keys may reach the slicer – the whitelist behind `mergeConfigs`.
 *
 * Dropping the server-only keys by name is not enough: a key that *contains* one (`"x\npost_process =
 * echo pwned"`) used to be copied verbatim, and the INI writer turned it into a second line that
 * PrusaSlicer ran as a command. So a key must be well-formed, not server-only, and known to the
 * installed schema – checked against *all* preset types, because bundles carry print options in
 * printer sections. Unknown-but-well-formed keys are dropped rather than rejected, so old projects
 * still load.
 */
import { SERVER_ONLY_KEYS, isValidConfigKey, type Schema } from '@webslicer/shared';

/** The key set of a schema, built once per schema object. */
const knownKeysCache = new WeakMap<Schema, Set<string>>();

/** Every key the schema knows, across all preset types. */
export function knownConfigKeys(schema: Schema): Set<string> {
  const cached = knownKeysCache.get(schema);
  if (cached) return cached;
  const keys = new Set<string>(Object.keys(schema.options ?? {}));
  for (const list of Object.values(schema.presetKeys ?? {})) for (const key of list) keys.add(key);
  knownKeysCache.set(schema, keys);
  return keys;
}

/** Whether a client key may be written into a slicer config the server produces. */
export function isAllowedConfigKey(schema: Schema, key: string): boolean {
  if (!isValidConfigKey(key)) return false;
  if (SERVER_ONLY_KEYS.has(key)) return false;
  return knownConfigKeys(schema).has(key);
}
