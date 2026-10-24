/**
 * What the tool strip's object commands do (layout 3.0, L-4). The strip and the object list show the
 * same rules (`stripCommands.ts`); the actions live here, once, so the strip's buttons and the Del /
 * + / − / A shortcuts cannot disagree with them.
 *
 * The selection rule for Del is the one the object list always had: remove the picked volume, else the
 * picked instance of a multi-instance object, else the selected objects.
 */
import { useStore, pickedInstanceId } from '../state/store';
import type { StripCommand } from './stripCommands';

/** Del: the picked volume, else the picked instance, else the selected objects. */
export function deleteSelection(): void {
  const st = useStore.getState();
  const selected = st.objects.filter((o) => st.selectedIds.includes(o.id));
  if (!selected.length) return;
  const volume = selected.length === 1 ? selected[0].volumes.find((v) => v.id === st.selectedVolumeId) : undefined;
  if (volume && selected.length === 1) {
    st.removeVolume(selected[0].id, volume.id);
    return;
  }
  // the instance counts as picked only when a click in the view or on its row selected it
  const picked = selected.length === 1 ? pickedInstanceId(st, selected[0]) : undefined;
  if (selected.length === 1 && picked && selected[0].instances.length > 1) st.removeInstance(selected[0].id, picked);
  else st.removeObjects(st.selectedIds);
}

/** "+": one more copy of the single selected object. */
export function addInstance(): void {
  const st = useStore.getState();
  if (st.selectedIds.length === 1) st.addInstances(st.selectedIds[0]);
}

/** "−": the last copy of the single selected object leaves (always the last, whatever is picked). */
export function removeLastInstance(): void {
  const st = useStore.getState();
  if (st.selectedIds.length === 1) st.removeInstance(st.selectedIds[0]);
}

/** Run one of the strip's commands. The arrange gear opens its own popover and is not handled here. */
export function runStripCommand(command: StripCommand): void {
  const st = useStore.getState();
  switch (command) {
    case 'deleteSelection':
      deleteSelection();
      return;
    case 'addInstance':
      addInstance();
      return;
    case 'removeInstance':
      removeLastInstance();
      return;
    case 'arrange':
      st.arrange();
      return;
    case 'arrangeSettings':
      return;
  }
}
