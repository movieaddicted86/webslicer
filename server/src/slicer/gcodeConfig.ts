/**
 * The config PrusaSlicer writes into a G-code file (a `; key = value` block between
 * `; prusaslicer_config = begin` and `; prusaslicer_config = end`), turned into preset sections.
 *
 * Only that block is read: the file's tail is loaded, nothing else. Nothing in it is executed – it is
 * a list of settings that then take the same validation as a preset save.
 */
import fs from 'node:fs/promises';
import { ValidationError } from '../errors.js';
import { parseGcodeConfigBlock, type IniSection } from './ini.js';
import { unescapeStringsCstyle } from '@webslicer/shared';

/** How much of the end of the file is read. A PrusaSlicer config block is a few kilobytes. */
export const GCODE_TAIL_BYTES = 512 * 1024;

/** The setting-id keys the merged G-code config carries – the names a preset would have. */
const SETTINGS_IDS: ReadonlySet<string> = new Set([
  'print_settings_id',
  'filament_settings_id',
  'printer_settings_id',
  'physical_printer_settings_id',
]);

/**
 * The config block of a G-code file. Throws a `ValidationError` when there is none – "no config in
 * this file" is a client error, not an empty import.
 */
export async function readGcodeConfig(file: string): Promise<IniSection> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const from = Math.max(0, size - GCODE_TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    await handle.read(buf, 0, buf.length, from);
    const block = parseGcodeConfigBlock(buf.toString('utf8'));
    if (!Object.keys(block).length) {
      throw new ValidationError(`no PrusaSlicer config block in the file (read its last ${GCODE_TAIL_BYTES} bytes)`);
    }
    return block;
  } finally {
    await handle.close();
  }
}

/**
 * Split a merged G-code config into one section per preset type.
 *
 * PrusaSlicer embeds the **merged** config, not the presets: `print_settings_id`/… are the preset
 * names and every other key belongs to whichever type owns it. A key is filed under the first type
 * that knows it, in the order print, filament, printer – the same ownership the settings view uses.
 * A type without a name in the block gets `fallbackName`, so an older or rewritten file still yields
 * presets the user can name.
 */
export function sectionsOfGcodeConfig(
  block: IniSection,
  keysOf: (type: 'print' | 'filament' | 'printer') => readonly string[],
  fallbackName = 'Imported settings',
): Array<{ type: 'print' | 'filament' | 'printer'; name: string; config: IniSection }> {
  const names = {
    print: String(block.print_settings_id || '').trim() || fallbackName,
    filament: unescapeStringsCstyle(block.filament_settings_id || '')[0]?.trim() || fallbackName,
    printer: String(block.printer_settings_id || '').trim() || fallbackName,
  };
  const order = ['print', 'filament', 'printer'] as const;
  const configs: Record<(typeof order)[number], IniSection> = { print: {}, filament: {}, printer: {} };
  const owner = new Map<string, (typeof order)[number]>();
  for (const type of order) for (const key of keysOf(type)) if (!owner.has(key)) owner.set(key, type);
  for (const [key, value] of Object.entries(block)) {
    if (SETTINGS_IDS.has(key)) continue;
    const type = owner.get(key);
    if (type) configs[type][key] = value;
  }
  return order.filter((type) => Object.keys(configs[type]).length).map((type) => ({ type, name: names[type], config: configs[type] }));
}
