/**
 * The camera side of the viewer (R-7): which projection is active, the remembered preference and the
 * commands a key or a toolbar button sends.
 *
 * Two hooks rather than one, because the effects have to stay registered *after* the scene-init
 * effect while the callbacks are needed before it: the projection effect switches the camera of the
 * scene the init effect has just built, so a remembered "ortho" is applied on the first mount. The
 * state therefore lives in `useCameraState` (called with the other state, before the toolbar and the
 * keyboard hook) and the effects in `useCamera` (called where the inline effects were).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useStore } from '../../state/store';
import { viewDirection } from './cameraMath';
import {
  DEFAULT_BED,
  bedBox,
  focusBox,
  frameBox,
  readOrthoPref,
  sceneBox,
  switchCamera,
  turnCamera,
  visibleBandOf,
  writeOrthoPref,
} from './camera';
import type { CamRequest, SceneRefs } from './types';

/** The width below which the sheet owns the lower part of the scene (the same as the stylesheet). */
const PHONE_QUERY = '(max-width: 640px)';

/** The room above the phone's sheet; nothing on a wide window, where the cards sit beside the scene. */
function bandOf(refs: SceneRefs) {
  return window.matchMedia(PHONE_QUERY).matches ? visibleBandOf(refs) : undefined;
}
interface CameraState {
  /** true while the orthographic projection is active */
  ortho: boolean;
  /** the last command with its sequence number; the counter makes a repeated command re-run */
  request: { req: CamRequest; seq: number } | undefined;
  /** flip perspective/orthographic (the `K` key and the toolbar button) */
  toggleOrtho: () => void;
  /** ask the camera for a standard view, to fit the selection or to fit the bed */
  requestCamera: (req: CamRequest) => void;
}

export function useCameraState(): CameraState {
  /** perspective or orthographic – remembered across sessions */
  const [ortho, setOrtho] = useState(readOrthoPref);
  const [request, setRequest] = useState<CameraState['request']>(undefined);
  const seq = useRef(0);
  // stable callbacks: the automatic framing effect depends on `requestCamera` and must not re-run on
  // every render of the viewer
  const toggleOrtho = useCallback(() => setOrtho((o) => !o), []);
  const requestCamera = useCallback((req: CamRequest) => setRequest({ req, seq: ++seq.current }), [setRequest]);
  return { ortho, request, toggleOrtho, requestCamera };
}

export function useCamera(refsRef: RefObject<SceneRefs | null>, ortho: boolean, request: CameraState['request']) {
  // --- perspective / orthographic (PrusaSlicer's K)
  useEffect(() => {
    writeOrthoPref(ortho);
    const refs = refsRef.current;
    if (refs) switchCamera(refs, ortho);
    // `refsRef` is a stable ref object owned by the Viewer; its content changes without a re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable ref, not a dependency
  }, [ortho]);

  // --- camera commands: standard views, zoom to selection, fit the bed, the automatic framing
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs || !request) return;
    const shape = useStore.getState().presets.printer.current.bed_shape || DEFAULT_BED;
    const band = bandOf(refs);
    if (request.req.mode === 'bed') {
      // Home frames the plate again, so it ends an earlier manual view: sheet changes may reframe
      refs.userMoved = false;
      const { dir, up } = viewDirection('iso');
      frameBox(refs, bedBox(shape), dir, up, band);
      return;
    }
    if (request.req.mode === 'scene') {
      // the automatic framing (a model was added, a guided step changed, the sheet settled): keep the
      // direction the user is looking from and show plate and all objects in the room above the sheet
      const current = refs.camera.position.clone().sub(refs.controls.target);
      const { dir, up } = current.lengthSq() > 1e-9 ? { dir: current.normalize(), up: refs.camera.up.clone() } : viewDirection('iso');
      frameBox(refs, sceneBox(refs, shape), dir, up, band);
      return;
    }
    // every other command is the user's own view: automatic framing leaves it alone from now on
    refs.userMoved = true;
    if (request.req.mode === 'view') {
      const { dir, up } = viewDirection(request.req.view);
      frameBox(refs, focusBox(refs, shape), dir, up, band);
      return;
    }
    if (request.req.mode === 'turn') {
      // the phone's turn buttons: quarter turns around the vertical axis at the same elevation and
      // distance, so the framing of the model stays and only the side changes
      turnCamera(refs, request.req.turns);
      return;
    }
    // zoom to selection keeps the direction the user is looking from
    const offset = refs.camera.position.clone().sub(refs.controls.target);
    frameBox(refs, focusBox(refs, shape), offset.normalize(), refs.camera.up.clone(), band);
    // `refsRef` is a stable ref object owned by the Viewer; its content changes without a re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable ref, not a dependency
  }, [request]);
}
