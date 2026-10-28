import { useState } from 'react';
import type { ConfigIssue } from '@webslicer/shared';
import type { OptionDef } from '../api';
import { decodeVector, encodeVector, parsePoints, serializePoints, toBool } from '../values';
import { NumericField } from './common/NumericField';
import { TextField } from './common/TextField';
import { hexColourValue, isValidColour, pickerColour } from './colour';
import './OptionField.css';
import { Icon } from '../icons/Icon';

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
  /** a configuration limit this field breaks (S1-e): block = red, warn = yellow */
  issue?: ConfigIssue;
}

/**
 * The filament colour: a native colour picker next to the hex field, both editing the same
 * stored value. The picker can only show one `#rrggbb`, so a list of colours keeps the plain field.
 */
function ColourField({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const picker = pickerColour(value);
  const valid = isValidColour(value);
  return (
    <div className={`colour-field ${valid ? '' : 'invalid'}`} data-testid="colour-field">
      <input
        type="color"
        className="colour-swatch"
        data-testid="colour-picker"
        aria-label="Pick the filament colour"
        value={picker ?? '#808080'}
        disabled={disabled}
        onChange={(e) => onChange(hexColourValue(e.target.value))}
      />
      <TextField
        id={id}
        value={value}
        onChange={(t) => onChange(hexColourValue(t))}
        type="text"
        className="colour-hex"
        spellCheck={false}
        disabled={disabled}
      />
      {!valid && (
        <p className="field-issue warn" role="status">
          Use a hex colour such as #FF8000.
        </p>
      )}
    </div>
  );
}

function ScalarInput({
  def,
  value,
  onChange,
  disabled,
  id,
}: {
  def: OptionDef;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** the control's `id`: the row `<label htmlFor>` points at it (W10) */
  id: string;
}) {
  const scalarType = def.type.replace(/s$/, '').replace('floats_or_percent', 'float_or_percent');
  switch (scalarType) {
    case 'bool':
      return (
        <input
          id={id}
          type="checkbox"
          checked={toBool(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? '1' : '0')}
        />
      );
    case 'enum':
      return (
        <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
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
      return <NumericField id={id} text={value} onText={onChange} step={scalarType === 'int' ? 1 : 'any'} disabled={disabled} />;
    case 'string':
      // a filament colour is one colour per extruder slot; with a colour list the plain field stays
      if (def.key === 'filament_colour' && !value.includes(';') && !value.includes('"')) {
        return <ColourField id={id} value={value} onChange={onChange} disabled={disabled} />;
      }
      if (def.multiline || def.gcode) {
        return (
          <TextField
            id={id}
            value={value}
            onChange={onChange}
            multiline
            rows={def.gcode ? 8 : 3}
            className={def.gcode ? 'gcode' : ''}
            spellCheck={false}
            disabled={disabled}
          />
        );
      }
      return <TextField id={id} value={value} onChange={onChange} type="text" disabled={disabled} />;
    default:
      // percent, float_or_percent, point…
      return <TextField id={id} value={value} onChange={onChange} type="text" className="short" disabled={disabled} />;
  }
}

interface BedEditorState {
  text: string;
  custom: boolean;
}

/**
 * B11: the state the bed editor shows after the incoming value changed from outside (a printer
 * switch). A rect stays editable as a rect, a polygon as a polygon; without this the editor kept the
 * previous printer's text and wrote it back on blur.
 */
export function syncBedEditor(value: string, shown: string, state: BedEditorState): BedEditorState {
  if (value === shown) return state;
  return { text: value, custom: parsePoints(value).length !== 4 };
}

function BedShapeEditor({ value, onChange, idPrefix }: { value: string; onChange: (v: string) => void; idPrefix: string }) {
  const pts = parsePoints(value);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs, 0),
    maxX = Math.max(...xs, 0),
    minY = Math.min(...ys, 0),
    maxY = Math.max(...ys, 0);
  const isRect = pts.length === 4;
  const [state, setState] = useState<BedEditorState>({ text: value, custom: !isRect });
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setState(syncBedEditor(value, shown, state));
  }
  const { custom, text } = state;
  const setText = (t: string) => setState({ ...state, text: t });
  const setRect = (nx: number, ny: number, ox: number, oy: number) => {
    onChange(
      serializePoints([
        [-ox, -oy],
        [nx - ox, -oy],
        [nx - ox, ny - oy],
        [-ox, ny - oy],
      ]),
    );
  };
  const sizeX = maxX - minX,
    sizeY = maxY - minY,
    originX = -minX,
    originY = -minY;
  return (
    <div className="bed-editor">
      {!custom ? (
        <div className="bed-grid">
          <label htmlFor={`${idPrefix}-size-x`}>Size X</label>
          <input
            id={`${idPrefix}-size-x`}
            type="number"
            inputMode="decimal"
            value={sizeX}
            onChange={(e) => setRect(Number(e.target.value), sizeY, originX, originY)}
          />
          <label htmlFor={`${idPrefix}-size-y`}>Size Y</label>
          <input
            id={`${idPrefix}-size-y`}
            type="number"
            inputMode="decimal"
            value={sizeY}
            onChange={(e) => setRect(sizeX, Number(e.target.value), originX, originY)}
          />
          <label htmlFor={`${idPrefix}-origin-x`}>Origin X</label>
          <input
            id={`${idPrefix}-origin-x`}
            type="number"
            inputMode="decimal"
            value={originX}
            onChange={(e) => setRect(sizeX, sizeY, Number(e.target.value), originY)}
          />
          <label htmlFor={`${idPrefix}-origin-y`}>Origin Y</label>
          <input
            id={`${idPrefix}-origin-y`}
            type="number"
            inputMode="decimal"
            value={originY}
            onChange={(e) => setRect(sizeX, sizeY, originX, Number(e.target.value))}
          />
        </div>
      ) : (
        <textarea
          id={`${idPrefix}-polygon`}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onChange(text)}
          aria-label="Polygon points"
          placeholder="0x0,250x0,250x210,0x210"
        />
      )}
      <label className="checkbox small">
        <input type="checkbox" checked={custom} onChange={(e) => setState({ ...state, custom: e.target.checked })} /> Custom shape (polygon
        points "XxY,…")
      </label>
    </div>
  );
}

export function OptionField({ def, value, savedValue, onChange, onReset, extruders, singleElement, disabled, issue }: Props) {
  const raw = value ?? def.default;
  const modified = (savedValue ?? def.default) !== raw;
  const isVec =
    ['floats', 'ints', 'bools', 'strings', 'percents', 'floats_or_percents', 'points'].includes(def.type) && def.key !== 'bed_shape';
  let body;
  // W10: the row label points at its control. A vector row has one control per element, so each of
  // those gets its own id and the row is named after the first one only if there is just one.
  const controlId = `opt-${def.key}-value`;
  let labelledControl: string | null = controlId;
  if (def.key === 'bed_shape') {
    body = <BedShapeEditor value={raw} onChange={onChange} idPrefix={`opt-${def.key}`} />;
    labelledControl = null;
  } else if (isVec) {
    const values = decodeVector(def, raw);
    const n = singleElement ? 1 : def.perExtruder ? extruders : def.key.startsWith('machine_') ? 2 : Math.max(1, values.length);
    while (values.length < n) values.push(values[values.length - 1] ?? decodeVector(def, def.default)[0] ?? '');
    const labels = def.key.startsWith('machine_') ? ['Normal', 'Stealth'] : Array.from({ length: n }, (_, i) => `#${i + 1}`);
    labelledControl = n === 1 ? `${controlId}-0` : null;
    body = (
      <div className={`vector ${n > 1 ? 'multi' : ''}`}>
        {values.slice(0, n).map((v, i) => {
          const isNil = def.nullable && v === 'nil';
          const id = `${controlId}-${i}`;
          return (
            <div key={i} className="vector-item">
              {n > 1 && (
                <label className="vec-label" htmlFor={id}>
                  {labels[i]}
                </label>
              )}
              {def.nullable && (
                <input
                  type="checkbox"
                  title="Override printer value"
                  aria-label={`Use the printer value for ${labels[i] ?? def.label}`}
                  checked={!isNil}
                  onChange={(e) => {
                    const next = [...values];
                    next[i] = e.target.checked ? (def.type === 'bools' ? '1' : '0') : 'nil';
                    onChange(encodeVector(def, next.slice(0, n)));
                  }}
                />
              )}
              <ScalarInput
                id={id}
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
    body = (
      <ScalarInput id={controlId} def={def} value={v ?? ''} disabled={disabled} onChange={(nv) => onChange(encodeVector(def, [nv]))} />
    );
  }
  return (
    <div
      className={`option ${modified ? 'modified' : ''} ${def.multiline || def.gcode || def.key === 'bed_shape' ? 'block' : ''} ${
        issue ? `issue-${issue.severity}` : ''
      }`}
      id={`opt-${def.key}`}
    >
      <label htmlFor={labelledControl ?? undefined} title={`${def.key}\n\n${def.tooltip}`}>
        {modified && <span className="dot" />}
        {def.label}
      </label>
      <div className="control">
        {body}
        {def.sidetext && <span className="sidetext">{def.sidetext}</span>}
        {modified && (
          <button className="icon reset" title="Reset to preset value" aria-label="Reset to preset value" onClick={onReset}>
            <Icon name="reset" size={14} />
          </button>
        )}
        {/* S1-e: the message under the field names the limit, not only the value */}
        {issue && (
          <p className={`field-issue ${issue.severity}`} role={issue.severity === 'block' ? 'alert' : 'status'}>
            {issue.message}
          </p>
        )}
      </div>
    </div>
  );
}
