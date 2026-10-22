/**
 * Every number, time and size string the UI shows, in one place (F-22). The call sites used to
 * carry their own copies; each helper here keeps the exact output it had there, because some
 * deliberately format differently (`fmtLayerTime` vs `fmtFeatureTime`).
 */

/** Trim a number for a field: two decimals at most, no trailing zeros, "0" for NaN. */
export function fmt(n: number, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d).replace(/\.?0+$/, '') : '0';
}

/** A Z height as the preview prints it: always two decimals. */
export function fmtZ(z: number) {
  return z.toFixed(2);
}

/** A file size for the library dialog: `512 B`, `3.4 KB`, `1.2 MB`; undefined prints nothing. */
export function fmtSize(n?: number) {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** A G-code size for the sliced-info table: always `x.y MB`. */
export function fmtMegabytes(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** `1m 02s` – the layer time labels of the range legend. */
export function fmtLayerTime(s: number) {
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

/** PrusaSlicer's feature legend: `1h 02m`, `3m 10s`, `8.4 s`. */
export function fmtFeatureTime(s: number) {
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `${s.toFixed(1)}s`;
}

/** `1h 02m 3s` for the sliced info table; undefined/0 prints `–`. */
export function fmtTime(s?: number) {
  if (!s) return '–';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}
