/**
 * The UI slice: what the app is showing – the active view, the visibility mode, toasts and the
 * modal dialog – and `init`, which loads the server metadata every other slice works from.
 */
import type { StateCreator } from 'zustand';
import { api, type InstalledPrinter, type Mode, type PhysicalPrinter, type Vendor } from '../../api';
import { loadSelection, saveSelection } from './preset';
import type { State, Toast, View } from '../types';

export interface UiSlice {
  ready: boolean;
  vendors: Vendor[];
  installed: InstalledPrinter[];
  physicalPrinters: PhysicalPrinter[];
  mode: Mode;
  view: View;
  showIncompatible: boolean;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string, action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
  setView: (v: View) => void;
  setMode: (m: Mode) => void;
  openDialog: (d: State['dialog'], payload?: unknown) => void;
  closeDialog: () => void;
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
  openDialog: (dialog, dialogPayload) => set({ dialog, dialogPayload }),
  closeDialog: () => set({ dialog: undefined, dialogPayload: undefined, pendingSwitch: undefined }),
  init: async () => {
    try {
      const [info, schema, vendors, installed, physicalPrinters] = await Promise.all([
        api.info(),
        api.schema(),
        api.vendors(),
        api.installedPrinters(),
        api.printers().catch(() => []),
      ]);
      const sel = loadSelection();
      set({ info, schema, vendors, installed, physicalPrinters, mode: sel.mode || 'advanced' });
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
      if (!installed.length) get().openDialog('addPrinter');
    } catch (e) {
      set({ fatal: (e as Error).message });
    }
  },
});
