import { MARKER_KINDS, type MarkerKind, type ParsedGcode } from './types';

const TYPE_MAP: Record<string, string> = {
  Perimeter: 'Perimeter',
  'External perimeter': 'External perimeter',
  'Overhang perimeter': 'Overhang perimeter',
  'Internal infill': 'Internal infill',
  'Solid infill': 'Solid infill',
  'Top solid infill': 'Top solid infill',
  Ironing: 'Ironing',
  'Bridge infill': 'Bridge infill',
  'Gap fill': 'Gap fill',
  Skirt: 'Skirt/Brim',
  'Skirt/Brim': 'Skirt/Brim',
  'Support material': 'Support material',
  'Support material interface': 'Support material interface',
  'Wipe tower': 'Wipe tower',
  Custom: 'Custom',
};

class GrowArray<T extends Float32Array | Uint8Array | Uint32Array> {
  arr: T;
  len = 0;
  constructor(
    private ctor: new (n: number) => T,
    initial = 1 << 16,
  ) {
    this.arr = new ctor(initial);
  }
  push(...vals: number[]) {
    if (this.len + vals.length > this.arr.length) {
      const next = new this.ctor(Math.max(this.arr.length * 2, this.len + vals.length));
      next.set(this.arr);
      this.arr = next;
    }
    for (const v of vals) this.arr[this.len++] = v;
  }
  trim(): T {
    return this.arr.slice(0, this.len) as T;
  }
}

/** Value of "; key = value" from the config block PrusaSlicer appends to the G-code. */
function configValue(text: string, key: string): string | undefined {
  const i = text.lastIndexOf(`\n; ${key} = `);
  if (i < 0) return undefined;
  const start = i + key.length + 6;
  const end = text.indexOf('\n', start);
  return text.substring(start, end < 0 ? text.length : end).trim();
}
const firstNumber = (v: string | undefined, fallback: number) => {
  const n = parseFloat((v ?? '').split(/[,;]/)[0]);
  return Number.isFinite(n) ? n : fallback;
};

export function parseGcode(text: string): ParsedGcode {
  const positions = new GrowArray(Float32Array, 1 << 20);
  const speeds = new GrowArray(Float32Array, 1 << 18);
  const fans = new GrowArray(Float32Array, 1 << 18);
  const temps = new GrowArray(Float32Array, 1 << 18);
  const widths = new GrowArray(Float32Array, 1 << 18);
  const heights = new GrowArray(Float32Array, 1 << 18);
  const flows = new GrowArray(Float32Array, 1 << 18);
  const layerTime: number[] = [];
  const diameter = firstNumber(configValue(text, 'filament_diameter'), 1.75);
  const filamentArea = Math.PI * (diameter / 2) ** 2;
  // nozzle temperature until the first M104/M109 (start G-code macros often hide it)
  const cfgTemp = firstNumber(configValue(text, 'temperature'), 0);
  const cfgFirstTemp = firstNumber(configValue(text, 'first_layer_temperature'), cfgTemp);
  let feed = 0; // mm/s
  let fan = 0;
  let temp = NaN;
  let width = 0;
  let height = 0;
  let mm3PerMm = 0; // extruded volume per mm of the last move long enough for a reliable value
  const types = new GrowArray(Uint8Array, 1 << 18);
  const layers = new GrowArray(Uint32Array, 1 << 18);
  const tools = new GrowArray(Uint8Array, 1 << 18);
  const moveIndex = new GrowArray(Uint32Array, 1 << 18);
  const travelPositions = new GrowArray(Float32Array, 1 << 18);
  const travelLayers = new GrowArray(Uint32Array, 1 << 16);
  const travelMove = new GrowArray(Uint32Array, 1 << 16);
  const wipePositions = new GrowArray(Float32Array, 1 << 14);
  const wipeLayers = new GrowArray(Uint32Array, 1 << 14);
  const wipeMove = new GrowArray(Uint32Array, 1 << 14);
  const markerKind = new GrowArray(Uint8Array, 1 << 12);
  const markerPositions = new GrowArray(Float32Array, 1 << 12);
  const markerLayer = new GrowArray(Uint32Array, 1 << 12);
  const markerMove = new GrowArray(Uint32Array, 1 << 12);
  const featureTypes: string[] = [];
  const featureIndex = new Map<string, number>();
  const featureLength: Record<string, number> = {};
  // per-feature time in seconds, same model as layerTime (distance / feedrate), so both sums agree;
  // travel has a row of its own, a wipe counts towards the feature it belongs to
  const featureTime: Record<string, number> = {};
  const typeIdx = (name: string) => {
    let i = featureIndex.get(name);
    if (i === undefined) {
      i = featureTypes.length;
      featureTypes.push(name);
      featureIndex.set(name, i);
    }
    return i;
  };

  let x = 0,
    y = 0,
    z = 0,
    e = 0;
  let absolute = true;
  let absoluteE = true;
  let curType = typeIdx('Unknown');
  let curTool = 0;
  let layer = -1;
  const layerZ: number[] = [];
  const layerStart: number[] = [];
  const travelLayerStart: number[] = [];
  const wipeLayerStart: number[] = [];
  let segCount = 0;
  let travelCount = 0;
  let wipeCount = 0;
  // global move counter in G-code order: extrusion, travel and wipe segments all take one number,
  // so the horizontal slider can cut the print at an exact move
  let move = 0;
  // retract/deretract stand on their own line (E move without XYZ); an E move inside a G1 with XYZ
  // is an extrusion (or the deretract that follows a lift) and is not a marker
  let lastEMove = 0;
  let wiping = false;
  // first extrusion after ;TYPE:External perimeter, i.e. the loop's seam
  let externalPerimeter = false;
  let sawExtrusionSinceType = false;
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  let pendingLayerChange = false;

  const kindIdx = new Map<MarkerKind, number>(MARKER_KINDS.map((k, i) => [k, i]));
  const addMarker = (kind: MarkerKind, mx: number, my: number, mz: number, atMove = move) => {
    markerKind.push(kindIdx.get(kind)!);
    markerPositions.push(mx, my, mz);
    markerLayer.push(layer < 0 ? 0 : layer);
    markerMove.push(atMove);
  };

  const newLayer = (zval: number) => {
    layer++;
    layerZ.push(zval);
    layerStart.push(segCount);
    travelLayerStart.push(travelCount);
    wipeLayerStart.push(wipeCount);
    layerTime.push(0);
  };

  const len = text.length;
  let pos = 0;
  while (pos < len) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = len;
    let line = text.substring(pos, end);
    pos = end + 1;
    if (!line) continue;
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    const c0 = line.charCodeAt(0);
    if (c0 === 59 /* ; */) {
      if (line.startsWith(';TYPE:')) {
        const t = line.slice(6).trim();
        curType = typeIdx(TYPE_MAP[t] || t || 'Unknown');
        externalPerimeter = featureTypes[curType] === 'External perimeter';
        sawExtrusionSinceType = false;
      } else if (line.startsWith(';WIPE_START')) {
        wiping = true;
        addMarker('wipe', x, y, z);
      } else if (line.startsWith(';WIPE_END')) {
        wiping = false;
        addMarker('wipe', x, y, z);
      } else if (line.startsWith(';LAYER_CHANGE')) {
        pendingLayerChange = true;
      } else if (line.startsWith(';Z:') && pendingLayerChange) {
        const zv = parseFloat(line.slice(3));
        if (!Number.isNaN(zv)) {
          newLayer(zv);
          pendingLayerChange = false;
        }
      } else if (line.startsWith(';WIDTH:')) {
        width = parseFloat(line.slice(7)) || width;
      } else if (line.startsWith(';HEIGHT:')) {
        height = parseFloat(line.slice(8)) || height;
      }
      continue;
    }
    if (c0 !== 71 /* G */ && c0 !== 77 /* M */ && c0 !== 84 /* T */) continue;
    const sc = line.indexOf(';');
    if (sc >= 0) line = line.slice(0, sc);
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    if (cmd === 'G0' || cmd === 'G1') {
      let nx = x,
        ny = y,
        nz = z,
        ne = e;
      let hasE = false;
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const v = parseFloat(p.slice(1));
        if (Number.isNaN(v)) continue;
        switch (p[0]) {
          case 'X':
            nx = absolute ? v : x + v;
            break;
          case 'Y':
            ny = absolute ? v : y + v;
            break;
          case 'Z':
            nz = absolute ? v : z + v;
            break;
          case 'E':
            ne = absoluteE ? v : e + v;
            hasE = true;
            break;
          case 'F':
            feed = v / 60;
            break;
        }
      }
      const de = hasE ? ne - e : 0;
      const moved = nx !== x || ny !== y || nz !== z;
      if (moved) {
        const dist = Math.hypot(nx - x, ny - y, nz - z);
        if (layer < 0) newLayer(nz);
        if (feed > 0) layerTime[layer] += dist / feed;
        if (feed > 0) {
          const tname = de > 0 || wiping ? featureTypes[curType] : 'Travel';
          featureTime[tname] = (featureTime[tname] || 0) + dist / feed;
        }
        if (de > 0) {
          const atMove = move++;
          positions.push(x, y, z, nx, ny, nz);
          types.push(curType);
          layers.push(layer);
          tools.push(curTool);
          speeds.push(feed);
          fans.push(fan);
          temps.push(Number.isNaN(temp) ? (layer === 0 ? cfgFirstTemp : cfgTemp) : temp);
          widths.push(width);
          heights.push(height);
          // E is rounded in the G-code, so very short moves give noisy ratios
          if (dist >= 0.2 || mm3PerMm === 0) mm3PerMm = (de * filamentArea) / dist;
          flows.push(mm3PerMm * feed);
          moveIndex.push(atMove);
          segCount++;
          const fname = featureTypes[curType];
          featureLength[fname] = (featureLength[fname] || 0) + dist;
          if (externalPerimeter && !sawExtrusionSinceType && !wiping) addMarker('seam', x, y, z, atMove);
          sawExtrusionSinceType = true;
          for (const [i, v] of [nx, ny, nz].entries()) {
            if (v < bmin[i]) bmin[i] = v;
            if (v > bmax[i]) bmax[i] = v;
          }
        } else if (wiping) {
          // wipe moves are their own kind: neither extrusion nor travel
          wipePositions.push(x, y, z, nx, ny, nz);
          wipeLayers.push(layer < 0 ? 0 : layer);
          wipeMove.push(move++);
          wipeCount++;
        } else {
          travelPositions.push(x, y, z, nx, ny, nz);
          travelLayers.push(layer);
          travelMove.push(move++);
          travelCount++;
        }
      }
      if (de < 0 && !moved) addMarker('retract', x, y, z);
      else if (de > 0 && !moved && lastEMove <= 0) addMarker('deretract', x, y, z);
      lastEMove = de;
      x = nx;
      y = ny;
      z = nz;
      e = ne;
    } else if (cmd === 'M106' || cmd === 'M107') {
      const sArg = cmd === 'M106' ? parts.find((p) => p[0] === 'S') : undefined;
      fan = cmd === 'M107' ? 0 : Math.min(100, Math.max(0, ((sArg ? parseFloat(sArg.slice(1)) : 255) / 255) * 100));
    } else if (cmd === 'M104' || cmd === 'M109') {
      const sArg = parts.find((p) => p[0] === 'S' || p[0] === 'R');
      const v = sArg ? parseFloat(sArg.slice(1)) : NaN;
      // a temperature for another tool (T parameter) does not change the active nozzle
      const tArg = parts.find((p) => p[0] === 'T');
      if (Number.isFinite(v) && (!tArg || parseInt(tArg.slice(1), 10) === curTool)) temp = v;
    } else if (cmd === 'M600' || cmd === 'M601') {
      // PrusaSlicer's colour change (M600) and pause (M601), from the custom G-code list
      if (cmd === 'M600') addMarker('color_change', x, y, z);
    } else if (cmd === 'G90') absolute = true;
    else if (cmd === 'G91') absolute = false;
    else if (cmd === 'M82') absoluteE = true;
    else if (cmd === 'M83') absoluteE = false;
    else if (cmd === 'G92') {
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const v = parseFloat(p.slice(1));
        if (Number.isNaN(v)) continue;
        if (p[0] === 'E') e = v;
        else if (p[0] === 'X') x = v;
        else if (p[0] === 'Y') y = v;
        else if (p[0] === 'Z') z = v;
      }
    } else if (cmd === 'G28') {
      if (parts.length === 1) {
        x = 0;
        y = 0;
        z = 0;
      } else {
        for (let i = 1; i < parts.length; i++) {
          const p = parts[i];
          if (p[0] === 'X') x = 0;
          if (p[0] === 'Y') y = 0;
          if (p[0] === 'Z') z = 0;
        }
      }
    } else if (cmd[0] === 'T') {
      const t = parseInt(cmd.slice(1), 10);
      if (!Number.isNaN(t)) {
        if (t !== curTool) addMarker('tool_change', x, y, z);
        curTool = t;
      }
    }
  }
  if (layer < 0) newLayer(0);
  layerStart.push(segCount);
  travelLayerStart.push(travelCount);
  wipeLayerStart.push(wipeCount);
  if (!Number.isFinite(bmin[0])) {
    bmin.fill(0);
    bmax.fill(0);
  }
  return {
    positions: positions.trim(),
    types: types.trim(),
    layers: layers.trim(),
    tools: tools.trim(),
    moveIndex: moveIndex.trim(),
    travelPositions: travelPositions.trim(),
    travelLayers: travelLayers.trim(),
    travelMove: travelMove.trim(),
    wipePositions: wipePositions.trim(),
    wipeLayers: wipeLayers.trim(),
    wipeMove: wipeMove.trim(),
    wipeLayerStart: Uint32Array.from(wipeLayerStart),
    wipeCount,
    markerKind: markerKind.trim(),
    markerPositions: markerPositions.trim(),
    markerLayer: markerLayer.trim(),
    markerMove: markerMove.trim(),
    markerCount: markerKind.len,
    layerZ: Float32Array.from(layerZ),
    layerCount: layerZ.length,
    featureTypes,
    layerStart: Uint32Array.from(layerStart),
    travelLayerStart: Uint32Array.from(travelLayerStart),
    bbox: { min: bmin as [number, number, number], max: bmax as [number, number, number] },
    segmentCount: segCount,
    featureLength,
    featureTime,
    speed: speeds.trim(),
    fan: fans.trim(),
    temperature: temps.trim(),
    width: widths.trim(),
    height: heights.trim(),
    flow: flows.trim(),
    layerTime: Float32Array.from(layerTime),
  };
}
