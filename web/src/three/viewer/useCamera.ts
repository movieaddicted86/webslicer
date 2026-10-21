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
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useStore } from '../../state/store';
import { viewDirection } from '../../plater/camera';
import { DEFAULT_BED, bedBox, focusBox, frameBox, readOrthoPref, switchCamera, writeOrthoPref } from './camera';
import type { CamRequest, SceneRefs } from './types';

export interface CameraState {
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
  return {
    ortho,
    request,
    toggleOrtho: () => setOrtho((o) => !o),
    requestCamera: (req: CamRequest) => setRequest({ req, seq: ++seq.current }),
  };
}

export function useCamera(refsRef: RefObject<SceneRefs | null>, ortho: boolean, request: CameraState['request']) {
  // --- perspective / orthographic (PrusaSlicer's K)
  useEffect(() => {
    writeOrthoPref(ortho);
    const refs = refsRef.current;
    if (refs) switchCamera(refs, ortho);
  }, [ortho]);

  // --- camera commands: standard views, zoom to selection, fit the bed
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs || !request) return;
    const shape = useStore.getState().presets.printer.current.bed_shape || DEFAULT_BED;
    if (request.req.mode === 'bed') {
      const { dir, up } = viewDirection('iso');
      frameBox(refs, bedBox(shape), dir, up);
      return;
    }
    if (request.req.mode === 'view') {
      const { dir, up } = viewDirection(request.req.view);
      frameBox(refs, focusBox(refs, shape), dir, up);
      return;
    }
    // zoom to selection keeps the direction the user is looking from
    const offset = refs.camera.position.clone().sub(refs.controls.target);
    frameBox(refs, focusBox(refs, shape), offset.normalize(), refs.camera.up.clone());
  }, [request]);
}
