/**
 * The autosave lifecycle (T-035): save the plater 8 s after the last change, flush the pending save
 * when the page is hidden or closed, and forget the autosave when the plater is emptied on purpose.
 *
 * The flush is what makes a reload keep the last seconds of work: a debounce alone loses whatever
 * happened in the window before the reload, and the browser kills normal requests on `pagehide`.
 * The save itself lives in the job slice (`autosaveNow`), which is where the slice request is built;
 * this module only decides *when* it runs.
 */
import { useStore } from './store';
import type { State } from './types';

/** Debounce after the last plater/settings change. */
const DEBOUNCE_MS = 8000;

let timer: ReturnType<typeof setTimeout> | undefined;
/** The last content that went to the server, so an unchanged plater does not save again. */
let lastKey = '';

function changeKey(s: State): string {
  return JSON.stringify([
    s.objects.map((o) => [
      o.id,
      o.instances.map((i) => [i.id, i.position, i.rotation, i.scale]),
      o.config,
      o.extruder,
      o.visible,
      o.volumes.map((v) => [v.id, v.type, v.position, v.rotation, v.scale, v.config]),
    ]),
    s.presets.print.name,
    s.presets.print.current,
    s.customGcodes,
    s.presets.printer.name,
    s.presets.printer.current,
    s.presets.filament.map((f) => [f.name, f.current]),
  ]);
}

/** An autosave is only worth writing once every object and volume has its server model. */
function saveable(s: State): boolean {
  return s.objects.length > 0 && !s.objects.some((o) => !o.modelId && !o.uploadError);
}

function stopTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

/** Save now, whatever the debounce says – the page is going away or the user asked for it. */
export async function flushAutosave(): Promise<void> {
  stopTimer();
  if (!saveable(useStore.getState())) return;
  await useStore.getState().autosaveNow({ keepalive: true });
}

/** Save after the debounce, unless the content matches what the server already has. */
function schedule() {
  stopTimer();
  timer = setTimeout(() => {
    timer = undefined;
    const s = useStore.getState();
    if (!saveable(s)) return;
    const key = changeKey(s);
    if (key === lastKey) return;
    lastKey = key;
    void s.autosaveNow().then((ok) => {
      // a failed write must not be remembered as "already saved"
      if (!ok && lastKey === key) lastKey = '';
    });
  }, DEBOUNCE_MS);
}

/**
 * Wire the store and the page lifecycle. Returns an uninstall function (a hot reload and the tests
 * use it); the app installs it once from `main.tsx`.
 */
export function installAutosave(): () => void {
  let flushInFlight = false;
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (!s.ready) return;
    if (s.objects === prev.objects && s.presets === prev.presets) return;
    if (!s.objects.length) {
      // Intentional clear ("Delete all", "Start empty", undo back to empty, the clear of a new
      // import): the stored autosave is replaced by "nothing", or a reload would bring back what
      // the user removed on purpose. The clear before an import is followed by the import itself,
      // which saves the new plater a debounce later – until then an empty slot is the truth.
      stopTimer();
      lastKey = '';
      if (prev.objects.length) void useStore.getState().discardAutosave();
      return;
    }
    schedule();
  });
  const flush = () => {
    if (flushInFlight) return;
    flushInFlight = true;
    void flushAutosave().finally(() => {
      flushInFlight = false;
    });
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  const onPageHide = () => flush();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    unsubscribe();
    stopTimer();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}
