import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { arrangementSpacing } from '@webslicer/shared';
import { MAX_ARRANGE_SPACING } from '../../plater/arrangeSettings';
import { NumericField } from '../common/NumericField';
import { ToolbarButton } from '../common/ToolbarButton';
import './ArrangeSettingsMenu.css';

/**
 * The gear next to Arrange (T-043): spacing, rotations and alignment of an arrangement. The values
 * are remembered per browser by the plater slice; the spacing field stays empty to use the print
 * preset's value, which is what the old button did.
 */
export function ArrangeSettingsMenu() {
  const settings = useStore((s) => s.arrangeSettings);
  const setSettings = useStore((s) => s.setArrangeSettings);
  const printCfg = useStore((s) => s.presets.print.current);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // capture phase: Esc closes the popover and must not also clear the plater selection
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const defaultSpacing = arrangementSpacing(printCfg);
  return (
    <div className="arrange-menu" ref={ref}>
      <ToolbarButton title="Arrange settings" icon="arrangeSettings" active={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="arrange-popover" role="dialog" aria-label="Arrange settings">
          <div className="arrange-popover-title">Arrange settings</div>
          <label className="arrange-field">
            <span>Spacing</span>
            <NumericField
              text={settings.spacing === undefined ? '' : String(settings.spacing)}
              placeholder={String(defaultSpacing)}
              min={0}
              max={MAX_ARRANGE_SPACING}
              step="any"
              onText={(text) => {
                const n = Number(text);
                // empty means "use the print profile"; anything else has to be a real millimetre value
                if (text.trim() === '') setSettings({ spacing: undefined });
                else if (Number.isFinite(n) && n >= 0 && n <= MAX_ARRANGE_SPACING) setSettings({ spacing: n });
              }}
            />
            <span className="unit">mm</span>
          </label>
          <label className="arrange-check">
            <input type="checkbox" checked={settings.rotations} onChange={(e) => setSettings({ rotations: e.target.checked })} />
            Enable rotations
          </label>
          <label className="arrange-field">
            <span>Alignment</span>
            <select
              value={settings.alignment}
              onChange={(e) => setSettings({ alignment: e.target.value === 'corner' ? 'corner' : 'center' })}
            >
              <option value="center">Center</option>
              <option value="corner">Corner</option>
            </select>
          </label>
          <div className="muted small">Empty spacing = the print profile's value.</div>
        </div>
      )}
    </div>
  );
}
