/**
 * Which config keys may reach the slicer (SEC-2, T-033) – the whitelist behind `mergeConfigs`.
 *
 * SEC-1 dropped the server-only keys by name; a key that *contains* one of them
 * (`"x\npost_process = echo pwned"`) was copied verbatim and the INI writer turned it into a second
 * line, which PrusaSlicer ran as a command. The name list alone cannot close that: the shape of the
 * key has to be checked, and a key must be one the installed slicer knows at all.
 *
 * A key is allowed when
 * - it is a well-formed config key (`isValidConfigKey`, shared),
 * - it is not server-only (SEC-1), and
 * - the installed schema knows it: it is an option of `/api/schema` or a preset key of a preset type.
 *
 * Membership is checked against *all* preset types, not the type of the slot the key arrived in:
 * vendor bundles carry print options in printer sections (and vice versa), and `mergeConfigs` merges
 * the slots flat – a per-type check would silently drop keys the slicer itself ships. The security
 * property the whitelist adds is "an arbitrary key is not passed on", and that does not need the
 * type split.
 *
 * Unknown-but-well-formed keys are dropped rather than rejected, so an old project or preset that
 * carries an option the current slicer no longer knows still loads (it did before this change too –
 * the slicer ignores unknown options).
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
