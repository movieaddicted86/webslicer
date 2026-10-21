import { useState } from 'react';
import type { OptionDef } from '../api';
import { decodeVector, encodeVector, parsePoints, serializePoints, toBool } from '../values';
import { NumericField } from './common/NumericField';
import { TextField } from './common/TextField';

interface Props {
  def: OptionDef;
  value: string | undefined;
  savedValue: string | undefined;
  onChange: (v: string) => void;
  onReset: () => void;
  /** number of extruders for per-extruder vectors (ignored for filament presets) */
  extruders: number;
  /** For filament presets only index 0 is edited */
  singleElement?: boolean;
  disabled?: boolean;
}

function ScalarInput({
  def,
  value,
  onChange,
  disabled,
}: {
  def: OptionDef;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const scalarType = def.type.replace(/s$/, '').replace('floats_or_percent', 'float_or_percent');
  switch (scalarType) {
    case 'bool':
      return <input type="checkbox" checked={toBool(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked ? '1' : '0')} />;
    case 'enum':
      return (
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {!def.enumValues?.includes(value) && <option value={value}>{value}</option>}
          {def.enumValues?.map((v, i) => (
            <option key={v} value={v}>
              {def.enumLabels?.[i] || v}
            </option>
          ))}
        </select>
      );
    case 'int':
    case 'float':
      return <NumericField text={value} onText={onChange} step={scalarType === 'int' ? 1 : 'any'} disabled={disabled} />;
    case 'string':
      if (def.multiline || def.gcode) {
        return <TextField value={value} onChange={onChange} multiline rows={def.gcode ? 8 : 3} className={def.gcode ? 'gcode' : ''} spellCheck={false} disabled={disabled} />;
      }
      return <TextField value={value} onChange={onChange} type="text" disabled={disabled} />;
    default:
      // percent, float_or_percent, point…
      return <TextField value={value} onChange={onChange} type="text" className="short" disabled={disabled} />;
  }
}

function BedShapeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pts = parsePoints(value);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs, 0),
    maxX = Math.max(...xs, 0),
    minY = Math.min(...ys, 0),
    maxY = Math.max(...ys, 0);
  const isRect = pts.length === 4;
  const [custom, setCustom] = useState(!isRect);
  const [text, setText] = useState(value);
  const setRect = (nx: number, ny: number, ox: number, oy: number) => {
    onChange(serializePoints([[-ox, -oy], [nx - ox, -oy], [nx - ox, ny - oy], [-ox, ny - oy]]));
  };
  const sizeX = maxX - minX,
    sizeY = maxY - minY,
    originX = -minX,
    originY = -minY;
  return (
    <div className="bed-editor">
      {!custom ? (
        <div className="bed-grid">
          <label>Size X</label>
          <input type="number" value={sizeX} onChange={(e) => setRect(Number(e.target.value), sizeY, originX, originY)} />
          <label>Size Y</label>
          <input type="number" value={sizeY} onChange={(e) => setRect(sizeX, Number(e.target.value), originX, originY)} />
          <label>Origin X</label>
          <input type="number" value={originX} onChange={(e) => setRect(sizeX, sizeY, Number(e.target.value), originY)} />
          <label>Origin Y</label>
          <input type="number" value={originY} onChange={(e) => setRect(sizeX, sizeY, originX, Number(e.target.value))} />
        </div>
      ) : (
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text)} placeholder="0x0,250x0,250x210,0x210" />
      )}
      <label className="checkbox small">
        <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Custom shape (polygon points "XxY,…")
      </label>
    </div>
  );
}

export function OptionField({ def, value, savedValue, onChange, onReset, extruders, singleElement, disabled }: Props) {
  const raw = value ?? def.default;
  const modified = (savedValue ?? def.default) !== raw;
  const isVec = ['floats', 'ints', 'bools', 'strings', 'percents', 'floats_or_percents', 'points'].includes(def.type) && def.key !== 'bed_shape';
  let body;
  if (def.key === 'bed_shape') {
    body = <BedShapeEditor value={raw} onChange={onChange} />;
  } else if (isVec) {
    const values = decodeVector(def, raw);
    const n = singleElement ? 1 : def.perExtruder ? extruders : def.key.startsWith('machine_') ? 2 : Math.max(1, values.length);
    while (values.length < n) values.push(values[values.length - 1] ?? decodeVector(def, def.default)[0] ?? '');
    const labels = def.key.startsWith('machine_') ? ['Normal', 'Stealth'] : Array.from({ length: n }, (_, i) => `#${i + 1}`);
    body = (
      <div className={`vector ${n > 1 ? 'multi' : ''}`}>
        {values.slice(0, n).map((v, i) => {
          const isNil = def.nullable && v === 'nil';
          return (
            <div key={i} className="vector-item">
              {n > 1 && <span className="vec-label">{labels[i]}</span>}
              {def.nullable && (
                <input
                  type="checkbox"
                  title="Override printer value"
                  checked={!isNil}
                  onChange={(e) => {
                    const next = [...values];
                    next[i] = e.target.checked ? (def.type === 'bools' ? '1' : '0') : 'nil';
                    onChange(encodeVector(def, next.slice(0, n)));
                  }}
                />
              )}
              <ScalarInput
                def={def}
                value={isNil ? '' : v}
                disabled={disabled || isNil}
                onChange={(nv) => {
                  const next = [...values];
                  next[i] = nv;
                  onChange(encodeVector(def, next.slice(0, n)));
                }}
              />
            </div>
          );
        })}
      </div>
    );
  } else {
    const [v] = decodeVector(def, raw);
    body = <ScalarInput def={def} value={v ?? ''} disabled={disabled} onChange={(nv) => onChange(encodeVector(def, [nv]))} />;
  }
  return (
    <div className={`option ${modified ? 'modified' : ''} ${def.multiline || def.gcode || def.key === 'bed_shape' ? 'block' : ''}`} id={`opt-${def.key}`}>
      <label title={`${def.key}\n\n${def.tooltip}`}>
        {modified && <span className="dot" />}
        {def.label}
      </label>
      <div className="control">
        {body}
        {def.sidetext && <span className="sidetext">{def.sidetext}</span>}
        {modified && (
          <button className="icon reset" title="Reset to preset value" onClick={onReset}>
            ↶
          </button>
        )}
      </div>
    </div>
  );
}
