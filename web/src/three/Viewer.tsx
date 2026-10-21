import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStore, instanceBounds, selectedInstance, type PlaterInstance, type PlaterObject } from '../state/store';
import { bedShapeOf } from '@webslicer/shared';
import { VIEWS, viewDirection } from '../plater/camera';
import { renderThumbnails } from './thumbnail';
import { useKeyboardShortcuts } from './viewer/useKeyboardShortcuts';
import type { ObjectNode, SceneRefs } from './viewer/types';
import { EXTRUDER_COLORS } from './viewer/colors';
import { useGizmo } from './viewer/useGizmo';
import { usePlaterObjects } from './viewer/usePlaterObjects';
import { useBed } from './viewer/useBed';
import { useCamera, useCameraState } from './viewer/useCamera';
import { useGcodePreview } from './viewer/useGcodePreview';
import { normalizeColor } from '../gcode/colorprint';
import { FOV, bedBox, frameBox, orthoHeightOf, setOrthoFrustum } from './viewer/camera';
import { computeCentroids, trianglesInSphere, type PaintKind } from './paint';


export { VOLUME_COLORS } from './viewer/colors';

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
  const { ortho, request: camRequest, toggleOrtho, requestCamera } = useCameraState();

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
  const moveCut = useStore((s) => s.previewMoveCut);
  const markerVis = useStore((s) => s.previewMarkers);
  const showShells = useStore((s) => s.previewShowShells);
  const colorMode = useStore((s) => s.previewColorMode);
  const customGcodes = useStore((s) => s.customGcodes);
  const filamentColour = useStore((s) => s.presets.filament[0]?.current.filament_colour);
  const toolColorKey = useStore((s) => s.presets.filament.map((f) => normalizeColor(f.current.filament_colour)).join(','));
  const placeOnFace = useStore((s) => s.placeOnFace);
  const paintMode = useStore((s) => s.paintMode);
  /** "Shells": the plater meshes shown translucent over the toolpaths */
  const shells = useStore((s) => s.previewShowShells) && view === 'preview' && !!gcode;
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
    const persp = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
    persp.up.set(0, 0, 1);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    ortho.up.set(0, 0, 1);
    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    // the polar angle stays unlimited: "Bottom" (key 2) puts the camera below the bed, like PrusaSlicer
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

    const transform = new TransformControls(persp, renderer.domElement);
    transform.setSpace('world');
    scene.add(transform.getHelper());

    const refs: SceneRefs = {
      renderer,
      scene,
      camera: persp,
      persp,
      ortho,
      controls,
      transform,
      bedGroup,
      objectsGroup,
      gcodeGroup,
      nodes: new Map(),
      raycaster: new THREE.Raycaster(),
      dragging: false,
      shells: [],
      shellsOn: false,
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
      const aspect = w / h;
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
      // keep the height the ortho view shows, only the width follows the aspect
      setOrthoFrustum(ortho, orthoHeightOf(ortho), aspect, ortho.zoom);
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
      refs.raycaster.setFromCamera(ndc, refs.camera);
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
      refs.raycaster.setFromCamera(ndc, refs.camera);
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
      renderer.render(scene, refs.camera);
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

  useBed(refsRef, bedShape, bedAssetKey);

  // --- perspective / orthographic (PrusaSlicer's K), and the camera commands: standard views,
  // zoom to selection, fit the bed
  useCamera(refsRef, ortho, camRequest);

  // --- objects and the transform gizmo
  usePlaterObjects(refsRef, { objects, selectedIds, selectedVolumeId, selectedInstanceId, view, bedShape, maxHeight, gcode, paintMode, shells });
  useGizmo(refsRef, { objects, selectedIds, selectedVolumeId, selectedInstanceId, transformMode, view, paintMode });

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
  }, [shells, objects]);

  // --- gcode
  useGcodePreview(refsRef, { gcode, view, range, moveCut, showTravel, markerVis, featureVis, colorMode, customGcodes, filamentColour, toolColorKey });

  // keyboard
  useKeyboardShortcuts(requestCamera, toggleOrtho);

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
        {view === 'plater' && <div>Left: rotate · Right/Middle: pan · Wheel: zoom · M/R/S: move/rotate/scale · F: place on face · A: arrange · Del: delete</div>}
        <div>Views: 0-6 · K: perspective/ortho · Z: zoom to selection</div>
      </div>
      {/* PrusaSlicer's view toolbar: the standard views, the projection and zoom to selection */}
      <div className="viewer-toolbar">
        {VIEWS.map((v) => (
          <button key={v.id} title={`${v.label} view (${v.key})`} onClick={() => requestCamera({ mode: 'view', view: v.id })}>
            {v.label}
          </button>
        ))}
        <button
          className={ortho ? 'active' : ''}
          title={ortho ? 'Orthographic projection (K)' : 'Perspective projection (K)'}
          onClick={toggleOrtho}
        >
          {ortho ? 'Ortho' : 'Persp'}
        </button>
        <button title="Zoom to selection (Z)" onClick={() => requestCamera({ mode: 'fit' })}>
          ⌖
        </button>
      </div>
      <button
        className="viewer-fit"
        title="Reset view"
        onClick={() => requestCamera({ mode: 'bed' })}
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
