import { useStore } from '../../state/store';
import { TextField } from '../common/TextField';
import { colorAtZ, normalizeColor, suggestColor } from '../../gcode/colorprint';
import { CODE_LABEL } from './formats';

/**
 * Colour changes, pauses and custom G-code at layers – PrusaSlicer's "+" on the vertical slider.
 * The code is inserted before the layer at the top slider position is printed.
 */
export function LayerCodes({ printZ, firstLayer, maxZ }: { printZ: number | undefined; firstLayer: boolean; maxZ: number }) {
  const codes = useStore((s) => s.customGcodes);
  const add = useStore((s) => s.addCustomGcode);
  const update = useStore((s) => s.updateCustomGcode);
  const remove = useStore((s) => s.removeCustomGcode);
  const extruders = useStore((s) => s.extruderCount());
  const tech = useStore((s) => s.presets.printer.current.printer_technology);
  const baseColor = useStore((s) => normalizeColor(s.presets.filament[0]?.current.filament_colour));
  const job = useStore((s) => s.job);
  const running = job && (job.status === 'running' || job.status === 'queued');
  if (tech === 'SLA' || printZ === undefined) return null;
  const z = Math.round(printZ * 1000) / 1000;
  const existing = codes.find((c) => Math.abs(c.printZ - z) < 1e-4);
  // a change on the first layer has no effect – PrusaSlicer does not allow it either
  const disabled = firstLayer || z >= maxZ + 1e-6;
  return (
    <div className="layer-codes">
      <div className="layer-codes-add">
        <span className="small muted">At Z {z.toFixed(2)} mm:</span>
        <button
          disabled={disabled}
          title="Insert a filament change (M600) before this layer"
          onClick={() => add({ printZ: z, type: 'color_change', extruder: 1, color: suggestColor(colorAtZ(z - 1e-3, baseColor, codes)) })}
        >
          ＋ Color
        </button>
        <button disabled={disabled} title="Pause the print before this layer (e.g. to insert magnets or nuts)" onClick={() => add({ printZ: z, type: 'pause', extra: 'Insert item' })}>
          ⏸ Pause
        </button>
        <button disabled={disabled} title="Insert custom G-code before this layer" onClick={() => add({ printZ: z, type: 'custom', extra: 'M117 Layer change' })}>
          ✎ Custom
        </button>
      </div>
      {disabled && <div className="muted small">Move the top slider above the first layer to add a change.</div>}
      {existing && <div className="muted small">Adding again replaces the {CODE_LABEL[existing.type].toLowerCase()} at this height.</div>}
      {codes.length > 0 && (
        <ul className="code-list">
          {codes.map((c) => (
            <li key={c.printZ} className={Math.abs(c.printZ - z) < 1e-4 ? 'current' : ''}>
              <span className="code-z">{c.printZ.toFixed(2)}</span>
              <span className="code-type">{CODE_LABEL[c.type]}</span>
              {c.type === 'color_change' && (
                <>
                  <input type="color" value={normalizeColor(c.color, '#ffffff')} onChange={(e) => update(c.printZ, { color: e.target.value })} title="Color after the change" />
                  {extruders > 1 && (
                    <select value={c.extruder ?? 1} onChange={(e) => update(c.printZ, { extruder: Number(e.target.value) })} title="Extruder">
                      {Array.from({ length: extruders }, (_, i) => (
                        <option key={i} value={i + 1}>
                          E{i + 1}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {c.type === 'pause' && (
                <TextField className="code-text" apply="input" value={c.extra ?? ''} onChange={(text) => update(c.printZ, { extra: text })} title="Message shown on the printer (M117)" />
              )}
              {c.type === 'custom' && (
                <TextField className="code-text" apply="input" multiline rows={2} spellCheck={false} value={c.extra ?? ''} onChange={(text) => update(c.printZ, { extra: text })} />
              )}
              <button className="icon" title="Remove" onClick={() => remove(c.printZ)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {codes.length > 0 && running && <div className="muted small">Updating G-code…</div>}
    </div>
  );
}
