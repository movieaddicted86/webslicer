/**
 * The window `keydown` handler (R-7). Every branch is matched through the shared shortcut table
 * (`./shortcuts`), which the About dialog reads as well.
 *
 * The handler is registered once and reads the store through `useStore.getState()`, so it never holds
 * a stale closure and never re-registers. `onCamera` is the viewer's own camera command; the effect
 * keeps the empty dependency array the inline version had, so `onCamera`/`setOrtho` are read through
 * refs rather than closing over them. The refs are refreshed in a layout effect: writing them during
 * render is a side effect the React Compiler (and the `react-hooks/refs` rule) rejects.
 */
import { useLayoutEffect, useEffect, useRef } from 'react';
import { useStore, pickedInstanceId } from '../../state/store';
import { matchesShortcut, shortcutsBlocked } from './shortcuts';
import { toolForShortcut } from '../../tools/registry';
import { viewByKey } from './cameraMath';
import type { CamRequest } from './types';

export function useKeyboardShortcuts(onCamera: (req: CamRequest) => void, toggleOrtho: () => void) {
  // the handler is registered once; the callbacks live in refs so the effect can stay `[]`
  const cameraRef = useRef(onCamera);
  const orthoRef = useRef(toggleOrtho);
  useLayoutEffect(() => {
    cameraRef.current = onCamera;
    orthoRef.current = toggleOrtho;
  });

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
      } else if (toolForShortcut(e)) {
        // T-046: every tool key comes from the registry; an open tool is toggled off by its own key
        const tool = toolForShortcut(e);
        if (tool) st.openTool(tool.id);
      } else if (matchesShortcut(e, 'undo')) {
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
        // T-046: Esc closes the open tool and puts the plater back into normal mode
        if (st.activeTool) st.closeTool();
        else st.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
