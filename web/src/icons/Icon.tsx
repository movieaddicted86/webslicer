import type { CSSProperties } from 'react';
import { PRUSA_ICONS } from './prusa';
import { ICON_TABLE, type IconName } from './table';
import './Icon.css';

/**
 * The one way to draw an icon (I-1). The function name picks the artwork from `table.ts`: PrusaSlicer's
 * inline SVG, or a lucide glyph for the chrome Prusa has no icon for. Icons are decorative – the
 * control around them carries the label – so they are `aria-hidden`.
 *
 * The box is sized by `--icon-size` (default 20 px); the `size` prop sets that property and the SVG's
 * own width/height, which keeps the rendered size independent of the surrounding font size.
 */
export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const entry = ICON_TABLE[name];
  if (entry.source === 'lucide') {
    const Glyph = entry.icon;
    return <Glyph className={className} size={size} strokeWidth={2} aria-hidden="true" focusable="false" />;
  }
  // the vendored SVG is generated and trusted; the two attributes give it its intrinsic size
  const svg = PRUSA_ICONS[entry.file].replace('<svg ', `<svg width="${size}" height="${size}" `);
  return (
    <span
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      style={{ '--icon-size': `${size}px` } as CSSProperties}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
