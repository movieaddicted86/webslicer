import { useStore, type PresetSlot } from '../../state/store';
import { PresetSelect, PresetCog } from '../PresetSelect';
import { QuickSettings } from './QuickSettings';
import './Presets.css';

/**
 * The print, filament and printer preset rows and the quick settings – the part of the panel that
 * describes the print rather than the selection, so it is above the mode content in every plater mode.
 *
 * The card is the mockup's "Print settings": one heading with the print preset's cog, the print preset
 * select, then the filament and printer rows (with their own cogs) and the two visibility switches,
 * then the grouped quick settings a group title at a time. Each preset row keeps its save, discard,
 * rename and delete buttons; the quick settings write the print preset as before. In the Preview the
 * panel shows the slicing result instead, so these rows stay with the plater.
 */
export function Presets() {
  const presets = useStore((s) => s.presets);
  const extruders = useStore((s) => s.extruderCount());
  const showIncompatible = useStore((s) => s.showIncompatible);
  const showAllFilaments = useStore((s) => s.showAllFilaments);
  const visibleFilaments = useStore((s) => s.visibleFilaments);
  const filaments: PresetSlot[] = presets.filament.slice(0, extruders);

  return (
    <section className="presets" data-testid="presets" aria-label="Presets">
      <div className="presets-card">
        <div className="presets-head">
          <h3 className="presets-title">Print settings</h3>
          <PresetCog type="print" />
        </div>
        <PresetSelect type="print" slot={presets.print} label="Print settings" showCog={false} labelHidden />

        {filaments.map((f, i) => (
          <PresetSelect
            key={i}
            type="filament"
            slot={f}
            extruderIdx={i}
            label={extruders > 1 ? `Filament (extruder ${i + 1})` : 'Filament'}
          />
        ))}
        <PresetSelect type="printer" slot={presets.printer} label="Printer" />
        <div className="presets-flags">
          <label className="checkbox small">
            <input type="checkbox" checked={showIncompatible} onChange={(e) => useStore.setState({ showIncompatible: e.target.checked })} />{' '}
            Show incompatible presets
          </label>
          {/* the wizard's filament filter has an escape hatch: the same list, for this session only */}
          {visibleFilaments.length > 0 && (
            <label className="checkbox small" title="Ignore the filaments chosen in the printer setup for now">
              <input
                type="checkbox"
                checked={showAllFilaments}
                onChange={(e) => useStore.setState({ showAllFilaments: e.target.checked })}
              />{' '}
              Show all filaments
            </label>
          )}
        </div>
        <div className="quick" data-testid="quick-settings-panel" aria-label="Quick settings">
          <QuickSettings />
        </div>
      </div>
    </section>
  );
}
