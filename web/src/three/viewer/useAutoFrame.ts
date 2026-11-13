/**
 * The guided start's automatic framing (T-101) on the screen that has a scene blocker: the phone's
 * bottom sheet and, since T-106, the floating card over the wide window's 3D view. Whenever a model is
 * added, a guided step changes or the blocker settles, plate and every object are framed into the room
 * above it. In the Preview it frames the plate and the toolpaths together (T-103). A camera the user
 * moved by hand is never taken away from them – Home gives it back to the automatic framing.
 *
 * "By hand" is per view (T-104): a camera the user moved in the Plater was about the plate, not the
 * result, so opening the Preview starts the automatic framing fresh. A move in the Preview itself
 * ends it until Home, as before.
 *
 * The blocker's height follows its card, so the frame waits for the drag or the 180 ms transition to
 * settle before it measures the room the scene has left. A blocker that leaves too little room to
 * frame leaves the last framing in place: nothing jumps.
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useStore } from '../../state/store';
import { framingBand, sceneBlocker } from './camera';
import type { CamRequest, SceneRefs } from './types';

/** Longer than the sheet's 180 ms transition, so the band is measured at its final height. */
const SETTLE_MS = 240;

/**
 * `phone` is the phone's sheet; on a wide window the floating card (T-106) is the blocker, and the
 * framing has to follow it while the flow is open. Either blocker present is enough to frame in a
 * band, and the band itself (`framingBand`) decides which one it measured.
 */
export function useAutoFrame(
  refsRef: RefObject<SceneRefs | null>,
  requestCamera: (req: CamRequest) => void,
  phone: boolean,
  guidedCard: boolean,
) {
  const view = useStore((s) => s.view);
  const objectCount = useStore((s) => s.objects.length);
  const flowStep = useStore((s) => s.flowStep);
  const sheetState = useStore((s) => s.sheetState);
  // the Preview's framing waits for the result: the plate and the toolpaths have to fit together
  const hasGcode = useStore((s) => !!s.gcode);
  const lastView = useRef(view);

  // entering the Preview starts the automatic framing fresh: a camera move in the Plater says
  // nothing about the result (T-104). Runs before the scheduling effect below on the same commit.
  useEffect(() => {
    if (view === lastView.current) return;
    lastView.current = view;
    const refs = refsRef.current;
    if ((phone || guidedCard) && view === 'preview' && refs) refs.userMoved = false;
  }, [phone, guidedCard, view, refsRef]);

  useEffect(() => {
    if (!(phone || guidedCard) || (view !== 'plater' && view !== 'preview')) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const refs = refsRef.current;
        if (!refs || refs.userMoved) return;
        // a blocker that leaves no room to frame: keep the last framing instead of fitting the
        // whole canvas, which would put the result behind the sheet or the card
        if (!framingBand(refs)) return;
        requestCamera({ mode: 'scene' });
      }, SETTLE_MS);
    };
    // the same element changes height with a step's card, the drag's position and the card's content
    const blocker = sceneBlocker();
    const observer = blocker ? new ResizeObserver(schedule) : undefined;
    if (blocker && observer) observer.observe(blocker);
    // a resized window moves the card and changes the room above it, so the band has to be measured
    // again even when nothing about the blocker's own size changed
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [phone, guidedCard, view, objectCount, flowStep, sheetState, hasGcode, refsRef, requestCamera]);
}
