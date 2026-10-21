import { useStore, type PlaterObject } from '../../state/store';
import { SectionHeader } from '../common/SectionHeader';
import { extruderCss } from '../../palette';

/** Support / seam / extruder painting controls for the selected object */
export function PaintPanel({ o }: { o: PlaterObject }) {
  const paintMode = useStore((s) => s.paintMode);
  const paintTool = useStore((s) => s.paintTool);
  const brushRadius = useStore((s) => s.brushRadius);
  const startPaint = useStore((s) => s.startPaint);
  const stopPaint = useStore((s) => s.stopPaint);
  const setPaintTool = useStore((s) => s.setPaintTool);
  const setBrushRadius = useStore((s) => s.setBrushRadius);
  const clearPaint = useStore((s) => s.clearPaint);
  const extruders = useStore((s) => s.extruderCount());
  const paintExtruder = useStore((s) => s.paintExtruder);
  const setPaintExtruder = useStore((s) => s.setPaintExtruder);
  const count = (arr?: Uint8Array) => (arr ? arr.reduce((a, v) => a + (v ? 1 : 0), 0) : 0);
  const nSup = count(o.paint?.supports);
  const nSeam = count(o.paint?.seam);
  const nMmu = count(o.paint?.mmu);
  if (!paintMode) {
    return (
      <div className="paint-panel">
        <div className="manip-actions">
          <button onClick={() => startPaint(o.id, 'supports')} title="Paint support enforcers / blockers (L)">
            🖌 Supports{nSup ? ` (${nSup})` : ''}
          </button>
          <button onClick={() => startPaint(o.id, 'seam')} title="Paint seam enforcers / blockers (P)">
            🖌 Seam{nSeam ? ` (${nSeam})` : ''}
          </button>
          {extruders > 1 && (
            <button onClick={() => startPaint(o.id, 'mmu')} title="Paint extruder per triangle (multi-material)">
              🖌 Extruder{nMmu ? ` (${nMmu})` : ''}
            </button>
          )}
        </div>
      </div>
    );
  }
  const title = paintMode === 'supports' ? 'Paint supports' : paintMode === 'seam' ? 'Paint seam' : 'Paint extruder';
  return (
    <div className="paint-panel active">
      <SectionHeader title={title}>
        <button className="primary" onClick={stopPaint}>
          Done
        </button>
      </SectionHeader>
      {paintMode === 'mmu' ? (
        <div className="paint-tools">
          {Array.from({ length: extruders }, (_, i) => i + 1).map((n) => (
            <label
              key={n}
              className={`tool extruder ${paintExtruder === n ? 'active' : ''}`}
              style={{ borderColor: paintExtruder === n ? extruderCss(n) : undefined }}
            >
              <input type="radio" checked={paintExtruder === n} onChange={() => setPaintExtruder(n)} />
              <span className="swatch" style={{ background: extruderCss(n) }} /> {n}
            </label>
          ))}
        </div>
      ) : (
        <div className="paint-tools">
          <label className={`tool enforcer ${paintTool === 'enforcer' ? 'active' : ''}`} title="Left mouse button">
            <input type="radio" checked={paintTool === 'enforcer'} onChange={() => setPaintTool('enforcer')} /> Enforcer
          </label>
          <label className={`tool blocker ${paintTool === 'blocker' ? 'active' : ''}`} title="Left mouse button (or right button any time)">
            <input type="radio" checked={paintTool === 'blocker'} onChange={() => setPaintTool('blocker')} /> Blocker
          </label>
          <label className={`tool erase ${paintTool === 'erase' ? 'active' : ''}`} title="Left mouse button (or Shift+left any time)">
            <input type="radio" checked={paintTool === 'erase'} onChange={() => setPaintTool('erase')} /> Erase
          </label>
        </div>
      )}
      <label className="brush">
        <span>Brush {brushRadius.toFixed(1)} mm</span>
        <input type="range" min={0.5} max={25} step={0.5} value={brushRadius} onChange={(e) => setBrushRadius(Number(e.target.value))} />
      </label>
      <div className="manip-actions">
        <button
          onClick={() => clearPaint(o.id, paintMode)}
          disabled={!(paintMode === 'supports' ? nSup : paintMode === 'seam' ? nSeam : nMmu)}
        >
          Clear all
        </button>
      </div>
      <div className="muted small">
        {paintMode === 'supports'
          ? 'Enforcers force supports, blockers prevent them. Set Supports to "For support enforcers only" or "Everywhere".'
          : paintMode === 'seam'
            ? 'Enforcers attract the seam, blockers repel it.'
            : 'Painted triangles are printed with the selected extruder; unpainted ones use the object extruder.'}
      </div>
    </div>
  );
}
