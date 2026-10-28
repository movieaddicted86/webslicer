/**
 * The touch handling of the 3D view (T-092): one factory per canvas, like `createPainting`.
 *
 * It wires the touch pointers of the canvas into the pure `TouchGestures` state machine and does what
 * each intent means in the scene:
 *
 * - one finger orbits: the camera swings around the orbit target (`touchCamera`);
 * - two fingers pinch: the distance zooms and the fingers' midpoint pans;
 * - a tap selects or deselects the object under the finger, with a thumb's tolerance; an empty spot
 *   closes the open tool and clears the selection, the way a mouse click does;
 * - a double tap frames everything – the same command as the Home button;
 * - a long press on an object opens a small menu with Duplicate and Delete;
 * - a drag that starts on an *already selected* object moves it on the plate; the plate rules of the
 *   mouse apply when the finger lifts (the instance drops onto the bed and an off-bed copy keeps the
 *   red mark of the plate check).
 *
 * The mouse and the keyboard keep their own paths: everything here ignores pointers that are not
 * touches, and `useScene` switches OrbitControls' touch mapping off, so no gesture is handled twice.
 */
import * as THREE from 'three';
import { useStore } from '../../state/store';
import { TouchGestures, type GestureIntent, type PointerSample } from './gestures';
import { pickAt, planePointAt } from './pickables';
import { orbitByTouch, pinchByTouch } from './touchCamera';
import type { SceneRefs } from './types';

/** A tap's hit tolerance in CSS pixels: a thumb is wider than a mouse cursor. */
export const TOUCH_PICK_TOLERANCE = 12;

/** How long a resting finger waits for the long press; the machine's own deadline plus a breath. */
const LONG_PRESS_TIMER_MS = 520;

export interface TouchHandling {
  /** a pointer went down on the canvas (only touches are handled) */
  down(e: PointerEvent): void;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(e: PointerEvent): void;
  /** forget the fingers (the scene is torn down) */
  stop(): void;
}

interface Options {
  /** frame every object – the viewer's camera request, so the double tap is Home */
  frameAll(): void;
}

/** The object a hit belongs to: a volume hit names its parent object and instance. */
function objectOf(hit: THREE.Intersection): { objectId: string; volumeId?: string; instanceId?: string } {
  const obj = hit.object;
  const volume = obj.userData.kind === 'volume';
  const owner = volume ? obj.parent : obj;
  return {
    objectId: (owner?.userData.id as string | undefined) || '',
    volumeId: volume ? (obj.userData.id as string) : undefined,
    instanceId: obj.userData.instanceId as string | undefined,
  };
}

export function createTouch(refs: SceneRefs, options: Options): TouchHandling {
  const canvas = refs.renderer.domElement;
  const gestures = new TouchGestures();
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let lastEvent: PointerEvent | undefined;
  let menu: HTMLElement | undefined;
  let dragging:
    | {
        objectId: string;
        instanceId: string;
        /** the plate height the finger holds, in world Z */
        plane: number;
        start: THREE.Vector3;
        origin: [number, number, number];
      }
    | undefined;

  const sample = (e: PointerEvent): PointerSample => ({ id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() });
  const isTouch = (e: PointerEvent) => e.pointerType === 'touch';

  const removeMenu = () => {
    menu?.remove();
    menu = undefined;
  };

  /**
   * The long-press menu: a small menu at the finger with what a companion view can do without a
   * keyboard – duplicate and delete. Its entries are finger-sized, and any other touch closes it.
   */
  const showMenu = (objectId: string, x: number, y: number) => {
    removeMenu();
    const st = useStore.getState();
    const o = st.objects.find((obj) => obj.id === objectId);
    if (!o) return;
    const el = document.createElement('div');
    el.className = 'touch-menu';
    el.setAttribute('data-testid', 'touch-menu');
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', `${o.name} actions`);
    const entry = (label: string, testId: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('data-testid', testId);
      b.setAttribute('role', 'menuitem');
      el.appendChild(b);
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeMenu();
        run();
      });
    };
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.addEventListener('pointerup', (ev) => ev.stopPropagation());
    el.addEventListener('pointermove', (ev) => ev.stopPropagation());
    el.addEventListener('pointercancel', (ev) => ev.stopPropagation());
    el.addEventListener('pointerleave', (ev) => ev.stopPropagation());
    el.addEventListener('pointerenter', (ev) => ev.stopPropagation());
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    entry('Duplicate', 'touch-menu-duplicate', () => {
      st.select([objectId]);
      void st.duplicateObjects([objectId]);
    });
    entry('Delete', 'touch-menu-delete', () => st.removeObjects([objectId]));
    // the menu lives in the room the canvas fills, so its position is the finger's, relative to it
    const rect = canvas.getBoundingClientRect();
    el.style.left = `${Math.min(Math.max(8, x - rect.left), Math.max(8, rect.width - 152))}px`;
    el.style.top = `${Math.min(Math.max(8, y - rect.top), Math.max(8, rect.height - 108))}px`;
    canvas.parentElement?.appendChild(el);
    menu = el;
  };

  /** The object under a touch point, selected or not. */
  const hitObject = (x: number, y: number) => {
    const hit = pickAt(refs, x, y, TOUCH_PICK_TOLERANCE);
    return hit ? { hit, ...objectOf(hit) } : undefined;
  };

  /** A press starts a drag when it lands on the one selected object (its picked instance). */
  const dragCandidate = (e: PointerEvent): { objectId: string; instanceId: string } | undefined => {
    const st = useStore.getState();
    if (st.view !== 'plater' || st.activeTool || st.selectedIds.length !== 1) return undefined;
    const p = hitObject(e.clientX, e.clientY);
    if (!p || p.objectId !== st.selectedIds[0]) return undefined;
    const o = st.objects.find((obj) => obj.id === p.objectId);
    const instanceId = p.instanceId ?? o?.instances[0]?.id;
    return instanceId ? { objectId: p.objectId, instanceId } : undefined;
  };

  const beginDrag = (e: PointerEvent, target: { objectId: string; instanceId: string }) => {
    const st = useStore.getState();
    const inst = st.objects.find((obj) => obj.id === target.objectId)?.instances.find((i) => i.id === target.instanceId);
    if (!inst) return;
    // the finger holds a point on the plate at the instance's bottom; the object follows that plane,
    // so moving by touch never changes its height
    const plane = inst.position[2];
    const start = planePointAt(refs, e.clientX, e.clientY, plane);
    if (!start) return;
    dragging = { ...target, plane, start, origin: [inst.position[0], inst.position[1], inst.position[2]] };
  };

  const moveDrag = (e: PointerEvent) => {
    if (!dragging) return;
    const point = planePointAt(refs, e.clientX, e.clientY, dragging.plane);
    if (!point) return;
    // free like the mouse's gizmo drag – the plater has no grid – so the model follows the finger
    const position: [number, number, number] = [
      dragging.origin[0] + point.x - dragging.start.x,
      dragging.origin[1] + point.y - dragging.start.y,
      dragging.origin[2],
    ];
    useStore.getState().updateInstance(dragging.objectId, dragging.instanceId, { position });
  };

  const endDrag = () => {
    if (!dragging) return;
    const { objectId } = dragging;
    dragging = undefined;
    // the plate rules of the mouse's drop: the instance lands on the bed, and the plate check marks it
    // red when it left the bed – a drag never silently pushes it back
    useStore.getState().dropToBed(objectId);
  };

  /**
   * A tap picks: an object selects (a volume selects the volume), an empty spot closes the open tool
   * and clears the selection exactly like a click on the floor.
   */
  const tapAt = (x: number, y: number) => {
    const st = useStore.getState();
    // the place-on-face tool works on the exact point of the mouse path, which a finger tap lacks
    if (st.activeTool === 'placeOnFace') return;
    const p = hitObject(x, y);
    if (p && p.objectId) {
      if (p.volumeId) {
        st.selectVolume(p.objectId, p.volumeId);
        return;
      }
      st.selectByClick(p.objectId, { ctrl: false, shift: false });
      if (p.instanceId) st.selectInstance(p.objectId, p.instanceId);
      return;
    }
    if (st.view !== 'plater') return;
    st.closeTool();
    st.select([]);
  };

  const run = (intents: GestureIntent[]) => {
    for (const intent of intents) {
      switch (intent.type) {
        case 'orbit':
          removeMenu();
          orbitByTouch(refs, intent.dx, intent.dy);
          break;
        case 'pinch':
          removeMenu();
          pinchByTouch(refs, intent.ratio, intent.dx, intent.dy);
          break;
        case 'dragStart':
          removeMenu();
          if (dragging) {
            // the dragged copy is the one the drop rules apply to, and one undo step covers the drag
            useStore.getState().selectInstance(dragging.objectId, dragging.instanceId);
            useStore.getState().recordHistory();
          }
          break;
        case 'dragMove':
          if (lastEvent) moveDrag(lastEvent);
          break;
        case 'dragEnd':
          endDrag();
          break;
        case 'doubleTap':
          removeMenu();
          options.frameAll();
          break;
        case 'longPress': {
          const p = hitObject(intent.x, intent.y);
          if (!p || !p.objectId) break;
          const st = useStore.getState();
          st.select([p.objectId]);
          if (p.instanceId) st.selectInstance(p.objectId, p.instanceId);
          showMenu(p.objectId, intent.x, intent.y);
          break;
        }
        case 'tap':
          removeMenu();
          tapAt(intent.x, intent.y);
          break;
      }
    }
  };

  const clearTimer = () => {
    if (!longPressTimer) return;
    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  };

  const down = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    // a finger that landed on a gizmo handle belongs to the gizmo, not to a gesture: TransformControls
    // ran its own handler first and is already dragging (rotate/scale have no gesture of their own)
    if (refs.transform.dragging) {
      removeMenu();
      clearTimer();
      return;
    }
    lastEvent = e;
    removeMenu();
    // the canvas takes the pointer, so a finger that slides off the model keeps orbiting; an event
    // without an active pointer (a synthetic one) has nothing to capture – that is not an error
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer for this id */
    }
    const drag = dragCandidate(e);
    run(gestures.down(sample(e), { drag: !!drag }));
    if (drag) beginDrag(e, drag);
    // the long press needs a timer of its own: the render loop is not what waits for it
    clearTimer();
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      run(gestures.tick(performance.now()));
    }, LONG_PRESS_TIMER_MS);
  };

  const move = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    lastEvent = e;
    run(gestures.move(sample(e)));
  };

  const up = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    lastEvent = e;
    clearTimer();
    run(gestures.up(sample(e)));
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  const cancel = (e: PointerEvent) => {
    if (!isTouch(e)) return;
    lastEvent = e;
    clearTimer();
    run(gestures.cancel(sample(e)));
  };

  const stop = () => {
    clearTimer();
    gestures.reset();
    dragging = undefined;
    removeMenu();
  };

  return { down, move, up, cancel, stop };
}
