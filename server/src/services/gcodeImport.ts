/**
 * Import config from a G-code file: the embedded `; prusaslicer_config = begin … end` block.
 *
 * The file is streamed to disk by the route (S7) and only its tail is read here; G-code itself is
 * never parsed or executed. The block is a *merged* config, so it is split into one section per preset
 * type by the settings ids it carries, and the result is answered as the same preview a bundle gets:
 * the import itself is the bundle import, so it takes the same validation and the same clash rules.
 */
import { readGcodeConfig, sectionsOfGcodeConfig } from '../slicer/gcodeConfig.js';
import { previewBundle } from './presetTransfer.js';
import type { IniSection } from '../slicer/ini.js';
import type { PresetImportPreview, Schema } from '@webslicer/shared';

/**
 * A section name made safe for a one-line section header. A name from a file may carry `]` or a line
 * end, which would start another section of the bundle text.
 */
function headerName(name: string): string {
  return name.replace(/[[\]\r\n]/g, ' ').trim();
}

/** The bundle text of the sections a G-code config describes (what the dialog shows and imports). */
export function bundleTextOfSections(sections: Array<{ type: string; name: string; config: IniSection }>): string {
  const lines = sections.map((s) => {
    // Values stay verbatim: the block is INI already and the import parses this text the same way.
    const values = Object.entries(s.config).map(([k, v]) => `${k} = ${v}`);
    return `[${s.type}:${headerName(s.name)}]\n${values.join('\n')}\n`;
  });
  return lines.join('\n') + '\n';
}

/** The preview of the config a G-code file carries, ready for the normal bundle import. */
export async function previewGcodeImport(file: string, schema: Schema): Promise<PresetImportPreview> {
  const block = await readGcodeConfig(file);
  const sections = sectionsOfGcodeConfig(block, (type) => schema.presetKeys[type]);
  const preview = previewBundle(bundleTextOfSections(sections), schema);
  return { ...preview, fromGcode: true };
}
