/**
 * "Shells" (R-7): the plater meshes translucent over the toolpaths, so the print stays visible while
 * the preview is open. Moved out of `Viewer.tsx` verbatim.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import type * as THREE from 'three';
import type { PlaterObject } from '../../state/store';
import type { SceneRefs } from './types';

export function useShells(refsRef: RefObject<SceneRefs | null>, shells: boolean, objects: PlaterObject[]) {
  // --- shells: the plater meshes translucent over the toolpaths, so the print stays visible
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    if (!shells) {
      if (!refs.shellsOn) return;
      refs.shellsOn = false;
      for (const node of refs.nodes.values()) {
        for (const inode of node.instances.values()) {
          const mat = inode.mesh.material as THREE.MeshStandardMaterial;
          mat.transparent = false;
          mat.opacity = 1;
          mat.depthWrite = true;
          mat.needsUpdate = true;
        }
      }
      return;
    }
    refs.shellsOn = true;
    for (const node of refs.nodes.values()) {
      for (const inode of node.instances.values()) {
        const mat = inode.mesh.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.25;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      }
    }
    // `objects` is not read here: it re-runs the effect after the objects sync, so a newly added
    // object gets the shells treatment too
  }, [shells, objects]);
}
