/**
 * Helpers for PrusaSlicer's (de)serialization of config option values.
 * Mirrors escape_string_cstyle / escape_strings_cstyle from libslic3r.
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
    if (quote) parts.push('"' + escapeStringCstyle(str) + '"');
    else parts.push(str);
  }
  return parts.join(';');
}

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
      let j = s.indexOf(';', i);
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

/** Split a vector option value (floats/ints/bools/percents) */
export function splitVector(s: string): string[] {
  if (s === '') return [];
  return s.split(',').map((v) => v.trim());
}

export function joinVector(values: string[]): string {
  return values.join(',');
}

/** Split a coPoints value like "0x0,250x0,250x210,0x210" into [x,y] pairs */
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

export function toBool(s: string | undefined): boolean {
  if (s === undefined) return false;
  const t = s.trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}
