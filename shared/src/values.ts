/**
 * PrusaSlicer config values in the form the INI files and the JSON presets write them.
 *
 * This module is the one home of the value codecs (R-5): the browser parses a config for the
 * settings editor while the CLI builds the same config for the slicer, so escaping, splitting and
 * point reading must not be able to drift apart between the two. Anything that needs a canvas, a
 * three.js scene or the file system stays with its side – here are only the pure string functions.
 */
import type { OptionDef, ThumbnailFormat } from './types/index.js';

/**
 * A PrusaSlicer boolean option (`complete_objects`, `support_material`, …): `1`/`true`/`yes`/`on`,
 * any of them in any case and with surrounding blanks, everything else (and an unset option) is
 * false. The spellings all occur in the vendor presets, so a plain `=== '1'` check reads a
 * sequential print as a normal one.
 */
export function toBool(s: string | undefined): boolean {
  if (s === undefined) return false;
  const t = s.trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

/**
 * C-style escaping of a single config value: `escape_string_cstyle` in libslic3r. A config written
 * by PrusaSlicer has its newlines and quotes escaped, and a config this app writes has to be
 * readable by the CLI again – hence the pair.
 */
export function escapeStringCstyle(s: string): string {
  let out = '';
  for (const c of s) {
    if (c === '\r') out += '\\r';
    else if (c === '\n') out += '\\n';
    else if (c === '\\') out += '\\\\';
    else if (c === '"') out += '\\"';
    else out += c;
  }
  return out;
}

/** Undo {@link escapeStringCstyle}: `\r`, `\n` and any other escaped character. */
export function unescapeStringCstyle(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[++i];
      if (n === 'r') out += '\r';
      else if (n === 'n') out += '\n';
      else out += n;
    } else out += c;
  }
  return out;
}

/**
 * C-style escaping of a multi-value option (`escape_strings_cstyle`): the values are joined with
 * `;`, and a value is quoted when it is empty or carries a separator, a blank or an escape.
 */
export function escapeStringsCstyle(values: string[]): string {
  const parts: string[] = [];
  for (const str of values) {
    let quote = values.length === 1 && str === '';
    if (!quote) quote = /[ ;\t\\"\r\n]/.test(str);
    parts.push(quote ? '"' + escapeStringCstyle(str) + '"' : str);
  }
  return parts.join(';');
}

/**
 * Split a multi-value option (`unescape_strings_cstyle`) back into its values: `;` separates, a
 * quoted value may contain separators, and a trailing separator is an empty last value.
 */
export function unescapeStringsCstyle(s: string): string[] {
  const out: string[] = [];
  if (s === '') return out;
  let i = 0;
  while (i <= s.length) {
    if (i === s.length) {
      // trailing separator → empty string
      out.push('');
      break;
    }
    if (s[i] === '"') {
      let cur = '';
      i++;
      let closed = false;
      while (i < s.length) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length) {
          const n = s[i + 1];
          if (n === 'r') cur += '\r';
          else if (n === 'n') cur += '\n';
          else cur += n;
          i += 2;
        } else if (c === '"') {
          i++;
          closed = true;
          break;
        } else {
          cur += c;
          i++;
        }
      }
      out.push(cur);
      if (!closed) break;
      if (i < s.length && s[i] === ';') {
        i++;
        if (i === s.length) out.push('');
      }
      if (i >= s.length) break;
    } else {
      const j = s.indexOf(';', i);
      if (j < 0) {
        out.push(s.slice(i));
        break;
      }
      out.push(s.slice(i, j));
      i = j + 1;
      if (i === s.length) {
        out.push('');
        break;
      }
    }
  }
  return out;
}

/** Split a plain vector option value (`floats`, `ints`, `bools`, `percents`, …) on `,`. */
export function splitVector(s: string): string[] {
  if (s === '') return [];
  return s.split(',').map((v) => v.trim());
}

/** Join a plain vector option value back together. */
export function joinVector(values: string[]): string {
  return values.join(',');
}

/** The option types whose value is a list; `strings` and `points` are lists with their own codec. */
export const VECTOR_TYPES = new Set(['floats', 'ints', 'bools', 'strings', 'percents', 'floats_or_percents', 'points']);

/** Whether the option holds a list of values rather than a single one. */
export function isVector(def: OptionDef): boolean {
  return VECTOR_TYPES.has(def.type);
}

/** Decode a raw option value into an array of element strings (scalar → single element). */
export function decodeVector(def: OptionDef, raw: string | undefined): string[] {
  const v = raw ?? def.default ?? '';
  if (def.type === 'strings') return unescapeStringsCstyle(v);
  if (def.type === 'points') return v === '' ? [] : v.split(',').map((s) => s.trim());
  if (isVector(def)) return v === '' ? [] : v.split(',').map((s) => s.trim());
  if (def.type === 'string') return [unescapeStringCstyle(v)];
  return [v];
}

/** Encode the edited element strings of an option back into its raw value. */
export function encodeVector(def: OptionDef, values: string[]): string {
  if (def.type === 'strings') return escapeStringsCstyle(values);
  if (isVector(def)) return values.join(',');
  if (def.type === 'string') return escapeStringCstyle(values[0] ?? '');
  return values[0] ?? '';
}

/** Resize a per-extruder vector by repeating the last element. */
export function resizeVector(def: OptionDef, raw: string | undefined, n: number): string {
  const values = decodeVector(def, raw);
  if (!values.length) values.push(decodeVector(def, def.default)[0] ?? (def.type === 'bools' ? '0' : '0'));
  while (values.length < n) values.push(values[values.length - 1]);
  values.length = n;
  return encodeVector(def, values);
}

/** Split a `points` option value like "0x0,250x0,250x210,0x210" into [x,y] pairs. */
export function parsePoints(s: string): Array<[number, number]> {
  if (!s) return [];
  return s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [x, y] = p.split('x').map(Number);
      return [x || 0, y || 0] as [number, number];
    });
}

/** Write `points` back in the `x,y`-pairs-per-`x` form the `bed_shape` option uses. */
export function serializePoints(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x}x${y}`).join(',');
}

/** One thumbnail a preset asks for: the size to render and the file format to write. */
export interface ThumbnailSpec {
  width: number;
  height: number;
  format: ThumbnailFormat;
}

/**
 * Parse PrusaSlicer's "thumbnails" option ("16x16/QOI, 313x173/QOI" or legacy "16x16, 220x124").
 * The browser renders exactly these and the server writes them into the G-code, so both read the
 * option here; `defaultFormat` is the preset's `thumbnails_format`, and a format written into the
 * entry wins over it.
 */
export function parseThumbnailSpec(spec: string | undefined, defaultFormat: string | undefined): ThumbnailSpec[] {
  if (!spec) return [];
  const def = (defaultFormat || 'PNG').toUpperCase();
  const out: ThumbnailSpec[] = [];
  for (const part of spec.split(',')) {
    const m = /^\s*(\d+)\s*x\s*(\d+)\s*(?:\/\s*([A-Za-z]+))?\s*$/.exec(part);
    if (!m) continue;
    const f = (m[3] || def).toUpperCase();
    out.push({ width: Number(m[1]), height: Number(m[2]), format: f === 'JPG' || f === 'JPEG' ? 'JPG' : f === 'QOI' ? 'QOI' : 'PNG' });
  }
  return out;
}
