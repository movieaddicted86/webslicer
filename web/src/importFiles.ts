/**
 * Import model files and 3MF projects into the plater (used by Import, drag & drop, library and
 * autosave restore). Kept outside the components so the store can import it statically.
 */
import * as THREE from 'three';
import { useStore, VOLUME_LABELS, type NewVolumeInput } from './state/store';
import { loadModelFile, load3mfBuildItems, splitGeometryByRanges, SUPPORTED_EXTENSIONS } from './three/loaders';
import { api } from './api';

type ImportTransform = { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };

/**
 * Decompose a column-major matrix into the plater's position / Euler XYZ / scale triple.
 *
 * `Matrix4.decompose` cannot represent a mirror: for a matrix with a negative determinant it
 * negates the *first* scale component even when the sign belongs to the last one, which turns a
 * "Mirror Z" into a "Mirror X" (plus a 180° rotation) on reload – so a file from our own exporter
 * would come back looking different. The sign is therefore taken from the axis the exporter put it
 * on: the one with the largest column norm, flipped when the determinant is negative. Placement
 * (position, rotation and the scale magnitudes) is unaffected by that choice.
 */
function decomposeInstance(m: THREE.Matrix4): ImportTransform {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, quaternion, scale);
  const e = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  if (m.determinant() < 0) {
    // rebuild the scale from the column norms and put the single sign on the largest column
    const norms = [0, 1, 2].map((i) => Math.hypot(m.elements[i * 4], m.elements[i * 4 + 1], m.elements[i * 4 + 2]));
    const axis = norms.indexOf(Math.max(...norms));
    for (let i = 0; i < 3; i++) scale.setComponent(i, norms[i] * (i === axis ? -1 : 1));
  }
  return {
    position: position.toArray() as [number, number, number],
    rotation: [e.x, e.y, e.z],
    scale: scale.toArray() as [number, number, number],
  };
}

type ImportItem = {
  name: string;
  geometry: import('three').BufferGeometry;
  config?: Record<string, string>;
  extruder?: number;
  volumes?: NewVolumeInput[];
  /** instance transforms of a 3MF project: object coordinates plus one transform per build item */
  instances?: ImportTransform[];
  supportPaint?: string;
  seamPaint?: string;
  mmuPaint?: string;
  ranges?: Array<{ minZ: number; maxZ: number; config: Record<string, string> }>;
};

export async function importFiles(files: FileList | File[]) {
  const st = useStore.getState();
  // TopBar clears the input right after the change event, and a FileList is live: reading it again
  // after the first await would come back empty. Snapshot it once, up front.
  const list = Array.from(files);
  const items: ImportItem[] = [];
  for (const f of list) {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      st.toast('error', `Unsupported file: ${f.name}`);
      continue;
    }
    try {
      if (ext === '3mf') {
        // project config (if any)
        try {
          const proj = await api.parseProject(await f.arrayBuffer());
          if (Object.keys(proj.config).length) {
            await st.applyProjectConfig(proj.config);
            st.toast('info', `Applied project settings from ${f.name}`);
          }
          if (proj.customGcodes?.length) st.setCustomGcodes(proj.customGcodes);
          // A 3MF project instantiates every object once per <build><item>, and three's loader bakes each
          // item transform into its geometry. Import one item geometry per build item, un-bake the
          // transform to get object coordinates back and rebuild the instances from the item matrices.
          // A file without a build order (plain 3MF, no Slic3r_PE_model.config) keeps today's behaviour.
          const buildOrder = proj.buildOrder || [];
          const itemGeoms = buildOrder.length ? load3mfBuildItems(await f.arrayBuffer()) : [];
          // every build item must point at a known project object (a file without the model config
          // reports buildOrder [-1], which must fall through to the plain mesh import below)
          const mapped = itemGeoms.length === buildOrder.length && proj.objects.length > 0 && buildOrder.every((oi) => oi >= 0 && oi < proj.objects.length);
          if (mapped) {
            const imported: ImportItem[] = [];
            // one plater object per project object, from its FIRST build item (the later items of the
            // same object are the other instances, already covered by po.instances)
            proj.objects.forEach((po, oi) => {
              const k = buildOrder.indexOf(oi);
              if (k < 0) return;
              const g = itemGeoms[k];
              const itemM = new THREE.Matrix4().fromArray(po.instances[0] || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
              const geometry = g.clone().applyMatrix4(itemM.clone().invert());
              const item: ImportItem = {
                name: po.name,
                geometry,
                config: po.config,
                extruder: po.extruder,
                supportPaint: po.supportPaint,
                seamPaint: po.seamPaint,
                mmuPaint: po.mmuPaint,
                ranges: po.ranges,
                instances: po.instances.map((m) => decomposeInstance(new THREE.Matrix4().fromArray(m))),
              };
              // restore sub-volumes (parts, modifiers, support enforcers/blockers) from the triangle ranges
              if (po.volumes.length > 1) {
                const parts = splitGeometryByRanges(geometry, po.volumes.map((v) => [v.first, v.last] as [number, number]));
                const mainIdx = Math.max(
                  0,
                  po.volumes.findIndex((v) => v.type === 'ModelPart'),
                );
                item.geometry = parts[mainIdx];
                // paint strings cover the whole mesh; keep the main part's triangle range
                const mv = po.volumes[mainIdx];
                if (mv) {
                  item.supportPaint = po.supportPaint?.slice(mv.first, mv.last + 1);
                  item.seamPaint = po.seamPaint?.slice(mv.first, mv.last + 1);
                  item.mmuPaint = po.mmuPaint?.slice(mv.first, mv.last + 1);
                }
                item.volumes = po.volumes
                  .map((v, vi) => ({ name: v.name || VOLUME_LABELS[v.type], type: v.type, geometry: parts[vi], config: v.config, extruder: v.extruder }))
                  .filter((_, vi) => vi !== mainIdx);
                const mainVol = po.volumes[mainIdx];
                if (mainVol?.extruder && !item.extruder) item.extruder = mainVol.extruder;
                if (mainVol && Object.keys(mainVol.config).length) item.config = { ...(item.config || {}), ...mainVol.config };
              } else if (po.volumes.length === 1) {
                const mainVol = po.volumes[0];
                if (mainVol.extruder && !item.extruder) item.extruder = mainVol.extruder;
              }
              imported.push(item);
            });
            items.push(...imported);
            continue;
          }
        } catch {
          /* fall through to plain mesh import */
        }
      }
      items.push(...(await loadModelFile(f)).map((m) => ({ name: m.name, geometry: m.geometry })));
    } catch (e) {
      st.toast('error', `Cannot load ${f.name}: ${(e as Error).message}`);
    }
  }
  if (items.length) {
    const fromProject = list.some((f) => f.name.toLowerCase().endsWith('.3mf'));
    await st.addObjects(items, { keepPositions: fromProject });
  }
}
