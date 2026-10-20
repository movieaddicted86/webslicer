/**
 * PrusaSlicer config values in the form the INI files and the JSON presets write them.
 *
 * R-4 needs the boolean reading for the arrangement spacing; R-5 moves the rest of the codecs
 * (`escapeStringCstyle`, `parsePoints`, …) here, so this is their home from now on.
 */

/**
 * A PrusaSlicer boolean option (`complete_objects`, `support_material`, …): `1`/`true`/`yes`/`on`,
 * any of them in any case and with surrounding blanks, everything else (and an unset option) is
 * false. The spellings all occur in the vendor presets, so a plain `=== '1'` check reads a
 * sequential print as a normal one.
 */
export function toBool(s: string | undefined): boolean {
  if (s === undefined) return false;
  const t = s.trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}
