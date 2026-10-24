/**
 * The UI slice: what the app is showing – the active view, the visibility mode, toasts and the
 * modal dialog – and `init`, which loads the server metadata every other slice works from.
 */
import type { StateCreator } from 'zustand';
import { api, type InstalledPrinter, type Mode, type PhysicalPrinter, type UpdateStatus, type Vendor } from '../../api';
import { loadSelection, saveSelection } from './preset';
import { MODE_RANK } from '../../values';
import type { State, Toast, View } from '../types';
import type { IssueTarget } from '../../safety/configIssues';

/** The settings view a limit issue points at, with the extruder slot an issue of a filament may name. */
export type SettingFocus = IssueTarget;

export interface UiSlice {
  ready: boolean;
  vendors: Vendor[];
  installed: InstalledPrinter[];
  physicalPrinters: PhysicalPrinter[];
  mode: Mode;
  view: View;
  showIncompatible: boolean;
  /** the filament selector's escape hatch: ignore the wizard's ticked filaments for this session */
  showAllFilaments: boolean;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string, action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
  setView: (v: View) => void;
  /** open the settings tab and field of a configuration-limit issue (S1-e) */
  focusSetting: (target: SettingFocus) => void;
  /** where the settings view should jump to; cleared once it did */
  settingFocus?: SettingFocus;
  /** renaming requested for an object (F2, T-042); the objects list starts the inline edit and clears it */
  renameRequest?: string;
  requestRename: (id: string) => void;
  setMode: (m: Mode) => void;
  openDialog: (d: State['dialog'], payload?: unknown) => void;
  closeDialog: () => void;
  /** T-058: the server's last answer to "is there a newer version?"; `undefined` while unknown */
  updateStatus?: UpdateStatus;
  /** fetch the update status in the background; a failure is silent (the chip just stays away) */
  refreshUpdateStatus: () => Promise<void>;
  /** reload the vendor list – a newly installed bundle can add or rename models */
  refreshVendors: () => Promise<void>;
  init: () => Promise<void>;
}

/** Toasts are numbered per app run; the id is what `dismissToast` removes them by. */
let toastId = 0;

/** The plater/preview tab the browser last showed (T-035); only these two are remembered. */
const VIEW_KEY = 'webslicer.view';

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'preview' ? 'preview' : 'plater';
  } catch {
    return 'plater';
  }
}

export const createUiSlice: StateCreator<State, [], [], UiSlice> = (set, get) => ({
  ready: false,
  vendors: [],
  installed: [],
  physicalPrinters: [],
  mode: 'advanced',
  view: 'plater',
  showIncompatible: false,
  showAllFilaments: false,
  toasts: [],
  toast: (kind, text, action) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text, action }] }));
    // a toast with a button waits longer: the user has to be able to read it and decide
    setTimeout(() => get().dismissToast(id), action ? 15000 : kind === 'error' ? 9000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setView: (view) => {
    set({ view });
    // the active tab is not part of the 3MF; remembering it here is what makes a reload come back
    // to the preview (or the plater) the user left (T-035). The settings tabs are not remembered:
    // they are where the user went to change something, not a state of the plater.
    if (view !== 'plater' && view !== 'preview') return;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private window: the tab just starts on the plater */
    }
  },
  setMode: (mode) => {
    set({ mode });
    saveSelection(get());
  },
  focusSetting: (target) => {
    // a focus is a one-shot request: the settings view scrolls to the field and clears it. A field
    // hidden by the current visibility mode is revealed first – otherwise the jump would land on a
    // tab without the option the message named.
    const { schema, mode } = get();
    const needed = schema?.options[target.key]?.mode;
    const raise = needed && MODE_RANK[needed] > MODE_RANK[mode] ? { mode: needed } : {};
    set({ ...raise, view: target.section, settingFocus: target });
    // the mode is part of the remembered selection, like `setMode` keeps it
    if (needed && raise.mode) saveSelection(get());
  },
  openDialog: (dialog, dialogPayload) => set({ dialog, dialogPayload }),
  requestRename: (id) => set({ renameRequest: id }),
  closeDialog: () => set({ dialog: undefined, dialogPayload: undefined, pendingSwitch: undefined }),
  refreshUpdateStatus: async () => {
    try {
      set({ updateStatus: await api.updateStatus() });
    } catch {
      // the notice is a convenience: an offline server or an old one without the route shows nothing
    }
  },
  refreshVendors: async () => {
    // an installed bundle changes the models, so the dialog's list has to follow it
    set({ vendors: await api.vendors() });
  },
  init: async () => {
    try {
      const [info, schema, vendors, installed, physicalPrinters, filaments] = await Promise.all([
        api.info(),
        api.schema(),
        api.vendors(),
        api.installedPrinters(),
        api.printers().catch(() => []),
        api.visibleFilaments().catch(() => ({ names: [] })),
      ]);
      const sel = loadSelection();
      set({ info, schema, vendors, installed, physicalPrinters, mode: sel.mode || 'advanced', visibleFilaments: filaments.names });
      // T-058: a quiet extra request – never awaited, so a slow GitHub never delays the app
      void get().refreshUpdateStatus();
      // restore selection
      const printerName = sel.printer || '- default FFF -';
      await get()
        .selectPreset('printer', printerName)
        .catch(() => get().selectPreset('printer', '- default FFF -'));
      // Restore explicit choices; a stored "- default -" entry is replaced by the printer's vendor default picked above.
      if (sel.print && !sel.print.startsWith('- default'))
        await get()
          .selectPreset('print', sel.print)
          .catch(() => undefined);
      if (sel.filament?.length) {
        for (let i = 0; i < sel.filament.length; i++) {
          if (!sel.filament[i].startsWith('- default'))
            await get()
              .selectPreset('filament', sel.filament[i], i)
              .catch(() => undefined);
        }
      }
      await get().ensureCompatiblePresets();
      set({ ready: true, view: loadView() });
      // a fresh install has nothing to print with: the printers dialog opens on the vendor profiles
      if (!installed.length) get().openDialog('printers', { tab: 'vendor' });
    } catch (e) {
      set({ fatal: (e as Error).message });
    }
  },
});
