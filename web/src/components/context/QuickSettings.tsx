import { useStore } from '../../state/store';
import { toBool } from '../../values';
import { GroupTitle } from '../common/GroupTitle';
import { NumericField } from '../common/NumericField';
import { PanelRow } from '../common/PanelRow';
import { Switch } from '../common/Switch';
import './QuickSettings.css';

/**
 * PrusaSlicer-style quick settings on the plater, as the mockup's grouped rows: Walls & perimeters,
 * Infill, Supports & adhesion. The label sits on the left, its control in the right-hand 150 px column,
 * and an on/off setting is a switch instead of a checkbox with its label beside it.
 *
 * They edit the current print preset (marking it modified) like in PrusaSlicer; the rows write the same
 * `setOption` the full settings view writes, so nothing is reachable only here. A resin printer has none
 * of the FFF options, so the block is empty there.
 */
export function QuickSettings() {
  const print = useStore((s) => s.presets.print);
  const setOption = useStore((s) => s.setOption);
  const tech = useStore((s) => s.presets.printer.current.printer_technology);
  const patterns = useStore((s) => s.schema?.options.fill_pattern?.enumValues);
  if (tech === 'SLA') return null;
  const c = print.current;
  const supports = !toBool(c.support_material)
    ? 'none'
    : !toBool(c.support_material_auto)
      ? 'enforcers'
      : toBool(c.support_material_buildplate_only)
        ? 'buildplate'
        : 'everywhere';
  const setSupports = (v: string) => {
    if (v === 'none') setOption('print', 'support_material', '0');
    else {
      setOption('print', 'support_material', '1');
      setOption('print', 'support_material_auto', v === 'enforcers' ? '0' : '1');
      setOption('print', 'support_material_buildplate_only', v === 'buildplate' ? '1' : '0');
    }
  };
  const density = c.fill_density || '20%';
  const densities = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
  const perimeters = Number(c.perimeters);
  const brim = (c.brim_type || 'outer_only') !== 'no_brim' && Number(c.brim_width) > 0;
  const setBrim = (on: boolean) => {
    setOption('print', 'brim_type', on ? 'outer_only' : 'no_brim');
    if (on && !(Number(c.brim_width) > 0)) setOption('print', 'brim_width', '5');
  };
  return (
    <div className="quick-settings" data-testid="quick-settings">
      <GroupTitle>Walls &amp; perimeters</GroupTitle>
      <PanelRow label="Perimeters" title="How many vertical shells the print gets, counted from the outside in">
        {/* the typed text stays while it is edited; an emptied or fractional field writes nothing */}
        <NumericField
          text={Number.isFinite(perimeters) ? String(perimeters) : ''}
          keepText
          apply="input"
          min={1}
          max={100}
          step={1}
          title="Perimeters"
          className="quick-number"
          onText={(text) => {
            const n = Number(text);
            if (Number.isInteger(n) && n >= 1 && n <= 100) setOption('print', 'perimeters', String(n));
          }}
        />
      </PanelRow>
      <GroupTitle>Infill</GroupTitle>
      <PanelRow label="Fill density" title="The infill density of the print">
        <select
          data-testid="quick-density"
          value={density}
          onChange={(e) => setOption('print', 'fill_density', e.target.value)}
          title="Fill density"
        >
          {!densities.includes(density) && <option value={density}>{density}</option>}
          {densities.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </PanelRow>
      <PanelRow label="Fill pattern" title="The infill pattern of the print">
        <select
          data-testid="quick-pattern"
          value={c.fill_pattern || 'grid'}
          onChange={(e) => setOption('print', 'fill_pattern', e.target.value)}
          title="Fill pattern"
        >
          {(patterns || ['grid']).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </PanelRow>
      <GroupTitle>Supports &amp; adhesion</GroupTitle>
      <PanelRow label="Generate supports" title="Which support structures the slicer adds">
        <select data-testid="quick-supports" value={supports} onChange={(e) => setSupports(e.target.value)} title="Generate supports">
          <option value="none">None</option>
          <option value="buildplate">Support on build plate only</option>
          <option value="enforcers">For support enforcers only</option>
          <option value="everywhere">Everywhere</option>
        </select>
      </PanelRow>
      <PanelRow label={brim ? `Brim (${c.brim_width} mm)` : 'Brim'} title="A brim around the first layer, for adhesion">
        <Switch checked={brim} onChange={setBrim} label="Brim" title="A brim around the first layer, for adhesion" testId="quick-brim" />
      </PanelRow>
    </div>
  );
}
