/**
 * The scene (R-7): the renderer, the cameras, the orbit and transform controls, the render loop and
 * the pointer handlers (picking, place-on-face; the painting ones come from `./painting`). Moved out
 * of `Viewer.tsx` verbatim - the effect creates everything and disposes it in the same order and in
 * the same place, so the GPU resources (geometries, textures, programs) live exactly as long as they
 * did before.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { useStore, type PlaterObject } from '../../state/store';
import { renderThumbnails } from '../thumbnail';
import { FOV, orthoHeightOf, setOrthoFrustum } from './camera';
import { createPainting } from './painting';
import type { SceneRefs } from './types';

function readTransform(obj: THREE.Object3D) {
  return {
    position: [obj.position.x, obj.position.y, obj.position.z] as [number, number, number],
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as [number, number, number],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z] as [number, number, number],
  };
}

export function useScene(refsRef: RefObject<SceneRefs | null>, containerRef: RefObject<HTMLDivElement | null>) {
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
    const painting = createPainting(refs);
    const onPointerDown = (e: PointerEvent) => {
      if (painting.down(e)) return;
      if (e.button !== 0) return;
      downPos = [e.clientX, e.clientY];
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
        const hit = hits.find(
          (h) =>
            h.face &&
            (h.object.userData.kind === 'object' ||
              !(h.object as THREE.Mesh).material ||
              !((h.object as THREE.Mesh).material as THREE.MeshStandardMaterial).transparent),
        );
        if (hit && hit.face) {
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          const objectId =
            hit.object.userData.kind === 'volume' ? (hit.object.parent!.userData.id as string) : (hit.object.userData.id as string);
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
    renderer.domElement.addEventListener('pointermove', painting.move);
    renderer.domElement.addEventListener('pointerup', painting.endStroke);
    renderer.domElement.addEventListener('pointerleave', painting.endStroke);
    renderer.domElement.addEventListener('contextmenu', painting.contextMenu);

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
      renderer.domElement.removeEventListener('pointermove', painting.move);
      renderer.domElement.removeEventListener('pointerup', painting.endStroke);
      renderer.domElement.removeEventListener('pointerleave', painting.endStroke);
      renderer.domElement.removeEventListener('contextmenu', painting.contextMenu);
      transform.dispose();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      refsRef.current = null;
      useStore.setState({ renderThumbnails: undefined });
    };
    // `containerRef`/`refsRef` are stable ref objects owned by the Viewer; the scene is built once
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs, not dependencies
  }, []);
}
