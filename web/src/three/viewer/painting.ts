/**
 * Painting (R-7): the brush cursor, the stroke a press starts and the triangles a stroke marks
 * (support enforcers and blockers, seam, extruder). Moved out of `Viewer.tsx` verbatim.
 *
 * `createPainting` is a factory and not a hook: the handlers need the renderer's canvas and the orbit
 * controls, and they are created and torn down by the scene effect - painting keeps the lifecycle it
 * had inline, and the scene does not hand its listeners to an effect that runs before the canvas
 * exists.
 */
import * as THREE from 'three';
import { selectedInstance, useStore } from '../../state/store';
import { paintKindOf } from '../../tools/paintKind';
import { computeCentroids, trianglesInSphere, type PaintKind } from '../paint';
import { EXTRUDER_COLORS } from './colors';
import type { SceneRefs } from './types';

/** The paint kind of the open tool (T-046: the tools slice holds the tool, not the kind). */
const paintModeOf = (state: ReturnType<typeof useStore.getState>): PaintKind | undefined => paintKindOf(state.activeTool);

interface Painting {
  /** a press: true when it started a stroke, so the scene keeps that press away from picking */
  down(e: PointerEvent): boolean;
  /** pointer move: continues the stroke and follows the brush cursor */
  move(e: PointerEvent): void;
  /** pointer up or leave: the stroke ends */
  endStroke(): void;
  /** the tool closed: the stroke ends and the brush cursor leaves the scene at once */
  stop(): void;
  contextMenu(e: Event): void;
}

export function createPainting(refs: SceneRefs): Painting {
  const renderer = refs.renderer;
  const controls = refs.controls;
  const scene = refs.scene;
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
    if (!paintModeOf(st) || st.selectedIds.length !== 1) return null;
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
    const strokeId = paintStroke.objectId;
    const o = st.objects.find((x) => x.id === strokeId);
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
  const down = (e: PointerEvent) => {
    const st = useStore.getState();
    const kind = paintModeOf(st);
    if (kind && (e.button === 0 || e.button === 2)) {
      const p = pickPaintHit(e);
      if (p) {
        let value: number;
        if (kind === 'mmu') value = e.shiftKey || e.button === 2 ? 0 : st.paintExtruder;
        else value = e.button === 2 ? 2 : e.shiftKey ? 0 : st.paintTool === 'enforcer' ? 1 : st.paintTool === 'blocker' ? 2 : 0;
        const stroke = { objectId: p.st.selectedIds[0], value, kind, button: e.button };
        paintStroke = stroke;
        controls.enabled = false;
        st.beginPaintStroke(stroke.objectId);
        paintAt(e);
        e.preventDefault();
        return true;
      }
    }
    return false;
  };
  const move = (e: PointerEvent) => {
    const st = useStore.getState();
    const kind = paintModeOf(st);
    if (!kind) {
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
      const c = paintStroke
        ? paintStroke.value
        : kind === 'mmu'
          ? st.paintExtruder
          : st.paintTool === 'enforcer'
            ? 1
            : st.paintTool === 'blocker'
              ? 2
              : 0;
      const col =
        kind === 'mmu'
          ? c
            ? EXTRUDER_COLORS[(c - 1) % EXTRUDER_COLORS.length]
            : 0xffffff
          : c === 1
            ? 0x4d6bff
            : c === 2
              ? 0xff4d4d
              : 0xffffff;
      (brushCursor.material as THREE.MeshBasicMaterial).color.set(col);
    } else brushCursor.visible = false;
  };
  const endStroke = () => {
    if (!paintStroke) return;
    paintStroke = null;
    controls.enabled = !refs.dragging;
  };
  /** the tool closed: a running stroke ends with it, and the brush cursor leaves the scene */
  const stop = () => {
    paintStroke = null;
    brushCursor.visible = false;
    controls.enabled = !refs.dragging;
  };
  const contextMenu = (e: Event) => {
    if (paintModeOf(useStore.getState())) e.preventDefault();
  };

  return { down, move, endStroke, stop, contextMenu };
}
