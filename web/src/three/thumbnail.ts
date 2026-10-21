import * as THREE from 'three';
import { encodeQoi, bytesToBase64 } from '../gcode/qoi';
import { parseThumbnailSpec, type ThumbnailInput, type ThumbnailSpec } from '@webslicer/shared';
import { DEFAULT_COLOR_CSS } from '../palette';

// the `thumbnails` option is read by `@webslicer/shared` (one parser for the browser and the CLI);
// re-exported so the settings UI keeps its `../three/thumbnail` import path
export { parseThumbnailSpec, type ThumbnailSpec };

let snapshotRenderer: THREE.WebGLRenderer | undefined;

/**
 * Render thumbnails of `objects` (a THREE.Group containing the plater objects) with a transparent
 * background, framed like PrusaSlicer's thumbnails, and encode them in the requested formats.
 */
export function renderThumbnails(scene: THREE.Scene, objects: THREE.Object3D, specs: ThumbnailSpec[], colors: string[] = []): ThumbnailInput[] {
  if (!specs.length) return [];
  if (!snapshotRenderer) {
    snapshotRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    snapshotRenderer.setPixelRatio(1);
    snapshotRenderer.setClearColor(0x000000, 0);
  }
  const renderer = snapshotRenderer;

  // bounding box of the visible printable geometry
  const box = new THREE.Box3();
  objects.updateWorldMatrix(true, true);
  objects.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    // skip translucent helper volumes (modifiers, enforcers…)
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat && mat.transparent && mat.opacity < 1) return;
    let p: THREE.Object3D | null = m;
    let vis = true;
    while (p) {
      if (!p.visible) vis = false;
      p = p.parent;
    }
    if (!vis) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  });
  if (box.isEmpty()) return [];
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;

  // temporarily hide helpers; show only the objects
  const hidden: THREE.Object3D[] = [];
  for (const child of scene.children) {
    if (child !== objects && child.visible && !(child as THREE.Light).isLight) {
      child.visible = false;
      hidden.push(child);
    }
  }
  const translucent: Array<{ mesh: THREE.Mesh; visible: boolean }> = [];
  // render in filament colours (per extruder) instead of selection / warning colours
  const recolored: Array<{ mat: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color }> = [];
  const fallback = DEFAULT_COLOR_CSS;
  objects.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat && mat.transparent && mat.opacity < 1) {
      translucent.push({ mesh: m, visible: m.visible });
      m.visible = false;
      return;
    }
    if (mat && mat.color) {
      recolored.push({ mat, color: mat.color.clone(), emissive: mat.emissive.clone() });
      const ex = Number(m.userData.extruder) || 0;
      const c = colors[Math.max(0, ex - 1)] || colors[0] || fallback;
      mat.color.set(/^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith('#') ? c : `#${c}`) : fallback);
      mat.emissive.set(0x000000);
    }
  });

  const out: ThumbnailInput[] = [];
  try {
    for (const spec of specs) {
      const { width, height } = spec;
      renderer.setSize(width, height, false);
      const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, radius * 20 + 100);
      camera.up.set(0, 0, 1);
      const dir = new THREE.Vector3(-0.55, -1, 0.75).normalize();
      const dist = (radius / Math.sin(THREE.MathUtils.degToRad(35 / 2))) * 1.05 * Math.max(1, height / width);
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);

      if (spec.format === 'PNG') {
        out.push({ width, height, format: 'PNG', data: renderer.domElement.toDataURL('image/png').split(',')[1] });
      } else {
        const c2 = document.createElement('canvas');
        c2.width = width;
        c2.height = height;
        const ctx = c2.getContext('2d')!;
        if (spec.format === 'JPG') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(renderer.domElement, 0, 0);
        if (spec.format === 'JPG') {
          out.push({ width, height, format: 'JPG', data: c2.toDataURL('image/jpeg', 0.9).split(',')[1] });
        } else {
          const img = ctx.getImageData(0, 0, width, height);
          out.push({ width, height, format: 'QOI', data: bytesToBase64(encodeQoi(img.data, width, height)) });
        }
      }
    }
  } finally {
    for (const h of hidden) h.visible = true;
    for (const t of translucent) t.mesh.visible = t.visible;
    for (const r of recolored) {
      r.mat.color.copy(r.color);
      r.mat.emissive.copy(r.emissive);
    }
  }
  return out;
}
