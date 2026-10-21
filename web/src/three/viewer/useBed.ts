/**
 * The print bed (R-7): the plate the vendor's model and texture are loaded onto, and the effect that
 * rebuilds it when the printer or the bed shape changes. Moved out of `Viewer.tsx` verbatim - the
 * order of the meshes is what the outline, the grid and the vendor texture layer in.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { bedShapeOf } from '@webslicer/shared';
import { viewDirection } from '../../plater/camera';
import { bedBox, frameBox } from './camera';
import type { BedAsset, SceneRefs } from './types';

let bedLoadGeneration = 0;

/** Load the vendor's bed model (STL) and texture (SVG/PNG) like PrusaSlicer does. */
function loadBedAssets(group: THREE.Group, bedShape: string, asset: BedAsset, hideGrid: () => void) {
  const gen = ++bedLoadGeneration;
  const bed = bedShapeOf({ bed_shape: bedShape });
  const cx = (bed.min[0] + bed.max[0]) / 2;
  const cy = (bed.min[1] + bed.max[1]) / 2;
  if (asset.model) {
    new STLLoader().load(
      `/api/vendors/${encodeURIComponent(asset.vendor)}/asset/${encodeURIComponent(asset.model)}`,
      (geo) => {
        if (gen !== bedLoadGeneration) return;
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.8, metalness: 0.1 }));
        // PrusaSlicer moves the model origin to the bed centre, slightly below z=0
        mesh.position.set(cx, cy, -0.03);
        mesh.name = 'bed-model';
        group.add(mesh);
      },
      undefined,
      () => undefined,
    );
  }
  if (asset.texture) {
    new THREE.TextureLoader().load(
      `/api/vendors/${encodeURIComponent(asset.vendor)}/asset/${encodeURIComponent(asset.texture)}`,
      (tex) => {
        if (gen !== bedLoadGeneration) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const w = bed.max[0] - bed.min[0];
        const h = bed.max[1] - bed.min[1];
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.FrontSide }),
        );
        plane.position.set(cx, cy, 0.02);
        plane.name = 'bed-texture';
        group.add(plane);
        hideGrid();
      },
      undefined,
      () => undefined,
    );
  }
}

function buildBed(group: THREE.Group, bedShape: string, asset?: BedAsset) {
  group.clear();
  bedLoadGeneration++;
  const bed = bedShapeOf({ bed_shape: bedShape });
  const shape = new THREE.Shape(bed.points.map((p) => new THREE.Vector2(p[0], p[1])));
  const geo = new THREE.ShapeGeometry(shape);
  // the plate is single sided so that it does not hide the model in the bottom view (key 2), which
  // would otherwise show the plate blended over the object
  const mat = new THREE.MeshBasicMaterial({ color: 0x2b2f36, side: THREE.FrontSide, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -0.05;
  mesh.name = 'bed';
  group.add(mesh);

  const w = bed.max[0] - bed.min[0];
  const h = bed.max[1] - bed.min[1];
  const minor: number[] = [];
  const major: number[] = [];
  for (let x = Math.ceil(bed.min[0] / 10) * 10; x <= bed.max[0]; x += 10) {
    (x % 50 === 0 ? major : minor).push(x, bed.min[1], 0, x, bed.max[1], 0);
  }
  for (let y = Math.ceil(bed.min[1] / 10) * 10; y <= bed.max[1]; y += 10) {
    (y % 50 === 0 ? major : minor).push(bed.min[0], y, 0, bed.max[0], y, 0);
  }
  const mk = (arr: number[], color: number, opacity: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.LineSegments(g, m);
  };
  const minorLines = mk(minor, 0x4a5160, 0.5);
  const majorLines = mk(major, 0x6a7384, 0.8);
  group.add(minorLines, majorLines);
  if (asset && (asset.model || asset.texture)) {
    loadBedAssets(group, bedShape, asset, () => {
      // the vendor texture carries its own grid
      minorLines.visible = false;
      majorLines.visible = false;
    });
  }
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(bed.points.map((p) => new THREE.Vector3(p[0], p[1], 0.01))),
    new THREE.LineBasicMaterial({ color: 0x8f9bb3 }),
  );
  group.add(outline);
  const axes = new THREE.AxesHelper(Math.min(w, h) * 0.15);
  axes.position.set(bed.min[0], bed.min[1], 0.02);
  group.add(axes);
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(30, w * 0.2), 2),
    new THREE.MeshBasicMaterial({ color: 0x3f4756, side: THREE.DoubleSide }),
  );
  front.position.set((bed.min[0] + bed.max[0]) / 2, bed.min[1] - 3, 0);
  group.add(front);
}

export function useBed(refsRef: RefObject<SceneRefs | null>, bedShape: string, bedAssetKey: string) {
  // --- bed
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    const key = `${bedShape}|${bedAssetKey}`;
    if (refs.bedKey !== key) {
      const [vendor, model, texture] = bedAssetKey.split('|');
      buildBed(refs.bedGroup, bedShape, vendor ? { vendor, model: model || undefined, texture: texture || undefined } : undefined);
      // refit the camera on the first bed and whenever the bed shape changes (printer switch)
      const prevShape = refs.bedKey?.split('|')[0];
      if (!refs.bedKey || prevShape !== bedShape) {
        const { dir, up } = viewDirection('iso');
        frameBox(refs, bedBox(bedShape), dir, up);
      }
      refs.bedKey = key;
    }
  }, [bedShape, bedAssetKey]);
}
