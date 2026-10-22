/**
 * Custom G-codes per print Z (color change, pause, tool change, template, custom): the XML PrusaSlicer
 * stores in Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml, written and read.
 */
import { escapeStringCstyle, unescapeStringCstyle, type CustomGcode, type CustomGcodeType } from '@webslicer/shared';
import type { IniSection } from '../ini.js';
import { fmt, xmlEscape, xmlUnescape } from './xml.js';

/** numeric values of PrusaSlicer's CustomGCode::Type */
const CUSTOM_GCODE_TYPE_ID: Record<CustomGcodeType, number> = { color_change: 0, pause: 1, tool_change: 2, template: 3, custom: 4 };

/** Build Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml */
export function customGcodeXml(
  codes: CustomGcode[],
  mode: 'SingleExtruder' | 'MultiAsSingle' | 'MultiExtruder',
  config?: IniSection,
): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<custom_gcodes_per_print_z>'];
  for (const c of [...codes].sort((a, b) => a.printZ - b.printZ)) {
    // "gcode" is only read by PrusaSlicer < 2.3; newer versions use type + extra
    const gcode =
      c.type === 'color_change'
        ? (config?.color_change_gcode ?? 'M600')
        : c.type === 'pause'
          ? (config?.pause_print_gcode ?? 'M601')
          : c.type === 'template'
            ? (config?.template_custom_gcode ?? '')
            : c.type === 'tool_change'
              ? 'tool_change'
              : (c.extra ?? '');
    lines.push(
      `<code print_z="${fmt(c.printZ)}" type="${CUSTOM_GCODE_TYPE_ID[c.type]}" extruder="${c.extruder ?? 1}" color="${xmlEscape(c.color ?? '')}" extra="${xmlEscape(escapeStringCstyle(c.extra ?? ''))}" gcode="${xmlEscape(escapeStringCstyle(gcode))}"/>`,
    );
  }
  lines.push(`<mode value="${mode}"/>`, '</custom_gcodes_per_print_z>');
  return lines.join('\n');
}

export function parseCustomGcodeXml(text: string): CustomGcode[] {
  const out: CustomGcode[] = [];
  const byId = new Map(Object.entries(CUSTOM_GCODE_TYPE_ID).map(([k, v]) => [v, k as CustomGcodeType]));
  const re = /<code\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attributes = m[1];
    const attr = (name: string) => {
      const a = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
      return a ? xmlUnescape(a[1]) : undefined;
    };
    const printZ = Number(attr('print_z'));
    if (!Number.isFinite(printZ)) continue;
    let type: CustomGcodeType;
    const t = attr('type');
    if (t !== undefined) type = byId.get(Number(t)) ?? 'custom';
    else {
      // files written by PrusaSlicer < 2.3: derive the type from the gcode attribute
      const g = attr('gcode') ?? '';
      type = g === 'M600' ? 'color_change' : g === 'M601' ? 'pause' : g === 'tool_change' ? 'tool_change' : 'custom';
    }
    const extra = attr('extra');
    out.push({
      printZ,
      type,
      extruder: Number(attr('extruder')) || 1,
      color: attr('color') || undefined,
      extra: extra ? unescapeStringCstyle(extra) : type === 'custom' ? attr('gcode') : undefined,
    });
  }
  return out;
}
