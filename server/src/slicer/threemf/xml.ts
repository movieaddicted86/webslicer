/** XML escaping and number formatting shared by the 3MF reader, writer and custom G-codes. */

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Number as the 3MF writer prints it: an integer stays bare, everything else keeps 6 decimals. */
export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '');
}

export function xmlUnescape(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
