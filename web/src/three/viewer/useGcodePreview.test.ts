import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { parseGcode } from '../../gcode/parser';
import type { MarkerKind } from '../../gcode/types';
import { ribbonGeometry, ToolpathMaterial } from './pathwidth';
import type { SceneRefs } from './types';
import { applyGcodeRange } from './useGcodePreview';

const SAMPLE = [
  'M83',
  ';LAYER_CHANGE',
  ';Z:0.2',
  'G1 Z.2',
  'G1 X0 Y0',
  ';TYPE:External perimeter',
  'G1 X1 Y0 E0.1',
  'G1 X1 Y1 E0.1',
  ';LAYER_CHANGE',
  ';Z:0.4',
  'G1 Z.4',
  'G1 X0 Y0',
  'G1 X1 Y0 E0.1',
  'G1 X1 Y1 E0.1',
  ';LAYER_CHANGE',
  ';Z:0.6',
  'G1 Z.6',
  'G1 X0 Y0',
  'G1 X1 Y0 E0.1',
  'G1 X1 Y1 E0.1',
].join('\n');

function previewRefs(gcode: ReturnType<typeof parseGcode>): SceneRefs {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(gcode.positions.slice(), 3));
  const colors = new Float32Array(gcode.positions.length);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial());
  const ribbonGeo = ribbonGeometry(
    gcode.positions.slice(),
    colors,
    Float32Array.from(gcode.width, () => 0.45),
  );
  const ribbons = new THREE.Mesh(ribbonGeo, new ToolpathMaterial(ribbonGeo));
  return { gcodeLines: lines, gcodeRibbons: ribbons } as unknown as SceneRefs;
}

test('the ribbon instance window and cut match the hairline segment window', () => {
  const gcode = parseGcode(SAMPLE);
  assert.equal(gcode.layerCount, 3);
  assert.equal(gcode.segmentCount, 6);
  const refs = previewRefs(gcode);
  const ribbons = refs.gcodeRibbons!.geometry as THREE.InstancedBufferGeometry;
  const material = refs.gcodeRibbons!.material as ToolpathMaterial;
  const windows: Array<{ range: [number, number]; cut: number; expected: [number, number] }> = [
    { range: [0, 2], cut: Number.MAX_SAFE_INTEGER, expected: [0, 6] },
    { range: [0, 0], cut: Number.MAX_SAFE_INTEGER, expected: [0, 2] },
    { range: [1, 1], cut: Number.MAX_SAFE_INTEGER, expected: [2, 2] },
    { range: [2, 2], cut: Number.MAX_SAFE_INTEGER, expected: [4, 2] },
    { range: [1, 2], cut: Number.MAX_SAFE_INTEGER, expected: [2, 4] },
    { range: [1, 2], cut: gcode.moveIndex[4], expected: [2, 3] },
  ];
  for (const { range, cut, expected } of windows) {
    applyGcodeRange(
      refs,
      gcode,
      range,
      { extrusion: cut, travel: cut, wipe: cut, marker: cut },
      false,
      {} as Record<MarkerKind, boolean>,
      {},
    );
    const hairlines = refs.gcodeLines!.geometry.drawRange;
    assert.deepEqual([hairlines.start / 2, hairlines.count / 2], expected);
    assert.deepEqual([ribbons.drawRange.start, ribbons.drawRange.count], [0, Infinity]);
    assert.equal(ribbons.instanceCount, expected[1]);
    assert.equal(material.uniforms.uFirst.value, expected[0]);
    assert.equal((material.uniforms.instanceStartTex.value as THREE.DataTexture).image.data, ribbons.getAttribute('instanceStart').array);
  }
  refs.gcodeLines!.geometry.dispose();
  refs.gcodeRibbons!.geometry.dispose();
  material.dispose();
});
