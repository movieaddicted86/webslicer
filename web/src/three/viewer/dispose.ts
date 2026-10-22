/**
 * Releasing what a scene group held (B1): `THREE.Group.clear()` only removes the children, so the
 * geometries, materials and textures of a rebuilt bed or a new G-code preview stayed on the GPU.
 *
 * The renderer counts a geometry/material/texture as live until its `dispose()` event, so a group
 * that is cleared has to walk its subtree first. Disposing twice is harmless – three.js ignores a
 * second event – which keeps the callers simple.
 */
import * as THREE from 'three';

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    const tex = value as { isTexture?: boolean; dispose?: () => void } | null;
    if (tex && tex.isTexture && typeof tex.dispose === 'function') tex.dispose();
  }
  material.dispose();
}

/** Dispose the geometries, materials and textures of every object under `root`. */
export function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const mm of m) disposeMaterial(mm);
    else if (m) disposeMaterial(m);
  });
}

/** Dispose a group's contents and empty it, so a rebuild does not leak the previous scene. */
export function clearAndDispose(group: THREE.Group): void {
  disposeSubtree(group);
  group.clear();
}

/** What a plater instance node carries – the part of `InstanceNode` the disposal needs. */
export interface InstanceLike {
  mesh: THREE.Mesh;
  volumes: Map<string, THREE.Mesh>;
}

/**
 * Release the object and volume geometries of removed plater nodes (B1's known +1 leak). The store
 * owns those geometries, so the scene has to dispose them – unless a remaining object still shares
 * one (duplicates and split copies point at the same `BufferGeometry`, and undo restores the same
 * references; three.js re-uploads a disposed geometry on the next render).
 */
export function disposeRemovedGeometries(removed: Iterable<InstanceLike>, live: Set<THREE.BufferGeometry>): void {
  const released = new Set<THREE.BufferGeometry>();
  for (const inode of removed) {
    for (const geo of [inode.mesh.geometry, ...Array.from(inode.volumes.values(), (vm) => vm.geometry)]) {
      if (live.has(geo) || released.has(geo)) continue;
      geo.dispose();
      released.add(geo);
    }
  }
}
