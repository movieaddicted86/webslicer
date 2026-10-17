/**
 * Minimal QOI ("Quite OK Image") encoder – the format Prusa printers expect for display thumbnails.
 * https://qoiformat.org/qoi-specification.pdf
 */
export function encodeQoi(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const maxSize = width * height * 5 + 14 + 8;
  const out = new Uint8Array(maxSize);
  let p = 0;
  const write32 = (v: number) => {
    out[p++] = (v >>> 24) & 0xff;
    out[p++] = (v >>> 16) & 0xff;
    out[p++] = (v >>> 8) & 0xff;
    out[p++] = v & 0xff;
  };
  out[p++] = 0x71; // q
  out[p++] = 0x6f; // o
  out[p++] = 0x69; // i
  out[p++] = 0x66; // f
  write32(width);
  write32(height);
  out[p++] = 4; // RGBA
  out[p++] = 0; // sRGB with linear alpha

  const index = new Uint8Array(64 * 4);
  let pr = 0,
    pg = 0,
    pb = 0,
    pa = 255;
  let run = 0;
  const pixels = width * height;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const r = rgba[o],
      g = rgba[o + 1],
      b = rgba[o + 2],
      a = rgba[o + 3];
    if (r === pr && g === pg && b === pb && a === pa) {
      run++;
      if (run === 62 || i === pixels - 1) {
        out[p++] = 0xc0 | (run - 1);
        run = 0;
      }
    } else {
      if (run > 0) {
        out[p++] = 0xc0 | (run - 1);
        run = 0;
      }
      const hash = (r * 3 + g * 5 + b * 7 + a * 11) % 64;
      const h4 = hash * 4;
      if (index[h4] === r && index[h4 + 1] === g && index[h4 + 2] === b && index[h4 + 3] === a) {
        out[p++] = hash; // QOI_OP_INDEX
      } else {
        index[h4] = r;
        index[h4 + 1] = g;
        index[h4 + 2] = b;
        index[h4 + 3] = a;
        if (a === pa) {
          const dr = ((r - pr) << 24) >> 24;
          const dg = ((g - pg) << 24) >> 24;
          const db = ((b - pb) << 24) >> 24;
          const dgr = dr - dg;
          const dgb = db - dg;
          if (dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) {
            out[p++] = 0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2); // QOI_OP_DIFF
          } else if (dgr > -9 && dgr < 8 && dg > -33 && dg < 32 && dgb > -9 && dgb < 8) {
            out[p++] = 0x80 | (dg + 32); // QOI_OP_LUMA
            out[p++] = ((dgr + 8) << 4) | (dgb + 8);
          } else {
            out[p++] = 0xfe; // QOI_OP_RGB
            out[p++] = r;
            out[p++] = g;
            out[p++] = b;
          }
        } else {
          out[p++] = 0xff; // QOI_OP_RGBA
          out[p++] = r;
          out[p++] = g;
          out[p++] = b;
          out[p++] = a;
        }
      }
    }
    pr = r;
    pg = g;
    pb = b;
    pa = a;
  }
  // end marker
  for (let i = 0; i < 7; i++) out[p++] = 0;
  out[p++] = 1;
  return out.slice(0, p);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
