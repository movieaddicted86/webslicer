/**
 * Environment numbers (W5): `Number(process.env.X)` turned a typo into `NaN`, and `NaN` then travelled
 * into ports, limits and intervals – a listener on port `NaN`, a `Math.max(1, NaN)` slot count, a
 * pruning interval of `NaN`. Every numeric variable is read through here now: an unusable value logs
 * a warning and falls back to the documented default.
 */

/** Parse a number from the environment; `undefined` and blanks mean "use the default". */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.warn(`[webslicer] ${name}="${raw}" is not a number – using ${fallback}`);
    return fallback;
  }
  return n;
}

/** Like `envNumber`, but a value below `min` is refused as unusable and the default applies. */
export function envNumberAtLeast(name: string, min: number, fallback: number): number {
  const n = envNumber(name, fallback);
  if (n < min) {
    console.warn(`[webslicer] ${name}="${process.env[name]}" is below ${min} – using ${fallback}`);
    return fallback;
  }
  return n;
}

/** Like `envNumber`, but an integer is required; a fraction is truncated like the old `Number()` did. */
export function envIntegerAtLeast(name: string, min: number, fallback: number): number {
  return Math.floor(envNumberAtLeast(name, min, fallback));
}
