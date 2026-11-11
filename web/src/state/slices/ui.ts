/**
 * The UI slice: what the app is showing – the active view, the visibility mode, toasts and the
 * modal dialog – and `init`, which loads the server metadata every other slice works from.
 */
import type { StateCreator } from 'zustand';
import {
  api,
  ApiError,
  type InstalledPrinter,
  type Mode,
  type PhysicalPrinter,
  type PrinterSafetyProfile,
  type PrinterSafetyRecord,
  type RiskNoticeStatus,
  type UpdateStatus,
  type Vendor,
} from '../../api';
import { loadSelection, saveSelection } from './preset';
import { MODE_RANK } from '../../values';
import type { State, Toast, View } from '../types';
import type { IssueTarget } from '../../safety/configIssues';
import { canAdvance, nextStep, previousStep, type FlowStep } from '../guidedFlow';

/** The settings view a limit issue points at, with the extruder slot an issue of a filament may name. */
export type SettingFocus = IssueTarget;

export interface UiSlice {
  ready: boolean;
  vendors: Vendor[];
  installed: InstalledPrinter[];
  physicalPrinters: PhysicalPrinter[];
  /** T-085: the hotend/bed answer of every printer preset, keyed by preset name */
  printerSafety: PrinterSafetyRecord;
  /** T-085: whether the one-time risk notice was acknowledged for this major version */
  riskNotice?: RiskNoticeStatus;
  /** T-085: the notice was answered ("Not now") in this session, so nothing asks again until a reload */
  noticeDone: boolean;
  /** hide the risk notice for this session (the wizard's and the first slice's card share the flag) */
  dismissRiskNotice: () => void;
  /** store (or with `undefined` clear) the safety answer of a printer preset; updates the record */
  savePrinterSafety: (presetName: string, profile: PrinterSafetyProfile | undefined) => Promise<void>;
  /** reload every preset's answer (a preset rename or delete changes the record) */
  refreshPrinterSafety: () => Promise<void>;
  /** acknowledge the risk notice; the server keeps it (per major version) */
  acknowledgeRiskNotice: () => Promise<void>;
  /** the current step of the guided flow, or `undefined` when the app is in its free layout */
  flowStep?: FlowStep;
  /**
   * the user answered the skip question on an empty plate (T-101): the flow stays away until a model
   * was on the plate again, so answering "Yes" or "Don't show again" is not undone at once
   */
  flowDismissed: boolean;
  /** whether the guided flow should open on an empty phone plate (Preferences, default on) */
  guidedStart: boolean;
  /** start the guided flow at its first step (a fresh phone start, More → Guided start) */
  startFlow: () => void;
  /**
   * Advance one step. The first step needs a model on the plate (nothing else has a condition), and the
   * last step has no Next – there the footer's own Slice and Send lead on.
   */
  nextFlowStep: () => void;
  /** back one step; the first step has none */
  previousFlowStep: () => void;
  /** leave the flow for the free layout, keeping the plate, the presets and the edits */
  leaveFlow: () => void;
  /** switch the preference on or off and remember it in this browser; off closes the flow */
  setGuidedStart: (on: boolean) => void;
  mode: Mode;
  view: View;
  showIncompatible: boolean;
  /** the filament selector's escape hatch: ignore the wizard's ticked filaments for this session */
  showAllFilaments: boolean;
  /** the print host picked in the context panel footer; empty means the send dialog picks one */
  sendDestination?: string;
  setSendDestination: (id: string) => void;
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

/** The phone's "Guided start" preference (T-100); an absent value means on – the phone's default. */
const GUIDED_START_KEY = 'webslicer.guidedStart';

function loadGuidedStart(): boolean {
  try {
    return localStorage.getItem(GUIDED_START_KEY) !== 'off';
  } catch {
    return true;
  }
}

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
  printerSafety: {},
  riskNotice: undefined,
  noticeDone: false,
  mode: 'advanced',
  view: 'plater',
  showIncompatible: false,
  showAllFilaments: false,
  sendDestination: undefined,
  setSendDestination: (id) => set({ sendDestination: id || undefined }),
  flowStep: undefined,
  flowDismissed: false,
  guidedStart: loadGuidedStart(),
  startFlow: () => set({ flowStep: 1, flowDismissed: false }),
  nextFlowStep: () => {
    const s = get();
    const step = s.flowStep;
    if (step === undefined) return;
    if (!canAdvance(step, { objectsPresent: s.objects.length > 0 })) return;
    const next = nextStep(step);
    if (next !== undefined) set({ flowStep: next });
  },
  previousFlowStep: () => {
    const step = get().flowStep;
    if (step === undefined) return;
    const previous = previousStep(step);
    if (previous !== undefined) set({ flowStep: previous });
  },
  leaveFlow: () => set({ flowStep: undefined, flowDismissed: get().objects.length === 0 }),
  setGuidedStart: (on) => {
    set(on ? { guidedStart: true } : { guidedStart: false, flowStep: undefined });
    try {
      localStorage.setItem(GUIDED_START_KEY, on ? 'on' : 'off');
    } catch {
      /* private window: the preference works for this page, it just does not survive the reload */
    }
  },
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
  savePrinterSafety: async (presetName, profile) => {
    const record = profile ? await api.setPrinterSafety(presetName, profile) : await api.clearPrinterSafety(presetName);
    set({ printerSafety: record });
  },
  refreshPrinterSafety: async () => {
    // a server from before T-085 has no record; the answer is then simply "not answered"
    set({ printerSafety: await api.printerSafety().catch(() => ({})) });
  },
  acknowledgeRiskNotice: async () => {
    set({ riskNotice: await api.acknowledgeRiskNotice(), noticeDone: true });
  },
  dismissRiskNotice: () => set({ noticeDone: true }),
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
      // T-085: the safety answers and the notice state – both are server state, both are quiet extras
      void get().refreshPrinterSafety();
      void api
        .riskNotice()
        .then((riskNotice) => set({ riskNotice }))
        .catch(() => set({ riskNotice: { acknowledged: true } }));
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
      set({ fatal: (e as Error).message, fatalStatus: e instanceof ApiError ? e.status : undefined });
    }
  },
});
