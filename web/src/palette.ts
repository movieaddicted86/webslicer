/**
 * One extruder palette for the whole app (F-21). `main` carried it twice – as numbers in the plater
 * (`three/Viewer.tsx`) and as CSS strings in the sidebar (`components/Sidebar.tsx`) – so the two
 * could drift apart. The values are the ones both copies had; nothing is recoloured.
 *
 * R-12 moves this table into `shared/`, where the server can read it as well.
 */
export const EXTRUDER_PALETTE = ['#e6b84a', '#73c2fb', '#d96fd9', '#84d08a', '#f09b59', '#a9a9f5'];

/** The colour three.js and the G-code comments use – the same palette, as numbers. */
export const EXTRUDER_COLORS: number[] = EXTRUDER_PALETTE.map((css) => parseInt(css.slice(1), 16));

/** The colour of the first extruder – the plater's object colour. */
export const DEFAULT_COLOR = EXTRUDER_COLORS[0];

/** The first palette entry as CSS, the fallback where a filament colour is missing or broken. */
export const DEFAULT_COLOR_CSS = EXTRUDER_PALETTE[0];

/** The CSS colour of extruder `n` (1-based); extruders past the end wrap around. */
export function extruderCss(n: number): string {
  return EXTRUDER_PALETTE[(n - 1) % EXTRUDER_PALETTE.length];
}
