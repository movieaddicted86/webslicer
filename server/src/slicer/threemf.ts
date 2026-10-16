/**
 * Mesh helpers: binary/ASCII STL parsing and 3MF project writing/reading.
 * The 3MF writer produces files PrusaSlicer loads with per-object transforms
 * and (optionally) per-object config overrides in Metadata/Slic3r_PE_model.config.
 */
import JSZip from 'jszip';
import type { IniSection } from './ini.js';
import { escapeStringCstyle } from './values.js';

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

export interface ThreeMfObject {
  name: string;
  mesh: Mesh;
  /** 4x4 column-major transform (three.js Matrix4.elements order) */
  transform: number[];
  /** per-object config overrides (PrusaSlicer model config) */
  config?: IniSection;
  extruder?: number;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '');
}

/** Convert a column-major 4x4 matrix into the 3MF 12-value transform string */
export function transformTo3mf(m: number[]): string {
  // 3MF: m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32 (row-major 4x3, translation last)
  // three.js elements (column-major): [m00,m10,m20,m30, m01,m11,m21,m31, m02,m12,m22,m32, m03,m13,m23,m33]
  const e = m;
  const vals = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]];
  return vals.map(fmt).join(' ');
}

/** Build a 3MF project archive from meshes. */
export async function build3mf(objects: ThreeMfObject[], opts: { projectConfig?: IniSection; title?: string } = {}): Promise<Buffer> {
  const zip = new JSZip();
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">',
  );
  parts.push(` <metadata name="Application">WebSlicer</metadata>`);
  if (opts.title) parts.push(` <metadata name="Title">${xmlEscape(opts.title)}</metadata>`);
  parts.push(' <resources>');
  objects.forEach((obj, i) => {
    const id = i + 1;
    parts.push(`  <object id="${id}" name="${xmlEscape(obj.name)}" type="model">`);
    parts.push('   <mesh>');
    parts.push('    <vertices>');
    const v = obj.mesh.vertices;
    const vs: string[] = new Array(v.length / 3);
    for (let j = 0; j < v.length; j += 3) {
      vs[j / 3] = `     <vertex x="${fmt(v[j])}" y="${fmt(v[j + 1])}" z="${fmt(v[j + 2])}"/>`;
    }
    parts.push(vs.join('\n'));
    parts.push('    </vertices>');
    parts.push('    <triangles>');
    const t = obj.mesh.indices;
    const ts: string[] = new Array(t.length / 3);
    for (let j = 0; j < t.length; j += 3) {
      ts[j / 3] = `     <triangle v1="${t[j]}" v2="${t[j + 1]}" v3="${t[j + 2]}"/>`;
    }
    parts.push(ts.join('\n'));
    parts.push('    </triangles>');
    parts.push('   </mesh>');
    parts.push('  </object>');
  });
  parts.push(' </resources>');
  parts.push(' <build>');
  objects.forEach((obj, i) => {
    parts.push(`  <item objectid="${i + 1}" transform="${transformTo3mf(obj.transform)}" printable="1"/>`);
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

  // PrusaSlicer model config: per-object settings + names
  const mc: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  objects.forEach((obj, i) => {
    const id = i + 1;
    mc.push(` <object id="${id}" instances_count="1">`);
    mc.push(`  <metadata type="object" key="name" value="${xmlEscape(obj.name)}"/>`);
    if (obj.extruder && obj.extruder > 0) mc.push(`  <metadata type="object" key="extruder" value="${obj.extruder}"/>`);
    for (const [k, val] of Object.entries(obj.config || {})) {
      mc.push(`  <metadata type="object" key="${xmlEscape(k)}" value="${xmlEscape(escapeStringCstyle(val))}"/>`);
    }
    mc.push(`  <volume firstid="0" lastid="${obj.mesh.indices.length / 3 - 1}">`);
    mc.push(`   <metadata type="volume" key="name" value="${xmlEscape(obj.name)}"/>`);
    mc.push(`   <metadata type="volume" key="volume_type" value="ModelPart"/>`);
    mc.push(`   <metadata type="volume" key="source_file" value="${xmlEscape(obj.name)}"/>`);
    mc.push(`   <metadata type="volume" key="source_object_id" value="0"/>`);
    mc.push(`   <metadata type="volume" key="source_volume_id" value="0"/>`);
    mc.push('  </volume>');
    mc.push(' </object>');
  });
  mc.push('</config>');
  zip.file('Metadata/Slic3r_PE_model.config', mc.join('\n'));

  if (opts.projectConfig) {
    // Values are already in their INI-serialized form (newlines escaped), write them verbatim.
    const lines = Object.keys(opts.projectConfig)
      .sort()
      .map((k) => `; ${k} = ${opts.projectConfig![k]}`);
    zip.file('Metadata/Slic3r_PE.config', lines.join('\n') + '\n');
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Read the global config and object list from a PrusaSlicer 3MF project. */
export async function read3mfProject(buf: Buffer): Promise<{ config: IniSection; objects: Array<{ name: string; config: IniSection }> }> {
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
  const objects: Array<{ name: string; config: IniSection }> = [];
  const mcFile = zip.file('Metadata/Slic3r_PE_model.config');
  if (mcFile) {
    const text = await mcFile.async('string');
    const objRe = /<object\b[^>]*>([\s\S]*?)<\/object>/g;
    let m: RegExpExecArray | null;
    while ((m = objRe.exec(text))) {
      const body = m[1];
      const oc: IniSection = {};
      let name = '';
      const mdRe = /<metadata\s+type="object"\s+key="([^"]+)"\s+value="([^"]*)"/g;
      let mm: RegExpExecArray | null;
      while ((mm = mdRe.exec(body))) {
        const k = mm[1];
        const v = mm[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        if (k === 'name') name = v;
        else oc[k] = v;
      }
      objects.push({ name, config: oc });
    }
  }
  return { config: cfg, objects };
}
