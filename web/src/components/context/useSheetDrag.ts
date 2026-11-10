import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import { FLING_VELOCITY, settleSheetState, type SheetHeights, type SheetState } from '../../state/store';

/** The drag handle's height when the stylesheet cannot tell (it is a finger-sized 44 px). */
const FALLBACK_HANDLE = 44;
/** The stylesheet's settle ease length; the inline px is handed back once it is over. */
const SETTLE_MS = 180;
/** A finger has to travel this far before the gesture is a drag and not a tap. */
const TAP_SLOP = 6;
/** The window of pointer samples the fling velocity is read from. */
const FLING_SAMPLES = 6;

interface Drag {
  pointerId: number;
  startY: number;
  startHeight: number;
  height: number;
  heights: SheetHeights;
  samples: Array<{ y: number; t: number }>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The rate the sheet's height changes, in px/ms (positive = the sheet grows). */
function velocityOf(samples: Drag['samples']): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  return dt > 0 ? -(last.y - first.y) / dt : 0;
}

/** The four heights of the sheet in px, measured from the rendered sheet and the stylesheet. */
function measure(stack: HTMLElement, lastFooter: RefObject<number>): SheetHeights {
  const style = getComputedStyle(stack);
  const gap = parseFloat(style.rowGap) || 0;
  const handle = stack.querySelector<HTMLElement>('.sheet-handle');
  const handleH = handle?.getBoundingClientRect().height || FALLBACK_HANDLE;
  const footer = stack.querySelector<HTMLElement>('.context-footer');
  const measured = footer?.getBoundingClientRect().height ?? 0;
  // at `hidden` the footer is not laid out, so the last height seen while it was is the one to use
  if (measured > 0) lastFooter.current = measured;
  const footerH = lastFooter.current;
  // the stylesheet sizes the half sheet to 34vh of the window, and the full one by its max-height
  const halfCard = 0.34 * window.innerHeight;
  const maxHeight = parseFloat(style.maxHeight);
  const sceneH = stack.parentElement?.getBoundingClientRect().height ?? stack.getBoundingClientRect().height;
  return {
    hidden: handleH,
    peek: handleH + gap + footerH,
    half: handleH + gap + halfCard + gap + footerH,
    full: Number.isFinite(maxHeight) ? maxHeight : sceneH,
  };
}

export interface SheetDrag {
  /** true while a finger holds the sheet: the stack follows the finger instead of its position */
  dragging: boolean;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  /** true when the gesture that just ended was a drag; the handle then skips its tap cycle */
  consumeDrag: () => boolean;
}

/**
 * Dragging the phone's context sheet (T-099): the top edge follows the finger one-to-one, and on
 * release the sheet settles on the nearest of hidden / peek / half / full – or on the next one in the
 * direction of a fling – with a short ease. The grip and the card's header call this; the card's body
 * keeps scrolling on its own, so the two do not fight.
 *
 * The heights are measured when a drag starts (the footer grows with a running job or a warning), and
 * the last footer height is remembered for the hidden position, where the footer is not laid out.
 */
export function useSheetDrag(stackRef: RefObject<HTMLDivElement | null>, setState: (state: SheetState) => void): SheetDrag {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const footerHeight = useRef(0);
  const dragged = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const stack = stackRef.current;
    if (!stack || !e.isPrimary || e.button !== 0) return;
    // a press on a control in the header is that control's; only the header's own room drags
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    const rect = stack.getBoundingClientRect();
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: rect.height,
      height: rect.height,
      heights: measure(stack, footerHeight),
      samples: [{ y: e.clientY, t: performance.now() }],
    };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    // the sheet keeps the height it has while the full layout is laid out under it
    stack.style.height = `${rect.height}px`;
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const stack = stackRef.current;
    if (!d || !stack || e.pointerId !== d.pointerId) return;
    const height = clamp(d.startHeight + (d.startY - e.clientY), d.heights.hidden, d.heights.full);
    d.height = height;
    stack.style.height = `${height}px`;
    d.samples.push({ y: e.clientY, t: performance.now() });
    if (d.samples.length > FLING_SAMPLES) d.samples.shift();
    if (Math.abs(e.clientY - d.startY) > TAP_SLOP) dragged.current = true;
  };

  const end = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    const stack = stackRef.current;
    setDragging(false);
    // a tap (or a press that never moved) is not a drag: the press only pinned the height, so hand it
    // back and let the handle's own click cycle the sheet – no settle, no state write, no timers
    if (!dragged.current) {
      if (stack) stack.style.height = '';
      return;
    }
    const velocity = cancelled ? 0 : velocityOf(d.samples);
    const target = settleSheetState(d.height, velocity, d.heights, FLING_VELOCITY);
    setState(target);
    if (!stack) return;
    // the eased settle: the height is a px value on both sides of the step, so it animates; the
    // position's own layout takes over again once the ease is over (and holds the same height).
    // Reduced motion is the stylesheet's: it disables the transition, so this jump is instant.
    requestAnimationFrame(() => {
      stack.style.height = `${d.heights[target]}px`;
    });
    window.setTimeout(() => {
      if (drag.current) return;
      stack.style.height = '';
    }, SETTLE_MS + 40);
  };

  const consumeDrag = () => {
    const moved = dragged.current;
    dragged.current = false;
    return moved;
  };

  return {
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp: (e) => end(e, false),
    onPointerCancel: (e) => end(e, true),
    consumeDrag,
  };
}
