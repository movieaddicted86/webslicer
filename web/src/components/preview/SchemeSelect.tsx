import { useStore } from '../../state/store';
import { COLOR_MODES, type PreviewColorMode } from '../../gcode/colorschemes';
import './SchemeSelect.css';

/**
 * The colour scheme of the preview toolpaths – the one select that decides what the colours mean.
 * The right panel's View card and the legend card carry it, so the same select is rendered in two
 * places and the caller supplies its class and hook.
 */
export function SchemeSelect({ testId, className }: { testId?: string; className?: string }) {
  const colorMode = useStore((s) => s.previewColorMode);
  const setColorMode = useStore((s) => s.setPreviewColorMode);
  return (
    <select
      className={className}
      data-testid={testId}
      value={colorMode}
      title="What the toolpath colours show"
      onChange={(e) => setColorMode(e.target.value as PreviewColorMode)}
    >
      {COLOR_MODES.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
