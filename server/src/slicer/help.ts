/**
 * Parser for the PrusaSlicer command line help (`--help-fff` / `--help-sla`) and the list of
 * command-line-only shortcut keys. `schema.ts` turns the parsed entries into option definitions.
 */

export interface RawHelpOption {
  key: string;
  category: string;
  hint: string; // N / ABCD / X,Y / ''
  descr: string;
}

/**
 * Options that are only command-line shortcuts or legacy aliases. They must never end up in a
 * config file: PrusaSlicer expands them into other options on load (e.g. "solid_layers" sets
 * top and bottom solid layers, "extruder" overrides all extruder assignments).
 */
export const SHORTCUT_KEYS = new Set([
  'extruder',
  'solid_layers',
  'solid_min_thickness',
  'duplicate_distance',
  'preset_name',
  'preset_names',
  'colorprint_heights',
  'after_layer_gcode',
]);

/**
 * Parse the output of `prusa-slicer --help-fff` / `--help-sla`.
 * `knownKeys` (keys seen in vendor bundles) decides which of several aliases on one help line
 * ("--after-layer-gcode, --layer-gcode") is the canonical option key.
 */
export function parseHelp(text: string, knownKeys?: Set<string>): RawHelpOption[] {
  const lines = text.split(/\r?\n/);
  // Print options start after the "Print options are processed..." paragraph.
  let start = lines.findIndex((l) => l.startsWith('Print options are processed'));
  if (start < 0) start = 0;
  const out: RawHelpOption[] = [];
  let category = '';
  let cur: RawHelpOption | undefined;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('\t')) continue; // ordering paragraph
    // " --name HINT, --alias HINT, -x   description" – every alias may carry its own type hint.
    const optMatch =
      /^ ((?:--?[A-Za-z0-9_-]+(?: (?:N|ABCD|X,Y,Z|X,Y))?)(?:, --?[A-Za-z0-9_-]+(?: (?:N|ABCD|X,Y,Z|X,Y))?)*)(?:\s+(.*))?$/.exec(line);
    if (optMatch && !line.startsWith('  ')) {
      const specs = optMatch[1].split(/,\s+(?=-)/).map((s) => s.trim());
      let hint = '';
      const longKeys: string[] = [];
      for (const spec of specs) {
        const [name, h] = spec.split(' ');
        if (h && !hint) hint = h;
        if (name.startsWith('--')) longKeys.push(name.replace(/^--/, '').replace(/-/g, '_'));
      }
      const key = (knownKeys && longKeys.find((k) => knownKeys.has(k))) || longKeys[0] || specs[0].replace(/^-/, '');
      cur = { key, category, hint, descr: (optMatch[2] || '').trim() };
      out.push(cur);
      continue;
    }
    if (/^[^\s].*:$/.test(line) && !line.startsWith(' ')) {
      category = line.slice(0, -1).trim();
      if (category === 'Misc options') category = 'Misc';
      cur = undefined;
      continue;
    }
    if (cur && line.startsWith('   ')) {
      cur.descr = cur.descr ? cur.descr + ' ' + line.trim() : line.trim();
    }
  }
  return out;
}
