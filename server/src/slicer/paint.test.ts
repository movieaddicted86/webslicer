import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeToTriangleState,
  triangleStateToAttribute,
  paintStringToStates,
  PAINT_BLOCKER,
  PAINT_ENFORCER,
  PAINT_NONE,
} from './paint.js';

test('whole-triangle states encode like PrusaSlicer', () => {
  assert.equal(triangleStateToAttribute(PAINT_ENFORCER), '4');
  assert.equal(triangleStateToAttribute(PAINT_BLOCKER), '8');
  assert.equal(triangleStateToAttribute(PAINT_NONE), '');
  assert.equal(attributeToTriangleState('4'), PAINT_ENFORCER);
  assert.equal(attributeToTriangleState('8'), PAINT_BLOCKER);
  assert.equal(attributeToTriangleState(''), PAINT_NONE);
  assert.equal(attributeToTriangleState(undefined), PAINT_NONE);
});

test('split triangles reduce to their majority leaf state', () => {
  // one split side (bits 1,0), special side 0 (bits 0,0), two children: enforcer leaf (0,0,1,0), none leaf (0,0,0,0)
  // stream: 1 0 0 0 | 0 0 1 0 | 0 0 0 0  → nibbles: 0b0001=1, 0b0100=4, 0 → "140"
  assert.equal(attributeToTriangleState('140'), PAINT_ENFORCER);
  // three split sides (1,1), special (0,0), four children all blocker (0,0,0,1)
  // stream: 1 1 0 0 | 0 0 0 1 | 0 0 0 1 | 0 0 0 1 | 0 0 0 1 → "38888"
  assert.equal(attributeToTriangleState('38888'), PAINT_BLOCKER);
  // one enforcer leaf among three none leaves → none
  // split 3 (1,1,0,0) then leaves: enforcer, none, none, none → "3" "4" "0" "0" "0"
  assert.equal(attributeToTriangleState('34000'), PAINT_NONE);
});

test('paint strings', () => {
  const s = paintStringToStates('0480');
  assert.deepEqual(s && [...s], [0, 1, 2, 0]);
  assert.equal(paintStringToStates('000'), undefined);
});
