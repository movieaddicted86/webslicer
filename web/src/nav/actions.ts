/**
 * Running a navigation entry: the actions the nav map names, performed against the store and the
 * API. The hosts (rail, menu, preset rows, top bar) only render and forward; the behaviour lives here
 * so two hosts that serve the same function cannot drift apart.
 */
import { useStore } from '../state/store';
import { api, downloadBlob } from '../api';
import type { ExportTarget, NavAction, NavDialog } from './navMap';

/** The dialog's opening payload; the printers dialog reads `tab`, the library its mode. */
export interface DialogPayload {
  dialog: NavDialog;
  payload?: unknown;
}

/** Open what a dialog entry names. */
export function openNavDialog(dialog: NavDialog, payload?: unknown): void {
  const st = useStore.getState();
  switch (dialog) {
    case 'library':
      st.openDialog('library', payload);
      return;
    case 'printers':
      // one dialog for the hosts and the printer setup; `tab` says where it opens
      st.openDialog('printers', payload as { tab?: string } | undefined);
      return;
    case 'preferences':
      st.openDialog('preferences');
      return;
    case 'importPresets':
      st.openDialog('importPresets');
      return;
    case 'about':
      st.openDialog('about');
  }
}

/** The four export targets of the Export submenu and the two "to library" entries. */
export async function runExport(target: ExportTarget): Promise<void> {
  const st = useStore.getState();
  if (target === 'saveProject') {
    st.openDialog('library', 'saveProject');
    return;
  }
  if (target === 'saveGcode') {
    st.openDialog('library', 'saveGcode');
    return;
  }
  if (target === 'project') {
    if (!st.objects.length) return st.toast('error', 'Nothing to export');
    const req = st.buildSliceRequest();
    if (!req.objects.length) return st.toast('error', 'Models are still uploading');
    try {
      downloadBlob(await api.export3mf(req), `${req.outputName || 'project'}.3mf`);
    } catch (e) {
      st.toast('error', (e as Error).message);
    }
    return;
  }
  if (target === 'settings') {
    try {
      downloadBlob(await api.exportConfig(st.buildSliceRequest()), 'config.ini');
    } catch (e) {
      st.toast('error', (e as Error).message);
    }
    return;
  }
  if (target === 'bundle') {
    try {
      downloadBlob(await api.exportBundle(), 'WebSlicer config bundle.ini');
    } catch (e) {
      useStore.getState().toast('error', (e as Error).message);
    }
    return;
  }
  // the G-code of the last finished job, as a download
  const job = st.job;
  if (job && job.status === 'done') location.href = api.gcodeUrl(job.id, true);
}

/**
 * Perform an action of the nav map. `import` is the one action a host owns: the hidden file input
 * lives there (`true` tells it to click).
 */
export async function runNavAction(action: NavAction): Promise<true | void> {
  const st = useStore.getState();
  switch (action.kind) {
    case 'view':
      st.setView(action.view);
      return;
    case 'dialog':
      openNavDialog(action.dialog, action.payload);
      return;
    case 'export':
      await runExport(action.target);
      return;
    case 'undo':
      st.undo();
      return;
    case 'redo':
      st.redo();
      return;
    case 'hidePanels':
      st.togglePanels();
      return;
    case 'import':
      return true;
  }
}
