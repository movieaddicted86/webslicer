import type { ParsedGcode } from './types';

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
  constructor(private ctor: new (n: number) => T, initial = 1 << 16) {
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

export function parseGcode(text: string): ParsedGcode {
  const positions = new GrowArray(Float32Array, 1 << 20);
  const types = new GrowArray(Uint8Array, 1 << 18);
  const layers = new GrowArray(Uint32Array, 1 << 18);
  const tools = new GrowArray(Uint8Array, 1 << 18);
  const travelPositions = new GrowArray(Float32Array, 1 << 18);
  const travelLayers = new GrowArray(Uint32Array, 1 << 16);
  const featureTypes: string[] = [];
  const featureIndex = new Map<string, number>();
  const featureLength: Record<string, number> = {};
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
  let segCount = 0;
  let travelCount = 0;
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  let lastExtrudeZ = NaN;
  let pendingLayerChange = false;

  const newLayer = (zval: number) => {
    layer++;
    layerZ.push(zval);
    layerStart.push(segCount);
    travelLayerStart.push(travelCount);
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
      } else if (line.startsWith(';LAYER_CHANGE')) {
        pendingLayerChange = true;
      } else if (line.startsWith(';Z:') && pendingLayerChange) {
        const zv = parseFloat(line.slice(3));
        if (!Number.isNaN(zv)) {
          newLayer(zv);
          lastExtrudeZ = zv;
          pendingLayerChange = false;
        }
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
        }
      }
      const de = hasE ? ne - e : 0;
      const moved = nx !== x || ny !== y || nz !== z;
      if (moved) {
        if (de > 0) {
          if (layer < 0 || (Number.isNaN(lastExtrudeZ) ? false : false)) {
            if (layer < 0) newLayer(nz);
          }
          if (layer < 0) newLayer(nz);
          positions.push(x, y, z, nx, ny, nz);
          types.push(curType);
          layers.push(layer);
          tools.push(curTool);
          segCount++;
          const fname = featureTypes[curType];
          featureLength[fname] = (featureLength[fname] || 0) + Math.hypot(nx - x, ny - y, nz - z);
          for (const [i, v] of [nx, ny, nz].entries()) {
            if (v < bmin[i]) bmin[i] = v;
            if (v > bmax[i]) bmax[i] = v;
          }
        } else {
          if (layer < 0) newLayer(nz);
          travelPositions.push(x, y, z, nx, ny, nz);
          travelLayers.push(layer);
          travelCount++;
        }
      }
      x = nx;
      y = ny;
      z = nz;
      e = ne;
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
      if (!Number.isNaN(t)) curTool = t;
    }
  }
  if (layer < 0) newLayer(0);
  layerStart.push(segCount);
  travelLayerStart.push(travelCount);
  if (!Number.isFinite(bmin[0])) {
    bmin.fill(0);
    bmax.fill(0);
  }
  return {
    positions: positions.trim(),
    types: types.trim(),
    layers: layers.trim(),
    tools: tools.trim(),
    travelPositions: travelPositions.trim(),
    travelLayers: travelLayers.trim(),
    layerZ: Float32Array.from(layerZ),
    layerCount: layerZ.length,
    featureTypes,
    layerStart: Uint32Array.from(layerStart),
    travelLayerStart: Uint32Array.from(travelLayerStart),
    bbox: { min: bmin as [number, number, number], max: bmax as [number, number, number] },
    segmentCount: segCount,
    featureLength,
  };
}
