/**
 * The nozzle variants of a printer model as the vendor list shows them: a fixed grid with the
 * standard nozzles in one row and the high-flow nozzles ("HF0.4" in the bundle) in a second, labelled
 * row – the bundle's own order mixes them.
 */

/** One variant of the grid: the bundle's value, the short label of its checkbox and its unit. */
export interface VariantCell {
  /** the value as the bundle stores it, e.g. "HF0.4" – what an installed printer references */
  value: string;
  /** the label next to the box without its unit: "0.4", "volcano 0.6" or "default" */
  label: string;
  /** the unit after the label – "mm" for a nozzle diameter, empty when the label carries none */
  unit: string;
}

export interface VariantGrid {
  standard: VariantCell[];
  highFlow: VariantCell[];
}

/** The nozzle diameter at the end of a variant ("HF0.4" → 0.4), for ordering; NaN when there is none. */
function nozzleOf(variant: string): number {
  const m = /(\d+(?:\.\d+)?)\s*$/.exec(variant);
  return m ? Number(m[1]) : NaN;
}

/** "HF0.4" and "HF 0.4" are high flow; the bundle's other variants are standard nozzles. */
export function isHighFlow(variant: string): boolean {
  return /^hf\s*\d/i.test(variant.trim());
}

/** The label of a variant split from its unit: "HF0.4" → "0.4" + "mm" (the row says high flow). */
function variantParts(variant: string): { label: string; unit: string } {
  const bare = variant.trim().replace(/^hf\s*/i, '');
  if (!bare || bare.toLowerCase() === 'default') return { label: 'default', unit: '' };
  return /^\d/.test(bare) ? { label: bare, unit: 'mm' } : { label: bare, unit: '' };
}

/** The full label of a variant as one line: "0.4 mm", "volcano 0.6" or "default". */
export function variantLabel(variant: string): string {
  const { label, unit } = variantParts(variant);
  return unit ? `${label} ${unit}` : label;
}

/**
 * Split a model's variants into the two rows and order each by nozzle size, so every card lists
 * 0.25, 0.3, 0.4 … the same way whatever order the bundle uses. Variants without a diameter keep
 * their bundle order after the numbered ones (a stable sort does the ordering).
 */
export function variantGrid(variants: string[]): VariantGrid {
  const cells = variants.map((value) => ({ value: value.trim(), ...variantParts(value) })).filter((c) => c.value !== '');
  const byNozzle = (a: VariantCell, b: VariantCell) => {
    const na = nozzleOf(a.value);
    const nb = nozzleOf(b.value);
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  };
  return {
    standard: cells.filter((c) => !isHighFlow(c.value)).sort(byNozzle),
    highFlow: cells.filter((c) => isHighFlow(c.value)).sort(byNozzle),
  };
}

/**
 * The column count of the grid: the widest row of the listed models, standard and high flow alike,
 * so the boxes of both rows and of every card sit in the same columns.
 */
export function columnCount(models: Array<{ variants: string[] }>): number {
  let count = 1;
  for (const m of models) {
    const grid = variantGrid(m.variants);
    count = Math.max(count, grid.standard.length, grid.highFlow.length);
  }
  return count;
}
