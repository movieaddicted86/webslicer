/**
 * Mesh helpers: binary/ASCII STL parsing and 3MF project writing/reading.
 * The 3MF writer produces files PrusaSlicer loads with per-object transforms,
 * per-object config overrides and sub-volumes (parts, modifiers, support
 * enforcers/blockers, negative volumes) in Metadata/Slic3r_PE_model.config.
 */
import JSZip from 'jszip';
import type { IniSection } from './ini.js';
import { attributeToTriangleState, triangleStateToAttribute, PAINT_BLOCKER, PAINT_ENFORCER } from './paint.js';
import {
  escapeStringCstyle,
  transformFrom3mf,
  transformTo3mf,
  unescapeStringCstyle,
  VOLUME_TYPES,
  type CustomGcode,
  type CustomGcodeType,
  type LayerRangeInput,
  type ProjectObject,
  type ProjectVolume,
  type VolumeType,
} from '@webslicer/shared';

export interface Mesh {
  /** flat xyz positions */
  vertices: Float32Array;
  /** triangle indices */
  indices: Uint32Array;
}

export function parseStl(buf: Buffer): Mesh {
  const isBinary = (() => {
    if (buf.length < 84) return false;
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) return true;
    const head = buf.subarray(0, Math.min(buf.length, 512)).toString('latin1');
    return !/^\s*solid/i.test(head) || !/facet/i.test(head);
  })();
  return isBinary ? parseBinaryStl(buf) : parseAsciiStl(buf.toString('latin1'));
}

function dedupe(positions: number[]): Mesh {
  const map = new Map<string, number>();
  const verts: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const key = `${x},${y},${z}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = verts.length / 3;
      map.set(key, idx);
      verts.push(x, y, z);
    }
    indices.push(idx);
  }
  return { vertices: Float32Array.from(verts), indices: Uint32Array.from(indices) };
}

function parseBinaryStl(buf: Buffer): Mesh {
  const n = buf.readUInt32LE(80);
  const positions: number[] = new Array(n * 9);
  let o = 84;
  let p = 0;
  for (let i = 0; i < n; i++) {
    o += 12; // normal
    for (let v = 0; v < 9; v++) {
      positions[p++] = buf.readFloatLE(o);
      o += 4;
    }
    o += 2; // attribute byte count
  }
  return dedupe(positions);
}

function parseAsciiStl(text: string): Mesh {
  const positions: number[] = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) positions.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return dedupe(positions);
}

export function writeBinaryStl(mesh: Mesh): Buffer {
  const n = mesh.indices.length / 3;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('WebSlicer binary STL', 0, 'latin1');
  buf.writeUInt32LE(n, 80);
  let o = 84;
  const v = mesh.vertices;
  for (let i = 0; i < n; i++) {
    const a = mesh.indices[i * 3] * 3;
    const b = mesh.indices[i * 3 + 1] * 3;
    const c = mesh.indices[i * 3 + 2] * 3;
    const ux = v[b] - v[a],
      uy = v[b + 1] - v[a + 1],
      uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a],
      wy = v[c + 1] - v[a + 1],
      wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy,
      ny = uz * wx - ux * wz,
      nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    buf.writeFloatLE(nx, o);
    buf.writeFloatLE(ny, o + 4);
    buf.writeFloatLE(nz, o + 8);
    o += 12;
    for (const idx of [a, b, c]) {
      buf.writeFloatLE(v[idx], o);
      buf.writeFloatLE(v[idx + 1], o + 4);
      buf.writeFloatLE(v[idx + 2], o + 8);
      o += 12;
    }
    buf.writeUInt16LE(0, o);
    o += 2;
  }
  return buf;
}

/** Apply a column-major 4x4 matrix to every vertex (returns a new mesh). */
export function transformMesh(mesh: Mesh, m: number[]): Mesh {
  const src = mesh.vertices;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i],
      y = src[i + 1],
      z = src[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // a mirroring transform flips the winding order
  const det =
    m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  let indices = mesh.indices;
  if (det < 0) {
    indices = new Uint32Array(mesh.indices.length);
    for (let i = 0; i < indices.length; i += 3) {
      indices[i] = mesh.indices[i];
      indices[i + 1] = mesh.indices[i + 2];
      indices[i + 2] = mesh.indices[i + 1];
    }
  }
  return { vertices: out, indices };
}

export interface ThreeMfVolume {
  name: string;
  /** mesh in object coordinates (volume transform already applied) */
  mesh: Mesh;
  type: VolumeType;
  config?: IniSection;
  extruder?: number;
}

export interface ThreeMfObject {
  name: string;
  /** main model part, in object coordinates */
  mesh: Mesh;
  /** 4x4 column-major transform (three.js Matrix4.elements order) */
  transform: number[];
  /** additional instance transforms of this object, including the first (3MF `<build><item>`) */
  instances?: number[][];
  /** per-object config overrides (PrusaSlicer model config) */
  config?: IniSection;
  extruder?: number;
  /** additional volumes (parts, modifiers, support enforcers/blockers, negative volumes) */
  volumes?: ThreeMfVolume[];
  /** per-triangle paint of the main mesh, one char per triangle ('0' none, '4' enforcer, '8' blocker) */
  supportPaint?: string;
  seamPaint?: string;
  /** MMU painting: one hex char per triangle = extruder index (0 = default) */
  mmuPaint?: string;
  /** height range modifiers (object Z) with per-range settings */
  ranges?: LayerRangeInput[];
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Number as the 3MF writer prints it: an integer stays bare, everything else keeps 6 decimals. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '');
}

/** Build a 3MF project archive from meshes. */
/** numeric values of PrusaSlicer's CustomGCode::Type */
const CUSTOM_GCODE_TYPE_ID: Record<CustomGcodeType, number> = { color_change: 0, pause: 1, tool_change: 2, template: 3, custom: 4 };

/** Build Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml */
export function customGcodeXml(codes: CustomGcode[], mode: 'SingleExtruder' | 'MultiAsSingle' | 'MultiExtruder', config?: IniSection): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<custom_gcodes_per_print_z>'];
  for (const c of [...codes].sort((a, b) => a.printZ - b.printZ)) {
    // "gcode" is only read by PrusaSlicer < 2.3; newer versions use type + extra
    const gcode =
      c.type === 'color_change'
        ? config?.color_change_gcode ?? 'M600'
        : c.type === 'pause'
          ? config?.pause_print_gcode ?? 'M601'
          : c.type === 'template'
            ? config?.template_custom_gcode ?? ''
            : c.type === 'tool_change'
              ? 'tool_change'
              : c.extra ?? '';
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
    const attr = (name: string) => {
      const a = new RegExp(`\\b${name}="([^"]*)"`).exec(m![1]);
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

export async function build3mf(
  objects: ThreeMfObject[],
  opts: { projectConfig?: IniSection; title?: string; customGcodes?: CustomGcode[]; extruders?: number } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">',
  );
  parts.push(` <metadata name="Application">WebSlicer</metadata>`);
  // Mark the file as PrusaSlicer-style 3MF: build item transforms are instance transforms and
  // volume meshes are in object coordinates. Without this, PrusaSlicer treats the file as a
  // foreign 3MF and bakes the item transform into the first volume only, misplacing modifiers.
  parts.push(` <metadata name="slic3rpe:Version3mf">1</metadata>`);
  if (opts.title) parts.push(` <metadata name="Title">${xmlEscape(opts.title)}</metadata>`);
  parts.push(' <resources>');

  // Per object: concatenate the main part and all volumes into one mesh; remember triangle ranges.
  const volumeRanges: Array<Array<{ vol: ThreeMfVolume; first: number; last: number }>> = [];
  objects.forEach((obj, i) => {
    const id = i + 1;
    const all: ThreeMfVolume[] = [
      { name: obj.name, mesh: obj.mesh, type: 'ModelPart', extruder: undefined },
      ...(obj.volumes || []),
    ];
    parts.push(`  <object id="${id}" name="${xmlEscape(obj.name)}" type="model">`);
    parts.push('   <mesh>');
    parts.push('    <vertices>');
    let vertexOffset = 0;
    let triOffset = 0;
    const ranges: Array<{ vol: ThreeMfVolume; first: number; last: number }> = [];
    const triParts: string[] = [];
    let volIndex = 0;
    for (const vol of all) {
      const isMain = volIndex++ === 0;
      const sup = isMain ? obj.supportPaint : undefined;
      const seam = isMain ? obj.seamPaint : undefined;
      const mmu = isMain ? obj.mmuPaint : undefined;
      const v = vol.mesh.vertices;
      const vs: string[] = new Array(v.length / 3);
      for (let j = 0; j < v.length; j += 3) {
        vs[j / 3] = `     <vertex x="${fmt(v[j])}" y="${fmt(v[j + 1])}" z="${fmt(v[j + 2])}"/>`;
      }
      parts.push(vs.join('\n'));
      const t = vol.mesh.indices;
      const ts: string[] = new Array(t.length / 3);
      for (let j = 0; j < t.length; j += 3) {
        const ti = j / 3;
        let attrs = '';
        if (sup && sup[ti] && sup[ti] !== '0') attrs += ` slic3rpe:custom_supports="${sup[ti]}"`;
        if (seam && seam[ti] && seam[ti] !== '0') attrs += ` slic3rpe:custom_seam="${seam[ti]}"`;
        if (mmu && mmu[ti] && mmu[ti] !== '0') {
          const a = triangleStateToAttribute(parseInt(mmu[ti], 16) || 0);
          if (a) attrs += ` slic3rpe:mmu_segmentation="${a}"`;
        }
        ts[ti] = `     <triangle v1="${t[j] + vertexOffset}" v2="${t[j + 1] + vertexOffset}" v3="${t[j + 2] + vertexOffset}"${attrs}/>`;
      }
      triParts.push(ts.join('\n'));
      const triCount = t.length / 3;
      ranges.push({ vol, first: triOffset, last: triOffset + triCount - 1 });
      vertexOffset += v.length / 3;
      triOffset += triCount;
    }
    parts.push('    </vertices>');
    parts.push('    <triangles>');
    parts.push(triParts.join('\n'));
    parts.push('    </triangles>');
    parts.push('   </mesh>');
    parts.push('  </object>');
    volumeRanges.push(ranges);
  });
  parts.push(' </resources>');
  parts.push(' <build>');
  objects.forEach((obj, i) => {
    // one <item> per instance; the object mesh stays in object coordinates
    for (const transform of obj.instances?.length ? obj.instances : [obj.transform]) {
      parts.push(`  <item objectid="${i + 1}" transform="${transformTo3mf(transform)}" printable="1"/>`);
    }
  });
  parts.push(' </build>');
  parts.push('</model>');
  zip.file('3D/3dmodel.model', parts.join('\n'));

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>',
  );

  // PrusaSlicer model config: per-object settings + volumes
  const mc: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  objects.forEach((obj, i) => {
    const id = i + 1;
    mc.push(` <object id="${id}" instances_count="${obj.instances?.length || 1}">`);
    mc.push(`  <metadata type="object" key="name" value="${xmlEscape(obj.name)}"/>`);
    if (obj.extruder && obj.extruder > 0) mc.push(`  <metadata type="object" key="extruder" value="${obj.extruder}"/>`);
    for (const [k, val] of Object.entries(obj.config || {})) {
      mc.push(`  <metadata type="object" key="${xmlEscape(k)}" value="${xmlEscape(escapeStringCstyle(val))}"/>`);
    }
    for (const r of volumeRanges[i]) {
      mc.push(`  <volume firstid="${r.first}" lastid="${r.last}">`);
      mc.push(`   <metadata type="volume" key="name" value="${xmlEscape(r.vol.name)}"/>`);
      mc.push(`   <metadata type="volume" key="volume_type" value="${r.vol.type}"/>`);
      if (r.vol.extruder && r.vol.extruder > 0) mc.push(`   <metadata type="volume" key="extruder" value="${r.vol.extruder}"/>`);
      for (const [k, val] of Object.entries(r.vol.config || {})) {
        mc.push(`   <metadata type="volume" key="${xmlEscape(k)}" value="${xmlEscape(escapeStringCstyle(val))}"/>`);
      }
      mc.push(`   <metadata type="volume" key="source_file" value="${xmlEscape(r.vol.name)}"/>`);
      mc.push(`   <metadata type="volume" key="source_object_id" value="0"/>`);
      mc.push(`   <metadata type="volume" key="source_volume_id" value="0"/>`);
      mc.push('  </volume>');
    }
    mc.push(' </object>');
  });
  mc.push('</config>');
  zip.file('Metadata/Slic3r_PE_model.config', mc.join('\n'));

  if (opts.customGcodes?.length) {
    const mode = (opts.extruders ?? 1) > 1 ? 'MultiAsSingle' : 'SingleExtruder';
    zip.file('Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml', customGcodeXml(opts.customGcodes, mode, opts.projectConfig));
  }

  // Height range modifiers live in their own file (PrusaSlicer: Prusa_Slicer_layer_config_ranges.xml)
  if (objects.some((o) => o.ranges && o.ranges.some((r) => r.maxZ > r.minZ))) {
    const lr: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<objects>'];
    objects.forEach((obj, i) => {
      const valid = (obj.ranges || []).filter((r) => r.maxZ > r.minZ);
      if (!valid.length) return;
      lr.push(` <object id="${i + 1}">`);
      for (const r of valid) {
        lr.push(`  <range min_z="${fmt(r.minZ)}" max_z="${fmt(r.maxZ)}">`);
        for (const [k, val] of Object.entries(r.config || {})) {
          lr.push(`   <option opt_key="${xmlEscape(k)}">${xmlEscape(escapeStringCstyle(val))}</option>`);
        }
        lr.push('  </range>');
      }
      lr.push(' </object>');
    });
    lr.push('</objects>');
    zip.file('Metadata/Prusa_Slicer_layer_config_ranges.xml', lr.join('\n'));
  }

  if (opts.projectConfig) {
    // Values are already in their INI-serialized form (newlines escaped), write them verbatim.
    const lines = Object.keys(opts.projectConfig)
      .sort()
      .map((k) => `; ${k} = ${opts.projectConfig![k]}`);
    zip.file('Metadata/Slic3r_PE.config', lines.join('\n') + '\n');
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

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

function xmlUnescape(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
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
  const cfg: IniSection = {};
  const cfgFile = zip.file('Metadata/Slic3r_PE.config');
  if (cfgFile) {
    const text = await cfgFile.async('string');
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
    const model = await modelFile.async('string');
    if (model.includes('slic3rpe:custom_')) paintById = readPaintFromModel(model);
    buildItems = parse3mfBuild(model);
  }
  // height range modifiers
  const rangesById = new Map<string, LayerRangeInput[]>();
  const lrFile = zip.file('Metadata/Prusa_Slicer_layer_config_ranges.xml');
  if (lrFile) {
    const text = await lrFile.async('string');
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
    const text = await mcFile.async('string');
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
          } else if (['source_file', 'source_object_id', 'source_volume_id', 'source_offset_x', 'source_offset_y', 'source_offset_z', 'source_in_inches', 'source_in_meters', 'mesh_stat', 'mesh_text_info'].includes(k)) {
            /* ignore */
          } else vol.config[k] = v;
        }
        volumes.push(vol);
      }
      objects.push({ name, config: oc, extruder, instances, volumes, supportPaint: paint?.supports, seamPaint: paint?.seam, mmuPaint: paint?.mmu, ranges });
      objectIds.push(objId);
    }
  }
  let customGcodes: CustomGcode[] = [];
  const cgFile = zip.file('Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml');
  if (cgFile) customGcodes = parseCustomGcodeXml(await cgFile.async('string'));
  // object index of every build item, in build order (a 3MF loader returns one mesh per item)
  const buildOrder = buildItems.map((b) => objectIds.indexOf(b.objectId));
  return { config: cfg, objects, customGcodes, buildOrder };
}
