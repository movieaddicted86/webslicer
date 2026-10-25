import { useStore } from '../../state/store';
import { bedShapeOf } from '@webslicer/shared';
import { normalizeColor } from '../../gcode/colorprint';
import { Icon } from '../../icons/Icon';
import { fmt } from '../../format';
import './PlateMode.css';

/**
 * The "Printer & material" card of the plate mode: a tile with the printer's picture, its name and the
 * summary of nozzle and build volume, and the filament that is loaded, as a row with its colour dot,
 * its name and its nozzle.
 *
 * It is a summary, not a second place to pick a preset: the printer and filament preset rows (with
 * their buttons into the full views) are in the Print settings card below, so each function keeps one
 * home.
 */
export function PlateMode() {
  const presets = useStore((s) => s.presets);
  const printerSlot = presets.printer;
  const printer = printerSlot.current;
  const bed = bedShapeOf(printer);
  const filament = useStore((s) => s.presets.filament)[0];
  const colour = normalizeColor(filament?.current.filament_colour);
  const bedWidth = bed.max[0] - bed.min[0];
  const bedDepth = bed.max[1] - bed.min[1];
  const height = Number(printer.max_print_height || 0);
  return (
    <section className="plate-card" data-testid="printer-card" aria-label="Printer & material">
      <div className="plate-card-head">
        <h3 className="plate-card-title">Printer &amp; material</h3>
      </div>
      <div className="plate-printer">
        <span className="plate-tile" aria-hidden="true">
          <Icon name="printers" size={28} />
        </span>
        <div className="plate-printer-text">
          <b className="plate-card-name" data-testid="printer-card-name" title={printerSlot.name}>
            {printerSlot.name}
          </b>
          <span className="plate-sub">
            <span data-testid="printer-card-nozzle">{printer.nozzle_diameter || '–'} mm nozzle</span> ·{' '}
            <span data-testid="printer-card-bed">
              {fmt(bedWidth)} × {fmt(bedDepth)} × {fmt(height)} mm
            </span>
          </span>
        </div>
      </div>
      {filament && (
        <div className="plate-filament" data-testid="printer-card-filament" title={filament.name}>
          <span className="plate-colour" style={{ background: colour }} aria-hidden="true" />
          <b className="plate-filament-name">{filament.name}</b>
          <span className="plate-sub">{printer.nozzle_diameter || '–'}</span>
          <Icon name="spool" size={16} />
        </div>
      )}
      {printer.printer_technology === 'SLA' && (
        <div className="plate-note muted small">Resin printer: the quick settings of an FFF printer do not apply.</div>
      )}
    </section>
  );
}
