/**
 * The transform gizmo (R-7): which node the Move/Rotate/Scale gizmo drives, and whether it is shown
 * at all. Moved out of `Viewer.tsx` verbatim. It was the tail of the objects sync effect; it is its
 * own effect now and runs right after it, so the nodes it looks up are the ones just synced.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import type * as THREE from 'three';
import { selectedInstance, type PlaterObject } from '../../state/store';
import { type PaintKind } from '../paint';
import type { State, View } from '../../state/types';
import type { SceneRefs } from './types';

export interface GizmoOptions {
  objects: PlaterObject[];
  selectedIds: string[];
  selectedVolumeId?: string;
  selectedInstanceId?: string;
  transformMode: State['transformMode'];
  view: View;
  paintMode?: PaintKind;
}

export function useGizmo(refsRef: RefObject<SceneRefs | null>, options: GizmoOptions) {
  const { objects, selectedIds, selectedVolumeId, selectedInstanceId, transformMode, view, paintMode } = options;
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    // transform gizmo
    let target: THREE.Object3D | undefined;
    if (selectedIds.length === 1 && view === 'plater' && !paintMode) {
      const o = objects.find((x) => x.id === selectedIds[0]);
      const node = refs.nodes.get(selectedIds[0]);
      if (node && o) {
        // the gizmo drives the selected instance; its volumes stay children of it
        const inode = node.instances.get(selectedInstance({ selectedIds, selectedInstanceId }, o).id);
        target = selectedVolumeId ? inode?.volumes.get(selectedVolumeId) || inode?.group || node.group : inode?.group || node.group;
      }
    }
    if (target) {
      if (refs.transform.object !== target) refs.transform.attach(target);
      refs.transform.setMode(transformMode);
      refs.transform.getHelper().visible = true;
      refs.transform.enabled = true;
    } else {
      refs.transform.detach();
      refs.transform.getHelper().visible = false;
      refs.transform.enabled = false;
    }
  }, [objects, selectedIds, selectedVolumeId, selectedInstanceId, transformMode, view, paintMode]);
}
