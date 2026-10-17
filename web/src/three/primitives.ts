import * as THREE from 'three';

export type PrimitiveShape = 'box' | 'cylinder' | 'sphere' | 'slab';

/**
 * Create a primitive volume mesh, centred at the origin (Z up).
 * `side` is the generic size (PrusaSlicer uses 10 % of the largest bed dimension);
 * `objectSize` is used for the slab, which spans the object footprint.
 */
export function createPrimitive(shape: PrimitiveShape, side: number, objectSize: [number, number, number]): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (shape) {
    case 'cylinder':
      g = new THREE.CylinderGeometry(side / 2, side / 2, side, 48);
      g.rotateX(Math.PI / 2); // cylinder axis along Z
      break;
    case 'sphere':
      g = new THREE.SphereGeometry(side / 2, 32, 24);
      break;
    case 'slab':
      g = new THREE.BoxGeometry(Math.max(objectSize[0] * 1.5, side), Math.max(objectSize[1] * 1.5, side), Math.max(objectSize[2] * 0.5, 2));
      break;
    case 'box':
    default:
      g = new THREE.BoxGeometry(side, side, side);
  }
  const out = g.toNonIndexed();
  for (const name of Object.keys(out.attributes)) if (name !== 'position') out.deleteAttribute(name);
  out.computeVertexNormals();
  out.computeBoundingBox();
  return out;
}
