import { useStore } from '../../state/store';
import { toBool } from '../../values';

/**
 * PrusaSlicer-style quick settings on the plater: supports, infill density, brim.
 * They edit the current print preset (marking it modified) like in PrusaSlicer.
 */
export function QuickSettings() {
  const print = useStore((s) => s.presets.print);
  const setOption = useStore((s) => s.setOption);
  const setView = useStore((s) => s.setView);
  const tech = useStore((s) => s.presets.printer.current.printer_technology);
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
  const brim = (c.brim_type || 'outer_only') !== 'no_brim' && Number(c.brim_width) > 0;
  return (
    <div className="quick-settings">
      <label className="span">
        <span>Supports</span>
        <select value={supports} onChange={(e) => setSupports(e.target.value)}>
          <option value="none">None</option>
          <option value="buildplate">Support on build plate only</option>
          <option value="enforcers">For support enforcers only</option>
          <option value="everywhere">Everywhere</option>
        </select>
      </label>
      <label>
        <span>Infill</span>
        <select value={density} onChange={(e) => setOption('print', 'fill_density', e.target.value)}>
          {!densities.includes(density) && <option value={density}>{density}</option>}
          {densities.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={c.fill_pattern || 'grid'}
          onChange={(e) => setOption('print', 'fill_pattern', e.target.value)}
          title="Infill pattern"
        >
          {(useStore.getState().schema?.options.fill_pattern?.enumValues || ['grid']).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={brim}
          onChange={(e) => {
            setOption('print', 'brim_type', e.target.checked ? 'outer_only' : 'no_brim');
            if (e.target.checked && !(Number(c.brim_width) > 0)) setOption('print', 'brim_width', '5');
          }}
        />
        Brim
        {brim && <span className="muted small"> ({c.brim_width} mm)</span>}
      </label>
      <button className="link" onClick={() => setView('print')}>
        All print settings…
      </button>
    </div>
  );
}
