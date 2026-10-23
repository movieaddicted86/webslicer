/**
 * The Arrange settings the browser remembers (T-043): spacing, rotations and alignment survive a
 * reload like the view and the preset selection do. `localStorage` may throw (private windows,
 * disabled storage), so loading falls back to today's layout and saving is best effort.
 */
import { DEFAULT_ARRANGE_SETTINGS, type ArrangeSettings } from './arrangement';

const KEY = 'webslicer.arrange';

/** The largest spacing the popover accepts, mm – generous for sequential prints, still sane. */
export const MAX_ARRANGE_SPACING = 100;

/** Read the remembered arrange settings; a missing or broken entry means today's layout. */
export function loadArrangeSettings(): ArrangeSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<ArrangeSettings>;
    return {
      spacing: validSpacing(raw.spacing),
      rotations: raw.rotations === true,
      alignment: raw.alignment === 'corner' ? 'corner' : 'center',
    };
  } catch {
    return { ...DEFAULT_ARRANGE_SETTINGS };
  }
}

/** Remember the arrange settings; best effort, a storage failure keeps them for this tab only. */
export function saveArrangeSettings(settings: ArrangeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private window / quota: the setting still applies until the tab closes
  }
}

/** A stored spacing is only used when it is a real millimetre value in range. */
function validSpacing(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ARRANGE_SPACING ? value : undefined;
}
