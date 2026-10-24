import { useStore, type PlaterObject } from '../../state/store';

/** The selected objects, in the order of the object list. */
export function useSelectedObjects(): PlaterObject[] {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  return objects.filter((o) => selectedIds.includes(o.id));
}
