/**
 * The cut plane preview (T-044): a translucent square at the plane of the cut panel, drawn in the 3D
 * view while the panel is open, so the user sees where the object will be cut. Pure three.js – the
 * plane's numbers come from `plater/cut.ts`.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { useStore, selectedInstance } from '../../state/store';
import { cutPlaneWorld } from '../../plater/cut';
import type { SceneRefs } from './types';

/** The name of the plane mesh in the scene (the e2e suite and the dispose census look it up). */
export const CUT_PLANE_NAME = 'cut-plane';

export function useCutPlane(refsRef: RefObject<SceneRefs | null>) {
  const open = useStore((s) => s.activeTool === 'cut');
  const settings = useStore((s) => s.cutSettings);
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);

  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    const existing = refs.scene.getObjectByName(CUT_PLANE_NAME) as THREE.Mesh | undefined;
    const o = selectedIds.length === 1 ? objects.find((x) => x.id === selectedIds[0]) : undefined;
    if (!open || !o) {
      if (existing) {
        existing.geometry.dispose();
        (existing.material as THREE.Material).dispose();
        existing.removeFromParent();
      }
      return;
    }
    const inst = selectedInstance({ selectedIds, selectedInstanceId }, o);
    const world = cutPlaneWorld(inst, settings);
    // the plane covers the object: twice its footprint, at least 40 mm
    const w = Math.abs(inst.scale[0]) * o.size[0];
    const d = Math.abs(inst.scale[1]) * o.size[1];
    const side = Math.max(40, w * 1.6, d * 1.6);
    const geometry = new THREE.PlaneGeometry(side, side);
    const material = new THREE.MeshBasicMaterial({
      color: 0x76b7ff,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = existing ?? new THREE.Mesh(geometry, material);
    if (existing) {
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
      existing.geometry = geometry;
      existing.material = material;
    } else {
      refs.scene.add(mesh);
    }
    mesh.name = CUT_PLANE_NAME;
    // the plane geometry faces +Z; its normal has to become the plane's normal
    const normal = new THREE.Vector3(world.normal[0], world.normal[1], world.normal[2]);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.position.set(world.point[0], world.point[1], world.point[2]);
  }, [refsRef, open, settings, objects, selectedIds, selectedInstanceId]);
}
