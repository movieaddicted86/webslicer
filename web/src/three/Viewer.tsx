import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStore, bedShapeOf, objectBounds, type PlaterObject } from '../state/store';
import { FEATURE_COLORS, type ParsedGcode } from '../gcode/types';

const OBJECT_COLOR = 0xe6b84a;
const SELECTED_COLOR = 0x6fb1ff;
const OUTSIDE_COLOR = 0xd94f4f;
const EXTRUDER_COLORS = [0xe6b84a, 0x73c2fb, 0xd96fd9, 0x84d08a, 0xf09b59, 0xa9a9f5];

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  transform: TransformControls;
  bedGroup: THREE.Group;
  objectsGroup: THREE.Group;
  gcodeGroup: THREE.Group;
  meshes: Map<string, THREE.Mesh>;
  raycaster: THREE.Raycaster;
  dragging: boolean;
  gcodeLines?: THREE.LineSegments;
  travelLines?: THREE.LineSegments;
  gcodeRef?: ParsedGcode;
  bedKey?: string;
}

function buildBed(group: THREE.Group, bedShape: string) {
  group.clear();
  const bed = bedShapeOf({ bed_shape: bedShape });
  const shape = new THREE.Shape(bed.points.map((p) => new THREE.Vector2(p[0], p[1])));
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({ color: 0x2b2f36, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -0.05;
  mesh.name = 'bed';
  group.add(mesh);

  // grid 10mm / 50mm
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
  group.add(mk(minor, 0x4a5160, 0.5));
  group.add(mk(major, 0x6a7384, 0.8));
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(bed.points.map((p) => new THREE.Vector3(p[0], p[1], 0.01))),
    new THREE.LineBasicMaterial({ color: 0x8f9bb3 }),
  );
  group.add(outline);
  // axes at origin
  const axes = new THREE.AxesHelper(Math.min(w, h) * 0.15);
  axes.position.set(bed.min[0], bed.min[1], 0.02);
  group.add(axes);
  // front marker
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

function buildGcode(refs: SceneRefs, g: ParsedGcode) {
  refs.gcodeGroup.clear();
  refs.gcodeLines = undefined;
  refs.travelLines = undefined;
  const colors = new Float32Array(g.positions.length);
  const colorByType = g.featureTypes.map((t) => new THREE.Color(FEATURE_COLORS[t] || FEATURE_COLORS.Unknown));
  for (let i = 0; i < g.segmentCount; i++) {
    const c = colorByType[g.types[i]];
    const o = i * 6;
    colors[o] = c.r;
    colors[o + 1] = c.g;
    colors[o + 2] = c.b;
    colors[o + 3] = c.r;
    colors[o + 4] = c.g;
    colors[o + 5] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
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
  // feature visibility → collapse hidden segments by setting color alpha? LineBasicMaterial has no per-vertex alpha,
  // so we rebuild the position attribute mask cheaply: move hidden segments to NaN would break bounding; instead
  // use a second attribute via onBeforeCompile is overkill. We toggle by zero-length segments.
  const posAttr = refs.gcodeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
  const src = g.positions;
  const dst = posAttr.array as Float32Array;
  let changed = false;
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
    changed = true;
    refs.gcodeLines.userData.masked = hidden.some(Boolean);
  }
  if (changed) posAttr.needsUpdate = true;
  if (refs.travelLines) {
    refs.travelLines.visible = showTravel;
    const ts = g.travelLayerStart[lo];
    const te = g.travelLayerStart[hi + 1];
    refs.travelLines.geometry.setDrawRange(ts * 2, (te - ts) * 2);
  }
}

export function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const refsRef = useRef<SceneRefs | null>(null);

  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const transformMode = useStore((s) => s.transformMode);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '0x0,200x0,200x200,0x200');
  const maxHeight = useStore((s) => Number(s.presets.printer.current.max_print_height || 200));
  const view = useStore((s) => s.view);
  const gcode = useStore((s) => s.gcode);
  const range = useStore((s) => s.previewLayerRange);
  const showTravel = useStore((s) => s.previewShowTravel);
  const featureVis = useStore((s) => s.previewFeatureVisibility);

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
      meshes: new Map(),
      raycaster: new THREE.Raycaster(),
      dragging: false,
    };
    refsRef.current = refs;

    // Live-update the store while dragging so the manipulation panel follows the gizmo.
    let liveRaf = 0;
    transform.addEventListener('objectChange', () => {
      if (liveRaf) return;
      liveRaf = requestAnimationFrame(() => {
        liveRaf = 0;
        const mesh = transform.object as THREE.Mesh | undefined;
        if (!mesh || !refs.dragging) return;
        const id = mesh.userData.id as string;
        useStore.setState((st) => ({
          objects: st.objects.map((o) =>
            o.id === id
              ? {
                  ...o,
                  position: [mesh.position.x, mesh.position.y, mesh.position.z],
                  rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
                  scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
                }
              : o,
          ),
        }));
      });
    });
    transform.addEventListener('dragging-changed', (e) => {
      controls.enabled = !(e as unknown as { value: boolean }).value;
      refs.dragging = (e as unknown as { value: boolean }).value;
      if (!refs.dragging) {
        // commit transform
        const mesh = transform.object as THREE.Mesh | undefined;
        if (mesh) {
          const id = mesh.userData.id as string;
          const st = useStore.getState();
          const o = st.objects.find((x) => x.id === id);
          if (o) {
            const position: [number, number, number] = [mesh.position.x, mesh.position.y, mesh.position.z];
            const rotation: [number, number, number] = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
            const scale: [number, number, number] = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
            st.updateObject(id, { position, rotation, scale });
            st.dropToBed(id);
          }
        }
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
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      downPos = [e.clientX, e.clientY];
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0 || !downPos) return;
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
      downPos = null;
      if (moved > 4 || refs.dragging) return;
      // A click on a gizmo handle must not change the selection.
      if (refs.transform.axis) return;
      if (useStore.getState().view !== 'plater') return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      refs.raycaster.setFromCamera(ndc, camera);
      const hits = refs.raycaster.intersectObjects([...refs.meshes.values()].filter((m) => m.visible), false);
      const st = useStore.getState();
      if (hits.length) {
        const id = hits[0].object.userData.id as string;
        if (e.shiftKey || e.ctrlKey) {
          if (st.selectedIds.includes(id)) st.select(st.selectedIds.filter((x) => x !== id));
          else st.select([id], true);
        } else st.select([id]);
      } else if (!e.shiftKey && !e.ctrlKey) st.select([]);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

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
      transform.dispose();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      refsRef.current = null;
    };
  }, []);

  // --- bed
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    if (refs.bedKey !== bedShape) {
      buildBed(refs.bedGroup, bedShape);
      if (!refs.bedKey) fitCamera(refs, bedShape);
      refs.bedKey = bedShape;
    }
  }, [bedShape]);

  // --- objects sync
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    const seen = new Set<string>();
    const bed = bedShapeOf({ bed_shape: bedShape });
    for (const o of objects) {
      seen.add(o.id);
      let mesh = refs.meshes.get(o.id);
      if (!mesh) {
        mesh = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ color: OBJECT_COLOR, roughness: 0.55, metalness: 0.05 }));
        mesh.userData.id = o.id;
        refs.meshes.set(o.id, mesh);
        refs.objectsGroup.add(mesh);
      }
      if (mesh.geometry !== o.geometry) mesh.geometry = o.geometry;
      if (!refs.dragging || refs.transform.object !== mesh) {
        mesh.position.set(...o.position);
        mesh.rotation.set(...o.rotation);
        mesh.scale.set(...o.scale);
      }
      // Keep the models visible in the preview until a toolpath is available (e.g. while slicing).
      mesh.visible = o.visible && (view === 'plater' || !gcode);
      const selected = selectedIds.includes(o.id);
      const box = objectBounds(o);
      const outside =
        box.min.x < bed.min[0] - 0.01 ||
        box.min.y < bed.min[1] - 0.01 ||
        box.max.x > bed.max[0] + 0.01 ||
        box.max.y > bed.max[1] + 0.01 ||
        box.max.z > maxHeight + 0.01;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const base = o.extruder > 0 ? EXTRUDER_COLORS[(o.extruder - 1) % EXTRUDER_COLORS.length] : OBJECT_COLOR;
      mat.color.set(outside ? OUTSIDE_COLOR : selected ? SELECTED_COLOR : base);
      mat.emissive.set(selected ? 0x16304a : 0x000000);
    }
    for (const [id, mesh] of refs.meshes) {
      if (!seen.has(id)) {
        refs.objectsGroup.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        refs.meshes.delete(id);
        if (refs.transform.object === mesh) refs.transform.detach();
      }
    }
    // transform gizmo
    const sel = selectedIds.length === 1 ? refs.meshes.get(selectedIds[0]) : undefined;
    if (sel && view === 'plater') {
      if (refs.transform.object !== sel) refs.transform.attach(sel);
      refs.transform.setMode(transformMode);
      refs.transform.getHelper().visible = true;
      refs.transform.enabled = true;
    } else {
      refs.transform.detach();
      refs.transform.getHelper().visible = false;
      refs.transform.enabled = false;
    }
  }, [objects, selectedIds, transformMode, view, bedShape, maxHeight, gcode]);

  // --- gcode
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    if (gcode && refs.gcodeRef !== gcode) buildGcode(refs, gcode);
    if (!gcode) {
      refs.gcodeGroup.clear();
      refs.gcodeRef = undefined;
      refs.gcodeLines = undefined;
    }
    refs.gcodeGroup.visible = view === 'preview' && !!gcode;
    if (gcode) applyGcodeRange(refs, range, showTravel, featureVis);
  }, [gcode, view, range, showTravel, featureVis]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const st = useStore.getState();
      if (st.view !== 'plater') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selectedIds.length) st.removeObjects(st.selectedIds);
      } else if (e.key === 'm' || e.key === 'M') st.setTransformMode('translate');
      else if (e.key === 'r' || e.key === 'R') st.setTransformMode('rotate');
      else if (e.key === 's' || e.key === 'S') st.setTransformMode('scale');
      else if (e.key === 'a' && e.ctrlKey) {
        e.preventDefault();
        st.select(st.objects.map((o) => o.id));
      } else if (e.key === 'a' || e.key === 'A') st.arrange();
      else if (e.key === 'Escape') st.select([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="viewer" ref={containerRef}>
      <div className="viewer-hint">
        {view === 'plater' ? 'Left: rotate · Right/Middle: pan · Wheel: zoom · M/R/S: move/rotate/scale · A: arrange · Del: delete' : ''}
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

export function objectIsOutside(o: PlaterObject, bedShape: string, maxHeight: number): boolean {
  const bed = bedShapeOf({ bed_shape: bedShape });
  const box = objectBounds(o);
  return (
    box.min.x < bed.min[0] - 0.01 ||
    box.min.y < bed.min[1] - 0.01 ||
    box.max.x > bed.max[0] + 0.01 ||
    box.max.y > bed.max[1] + 0.01 ||
    box.max.z > maxHeight + 0.01
  );
}
