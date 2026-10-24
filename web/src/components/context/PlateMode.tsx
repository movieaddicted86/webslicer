import { useStore } from '../../state/store';
import { PanelCard } from './PanelCard';
import { bedShapeOf } from '@webslicer/shared';
import { fmt } from '../../format';
import './PlateMode.css';

/**
 * The plate card of the context panel: what the plate will be printed on – the printer preset, its
 * bed and its nozzle. It is the header of the plate mode, above the preset rows.
 *
 * Nothing here needs a selection; this is the card of an empty selection beside the Preview.
 */
export function PlateMode() {
  const printerSlot = useStore((s) => s.presets.printer);
  const printer = printerSlot.current;
  const bed = bedShapeOf(printer);
  return (
    <PanelCard title="Printer" icon="printers" testId="printer-card">
      <div className="plate-card-name" data-testid="printer-card-name" title={printerSlot.name}>
        {printerSlot.name}
      </div>
      <dl className="plate-card-facts">
        <dt>Bed</dt>
        <dd data-testid="printer-card-bed">
          {fmt(bed.max[0] - bed.min[0])} × {fmt(bed.max[1] - bed.min[1])} mm
        </dd>
        <dt>Height</dt>
        <dd>{fmt(Number(printer.max_print_height || 0))} mm</dd>
        <dt>Nozzle</dt>
        <dd data-testid="printer-card-nozzle">{printer.nozzle_diameter || '–'} mm</dd>
      </dl>
      {printer.printer_technology === 'SLA' && (
        <div className="muted small">Resin printer: the quick settings of an FFF printer do not apply.</div>
      )}
    </PanelCard>
  );
}
