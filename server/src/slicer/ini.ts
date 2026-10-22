/**
 * Minimal INI reader/writer compatible with PrusaSlicer config files.
 * PrusaSlicer configs are flat "key = value" files; vendor bundles use [sections].
 * Newlines inside string values are stored as a literal backslash-n.
 */
import { assertValidConfigKey, type Config } from '@webslicer/shared';

/** One INI section; the shared `Config` (same shape – the name keeps the INI reading local). */
export type IniSection = Config;
export type IniDocument = { global: IniSection; sections: Map<string, IniSection> };

export function parseIni(text: string): IniDocument {
  const doc: IniDocument = { global: {}, sections: new Map() };
  let current: IniSection = doc.global;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('#') || t.startsWith(';')) continue;
    if (t.startsWith('[') && t.endsWith(']')) {
      const name = t.slice(1, -1).trim();
      current = doc.sections.get(name) ?? {};
      doc.sections.set(name, current);
      continue;
    }
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    current[key] = value;
  }
  return doc;
}

/** Parse the config block PrusaSlicer embeds at the end of G-code ("; key = value"). */
export function parseGcodeConfigBlock(text: string): IniSection {
  const out: IniSection = {};
  const start = text.indexOf('; prusaslicer_config = begin');
  if (start < 0) return out;
  const end = text.indexOf('; prusaslicer_config = end', start);
  const block = text.slice(start, end < 0 ? undefined : end);
  for (const line of block.split(/\r?\n/)) {
    const m = /^;\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] !== 'prusaslicer_config') out[m[1]] = m[2];
  }
  return out;
}

/**
 * Write one INI section.
 *
 * The key is not escaped – it cannot be: an escaped newline would still make a second line for
 * PrusaSlicer. So the writer refuses a key that is not a well-formed config key (SEC-2): a newline,
 * `=`, `;`, `#`, `[` or whitespace in a key would change the meaning of the file, and a key like
 * `"x\npost_process = …"` wrote a command line into the `config.ini` the slicer loads.
 */
export function serializeIni(section: IniSection, header?: string): string {
  const lines: string[] = [];
  if (header) lines.push(`# ${header}`);
  for (const key of Object.keys(section).sort()) {
    assertValidConfigKey(key);
    const v = section[key] ?? '';
    lines.push(`${key} = ${escapeIniValue(String(v))}`);
  }
  return lines.join('\n') + '\n';
}

export function unescapeIniValue(v: string): string {
  return v.replace(/\\n/g, '\n');
}

export function escapeIniValue(v: string): string {
  return v.replace(/\r?\n/g, '\\n');
}
