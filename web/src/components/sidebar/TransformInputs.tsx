import type { Placement, Vec3 } from '../../api';
import { NumericField } from '../common/NumericField';
import { AXES, fmt } from './format';

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * The Position / Rotation / Scale / Size rows of the selected instance or volume. The fields are
 * live on `main`: every keystroke reaches the store.
 */
export function TransformInputs({ t, size, onChange }: { t: Placement; size: Vec3; onChange: (patch: Partial<Placement>) => void }) {
  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return (
    <>
      <div className="manip-row head">
        <span />
        {AXES.map((a) => (
          <span key={a} className={`axis ${a}`}>
            {a}
          </span>
        ))}
      </div>
      <div className="manip-row">
        <span>Position</span>
        {AXES.map((a, i) => (
          <NumericField
            key={a}
            text={fmt(t.position[i])}
            step={1}
            apply="input"
            onText={(text) => {
              const p = [...t.position] as [number, number, number];
              p[i] = num(text, p[i]);
              onChange({ position: p });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Rotation °</span>
        {AXES.map((a, i) => (
          <NumericField
            key={a}
            text={fmt(deg(t.rotation[i]), 1)}
            step={15}
            apply="input"
            onText={(text) => {
              const r = [...t.rotation] as [number, number, number];
              r[i] = rad(num(text, deg(r[i])));
              onChange({ rotation: r });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Scale %</span>
        {AXES.map((a, i) => (
          // AC-5: a mirrored instance has negative scale components internally; the panel shows
          // magnitudes and editing keeps the sign, so the object stays mirrored
          <NumericField
            key={a}
            text={fmt(Math.abs(t.scale[i]) * 100, 1)}
            step={5}
            apply="input"
            onText={(text) => {
              const v = num(text, Math.abs(t.scale[i]) * 100) / 100;
              if (v <= 0) return;
              const s = [...t.scale] as [number, number, number];
              s[i] = t.scale[i] < 0 ? -v : v;
              onChange({ scale: s });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Size mm</span>
        {AXES.map((a, i) => (
          <NumericField
            key={a}
            text={fmt(Math.abs(size[i] * t.scale[i]))}
            step={1}
            apply="input"
            onText={(text) => {
              const v = num(text, Math.abs(size[i] * t.scale[i]));
              if (v <= 0 || size[i] <= 0) return;
              const s = [...t.scale] as [number, number, number];
              s[i] = (t.scale[i] < 0 ? -v : v) / size[i];
              onChange({ scale: s });
            }}
          />
        ))}
      </div>
    </>
  );
}
