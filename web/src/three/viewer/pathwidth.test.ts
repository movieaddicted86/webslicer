import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  extrusionWidth,
  FALLBACK_EXTRUSION_WIDTH,
  MIN_TOOLPATH_PIXELS,
  RIBBON_PIXEL_THRESHOLD,
  ribbonGeometry,
  ToolpathMaterial,
  toolpathMode,
  toolpathWidth,
  viewHeight,
  wideToolpaths,
} from './pathwidth.js';

test('the hairline baseline is an explicit opt-in and normal visits stay adaptive', () => {
  assert.equal(toolpathMode(''), 'adaptive');
  assert.equal(toolpathMode('?testToolpaths=ribbons'), 'adaptive');
  assert.equal(toolpathMode('?testToolpaths=HAIRLINES'), 'adaptive');
  assert.equal(toolpathMode('?testToolpaths=hairlines'), 'hairlines');
  assert.equal(toolpathMode('?foo=1&testToolpaths=hairlines'), 'hairlines');
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
  const material = new ToolpathMaterial();
  assert.equal(material.uniforms.linewidth.value, 0.45);
  material.dispose();
  geometry.dispose();
});
