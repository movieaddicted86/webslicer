/**
 * The touch gesture state machine: tap vs drag, double tap, long press, one finger orbit and the
 * two-finger pinch with its pan. Every case is driven with synthetic pointer samples, so the rules are
 * pinned without a browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchGestures, type GestureIntent, type PointerSample } from './gestures';

const at = (id: number, x: number, y: number, time = 0): PointerSample => ({ id, x, y, time });

/** Every intent type of a returned list, for a compact assertion. */
const types = (intents: GestureIntent[]): string[] => intents.map((i) => i.type);

test('a press and release without movement is a tap', () => {
  const g = new TouchGestures();
  assert.deepEqual(g.down(at(1, 100, 100, 0)), []);
  const out = g.up(at(1, 100, 100, 80));
  assert.deepEqual(out, [{ type: 'tap', x: 100, y: 100 }]);
  assert.equal(g.state, 'idle');
});

test('a movement inside the threshold stays a press, so it still taps', () => {
  const g = new TouchGestures({ dragThreshold: 12 });
  g.down(at(1, 100, 100, 0));
  assert.deepEqual(g.move(at(1, 107, 104, 20)), []);
  assert.deepEqual(types(g.up(at(1, 107, 104, 60))), ['tap']);
});

test('a movement past the threshold orbits and never taps', () => {
  const g = new TouchGestures({ dragThreshold: 12 });
  g.down(at(1, 100, 100, 0));
  const first = g.move(at(1, 130, 110, 30));
  // the first orbit step carries the whole movement since the press, so nothing is lost
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { type: 'orbit', dx: 30, dy: 10 });
  const second = g.move(at(1, 140, 120, 50));
  assert.deepEqual(second, [{ type: 'orbit', dx: 10, dy: 10 }]);
  assert.deepEqual(g.up(at(1, 140, 120, 70)), []);
  assert.equal(g.state, 'idle');
});

test('a press on a selected object drags instead of orbiting, and says when it starts and ends', () => {
  const g = new TouchGestures({ dragThreshold: 12 });
  g.down(at(1, 200, 200, 0), { drag: true });
  const out = g.move(at(1, 240, 200, 30));
  assert.deepEqual(types(out), ['dragStart', 'dragMove']);
  assert.deepEqual(out[1], { type: 'dragMove', dx: 40, dy: 0 });
  assert.deepEqual(g.move(at(1, 250, 210, 40)), [{ type: 'dragMove', dx: 10, dy: 10 }]);
  assert.deepEqual(g.up(at(1, 250, 210, 60)), [{ type: 'dragEnd' }]);
});

test('a drag on a selected object that never leaves the threshold is a tap', () => {
  const g = new TouchGestures({ dragThreshold: 12 });
  g.down(at(1, 200, 200, 0), { drag: true });
  g.move(at(1, 205, 202, 30));
  assert.deepEqual(types(g.up(at(1, 205, 202, 60))), ['tap']);
});

test('two taps close in time and space are a double tap, a third one starts over', () => {
  const g = new TouchGestures({ doubleTapMs: 320, doubleTapSlop: 24 });
  g.down(at(1, 100, 100, 0));
  assert.deepEqual(types(g.up(at(1, 100, 100, 50))), ['tap']);
  g.down(at(1, 108, 104, 200));
  assert.deepEqual(g.up(at(1, 108, 104, 240)), [{ type: 'doubleTap', x: 108, y: 104 }]);
  // the pair is used up: a third tap is a first tap again
  g.down(at(1, 108, 104, 400));
  assert.deepEqual(types(g.up(at(1, 108, 104, 440))), ['tap']);
});

test('two taps far apart in time or space are two single taps', () => {
  const slow = new TouchGestures({ doubleTapMs: 320 });
  slow.down(at(1, 100, 100, 0));
  slow.up(at(1, 100, 100, 10));
  slow.down(at(1, 100, 100, 900));
  assert.deepEqual(types(slow.up(at(1, 100, 100, 950))), ['tap']);

  const far = new TouchGestures({ doubleTapSlop: 24 });
  far.down(at(1, 100, 100, 0));
  far.up(at(1, 100, 100, 10));
  far.down(at(1, 200, 100, 100));
  assert.deepEqual(types(far.up(at(1, 200, 100, 150))), ['tap']);
});

test('a motionless press becomes a long press once, and its release is not a tap', () => {
  const g = new TouchGestures({ longPressMs: 500 });
  g.down(at(1, 300, 300, 1000));
  assert.deepEqual(g.tick(1200), []);
  assert.deepEqual(g.tick(1500), [{ type: 'longPress', x: 300, y: 300 }]);
  // it fires once
  assert.deepEqual(g.tick(1800), []);
  assert.deepEqual(g.up(at(1, 300, 300, 1900)), []);
});

test('a movement before the long press deadline keeps the press a tap', () => {
  const g = new TouchGestures({ longPressMs: 500, dragThreshold: 12 });
  g.down(at(1, 300, 300, 0));
  g.move(at(1, 300, 340, 100));
  assert.deepEqual(g.tick(900), []);
  assert.deepEqual(g.up(at(1, 300, 340, 950)), []);
});

test('a second finger turns the stroke into a pinch: no tap, and a drag ends', () => {
  const g = new TouchGestures();
  g.down(at(1, 100, 100, 0), { drag: true });
  g.move(at(1, 140, 100, 20));
  const out = g.down(at(2, 200, 100, 30));
  assert.deepEqual(types(out), ['dragEnd']);
  assert.equal(g.state, 'pinch');
  // the pinch is measured from the two fingers' distance, not from one finger's movement: the
  // fingers go from 60 px apart to 100, and the midpoint follows the finger that moved
  const step = g.move(at(2, 240, 100, 40));
  assert.deepEqual(types(step), ['pinch']);
  if (step[0].type === 'pinch') {
    assert.ok(Math.abs(step[0].ratio - 100 / 60) < 1e-9, `ratio ${step[0].ratio}`);
    assert.equal(step[0].dx, 20);
    assert.equal(step[0].dy, 0);
  }
  assert.deepEqual(g.up(at(1, 100, 100, 60)), []);
  // one finger left: the other orbits from its own position, nothing taps on its release
  assert.equal(g.state, 'orbit');
  assert.deepEqual(g.up(at(2, 240, 100, 80)), []);
});

test('a pinch reports the distance ratio and the midpoint, and a tiny jitter is dropped', () => {
  const g = new TouchGestures();
  g.down(at(1, 100, 100, 0));
  g.down(at(2, 300, 100, 0));
  // one finger spreads away: the distance grows 200 → 240 (zoom in) while the midpoint follows it
  const spread = g.move(at(1, 60, 100, 20));
  assert.deepEqual(types(spread), ['pinch']);
  if (spread[0].type === 'pinch') {
    assert.ok(Math.abs(spread[0].ratio - 240 / 200) < 1e-9);
    assert.equal(spread[0].dx, -20);
    assert.equal(spread[0].dy, 0);
  }
  // both fingers move right by the same amount: the distance and the ratio stay, the midpoint pans
  const pan = g.move(at(2, 310, 100, 30));
  assert.deepEqual(types(pan), ['pinch']);
  if (pan[0].type === 'pinch') {
    assert.ok(Math.abs(pan[0].ratio - 250 / 240) < 1e-9);
    assert.equal(pan[0].dx, 5);
  }
  // a movement under half a pixel without a real change is not a gesture
  assert.deepEqual(g.move(at(2, 310.2, 100, 40)), []);
});

test('cancel ends a stroke without a tap, and reset forgets everything', () => {
  const g = new TouchGestures();
  g.down(at(1, 100, 100, 0), { drag: true });
  g.move(at(1, 160, 100, 20));
  assert.deepEqual(g.cancel(at(1, 160, 100, 30)), [{ type: 'dragEnd' }]);
  assert.equal(g.state, 'idle');

  g.down(at(1, 100, 100, 40));
  g.reset();
  // a press after the reset is a fresh one
  assert.deepEqual(g.up(at(1, 100, 100, 50)), []);
});
