/**
 * The touch gestures of the 3D view as a pure state machine: it takes pointer samples and returns
 * what the scene should do, so the rules (tap vs drag threshold, double tap, long press, one finger
 * orbit, two finger pinch and pan) are unit-testable without WebGL or React.
 *
 * The machine knows nothing about the camera or the scene: a press that lands on an already selected
 * object is handed in as a *drag* candidate (`down(…, { drag: true })`) after the caller's own hit
 * test, and every other intent is applied by the viewer (`touchCamera.ts` and `useScene`).
 *
 * Only touch pointers reach the machine; the mouse keeps OrbitControls and the existing click path.
 */

/** One pointer as the DOM reports it, in CSS pixels relative to the viewport. */
export interface PointerSample {
  /** `PointerEvent.pointerId` */
  id: number;
  x: number;
  y: number;
  /** milliseconds, monotonic (`performance.now()`) */
  time: number;
}

/** What a finger did. The coordinates are CSS pixels of the event. */
export type GestureIntent =
  | { type: 'tap'; x: number; y: number }
  | { type: 'doubleTap'; x: number; y: number }
  | { type: 'longPress'; x: number; y: number }
  | { type: 'orbit'; dx: number; dy: number }
  | { type: 'dragStart' }
  | { type: 'dragMove'; dx: number; dy: number }
  | { type: 'dragEnd' }
  /** two fingers: `ratio` > 1 means they moved apart (zoom in), and the midpoint moved by `dx`/`dy` */
  | { type: 'pinch'; ratio: number; dx: number; dy: number; x: number; y: number };

export interface GestureOptions {
  /** movement in CSS px after which a press is a drag (or an orbit) instead of a tap */
  dragThreshold?: number;
  /** how long a motionless press stays a press before it becomes a long press */
  longPressMs?: number;
  /** two taps closer than this in time count as a double tap */
  doubleTapMs?: number;
  /** … and closer than this in space */
  doubleTapSlop?: number;
}

export const TOUCH_DRAG_THRESHOLD = 12;
export const TOUCH_LONG_PRESS_MS = 500;
export const TOUCH_DOUBLE_TAP_MS = 320;
export const TOUCH_DOUBLE_TAP_SLOP = 24;

type Mode = 'idle' | 'press' | 'orbit' | 'drag' | 'pinch';

interface Tap {
  x: number;
  y: number;
  time: number;
}

/** The gesture machine; one instance per canvas. */
export class TouchGestures {
  private readonly threshold: number;
  private readonly longPressMs: number;
  private readonly doubleTapMs: number;
  private readonly doubleTapSlop: number;
  private readonly pointers = new Map<number, PointerSample>();
  private mode: Mode = 'idle';
  private start?: PointerSample;
  private last?: PointerSample;
  /** the finger that started the stroke: one-finger gestures follow it while a second finger pinches */
  private primaryId?: number;
  private drag = false;
  private longPressFired = false;
  private pinch?: { distance: number; x: number; y: number };
  private lastTap?: Tap;

  constructor(options: GestureOptions = {}) {
    this.threshold = options.dragThreshold ?? TOUCH_DRAG_THRESHOLD;
    this.longPressMs = options.longPressMs ?? TOUCH_LONG_PRESS_MS;
    this.doubleTapMs = options.doubleTapMs ?? TOUCH_DOUBLE_TAP_MS;
    this.doubleTapSlop = options.doubleTapSlop ?? TOUCH_DOUBLE_TAP_SLOP;
  }

  /** A finger went down; `drag` when the caller's hit test put it on an already selected object. */
  down(p: PointerSample, options: { drag?: boolean } = {}): GestureIntent[] {
    this.pointers.set(p.id, p);
    if (this.pointers.size === 1) {
      this.mode = 'press';
      this.start = p;
      this.last = p;
      this.primaryId = p.id;
      this.drag = !!options.drag;
      this.longPressFired = false;
      return [];
    }
    if (this.pointers.size === 2) {
      // the second finger turns the stroke into a pinch: no tap, no long press, and a drag ends where
      // the finger left the object
      const out: GestureIntent[] = [];
      if (this.mode === 'drag') out.push({ type: 'dragEnd' });
      this.longPressFired = true;
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: distance(a, b), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return out;
    }
    // a third finger is ignored: the first two decide the pinch
    return [];
  }

  move(p: PointerSample): GestureIntent[] {
    if (!this.pointers.has(p.id)) return [];
    this.pointers.set(p.id, p);
    if (this.mode === 'pinch') return this.pinchMove();
    if (p.id !== this.primaryId) return [];
    if (this.mode === 'press') {
      if (!this.start) return [];
      if (Math.hypot(p.x - this.start.x, p.y - this.start.y) <= this.threshold) return [];
      const fromStart = { dx: p.x - this.start.x, dy: p.y - this.start.y };
      this.mode = this.drag ? 'drag' : 'orbit';
      this.last = p;
      return this.drag ? [{ type: 'dragStart' }, { type: 'dragMove', ...fromStart }] : [{ type: 'orbit', ...fromStart }];
    }
    const last = this.last;
    this.last = p;
    if (!last) return [];
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx === 0 && dy === 0) return [];
    return [this.mode === 'drag' ? { type: 'dragMove', dx, dy } : { type: 'orbit', dx, dy }];
  }

  /** A finger left the canvas. `time` is the release time, which decides double taps. */
  up(p: PointerSample): GestureIntent[] {
    if (!this.pointers.has(p.id)) return [];
    this.pointers.delete(p.id);
    const out: GestureIntent[] = [];
    if (this.mode === 'pinch') {
      if (this.pointers.size === 1) {
        // one finger stays: it orbits again from where it is, nothing is tapped
        const [rest] = [...this.pointers.values()];
        this.primaryId = rest.id;
        this.last = rest;
        this.mode = 'orbit';
      } else {
        this.mode = 'idle';
      }
      this.pinch = undefined;
      return out;
    }
    if (p.id !== this.primaryId) {
      this.mode = 'idle';
      return out;
    }
    if (this.mode === 'drag') {
      out.push({ type: 'dragEnd' });
      this.mode = 'idle';
      return out;
    }
    if (this.mode === 'press' && !this.longPressFired) {
      const tap: Tap = { x: p.x, y: p.y, time: p.time };
      const previous = this.lastTap;
      this.lastTap = tap;
      if (
        previous &&
        tap.time - previous.time <= this.doubleTapMs &&
        Math.hypot(tap.x - previous.x, tap.y - previous.y) <= this.doubleTapSlop
      ) {
        this.lastTap = undefined;
        out.push({ type: 'doubleTap', x: p.x, y: p.y });
      } else {
        out.push({ type: 'tap', x: p.x, y: p.y });
      }
    }
    this.mode = 'idle';
    return out;
  }

  /** The browser took the pointer away (a scroll, a system gesture): the stroke ends, without a tap. */
  cancel(p: PointerSample): GestureIntent[] {
    if (!this.pointers.has(p.id)) return [];
    this.pointers.delete(p.id);
    const out: GestureIntent[] = this.mode === 'drag' ? [{ type: 'dragEnd' } as GestureIntent] : [];
    if (this.pointers.size === 0) {
      this.mode = 'idle';
      this.pinch = undefined;
    } else if (this.mode === 'pinch') {
      const [rest] = [...this.pointers.values()];
      this.primaryId = rest.id;
      this.last = rest;
      this.mode = 'orbit';
      this.pinch = undefined;
    }
    return out;
  }

  /**
   * The timer side of the long press (called from an animation tick): after `longPressMs` without
   * movement the press becomes a long press, and the release that follows is not a tap.
   */
  tick(now: number): GestureIntent[] {
    if (this.mode !== 'press' || this.longPressFired || !this.start) return [];
    if (now - this.start.time < this.longPressMs) return [];
    this.longPressFired = true;
    return [{ type: 'longPress', x: this.start.x, y: this.start.y }];
  }

  /** Forget every finger (the view unmounted or the window lost focus). */
  reset(): void {
    this.pointers.clear();
    this.mode = 'idle';
    this.start = undefined;
    this.last = undefined;
    this.primaryId = undefined;
    this.pinch = undefined;
    this.drag = false;
    this.longPressFired = false;
    this.lastTap = undefined;
  }

  /** The mode, for the unit tests and the debugging state. */
  get state(): Mode {
    return this.mode;
  }

  private pinchMove(): GestureIntent[] {
    if (this.pointers.size < 2 || !this.pinch) return [];
    const [a, b] = [...this.pointers.values()];
    const next = { distance: distance(a, b), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const previous = this.pinch;
    this.pinch = next;
    // a sub-pixel move and a zoom change below 0.5 % are jitter, not a gesture
    const ratio = previous.distance > 0 ? next.distance / previous.distance : 1;
    if (Math.abs(ratio - 1) < 0.005 && Math.hypot(next.x - previous.x, next.y - previous.y) < 0.5) return [];
    return [{ type: 'pinch', ratio, dx: next.x - previous.x, dy: next.y - previous.y, x: next.x, y: next.y }];
  }
}

const distance = (a: PointerSample, b: PointerSample): number => Math.hypot(a.x - b.x, a.y - b.y);
