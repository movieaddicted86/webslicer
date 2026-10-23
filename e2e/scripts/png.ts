/**
 * Re-encode a screenshot as an indexed PNG so the documentation images stay small (budget: 300 KB).
 *
 * Playwright writes true-colour PNGs; a 1440 × 900 UI shot lands at 300–320 KB. The UI is flat
 * colours, so 256 palette entries lose nothing visible and cut the files to about a quarter. The
 * codec here is deliberately small – decode the filters, median-cut the histogram, write an indexed
 * PNG – so refreshing the images needs no extra dependency (`npm run docs:screenshots`).
 *
 * Supports what a browser screenshot is: 8-bit colour type 2 (RGB) or 6 (RGBA), all five row filters.
 */
import zlib from 'node:zlib';

const zlibInflate = (b: Buffer): Buffer => zlib.inflateSync(b);
const zlibDeflate = (b: Buffer): Buffer => zlib.deflateSync(b, { level: 9 });

interface Image {
  width: number;
  height: number;
  /** RGB triplets, 3 bytes per pixel */
  rgb: Buffer;
}

/** Decode a PNG into RGB (an alpha channel is dropped, which the opaque app UI never needs). */
export function decodePng(file: Buffer): Image {
  let off = 8;
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;
  let channels = 3;
  while (off < file.length) {
    const len = file.readUInt32BE(off);
    const type = file.toString('latin1', off + 4, off + 8);
    const body = file.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error('only 8-bit PNGs are supported');
      if (body[9] === 6) channels = 4;
      else if (body[9] !== 2) throw new Error(`unsupported PNG colour type ${body[9]}`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlibInflate(Buffer.concat(idat));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    raw.copy(row, 0, start + 1, start + 1 + stride);
    unfilter(filter, row, prev, channels);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 3;
      rgb[d] = row[s];
      rgb[d + 1] = row[s + 1];
      rgb[d + 2] = row[s + 2];
    }
    row.copy(prev);
  }
  return { width, height, rgb };
}

function unfilter(filter: number, row: Buffer, prev: Buffer, bpp: number): void {
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    const add = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
    row[i] = (row[i] + add) & 255;
  }
}

/** A 5-bit-per-channel histogram: 32768 buckets, enough for a screenshot and cheap to walk. */
const BUCKETS = 32768;
const bucketOf = (r: number, g: number, b: number): number => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

interface Box {
  /** bucket indices present in this box, sorted along `axis` */
  keys: number[];
  min: [number, number, number];
  max: [number, number, number];
}

function makeBox(keys: number[]): Box {
  const min: [number, number, number] = [31, 31, 31];
  const max: [number, number, number] = [0, 0, 0];
  for (const k of keys) {
    const v: [number, number, number] = [(k >> 10) & 31, (k >> 5) & 31, k & 31];
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], v[a]);
      max[a] = Math.max(max[a], v[a]);
    }
  }
  return { keys, min, max };
}

/** Median cut: split the widest box along its widest axis at the median (weighted by pixel count). */
function medianCut(hist: Uint32Array, count: number): Array<[number, number, number]> {
  const present: number[] = [];
  for (let k = 0; k < BUCKETS; k++) if (hist[k]) present.push(k);
  const boxes: Box[] = [makeBox(present)];
  while (boxes.length < count) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.keys.length < 2) continue;
      const score = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) * box.keys.length;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const axis = [0, 1, 2].reduce((m, a) => (box.max[a] - box.min[a] > box.max[m] - box.min[m] ? a : m), 0);
    const shift = axis === 0 ? 10 : axis === 1 ? 5 : 0;
    box.keys.sort((a, b) => ((a >> shift) & 31) - ((b >> shift) & 31));
    let half = 0;
    for (const k of box.keys) half += hist[k];
    half /= 2;
    let seen = 0;
    let split = 1;
    for (let i = 0; i < box.keys.length; i++) {
      seen += hist[box.keys[i]];
      if (seen >= half && i > 0 && i < box.keys.length - 1) {
        split = i + 1;
        break;
      }
    }
    boxes.splice(best, 1, makeBox(box.keys.slice(0, split)), makeBox(box.keys.slice(split)));
  }
  return boxes.map((box) => {
    let n = 0;
    const sum = [0, 0, 0];
    for (const k of box.keys) {
      const c = hist[k];
      n += c;
      sum[0] += ((k >> 10) & 31) * c;
      sum[1] += ((k >> 5) & 31) * c;
      sum[2] += (k & 31) * c;
    }
    return sum.map((v) => Math.round((v / n) * (255 / 31))) as [number, number, number];
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
  return Buffer.concat([head, body, crc]);
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Encode an RGB image as an 8-bit indexed PNG with at most 256 palette entries. */
export function encodeIndexedPng(image: Image, colours = 256): Buffer {
  const hist = new Uint32Array(BUCKETS);
  for (let i = 0; i < image.rgb.length; i += 3) hist[bucketOf(image.rgb[i], image.rgb[i + 1], image.rgb[i + 2])]++;
  const palette = medianCut(hist, colours);
  // one lookup per 5-bit bucket keeps the per-pixel work to a table read
  const lut = new Uint8Array(BUCKETS);
  for (let k = 0; k < BUCKETS; k++) {
    const r = ((k >> 10) & 31) * (255 / 31);
    const g = ((k >> 5) & 31) * (255 / 31);
    const b = (k & 31) * (255 / 31);
    let best = 0;
    let bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const [pr, pg, pb] = palette[p];
      const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    lut[k] = best;
  }

  const { width, height } = image;
  const rows = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3;
      rows[y * (width + 1) + 1 + x] = lut[bucketOf(image.rgb[s], image.rgb[s + 1], image.rgb[s + 2])];
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 3;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', head),
    chunk('PLTE', Buffer.from(palette.flat())),
    chunk('IDAT', zlibDeflate(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
