/**
 * The plater's objects (R-7): one scene node per object, one node per instance under it, the
 * selection and outside-bed highlight, the painted triangles, the height-range slabs and the
 * sub-volumes. Moved out of `Viewer.tsx` verbatim - the differencing is what keeps the GPU
 * resources (materials, slab geometries) from piling up.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { bedShapeOf } from '@webslicer/shared';
import { boxOutside } from '../../plater/plateCheck';
import { instanceBounds, selectedInstance, type PlaterObject, type PlaterVolume } from '../../state/store';
import { paintToColors, type PaintKind } from '../paint';
import type { ParsedGcode } from '../../gcode/types';
import type { View } from '../../state/types';
import { EXTRUDER_COLORS, OBJECT_COLOR, OUTSIDE_COLOR, SELECTED_COLOR, VOLUME_COLORS } from './colors';
import type { SceneRefs } from './types';

function makeVolumeMesh(v: PlaterVolume): THREE.Mesh {
  const c = VOLUME_COLORS[v.type];
  const mat = new THREE.MeshStandardMaterial({
    color: c.color,
    roughness: 0.6,
    metalness: 0.05,
    transparent: c.opacity < 1,
    opacity: c.opacity,
    depthWrite: c.opacity >= 1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(v.geometry, mat);
  mesh.userData = { kind: 'volume', id: v.id };
  // non-part volumes are drawn on top so they stay visible inside the object
  if (c.opacity < 1) {
    mesh.renderOrder = 10;
    mat.depthTest = false;
  }
  return mesh;
}

interface PlaterObjectsOptions {
  objects: PlaterObject[];
  selectedIds: string[];
  selectedVolumeId?: string;
  selectedInstanceId?: string;
  view: View;
  bedShape: string;
  maxHeight: number;
  gcode?: ParsedGcode;
  paintMode?: PaintKind;
  /** "Shells": the plater meshes stay visible over the toolpaths */
  shells: boolean;
}

export function usePlaterObjects(refsRef: RefObject<SceneRefs | null>, options: PlaterObjectsOptions) {
  const { objects, selectedIds, selectedVolumeId, selectedInstanceId, view, bedShape, maxHeight, gcode, paintMode, shells } = options;
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    const seen = new Set<string>();
    const bed = bedShapeOf({ bed_shape: bedShape });
    for (const o of objects) {
      seen.add(o.id);
      let node = refs.nodes.get(o.id);
      if (!node) {
        // the object group is a pure container; each instance is its own node under it
        const group = new THREE.Group();
        group.userData = { kind: 'object', id: o.id };
        node = { group, instances: new Map() };
        refs.nodes.set(o.id, node);
        refs.objectsGroup.add(group);
      }
      // one node per instance; all instances share the object's geometry and volume geometries,
      // but own their material so the selected/outside highlight can differ per instance
      for (const inst of o.instances) {
        let inode = node.instances.get(inst.id);
        if (!inode) {
          const group = new THREE.Group();
          group.userData = { kind: 'instance', id: o.id, instanceId: inst.id };
          const mesh = new THREE.Mesh(
            o.geometry,
            new THREE.MeshStandardMaterial({ color: OBJECT_COLOR, roughness: 0.55, metalness: 0.05 }),
          );
          mesh.userData = { kind: 'object', id: o.id, instanceId: inst.id };
          group.add(mesh);
          node.group.add(group);
          inode = { group, mesh, volumes: new Map() };
          node.instances.set(inst.id, inode);
        }
        if (inode.mesh.geometry !== o.geometry) inode.mesh.geometry = o.geometry;
        if (!(refs.dragging && refs.transform.object === inode.group)) {
          inode.group.position.set(...inst.position);
          inode.group.rotation.set(...inst.rotation);
          inode.group.scale.set(...inst.scale);
        }
      }
      for (const [iid, inode] of node.instances) {
        if (!o.instances.some((i) => i.id === iid)) {
          node.group.remove(inode.group);
          (inode.mesh.material as THREE.Material).dispose();
          for (const vm of inode.volumes.values()) (vm.material as THREE.Material).dispose();
          inode.slabs?.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
          node.instances.delete(iid);
          if (refs.transform.object && refs.transform.object.parent === inode.group) refs.transform.detach();
        }
      }
      // Keep the models visible in the preview until a toolpath is available (e.g. while slicing);
      // "Shells" keeps them visible as translucent shapes over the toolpaths.
      node.group.visible = o.visible && (view === 'plater' || !gcode || shells);
      const selected = selectedIds.includes(o.id);
      const selInst = selectedInstance({ selectedIds, selectedInstanceId }, o);
      const painted = !!(o.paint && (o.paint.supports || o.paint.seam || o.paint.mmu));
      const paintingThis = paintMode && selected;
      const base = o.extruder > 0 ? EXTRUDER_COLORS[(o.extruder - 1) % EXTRUDER_COLORS.length] : OBJECT_COLOR;
      for (const [iid, inode] of node.instances) {
        const inst = o.instances.find((i) => i.id === iid);
        if (!inst) continue;
        // outside-bed highlight is per instance (each copy can sit off the bed on its own); the bed
        // is its real polygon since T-034, so the notch of an L-shaped bed counts as outside
        const outside = boxOutside(instanceBounds(o, inst), bed.points, maxHeight);
        const mat = inode.mesh.material as THREE.MeshStandardMaterial;
        inode.mesh.userData.extruder = o.extruder;
        const instSelected = selected && selInst.id === iid;
        const bodySelected = instSelected && !selectedVolumeId;
        if (painted || paintingThis) {
          // per-triangle colours: paint over the object's base colour
          const baseColor = new THREE.Color(outside ? OUTSIDE_COLOR : base);
          const kind: PaintKind = paintMode || (o.paint?.supports ? 'supports' : o.paint?.seam ? 'seam' : 'mmu');
          const arr = o.paint?.[kind];
          const existing = inode.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
          const palette =
            kind === 'mmu'
              ? (s: number) => {
                  const c = new THREE.Color(EXTRUDER_COLORS[(s - 1) % EXTRUDER_COLORS.length]);
                  return [c.r, c.g, c.b] as [number, number, number];
                }
              : undefined;
          const colors = paintToColors(arr, o.triangles, baseColor, existing ? (existing.array as Float32Array) : undefined, palette);
          if (!existing || existing.array !== colors) inode.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          else existing.needsUpdate = true;
          mat.vertexColors = true;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        } else {
          if (mat.vertexColors) {
            mat.vertexColors = false;
            mat.needsUpdate = true;
          }
          mat.color.set(outside ? OUTSIDE_COLOR : bodySelected ? SELECTED_COLOR : base);
        }
        mat.emissive.set(bodySelected && !paintMode ? 0x16304a : 0x000000);

        // height range slabs (only for the selected instance)
        const wantSlabs = instSelected && o.ranges.length > 0;
        const slabKey = wantSlabs ? o.ranges.map((r) => `${r.minZ}:${r.maxZ}`).join(',') + `|${o.size.join('x')}` : '';
        if (inode.slabs && (!wantSlabs || inode.slabKey !== slabKey)) {
          inode.group.remove(inode.slabs);
          inode.slabs.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
          inode.slabs = undefined;
        }
        if (wantSlabs && !inode.slabs) {
          const slabs = new THREE.Group();
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          if (!bb) continue;
          const w = (bb.max.x - bb.min.x) * 1.1 + 2;
          const d = (bb.max.y - bb.min.y) * 1.1 + 2;
          const cx = (bb.min.x + bb.max.x) / 2;
          const cy = (bb.min.y + bb.max.y) / 2;
          // the ranges are measured on the object's Z, which a mirror flips; the slabs stay upright
          const sz = Math.abs(inst.scale[2]) || 1;
          o.ranges.forEach((r, i) => {
            if (!(r.maxZ > r.minZ)) return;
            const h = (r.maxZ - r.minZ) / sz;
            const m = new THREE.Mesh(
              new THREE.BoxGeometry(w, d, h),
              new THREE.MeshBasicMaterial({
                color: i % 2 ? 0x6fb1ff : 0xffb86f,
                transparent: true,
                opacity: 0.18,
                depthWrite: false,
                side: THREE.DoubleSide,
              }),
            );
            m.position.set(cx, cy, r.minZ / sz + h / 2);
            m.renderOrder = 5;
            slabs.add(m);
            const edge = new THREE.LineSegments(
              new THREE.EdgesGeometry(m.geometry),
              new THREE.LineBasicMaterial({ color: i % 2 ? 0x6fb1ff : 0xffb86f, transparent: true, opacity: 0.8 }),
            );
            edge.position.copy(m.position);
            slabs.add(edge);
          });
          inode.group.add(slabs);
          inode.slabs = slabs;
          inode.slabKey = slabKey;
        }

        // volumes – every instance shows the same volume meshes, in its own coordinates
        const seenVol = new Set<string>();
        for (const v of o.volumes) {
          seenVol.add(v.id);
          let vm = inode.volumes.get(v.id);
          if (!vm) {
            vm = makeVolumeMesh(v);
            inode.volumes.set(v.id, vm);
            inode.group.add(vm);
          }
          if (vm.geometry !== v.geometry) vm.geometry = v.geometry;
          if (!(refs.dragging && refs.transform.object === vm)) {
            vm.position.set(...v.position);
            vm.rotation.set(...v.rotation);
            vm.scale.set(...v.scale);
          }
          const vmat = vm.material as THREE.MeshStandardMaterial;
          vm.userData.extruder = v.extruder || o.extruder;
          const spec = VOLUME_COLORS[v.type];
          const volSelected = selected && selectedVolumeId === v.id;
          const partBase =
            v.type === 'ModelPart' && v.extruder > 0 ? EXTRUDER_COLORS[(v.extruder - 1) % EXTRUDER_COLORS.length] : spec.color;
          vmat.color.set(volSelected ? SELECTED_COLOR : partBase);
          vmat.emissive.set(volSelected ? 0x16304a : 0x000000);
          vmat.opacity = volSelected ? Math.min(1, spec.opacity + 0.25) : spec.opacity;
          vmat.transparent = spec.opacity < 1;
          vmat.depthTest = spec.opacity >= 1;
          vmat.depthWrite = spec.opacity >= 1;
          vm.renderOrder = spec.opacity < 1 ? 10 : 0;
        }
        for (const [vid, vm] of inode.volumes) {
          if (!seenVol.has(vid)) {
            inode.group.remove(vm);
            (vm.material as THREE.Material).dispose();
            inode.volumes.delete(vid);
            if (refs.transform.object === vm) refs.transform.detach();
          }
        }
      }
    }
    for (const [id, node] of refs.nodes) {
      if (!seen.has(id)) {
        refs.objectsGroup.remove(node.group);
        for (const inode of node.instances.values()) {
          (inode.mesh.material as THREE.Material).dispose();
          for (const vm of inode.volumes.values()) (vm.material as THREE.Material).dispose();
          inode.slabs?.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
        }
        refs.nodes.delete(id);
        if (refs.transform.object && refs.transform.object.parent === node.group) refs.transform.detach();
      }
    }
    // `refsRef` is a stable ref object owned by the Viewer; its content changes without a re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable ref, not a dependency
  }, [objects, selectedIds, selectedVolumeId, selectedInstanceId, view, bedShape, maxHeight, gcode, paintMode, shells]);
}
