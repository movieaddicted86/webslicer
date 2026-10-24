import { useStore, type PresetSlot } from '../../state/store';
import { PresetSelect } from '../PresetSelect';
import { QuickSettings } from './QuickSettings';
import './Presets.css';

/**
 * The print, filament and printer preset rows and the quick settings – the part of the panel that
 * describes the print rather than the selection, so it is above the mode content in every plater mode.
 *
 * Each row carries the cog into its full settings view (the one home of those views) and its save
 * and discard buttons; the quick settings write the print preset as before. In the Preview the panel
 * shows the slicing result instead, so these rows stay with the plater.
 */
export function Presets() {
  const presets = useStore((s) => s.presets);
  const extruders = useStore((s) => s.extruderCount());
  const showIncompatible = useStore((s) => s.showIncompatible);
  const showAllFilaments = useStore((s) => s.showAllFilaments);
  const visibleFilaments = useStore((s) => s.visibleFilaments);
  const filaments: PresetSlot[] = presets.filament.slice(0, extruders);

  return (
    <>
      <section className="presets" data-testid="presets" aria-label="Presets">
        <PresetSelect type="print" slot={presets.print} label="Print settings" />
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
        <label className="checkbox small">
          <input type="checkbox" checked={showIncompatible} onChange={(e) => useStore.setState({ showIncompatible: e.target.checked })} />{' '}
          Show incompatible presets
        </label>
        {/* the wizard's filament filter has an escape hatch: the same list, for this session only */}
        {visibleFilaments.length > 0 && (
          <label className="checkbox small" title="Ignore the filaments chosen in the printer setup for now">
            <input type="checkbox" checked={showAllFilaments} onChange={(e) => useStore.setState({ showAllFilaments: e.target.checked })} />{' '}
            Show all filaments
          </label>
        )}
      </section>
      <section className="quick" data-testid="quick-settings-panel" aria-label="Quick settings">
        <QuickSettings />
      </section>
    </>
  );
}
