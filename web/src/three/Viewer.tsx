import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  useStore,
  bedShapeOf,
  instanceBounds,
  selectedInstance,
  pickedInstanceId,
  type PlaterInstance,
  type PlaterObject,
  type PlaterVolume,
} from '../state/store';
import { FEATURE_COLORS, type ParsedGcode } from '../gcode/types';
import { RANGE_SCHEMES, rangeColor, rangePosition, schemeRange, type PreviewColorMode } from '../gcode/colorschemes';
import type { CustomGcode, VolumeType } from '../api';
import { colorAtZ, normalizeColor } from '../gcode/colorprint';
import { renderThumbnails } from './thumbnail';
import { computeCentroids, paintToColors, trianglesInSphere, type PaintKind } from './paint';

const OBJECT_COLOR = 0xe6b84a;
const SELECTED_COLOR = 0x6fb1ff;
const OUTSIDE_COLOR = 0xd94f4f;
const EXTRUDER_COLORS = [0xe6b84a, 0x73c2fb, 0xd96fd9, 0x84d08a, 0xf09b59, 0xa9a9f5];

/** Colours of sub-volumes, close to PrusaSlicer's */
export const VOLUME_COLORS: Record<VolumeType, { color: number; opacity: number }> = {
  ModelPart: { color: 0xe6b84a, opacity: 1 },
  ParameterModifier: { color: 0xffe14d, opacity: 0.45 },
  SupportEnforcer: { color: 0x4d6bff, opacity: 0.45 },
  SupportBlocker: { color: 0xff4d4d, opacity: 0.45 },
  NegativeVolume: { color: 0x707070, opacity: 0.45 },
};

interface InstanceNode {
  /** scene node carrying the instance transform; its children are in object-local coordinates */
  group: THREE.Group;
  /** object body; shares the geometry with its sibling instances, owns its material (per-instance colour) */
  mesh: THREE.Mesh;
  volumes: Map<string, THREE.Mesh>;
  /** translucent slabs visualizing height range modifiers */
  slabs?: THREE.Group;
  slabKey?: string;
}

interface ObjectNode {
  /** pure container, no transform of its own */
  group: THREE.Group;
  /** one scene node per instance */
  instances: Map<string, InstanceNode>;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  transform: TransformControls;
  bedGroup: THREE.Group;
  objectsGroup: THREE.Group;
  gcodeGroup: THREE.Group;
  nodes: Map<string, ObjectNode>;
  raycaster: THREE.Raycaster;
  dragging: boolean;
  gcodeLines?: THREE.LineSegments;
  travelLines?: THREE.LineSegments;
  gcodeRef?: ParsedGcode;
  /** key of the colouring currently applied to the toolpaths */
  colorKey?: string;
  bedKey?: string;
}

interface BedAsset {
  vendor: string;
  model?: string;
  texture?: string;
}

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
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
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
  const mat = new THREE.MeshBasicMaterial({ color: 0x2b2f36, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
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

function fitCamera(refs: SceneRefs, bedShape: string) {
  const bed = bedShapeOf({ bed_shape: bedShape });
  const cx = (bed.min[0] + bed.max[0]) / 2;
  const cy = (bed.min[1] + bed.max[1]) / 2;
  const size = Math.max(bed.max[0] - bed.min[0], bed.max[1] - bed.min[1]);
  refs.camera.position.set(cx, cy - size * 1.1, size * 0.9);
  refs.controls.target.set(cx, cy, 0);
  refs.controls.update();
}

interface GcodeColoring {
  mode: PreviewColorMode;
  baseColor: string;
  codes: CustomGcode[];
  /** colour per tool (filament colours) */
  toolColors: string[];
}

/** Fill the per-vertex colours of the toolpath lines for the given colour mode. */
function fillGcodeColors(colors: Float32Array, g: ParsedGcode, coloring: GcodeColoring) {
  const set = (i: number, c: THREE.Color) => {
    const o = i * 6;
    colors[o] = colors[o + 3] = c.r;
    colors[o + 1] = colors[o + 4] = c.g;
    colors[o + 2] = colors[o + 5] = c.b;
  };
  if (coloring.mode === 'colorprint') {
    // one colour per layer, switched by colour changes
    const layerColor = Array.from(g.layerZ, (z) => new THREE.Color(colorAtZ(z, coloring.baseColor, coloring.codes)));
    for (let i = 0; i < g.segmentCount; i++) set(i, layerColor[g.layers[i]] ?? layerColor[0]);
    return;
  }
  if (coloring.mode === 'tool') {
    const toolColor = coloring.toolColors.map((c) => new THREE.Color(c));
    const fallback = new THREE.Color(coloring.baseColor);
    for (let i = 0; i < g.segmentCount; i++) set(i, toolColor[g.tools[i]] ?? fallback);
    return;
  }
  const scheme = RANGE_SCHEMES[coloring.mode];
  if (scheme) {
    const values = scheme.values(g);
    const range = schemeRange(g, coloring.mode);
    // 256-entry lookup table instead of interpolating per segment
    const lut = Array.from({ length: 256 }, (_, k) => new THREE.Color(...rangeColor(k / 255)));
    for (let i = 0; i < g.segmentCount; i++) {
      const v = scheme.perLayer ? values[g.layers[i]] : values[i];
      set(i, lut[Math.round(Math.min(1, Math.max(0, rangePosition(v, range, scheme.log))) * 255)]);
    }
    return;
  }
  const colorByType = g.featureTypes.map((t) => new THREE.Color(FEATURE_COLORS[t] || FEATURE_COLORS.Unknown));
  for (let i = 0; i < g.segmentCount; i++) set(i, colorByType[g.types[i]]);
}

function coloringKey(c: GcodeColoring): string {
  if (c.mode === 'colorprint') return `colorprint|${c.baseColor}|${c.codes.map((x) => `${x.type}:${x.printZ}:${x.color ?? ''}`).join(',')}`;
  if (c.mode === 'tool') return `tool|${c.baseColor}|${c.toolColors.join(',')}`;
  return c.mode;
}

function buildGcode(refs: SceneRefs, g: ParsedGcode, coloring: GcodeColoring) {
  refs.gcodeGroup.clear();
  refs.gcodeLines = undefined;
  refs.travelLines = undefined;
  const colors = new Float32Array(g.positions.length);
  fillGcodeColors(colors, g, coloring);
  refs.colorKey = coloringKey(coloring);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions.slice(), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
  lines.frustumCulled = false;
  refs.gcodeGroup.add(lines);
  refs.gcodeLines = lines;

  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(g.travelPositions, 3));
  const travel = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x3b8bd1, transparent: true, opacity: 0.6 }));
  travel.frustumCulled = false;
  travel.visible = false;
  refs.gcodeGroup.add(travel);
  refs.travelLines = travel;
  refs.gcodeRef = g;
}

function applyGcodeRange(refs: SceneRefs, range: [number, number], showTravel: boolean, visibility: Record<string, boolean>) {
  const g = refs.gcodeRef;
  if (!g || !refs.gcodeLines) return;
  const lo = Math.max(0, Math.min(range[0], g.layerCount - 1));
  const hi = Math.max(lo, Math.min(range[1], g.layerCount - 1));
  const startSeg = g.layerStart[lo];
  const endSeg = g.layerStart[hi + 1];
  refs.gcodeLines.geometry.setDrawRange(startSeg * 2, (endSeg - startSeg) * 2);
  // hidden feature types are collapsed to zero-length segments
  const posAttr = refs.gcodeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
  const src = g.positions;
  const dst = posAttr.array as Float32Array;
  const hidden = g.featureTypes.map((t) => visibility[t] === false);
  if (hidden.some(Boolean) || (refs.gcodeLines.userData.masked as boolean)) {
    for (let i = startSeg; i < endSeg; i++) {
      const o = i * 6;
      if (hidden[g.types[i]]) {
        dst[o + 3] = src[o];
        dst[o + 4] = src[o + 1];
        dst[o + 5] = src[o + 2];
      } else {
        dst[o + 3] = src[o + 3];
        dst[o + 4] = src[o + 4];
        dst[o + 5] = src[o + 5];
      }
    }
    posAttr.needsUpdate = true;
    refs.gcodeLines.userData.masked = hidden.some(Boolean);
  }
  if (refs.travelLines) {
    refs.travelLines.visible = showTravel;
    const ts = g.travelLayerStart[lo];
    const te = g.travelLayerStart[hi + 1];
    refs.travelLines.geometry.setDrawRange(ts * 2, (te - ts) * 2);
  }
}

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

function readTransform(obj: THREE.Object3D) {
  return {
    position: [obj.position.x, obj.position.y, obj.position.z] as [number, number, number],
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as [number, number, number],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z] as [number, number, number],
  };
}

export function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const refsRef = useRef<SceneRefs | null>(null);

  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const transformMode = useStore((s) => s.transformMode);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '0x0,200x0,200x200,0x200');
  const maxHeight = useStore((s) => Number(s.presets.printer.current.max_print_height || 200));
  const view = useStore((s) => s.view);
  const gcode = useStore((s) => s.gcode);
  const range = useStore((s) => s.previewLayerRange);
  const showTravel = useStore((s) => s.previewShowTravel);
  const featureVis = useStore((s) => s.previewFeatureVisibility);
  const colorMode = useStore((s) => s.previewColorMode);
  const customGcodes = useStore((s) => s.customGcodes);
  const filamentColour = useStore((s) => s.presets.filament[0]?.current.filament_colour);
  const toolColorKey = useStore((s) => s.presets.filament.map((f) => normalizeColor(f.current.filament_colour)).join(','));
  const placeOnFace = useStore((s) => s.placeOnFace);
  const paintMode = useStore((s) => s.paintMode);
  // vendor bed model/texture of the selected printer ("vendor|model.stl|texture.svg", empty when none)
  const bedAssetKey = useStore((s) => {
    const p = s.presets.printer;
    if (!p.vendorId || !p.printerModel) return '';
    const m = s.vendors.flatMap((v) => v.models).find((x) => x.vendorId === p.vendorId && x.id === p.printerModel);
    return m && (m.bedModel || m.bedTexture) ? `${m.vendorId}|${m.bedModel || ''}|${m.bedTexture || ''}` : '';
  });

  // --- init scene
  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1b1e24);
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI / 2 + 0.2;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-200, -300, 500);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(300, 200, 200);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, 400, -100);
    scene.add(rim);

    const bedGroup = new THREE.Group();
    const objectsGroup = new THREE.Group();
    const gcodeGroup = new THREE.Group();
    scene.add(bedGroup, objectsGroup, gcodeGroup);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSpace('world');
    scene.add(transform.getHelper());

    const refs: SceneRefs = {
      renderer,
      scene,
      camera,
      controls,
      transform,
      bedGroup,
      objectsGroup,
      gcodeGroup,
      nodes: new Map(),
      raycaster: new THREE.Raycaster(),
      dragging: false,
    };
    refsRef.current = refs;
    useStore.setState({ renderThumbnails: (specs, colors) => renderThumbnails(scene, objectsGroup, specs, colors) });

    const applyToStore = (target: THREE.Object3D, commit: boolean) => {
      const st = useStore.getState();
      const t = readTransform(target);
      if (target.userData.kind === 'volume') {
        const objectId = target.parent?.userData.id as string;
        st.updateVolume(objectId, target.userData.id as string, t);
        if (commit) st.dropToBed(objectId);
      } else if (target.userData.instanceId) {
        // the gizmo drives one instance; the volume children follow the instance node
        const id = target.userData.id as string;
        st.updateInstance(id, target.userData.instanceId as string, t);
        if (commit) st.dropToBed(id);
      }
    };

    // Live-update the store while dragging so the manipulation panel follows the gizmo.
    let liveRaf = 0;
    transform.addEventListener('objectChange', () => {
      if (liveRaf) return;
      liveRaf = requestAnimationFrame(() => {
        liveRaf = 0;
        const target = transform.object;
        if (!target || !refs.dragging) return;
        applyToStore(target, false);
      });
    });
    let dragSnapshot: PlaterObject[] | undefined;
    transform.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      controls.enabled = !dragging;
      refs.dragging = dragging;
      if (dragging) dragSnapshot = useStore.getState().objects;
      if (!dragging && transform.object) {
        if (dragSnapshot) useStore.getState().recordHistory(dragSnapshot);
        dragSnapshot = undefined;
        applyToStore(transform.object, true);
      }
    });

    const onResize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    onResize();

    // picking
    let downPos: [number, number] | null = null;
    // --- painting (support enforcers/blockers, seam)
    const brushCursor = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    brushCursor.visible = false;
    brushCursor.renderOrder = 20;
    scene.add(brushCursor);
    let paintStroke: { objectId: string; value: number; kind: PaintKind; button: number } | null = null;
    const centroidCache = new WeakMap<THREE.BufferGeometry, Float32Array>();
    const pickPaintHit = (e: PointerEvent) => {
      const st = useStore.getState();
      if (!st.paintMode || st.selectedIds.length !== 1) return null;
      const node = refs.nodes.get(st.selectedIds[0]);
      if (!node) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      refs.raycaster.setFromCamera(ndc, camera);
      // every instance carries a copy of the body, so a stroke can land on any of them
      const meshes = [...node.instances.values()].map((n) => n.mesh);
      const hit = refs.raycaster.intersectObjects(meshes, false)[0];
      return hit ? { hit, node, st } : null;
    };
    const paintAt = (e: PointerEvent) => {
      if (!paintStroke) return;
      const p = pickPaintHit(e);
      if (!p) return;
      const { hit, st } = p;
      const o = st.objects.find((x) => x.id === paintStroke!.objectId);
      if (!o) return;
      const selInst = selectedInstance(st, o);
      let centroids = centroidCache.get(o.geometry);
      if (!centroids) {
        centroids = computeCentroids(o.geometry);
        centroidCache.set(o.geometry, centroids);
      }
      // the hit mesh sits under one instance node; object-local coordinates are what the paint data uses
      const local = (hit.object as THREE.Mesh).worldToLocal(hit.point.clone());
      // magnitudes: a mirrored instance has one negative scale component (AC-5)
      const scale = (Math.abs(selInst.scale[0]) + Math.abs(selInst.scale[1]) + Math.abs(selInst.scale[2])) / 3 || 1;
      const tris = trianglesInSphere(centroids, local, st.brushRadius / scale);
      if (hit.faceIndex !== undefined && hit.faceIndex !== null) tris.push(hit.faceIndex);
      st.applyPaint(o.id, paintStroke.kind, tris, paintStroke.value);
    };
    const onPointerDown = (e: PointerEvent) => {
      const st = useStore.getState();
      if (st.paintMode && (e.button === 0 || e.button === 2)) {
        const p = pickPaintHit(e);
        if (p) {
          let value: number;
          if (st.paintMode === 'mmu') value = e.shiftKey || e.button === 2 ? 0 : st.paintExtruder;
          else value = e.button === 2 ? 2 : e.shiftKey ? 0 : st.paintTool === 'enforcer' ? 1 : st.paintTool === 'blocker' ? 2 : 0;
          const stroke = { objectId: p.st.selectedIds[0], value, kind: st.paintMode, button: e.button };
          paintStroke = stroke;
          controls.enabled = false;
          st.beginPaintStroke(stroke.objectId);
          paintAt(e);
          e.preventDefault();
          return;
        }
      }
      if (e.button !== 0) return;
      downPos = [e.clientX, e.clientY];
    };
    const onPointerMove = (e: PointerEvent) => {
      const st = useStore.getState();
      if (!st.paintMode) {
        brushCursor.visible = false;
        return;
      }
      if (paintStroke) {
        paintAt(e);
      }
      const p = pickPaintHit(e);
      if (p) {
        brushCursor.visible = true;
        brushCursor.position.copy(p.hit.point);
        brushCursor.scale.setScalar(st.brushRadius);
        const c = paintStroke ? paintStroke.value : st.paintMode === 'mmu' ? st.paintExtruder : st.paintTool === 'enforcer' ? 1 : st.paintTool === 'blocker' ? 2 : 0;
        const col =
          st.paintMode === 'mmu' ? (c ? EXTRUDER_COLORS[(c - 1) % EXTRUDER_COLORS.length] : 0xffffff) : c === 1 ? 0x4d6bff : c === 2 ? 0xff4d4d : 0xffffff;
        (brushCursor.material as THREE.MeshBasicMaterial).color.set(col);
      } else brushCursor.visible = false;
    };
    const endStroke = () => {
      if (!paintStroke) return;
      paintStroke = null;
      controls.enabled = !refs.dragging;
    };
    const onContextMenu = (e: Event) => {
      if (useStore.getState().paintMode) e.preventDefault();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || !downPos) return;
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
      downPos = null;
      if (moved > 4 || refs.dragging) return;
      if (refs.transform.axis) return; // click on a gizmo handle
      if (useStore.getState().view !== 'plater') return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      refs.raycaster.setFromCamera(ndc, camera);
      const pickables: THREE.Object3D[] = [];
      for (const n of refs.nodes.values()) {
        if (!n.group.visible) continue;
        for (const inst of n.instances.values()) {
          if (!inst.group.visible) continue;
          pickables.push(inst.mesh, ...inst.volumes.values());
        }
      }
      const hits = refs.raycaster.intersectObjects(pickables, false);
      const st = useStore.getState();
      if (st.placeOnFace) {
        // lay the clicked face flat on the bed
        const hit = hits.find((h) => h.face && (h.object.userData.kind === 'object' || !(h.object as THREE.Mesh).material || !((h.object as THREE.Mesh).material as THREE.MeshStandardMaterial).transparent));
        if (hit && hit.face) {
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          const objectId = hit.object.userData.kind === 'volume' ? (hit.object.parent!.userData.id as string) : (hit.object.userData.id as string);
          st.select([objectId]);
          st.placeObjectOnFace(objectId, [normal.x, normal.y, normal.z]);
        } else st.setPlaceOnFace(false);
        return;
      }
      if (hits.length) {
        // prefer a volume hit over the object body when both are under the cursor at similar depth
        const hit = hits.find((h) => h.object.userData.kind === 'volume' && h.distance <= hits[0].distance + 0.5) || hits[0];
        const obj = hit.object;
        if (obj.userData.kind === 'volume') {
          st.selectVolume(obj.parent!.userData.id as string, obj.userData.id as string);
          return;
        }
        const id = obj.userData.id as string;
        if (e.shiftKey || e.ctrlKey) {
          if (st.selectedIds.includes(id)) st.select(st.selectedIds.filter((x) => x !== id));
          else st.select([id], true);
        } else st.select([id]);
        const hitInstance = obj.userData.instanceId as string | undefined;
        if (hitInstance) st.selectInstance(id, hitInstance);
      } else if (!e.shiftKey && !e.ctrlKey) st.select([]);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', endStroke);
    renderer.domElement.addEventListener('pointerleave', endStroke);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', endStroke);
      renderer.domElement.removeEventListener('pointerleave', endStroke);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      transform.dispose();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      refsRef.current = null;
      useStore.setState({ renderThumbnails: undefined });
    };
  }, []);

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
      if (!refs.bedKey || prevShape !== bedShape) fitCamera(refs, bedShape);
      refs.bedKey = key;
    }
  }, [bedShape, bedAssetKey]);

  // --- objects sync
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
          const mesh = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ color: OBJECT_COLOR, roughness: 0.55, metalness: 0.05 }));
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
      // Keep the models visible in the preview until a toolpath is available (e.g. while slicing).
      node.group.visible = o.visible && (view === 'plater' || !gcode);
      const selected = selectedIds.includes(o.id);
      const selInst = selectedInstance({ selectedIds, selectedInstanceId }, o);
      const painted = !!(o.paint && (o.paint.supports || o.paint.seam || o.paint.mmu));
      const paintingThis = paintMode && selected;
      const base = o.extruder > 0 ? EXTRUDER_COLORS[(o.extruder - 1) % EXTRUDER_COLORS.length] : OBJECT_COLOR;
      for (const [iid, inode] of node.instances) {
        const inst = o.instances.find((i) => i.id === iid)!;
        // outside-bed highlight is per instance (each copy can sit off the bed on its own)
        const box = instanceBounds(o, inst);
        const outside =
          box.min.x < bed.min[0] - 0.01 ||
          box.min.y < bed.min[1] - 0.01 ||
          box.max.x > bed.max[0] + 0.01 ||
          box.max.y > bed.max[1] + 0.01 ||
          box.max.z > maxHeight + 0.01;
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
          const bb = o.geometry.boundingBox!;
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
              new THREE.MeshBasicMaterial({ color: i % 2 ? 0x6fb1ff : 0xffb86f, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
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
          const partBase = v.type === 'ModelPart' && v.extruder > 0 ? EXTRUDER_COLORS[(v.extruder - 1) % EXTRUDER_COLORS.length] : spec.color;
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
    // transform gizmo
    let target: THREE.Object3D | undefined;
    if (selectedIds.length === 1 && view === 'plater' && !paintMode) {
      const o = objects.find((x) => x.id === selectedIds[0]);
      const node = refs.nodes.get(selectedIds[0]);
      if (node && o) {
        // the gizmo drives the selected instance; its volumes stay children of it
        const inode = node.instances.get(selectedInstance({ selectedIds, selectedInstanceId }, o).id);
        target = selectedVolumeId ? inode?.volumes.get(selectedVolumeId) || inode?.group || node.group : inode?.group || node.group;
      }
    }
    if (target) {
      if (refs.transform.object !== target) refs.transform.attach(target);
      refs.transform.setMode(transformMode);
      refs.transform.getHelper().visible = true;
      refs.transform.enabled = true;
    } else {
      refs.transform.detach();
      refs.transform.getHelper().visible = false;
      refs.transform.enabled = false;
    }
  }, [objects, selectedIds, selectedVolumeId, selectedInstanceId, transformMode, view, bedShape, maxHeight, gcode, paintMode]);

  // --- gcode
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    const coloring: GcodeColoring = { mode: colorMode, baseColor: normalizeColor(filamentColour), codes: customGcodes, toolColors: toolColorKey.split(',') };
    if (gcode && refs.gcodeRef !== gcode) buildGcode(refs, gcode, coloring);
    else if (gcode && refs.gcodeLines && refs.colorKey !== coloringKey(coloring)) {
      // recolour in place (colour mode or colour changes edited)
      const attr = refs.gcodeLines.geometry.getAttribute('color') as THREE.BufferAttribute;
      fillGcodeColors(attr.array as Float32Array, gcode, coloring);
      attr.needsUpdate = true;
      refs.colorKey = coloringKey(coloring);
    }
    if (!gcode) {
      refs.gcodeGroup.clear();
      refs.gcodeRef = undefined;
      refs.gcodeLines = undefined;
    }
    refs.gcodeGroup.visible = view === 'preview' && !!gcode;
    if (gcode) applyGcodeRange(refs, range, showTravel, featureVis);
  }, [gcode, view, range, showTravel, featureVis, colorMode, customGcodes, filamentColour, toolColorKey]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const st = useStore.getState();
      if (st.view !== 'plater') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const o = st.objects.find((x) => x.id === st.selectedIds[0]);
        if (st.selectedVolumeId && st.selectedIds.length === 1) st.removeVolume(st.selectedIds[0], st.selectedVolumeId);
        // AC-4.4: Del removes the instance that was picked; without one the whole object goes
        else if (st.selectedIds.length === 1 && o && pickedInstanceId(st, o) && o.instances.length > 1) st.removeInstance(o.id, st.selectedInstanceId);
        else if (st.selectedIds.length) st.removeObjects(st.selectedIds);
      } else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        if (st.selectedIds.length === 1) st.addInstances(st.selectedIds[0]);
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        // AC-1.2: "−" always drops the last copy
        if (st.selectedIds.length === 1) st.removeInstance(st.selectedIds[0]);
      } else if ((e.key === 'l' || e.key === 'L') && st.selectedIds.length === 1) {
        if (st.paintMode === 'supports') st.stopPaint();
        else st.startPaint(st.selectedIds[0], 'supports');
      } else if ((e.key === 'p' || e.key === 'P') && st.selectedIds.length === 1) {
        if (st.paintMode === 'seam') st.stopPaint();
        else st.startPaint(st.selectedIds[0], 'seam');
      } else if (e.key === 'f' || e.key === 'F') st.setPlaceOnFace(!st.placeOnFace);
      else if (e.key === 'm' || e.key === 'M') st.setTransformMode('translate');
      else if (e.key === 'r' || e.key === 'R') st.setTransformMode('rotate');
      else if (e.key === 's' || e.key === 'S') st.setTransformMode('scale');
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'a' && e.ctrlKey) {
        e.preventDefault();
        st.select(st.objects.map((o) => o.id));
      } else if (e.key === 'a' || e.key === 'A') st.arrange();
      else if (e.key === 'Escape') {
        if (st.paintMode) st.stopPaint();
        else if (st.placeOnFace) st.setPlaceOnFace(false);
        else st.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`viewer ${placeOnFace ? 'place-on-face' : ''}`} ref={containerRef}>
      {placeOnFace && <div className="viewer-banner">Place on face: click the face that should lie flat on the bed (Esc to cancel)</div>}
      {paintMode && (
        <div className="viewer-banner">
          {paintMode === 'mmu'
            ? 'Paint extruder: left = selected extruder · right / Shift+left = reset to object extruder · Esc = done'
            : `${paintMode === 'supports' ? 'Paint supports' : 'Paint seam'}: left = brush tool · right = blocker · Shift+left = erase · Esc = done`}
        </div>
      )}
      <div className="viewer-hint">
        {view === 'plater' ? 'Left: rotate · Right/Middle: pan · Wheel: zoom · M/R/S: move/rotate/scale · F: place on face · A: arrange · Del: delete' : ''}
      </div>
      <button
        className="viewer-fit"
        title="Reset view"
        onClick={() => {
          const refs = refsRef.current;
          if (refs) fitCamera(refs, bedShape);
        }}
      >
        ⌂
      </button>
    </div>
  );
}

/** True when at least one instance of the object leaves the print volume. */
export function objectIsOutside(o: PlaterObject, bedShape: string, maxHeight: number): boolean {
  const bed = bedShapeOf({ bed_shape: bedShape });
  return o.instances.some((inst) => {
    const box = instanceBounds(o, inst);
    return (
      box.min.x < bed.min[0] - 0.01 ||
      box.min.y < bed.min[1] - 0.01 ||
      box.max.x > bed.max[0] + 0.01 ||
      box.max.y > bed.max[1] + 0.01 ||
      box.max.z > maxHeight + 0.01
    );
  });
}
