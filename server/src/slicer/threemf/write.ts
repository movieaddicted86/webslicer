/**
 * The 3MF project writer. It produces files PrusaSlicer loads with per-object transforms,
 * per-object config overrides and sub-volumes (parts, modifiers, support enforcers/blockers,
 * negative volumes) in Metadata/Slic3r_PE_model.config.
 */
import JSZip from 'jszip';
import { triangleStateToAttribute } from '../paint.js';
import type { IniSection } from '../ini.js';
import { escapeStringCstyle, transformTo3mf, type CustomGcode, type LayerRangeInput, type VolumeType } from '@webslicer/shared';
import { customGcodeXml } from './customGcode.js';
import type { Mesh } from './mesh.js';
import { fmt, xmlEscape } from './xml.js';

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

/** Build a 3MF project archive from meshes. */
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
    const all: ThreeMfVolume[] = [{ name: obj.name, mesh: obj.mesh, type: 'ModelPart', extruder: undefined }, ...(obj.volumes || [])];
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

  const projectConfig = opts.projectConfig;
  if (projectConfig) {
    // Values are already in their INI-serialized form (newlines escaped), write them verbatim.
    const lines = Object.keys(projectConfig)
      .sort()
      .map((k) => `; ${k} = ${projectConfig[k]}`);
    zip.file('Metadata/Slic3r_PE.config', lines.join('\n') + '\n');
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
