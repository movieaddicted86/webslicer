/** Client-side copy of PrusaSlicer value (de)serialization helpers. */
import type { OptionDef } from './api';

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

export function escapeStringsCstyle(values: string[]): string {
  const parts: string[] = [];
  for (const str of values) {
    let quote = values.length === 1 && str === '';
    if (!quote) quote = /[ ;\t\\"\r\n]/.test(str);
    parts.push(quote ? '"' + escapeStringCstyle(str) + '"' : str);
  }
  return parts.join(';');
}

export function unescapeStringsCstyle(s: string): string[] {
  const out: string[] = [];
  if (s === '') return out;
  let i = 0;
  while (i <= s.length) {
    if (i === s.length) {
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

export const VECTOR_TYPES = new Set(['floats', 'ints', 'bools', 'strings', 'percents', 'floats_or_percents', 'points']);

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

export function serializePoints(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x}x${y}`).join(',');
}

// the boolean reading lives in `shared` (R-4); the rest of the codecs follow in R-5
export { toBool } from '@webslicer/shared';

export const MODE_RANK: Record<string, number> = { simple: 0, advanced: 1, expert: 2 };
