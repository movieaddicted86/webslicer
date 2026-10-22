/** Triangle meshes: binary/ASCII STL parsing and writing, plus a matrix transform. */

import fs from 'node:fs';

export interface Mesh {
  /** flat xyz positions */
  vertices: Float32Array;
  /** triangle indices */
  indices: Uint32Array;
}

/**
 * S7: parse a binary or ASCII STL from a file, without reading it into memory first. `size` is the
 * file's length (the callers streamed it to disk and know it); the binary path yields one `Mesh`
 * whose faces were read in chunks.
 */
export function* parseStlFile(file: string, size: number): Generator<Mesh> {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(512, size));
    fs.readSync(fd, head, 0, head.length, 0);
    if (isBinaryStl(head, size)) yield* readBinaryFaces(fd, size);
    else yield parseAsciiStl(fs.readFileSync(file).toString('latin1'));
  } finally {
    fs.closeSync(fd);
  }
}

/** The format sniff `parseStl` uses, on the first bytes plus the announced count. */
function isBinaryStl(head: Buffer, size: number): boolean {
  if (size < 84) return false;
  const n = head.length >= 84 ? head.readUInt32LE(80) : -1;
  if (n >= 0 && 84 + n * 50 === size) return true;
  const text = head.toString('latin1');
  return !/^\s*solid/i.test(text) || !/facet/i.test(text);
}

/** The faces of a binary STL, 10 000 at a time, so a 500 MiB mesh never sits in RAM as records. */
function* readBinaryFaces(fd: number, size: number): Generator<Mesh> {
  const total = Math.max(0, Math.floor((size - 84) / 50));
  const perChunk = 10_000;
  const chunk = Buffer.alloc(perChunk * 50);
  // one vertex map across the chunks: the same corner in two chunks is the same vertex
  const map = new Map<string, number>();
  const verts: number[] = [];
  const indices: number[] = [];
  for (let first = 0; first < total; first += perChunk) {
    const count = Math.min(perChunk, total - first);
    const offset = 84 + first * 50;
    fs.readSync(fd, chunk, 0, count * 50, offset);
    for (let i = 0; i < count; i++) {
      let o = i * 50 + 12; // skip the normal
      for (let v = 0; v < 3; v++) {
        const x = chunk.readFloatLE(o);
        const y = chunk.readFloatLE(o + 4);
        const z = chunk.readFloatLE(o + 8);
        o += 12;
        const key = `${x},${y},${z}`;
        let idx = map.get(key);
        if (idx === undefined) {
          idx = verts.length / 3;
          map.set(key, idx);
          verts.push(x, y, z);
        }
        indices.push(idx);
      }
    }
  }
  yield { vertices: Float32Array.from(verts), indices: Uint32Array.from(indices) };
}

export function parseStl(buf: Buffer): Mesh {
  const isBinary = (() => {
    if (buf.length < 84) return false;
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) return true;
    const head = buf.subarray(0, Math.min(buf.length, 512)).toString('latin1');
    return !/^\s*solid/i.test(head) || !/facet/i.test(head);
  })();
  return isBinary ? parseBinaryStl(buf) : parseAsciiStl(buf.toString('latin1'));
}

function dedupe(positions: number[]): Mesh {
  const map = new Map<string, number>();
  const verts: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const key = `${x},${y},${z}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = verts.length / 3;
      map.set(key, idx);
      verts.push(x, y, z);
    }
    indices.push(idx);
  }
  return { vertices: Float32Array.from(verts), indices: Uint32Array.from(indices) };
}

function parseBinaryStl(buf: Buffer): Mesh {
  const n = buf.readUInt32LE(80);
  const positions: number[] = new Array(n * 9);
  let o = 84;
  let p = 0;
  for (let i = 0; i < n; i++) {
    o += 12; // normal
    for (let v = 0; v < 9; v++) {
      positions[p++] = buf.readFloatLE(o);
      o += 4;
    }
    o += 2; // attribute byte count
  }
  return dedupe(positions);
}

function parseAsciiStl(text: string): Mesh {
  const positions: number[] = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) positions.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return dedupe(positions);
}

export function writeBinaryStl(mesh: Mesh): Buffer {
  const n = mesh.indices.length / 3;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('WebSlicer binary STL', 0, 'latin1');
  buf.writeUInt32LE(n, 80);
  let o = 84;
  const v = mesh.vertices;
  for (let i = 0; i < n; i++) {
    const a = mesh.indices[i * 3] * 3;
    const b = mesh.indices[i * 3 + 1] * 3;
    const c = mesh.indices[i * 3 + 2] * 3;
    const ux = v[b] - v[a],
      uy = v[b + 1] - v[a + 1],
      uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a],
      wy = v[c + 1] - v[a + 1],
      wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy,
      ny = uz * wx - ux * wz,
      nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    buf.writeFloatLE(nx, o);
    buf.writeFloatLE(ny, o + 4);
    buf.writeFloatLE(nz, o + 8);
    o += 12;
    for (const idx of [a, b, c]) {
      buf.writeFloatLE(v[idx], o);
      buf.writeFloatLE(v[idx + 1], o + 4);
      buf.writeFloatLE(v[idx + 2], o + 8);
      o += 12;
    }
    buf.writeUInt16LE(0, o);
    o += 2;
  }
  return buf;
}

/** Apply a column-major 4x4 matrix to every vertex (returns a new mesh). */
export function transformMesh(mesh: Mesh, m: number[]): Mesh {
  const src = mesh.vertices;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i],
      y = src[i + 1],
      z = src[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // a mirroring transform flips the winding order
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  let indices = mesh.indices;
  if (det < 0) {
    indices = new Uint32Array(mesh.indices.length);
    for (let i = 0; i < indices.length; i += 3) {
      indices[i] = mesh.indices[i];
      indices[i + 1] = mesh.indices[i + 2];
      indices[i + 2] = mesh.indices[i + 1];
    }
  }
  return { vertices: out, indices };
}
