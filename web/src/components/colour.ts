/**
 * The filament colour field: the native colour picker and the hex field both edit one value, so
 * the two conversions between a stored value and what each control shows live here.
 */

/** A stored colour the picker can show as `#rrggbb`, or undefined when it is not exactly one colour. */
export function pickerColour(value: string): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return m ? `#${m[1].toLowerCase()}` : undefined;
}

/**
 * The stored value a committed hex text means: `#RRGGBB` in upper case, as the presets spell it. Text
 * that is not a colour is kept as typed, so the field can show it and mark it invalid.
 */
export function hexColourValue(text: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return m ? `#${m[1].toUpperCase()}` : text;
}

/** Whether a stored value is a single canonical colour (or the empty, unset value). */
export function isValidColour(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^#[0-9a-f]{6}$/i.test(trimmed);
}
