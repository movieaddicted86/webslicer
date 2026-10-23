/**
 * The store's three.js seam (q4-web-store): the constructors and file loaders the store actions
 * need, re-exported from `three/` so no file in `state/**` imports a three.js module at runtime
 * (AC-4). The implementations live in `web/src/three/`; this module is the one place `plater/`
 * reaches into it, and the only coupling is one-way (`plater` → `three`).
 */
export { geometryFromVertices, shellGeometry } from '../three/geometry';
export { createPrimitive, type PrimitiveShape } from '../three/primitives';
export { loadModelFile, loadStoredModel } from '../three/loaders';
export { subdivideForPainting } from '../three/paint';
export { rotationForFace } from '../three/faceRotation';
