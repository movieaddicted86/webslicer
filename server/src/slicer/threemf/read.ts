/**
 * The 3MF project reader: build items and their transforms, per-triangle paint, height range
 * modifiers, global and per-object config, custom G-codes.
 */
import JSZip from 'jszip';
import { attributeToTriangleState, PAINT_BLOCKER, PAINT_ENFORCER } from '../paint.js';
import type { IniSection } from '../ini.js';
import {
  transformFrom3mf,
  VOLUME_TYPES,
  type CustomGcode,
  type LayerRangeInput,
  type ProjectObject,
  type ProjectVolume,
  type VolumeType,
} from '@webslicer/shared';
import { parseCustomGcodeXml } from './customGcode.js';
import { xmlUnescape } from './xml.js';
import { assertZipReasonable, readZipEntryText } from './zipLimits.js';

/** Read per-triangle paint attributes of every object in 3D/3dmodel.model (by object id). */
function readPaintFromModel(model: string): Map<string, { supports?: string; seam?: string; mmu?: string }> {
  const out = new Map<string, { supports?: string; seam?: string; mmu?: string }>();
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(model))) {
    const idm = /\bid="([^"]+)"/.exec(m[1]);
    if (!idm) continue;
    const body = m[2];
    if (!/slic3rpe:(custom_supports|custom_seam|mmu_segmentation)=/.test(body)) continue;
    let sup = '';
    let seam = '';
    let mmu = '';
    let anySup = false;
    let anySeam = false;
    let anyMmu = false;
    const triRe = /<triangle\b([^>]*)\/?>/g;
    let t: RegExpExecArray | null;
    while ((t = triRe.exec(body))) {
      const a = t[1];
      const s = /slic3rpe:custom_supports="([^"]*)"/.exec(a);
      const e = /slic3rpe:custom_seam="([^"]*)"/.exec(a);
      const x = /slic3rpe:mmu_segmentation="([^"]*)"/.exec(a);
      const ss = attributeToTriangleState(s?.[1]);
      const es = attributeToTriangleState(e?.[1]);
      const xs = Math.min(15, attributeToTriangleState(x?.[1]));
      sup += ss === PAINT_ENFORCER ? '4' : ss === PAINT_BLOCKER ? '8' : '0';
      seam += es === PAINT_ENFORCER ? '4' : es === PAINT_BLOCKER ? '8' : '0';
      mmu += xs.toString(16);
      if (ss) anySup = true;
      if (es) anySeam = true;
      if (xs) anyMmu = true;
    }
    out.set(idm[1], { supports: anySup ? sup : undefined, seam: anySeam ? seam : undefined, mmu: anyMmu ? mmu : undefined });
  }
  return out;
}

/** Build items of 3D/3dmodel.model in document order: the object id each one instantiates and its transform. */
export function parse3mfBuild(model: string): Array<{ objectId: string; transform: number[] }> {
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(model)?.[1];
  if (!build) return [];
  const out: Array<{ objectId: string; transform: number[] }> = [];
  const itemRe = /<item\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(build))) {
    const objectId = /\bobjectid="([^"]+)"/.exec(m[1])?.[1];
    if (!objectId) continue;
    const t = /\btransform="([^"]+)"/.exec(m[1])?.[1];
    out.push({ objectId, transform: t ? transformFrom3mf(t) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
  }
  return out;
}

/** Read the global config and object/volume list from a PrusaSlicer 3MF project. */
export async function read3mfProject(
  buf: Buffer,
): Promise<{ config: IniSection; objects: ProjectObject[]; customGcodes: CustomGcode[]; buildOrder: number[] }> {
  const zip = await JSZip.loadAsync(buf);
  // S7: the directory is all an untrusted archive may cost before the size limits are checked
  assertZipReasonable(zip);
  const cfg: IniSection = {};
  const cfgFile = zip.file('Metadata/Slic3r_PE.config');
  if (cfgFile) {
    const text = await readZipEntryText(zip, 'Metadata/Slic3r_PE.config');
    for (const line of text.split(/\r?\n/)) {
      const m = /^;\s*([A-Za-z0-9_]+)\s*=\s?(.*)$/.exec(line);
      if (m) cfg[m[1]] = m[2];
    }
  }
  const objects: ProjectObject[] = [];
  /** model ids of the parsed objects, parallel to `objects` (for the build-item mapping) */
  const objectIds: string[] = [];
  let buildItems: Array<{ objectId: string; transform: number[] }> = [];
  let paintById = new Map<string, { supports?: string; seam?: string; mmu?: string }>();
  const modelFile = zip.file('3D/3dmodel.model');
  if (modelFile) {
    const model = await readZipEntryText(zip, '3D/3dmodel.model');
    if (model.includes('slic3rpe:custom_')) paintById = readPaintFromModel(model);
    buildItems = parse3mfBuild(model);
  }
  // height range modifiers
  const rangesById = new Map<string, LayerRangeInput[]>();
  const lrFile = zip.file('Metadata/Prusa_Slicer_layer_config_ranges.xml');
  if (lrFile) {
    const text = await readZipEntryText(zip, 'Metadata/Prusa_Slicer_layer_config_ranges.xml');
    const objRe = /<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(text))) {
      const list: LayerRangeInput[] = [];
      const rangeRe = /<range\s+min_z="([^"]+)"\s+max_z="([^"]+)"[^>]*>([\s\S]*?)<\/range>/g;
      let rm: RegExpExecArray | null;
      while ((rm = rangeRe.exec(om[2]))) {
        const rc: IniSection = {};
        const optRe = /<option\s+opt_key="([^"]+)"[^>]*>([^<]*)<\/option>/g;
        let x: RegExpExecArray | null;
        while ((x = optRe.exec(rm[3]))) rc[x[1]] = xmlUnescape(x[2]);
        list.push({ minZ: Number(rm[1]), maxZ: Number(rm[2]), config: rc });
      }
      rangesById.set(om[1], list);
    }
  }
  const mcFile = zip.file('Metadata/Slic3r_PE_model.config');
  if (mcFile) {
    const text = await readZipEntryText(zip, 'Metadata/Slic3r_PE_model.config');
    const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let m: RegExpExecArray | null;
    while ((m = objRe.exec(text))) {
      const objId = /\bid="([^"]+)"/.exec(m[1])?.[1] || '';
      const paint = paintById.get(objId);
      const body = m[2];
      const oc: IniSection = {};
      let name = '';
      let extruder: number | undefined;
      const mdRe = /<metadata\s+type="object"\s+key="([^"]+)"\s+value="([^"]*)"/g;
      let mm: RegExpExecArray | null;
      while ((mm = mdRe.exec(body))) {
        const k = mm[1];
        const v = xmlUnescape(mm[2]);
        if (k === 'name') name = v;
        else if (k === 'extruder') extruder = Number(v) || undefined;
        else oc[k] = v;
      }
      const ranges: LayerRangeInput[] = rangesById.get(objId) || [];
      const instances = buildItems.filter((b) => b.objectId === objId).map((b) => b.transform);
      const volumes: ProjectVolume[] = [];
      const volRe = /<volume\s+firstid="(\d+)"\s+lastid="(\d+)"[^>]*>([\s\S]*?)<\/volume>/g;
      let vm: RegExpExecArray | null;
      while ((vm = volRe.exec(body))) {
        const vol: ProjectVolume = { name: '', type: 'ModelPart', first: Number(vm[1]), last: Number(vm[2]), config: {} };
        const vmd = /<metadata\s+type="volume"\s+key="([^"]+)"\s+value="([^"]*)"/g;
        let x: RegExpExecArray | null;
        while ((x = vmd.exec(vm[3]))) {
          const k = x[1];
          const v = xmlUnescape(x[2]);
          if (k === 'name') vol.name = v;
          else if (k === 'volume_type') vol.type = (VOLUME_TYPES as string[]).includes(v) ? (v as VolumeType) : 'ModelPart';
          else if (k === 'extruder') vol.extruder = Number(v) || undefined;
          else if (k === 'matrix') vol.matrix = v.split(/\s+/).map(Number);
          else if (k === 'modifier') {
            if (v === '1' && vol.type === 'ModelPart') vol.type = 'ParameterModifier';
          } else if (
            [
              'source_file',
              'source_object_id',
              'source_volume_id',
              'source_offset_x',
              'source_offset_y',
              'source_offset_z',
              'source_in_inches',
              'source_in_meters',
              'mesh_stat',
              'mesh_text_info',
            ].includes(k)
          ) {
            /* ignore */
          } else vol.config[k] = v;
        }
        volumes.push(vol);
      }
      objects.push({
        name,
        config: oc,
        extruder,
        instances,
        volumes,
        supportPaint: paint?.supports,
        seamPaint: paint?.seam,
        mmuPaint: paint?.mmu,
        ranges,
      });
      objectIds.push(objId);
    }
  }
  let customGcodes: CustomGcode[] = [];
  const cgFile = zip.file('Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml');
  if (cgFile) customGcodes = parseCustomGcodeXml(await readZipEntryText(zip, 'Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml'));
  // object index of every build item, in build order (a 3MF loader returns one mesh per item)
  const buildOrder = buildItems.map((b) => objectIds.indexOf(b.objectId));
  return { config: cfg, objects, customGcodes, buildOrder };
}
