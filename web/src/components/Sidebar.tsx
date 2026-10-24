import { useStore } from '../state/store';
import { PresetSelect } from './PresetSelect';
import { PreviewPanel } from './PreviewPanel';
import { QuickSettings } from './sidebar/QuickSettings';
import { SlicePanel } from './sidebar/SlicePanel';
import './Sidebar.css';

/**
 * The right sidebar (F-13): the presets and the quick settings on top, then the slice panel – or the
 * preview panel in the Preview view. The object list and the preview's info cards live in the left
 * column since the layout 3.0 step L-2; everything else of the plater still lives here.
 */
export function Sidebar() {
  const view = useStore((s) => s.view);
  const presets = useStore((s) => s.presets);
  const extruders = useStore((s) => s.extruderCount());
  const showIncompatible = useStore((s) => s.showIncompatible);
  const showAllFilaments = useStore((s) => s.showAllFilaments);
  const visibleFilaments = useStore((s) => s.visibleFilaments);

  return (
    <aside className="sidebar" data-testid="sidebar">
      <section className="presets" data-testid="presets">
        <PresetSelect type="print" slot={presets.print} label="Print settings" />
        {presets.filament.slice(0, extruders).map((f, i) => (
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
      {view !== 'preview' ? (
        <>
          <section className="quick" data-testid="quick-settings-panel">
            <QuickSettings />
          </section>
          <SlicePanel />
        </>
      ) : (
        <PreviewPanel />
      )}
    </aside>
  );
}
