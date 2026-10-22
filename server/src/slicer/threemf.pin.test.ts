/**
 * Pin: one full `build3mf` project must keep every zip entry name and the exact text of every entry
 * (model XML, model config, custom G-codes, height ranges, project config). Together with the
 * roundtrip tests in `threemf.test.ts` this fixes the 3MF format while R-11 moves the writer apart.
 *
 * Regenerate deliberately (see `fixtures/README.md`): `UPDATE_PINS=1 npx tsx --test …`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { build3mf, type Mesh, type ThreeMfObject } from './threemf.js';
import { IDENTITY, translate } from '@webslicer/shared';

const FILE = path.join(import.meta.dirname, 'fixtures', 'written-3mf.json');

function cube(size: number): Mesh {
  const s = size;
  const v = [0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { vertices: Float32Array.from(v), indices: Uint32Array.from(f) };
}

/** The project of the pin: two objects, volumes, paint, a height range, custom G-codes, project config. */
const OBJECTS: ThreeMfObject[] = [
  {
    name: 'cube',
    mesh: cube(20),
    transform: translate(10, 20, 0),
    instances: [translate(10, 20, 0), translate(40, 20, 0)],
    config: { perimeters: '4', brim_width: '2' },
    extruder: 2,
    supportPaint: '400000000000',
    seamPaint: '800000000000',
    mmuPaint: '000000000023',
    ranges: [{ minZ: 0, maxZ: 4, config: { layer_height: '0.1' } }],
    volumes: [
      { name: 'mod', mesh: cube(5), type: 'ParameterModifier', config: { fill_density: '100%' } },
      { name: 'blocker', mesh: cube(3), type: 'SupportBlocker' },
    ],
  },
  { name: 'small & <odd>', mesh: cube(8), transform: IDENTITY, ranges: [] },
];

const OPTS = {
  title: 'T-028 pin',
  projectConfig: { layer_height: '0.2', perimeters: '3' },
  customGcodes: [
    { printZ: 2.4, type: 'color_change' as const, extruder: 1, color: '#FF0000' },
    { printZ: 5.2, type: 'pause' as const, extra: 'Insert magnets' },
  ],
  extruders: 2,
};

async function entriesOf(buf: Buffer): Promise<Array<{ name: string; text: string }>> {
  const zip = await JSZip.loadAsync(buf);
  const out: Array<{ name: string; text: string }> = [];
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (f.dir) continue;
    out.push({ name, text: await f.async('string') });
  }
  return out;
}

test('pinned 3MF: entry names and text of a written project are unchanged', async () => {
  const entries = await entriesOf(await build3mf(OBJECTS, OPTS));
  if (process.env.UPDATE_PINS) {
    fs.writeFileSync(FILE, JSON.stringify({ entries }, null, 2) + '\n');
    return;
  }
  const pinned = (JSON.parse(fs.readFileSync(FILE, 'utf8')) as { entries: Array<{ name: string; text: string }> }).entries;
  assert.deepEqual(
    entries.map((e) => e.name),
    pinned.map((e) => e.name),
  );
  for (const [i, entry] of entries.entries()) {
    assert.equal(entry.text, pinned[i].text, entry.name);
  }
});
