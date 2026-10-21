/**
 * The setting values `set_settings` and `quick_settings` accept, checked against the slicer schema
 * (concept `docs/MCP-Concept.md` §4). This module is about the *shape* of a value; which keys may be
 * set at all and how far a value may move away from the preset is the safety policy of S1-a
 * (`@webslicer/shared` `safety/`, T-025) and is applied by `settings.ts`.
 */
import type { PresetType, Schema } from '@webslicer/shared';
import { ValidationError } from '../errors.js';
import { SERVER_ONLY_KEYS, serverOnlyReason } from '../services/serverOnly.js';

const INT = /^-?\d+$/;
const FLOAT = /^-?\d+(\.\d+)?$/;
const PERCENT = /^-?\d+(\.\d+)?%?$/;
const BOOL = /^(0|1|true|false|yes|no|on|off)$/i;

/** Per-extruder options carry one value per extruder, separated by commas. */
function everyPart(text: string, part: RegExp): boolean {
  return text.split(',').every((p) => part.test(p.trim()));
}

/**
 * Check a setting against the option schema and return the value as PrusaSlicer stores it. Unknown
 * keys, keys of another preset type and values outside an enum are rejected (concept §4).
 *
 * The server-only keys (SEC-1) are rejected too, and before the schema lookup, so the message names
 * the reason instead of "Unknown option": a client that learns the rule from the message is the point
 * of this channel. Everywhere else the key is dropped instead – `services/configMerge.ts`.
 */
export function coerceOptionValue(schema: Schema, type: PresetType, key: string, value: string | number | boolean): string {
  if (SERVER_ONLY_KEYS.has(key)) throw new ValidationError(`Option "${key}" cannot be set: ${serverOnlyReason(key)}`);
  const opt = schema.options[key];
  if (!opt) throw new ValidationError(`Unknown option "${key}"`);
  if (!opt.presetTypes.includes(type)) throw new ValidationError(`Option "${key}" is not a ${type} preset option`);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = String(value).trim();
  if (text === '') throw new ValidationError(`Option "${key}" needs a value`);
  switch (opt.type) {
    case 'bool':
      if (!BOOL.test(text)) throw new ValidationError(`Option "${key}" expects 0/1`);
      return /^(1|true|yes|on)$/i.test(text) ? '1' : '0';
    case 'bools':
      if (!everyPart(text, BOOL)) throw new ValidationError(`Option "${key}" expects 0/1 values`);
      return text;
    case 'enum':
      if (opt.enumValues?.length && !opt.enumValues.includes(text))
        throw new ValidationError(`Option "${key}" must be one of: ${opt.enumValues.join(', ')}`);
      return text;
    case 'int':
      if (!INT.test(text)) throw new ValidationError(`Option "${key}" expects an integer`);
      return text;
    case 'ints':
      if (!everyPart(text, INT)) throw new ValidationError(`Option "${key}" expects integers (one per extruder, comma separated)`);
      return text;
    case 'float':
      if (!FLOAT.test(text)) throw new ValidationError(`Option "${key}" expects a number`);
      return text;
    case 'floats':
      if (!everyPart(text, FLOAT)) throw new ValidationError(`Option "${key}" expects numbers (one per extruder, comma separated)`);
      return text;
    case 'percent':
    case 'float_or_percent':
      if (!PERCENT.test(text)) throw new ValidationError(`Option "${key}" expects a number, percents may end with "%"`);
      return text;
    case 'percents':
    case 'floats_or_percents':
      if (!everyPart(text, PERCENT))
        throw new ValidationError(`Option "${key}" expects numbers (one per extruder, comma separated, percents may end with "%")`);
      return text;
    default:
      return text; // strings, points, points3
  }
}
