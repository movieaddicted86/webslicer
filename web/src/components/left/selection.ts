import { useStore, pickedInstanceId, type PlaterObject } from '../../state/store';

/** The selected objects, in the order of the object list. */
export function useSelectedObjects(): PlaterObject[] {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  return objects.filter((o) => selectedIds.includes(o.id));
}

/**
 * What Del (and the 🗑 button) removes: the selected sub-volume, otherwise the instance that was
 * picked, otherwise the selected objects – the same rule in Simple mode and in the object list.
 */
export function useDeleteSelection(): () => void {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const removeObjects = useStore((s) => s.removeObjects);
  const removeVolume = useStore((s) => s.removeVolume);
  const removeInstance = useStore((s) => s.removeInstance);
  return () => {
    const selected = objects.filter((o) => selectedIds.includes(o.id));
    const selectedVolume = selected.length === 1 ? selected[0].volumes.find((v) => v.id === selectedVolumeId) : undefined;
    // an instance counts as picked only when clicking it in the view or its row selected it explicitly
    const picked = selected.length === 1 ? pickedInstanceId({ selectedIds, selectedInstanceId }, selected[0]) : undefined;
    if (selectedVolume && selected.length === 1) removeVolume(selected[0].id, selectedVolume.id);
    // AC-4.4: Del removes the instance that was picked; without one the whole object goes
    else if (selected.length === 1 && picked && selected[0].instances.length > 1) removeInstance(selected[0].id, picked);
    else removeObjects(selectedIds);
  };
}

/** "+", "−" and the copy count they work on (the selected object's instances). */
export function useInstanceActions(): { addInstance: () => void; removeOneInstance: () => void; instanceCount: number } {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const addInstances = useStore((s) => s.addInstances);
  const removeInstance = useStore((s) => s.removeInstance);
  const selected = objects.filter((o) => selectedIds.includes(o.id));
  return {
    addInstance: () => {
      if (selected.length === 1) addInstances(selected[0].id);
    },
    removeOneInstance: () => {
      // AC-1.2: "−" always drops the last copy, whatever is selected
      if (selected.length === 1) removeInstance(selected[0].id);
    },
    instanceCount: selected.length === 1 ? selected[0].instances.length : 0,
  };
}
