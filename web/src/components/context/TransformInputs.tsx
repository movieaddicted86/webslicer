import type { Placement, Vec3 } from '../../api';
import { NumericField } from '../common/NumericField';
import { AXES } from './axes';
import { fmt } from '../../format';

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** The unit a field carries inside its box, as the mockup draws it: the number left, the unit right. */
function Unit({ children }: { children: string }) {
  return <small className="unit">{children}</small>;
}

/**
 * The Position / Rotation / Size / Scale rows of the selected instance or volume, as the mockup draws
 * them: the axis letters over the columns in the axis colours, the row name on the left and three
 * fields per row whose unit sits inside the field instead of in the row label.
 *
 * The fields are live on `main`: every keystroke reaches the store. The unit inside the field is only
 * the picture – the rows keep the very values they had, and the store keeps its millimetres, degrees
 * and fractions.
 */
export function TransformInputs({ t, size, onChange }: { t: Placement; size: Vec3; onChange: (patch: Partial<Placement>) => void }) {
  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return (
    <div className="transform-rows">
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
          <span key={a} className="num-field">
            <NumericField
              text={fmt(t.position[i])}
              step={1}
              apply="input"
              title={`${a} position in mm`}
              onText={(text) => {
                const p = [...t.position] as [number, number, number];
                p[i] = num(text, p[i]);
                onChange({ position: p });
              }}
            />
            <Unit>mm</Unit>
          </span>
        ))}
      </div>
      <div className="manip-row">
        <span>Rotation</span>
        {AXES.map((a, i) => (
          <span key={a} className="num-field">
            <NumericField
              text={fmt(deg(t.rotation[i]), 1)}
              step={15}
              apply="input"
              title={`${a} rotation in degrees`}
              onText={(text) => {
                const r = [...t.rotation] as [number, number, number];
                r[i] = rad(num(text, deg(r[i])));
                onChange({ rotation: r });
              }}
            />
            <Unit>°</Unit>
          </span>
        ))}
      </div>
      <div className="manip-row">
        <span>Size</span>
        {AXES.map((a, i) => (
          <span key={a} className="num-field">
            <NumericField
              text={fmt(Math.abs(size[i] * t.scale[i]))}
              step={1}
              apply="input"
              title={`${a} size in mm`}
              onText={(text) => {
                const v = num(text, Math.abs(size[i] * t.scale[i]));
                if (v <= 0 || size[i] <= 0) return;
                const s = [...t.scale] as [number, number, number];
                s[i] = (t.scale[i] < 0 ? -v : v) / size[i];
                onChange({ scale: s });
              }}
            />
            <Unit>mm</Unit>
          </span>
        ))}
      </div>
      <div className="manip-row">
        <span>Scale</span>
        {AXES.map((a, i) => (
          // AC-5: a mirrored instance has negative scale components internally; the panel shows
          // magnitudes and editing keeps the sign, so the object stays mirrored
          <span key={a} className="num-field">
            <NumericField
              text={fmt(Math.abs(t.scale[i]) * 100, 1)}
              step={5}
              apply="input"
              title={`${a} scale in percent`}
              onText={(text) => {
                const v = num(text, Math.abs(t.scale[i]) * 100) / 100;
                if (v <= 0) return;
                const s = [...t.scale] as [number, number, number];
                s[i] = t.scale[i] < 0 ? -v : v;
                onChange({ scale: s });
              }}
            />
            <Unit>%</Unit>
          </span>
        ))}
      </div>
    </div>
  );
}
