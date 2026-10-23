/**
 * The plater's shell splitting (q4-web-store): splitting one object into independent objects or into
 * parts of the same object. Split out of `plater.ts`; `createPlaterSlice` spreads this creator into
 * itself.
 */
import { api } from '../../api';
import { encodeMmu, encodePaint } from '../../plater/paintCodec';
import { geometrySize, geometryToStl, objectFrameOffset } from '../../plater/meshInfo';
import { shellGeometry } from '../../plater/meshOps';
import { splitShells } from '../../plater/split';
import { mintVolumeId } from '../../plater/objects';
import type { PlaterVolume, SlicePart } from '../types';

export interface SplitSlice {
  /**
   * Split the selected object's connected shells into independent objects, one per shell, each
   * copy of the original keeping exactly its place (keepPositions). One undo step.
   */
  splitToObjects: (objectId: string) => Promise<void>;
  /**
   * Split the selected object's connected shells into parts of the same object: the largest shell
   * stays the main mesh, every other one becomes a ModelPart volume. One undo step.
   */
  splitToParts: (objectId: string) => Promise<void>;
}

export const createSplitSlice: SlicePart<SplitSlice> = (set, get) => ({
  splitToObjects: async (objectId) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    // AC-3 of the work package: modifiers and parts would have to be carried onto every shell, so
    // the button is disabled for objects with volumes (the tooltip says why)
    if (o.volumes.length) return;
    const positions = o.geometry.getAttribute('position').array as Float32Array;
    const shells = splitShells(positions);
    if (shells.length < 2) {
      s.toast('info', 'The object consists of a single part');
      return;
    }
    const snapshot = s.objects;
    // geometry in the object frame; addObjects translates it by the same offset again, which is
    // exactly what it does when the object was imported, so the shells land where they sat.
    // Paint is per triangle, so every shell carries the paint of the triangles that moved into it.
    const shellPaint = (tris: Uint32Array) => {
      const pick = (arr?: Uint8Array): Uint8Array | undefined => {
        if (!arr) return undefined;
        const out = new Uint8Array(tris.length);
        for (let i = 0; i < tris.length; i++) out[i] = arr[tris[i]];
        return out.some((v) => v) ? out : undefined;
      };
      const supports = pick(o.paint?.supports);
      const seam = pick(o.paint?.seam);
      const mmu = pick(o.paint?.mmu);
      return { supports: supports && encodePaint(supports), seam: seam && encodePaint(seam), mmu: mmu && encodeMmu(mmu) };
    };
    const items = shells.map((tris, i) => {
      const paint = shellPaint(tris);
      return {
        name: `${o.name} (${i + 1})`,
        geometry: shellGeometry(positions, tris),
        config: o.config,
        extruder: o.extruder,
        ranges: o.ranges.map((r) => ({ minZ: r.minZ, maxZ: r.maxZ, config: r.config })),
        // the profile is measured on the object's Z, which every shell shares
        layerProfile: o.layerProfile?.slice(),
        supportPaint: paint.supports,
        seamPaint: paint.seam,
        mmuPaint: paint.mmu,
        instances: o.instances.map((inst) => ({
          position: [...inst.position] as [number, number, number],
          rotation: [...inst.rotation] as [number, number, number],
          scale: [...inst.scale] as [number, number, number],
        })),
      };
    });
    // one undo step for the whole action: the original goes, the shells arrive (the snapshot of
    // `addObjects` has to be the plater from before the removal, hence the explicit one)
    set((st) => ({
      objects: st.objects.filter((x) => x.id !== objectId),
      selectedIds: st.selectedIds.filter((id) => id !== objectId),
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
    }));
    await get().addObjects(items, { keepPositions: true, snapshot });
    s.toast('info', `Split into ${shells.length} objects`);
  },
  splitToParts: async (objectId) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    const positions = o.geometry.getAttribute('position').array as Float32Array;
    const shells = splitShells(positions);
    if (shells.length < 2) {
      s.toast('info', 'The object consists of a single part');
      return;
    }
    s.recordHistory();
    const [main, ...rest] = shells;
    const mainGeometry = shellGeometry(positions, main);
    // paint follows the triangle indices; shells that become parts lose theirs
    const remap = (arr?: Uint8Array): Uint8Array | undefined => {
      if (!arr) return undefined;
      const out = new Uint8Array(main.length);
      for (let i = 0; i < main.length; i++) out[i] = arr[main[i]];
      return out.some((v) => v) ? out : undefined;
    };
    let dropped = false;
    for (const kind of ['supports', 'seam', 'mmu'] as const) {
      if (o.paint?.[kind] && !remap(o.paint[kind])) dropped = true;
    }
    const offset = objectFrameOffset(o);
    const volumes: PlaterVolume[] = rest.flatMap((tris, i) => {
      // a volume is centred at its own origin and placed at its centre in the object frame
      const geometry = shellGeometry(positions, tris);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      if (!bb) return [];
      const centre: [number, number, number] = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
      geometry.translate(-centre[0], -centre[1], -centre[2]);
      geometry.computeVertexNormals();
      return [
        {
          id: mintVolumeId(),
          name: `Part ${i + 2}`,
          type: 'ModelPart',
          geometry,
          position: [centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          size: geometrySize(geometry),
          config: {},
          extruder: 0,
          triangles: tris.length,
        },
      ];
    });
    const paint = o.paint ? { supports: remap(o.paint.supports), seam: remap(o.paint.seam), mmu: remap(o.paint.mmu) } : undefined;
    set((st) => ({
      objects: st.objects.map((x) =>
        x.id === objectId
          ? {
              ...x,
              geometry: mainGeometry,
              triangles: main.length,
              volumes: [...x.volumes, ...volumes],
              paint,
              modelId: undefined,
              uploadError: undefined,
            }
          : x,
      ),
      selectedVolumeId: undefined,
      sliceDirty: true,
    }));
    if (dropped) s.toast('info', 'Paint on the parts that became volumes was dropped');
    try {
      const res = await api.uploadModel(geometryToStl(mainGeometry), o.name);
      get().updateObject(objectId, { modelId: res.id });
    } catch (e) {
      get().updateObject(objectId, { uploadError: (e as Error).message });
      get().toast('error', `Upload of ${o.name} failed: ${(e as Error).message}`);
    }
    for (const v of volumes) await get().uploadVolume(objectId, v);
    s.toast('info', `Split into 1 object and ${volumes.length} parts`);
  },
});
