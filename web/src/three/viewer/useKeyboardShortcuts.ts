/**
 * The window `keydown` handler (R-7). Every branch is matched through the shared shortcut table
 * (`./shortcuts`), which the About dialog reads as well.
 *
 * The handler is registered once and reads the store through `useStore.getState()`, so it never holds
 * a stale closure and never re-registers. `onCamera` is the viewer's own camera command; the effect
 * keeps the empty dependency array the inline version had, so `onCamera`/`setOrtho` are read through
 * refs rather than closing over them.
 */
import { useEffect, useRef } from 'react';
import { useStore, pickedInstanceId } from '../../state/store';
import { matchesShortcut, shortcutsBlocked } from './shortcuts';
import { viewByKey } from '../../plater/camera';
import type { CamRequest } from './types';

export function useKeyboardShortcuts(onCamera: (req: CamRequest) => void, toggleOrtho: () => void) {
  // the handler is registered once; the callbacks live in refs so the effect can stay `[]`
  const cameraRef = useRef(onCamera);
  const orthoRef = useRef(toggleOrtho);
  cameraRef.current = onCamera;
  orthoRef.current = toggleOrtho;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      // B10: the single guard – a modal dialog or a focused field means no shortcut at all
      if (shortcutsBlocked(e, !!st.dialog)) return;
      // the camera keys work in the plater and in the preview
      if (matchesShortcut(e, 'views')) {
        e.preventDefault();
        const view = viewByKey(e.key);
        if (view) cameraRef.current({ mode: 'view', view });
        return;
      }
      if (matchesShortcut(e, 'projection')) {
        e.preventDefault();
        orthoRef.current();
        return;
      }
      if (matchesShortcut(e, 'zoom')) {
        e.preventDefault();
        cameraRef.current({ mode: 'fit' });
        return;
      }
      if (st.view !== 'plater') return;
      if (matchesShortcut(e, 'delete')) {
        const o = st.objects.find((x) => x.id === st.selectedIds[0]);
        if (st.selectedVolumeId && st.selectedIds.length === 1) st.removeVolume(st.selectedIds[0], st.selectedVolumeId);
        // AC-4.4: Del removes the instance that was picked; without one the whole object goes
        else if (st.selectedIds.length === 1 && o && pickedInstanceId(st, o) && o.instances.length > 1)
          st.removeInstance(o.id, st.selectedInstanceId);
        else if (st.selectedIds.length) st.removeObjects(st.selectedIds);
      } else if (matchesShortcut(e, 'addInstance')) {
        if (st.selectedIds.length === 1) st.addInstances(st.selectedIds[0]);
      } else if (matchesShortcut(e, 'removeInstance')) {
        // AC-1.2: "−" always drops the last copy
        if (st.selectedIds.length === 1) st.removeInstance(st.selectedIds[0]);
      } else if (matchesShortcut(e, 'paintSupports') && st.selectedIds.length === 1) {
        if (st.paintMode === 'supports') st.stopPaint();
        else void st.startPaint(st.selectedIds[0], 'supports');
      } else if (matchesShortcut(e, 'paintSeam') && st.selectedIds.length === 1) {
        if (st.paintMode === 'seam') st.stopPaint();
        else void st.startPaint(st.selectedIds[0], 'seam');
      } else if (matchesShortcut(e, 'placeOnFace')) st.setPlaceOnFace(!st.placeOnFace);
      else if (matchesShortcut(e, 'cut')) {
        // T-044: the panel of the single selected instance; C closes it again
        if (st.cutOpen) st.closeCut();
        else if (st.selectedIds.length === 1) st.openCut();
      } else if (matchesShortcut(e, 'move')) st.setTransformMode('translate');
      else if (matchesShortcut(e, 'rotate')) st.setTransformMode('rotate');
      else if (matchesShortcut(e, 'scale')) st.setTransformMode('scale');
      else if (matchesShortcut(e, 'undo')) {
        e.preventDefault();
        st.undo();
      } else if (matchesShortcut(e, 'redo')) {
        e.preventDefault();
        st.redo();
      } else if (matchesShortcut(e, 'rename')) {
        // T-042: rename the single selected object; the objects list opens the inline field
        if (st.selectedIds.length === 1) {
          e.preventDefault();
          st.requestRename(st.selectedIds[0]);
        }
      } else if (matchesShortcut(e, 'selectAll')) {
        e.preventDefault();
        st.select(st.objects.map((o) => o.id));
      } else if (matchesShortcut(e, 'arrangeSelection')) st.arrangeSelection();
      else if (matchesShortcut(e, 'arrange')) st.arrange();
      else if (matchesShortcut(e, 'escape')) {
        if (st.paintMode) st.stopPaint();
        else if (st.placeOnFace) st.setPlaceOnFace(false);
        else if (st.cutOpen) st.closeCut();
        else st.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
