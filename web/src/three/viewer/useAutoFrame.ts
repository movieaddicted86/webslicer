/**
 * The phone's automatic framing (T-101): whenever a model is added, a guided step changes or the
 * sheet settles, plate and every object are framed into the room above the sheet. In the Preview it
 * frames the plate and the toolpaths together (T-103). A camera the user moved by hand is never taken
 * away from them – Home gives it back to the automatic framing.
 *
 * The sheet's height follows its card, so the frame waits for the drag or the 180 ms transition to
 * settle before it measures the room the scene has left.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useStore } from '../../state/store';
import type { CamRequest, SceneRefs } from './types';

/** Longer than the sheet's 180 ms transition, so the band is measured at its final height. */
const SETTLE_MS = 240;

export function useAutoFrame(refsRef: RefObject<SceneRefs | null>, requestCamera: (req: CamRequest) => void, phone: boolean) {
  const view = useStore((s) => s.view);
  const objectCount = useStore((s) => s.objects.length);
  const flowStep = useStore((s) => s.flowStep);
  const sheetState = useStore((s) => s.sheetState);
  // the Preview's framing waits for the result: the plate and the toolpaths have to fit together
  const hasGcode = useStore((s) => !!s.gcode);

  useEffect(() => {
    if (!phone || (view !== 'plater' && view !== 'preview')) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const refs = refsRef.current;
        if (!refs || refs.userMoved) return;
        requestCamera({ mode: 'scene' });
      }, SETTLE_MS);
    };
    // the same sheet element changes height with a step's card and with the drag's position
    const stack = document.querySelector('.context-stack');
    const observer = stack ? new ResizeObserver(schedule) : undefined;
    if (stack && observer) observer.observe(stack);
    schedule();
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [phone, view, objectCount, flowStep, sheetState, hasGcode, refsRef, requestCamera]);
}
