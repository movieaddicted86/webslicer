import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  extrusionWidth,
  FALLBACK_EXTRUSION_WIDTH,
  MIN_TOOLPATH_PIXELS,
  maxRibbonSegments,
  RIBBON_PIXEL_THRESHOLD,
  ribbonGeometry,
  ribbonsEnabled,
  ribbonSupport,
  ribbonTextureLimit,
  texelAt,
  ToolpathMaterial,
  toolpathMode,
  toolpathWidth,
  viewHeight,
  wideToolpaths,
  wrapTextureLayout,
} from './pathwidth.js';

test('the hairline baseline is an explicit opt-in and normal visits stay adaptive', () => {
  assert.equal(toolpathMode(''), 'adaptive');
  assert.equal(toolpathMode('?testToolpaths=ribbons'), 'adaptive');
  assert.equal(toolpathMode('?testToolpaths=HAIRLINES'), 'adaptive');
  assert.equal(toolpathMode('?testToolpaths=hairlines'), 'hairlines');
  assert.equal(toolpathMode('?foo=1&testToolpaths=hairlines'), 'hairlines');
});

test('the ribbon renderer is available unless the test hook switches it off', () => {
  assert.equal(ribbonsEnabled(''), true);
  assert.equal(ribbonsEnabled('?testRibbons=on'), true);
  assert.equal(ribbonsEnabled('?testRibbons=off'), false);
  assert.equal(ribbonsEnabled('?foo=1&testRibbons=off'), false);
});

test('the texture limit follows the device unless the test hook lowers it', () => {
  assert.equal(ribbonTextureLimit('', 8192), 8192);
  assert.equal(ribbonTextureLimit('?testRibbonLimit=64', 8192), 64);
  assert.equal(ribbonTextureLimit('?testRibbonLimit=32768', 8192), 8192);
  assert.equal(ribbonTextureLimit('?testRibbonLimit=0', 8192), 8192);
  assert.equal(ribbonTextureLimit('?testRibbonLimit=nope', 8192), 8192);
});

test('a run that fits a row stays one row', () => {
  assert.deepEqual(wrapTextureLayout(1, 8192), { width: 1, height: 1, padded: false });
  assert.deepEqual(wrapTextureLayout(8192, 8192), { width: 8192, height: 1, padded: false });
});

test('a run longer than the limit wraps into rows that divide it exactly', () => {
  // AC-1: below, at and above a given max width
  const below = wrapTextureLayout(64, 64);
  assert.deepEqual(below, { width: 64, height: 1, padded: false });
  const at = wrapTextureLayout(65, 64);
  assert.ok(at);
  assert.equal(at!.width * at!.height, 65);
  assert.ok(at!.width <= 64 && at!.height <= 64);
  const above = wrapTextureLayout(120, 64);
  assert.ok(above);
  assert.equal(above!.width * above!.height, 120);
  assert.equal(above!.padded, false);
  assert.ok(above!.width <= 64 && above!.height <= 64);
});

test('every wrapped texel is addressable and unique', () => {
  // AC-1: the index -> texel mapping covers the whole run exactly once
  for (const [count, max] of [
    [1, 8],
    [8, 8],
    [17, 8],
    [64, 8],
    [60, 8],
    [1000, 64],
  ] as const) {
    const layout = wrapTextureLayout(count, max)!;
    assert.ok(layout.width <= max && layout.height <= max, `${count}/${max}: the grid fits the limit`);
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const { x, y } = texelAt(i, layout);
      assert.ok(x >= 0 && x < layout.width && y >= 0 && y < layout.height, `${i}: inside the grid`);
      assert.ok(i < layout.width * layout.height, `${i}: the grid holds the run`);
      const key = `${x},${y}`;
      assert.ok(!seen.has(key), `${i}: ${key} is unique`);
      seen.add(key);
    }
    assert.equal(seen.size, count);
  }
});

test('a run that cannot be split cleanly is padded to whole rows', () => {
  const layout = wrapTextureLayout(7, 3)!;
  assert.equal(layout.padded, true);
  assert.ok(layout.width <= 3 && layout.height <= 3);
  assert.ok(layout.width * layout.height >= 7);
  // every real texel still has its own cell
  const seen = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const cell = texelAt(i, layout);
    const key = `${cell.x},${cell.y}`;
    assert.ok(!seen.has(key));
    seen.add(key);
  }
  assert.equal(seen.size, 7);
});

test('a run beyond the square root of the device does not fit', () => {
  assert.equal(wrapTextureLayout(0, 64), null);
  assert.equal(wrapTextureLayout(3, 0), null);
  assert.equal(wrapTextureLayout(5000, 64), null);
});

test('two texels per segment cap the segment count at half the grid', () => {
  assert.equal(maxRibbonSegments(8192), (8192 * 8192) / 2);
  assert.equal(maxRibbonSegments(64), 2048);
  assert.equal(maxRibbonSegments(1), 0);
});

test('the extrusion width comes from the G-code and falls back to 0.45 mm', () => {
  assert.equal(extrusionWidth(0.6), 0.6);
  assert.equal(extrusionWidth(0), FALLBACK_EXTRUSION_WIDTH);
  assert.equal(extrusionWidth(undefined), FALLBACK_EXTRUSION_WIDTH);
  assert.equal(extrusionWidth(NaN), FALLBACK_EXTRUSION_WIDTH);
  assert.equal(extrusionWidth(-1), FALLBACK_EXTRUSION_WIDTH);
});

test('a thin extrusion never falls below 1.5 screen pixels', () => {
  assert.equal(toolpathWidth(0.45, 0.1), 0.45);
  assert.equal(toolpathWidth(0.45, 1), MIN_TOOLPATH_PIXELS);
  assert.equal(toolpathWidth(0, 1), MIN_TOOLPATH_PIXELS);
});

test('ribbons replace hairlines when a real extrusion is three pixels wide', () => {
  assert.equal(wideToolpaths(RIBBON_PIXEL_THRESHOLD / 0.45, 0.45), true);
  assert.equal(wideToolpaths(RIBBON_PIXEL_THRESHOLD / 0.45 - 0.01, 0.45), false);
  assert.equal(wideToolpaths(RIBBON_PIXEL_THRESHOLD / 0.45, 0), true);
});

test('perspective and orthographic views report the millimetres they show', () => {
  const persp = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  persp.position.set(0, 0, 100);
  const target = new THREE.Vector3();
  assert.ok(Math.abs(viewHeight(persp, target) - 2 * 100 * Math.tan(Math.PI / 8)) < 1e-9);
  const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50);
  ortho.zoom = 2;
  assert.equal(viewHeight(ortho, target), 50);
});

test('one instanced ribbon per segment keeps the G-code width and shares the position buffer', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
  const colors = new Float32Array([1, 0, 0, 1, 0, 0]);
  const widths = new Float32Array([0.45]);
  const geometry = ribbonGeometry(positions, colors, widths);
  assert.equal(geometry.instanceCount, 1);
  const positionsBuffer = (geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data;
  assert.equal(positionsBuffer.array, positions);
  assert.equal((geometry.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute).data, positionsBuffer);
  assert.equal(geometry.getAttribute('instanceWidth').array, widths);
  const colorStart = geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute;
  const colorEnd = geometry.getAttribute('instanceColorEnd') as THREE.InterleavedBufferAttribute;
  assert.equal(colorStart.data, colorEnd.data);
  assert.equal(colorStart.data.array, colors);
  const material = new ToolpathMaterial(geometry, 8192);
  assert.equal(material.uniforms.linewidth.value, 0.45);
  material.dispose();
  geometry.dispose();
});

test('the segment textures read the shared interleaved buffer for a run that fits one row', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
  const colors = new Float32Array(12);
  const widths = new Float32Array([0.45, 0.5]);
  const geometry = ribbonGeometry(positions, colors, widths);
  const material = new ToolpathMaterial(geometry, 8192);
  const start = material.uniforms.instanceStartTex.value as THREE.DataTexture;
  const color = material.uniforms.instanceColorStartTex.value as THREE.DataTexture;
  const width = material.uniforms.instanceWidthTex.value as THREE.DataTexture;
  assert.equal(start.image.data, positions);
  assert.equal(color.image.data, colors);
  assert.equal(start.image.width, 4);
  assert.equal(start.image.height, 1);
  assert.equal(material.segmentLayout.width, 4);
  assert.equal(material.segmentLayout.height, 1);
  assert.equal(width.image.width, 2);
  assert.equal(width.image.height, 1);
  assert.equal(width.image.data, widths);
  material.dispose();
  geometry.dispose();
});

test('a texture layout with a padded row mirrors the shared buffer in a dense copy', () => {
  // 5 segments = 10 texels; a 4-texel width cannot divide them, so the run is padded to 4 × 3
  const positions = new Float32Array(30).map((_, i) => i);
  const colors = new Float32Array(30);
  const widths = new Float32Array(5).fill(0.45);
  const geometry = ribbonGeometry(positions, colors, widths);
  const material = new ToolpathMaterial(geometry, 4);
  const start = material.uniforms.instanceStartTex.value as THREE.DataTexture;
  assert.notEqual(start.image.data, positions);
  assert.equal(start.image.width, 4);
  assert.equal(start.image.height, 3);
  // the copy starts with the shared data and pads the rest with zeros
  const copy = start.image.data as unknown as Float32Array;
  assert.deepEqual(Array.from(copy.subarray(0, 30)), Array.from(positions));
  assert.ok(Array.from(copy.subarray(30)).every((v) => v === 0));
  // an in-place update re-mirrors into the copy
  positions[0] = 99;
  material.refresh('position');
  assert.equal((start.image.data as unknown as Float32Array)[0], 99);
  material.dispose();
  geometry.dispose();
});

test('the float-texture probe leaves the bound texture in place (the bed turned black, T-103)', () => {
  // three.js skips a texture bind when its state cache says the texture is already bound to the
  // active unit. The raw probe must therefore put the previous binding back, not unbind the unit.
  const previous = { name: 'bed texture' };
  const binds: unknown[] = [];
  const gl = {
    TEXTURE_BINDING_2D: 0x8069,
    TEXTURE_2D: 0x0de1,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
    RGB32F: 0x8815,
    RGB: 0x1907,
    FLOAT: 0x1406,
    NO_ERROR: 0,
    createTexture: () => ({ name: 'probe' }),
    deleteTexture: () => undefined,
    bindTexture: (_target: number, tex: unknown) => void binds.push(tex),
    texImage2D: () => undefined,
    getError: () => 0,
    getParameter: (name: number) => (name === 0x8069 ? previous : name === 0x8b4c ? 8 : 0),
  };
  const renderer = { getContext: () => gl, capabilities: { maxTextureSize: 8192 } } as unknown as THREE.WebGLRenderer;
  assert.equal(ribbonSupport(renderer, 10, '').usable, true);
  // the probe bound its own texture, then restored the previous one - and never bound null
  assert.equal(binds.length, 2);
  assert.notEqual(binds[0], previous);
  assert.equal(binds[1], previous);
  assert.ok(!binds.includes(null));
});
